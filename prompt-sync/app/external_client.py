from typing import Any

import httpx

from .config import settings


class ExternalClient:
    def __init__(self, *, base_url: str, auth_headers: dict[str, str] | None = None):
        self.base_url = base_url.rstrip("/")
        self.auth_headers = auth_headers or {}

    async def pull(
        self,
        *,
        path: str,
        environment: str,
        variant_id: str | None = None,
        external_prompt_id: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"environment": environment}
        if variant_id:
            params["variant_id"] = variant_id
        if external_prompt_id:
            params["prompt_id"] = external_prompt_id

        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(
                f"{self.base_url}{path}",
                headers=self.auth_headers,
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("external pull response must be JSON object")
            return payload

    async def push(
        self,
        *,
        path: str,
        payload: dict[str, Any],
        environment: str,
    ) -> dict[str, Any]:
        body = {"environment": environment, "payload": payload}
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}{path}",
                headers=self.auth_headers,
                json=body,
            )
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                return {"status": "ok"}
            return result
