import { fetchRepoReadme } from "./github.js";
import { fetchWithRetry, readTextOrThrow } from "./http.js";

function normalizePluginKey(name) {
  return String(name || "").trim().toLowerCase();
}

function parseOwner(repoName) {
  const parts = String(repoName || "").trim().split("/");
  return parts.length >= 2 ? parts[0] : "Unknown";
}

async function fetchDescriptionHtml(url, userAgent) {
  const target = String(url || "").trim();
  if (!target) return null;

  const response = await fetchWithRetry(
    target,
    {
      headers: {
        Accept: "text/plain,text/html,*/*",
        "User-Agent": userAgent,
      },
      redirect: "follow",
    },
    { label: `fetch description ${target}` }
  );

  if (!response.ok) {
    return null;
  }

  const html = await readTextOrThrow(response, `Fetch description ${target}`);
  return html.trim() ? html : null;
}

function pickLatestByPlugin(releases) {
  const map = new Map();
  for (const rel of releases) {
    const key = normalizePluginKey(rel?.name);
    if (!key) continue;
    const current = map.get(key);
    if (!current || Number(rel.id || 0) > Number(current.id || 0)) {
      map.set(key, rel);
    }
  }
  return map;
}

export async function enrichPluginMetadata({ releases, mirrorIndex, config }) {
  const latest = pickLatestByPlugin(releases);
  if (!mirrorIndex.plugins || typeof mirrorIndex.plugins !== "object") {
    mirrorIndex.plugins = {};
  }

  let updated = 0;

  for (const [pluginKey, release] of latest.entries()) {
    const existing = mirrorIndex.plugins[pluginKey] || {};
    if (!config.refreshExistingMetadata && String(existing.readme_markdown || "").trim()) {
      continue;
    }

    const repoName = String(release?.repo_name || "").trim();
    let readme = null;
    let sourceUrl = null;

    if (repoName) {
      try {
        readme = await fetchRepoReadme({
          repoName,
          token: config.githubToken,
          userAgent: config.userAgent,
        });
        if (readme) {
          sourceUrl = `https://github.com/${repoName}`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[warn] README fetch failed for ${repoName}: ${message}`);
      }
    }

    if (!readme) {
      try {
        const html = await fetchDescriptionHtml(release?.description_url, config.userAgent);
        if (html) {
          readme = html;
          sourceUrl = String(release?.description_url || "").trim() || null;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[warn] description fetch failed for ${release?.name}: ${message}`);
      }
    }

    mirrorIndex.plugins[pluginKey] = {
      plugin_name: String(release?.name || existing.plugin_name || ""),
      repo_name: repoName || String(existing.repo_name || ""),
      author_owner: parseOwner(repoName || existing.repo_name),
      description: String(release?.description || existing.description || "").trim(),
      readme_markdown: readme || String(existing.readme_markdown || ""),
      readme_source_url: sourceUrl || existing.readme_source_url || null,
      updated_at: new Date().toISOString(),
    };

    updated += 1;
  }

  return { updated_plugins: updated, total_candidates: latest.size };
}
