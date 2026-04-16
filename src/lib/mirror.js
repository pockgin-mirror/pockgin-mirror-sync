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

export async function mirrorOneRelease({ release, config, mirrorIndex }) {
  const releaseId = Number(release?.id);
  if (!Number.isFinite(releaseId)) {
    return { skipped: true, reason: "missing_release_id" };
  }

  const key = String(releaseId);
  if (mirrorIndex.releases[key]?.download_url) {
    return { skipped: true, reason: "already_mirrored" };
  }

  const artifactUrl = String(release?.artifact_url || "").trim();
  if (!artifactUrl) {
    return { skipped: true, reason: "missing_artifact_url" };
  }

  const tag = `r-${releaseId}`;
  const assetName = pickAssetName(releaseId, release.name, release.version);

  const ghRelease = await ensureRelease({
    owner: config.mirrorOwner,
    repo: config.pharsRepo,
    tag,
    token: config.githubToken,
    userAgent: config.userAgent,
    name: `${release.name} ${release.version}`,
    body: [
      "Mirrored from Poggit",
      `- plugin: ${release.name}`,
      `- version: ${release.version}`,
      `- poggit_release_id: ${releaseId}`,
      `- source_artifact: ${artifactUrl}`,
    ].join("\n"),
  });

  let asset = getExistingAsset(ghRelease, assetName);
  let fileHash = null;
  let size = null;

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
