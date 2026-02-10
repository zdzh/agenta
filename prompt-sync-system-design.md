# Prompt Sync System Design

## Goal

Implement a standalone sync service that bi-directionally synchronizes prompt/config data between an external application and Agenta, with minimal Agenta intrusion.

## Constraints Mapped

1. New service only: implement `prompt-sync` as an independent service.
2. Deploy by docker compose: integrate into `hosting/docker-compose/oss/docker-compose.gh.yml`.
3. Do not modify existing Agenta service code (backend).
4. Do not modify existing Agenta databases/schemas.
5. Minimize Agenta intrusion: small frontend extension only.

## Architecture

### Components

- `prompt-sync` service (new): FastAPI app, independent persistence, orchestration of sync jobs.
- Agenta API (existing): source/target API via stable legacy endpoints.
- External App API (existing): source/target API configured per app/environment.
- Agenta frontend (small extension): add a lightweight sync view under Registry.

### Data Persistence

`prompt-sync` uses its own SQLite database (`/data/prompt_sync.db`) with dedicated tables:

- `sync_configs`: connection/mapping/settings per Agenta app+project.
- `sync_jobs`: audit records for sync direction, status, payload hash, error.
- `deployment_snapshots`: cached deployment status for list/re-sync UX.

No change to Agenta DB.

### Integration Boundaries

- Agenta write/read through HTTP APIs only:
  - fetch config: `POST /variants/configs/fetch`
  - commit config: `POST /variants/configs/commit`
  - deploy config: `POST /variants/configs/deploy`
  - list variants/revisions: `GET /apps/{app_id}/variants`, `GET /variants/{variant_id}/revisions`
  - list env deployment: `GET /apps/{app_id}/environments`
- External app integration by configurable pull/push endpoints.

### Conversion Strategy

- Built-in default mapping for Agenta ConfigDTO <-> external payload.
- Optional Python transform scripts for inbound/outbound payload conversion.
- Script execution contract:
  - Input: JSON from stdin.
  - Output: JSON to stdout.
  - Failure: non-zero exit or invalid JSON returns sync failure.

### Consistency Rule (App -> Agenta)

On inbound sync:

1. Pull external payload.
2. Transform to Agenta params.
3. Fetch current Agenta config for target variant/environment.
4. Normalize and hash both payloads.
5. If hash equal: no-op.
6. If hash differs: commit new Agenta revision.

This guarantees mismatch creates a new version and avoids silent overwrite.

### Environment Mapping

Each sync config stores explicit environment map, e.g.:

```json
{
  "development": "dev",
  "staging": "test",
  "production": "prod"
}
```

Used for both pull and push directions.

### Frontend Extension

- Reuse existing Registry page (`web/oss/src/components/VariantsComponents/index.tsx`) by adding a `Sync` tab.
- New sync table component calls `prompt-sync` API to:
  - list each variant current deployed revision across environments
  - trigger one-click re-sync per row

### Deployment

- Add `prompt-sync` service to OSS GH compose:
  - build from local `prompt-sync/Dockerfile`
  - same compose network
  - Traefik route prefix `/sync/`
  - persistent volume `prompt-sync-data`
