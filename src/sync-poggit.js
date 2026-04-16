#!/usr/bin/env node

import { loadConfig } from "./lib/env.js";
import { fetchPoggitReleases } from "./lib/poggit.js";
import {
  buildCatalog,
  loadMirrorIndex,
  loadPluginIdMap,
  manifestExists,
  prepareManifestPaths,
  saveCatalog,
} from "./lib/manifest.js";
import { mirrorOneRelease } from "./lib/mirror.js";

function summarizePlugins(rawReleases) {
  const names = new Set();
  for (const item of rawReleases) {
    const name = String(item?.name || "").trim();
    if (name) names.add(name.toLowerCase());
  }
  return names.size;
}

function pickCandidates(rawReleases, mirrorIndex) {
  return rawReleases
    .filter((item) => Number.isFinite(Number(item?.id)) && String(item?.artifact_url || "").trim())
    .filter((item) => !mirrorIndex.releases[String(Number(item.id))]?.download_url)
    .sort((a, b) => Number(b.id) - Number(a.id));
}

async function main() {
  const config = loadConfig();

  if (!manifestExists(config.manifestDir)) {
    throw new Error(`MANIFEST_DIR does not exist: ${config.manifestDir}`);
  }

  console.log("=== Pockgin Mirror Sync ===");
  console.log(`owner/repo: ${config.mirrorOwner}/${config.pharsRepo}`);
  console.log(`manifest dir: ${config.manifestDir}`);
  console.log(`batch size: ${config.batchSize}`);
  console.log(`prefer mirror only: ${config.preferMirrorOnly}`);

  const paths = await prepareManifestPaths(config.manifestDir);
  const mirrorIndex = await loadMirrorIndex(paths);
  const pluginIdMap = await loadPluginIdMap(paths);

  const rawReleases = await fetchPoggitReleases(config.userAgent);
  console.log(`poggit releases fetched: ${rawReleases.length}`);

  const candidates = pickCandidates(rawReleases, mirrorIndex);
  const selected = candidates.slice(0, config.batchSize);
  console.log(`mirror candidates: ${candidates.length}, selected this run: ${selected.length}`);

  const newlyMirrored = [];
  const failedMirrors = [];

  for (const release of selected) {
    const label = `${release.name}@${release.version} (r-${release.id})`;
    try {
      const result = await mirrorOneRelease({ release, config, mirrorIndex });
      if (result.mirrored) {
        newlyMirrored.push(Number(release.id));
        console.log(`[mirrored] ${label}`);
      } else {
        console.log(`[skip] ${label}: ${result.reason}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedMirrors.push({ id: Number(release.id), message });
      console.warn(`[fail] ${label}: ${message}`);
    }
  }

  const catalog = buildCatalog(rawReleases, mirrorIndex, pluginIdMap, config.preferMirrorOnly);

  await saveCatalog(
    paths,
    catalog,
    mirrorIndex,
    {
      total_releases: rawReleases.length,
      total_plugins: summarizePlugins(rawReleases),
    },
    newlyMirrored
  );

  console.log("\n=== Sync Summary ===");
  console.log(`newly mirrored: ${newlyMirrored.length}`);
  console.log(`failed mirrors: ${failedMirrors.length}`);
  console.log(`catalog plugins: ${catalog.list.length}`);
  console.log(`mirror index entries: ${Object.keys(mirrorIndex.releases || {}).length}`);

  if (failedMirrors.length > 0) {
    console.log("failed release IDs:");
    for (const row of failedMirrors.slice(0, 20)) {
      console.log(`- r-${row.id}: ${row.message}`);
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(message);
  process.exit(1);
});
