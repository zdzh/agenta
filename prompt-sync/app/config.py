import os


class Settings:
    database_url: str = os.getenv("PROMPT_SYNC_DATABASE_URL", "sqlite:///./prompt_sync.db")
    request_timeout_seconds: float = float(os.getenv("PROMPT_SYNC_REQUEST_TIMEOUT_SECONDS", "20"))
    transform_timeout_seconds: float = float(
        os.getenv("PROMPT_SYNC_TRANSFORM_TIMEOUT_SECONDS", "10")
    )


settings = Settings()
