# Changelog

## 0.1.3 — 2026-10-30

**Bilingual UI + polish.**

- UI copy ships in **Simplified Chinese and English** and follows the DSH language setting live (no restart, no language-specific builds); the model-facing tool descriptions stay English on purpose.
- **Status rollup on every row**: `pending` / `error` / `done` / `running` counts, rolled up from the row and all of its descendants, with a quiet halo when a number just changed. A count clears only when the conversation is opened.
- Drag-to-reparent polish for nodes (topics are not dragged; re-parenting is also available from the `⋯` menu).
- Search and relative-time formatting hardening; new locale and status-rollup test coverage.
- No data-format change: an existing `$DSH_HOME/conversation-map/map.json` keeps working.

## 0.1.2 — 2026-10-27

**Fixes.**

- Fixes to the sidebar panel entry (opening the band one way only) and to band layout/styles at the minimum width.
- Regression tests for the panel entry and the band styles.

## 0.1.1 — 2026-10-27

**Fixes.**

- Maintenance release: bug fixes only, no API or data-format changes.

## 0.1.0 — 2026-10-27

**First public release.**

- Collapsible, resizable **Conversation Tree band** to the left of the conversation column; the collapsed state is remembered.
- Organisation by **Workspace → topic → conversation**, with nested topics and several «spaces», each with its own tree.
- In-band search over topic titles/descriptions, indexed conversation titles and conversation bodies (index built on demand inside DSH).
- Opening a conversation uses the product's own navigation; the tree highlight, the product session and the right sidebar stay on the same conversation.
- Nine model tools over the tree (`map_list_workspaces`, `map_get_state`, `map_plan_goal`, `map_create_nodes`, `map_update_nodes`, `map_move_nodes`, `map_move_session`, `map_attach_sessions`, `map_delete_nodes`).
- The authoritative document lives in `$DSH_HOME/conversation-map/map.json` (Host half, `/conversation-map` RPC with optimistic revision locking); no network requests, no npm dependencies, no install scripts.
