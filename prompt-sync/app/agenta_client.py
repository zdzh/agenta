from typing import Any

import httpx

from .config import settings


class AgentaClient:
    def __init__(self, *, base_url: str, project_id: str, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.project_id = project_id
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"ApiKey {self.api_key}"
        return headers

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        q = {"project_id": self.project_id}
        if params:
            q.update(params)
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(
                f"{self.base_url}{path}",
                headers=self._headers(),
                params=q,
            )
            response.raise_for_status()
            return response.json()

    async def _post(self, path: str, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}{path}",
                headers=self._headers(),
                params={"project_id": self.project_id},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def list_variants(self, app_id: str) -> list[dict[str, Any]]:
        data = await self._get(f"/apps/{app_id}/variants")
        return data if isinstance(data, list) else []

    async def list_revisions(self, variant_id: str) -> list[dict[str, Any]]:
        data = await self._get(f"/variants/{variant_id}/revisions")
        return data if isinstance(data, list) else []

    async def list_environments(self, app_id: str) -> list[dict[str, Any]]:
        data = await self._get(f"/apps/{app_id}/environments")
        return data if isinstance(data, list) else []

    async def fetch_config(
        self,
        *,
        variant_ref: dict[str, Any] | None = None,
        environment_ref: dict[str, Any] | None = None,
        application_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if variant_ref:
            payload["variant_ref"] = variant_ref
        if environment_ref:
            payload["environment_ref"] = environment_ref
        if application_ref:
            payload["application_ref"] = application_ref
        return await self._post("/variants/configs/fetch", payload)

    async def commit_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return await self._post("/variants/configs/commit", {"config": config})

    async def deploy_config(
        self,
        *,
        variant_ref: dict[str, Any],
        environment_ref: dict[str, Any],
        application_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "variant_ref": variant_ref,
            "environment_ref": environment_ref,
        }
        if application_ref:
            payload["application_ref"] = application_ref
        return await self._post("/variants/configs/deploy", payload)

    async def add_config(self, *, variant_slug: str, app_id: str) -> dict[str, Any]:
        return await self._post(
            "/variants/configs/add",
            {
                "variant_ref": {"slug": variant_slug},
                "application_ref": {"id": app_id},
            },
        )
