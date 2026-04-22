import asyncio
import os
import time
from typing import Any, Awaitable, Callable

import aiohttp


def env_int(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


async def is_glm_endpoint_ready(base_url: str, session: aiohttp.ClientSession) -> bool:
    timeout = aiohttp.ClientTimeout(total=3)
    try:
        async with session.get(f"{base_url}/v1/models", timeout=timeout) as response:
            return response.status < 500
    except Exception:
        return False


async def wait_for_glm_endpoint_ready(
    base_url: str,
    session: aiohttp.ClientSession,
    readiness_check: Callable[[str, aiohttp.ClientSession], Awaitable[bool]] = is_glm_endpoint_ready,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
) -> bool:
    timeout_ms = max(0, env_int("GLM_READY_TIMEOUT_MS", 300000))
    interval_ms = max(100, env_int("GLM_READY_RETRY_INTERVAL_MS", 2000))
    deadline = time.monotonic() + (timeout_ms / 1000)
    while True:
        if await readiness_check(base_url, session):
            return True
        if timeout_ms == 0 or time.monotonic() >= deadline:
            return False
        await sleep(min(interval_ms / 1000, max(0.1, deadline - time.monotonic())))
