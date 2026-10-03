// Writes public/version.json so the running page can poll for a newer deploy.
// A static file replaces the old /api/version route, which "output: export" forbids.
// The id precedence below MUST match next.config.ts, so both sides agree on CI.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const buildId =
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  `local-${Date.now()}`;

const target = "public/version.json";
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ buildId }, null, 2)}\n`);
console.log(`wrote ${target} (${buildId})`);
