# Changelog

## 0.2.0 — 2026-11-04

**The tree now follows the conversation, and organisation gets its 0.2.0 shape: drag, a shelf per Workspace, a home chain, and a quieter band chrome.**

### Changed

- **The tree's position follows the conversation.** The tree no longer keeps an independent navigation cursor: opening a conversation (from the tree, the native sidebar, a shortcut or an external navigation), creating one from a shell entry, and a conversation first gaining a home (its first message, its catalog row appearing) all land the tree once — on its topic, its Workspace row, the space's «Ungrouped» row, or its archive row. `ViewState.selectedNodeId` is now that derived position; a transient `browsing` flag remembers that the reader moved the tree themselves (it is written into the view document but never restored — a reload starts by following the current conversation again).
- **Ungrouped conversations no longer leave the tree where it was**: opening or creating one moves the tree to the space's «Ungrouped» row and folds the columns back to L1.
- **Where a new conversation lands is decided by its entry, and the plugin only reads it**: the shell's own entry (sidebar «New session», Workspace-row ＋, ⌘N) files the conversation at the Workspace row — the tree stops on that Workspace row, expands L2 and does not drill in; the band's ＋ and a row's «Start» keep the reader's selected row as the landing point. The plugin does not adopt or override shell commands.
- **Clicking a topic row is browsing**: the tree moves, the conversation does not, and the composer's home context line keeps saying where the live conversation is. No typing resets the tree, and no «back to the conversation» button is added.
- **The band's top bar keeps its two rows** (76px) in every session state: a blank Session no longer folds the space switcher and the on-demand search into the first row, so the most common path — new conversation → first message — no longer reflows the chrome.

### Added

- **Drag topics and conversations into place** — a conversation row can be dragged onto a topic (filed under it) or a Workspace row (back to the Workspace top level); a topic row can be dropped under another topic (re-parented) or between siblings (before/after). «The topic + its conversations + its footer» is one drop target: entering the block selects the whole topic and lights the whole group, only the group's top/bottom 8px express before/after, and the boundary carries a 2px insertion line. A topic drag's label says how many conversations travel with it; ungrouped content, cross-Workspace moves and space reordering do not drag.
- **Deleting a topic asks first and takes its whole subtree at once** — every node deletion asks for confirmation; a topic with children is removed together with every descendant. The confirmation states that the conversations are not deleted: they stay in the current Workspace and fall back to its top level (an ungrouped topic's conversations return to the space's «Ungrouped» row), and can be filed again.
- **Conversation home: the chain in the tree, the address above the composer** — the tree answers two questions with two marks. The **home chain** (the open conversation's own topic plus every container above it) is always a **filled brand folder with a bold title**; a node the reader clicks gets a **1.5px brand inset outline**, and only when it is not on the chain (a row that is both stays in the chain style). The open conversation's row remains the panel's only brand fill. Putting the caret back into the composer while the selection still points away shows a quiet 30px context line — «Current conversation» + `space › workspace › topic › conversation title` — with no warning, no verdict, no buttons and no dismissal; it disappears when the composer loses focus and does not appear while browsing the tree.
- **The new-topic dialog states its location** — creating a topic shows where it will live as one read-only chain (Workspace › ancestors › parent) right under the title; creation no longer offers a parent picker (every entry already carries its parent), a blank title is refused, and the primary button says «Create» (editing still says «Save»).
- **A forked conversation lands under its source's node** — a conversation created with the product's branch action (`session.fork`) inherits its source conversation's place the first time it is indexed (from the catalog's `parentId`): a branch of a filed conversation hangs under the same topic, a branch of a loose conversation inherits the source's space. Inheritance only happens on first indexing; a branch moved elsewhere afterwards is not undone by later catalog syncs. Branches created before 0.2.0 that were filed at the Workspace top level are not back-filled — drag them once.
- **Title truncation gets a hover bubble** — a node or conversation row whose one-line title is ellipsized reveals the whole title in the product's own tooltip surface after ~400ms; a title that fits shows nothing. The bubble is measured under the pointer (hover is exactly when the row narrows, because its actions surface in the trailing slot), lives outside the column scroller, flips above rows near the bottom edge, stays inside the 12px window gutters, and is put away by scrolling, resizing, Escape or any press. Rows no longer carry a native `title` attribute (the archive row keeps its explanatory one), and the full title stays the label's DOM text, so assistive technology always reads it in full.
- **The strip fades at its start edge while scrolled** — the shell's own overflow language replaces the hard mid-column cut at the window edge: a 24px masked fade appears only while columns are scrolled out of view at the start, steps aside while a row is dragged (the auto-scroll bands and the insertion line are aiming surfaces), and is read in the browser (`data-scrolled`, written straight to the DOM) so scrolling never re-renders the panel. The end side stays unfaded — its cut lands on the band's seam, where the hairline and the resize handle already state the boundary — and the resting layout is pixel-identical.
- **The space badge gives way by measured row width** — the current-space status cluster is no longer dropped by fixed band-width thresholds: it keeps its numbers while the space name is not ellipsized, drops to dots and then disappears only when the name would really be squeezed, and climbs back as the band grows or the name shortens. The root segment's all-spaces numbers and the search-open suppression are unchanged.
- **The first column respects the window gutter** — with the shell's left column collapsed (the normal state on desktop), the band's first column pays the sidebar's 12px window padding back: pills 12px from the frame edge, icon rail at 20px, row titles at 42px — the product's own sidebar geometry. The gutter is a measured fact (`frame.left ≈ 0`), so it exists only while the band really owns the frame edge: the Web 56px rail and an expanded left column keep the old geometry, the second row steps aside by the same amount, and the gray fill still reaches the frame edge (column widths and horizontal scrolling unchanged).
- **The context line names the conversation** — the composer's 30px home context line ends with the open conversation's own title, read live from the catalog so a rename lands immediately and falling back to the indexed row title (chain only when neither exists). The title takes the primary ink and the 600 weight, so one line answers both where the conversation lives and which conversation it is; the title keeps a width floor of its own, so a long chain ellipsizes instead of pushing it out.
- **Archived: a shelf per Workspace** — each Workspace's topic column ends with a fixed Archived row; topics (with their whole subtree and conversations) or single conversations can be put away and restored later. Archiving is organisation only: archived conversations stay openable, searchable, continuable and indexed, and the plugin never calls the Host's native archive (which freezes execution). Unarchive returns a topic to its original parent (Workspace top level when that parent is gone or archived) and a conversation to its topic. The shelf is a reading surface: no creating, moving or dragging in or out; deleting an archived topic keeps its conversations in the archive. Archived content stays out of the model tools' reach — writes targeting it answer `ARCHIVED`, and `map_get_state` reports `archived: {nodes, sessions}` counts instead. Status badges ignore archived content, the archive row carries a quiet activity mark while something inside is still running or waiting, and archiving never steals the selection or swaps the open column. No data-format version bump: two optional fields (`archivedAt` / `archivedParentId`), so an older plugin simply shows archived content in place.

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
