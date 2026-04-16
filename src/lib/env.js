import { resolve } from "node:path";

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

export function loadConfig() {
  const token = process.env.GITHUB_TOKEN || "";
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const batch = Number.parseInt(process.env.BATCH_SIZE || "100", 10);

  return {
    githubToken: token,
    mirrorOwner: process.env.MIRROR_OWNER || "pockgin-mirror",
    pharsRepo: process.env.PHARS_REPO || "pockgin-mirror-phars",
    manifestDir: resolve(process.env.MANIFEST_DIR || "../pockgin-mirror-manifest"),
    batchSize: Number.isFinite(batch) && batch > 0 ? batch : 100,
    preferMirrorOnly: parseBoolean(process.env.PREFER_MIRROR_ONLY, true),
    refreshExistingMetadata: parseBoolean(process.env.REFRESH_EXISTING_METADATA, false),
    userAgent: "Pockgin-Mirror-Sync/0.1",
  };
}
