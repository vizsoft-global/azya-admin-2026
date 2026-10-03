import type { NextConfig } from "next";

// One id per build; the browser compares it with /version.json to detect a new deploy.
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA, GitHub Actions sets GITHUB_SHA. The same
// precedence lives in scripts/write-version.mjs so the two ids match on CI.
const buildId =
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  `local-${Date.now()}`;

const nextConfig: NextConfig = {
  // Cloudflare Pages serves a finished static bundle, so there is no Node/edge server.
  // Anything that needs one (route handlers, force-dynamic) is not allowed under export.
  output: "export",
  // The optimiser needs a server; the panel loads Firebase Storage URLs directly instead.
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

export default nextConfig;
