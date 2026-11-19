# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS over MCP: the six Ask AMPS tools, read-only, over streamable HTTP."""
import contextlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import mcp_server
from app.api import ai
from app.db import SessionLocal, init_db
from app.models import Location, LocationKind

H = {"accept": "application/json, text/event-stream", "content-type": "application/json"}


def _rpc(c, method, params=None, i=1, headers=H):
    return c.post("/mcp/", headers=headers,
                  json={"jsonrpc": "2.0", "id": i, "method": method, "params": params or {}})


def _client(monkeypatch, token=""):
    monkeypatch.setenv("AMPS_MCP_TOKEN", token)
    asgi, manager = mcp_server.http_app()

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        async with manager.run():
            yield

    app = FastAPI(lifespan=lifespan)
    app.mount("/mcp", asgi)
    return TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def site():
    init_db()
    with SessionLocal() as db:
        if not db.scalar(select(Location).where(Location.name == "MCP Test Site")):
            db.add(Location(name="MCP Test Site", kind=LocationKind.SITE))
            db.commit()


def test_tool_list_is_ask_amps_read_only():
    names = {t.name for t in mcp_server.tool_list()}
    assert names == set(ai.TOOLS) and len(names) == 6
    assert not any("apply" in n for n in names)
    hist = next(t for t in mcp_server.tool_list() if t.name == "asset_history")
    assert hist.input_schema["required"] == ["code"]


def test_run_tool_as_viewer():
    out = mcp_server.run_tool("list_sites", {})
    assert "MCP Test Site" in json.dumps(out, default=str)


def test_http_list_and_call(monkeypatch):
    with _client(monkeypatch) as c:
        r = _rpc(c, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "pytest", "version": "0"}})
        assert r.status_code == 200, r.text
        assert r.json()["result"]["serverInfo"]["name"] == "amps"
        tools = _rpc(c, "tools/list", i=2).json()["result"]["tools"]
        assert len(tools) == 6
        res = _rpc(c, "tools/call", {"name": "list_sites", "arguments": {}}, i=3).json()["result"]
        assert "MCP Test Site" in res["content"][0]["text"]


def test_http_token(monkeypatch):
    with _client(monkeypatch, token="s3cret") as c:
        assert _rpc(c, "tools/list").status_code == 401
        ok = _rpc(c, "tools/list", headers={**H, "authorization": "Bearer s3cret"})
        assert ok.status_code == 200
