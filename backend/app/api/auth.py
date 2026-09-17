"""Login, sessions and user administration — line-scoped access.

Auth is opt-in: set AMPS_AUTH=1 to require login (an operational deployment).
Default off keeps the public demo, local dev and CI open — requests then act
as a virtual administrator and nothing is filtered.

Design: standard library only. Passwords are PBKDF2-SHA256; the session is a
signed, expiring token in an HttpOnly cookie (no server-side session store —
restarts keep sessions valid when AMPS_SECRET is set).

Every user is either scoped to one SITE location ("their line") or unscoped
(NULL line = whole department: HQ view, admins). Scoped users read and write
only within their line — enforced here and in each router, not in the UI.
"""
import base64
import hashlib
import hmac
import os
import secrets
import time
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, audit, get_db
from app.models import Location, LocationKind, User, UserRole

AUTH_ON = os.environ.get("AMPS_AUTH", "0") == "1"
_SECRET = os.environ.get("AMPS_SECRET") or secrets.token_hex(32)
SESSION_HOURS = int(os.environ.get("AMPS_SESSION_HOURS", "72"))
COOKIE = "amps_session"

router = APIRouter()


# ---- passwords & tokens -----------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, expected = stored.split("$", 1)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return hmac.compare_digest(digest.hex(), expected)


def _sign(payload: str) -> str:
    return hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(username: str) -> str:
    payload = f"{username}|{int(time.time()) + SESSION_HOURS * 3600}"
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + _sign(payload)


def parse_token(token: str | None) -> str | None:
    """Return the username for a valid, unexpired token; None otherwise."""
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    try:
        payload = base64.urlsafe_b64decode(body.encode()).decode()
    except Exception:
        return None
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    username, _, exp = payload.partition("|")
    if not exp.isdigit() or int(exp) < time.time():
        return None
    return username


# ---- bootstrap --------------------------------------------------------------

def ensure_admin():
    """First boot of an authenticated deployment: create the administrator
    from AMPS_ADMIN_USER / AMPS_ADMIN_PASSWORD (default admin/admin — change it)."""
    if not AUTH_ON:
        return
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.role == UserRole.ADMIN)):
            return
        username = os.environ.get("AMPS_ADMIN_USER", "admin")
        password = os.environ.get("AMPS_ADMIN_PASSWORD", "admin")
        db.add(User(username=username, full_name="Administrator",
                    role=UserRole.ADMIN, password_hash=hash_password(password)))
        db.commit()
        if password == "admin":
            print("AMPS: created default admin/admin — set AMPS_ADMIN_PASSWORD and change it.")


# ---- request identity -------------------------------------------------------

_OPEN_USER = SimpleNamespace(  # auth disabled: everything acts as an unscoped admin
    id=None, username="open", full_name="Open access",
    role=UserRole.ADMIN, line_id=None, line=None,
)


_ANON_VIEWER = SimpleNamespace(  # no session: read-only, sees every line
    id=None, username="viewer", full_name="Viewer",
    role=UserRole.VIEWER, line_id=None, line=None,
)


def current_user(request: Request, db: Session = Depends(get_db)):
    """Write-path identity: a real session, or 401. Open deployments pass."""
    if not AUTH_ON:
        return _OPEN_USER
    username = parse_token(request.cookies.get(COOKIE))
    if not username:
        raise HTTPException(401, "login required")
    user = db.scalar(select(User).where(User.username == username))
    if not user or user.password_hash is None:
        raise HTTPException(401, "login required")
    return user


def optional_user(request: Request, db: Session = Depends(get_db)):
    """Read-path identity: the QR-scan / walk-up surface. No session = an
    unscoped read-only viewer (asset lists of every line are public within
    the deployment's network); a session = that user's line focus."""
    if not AUTH_ON:
        return _OPEN_USER
    username = parse_token(request.cookies.get(COOKIE))
    if username:
        user = db.scalar(select(User).where(User.username == username))
        if user and user.password_hash is not None:
            return user
    return _ANON_VIEWER


def is_anonymous(user) -> bool:
    """True when this is the walk-up viewer with no session on an authenticated
    deployment — used to keep single-asset QR reads open while requiring a
    login for bulk reads. Auth-off deployments (id None but not AUTH_ON) are
    never 'anonymous' here; they run fully open by design."""
    return AUTH_ON and getattr(user, "id", None) is None


def require_admin(user=Depends(current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, "administrator only")
    return user


def current_writer(user=Depends(current_user)):
    """A signed-in user who may WRITE. A VIEWER account (e.g. a line-wide
    read-only 'blue' login) can browse everything but never edit."""
    if user.role == UserRole.VIEWER:
        raise HTTPException(403, "this account is view-only")
    return user


def current_approver(user=Depends(current_user)):
    """An In-charge (IC) who may APPROVE checksheet formats — INCHARGE or ADMIN."""
    if user.role not in (UserRole.INCHARGE, UserRole.ADMIN):
        raise HTTPException(403, "checksheet approval needs an in-charge or admin account")
    return user


def scope_location_ids(db: Session, user) -> set[int] | None:
    """Location ids the user may touch. None = unrestricted (whole department)."""
    if user.line_id is None:
        return None
    site = db.get(Location, user.line_id)
    if not site:
        return set()
    return {site.id, *(child.id for child in site.children)}


# ---- endpoints --------------------------------------------------------------

class LoginIn(BaseModel):
    username: str
    password: str


class MeOut(BaseModel):
    username: str
    full_name: str
    role: str
    line: str | None
    depot: str | None = None
    auth_enabled: bool


def _me(user) -> MeOut:
    line = user.line.name if getattr(user, "line", None) else None
    return MeOut(username=user.username, full_name=user.full_name,
                 role=user.role.value, line=line,
                 depot=getattr(user, "depot", None), auth_enabled=AUTH_ON)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    if not AUTH_ON:
        return _me(_OPEN_USER)
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "wrong username or password")
    response.set_cookie(COOKIE, make_token(user.username), httponly=True,
                        samesite="lax", max_age=SESSION_HOURS * 3600, path="/")
    audit(db, "user", user.id, "login", actor=user.username)
    db.commit()
    return _me(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=MeOut)
def me(user=Depends(optional_user)):
    """Who am I — anonymous visitors get the read-only 'viewer' identity."""
    return _me(user)


class UserIn(BaseModel):
    username: str
    full_name: str
    password: str
    role: str = "technician"  # admin / supervisor / technician / viewer
    line: str | None = None   # site name, e.g. "Green Line"; empty = whole department


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    line: str | None


@router.get("/users", response_model=list[UserOut], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return [UserOut(id=u.id, username=u.username, full_name=u.full_name,
                    role=u.role.value, line=u.line.name if u.line else None)
            for u in db.scalars(select(User)).all()]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserIn, admin=Depends(require_admin), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == body.username.strip())):
        raise HTTPException(409, "username already exists")
    line = None
    if body.line:
        line = db.scalar(select(Location).where(Location.name == body.line.strip()))
        if not line:
            line = Location(name=body.line.strip(), kind=LocationKind.SITE)
            db.add(line)
            db.flush()
    user = User(username=body.username.strip(), full_name=body.full_name.strip(),
                role=UserRole(body.role), password_hash=hash_password(body.password),
                line_id=line.id if line else None)
    db.add(user)
    db.flush()
    audit(db, "user", user.id, "created", detail=f"role={body.role} line={body.line}",
          actor=admin.username)
    db.commit()
    db.refresh(user)
    return UserOut(id=user.id, username=user.username, full_name=user.full_name,
                   role=user.role.value, line=user.line.name if user.line else None)


# ---- password change / reset ------------------------------------------------

class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class PasswordReset(BaseModel):
    new_password: str


def _validate_new_password(pw: str):
    if len(pw or "") < 8:
        raise HTTPException(422, "new password must be at least 8 characters")


@router.post("/change-password")
def change_password(body: PasswordChange, response: Response,
                    user=Depends(current_user), db: Session = Depends(get_db)):
    """Self-service password change for the signed-in user (profile menu)."""
    if not AUTH_ON:
        raise HTTPException(400, "authentication is disabled on this deployment")
    if is_anonymous(user):
        raise HTTPException(403, "sign in to change your password")
    u = db.scalar(select(User).where(User.username == user.username))
    if not u or not verify_password(body.current_password, u.password_hash):
        raise HTTPException(401, "current password is incorrect")
    _validate_new_password(body.new_password)
    if verify_password(body.new_password, u.password_hash):
        raise HTTPException(422, "new password must differ from the current one")
    u.password_hash = hash_password(body.new_password)
    audit(db, "user", u.id, "password_changed", actor=u.username)
    db.commit()
    # rotate the session so the change takes effect cleanly on this device
    response.set_cookie(COOKIE, make_token(u.username), httponly=True,
                        samesite="lax", max_age=SESSION_HOURS * 3600, path="/")
    return {"ok": True}


@router.post("/users/{user_id}/reset-password", dependencies=[Depends(require_admin)])
def reset_password(user_id: int, body: PasswordReset,
                   admin=Depends(require_admin), db: Session = Depends(get_db)):
    """Admin resets any user's password to a temporary value."""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    _validate_new_password(body.new_password)
    u.password_hash = hash_password(body.new_password)
    audit(db, "user", u.id, "password_reset", actor=admin.username)
    db.commit()
    return {"ok": True, "username": u.username}
