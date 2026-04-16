import { createHash } from "node:crypto";
import { downloadArtifact, ensureRelease, uploadReleaseAsset } from "./github.js";

function sanitizeAssetName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "") || "plugin";
}

function pickAssetName(releaseId, pluginName, version) {
  const base = sanitizeAssetName(pluginName);
  const ver = sanitizeAssetName(String(version).replace(/^v/i, ""));
  return `${base}-${ver || "unknown"}-r${releaseId}.phar`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function getExistingAsset(release, name) {
  if (!Array.isArray(release?.assets)) return null;
  return release.assets.find((asset) => asset?.name === name) || null;
}

function parseOwner(repoName) {
  const parts = String(repoName || "").split("/");
  return parts.length >= 2 ? parts[0] : "Unknown";
}

function formatApiRange(apiList) {
  if (!Array.isArray(apiList) || apiList.length === 0) return "n/a";
  const first = apiList[0] || {};
  const from = String(first.from || "").trim();
  const to = String(first.to || "").trim();
  if (!from && !to) return "n/a";
  if (!to) return from;
  if (!from) return to;
  return `${from} -> ${to}`;
}

function buildReleaseBody(release, releaseId, artifactUrl) {
  const repoName = String(release?.repo_name || "").trim();
  const owner = parseOwner(repoName);
  const projectUrl = repoName ? `https://github.com/${repoName}` : "n/a";
  const poggitProject = String(release?.html_url || "").trim() || "n/a";
  const descriptionUrl = String(release?.description_url || "").trim() || "n/a";
  const changelogUrl = String(release?.changelog_url || "").trim() || "n/a";
  const downloads = Number(release?.downloads || 0);
  const score = Number(release?.score || 0);
  const depCount = Array.isArray(release?.deps) ? release.deps.length : 0;
  const apiRange = formatApiRange(release?.api);

  return [
    "Mirrored from Poggit",
    "",
    `- plugin: ${release?.name || "unknown"}`,
    `- version: ${release?.version || "unknown"}`,
    `- author_owner: ${owner}`,
    `- source_repo: ${repoName || "n/a"}`,
    `- source_repo_url: ${projectUrl}`,
    `- poggit_project: ${poggitProject}`,
    `- poggit_release_id: ${releaseId}`,
    `- downloads: ${downloads}`,
    `- score: ${score}`,
    `- api_range: ${apiRange}`,
    `- dependencies_count: ${depCount}`,
    `- description_url: ${descriptionUrl}`,
    `- changelog_url: ${changelogUrl}`,
    `- source_artifact: ${artifactUrl}`,
  ].join("\n");
}

export async function mirrorOneRelease({ release, config, mirrorIndex }) {
  const releaseId = Number(release?.id);
  if (!Number.isFinite(releaseId)) {
    return { skipped: true, reason: "missing_release_id" };
  }

  const key = String(releaseId);
  const existingIndex = mirrorIndex.releases[key] || null;
  if (existingIndex?.download_url && !config.refreshExistingMetadata) {
    return { skipped: true, reason: "already_mirrored" };
  }

  const artifactUrl = String(release?.artifact_url || "").trim();
  if (!artifactUrl) {
    return { skipped: true, reason: "missing_artifact_url" };
  }

  const tag = `r-${releaseId}`;
  const assetName = pickAssetName(releaseId, release.name, release.version);
  const releaseBody = buildReleaseBody(release, releaseId, artifactUrl);

  const ghRelease = await ensureRelease({
    owner: config.mirrorOwner,
    repo: config.pharsRepo,
    tag,
    token: config.githubToken,
    userAgent: config.userAgent,
    name: `${release.name} ${release.version}`,
    body: releaseBody,
  });

  let asset = getExistingAsset(ghRelease, assetName);
  let fileHash = existingIndex?.sha256 || null;
  let size = existingIndex?.size_bytes || null;

  if (!asset) {
    const { bytes, contentType } = await downloadArtifact(artifactUrl, config.userAgent);
    fileHash = sha256(bytes);
    size = bytes.length;

    asset = await uploadReleaseAsset({
      uploadUrl: ghRelease.upload_url,
      token: config.githubToken,
      userAgent: config.userAgent,
      fileName: assetName,
      bytes,
      contentType,
    });
  }

  mirrorIndex.releases[key] = {
    release_id: releaseId,
    plugin_name: String(release?.name || ""),
    version: String(release?.version || ""),
    author_owner: parseOwner(release?.repo_name),
    source_repo: String(release?.repo_name || ""),
    source_repo_url: release?.repo_name ? `https://github.com/${release.repo_name}` : null,
    source_project_url: String(release?.html_url || "") || null,
    source_description_url: String(release?.description_url || "") || null,
    source_changelog_url: String(release?.changelog_url || "") || null,
    downloads: Number(release?.downloads || 0),
    score: Number(release?.score || 0),
    is_pre_release: Boolean(release?.is_pre_release),
    api_range: formatApiRange(release?.api),
    dependencies_count: Array.isArray(release?.deps) ? release.deps.length : 0,
    tag,
    asset_name: asset.name,
    download_url: asset.browser_download_url,
    source_artifact_url: artifactUrl,
    size_bytes: size ?? Number(asset.size || 0),
    sha256: fileHash,
    mirrored_at: new Date().toISOString(),
  };

  return {
    skipped: false,
    mirrored: true,
    releaseId,
    downloadUrl: asset.browser_download_url,
  };
}
