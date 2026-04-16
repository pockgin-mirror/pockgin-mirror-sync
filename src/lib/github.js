import { fetchWithRetry, readJsonOrThrow, readTextOrThrow } from "./http.js";

const API_BASE = "https://api.github.com";

function buildHeaders(token, userAgent, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
    ...extra,
  };
}

function parseRepoName(repoName) {
  const cleaned = String(repoName || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return {
    owner: parts[0],
    repo: parts[1],
    fullName: `${parts[0]}/${parts[1]}`,
  };
}

export function buildRepoUrl(repoName) {
  const parsed = parseRepoName(repoName);
  return parsed ? `https://github.com/${parsed.fullName}` : null;
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

export async function updateRelease({ owner, repo, releaseId, token, userAgent, name, body }) {
  const path = `/repos/${owner}/${repo}/releases/${releaseId}`;
  const response = await githubJsonRequest({
    token,
    userAgent,
    method: "PATCH",
    path,
    body: {
      name,
      body,
      draft: false,
      prerelease: false,
      make_latest: "false",
    },
  });

  return readJsonOrThrow(response, `Update release ${releaseId}`);
}

export async function ensureRelease({ owner, repo, tag, token, userAgent, name, body }) {
  const existing = await getReleaseByTag({ owner, repo, tag, token, userAgent });
  if (existing) {
    const existingName = String(existing.name || "");
    const existingBody = String(existing.body || "");
    if (existingName !== String(name || "") || existingBody !== String(body || "")) {
      return updateRelease({
        owner,
        repo,
        releaseId: existing.id,
        token,
        userAgent,
        name,
        body,
      });
    }
    return existing;
  }
  return createRelease({ owner, repo, tag, token, userAgent, name, body });
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

export async function fetchRepoReadme({ repoName, token, userAgent }) {
  const parsed = parseRepoName(repoName);
  if (!parsed) return null;

  const url = `${API_BASE}/repos/${parsed.fullName}/readme`;
  const response = await fetchWithRetry(
    url,
    {
      headers: buildHeaders(token, userAgent, {
        Accept: "application/vnd.github.raw",
      }),
    },
    { label: `fetch readme ${parsed.fullName}` }
  );

  if (response.status === 404) {
    return null;
  }

  const body = await readTextOrThrow(response, `Fetch README ${parsed.fullName}`);
  return body.trim() ? body : null;
}
