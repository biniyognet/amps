# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS over MCP — the Ask AMPS read-only tools for any agent.

Two transports, one tool list (app.api.ai.TOOLS):
  stdio   python -m app.mcp_server              (local, e.g. Antigravity on the laptop)
  HTTP    mounted at /mcp by app.main when AMPS_MCP_HTTP=1 (hosted)

Every tool is read-only and runs as the anonymous viewer, so an agent sees what
a walk-up QR visitor sees. apply_plan (the one AI write) is never exposed here.
Optional bearer token for the hosted endpoint: AMPS_MCP_TOKEN.
"""
import hmac
import json
import os

import anyio
from mcp import types
from mcp.server.lowlevel import Server

from app.api import ai
from app.api.auth import _ANON_VIEWER
from app.db import SessionLocal


def tool_list():
    return [types.Tool(name=name, description=desc,
                       inputSchema={"type": "object", "properties": props, "required": req})
            for name, (_fn, desc, props, req) in ai.TOOLS.items()]


def run_tool(name, arguments):
    """Sync: one DB session per call, read-only viewer scope."""
    with SessionLocal() as db:
        return ai._run_tool(name, arguments or {}, db, _ANON_VIEWER)


async def _list_tools(_ctx, _params):
    return types.ListToolsResult(tools=tool_list())


async def _call_tool(_ctx, params):
    out = await anyio.to_thread.run_sync(run_tool, params.name, params.arguments)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(out, default=str, ensure_ascii=False))],
        isError=isinstance(out, dict) and "error" in out)


server = Server("amps", version="0.3.0", on_list_tools=_list_tools, on_call_tool=_call_tool,
                instructions="Read-only AMPS maintenance data (demo estate). Cite asset codes.")


# --- hosted (streamable HTTP) -------------------------------------------------

def http_app():
    """ASGI app + session manager for /mcp. Caller enters manager.run() in lifespan."""
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

    manager = StreamableHTTPSessionManager(app=server, stateless=True, json_response=True)
    token = os.environ.get("AMPS_MCP_TOKEN", "")

    async def asgi(scope, receive, send):
        if token and scope["type"] == "http":
            got = dict(scope.get("headers") or []).get(b"authorization", b"").decode()
            if not hmac.compare_digest(got, f"Bearer {token}"):
                body = b'{"error":"unauthorized"}'
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": body})
                return
        await manager.handle_request(scope, receive, send)

    return asgi, manager


# --- local (stdio) ------------------------------------------------------------

async def _stdio():
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    anyio.run(_stdio)
