import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_FOLDER = join(homedir(), ".focus-filter");
const DEFAULT_DB_FILE = join(DEFAULT_FOLDER, "cache.sqlite");
const CONFIG_FILE = join(DEFAULT_FOLDER, "cache-config.json");
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;

const expandPath = (raw: string): string => {
  if (!raw) {
    return DEFAULT_DB_FILE;
  }
  if (raw.startsWith("~")) {
    return resolve(homedir(), raw.slice(1));
  }
  return resolve(raw);
};

const readConfiguredPath = (): string | null => {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content) as { path?: string };
    if (parsed?.path) {
      return expandPath(parsed.path);
    }
  } catch (error) {
    console.warn(`[MetadataCache] Unable to read config: ${error}`);
  }
  return null;
};

const ensureFolder = () => {
  if (!existsSync(DEFAULT_FOLDER)) {
    mkdirSync(DEFAULT_FOLDER, { recursive: true });
  }
};

export const resolveCachePath = (overridePath?: string): string => {
  if (overridePath) {
    return expandPath(overridePath);
  }
  if (process.env.FOCUS_FILTER_CACHE_PATH) {
    return expandPath(process.env.FOCUS_FILTER_CACHE_PATH);
  }
  const configured = readConfiguredPath();
  if (configured) {
    return configured;
  }
  ensureFolder();
  return DEFAULT_DB_FILE;
};

export const persistCachePath = (path: string): string => {
  const resolved = expandPath(path);
  const configFolder = dirname(CONFIG_FILE);
  mkdirSync(configFolder, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ path: resolved }, null, 2), "utf-8");
  return resolved;
};

export interface MetadataCacheEntry {
  videoId: string;
  title: string;
  snippet?: Record<string, unknown>;
  etag?: string;
  lastFetched?: string;
}

export interface MetadataCacheOptions {
  path?: string;
}

export class MetadataCache {
  private readonly db: Database.Database;
  private readonly getStmt: Database.Statement;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(options?: MetadataCacheOptions) {
    const cachePath = resolveCachePath(options?.path);
    mkdirSync(dirname(cachePath), { recursive: true });
    this.db = new Database(cachePath);
    this.prepareSchema();
    this.getStmt = this.db.prepare(`
      SELECT video_id, title, snippet, etag, last_fetched
      FROM metadata_cache
      WHERE video_id = ?
    `);
    this.upsertStmt = this.db.prepare(`
      INSERT INTO metadata_cache(video_id, title, snippet, etag, last_fetched)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title = excluded.title,
        snippet = excluded.snippet,
        etag = excluded.etag,
        last_fetched = excluded.last_fetched;
    `);
    this.deleteStmt = this.db.prepare(`DELETE FROM metadata_cache WHERE video_id = ?`);
    console.info(`[MetadataCache] sqlite path: ${cachePath}`);
  }

  private prepareSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata_cache (
        video_id TEXT PRIMARY KEY,
        title TEXT,
        snippet TEXT,
        etag TEXT,
        last_fetched INTEGER
      );
    `);
  }

  public get(videoId: string): MetadataCacheEntry | null {
    const row = this.getStmt.get(videoId);
    if (!row) {
      return null;
    }
    return {
      videoId: row.video_id,
      title: row.title,
      snippet: row.snippet ? JSON.parse(row.snippet) : undefined,
      etag: row.etag,
      lastFetched: row.last_fetched ? new Date(Number(row.last_fetched)).toISOString() : undefined,
    };
  }

  public upsert(videoId: string, payload: { title?: string; snippet?: Record<string, unknown>; etag?: string; lastFetched?: string }) {
    const titleValue = payload.title || payload.snippet?.["title"] || videoId;
    const snippetValue = payload.snippet ? JSON.stringify(payload.snippet) : null;
    const etagValue = payload.etag ?? null;
    const parsedAt = payload.lastFetched ? Date.parse(payload.lastFetched) : NaN;
    const fetchedAt = Number.isNaN(parsedAt) ? Date.now() : parsedAt;
    this.upsertStmt.run(videoId, titleValue, snippetValue, etagValue, fetchedAt);
  }

  public needsRefresh(videoId: string, remoteEtag?: string, maxAgeMs = DEFAULT_TTL_MS): boolean {
    const cached = this.get(videoId);
    if (!cached) {
      return true;
    }
    if (remoteEtag && cached.etag && cached.etag !== remoteEtag) {
      return true;
    }
    if (remoteEtag && !cached.etag) {
      return true;
    }
    if (cached.lastFetched) {
      const fetchedMs = Date.parse(cached.lastFetched);
      if (Number.isNaN(fetchedMs)) {
        return true;
      }
      if (Date.now() - fetchedMs > maxAgeMs) {
        return true;
      }
    }
    return false;
  }

  public remove(videoId: string): void {
    this.deleteStmt.run(videoId);
  }
}
