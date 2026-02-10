# Prompt Sync Functional Design

## 1. Core Capabilities

1. External App -> Agenta sync (`pull_to_agenta`).
2. Agenta -> External App sync (`push_to_app`).
3. Environment-aware mapping (dev/test/prod).
4. Data consistency comparison before Agenta write.
5. Deployment/version list view + one-click re-sync.
6. Python-script transform hook for both directions.

## 2. API Design (`/sync/v1`)

### 2.1 Sync Config

- `POST /configs`
  - Create config per `{project_id, agenta_app_id}`.
- `GET /configs/{config_id}`
  - Read config.
- `PUT /configs/{config_id}`
  - Update endpoints, mapping, scripts, auth.
- `GET /configs`
  - List configs.

#### Sync Config fields

- `project_id: string`
- `agenta_app_id: string`
- `agenta_api_base: string`
- `agenta_api_key: string | null`
- `external_api_base: string`
- `external_pull_path: string`
- `external_push_path: string`
- `external_auth_headers: object`
- `environment_map: object`
- `default_variant_slug: string`
- `pull_transform_script: string | null`
- `push_transform_script: string | null`

### 2.2 Sync Execution

- `POST /sync/pull`
  - body: `{config_id, environment, external_prompt_id?, force?}`
  - behavior: pull external -> transform -> compare -> commit if changed.
- `POST /sync/push`
  - body: `{config_id, environment, agenta_revision_id, force?}`
  - behavior: fetch agenta -> transform -> push external.
- `POST /sync/resync`
  - body: `{config_id, variant_id, environment}`
  - behavior: convenience action for one-click re-sync.

### 2.3 Visibility / Listing

- `GET /deployments/status`
  - query: `config_id`
  - returns all variants with deployed revision per environment.
- `GET /jobs`
  - query: `config_id`, optional filters.
  - returns sync history.

## 3. Data Model

### 3.1 `sync_configs`

- `id` (PK)
- `project_id`
- `agenta_app_id`
- `agenta_api_base`
- `agenta_api_key` (nullable)
- `external_api_base`
- `external_pull_path`
- `external_push_path`
- `external_auth_headers_json`
- `environment_map_json`
- `default_variant_slug`
- `pull_transform_script` (TEXT nullable)
- `push_transform_script` (TEXT nullable)
- `created_at`, `updated_at`

### 3.2 `sync_jobs`

- `id` (PK)
- `config_id` (FK)
- `direction` (`pull_to_agenta` | `push_to_app` | `resync`)
- `environment`
- `variant_id` (nullable)
- `revision_id` (nullable)
- `source_hash` (nullable)
- `target_hash` (nullable)
- `status` (`success` | `failed` | `noop`)
- `error_message` (nullable)
- `created_at`

### 3.3 `deployment_snapshots`

- `id` (PK)
- `config_id` (FK)
- `variant_id`
- `variant_name`
- `environment`
- `deployed_revision_id`
- `deployed_revision_version` (nullable)
- `last_synced_at`

## 4. Transform Script Contract

### Input/Output

- Input: JSON from stdin.
- Output: JSON to stdout.
- Timeout: 10 seconds (default).

### Execution context

- `PYTHONUNBUFFERED=1`
- `SYNC_DIRECTION=pull_to_agenta | push_to_app`
- `SYNC_ENVIRONMENT=<mapped env>`

## 5. Consistency Comparison

### Normalization steps

1. Remove transient fields (`created_at`, `updated_at`, ids not relevant).
2. Stable key ordering.
3. JSON canonical dump.
4. SHA256 hash.

### Decision

- `hash(source) == hash(target)` -> `noop`
- else -> commit new Agenta revision.

## 6. UI (Minimal Intrusion)

- Extend existing Registry tabs with `Sync` tab.
- New table columns:
  - Variant
  - Development revision
  - Staging/Test revision
  - Production revision
  - Last sync time
  - Action: `Re-sync`
- Reuse existing AntD table/action style.

## 7. Error Handling

- Transform failure: job `failed`, preserve stderr snippet.
- Agenta API error: job `failed`, include status code/message.
- External API error: job `failed`, include response body snippet.
- Partial list failures: return rows with `error` field, keep endpoint available.
