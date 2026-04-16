# pockgin-mirror-sync

Mirror Poggit release artifacts into `pockgin-mirror-phars` and generate static JSON manifests into `pockgin-mirror-manifest`.

## Requirements

- Node.js 18+
- A GitHub token with `repo` scope for org `pockgin-mirror`

## Local usage

```bash
npm run sync:poggit
```

Environment variables:

- `GITHUB_TOKEN` (required)
- `MIRROR_OWNER` (default: `pockgin-mirror`)
- `PHARS_REPO` (default: `pockgin-mirror-phars`)
- `MANIFEST_DIR` (default: `../pockgin-mirror-manifest`)
- `BATCH_SIZE` (default: `100`)
- `PREFER_MIRROR_ONLY` (default: `true`)

The script updates:

- `public/data/plugins.json`
- `public/data/plugins/{id}.json`
- `public/data/stats.json`
- `public/data/mirror-index.json`
- `public/data/sync-state.json`

inside `MANIFEST_DIR`.
