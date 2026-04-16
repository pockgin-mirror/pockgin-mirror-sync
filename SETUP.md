## Setup Checklist

1. Create secret `MIRROR_GH_TOKEN` in `pockgin-mirror-sync`.
2. Grant token access to:
   - `pockgin-mirror-phars` (create/update releases and upload assets)
   - `pockgin-mirror-manifest` (push commits)
3. Trigger workflow `Sync Poggit Mirror` manually with batch size `25` for first run.
4. Verify output in `pockgin-mirror-manifest/public/data/*`.
5. Increase batch size gradually (100 -> 250) after first success.

## Metadata refresh

To rewrite release notes for already mirrored releases:

- Set `REFRESH_EXISTING_METADATA=true`
- Run workflow with a small `batch_size` (e.g. 25-100)

## Notes

- The pipeline never calls Poggit from client-side runtime.
- Public website should consume only static JSON generated in manifest repo.
- `PREFER_MIRROR_ONLY=true` ensures only mirrored downloads are exposed.
