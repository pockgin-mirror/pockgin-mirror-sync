import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = ["public", "data"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function slugify(text) {
  const raw = asString(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return raw || "plugin";
}

function parseVersion(version) {
  const cleaned = asString(version).replace(/^v/i, "");
  const parts = cleaned.split(/[^0-9]+/).filter(Boolean).map((x) => Number.parseInt(x, 10));
  if (!parts.length) return null;
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    extra: parts.slice(3),
  };
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;
  if (av.major !== bv.major) return av.major - bv.major;
  if (av.minor !== bv.minor) return av.minor - bv.minor;
  if (av.patch !== bv.patch) return av.patch - bv.patch;
  const len = Math.max(av.extra.length, bv.extra.length);
  for (let i = 0; i < len; i++) {
    const ai = av.extra[i] || 0;
    const bi = bv.extra[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

function parseOwner(repoName) {
  const parts = asString(repoName).split("/");
  return parts.length >= 2 ? parts[0] : "Unknown";
}

function normalizeDeps(deps) {
  const required = [];
  const optional = [];
  for (const dep of asArray(deps)) {
    const depName = asString(dep?.name);
    if (!depName) continue;
    if (Boolean(dep?.isHard)) required.push(depName);
    else optional.push(depName);
  }
  return { required, optional };
}

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export async function prepareManifestPaths(manifestDir) {
  const dataDir = join(manifestDir, ...DATA_DIR);
  const pluginsDir = join(dataDir, "plugins");

  await mkdir(pluginsDir, { recursive: true });

  return {
    dataDir,
    pluginsDir,
    mirrorIndexPath: join(dataDir, "mirror-index.json"),
    syncStatePath: join(dataDir, "sync-state.json"),
    pluginIdMapPath: join(dataDir, "plugin-id-map.json"),
    pluginsListPath: join(dataDir, "plugins.json"),
    statsPath: join(dataDir, "stats.json"),
  };
}

export async function loadMirrorIndex(paths) {
  const data = await readJson(paths.mirrorIndexPath, {
    schema_version: 1,
    generated_at: null,
    releases: {},
  });
  if (!data || typeof data !== "object" || !data.releases || typeof data.releases !== "object") {
    return {
      schema_version: 1,
      generated_at: null,
      releases: {},
    };
  }
  return data;
}

export async function loadPluginIdMap(paths) {
  const map = await readJson(paths.pluginIdMapPath, {});
  return map && typeof map === "object" ? map : {};
}

function assignPluginIds(groups, existingMap) {
  const used = new Set(Object.values(existingMap));
  const nextMap = { ...existingMap };

  for (const [groupKey, group] of groups) {
    if (nextMap[groupKey]) continue;

    const base = slugify(group.name);
    let candidate = base;
    let idx = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${idx}`;
      idx += 1;
    }

    used.add(candidate);
    nextMap[groupKey] = candidate;
  }

  return nextMap;
}

function buildReleaseRows(rawReleases, mirrorIndex, preferMirrorOnly) {
  const rows = [];

  for (const item of rawReleases) {
    const releaseId = Number(item?.id);
    const name = asString(item?.name);
    const version = asString(item?.version);
    if (!Number.isFinite(releaseId) || !name || !version) continue;

    const mirror = mirrorIndex.releases[String(releaseId)] || null;
    const mirrorUrl = asString(mirror?.download_url);

    if (preferMirrorOnly && !mirrorUrl) {
      continue;
    }

    const fallbackUrl = asString(item?.artifact_url);
    rows.push({
      release_id: releaseId,
      name,
      version,
      is_pre_release: Boolean(item?.is_pre_release),
      downloads: asNumber(item?.downloads),
      score: asNumber(item?.score),
      repo_name: asString(item?.repo_name),
      html_url: asString(item?.html_url),
      icon_url: asString(item?.icon_url),
      description: asString(item?.description),
      api: asArray(item?.api),
      deps: asArray(item?.deps),
      download_url: mirrorUrl || fallbackUrl || null,
      source_download_url: fallbackUrl || null,
      description_url: asString(item?.description_url),
      changelog_url: asString(item?.changelog_url),
    });
  }

  return rows;
}

function pickStableRelease(releases) {
  const stable = releases.filter((r) => !r.is_pre_release);
  const source = stable.length ? stable : releases;
  return source
    .slice()
    .sort((a, b) => {
      const byVersion = compareVersions(b.version, a.version);
      if (byVersion !== 0) return byVersion;
      return b.release_id - a.release_id;
    })[0];
}

function pickDevRelease(releases, stableReleaseId) {
  return releases
    .filter((r) => r.is_pre_release && r.release_id !== stableReleaseId)
    .slice()
    .sort((a, b) => {
      const byVersion = compareVersions(b.version, a.version);
      if (byVersion !== 0) return byVersion;
      return b.release_id - a.release_id;
    })[0] || null;
}

function buildPluginGroupMap(releaseRows) {
  const groups = new Map();

  for (const release of releaseRows) {
    const key = asString(release.name).toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: release.name,
        releases: [],
      });
    }
    groups.get(key).releases.push(release);
  }

  return groups;
}

export function buildCatalog(rawReleases, mirrorIndex, pluginIdMap, preferMirrorOnly) {
  const releaseRows = buildReleaseRows(rawReleases, mirrorIndex, preferMirrorOnly);
  const groups = buildPluginGroupMap(releaseRows);
  const nextPluginIdMap = assignPluginIds(groups, pluginIdMap);

  const pluginDetails = [];

  for (const group of groups.values()) {
    const releases = group.releases.slice().sort((a, b) => b.release_id - a.release_id);
    const stable = pickStableRelease(releases);
    if (!stable) continue;

    const dev = pickDevRelease(releases, stable.release_id);
    const id = nextPluginIdMap[group.key];
    const owner = parseOwner(stable.repo_name);
    const deps = normalizeDeps(stable.deps);

    const detail = {
      id,
      name: group.name,
      author: owner,
      description: stable.description || "",
      icon_url: stable.icon_url || "happy_ghast.png",
      featured: false,
      repo: stable.repo_name ? `https://github.com/${stable.repo_name}` : null,
      archive_repo: null,
      approved_release_tag: `r-${stable.release_id}`,
      stars: stable.score || 0,
      total_downloads: releases.reduce((sum, r) => sum + (r.downloads || 0), 0),
      last_commit_at: null,
      last_updated_at: null,
      license: null,
      api_support: asArray(stable.api)
        .map((a) => `${asString(a?.from)}-${asString(a?.to)}`.replace(/^-|-$/g, ""))
        .filter(Boolean),
      dependencies: deps,
      tags: ["poggit-import"],
      producers: [owner],
      whats_new: stable.changelog_url || "",
      versions: {
        stable: {
          version: stable.version,
          tag: `r-${stable.release_id}`,
          published_at: null,
          downloads: stable.downloads || 0,
          download_url: stable.download_url,
        },
        dev: dev
          ? {
              version: dev.version,
              tag: `r-${dev.release_id}`,
              published_at: null,
              downloads: dev.downloads || 0,
              download_url: dev.download_url,
            }
          : null,
      },
      recent_builds: releases.slice(0, 5).map((r) => ({
        tag: `r-${r.release_id}`,
        published_at: null,
        download_url: r.download_url,
      })),
      comments: {
        enabled: false,
      },
      build: {
        provider: "mirror-import",
        include_prerelease: true,
      },
      source: {
        provider: "poggit",
        plugin_name: group.name,
        stable_release_id: stable.release_id,
      },
    };

    pluginDetails.push(detail);
  }

  pluginDetails.sort((a, b) => a.name.localeCompare(b.name));

  const list = pluginDetails.map((detail) => ({
    id: detail.id,
    name: detail.name,
    author: detail.author,
    description: detail.description,
    icon_url: detail.icon_url,
    featured: detail.featured,
    stable_version: detail.versions.stable?.version || null,
    total_downloads: detail.total_downloads || 0,
    stars: detail.stars || 0,
    download_url: detail.versions.stable?.download_url || null,
  }));

  const stats = {
    total_plugins: list.length,
    total_downloads: list.reduce((sum, item) => sum + (item.total_downloads || 0), 0),
    mirrored_release_count: Object.keys(mirrorIndex.releases || {}).length,
    last_sync_at: new Date().toISOString(),
  };

  return {
    pluginIdMap: nextPluginIdMap,
    list,
    details: pluginDetails,
    stats,
  };
}

export async function saveCatalog(paths, catalog, mirrorIndex, rawReleasesMeta, newlyMirrored) {
  await writeJson(paths.pluginIdMapPath, catalog.pluginIdMap);
  await writeJson(paths.pluginsListPath, catalog.list);
  await writeJson(paths.statsPath, catalog.stats);

  const syncState = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_total_releases: rawReleasesMeta.total_releases,
    source_total_plugins: rawReleasesMeta.total_plugins,
    mirror_index_size: Object.keys(mirrorIndex.releases || {}).length,
    newly_mirrored_releases: newlyMirrored,
  };

  await writeJson(paths.syncStatePath, syncState);

  mirrorIndex.generated_at = new Date().toISOString();
  await writeJson(paths.mirrorIndexPath, mirrorIndex);

  for (const detail of catalog.details) {
    const filePath = join(paths.pluginsDir, `${detail.id}.json`);
    await writeJson(filePath, detail);
  }
}

export function manifestExists(manifestDir) {
  return existsSync(manifestDir);
}
