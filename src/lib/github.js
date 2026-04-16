import { fetchWithRetry, readJsonOrThrow } from "./http.js";

const API_BASE = "https://api.github.com";

function buildHeaders(token, userAgent, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
    ...extra,
  };
}

export async function githubJsonRequest({ token, userAgent, method = "GET", path, body }) {
  const url = `${API_BASE}${path}`;
  const headers = buildHeaders(token, userAgent, body ? { "Content-Type": "application/json" } : {});

  const response = await fetchWithRetry(
    url,
    {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    },
    { label: `github ${method} ${path}` }
  );

  return response;
}

export async function getReleaseByTag({ owner, repo, tag, token, userAgent }) {
  const path = `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await githubJsonRequest({ token, userAgent, path });
  if (response.status === 404) return null;
  return readJsonOrThrow(response, `Get release by tag ${tag}`);
}

export async function createRelease({ owner, repo, tag, token, userAgent, name, body }) {
  const path = `/repos/${owner}/${repo}/releases`;
  const response = await githubJsonRequest({
    token,
    userAgent,
    method: "POST",
    path,
    body: {
      tag_name: tag,
      name: name || tag,
      body: body || "Mirrored by pockgin-mirror-sync",
      draft: false,
      prerelease: false,
      make_latest: "false",
    },
  });

  return readJsonOrThrow(response, `Create release ${tag}`);
}

export async function ensureRelease({ owner, repo, tag, token, userAgent, name, body }) {
  const existing = await getReleaseByTag({ owner, repo, tag, token, userAgent });
  if (existing) return existing;
  return createRelease({ owner, repo, tag, token, userAgent, name, body });
}

export async function deleteReleaseAsset({ uploadUrl, token, userAgent, assetName }) {
  const listUrl = normalizeUploadUrl(uploadUrl);
  const releaseUrl = listUrl.replace(/\/assets$/, "");
  const response = await fetchWithRetry(
    releaseUrl,
    {
      headers: buildHeaders(token, userAgent),
    },
    { label: "get release for asset delete" }
  );

  const release = await readJsonOrThrow(response, "Load release metadata for asset delete");
  const matched = Array.isArray(release.assets)
    ? release.assets.find((asset) => asset?.name === assetName)
    : null;

  if (!matched) return;

  const del = await fetchWithRetry(
    `${API_BASE}/repos/${release.repository.full_name}/releases/assets/${matched.id}`,
    {
      method: "DELETE",
      headers: buildHeaders(token, userAgent),
    },
    { label: `delete asset ${assetName}` }
  );

  if (!del.ok && del.status !== 404) {
    throw new Error(`Delete existing asset failed (${del.status})`);
  }
}

export function normalizeUploadUrl(uploadUrl) {
  return String(uploadUrl || "").replace(/\{\?name,label\}$/, "");
}

export async function uploadReleaseAsset({ uploadUrl, token, userAgent, fileName, bytes, contentType }) {
  const base = normalizeUploadUrl(uploadUrl);
  const targetUrl = `${base}?name=${encodeURIComponent(fileName)}`;

  const response = await fetchWithRetry(
    targetUrl,
    {
      method: "POST",
      headers: buildHeaders(token, userAgent, {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Length": String(bytes.length),
      }),
      body: bytes,
    },
    { label: `upload asset ${fileName}` }
  );

  return readJsonOrThrow(response, `Upload asset ${fileName}`);
}

export async function downloadArtifact(url, userAgent) {
  const response = await fetchWithRetry(
    url,
    {
      headers: {
        Accept: "application/octet-stream,*/*",
        "User-Agent": userAgent,
      },
      redirect: "follow",
    },
    { label: `download artifact ${url}` }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Download artifact failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, contentType };
}
