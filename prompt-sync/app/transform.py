import asyncio
import json
import os
import tempfile

from .config import settings


def normalize_payload(data: dict) -> dict:
    ignored = {"created_at", "updated_at", "id", "revision", "version"}
    return {k: v for k, v in data.items() if k not in ignored}


def stable_hash(data: dict) -> str:
    import hashlib

    body = json.dumps(data, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


async def run_transform_script(script: str | None, payload: dict, direction: str, environment: str) -> dict:
    if not script:
        return payload

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(script)
        script_path = f.name

    try:
        env = os.environ.copy()
        env["SYNC_DIRECTION"] = direction
        env["SYNC_ENVIRONMENT"] = environment
        env["PYTHONUNBUFFERED"] = "1"

        process = await asyncio.create_subprocess_exec(
            "python",
            script_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(input=json.dumps(payload).encode("utf-8")),
            timeout=settings.transform_timeout_seconds,
        )

        if process.returncode != 0:
            err = stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"transform script failed: {err[:1200]}")

        out = stdout.decode("utf-8", errors="replace").strip() or "{}"
        result = json.loads(out)
        if not isinstance(result, dict):
            raise RuntimeError("transform script output must be JSON object")
        return result
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
