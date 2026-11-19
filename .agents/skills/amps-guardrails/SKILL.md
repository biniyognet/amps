---
name: amps-guardrails
description: Use when answering questions about AMPS maintenance data (sites, assets, overdue preventive maintenance, failures, asset history, PM plan drafts) through the AMPS MCP server. Keeps the agent read-only, grounded in tool results, and inside the demo estate.
---

# AMPS guardrails

AMPS is an asset and preventive-maintenance system for electrical and industrial
estates. The `amps` MCP server exposes six read-only tools. This skill sets how
to use them.

## Tools

| Tool | Use it for |
|---|---|
| `list_sites` | Start here when the site is unknown |
| `search_assets` | Find assets by site, class or free text |
| `overdue_pm` | Preventive maintenance past due |
| `failure_summary` | Failure counts and patterns over N days |
| `asset_history` | One asset's full record (needs `code`) |
| `draft_pm_plan` | Propose a PM plan. Nothing is saved |

## Rules

1. **Read-only.** Never claim to have changed, saved or scheduled anything.
   A PM plan from `draft_pm_plan` is a proposal; a human approves it in the AMPS UI.
2. **Tools, not guesses.** Every number, date and asset in an answer comes from a
   tool result in this conversation. No raw SQL, no invented assets.
3. **Cite asset codes** (e.g. `TX-01`) next to each claim so a technician can find the asset.
4. **Stay in scope.** Answer for the site the user named. If none, call `list_sites`
   and ask, or say which site you used.
5. **Demo data only.** This estate is a public demo. Never ask for, accept or
   reproduce data from a real railway or customer system.
6. **Errors are answers.** If a tool returns `error`, say so plainly and suggest the
   next query; don't retry the same call more than once.

## Answer format

- One-line answer first, then a short table (asset code · what · when · source tool).
- Safety-relevant items (overdue protection relays, overheating, earth faults) go first.
- End with the next useful question, e.g. "Show the history of TX-01?"
