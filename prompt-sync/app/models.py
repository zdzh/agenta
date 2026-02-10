from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class SyncConfig(Base):
    __tablename__ = "sync_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(128), index=True)
    agenta_app_id: Mapped[str] = mapped_column(String(128), index=True)
    agenta_api_base: Mapped[str] = mapped_column(String(1024))
    agenta_api_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    external_api_base: Mapped[str] = mapped_column(String(1024))
    external_pull_path: Mapped[str] = mapped_column(String(1024))
    external_push_path: Mapped[str] = mapped_column(String(1024))
    external_auth_headers_json: Mapped[str] = mapped_column(Text, default="{}")
    environment_map_json: Mapped[str] = mapped_column(Text, default="{}")
    default_variant_slug: Mapped[str] = mapped_column(String(256), default="default")
    pull_transform_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    push_transform_script: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_id: Mapped[int] = mapped_column(ForeignKey("sync_configs.id"), index=True)
    direction: Mapped[str] = mapped_column(String(64))
    environment: Mapped[str] = mapped_column(String(64))
    variant_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revision_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    target_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeploymentSnapshot(Base):
    __tablename__ = "deployment_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_id: Mapped[int] = mapped_column(ForeignKey("sync_configs.id"), index=True)
    variant_id: Mapped[str] = mapped_column(String(128), index=True)
    variant_name: Mapped[str] = mapped_column(String(256))
    environment: Mapped[str] = mapped_column(String(64), index=True)
    deployed_revision_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    deployed_revision_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
