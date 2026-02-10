from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SyncConfigCreate(BaseModel):
    project_id: str
    agenta_app_id: str
    agenta_api_base: str
    agenta_api_key: str | None = None
    external_api_base: str
    external_pull_path: str
    external_push_path: str
    external_auth_headers: dict[str, str] = Field(default_factory=dict)
    environment_map: dict[str, str] = Field(default_factory=dict)
    default_variant_slug: str = "default"
    pull_transform_script: str | None = None
    push_transform_script: str | None = None


class SyncConfigUpdate(BaseModel):
    agenta_api_base: str | None = None
    agenta_api_key: str | None = None
    external_api_base: str | None = None
    external_pull_path: str | None = None
    external_push_path: str | None = None
    external_auth_headers: dict[str, str] | None = None
    environment_map: dict[str, str] | None = None
    default_variant_slug: str | None = None
    pull_transform_script: str | None = None
    push_transform_script: str | None = None


class SyncConfigResponse(BaseModel):
    id: int
    project_id: str
    agenta_app_id: str
    agenta_api_base: str
    external_api_base: str
    external_pull_path: str
    external_push_path: str
    external_auth_headers: dict[str, str]
    environment_map: dict[str, str]
    default_variant_slug: str
    pull_transform_script: str | None
    push_transform_script: str | None
    created_at: datetime
    updated_at: datetime


class PullSyncRequest(BaseModel):
    project_id: str
    agenta_app_id: str
    environment: str
    external_prompt_id: str | None = None
    variant_id: str | None = None
    force: bool = False


class PushSyncRequest(BaseModel):
    project_id: str
    agenta_app_id: str
    environment: str
    agenta_revision_id: str
    force: bool = False


class ResyncRequest(BaseModel):
    project_id: str
    agenta_app_id: str
    environment: str
    variant_id: str


class SyncActionResponse(BaseModel):
    status: str
    message: str
    job_id: int | None = None
    variant_id: str | None = None
    revision_id: str | None = None


class DeploymentStatusRow(BaseModel):
    variant_id: str
    variant_name: str
    environments: dict[str, dict[str, Any]]
    last_synced_at: datetime | None = None


class DeploymentStatusResponse(BaseModel):
    rows: list[DeploymentStatusRow]


class JobResponse(BaseModel):
    id: int
    direction: str
    environment: str
    variant_id: str | None
    revision_id: str | None
    source_hash: str | None
    target_hash: str | None
    status: str
    error_message: str | None
    created_at: datetime
