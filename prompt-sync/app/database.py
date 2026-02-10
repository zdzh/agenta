from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db() -> None:
    # Create tables (no migrations)
    Base.metadata.create_all(bind=engine)

    # Lightweight SQLite migrations for existing local DBs
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as conn:
        try:
            cols = conn.exec_driver_sql("PRAGMA table_info(sync_configs)").fetchall()
        except Exception:
            return

        col_names = {row[1] for row in cols}  # row[1] = name
        if "environment" not in col_names:
            conn.exec_driver_sql(
                "ALTER TABLE sync_configs ADD COLUMN environment VARCHAR(64) NOT NULL DEFAULT 'development'"
            )

        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_configs_scope_env "
            "ON sync_configs(project_id, agenta_app_id, environment)"
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
