# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
"""/api/ws — the live event stream (event-driven UI, no polling).

Every connected screen hears writes, ampsTalk readings, auto-filed failures and
finished worker jobs the moment they happen, from any api replica or the worker
(Redis pub/sub behind app.events). Messages are {kind, data, ts}; the server
sends {kind: "ping"} every 25 s so proxies keep the socket open. Events carry
ids and counts only — the screen re-reads what it shows through the normal,
scoped (and cached) GET, so no data leaks past a user's line.
"""
import asyncio
import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import events

router = APIRouter()
PING_S = 25


@router.websocket("/ws")
async def live(ws: WebSocket):
    await ws.accept()
    await ws.send_text(json.dumps({"kind": "hello", "data": {"mode": "redis" if events.redis_client() else "local"}}))
    sub = events.subscribe()

    async def pump():
        async for msg in sub:
            await ws.send_text(msg)

    async def ping():
        while True:
            await asyncio.sleep(PING_S)
            await ws.send_text('{"kind":"ping"}')

    async def drain():
        while True:
            await ws.receive_text()           # client messages ignored; raises on disconnect

    tasks = [asyncio.create_task(t()) for t in (pump, ping, drain)]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        with contextlib.suppress(Exception):
            await sub.aclose()
