from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy.orm import Session

from .database import get_db, init_db
from .schemas import (
    DeploymentStatusResponse,
    JobResponse,
    PullSyncRequest,
    PushSyncRequest,
    ResyncRequest,
    SyncActionResponse,
    SyncConfigCreate,
    SyncConfigResponse,
    SyncConfigUpdate,
)
from .service import (
    create_config,
    delete_config,
    get_config,
    get_deployment_status,
    list_configs,
    list_jobs,
    pull_to_agenta,
    push_to_app,
    resync,
    update_config,
)

init_db()

app = FastAPI(title="Prompt Sync Service", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/configs", response_model=SyncConfigResponse)
def create_sync_config(payload: SyncConfigCreate, db: Session = Depends(get_db)):
    try:
        return create_config(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/v1/configs", response_model=list[SyncConfigResponse])
def list_sync_configs(db: Session = Depends(get_db)):
    return list_configs(db)


@app.get("/v1/configs/{config_id}", response_model=SyncConfigResponse)
def get_sync_config(config_id: int, db: Session = Depends(get_db)):
    try:
        return get_config(db, config_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.put("/v1/configs/{config_id}", response_model=SyncConfigResponse)
def update_sync_config(config_id: int, payload: SyncConfigUpdate, db: Session = Depends(get_db)):
    try:
        return update_config(db, config_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.delete("/v1/configs/{config_id}")
def delete_sync_config(config_id: int, db: Session = Depends(get_db)):
    try:
        delete_config(db, config_id)
        return {"status": "success"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/v1/sync/pull", response_model=SyncActionResponse)
async def sync_pull(payload: PullSyncRequest, db: Session = Depends(get_db)):
    try:
        result = await pull_to_agenta(
            db,
            project_id=payload.project_id,
            agenta_app_id=payload.agenta_app_id,
            environment=payload.environment,
            external_prompt_id=payload.external_prompt_id,
            variant_id=payload.variant_id,
            force=payload.force,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/v1/sync/push", response_model=SyncActionResponse)
async def sync_push(payload: PushSyncRequest, db: Session = Depends(get_db)):
    try:
        result = await push_to_app(
            db,
            project_id=payload.project_id,
            agenta_app_id=payload.agenta_app_id,
            environment=payload.environment,
            agenta_revision_id=payload.agenta_revision_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/v1/sync/resync", response_model=SyncActionResponse)
async def sync_resync(payload: ResyncRequest, db: Session = Depends(get_db)):
    try:
        result = await resync(
            db,
            project_id=payload.project_id,
            agenta_app_id=payload.agenta_app_id,
            environment=payload.environment,
            variant_id=payload.variant_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/v1/deployments/status", response_model=DeploymentStatusResponse)
async def deployment_status(
    project_id: str = Query(...),
    agenta_app_id: str = Query(...),
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
):
    try:
        rows = await get_deployment_status(
            db,
            project_id=project_id,
            agenta_app_id=agenta_app_id,
            environment=environment,
        )
        return {"rows": rows}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/v1/jobs", response_model=list[JobResponse])
def jobs(
    project_id: str = Query(...),
    agenta_app_id: str = Query(...),
    environment: str | None = Query(None),
    db: Session = Depends(get_db),
):
    try:
        return list_jobs(db, project_id=project_id, agenta_app_id=agenta_app_id, environment=environment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
