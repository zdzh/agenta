import json
from datetime import datetime
from typing import Any

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from .agenta_client import AgentaClient
from .external_client import ExternalClient
from .models import DeploymentSnapshot, SyncConfig, SyncJob
from .schemas import SyncConfigCreate, SyncConfigUpdate
from .transform import normalize_payload, run_transform_script, stable_hash


def _config_to_dict(cfg: SyncConfig) -> dict[str, Any]:
    return {
        "id": cfg.id,
        "project_id": cfg.project_id,
        "agenta_app_id": cfg.agenta_app_id,
        "agenta_api_base": cfg.agenta_api_base,
        "external_api_base": cfg.external_api_base,
        "external_pull_path": cfg.external_pull_path,
        "external_push_path": cfg.external_push_path,
        "external_auth_headers": json.loads(cfg.external_auth_headers_json or "{}"),
        "environment_map": json.loads(cfg.environment_map_json or "{}"),
        "default_variant_slug": cfg.default_variant_slug,
        "pull_transform_script": cfg.pull_transform_script,
        "push_transform_script": cfg.push_transform_script,
        "created_at": cfg.created_at,
        "updated_at": cfg.updated_at,
    }


def get_config_by_scope(db: Session, *, project_id: str, agenta_app_id: str) -> SyncConfig:
    stmt = select(SyncConfig).where(
        SyncConfig.project_id == project_id,
        SyncConfig.agenta_app_id == agenta_app_id,
    )
    config = db.execute(stmt).scalar_one_or_none()
    if config is None:
        raise ValueError("sync config not found for this project/app")
    return config


def create_config(db: Session, payload: SyncConfigCreate) -> dict[str, Any]:
    existing = db.execute(
        select(SyncConfig).where(
            SyncConfig.project_id == payload.project_id,
            SyncConfig.agenta_app_id == payload.agenta_app_id,
        )
    ).scalar_one_or_none()
    if existing:
        raise ValueError("sync config already exists for this project/app")

    config = SyncConfig(
        project_id=payload.project_id,
        agenta_app_id=payload.agenta_app_id,
        agenta_api_base=payload.agenta_api_base.rstrip("/"),
        agenta_api_key=payload.agenta_api_key,
        external_api_base=payload.external_api_base.rstrip("/"),
        external_pull_path=payload.external_pull_path,
        external_push_path=payload.external_push_path,
        external_auth_headers_json=json.dumps(payload.external_auth_headers, ensure_ascii=True),
        environment_map_json=json.dumps(payload.environment_map, ensure_ascii=True),
        default_variant_slug=payload.default_variant_slug,
        pull_transform_script=payload.pull_transform_script,
        push_transform_script=payload.push_transform_script,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return _config_to_dict(config)


def update_config(db: Session, config_id: int, payload: SyncConfigUpdate) -> dict[str, Any]:
    config = db.get(SyncConfig, config_id)
    if config is None:
        raise ValueError("sync config not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "external_auth_headers":
            config.external_auth_headers_json = json.dumps(value or {}, ensure_ascii=True)
        elif key == "environment_map":
            config.environment_map_json = json.dumps(value or {}, ensure_ascii=True)
        elif key in {"agenta_api_base", "external_api_base"} and isinstance(value, str):
            setattr(config, key, value.rstrip("/"))
        else:
            setattr(config, key, value)

    config.updated_at = datetime.utcnow()
    db.add(config)
    db.commit()
    db.refresh(config)
    return _config_to_dict(config)


def list_configs(db: Session) -> list[dict[str, Any]]:
    stmt = select(SyncConfig).order_by(desc(SyncConfig.updated_at))
    return [_config_to_dict(row) for row in db.execute(stmt).scalars().all()]


def get_config(db: Session, config_id: int) -> dict[str, Any]:
    config = db.get(SyncConfig, config_id)
    if config is None:
        raise ValueError("sync config not found")
    return _config_to_dict(config)


def _map_environment(config: SyncConfig, environment: str) -> str:
    env_map = json.loads(config.environment_map_json or "{}")
    return env_map.get(environment, environment)


def _make_job(
    db: Session,
    *,
    config_id: int,
    direction: str,
    environment: str,
    variant_id: str | None = None,
    revision_id: str | None = None,
    source_hash: str | None = None,
    target_hash: str | None = None,
    status: str,
    error_message: str | None = None,
) -> SyncJob:
    job = SyncJob(
        config_id=config_id,
        direction=direction,
        environment=environment,
        variant_id=variant_id,
        revision_id=revision_id,
        source_hash=source_hash,
        target_hash=target_hash,
        status=status,
        error_message=error_message,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


async def _ensure_variant(
    *,
    agenta: AgentaClient,
    app_id: str,
    preferred_variant_id: str | None,
    preferred_variant_slug: str,
) -> str:
    if preferred_variant_id:
        return preferred_variant_id

    variants = await agenta.list_variants(app_id)
    for item in variants:
        slug = str(item.get("base_name") or item.get("variant_name") or "")
        if slug == preferred_variant_slug:
            vid = item.get("variant_id")
            if isinstance(vid, str) and vid:
                return vid

    created = await agenta.add_config(variant_slug=preferred_variant_slug, app_id=app_id)
    variant_ref = created.get("variant_ref") if isinstance(created, dict) else None
    created_id = variant_ref.get("id") if isinstance(variant_ref, dict) else None
    if not isinstance(created_id, str) or not created_id:
        raise RuntimeError("failed to create/fetch target variant")

    revisions = await agenta.list_revisions(created_id)
    if revisions:
        return created_id
    return created_id


async def pull_to_agenta(
    db: Session,
    *,
    project_id: str,
    agenta_app_id: str,
    environment: str,
    external_prompt_id: str | None,
    variant_id: str | None,
    force: bool,
) -> dict[str, Any]:
    config = get_config_by_scope(db, project_id=project_id, agenta_app_id=agenta_app_id)
    mapped_env = _map_environment(config, environment)

    agenta = AgentaClient(
        base_url=config.agenta_api_base,
        project_id=project_id,
        api_key=config.agenta_api_key,
    )
    external = ExternalClient(
        base_url=config.external_api_base,
        auth_headers=json.loads(config.external_auth_headers_json or "{}"),
    )

    incoming_raw = await external.pull(
        path=config.external_pull_path,
        environment=mapped_env,
        variant_id=variant_id,
        external_prompt_id=external_prompt_id,
    )
    incoming = await run_transform_script(
        config.pull_transform_script,
        incoming_raw,
        direction="pull_to_agenta",
        environment=mapped_env,
    )

    if "params" not in incoming:
        incoming = {"params": incoming}

    resolved_variant_id = await _ensure_variant(
        agenta=agenta,
        app_id=agenta_app_id,
        preferred_variant_id=variant_id,
        preferred_variant_slug=incoming.get("variant_slug") or config.default_variant_slug,
    )

    current = await agenta.fetch_config(
        variant_ref={"id": resolved_variant_id},
        application_ref={"id": agenta_app_id},
    )
    current_params = current.get("params") if isinstance(current, dict) else {}
    if not isinstance(current_params, dict):
        current_params = {}

    incoming_params = incoming.get("params", {})
    if not isinstance(incoming_params, dict):
        raise RuntimeError("transformed pull payload.params must be object")

    source_hash = stable_hash(normalize_payload(incoming_params))
    target_hash = stable_hash(normalize_payload(current_params))

    if not force and source_hash == target_hash:
        job = _make_job(
            db,
            config_id=config.id,
            direction="pull_to_agenta",
            environment=environment,
            variant_id=resolved_variant_id,
            status="noop",
            source_hash=source_hash,
            target_hash=target_hash,
        )
        return {
            "status": "noop",
            "message": "no changes detected",
            "job_id": job.id,
            "variant_id": resolved_variant_id,
        }

    committed = await agenta.commit_config(
        {
            "params": incoming_params,
            "variant_ref": {
                "id": resolved_variant_id,
                "commit_message": incoming.get("commit_message")
                or f"sync pull from external ({mapped_env})",
            },
            "application_ref": {"id": agenta_app_id},
        }
    )

    committed_variant_ref = committed.get("variant_ref") if isinstance(committed, dict) else {}
    committed_revision_id = committed_variant_ref.get("id") if isinstance(committed_variant_ref, dict) else None
    if not committed_revision_id:
        revisions = await agenta.list_revisions(resolved_variant_id)
        committed_revision_id = revisions[0].get("id") if revisions else None

    await agenta.deploy_config(
        variant_ref={"id": committed_revision_id or resolved_variant_id},
        environment_ref={"slug": environment, "commit_message": "sync deploy"},
        application_ref={"id": agenta_app_id},
    )

    job = _make_job(
        db,
        config_id=config.id,
        direction="pull_to_agenta",
        environment=environment,
        variant_id=resolved_variant_id,
        revision_id=committed_revision_id,
        source_hash=source_hash,
        target_hash=target_hash,
        status="success",
    )

    return {
        "status": "success",
        "message": "pulled and committed to agenta",
        "job_id": job.id,
        "variant_id": resolved_variant_id,
        "revision_id": committed_revision_id,
    }


async def push_to_app(
    db: Session,
    *,
    project_id: str,
    agenta_app_id: str,
    environment: str,
    agenta_revision_id: str,
) -> dict[str, Any]:
    config = get_config_by_scope(db, project_id=project_id, agenta_app_id=agenta_app_id)
    mapped_env = _map_environment(config, environment)

    agenta = AgentaClient(
        base_url=config.agenta_api_base,
        project_id=project_id,
        api_key=config.agenta_api_key,
    )
    external = ExternalClient(
        base_url=config.external_api_base,
        auth_headers=json.loads(config.external_auth_headers_json or "{}"),
    )

    config_data = await agenta.fetch_config(
        variant_ref={"id": agenta_revision_id},
        application_ref={"id": agenta_app_id},
    )
    if not isinstance(config_data, dict):
        raise RuntimeError("invalid agenta config payload")

    params = config_data.get("params", {})
    if not isinstance(params, dict):
        params = {}

    outgoing = await run_transform_script(
        config.push_transform_script,
        {"params": params, "agenta_revision_id": agenta_revision_id},
        direction="push_to_app",
        environment=mapped_env,
    )

    result = await external.push(
        path=config.external_push_path,
        payload=outgoing,
        environment=mapped_env,
    )

    payload_hash = stable_hash(normalize_payload(outgoing))
    job = _make_job(
        db,
        config_id=config.id,
        direction="push_to_app",
        environment=environment,
        revision_id=agenta_revision_id,
        source_hash=payload_hash,
        status="success",
    )

    return {
        "status": "success",
        "message": "pushed to external app",
        "job_id": job.id,
        "revision_id": agenta_revision_id,
        "external_result": result,
    }


async def get_deployment_status(
    db: Session,
    *,
    project_id: str,
    agenta_app_id: str,
) -> list[dict[str, Any]]:
    config = get_config_by_scope(db, project_id=project_id, agenta_app_id=agenta_app_id)
    agenta = AgentaClient(
        base_url=config.agenta_api_base,
        project_id=project_id,
        api_key=config.agenta_api_key,
    )

    variants = await agenta.list_variants(agenta_app_id)
    environments = await agenta.list_environments(agenta_app_id)

    rev_version_by_id: dict[str, int] = {}
    for variant in variants:
        variant_id = variant.get("variant_id")
        if not isinstance(variant_id, str):
            continue
        revisions = await agenta.list_revisions(variant_id)
        for rev in revisions:
            rid = rev.get("id")
            version = rev.get("revision")
            if isinstance(rid, str) and isinstance(version, int):
                rev_version_by_id[rid] = version

    rows: list[dict[str, Any]] = []
    for variant in variants:
        variant_id = str(variant.get("variant_id") or "")
        if not variant_id:
            continue
        variant_name = str(variant.get("variant_name") or variant.get("config_name") or variant_id)
        env_map: dict[str, dict[str, Any]] = {}

        for env in environments:
            env_name = str(env.get("name") or "")
            deployed_variant_id = str(env.get("deployed_app_variant_id") or "")
            deployed_revision_id = str(env.get("deployed_app_variant_revision_id") or "")

            if deployed_variant_id != variant_id:
                continue

            version = rev_version_by_id.get(deployed_revision_id)
            env_map[env_name] = {
                "revision_id": deployed_revision_id,
                "revision_version": version,
            }

        rows.append(
            {
                "variant_id": variant_id,
                "variant_name": variant_name,
                "environments": env_map,
            }
        )

    db.execute(delete(DeploymentSnapshot).where(DeploymentSnapshot.config_id == config.id))
    now = datetime.utcnow()
    for row in rows:
        variant_id = row["variant_id"]
        variant_name = row["variant_name"]
        for env_name, env_data in row["environments"].items():
            db.add(
                DeploymentSnapshot(
                    config_id=config.id,
                    variant_id=variant_id,
                    variant_name=variant_name,
                    environment=env_name,
                    deployed_revision_id=env_data.get("revision_id"),
                    deployed_revision_version=env_data.get("revision_version"),
                    last_synced_at=now,
                )
            )
    db.commit()

    latest_by_variant: dict[str, datetime] = {}
    snapshots = db.execute(
        select(DeploymentSnapshot).where(DeploymentSnapshot.config_id == config.id)
    ).scalars()
    for snap in snapshots:
        prev = latest_by_variant.get(snap.variant_id)
        if prev is None or snap.last_synced_at > prev:
            latest_by_variant[snap.variant_id] = snap.last_synced_at

    for row in rows:
        row["last_synced_at"] = latest_by_variant.get(row["variant_id"])

    return rows


async def resync(
    db: Session,
    *,
    project_id: str,
    agenta_app_id: str,
    environment: str,
    variant_id: str,
) -> dict[str, Any]:
    return await pull_to_agenta(
        db,
        project_id=project_id,
        agenta_app_id=agenta_app_id,
        environment=environment,
        external_prompt_id=None,
        variant_id=variant_id,
        force=True,
    )


def list_jobs(
    db: Session,
    *,
    project_id: str,
    agenta_app_id: str,
) -> list[dict[str, Any]]:
    config = get_config_by_scope(db, project_id=project_id, agenta_app_id=agenta_app_id)
    stmt = select(SyncJob).where(SyncJob.config_id == config.id).order_by(desc(SyncJob.created_at))
    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": row.id,
            "direction": row.direction,
            "environment": row.environment,
            "variant_id": row.variant_id,
            "revision_id": row.revision_id,
            "source_hash": row.source_hash,
            "target_hash": row.target_hash,
            "status": row.status,
            "error_message": row.error_message,
            "created_at": row.created_at,
        }
        for row in rows
    ]
