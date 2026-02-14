import { YouTubeDataService } from "../src/services/youtube.ts";
import { MetadataCache } from "../src/services/cache/metadataCache";

type Args = {
  videoId?: string;
  forceCache?: boolean;
  removeCache?: boolean;
  cachePath?: string;
};

const parseArgs = (): Args => {
  const result: Args = {};
  const tokens = process.argv.slice(2);
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    if (!token.startsWith("--")) {
      continue;
    }
    const trimmed = token.slice(2);
    const [name, inlineValue] = trimmed.split("=", 2);
    if (inlineValue !== undefined) {
      if (name === "videoId") {
        result.videoId = inlineValue;
        continue;
      }
      if (name === "cache-path") {
        result.cachePath = inlineValue;
        continue;
      }
      (result as Record<string, string>)[name] = inlineValue;
      continue;
    }
    if (name === "force-cache") {
      result.forceCache = true;
      continue;
    }
    if (name === "remove-cache") {
      result.removeCache = true;
      continue;
    }
    const next = tokens[idx + 1];
    if (next && !next.startsWith("--")) {
      if (name === "videoId") {
        result.videoId = next;
      } else if (name === "cache-path") {
        result.cachePath = next;
      } else {
        (result as Record<string, string>)[name] = next;
      }
      idx += 1;
    }
  }
  return result;
};

const main = async () => {
  const { videoId, forceCache, removeCache, cachePath } = parseArgs();
  if (!videoId) {
    console.error("Missing --videoId argument");
    process.exitCode = 1;
    return;
  }
  const cache = new MetadataCache({ path: cachePath });
  if (removeCache) {
    cache.remove(videoId);
    console.log(`Cache entry removed for ${videoId}`);
  }

  if (forceCache) {
    const cached = cache.get(videoId);
    if (cached && !cache.needsRefresh(videoId)) {
      console.log(`Cache hit for ${videoId}`);
      console.log(`- title: ${cached.title}`);
      console.log(`- etag: ${cached.etag ?? "unknown"}`);
      console.log(`- lastFetched: ${cached.lastFetched ?? "unknown"}`);
      return;
    }
    console.log(`Cache miss or stale for ${videoId} (forcing fetch)`);
  }

  const service = new YouTubeDataService();
  const { metadata, etag } = await service.fetchVideo(videoId);
  console.log(`Fetched ${metadata.id}: ${metadata.snippet.title}`);
  console.log(`ETag: ${etag ?? metadata.etag ?? "unknown"}`);
  cache.upsert(videoId, {
    title: metadata.snippet.title,
    snippet: metadata.snippet,
    etag: etag ?? metadata.etag,
  });

  const stored = cache.get(videoId);
  if (stored) {
    console.log(`Cached at: ${stored.lastFetched ?? "unknown"}`);
  }

  const related = await service.fetchRelated(videoId);
  console.log(`Related videos fetched: ${related.items.length}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
