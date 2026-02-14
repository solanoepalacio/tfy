import { RetentionService, ONE_DAY_MS, TrimCandidate } from "../src/compliance/dataRetention";
import { MetadataCache, resolveCachePath } from "../src/services/cache/metadataCache";

type ParsedArgs = {
  apply?: boolean;
  dryRun?: boolean;
  maxAgeDays?: number;
  cachePath?: string;
  seed?: number;
  seedFresh?: number;
  seedAgeOffsetDays?: number;
};

const parseNumber = (value?: string): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseArgs = (): ParsedArgs => {
  const result: ParsedArgs = {};
  const tokens = process.argv.slice(2);
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    if (!token.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.toLowerCase();
    const value = inlineValue ?? (tokens[idx + 1] && !tokens[idx + 1].startsWith("--") ? tokens[idx + 1] : undefined);
    if (!inlineValue && value && !value.startsWith("--")) {
      idx += 1;
    }
    switch (key) {
      case "apply":
        result.apply = true;
        break;
      case "dry-run":
        result.dryRun = true;
        break;
      case "max-age-days":
        result.maxAgeDays = parseNumber(value);
        break;
      case "cache-path":
        if (value) {
          result.cachePath = value;
        }
        break;
      case "seed":
      case "seed-stale":
        result.seed = parseNumber(value) ?? result.seed ?? 0;
        break;
      case "seed-fresh":
        result.seedFresh = parseNumber(value);
        break;
      case "seed-age-offset":
        result.seedAgeOffsetDays = parseNumber(value);
        break;
      default:
        break;
    }
  }
  return result;
};

const seedEntries = (
  cache: MetadataCache,
  staleCount: number,
  freshCount: number,
  baseAgeDays: number,
  offsetDays: number,
): { stale: string[]; fresh: string[] } => {
  const staleIds: string[] = [];
  const freshIds: string[] = [];
  const now = Date.now();
  const staleTimestamp = new Date(now - (baseAgeDays + offsetDays) * ONE_DAY_MS).toISOString();
  const freshTimestamp = new Date(now - Math.max(baseAgeDays - 1, 1) * ONE_DAY_MS).toISOString();

  for (let idx = 0; idx < staleCount; idx += 1) {
    const id = `retention-old-${Date.now()}-${idx}`;
    cache.upsert(id, {
      title: `Stale sample ${idx}`,
      snippet: { title: `stale sample ${idx}` },
      lastFetched: staleTimestamp,
    });
    staleIds.push(id);
  }

  for (let idx = 0; idx < freshCount; idx += 1) {
    const id = `retention-fresh-${Date.now()}-${idx}`;
    cache.upsert(id, {
      title: `Fresh sample ${idx}`,
      snippet: { title: `fresh sample ${idx}` },
      lastFetched: freshTimestamp,
    });
    freshIds.push(id);
  }

  return { stale: staleIds, fresh: freshIds };
};

const describeCandidates = (candidates: TrimCandidate[]): string => {
  if (!candidates.length) {
    return "None";
  }
  return candidates.slice(0, 5).map((entry) => `${entry.videoId} (${entry.lastFetched ? new Date(entry.lastFetched).toISOString() : "unknown"})`).join(", ");
};

const main = () => {
  const args = parseArgs();
  const maxAgeDays = args.maxAgeDays ?? 30;
  const resolvedPath = resolveCachePath(args.cachePath);
  const cache = new MetadataCache({ path: resolvedPath });
  const service = new RetentionService({ cachePath: resolvedPath, maxAgeDays });
  let seededSummary = "";

  if ((args.seed ?? 0) > 0 || (args.seedFresh ?? 0) > 0) {
    const staleCount = args.seed ?? 2;
    const freshCount = args.seedFresh ?? 1;
    const offset = args.seedAgeOffsetDays ?? 2;
    const seeded = seedEntries(cache, staleCount, freshCount, maxAgeDays, offset);
    seededSummary = `Seeded ${seeded.stale.length} stale entries and ${seeded.fresh.length} fresh entries.`;
    console.info(seededSummary);
  }

  const shouldApply = args.apply ?? false;
  const dryRun = !shouldApply;
  const report = service.trimOldEntries({ dryRun, maxAgeDays });

  console.info("[Retention Cleanup] Report:");
  console.info(`- Cache path: ${resolvedPath}`);
  console.info(`- Threshold: ${new Date(report.threshold).toISOString()} (${maxAgeDays}d)`);
  console.info(`- Scanned: ${report.scanned}`);
  console.info(`- Candidates: ${report.candidates.length} (${describeCandidates(report.candidates)})`);
  console.info(`- Mode: ${shouldApply ? "apply" : "dry-run"}`);
  if (dryRun) {
    console.info("- Dry run mode: no rows deleted.");
  } else {
    console.info(`- Removed: ${report.removed}`);
  }
  if (seededSummary) {
    console.info(`- ${seededSummary}`);
  }
};

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
