import Database from "better-sqlite3";
import { MetadataCache, resolveCachePath } from "../services/cache/metadataCache";

export const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export interface RetentionOptions {
  cachePath?: string;
  maxAgeDays?: number;
}

export interface TrimCandidate {
  videoId: string;
  lastFetched: number | null;
}

export interface TrimReport {
  threshold: number;
  scanned: number;
  candidates: TrimCandidate[];
  removed: number;
}

export interface TrimOptions {
  dryRun?: boolean;
  maxAgeDays?: number;
}

export class RetentionService {
  private readonly db: Database.Database;
  private readonly cache: MetadataCache;
  private readonly defaultMaxAgeDays: number;

  constructor(options?: RetentionOptions) {
    const resolvedPath = resolveCachePath(options?.cachePath);
    this.db = new Database(resolvedPath);
    this.cache = new MetadataCache({ path: resolvedPath });
    this.defaultMaxAgeDays = options?.maxAgeDays ?? 30;
  }

  public trimOldEntries(options?: TrimOptions): TrimReport {
    const maxAgeDays = options?.maxAgeDays ?? this.defaultMaxAgeDays;
    const threshold = Date.now() - maxAgeDays * ONE_DAY_MS;
    const selectStmt = this.db.prepare("SELECT video_id, last_fetched FROM metadata_cache");
    const rows = selectStmt.all() as Array<{ video_id: string; last_fetched: number | string | null }>;
    const candidates: TrimCandidate[] = rows
      .map((row) => {
        const raw = row.last_fetched;
        const converted = raw === null || raw === undefined ? null : Number(raw);
        const lastFetched = Number.isNaN(converted) ? null : converted;
        return { videoId: row.video_id, lastFetched };
      })
      .filter((entry) => entry.lastFetched === null || entry.lastFetched < threshold);

    if (!options?.dryRun && candidates.length) {
      const deleteStmt = this.db.prepare("DELETE FROM metadata_cache WHERE video_id = ?");
      const deleteTransaction = this.db.transaction((ids: string[]) => {
        ids.forEach((videoId) => deleteStmt.run(videoId));
      });
      deleteTransaction(candidates.map((entry) => entry.videoId));
    }

    return {
      threshold,
      scanned: rows.length,
      candidates,
      removed: options?.dryRun ? 0 : candidates.length,
    };
  }

  public revokeVideo(videoId: string): boolean {
    const cached = this.cache.get(videoId);
    if (!cached) {
      return false;
    }
    this.cache.remove(videoId);
    return true;
  }
}
