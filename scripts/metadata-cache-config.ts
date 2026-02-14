import { persistCachePath, resolveCachePath } from "../src/services/cache/metadataCache";

type Args = {
  path?: string;
};

const parseArgs = (): Args => {
  const args: Args = {};
  const tokens = process.argv.slice(2);
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    if (!token.startsWith("--")) {
      continue;
    }
    const [key, inline] = token.slice(2).split("=", 2);
    if (inline) {
      (args as Record<string, string>)[key] = inline;
      continue;
    }
    const next = tokens[idx + 1];
    if (next && !next.startsWith("--")) {
      (args as Record<string, string>)[key] = next;
      idx += 1;
    }
  }
  return args;
};

const main = () => {
  const { path } = parseArgs();
  if (path) {
    const resolved = persistCachePath(path);
    console.log(`Cache path configured -> ${resolved}`);
  }
  console.log(`Active metadata cache path: ${resolveCachePath()}`);
};

main();
