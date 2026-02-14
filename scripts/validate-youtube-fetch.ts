import { YouTubeDataService } from "../src/services/youtube.ts";

type Args = {
  videoId?: string;
  forceCache?: boolean;
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
      (result as Record<string, string>)[name] = inlineValue;
      continue;
    }
    if (name === "force-cache") {
      result.forceCache = true;
      continue;
    }
    const next = tokens[idx + 1];
    if (next && !next.startsWith("--")) {
      (result as Record<string, string>)[name] = next;
      idx += 1;
    }
  }
  return result;
};

const main = async () => {
  const { videoId } = parseArgs();
  if (!videoId) {
    console.error("Missing --videoId argument");
    process.exitCode = 1;
    return;
  }
  const service = new YouTubeDataService();
  const { metadata, etag } = await service.fetchVideo(videoId);
  console.log(`Fetched ${metadata.id}: ${metadata.snippet.title}`);
  console.log(`ETag: ${etag ?? metadata.etag ?? "unknown"}`);
  const related = await service.fetchRelated(videoId);
  console.log(`Related videos fetched: ${related.items.length}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
