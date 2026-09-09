# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Arup Biswas
# AMPS - Asset & Preventive Maintenance System (https://github.com/arupbiswas1994-byte/amps)

"""AMPS domain model — v0.1 skeleton.

Generic maintenance-management entities. No organization-specific data:
every deployment configures its own location tree and asset classes.
"""
from datetime import date, datetime
from enum import Enum

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class LocationKind(str, Enum):
    SITE = "site"          # e.g. a plant, a metro line
    SECTION = "section"    # e.g. a depot, a zone
    STATION = "station"    # e.g. a substation, a bay group
    BAY = "bay"            # smallest addressable slot


class Location(Base):
    """Self-referencing tree: Site → Section → Station → Bay."""
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[LocationKind]
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))

    parent: Mapped["Location | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["Location"]] = relationship(back_populates="parent")
    # Asset has two FKs to locations (location_id, line_id) — this collection is
    # the station→assets one, so pin the join to Asset.location_id.
    assets: Mapped[list["Asset"]] = relationship(
        back_populates="location", foreign_keys="Asset.location_id")


class AssetClass(Base):
    """e.g. Transformer, HT Panel, LT Panel, PLC, Motor, Crane Hoist."""
    __tablename__ = "asset_classes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)


class AssetStatus(str, Enum):
    IN_SERVICE = "in_service"
    UNDER_MAINTENANCE = "under_maintenance"
    OUT_OF_SERVICE = "out_of_service"
    DECOMMISSIONED = "decommissioned"
    SPARE = "spare"                     # held in reserve, not in active service


class Criticality(str, Enum):
    """A = failure hurts safety/service immediately · B = significant · C = tolerable."""
    A = "A"
    B = "B"
    C = "C"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    # printed on the QR tag. NOT globally unique — different lines/depots reuse
    # the same code series (e.g. Green and Blue both have 05DB01). Uniqueness is
    # per line (unique index on code+line_id, created in _migrate).
    code: Mapped[str] = mapped_column(String(120), index=True)
    name: Mapped[str] = mapped_column(String(160))
    asset_class_id: Mapped[int] = mapped_column(ForeignKey("asset_classes.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    # denormalised SITE (line) id — lets code be unique per line and scopes lookups
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    make_model: Mapped[str | None] = mapped_column(String(160))
    # Reporting rollup a department thinks in (e.g. "Traction / PS", "Station E&M").
    # Free text so every deployment names its own systems; distinct from asset_class.
    system: Mapped[str | None] = mapped_column(String(80))
    commissioned_on: Mapped[date | None]
    status: Mapped[AssetStatus] = mapped_column(default=AssetStatus.IN_SERVICE)
    criticality: Mapped[Criticality] = mapped_column(default=Criticality.B)
    # narrative fields — a fuller description, free-form remarks, and the codal
    # life (the prescribed service life in years, per the railway asset code)
    description: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    codal_life_years: Mapped[int | None]
    # the maintenance depot this asset belongs to (e.g. SHY, KHG, CPD) — a line
    # may have several depots, each with its own SSE/coordinator scope.
    depot: Mapped[str | None] = mapped_column(String(40))
    # the fine equipment location WITHIN the station (e.g. "TVS Fan Room-01,
    # Concourse"). location_id is the STATION; this is the spot inside it.
    location_detail: Mapped[str | None] = mapped_column(String(200))

    asset_class: Mapped[AssetClass] = relationship()
    location: Mapped[Location] = relationship(
        back_populates="assets", foreign_keys=[location_id])
    pm_schedules: Mapped[list["PMSchedule"]] = relationship(back_populates="asset")
    work_orders: Mapped[list["WorkOrder"]] = relationship(back_populates="asset")


class PMFrequency(str, Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    YEARLY = "yearly"


class PMSchedule(Base):
    """Preventive-maintenance schedule attached to an asset."""
    __tablename__ = "pm_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    task: Mapped[str] = mapped_column(String(200))
    frequency: Mapped[PMFrequency]
    last_done: Mapped[date | None]
    next_due: Mapped[date | None]

    asset: Mapped[Asset] = relationship(back_populates="pm_schedules")


class PMPlan(Base):
    """One frequency an asset is scheduled for — its maintenance plan.

    Applicability lives here (which cycles the asset needs); the *last done* is
    read from the logbook — a comprehensive service fulfils the shorter cycles
    under it — with an optional manual seed for history that predates the log.
    When an asset has no plan rows, the schedule falls back to the frequencies
    present in its log, so the register keeps working before anyone sets a plan.
    Frequency is a plain label (Monthly … 5-Yearly), free of the PMSchedule enum
    so 5-Yearly and future cycles need no type migration."""
    __tablename__ = "pm_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), index=True)
    frequency: Mapped[str] = mapped_column(String(20))       # Monthly … 5-Yearly
    last_done_seed: Mapped[date | None]                       # optional manual baseline


class WorkOrderStatus(str, Enum):
    OPEN = "open"
    ASSIGNED = "assigned"
    DONE = "done"
    VERIFIED = "verified"
    CANCELLED = "cancelled"


class WorkOrderType(str, Enum):
    PREVENTIVE = "preventive"
    BREAKDOWN = "breakdown"
    INSPECTION = "inspection"


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    pm_schedule_id: Mapped[int | None] = mapped_column(ForeignKey("pm_schedules.id"))
    type: Mapped[WorkOrderType]
    status: Mapped[WorkOrderStatus] = mapped_column(default=WorkOrderStatus.OPEN)
    title: Mapped[str] = mapped_column(String(200))
    findings: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[str | None] = mapped_column(String(120))
    opened_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    closed_at: Mapped[datetime | None]

    asset: Mapped[Asset] = relationship(back_populates="work_orders")


class ShiftCode(str, Enum):
    """Generic shift codes; each deployment maps them to its own timings."""
    MORNING = "M"
    EVENING = "E"
    NIGHT = "N"
    GENERAL = "G"
    REST = "R"


class RosterPattern(Base):
    """A named weekly duty pattern (baseline or a pre-approved mode).

    Patterns are maintenance-planning objects, not attendance records:
    they tell the PM engine who is on duty in which window, so due work
    can be bundled into shift work packages.
    """
    __tablename__ = "roster_patterns"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    maintenance_window_shifts: Mapped[str] = mapped_column(String(20), default="N")  # csv of ShiftCode values
    is_active: Mapped[bool] = mapped_column(default=False)

    entries: Mapped[list["RosterEntry"]] = relationship(back_populates="pattern")


class RosterEntry(Base):
    """One cell of the weekly grid: person × weekday → shift."""
    __tablename__ = "roster_entries"
    __table_args__ = (UniqueConstraint("pattern_id", "user_id", "weekday"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    pattern_id: Mapped[int] = mapped_column(ForeignKey("roster_patterns.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    weekday: Mapped[int]  # 0 = Monday … 6 = Sunday
    shift: Mapped[ShiftCode]

    pattern: Mapped[RosterPattern] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship()


class UserRole(str, Enum):
    ADMIN = "admin"
    INCHARGE = "incharge"          # In-charge (IC) — approves checksheet formats
    SUPERVISOR = "supervisor"
    TECHNICIAN = "technician"
    VIEWER = "viewer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(default=UserRole.VIEWER)
    password_hash: Mapped[str | None] = mapped_column(String(200))
    # Access scope: a SITE location (e.g. a metro line). NULL = all sites (HQ/admin).
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    # optional narrower scope WITHIN the line: a depot code (e.g. SHY, KHG). When
    # set, the user only sees that depot's assets/logs; NULL = the whole line.
    depot: Mapped[str | None] = mapped_column(String(40))

    line: Mapped["Location | None"] = relationship()


class LogEntryType(str, Enum):
    # Current taxonomy (2026-07, per the section's practice)
    MAINTENANCE = "maintenance"      # PM work — subtype carries the frequency
    FAILURE = "failure"              # breakdown noted in the book
    RECTIFICATION = "rectification"  # repair/fix work — actually RESOLVES a failure
    ACKNOWLEDGEMENT = "acknowledgement"  # noted/actioned (demand raised, mail sent)
    #                                      but NOT yet fixed — failure stays amber
    JOB_CARD = "job_card"            # a job card raised to OEM/dept — yellow; the
    #                                  card is CLOSED by a later rectification
    GENERAL = "general"              # everything else
    # Legacy values — kept for rows written before the taxonomy change
    OPERATION = "operation"      # switching, isolations, normal ops events
    OBSERVATION = "observation"  # readings, conditions noticed
    DEFECT = "defect"            # something wrong, to become a work order
    HANDOVER = "handover"        # shift handover note


class LogEntry(Base):
    """Digital shift logbook — the running record a section keeps by hand today.

    Entries are append-only (corrections are new entries referencing the old
    one), optionally tied to an asset so the asset's history card can show
    everything ever logged against it.
    """
    __tablename__ = "log_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    log_date: Mapped[date]                     # the duty date the entry belongs to
    shift: Mapped[ShiftCode] = mapped_column(default=ShiftCode.GENERAL)
    type: Mapped[LogEntryType] = mapped_column(default=LogEntryType.GENERAL)
    # maintenance frequency (Monthly / Quarterly / Half-Yearly / Yearly / Special)
    subtype: Mapped[str | None] = mapped_column(String(40))
    # Two-level equipment tag. `system` is the coarse rollup (~a dozen: "HT ·
    # 750V DC", "LT · ECS (AC)") the section thinks in; `category` is the finer
    # asset class under it (optional). System-first keeps the class picker
    # short. Both auto-fill from the asset when one is named.
    system: Mapped[str | None] = mapped_column(String(80))
    # equipment category — the asset class (auto-filled from the asset, editable)
    category: Mapped[str | None] = mapped_column(String(80))
    # Failure rows only: recovery moment and fault classification. `at` is the
    # start; downtime is derived (ended_at − at), never typed. NULL end on a
    # failure entry = still down. Kept on the one ledger rather than a second
    # table so the logbook stays the single source of truth.
    ended_at: Mapped[datetime | None]
    fault_type: Mapped[str | None] = mapped_column(String(120))
    # spares / materials consumed during the work (free text, e.g. "2× PT fuse")
    consumables: Mapped[str | None] = mapped_column(Text)
    # station / location the work was at — kept as free text for entries whose
    # asset isn't in the register (imported job cards, aux logs) so the board can
    # still show WHERE. For asset-linked entries the asset's location is canonical.
    station: Mapped[str | None] = mapped_column(String(160))
    # the action taken / work done, kept apart from the report/cause so the
    # logbook can show a distinct "Action taken" column.
    action_taken: Mapped[str | None] = mapped_column(Text)
    # a filled structured checksheet, as a JSON string:
    #   {"template": "...", "name": "...", "results": [{"label","status","reading"}]}
    # attached to maintenance and to job-card/rectification work.
    checksheet: Mapped[str | None] = mapped_column(Text)
    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id"))
    text: Mapped[str] = mapped_column(Text)
    # Who WROTE the entry (the session on authenticated deployments) versus
    # who DID the work. The sheets only ever had the latter, and the import
    # put it in entered_by for want of anywhere else; keeping them apart lets
    # a supervisor log a night crew's job without claiming it.
    entered_by: Mapped[str] = mapped_column(String(120), default="unknown")
    attended_by: Mapped[str | None] = mapped_column(String(200))
    corrects_id: Mapped[int | None] = mapped_column(ForeignKey("log_entries.id"))
    # Rectification rows only: the FAILURE entry this work fixes. Distinct from
    # corrects_id, which means "this entry corrects a mis-written entry" —
    # conflating the two would confuse a typo with a repair.
    #
    # State rule: THE LATEST ENTRY DOMINATES. A failure is open until a
    # rectification is logged against it, and the newest rectification carries
    # the recovery time — so a temporary fix followed by a permanent one just
    # works, and a fresh failure on the same asset opens it again.
    rectifies_id: Mapped[int | None] = mapped_column(ForeignKey("log_entries.id"))
    # a RECTIFICATION may be carried out by us or by the agency/OEM under a job
    # card — this flags the latter (set from the edit form's checkbox).
    via_job_card: Mapped[bool | None] = mapped_column(default=None)
    # a response (ack/job-card/rectification) that was logged then withdrawn is
    # RETRACTED, not deleted — the record stays for the audit trail, struck
    # through, and stops counting toward the failure's state.
    retracted: Mapped[bool | None] = mapped_column(default=None)
    # Which site's (line's) logbook the entry belongs to. NULL = department-wide.
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))

    asset: Mapped["Asset | None"] = relationship()


class Failure(Base):
    """A breakdown record: from the moment an asset fails to its recovery.

    Mirrors how power-supply sections actually log failures on paper:
    start/end time, fault type, what was done, who attended. Downtime is
    derived (end − start), never entered — one source of truth."""
    __tablename__ = "failures"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"))
    started_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    ended_at: Mapped[datetime | None]
    fault_type: Mapped[str | None] = mapped_column(String(120))  # e.g. "DC earth fault"
    description: Mapped[str] = mapped_column(Text)               # what happened / how noticed
    work_done: Mapped[str | None] = mapped_column(Text)          # rectification, on close
    attended_by: Mapped[str | None] = mapped_column(String(160))
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"))

    asset: Mapped[Asset] = relationship()


class Attachment(Base):
    """A scanned checksheet / photo / PDF attached to a log entry. The bytes
    live on the deployment's local media disk (a Docker volume), served through
    the backend behind auth — an off-box backup is an ops concern, not the app's.
    Files are compressed client-side before upload; sha256 dedups re-uploads."""
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("log_entries.id"), index=True)
    filename: Mapped[str] = mapped_column(String(200))       # original name / link label
    stored_name: Mapped[str] = mapped_column(String(80))     # <uuid>.<ext> on the media disk ('' for a link)
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int]                                        # bytes on disk (0 for a link)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    # a link attachment (e.g. a Google Drive checksheet) instead of an uploaded
    # file — the coordinator keeps the sheet in Drive and just attaches its URL
    url: Mapped[str | None] = mapped_column(String(600), default=None)
    uploaded_by: Mapped[str] = mapped_column(String(120), default="unknown")
    uploaded_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    # audit-safe removal: kept on disk + row retained, flagged out of the view
    retracted: Mapped[bool | None] = mapped_column(default=None)


class AuditLog(Base):
    """Append-only trail of every mutation: the register is only 'the truth'
    if every change is attributable. Written via app.db.audit()."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    actor: Mapped[str] = mapped_column(String(60), default="system")  # username once auth lands
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int]
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str | None] = mapped_column(Text)


class ChecksheetStatus(str, Enum):
    DRAFT = "draft"            # being authored / returned by a rejection
    PENDING = "pending"        # submitted, awaiting IC approval
    PUBLISHED = "published"    # approved and live — the printable blank
    ARCHIVED = "archived"      # a previous published version, superseded


class ChecksheetFormat(Base):
    """A maintenance-checksheet FORMAT (the blank printed and filled by hand).

    Governed: a writer authors a DRAFT, submits it (PENDING), and an IC (in-charge)
    approves it (PUBLISHED) — only published formats appear in Printables. Editing
    a published format creates a new pending version that supersedes the old one
    when approved (the old stays live until then, then ARCHIVED). `slug` is the
    stable identity across versions; every step is written to the audit trail."""
    __tablename__ = "checksheet_formats"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), index=True)   # stable across versions
    grp: Mapped[str] = mapped_column(String(40), default="HT")  # HT / LT / ECS …
    label: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(240))
    # what the format applies to. `asset_code` names the specific equipment/asset
    # it's for (e.g. "Third Rail", "BET", "VCB"); `asset_class` is the broader
    # class fallback. Either surfaces the right checksheet when logging.
    asset_code: Mapped[str | None] = mapped_column(String(120))
    asset_class: Mapped[str | None] = mapped_column(String(120))
    frequency: Mapped[str | None] = mapped_column(String(40))
    # frequency-matrix columns (e.g. ["M1","M3","M6","Y1"]); each item marks which
    # of these it is DUE at (white in the printed grid) vs not-required (grey).
    frequencies_json: Mapped[str] = mapped_column(Text, default="[]")
    items_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON list of {activity,prescribed,freqs}
    version: Mapped[int] = mapped_column(default=1)
    status: Mapped[ChecksheetStatus] = mapped_column(default=ChecksheetStatus.DRAFT)
    supersedes_id: Mapped[int | None]      # the published format this replaces
    reject_reason: Mapped[str | None] = mapped_column(Text)
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))  # NULL = org-wide
    created_by: Mapped[str] = mapped_column(String(120), default="system")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
    approved_by: Mapped[str | None] = mapped_column(String(120))
    approved_at: Mapped[datetime | None]


class Correspondence(Base):
    """Correspondence trail — official letters and emails a section sends or
    receives, imported from the line's coordination sheet.

    A read-mostly register: one row per letter/email, optionally naming the
    assets it concerns (free text, as the source records it) so it can be
    surfaced next to the asset history later. `mode` distinguishes a physical
    letter from an email; `ref_no` is the letter/reference number.
    """
    __tablename__ = "correspondence"
    __table_args__ = (UniqueConstraint("line_id", "seq", name="uq_corr_line_seq"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    line_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))  # the line's register
    seq: Mapped[int | None]                      # SL in the source sheet (stable key per line)
    corr_date: Mapped[date | None]               # the letter/email date
    mode: Mapped[str] = mapped_column(String(16), default="letter")  # letter | email
    ref_no: Mapped[str | None] = mapped_column(String(200))          # letter / reference number
    subject: Mapped[str | None] = mapped_column(Text)
    related_assets: Mapped[str | None] = mapped_column(Text)         # asset(s) it concerns (free text)
    brief: Mapped[str | None] = mapped_column(Text)                  # short description / summary
    sender: Mapped[str | None] = mapped_column(Text)                 # FROM
    recipient: Mapped[str | None] = mapped_column(Text)              # TO
    copy_to: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)                   # scan / document URL
    ocr: Mapped[str | None] = mapped_column(Text)                    # extracted text (searchable)
    drafting_date: Mapped[date | None]
    drafting_by: Mapped[str | None] = mapped_column(String(200))
    at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
