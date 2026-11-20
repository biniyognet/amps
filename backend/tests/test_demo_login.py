# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""One-click demo login: off unless AMPS_DEMO_USER is set; on, it signs in a
whole-department SUPERVISOR (never an admin) without any password."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import auth
from app.db import SessionLocal, init_db
from app.main import app
from app.models import User, UserRole


@pytest.fixture
def client():
    init_db()
    return TestClient(app)


def test_demo_off_by_default(client, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ON", True)
    monkeypatch.setattr(auth, "DEMO_USER", "")
    assert client.get("/api/auth/demo").json()["enabled"] is False
    assert client.post("/api/auth/demo").status_code == 404


def test_demo_login_is_a_supervisor(client, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ON", True)
    monkeypatch.setattr(auth, "DEMO_USER", "judge")
    auth.ensure_demo_user()
    auth.ensure_demo_user()  # idempotent
    assert client.get("/api/auth/demo").json()["enabled"] is True
    r = client.post("/api/auth/demo")
    assert r.status_code == 200
    assert r.json()["username"] == "judge" and r.json()["role"] == "supervisor"
    assert auth.COOKIE in r.cookies
    with SessionLocal() as db:
        users = db.scalars(select(User).where(User.username == "judge")).all()
        assert len(users) == 1 and users[0].role == UserRole.SUPERVISOR and users[0].line_id is None
