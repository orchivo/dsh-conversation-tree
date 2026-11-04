/**
 * Where the open conversation lives in the map, and whether the map's current
 * selection still names that place.
 *
 * The map has two states that are allowed to drift apart: the row the reader
 * has selected (a navigation cursor: it decides which column unfolds and where
 * a new conversation goes) and the conversation the shipped column is actually
 * showing (the work context: everything typed into the composer belongs to it).
 * Opening a conversation aligns them; manually selecting another row does not.
 * This module is the read-only policy that names the conversation's home and
 * answers "did the selection leave it?" — no DOM, no translation, no writes.
 *
 * Every function is pure so the same verdict can be derived by the band (which
 * renders the selection) and by the composer-side notice (which only knows the
 * session id through its slot), and so the boundary table can be unit-tested
 * without a browser. The band also needs the row that stands for the
 * conversation it is showing — a subagent child has none of its own — which is
 * the second question this module answers ({@link readingSessionOf}).
 */
import {
  archiveKey,
  inArchive,
  isArchiveSelectionKey,
  isArchivedThread,
  looseRowKey,
  nodePath,
  sessionHomeRow,
  threadOfSession,
  visibleAncestorOf,
  workspaceKey,
  workspaceSelection,
  type MapState,
} from './model.js'

/** Why one verdict came out the way it did; the UI reads it for wording only. */
export type SessionHomeReason =
  /** Nothing is open. */
  | 'no-session'
  /** The open Session has no indexed row yet (a brand-new conversation). */
  | 'no-thread'
  /** The open Session is a blank, unsent conversation. */
  | 'blank'
  /** The open Session is a subagent; the map gives it no row of its own. */
  | 'subagent'
  /** An indexed conversation whose home row cannot be derived. */
  | 'no-home'
  /** A loose (ungrouped) conversation: it has no node, only its space's bucket. */
  | 'ungrouped'
  /** The map has no selection at all. */
  | 'no-selection'
  /** The selection names a node or Workspace that no longer exists. */
  | 'dangling-selection'
  /** The selection is exactly the conversation's home row. */
  | 'same-row'
  /** The selection is a container above the conversation's home. */
  | 'ancestor'
  /** The home is in another space, so its row is not even on screen. */
  | 'other-space'
  /** The selection is a different branch of the same space. */
  | 'other-branch'

/** The place one conversation is filed under, as a row the map can show. */
export interface SessionHomeSelection {
  /** The space the home row lives in. */
  spaceId: string
  /** The row key: a topic id, `@ws:<workspaceId>`, or a space's ungrouped row. */
  selection: string
  /** The topic's id when the home is a topic; `null` for Workspace/ungrouped rows. */
  nodeId: string | null
  /** The owning Workspace; `null` for the ungrouped bucket and legacy rootless topics. */
  workspaceId: string | null
  /** The topic's title when the home is a topic; the caller names Workspace rows. */
  title: string | null
}

/** The Session-catalog facts the verdict needs but the map document does not hold. */
export interface SessionHomeCatalogRow {
  /** A conversation with no message yet (it only exists while it is current). */
  blank?: boolean
  /** `subagent` for a child Session, whose row the map deliberately omits. */
  origin?: string
}

/** What the UI learns about one open conversation against the current selection. */
export interface SessionHomeVerdict {
  /** Whether the selection has left the conversation's home (the notice shows). */
  divergent: boolean
  reason: SessionHomeReason
  /** The home row when it can be derived; `null` when the conversation has none. */
  home: SessionHomeSelection | null
  /** True when the home is in another space than the one on screen. */
  crossSpace: boolean
}

/** Input of {@link sessionHomeDivergence}. */
export interface SessionHomeDivergenceInput {
  state: MapState
  /** The conversation the shipped column shows, as the map remembers it. */
  openSessionId: string | null
  /** The map's selected row key, exactly as `ViewState` stores it. */
  selectedNodeId: string | null
  /** The space on screen; a stale or missing id falls back to the default space. */
  activeSpace: string | null | undefined
  /** The catalog row of `openSessionId`, when the caller has the catalog. */
  catalog?: SessionHomeCatalogRow | null
}

/**
 * The space the map is effectively showing.
 *
 * A view may point at a space that has since been deleted; the panel then falls
 * back to the default space, and the verdict has to agree with what is on
 * screen rather than with the stale stored id.
 * @param state - the map.
 * @param activeSpace - the stored scope, or null/undefined.
 * @returns the space id to compare against.
 */
export function effectiveSpaceId(state: MapState, activeSpace: string | null | undefined): string {
  const candidate = activeSpace ?? ''
  return state.spaces.some(space => space.id === candidate) ? candidate : state.defaultSpaceId
}

/**
 * The conversation whose row stands for the open one.
 *
 * The map gives a subagent child no row of its own: the native product reaches
 * it from its parent (the parent's subagent catalog, the child's breadcrumb),
 * and the tree indexes only conversations that have a place. The row that
 * answers "which conversation is being read" — the one solid conversation row,
 * the filled home folder, the home chain — therefore has to name the child's
 * nearest visible ancestor. Reading a subagent then looks exactly like reading
 * the parent that owns it, which is how the reader perceives the pair: the child
 * is a step inside the parent's conversation, not a place beside it.
 *
 * A fork names itself. It carries a `parentId` too, but it is an ordinary
 * conversation with a row of its own, and {@link visibleAncestorOf} climbs
 * subagent rows only. A parent chain the catalog cannot finish keeps the id the
 * walk last named, and a chain that loops back ends on the conversation it
 * started from; neither invents an ancestor, and when the map has no row for the
 * id nothing is marked — exactly as an unindexed conversation has no home. Only
 * the identity marks are inherited this way: the attention rollups keep reading
 * the Session that is really open, so a parent whose turn finished, failed, or
 * asks for an answer still shows its mark while its child is being read.
 *
 * @param byId - catalog rows by session id, as the client holds them.
 * @param sessionId - the open conversation, or null when nothing is open.
 * @returns the id whose row the band marks as being read.
 */
export function readingSessionOf(
  byId: Readonly<Record<string, { origin?: string; parentId?: string | null } | undefined>>,
  sessionId: string | null,
): string | null {
  if (sessionId === null) return null
  return visibleAncestorOf(byId, sessionId)
}

/**
 * The row one conversation is filed under.
 *
 * A conversation filed under a topic belongs to that topic; one filed directly
 * under a Workspace belongs to the Workspace row; a loose conversation belongs
 * to its space's ungrouped row. A topic that has since been deleted falls back
 * to the owning Workspace, exactly like the index does.
 * @param state - the map.
 * @param sessionId - the conversation, or null for "nothing open".
 * @returns its home, or null when the index does not know the conversation.
 */
export function sessionHomeSelection(state: MapState, sessionId: string | null): SessionHomeSelection | null {
  const row = sessionHomeRow(state, sessionId)
  if (row === undefined) return null
  const title = row.nodeId === null
    ? null
    : state.nodes.find(node => node.id === row.nodeId)?.title ?? null
  return { ...row, title }
}

/** Compose one verdict; keeps every early return honest about its fields. */
function verdict(
  reason: SessionHomeReason,
  divergent: boolean,
  home: SessionHomeSelection | null,
  crossSpace: boolean,
): SessionHomeVerdict {
  return { reason, divergent, home, crossSpace }
}

/**
 * Decide whether the map's selection has left the open conversation.
 *
 * Order matters and mirrors the product's own navigation rules:
 *
 * 1. nothing open / a subagent / an unindexed Session → there is nothing to
 *    warn about (the reading column and the map cannot disagree meaningfully);
 * 2. a blank conversation → no notice (there is no old content to confuse, and
 *    a brand-new conversation must not greet the reader with a warning);
 * 3. a conversation from another space → divergent, whatever the selection
 *    says: its row is not on screen at all, and a selection key left over from
 *    before the space switch can still equal the home row (switching space does
 *    not clear the selection), which must not pass for "same row";
 * 4. a loose conversation → no notice (opening one deliberately leaves the
 *    selection alone; warning on every such open would be noise);
 * 5. no selection, or a selection that names something gone → no notice;
 * 6. the same row, or a container above it (the Workspace row, the space's
 *    ungrouped row for a legacy rootless topic, or an ancestor topic) → the
 *    reader is inside the conversation's own domain: no notice;
 * 7. any other branch → divergent.
 *
 * @param input - the map, the two view fields, the effective space, and the
 *   catalog row when the caller has it.
 * @returns the verdict the band and the composer-side notice render.
 */
export function sessionHomeDivergence(input: SessionHomeDivergenceInput): SessionHomeVerdict {
  const { state, openSessionId, selectedNodeId, activeSpace, catalog } = input
  if (openSessionId === null) return verdict('no-session', false, null, false)
  if (catalog?.origin === 'subagent') return verdict('subagent', false, null, false)
  const thread = threadOfSession(state, openSessionId)
  if (thread === undefined) return verdict('no-thread', false, null, false)
  const home = sessionHomeSelection(state, openSessionId)
  if (home === null) return verdict('no-home', false, null, false)
  if (catalog?.blank === true) return verdict('blank', false, home, false)
  // Cross-space first: a conversation from another space has no row anywhere
  // on screen, and the stored selection may still name its home row (switching
  // space keeps the selection), which must not pass for "same row".
  const active = effectiveSpaceId(state, activeSpace)
  if (home.spaceId !== active) return verdict('other-space', true, home, true)
  if (home.nodeId === null && home.workspaceId === null) return verdict('ungrouped', false, home, false)
  if (selectedNodeId === null) return verdict('no-selection', false, home, false)
  // A selection key is valid while it names an existing topic, or any Workspace
  // row / ungrouped bucket key (`workspaceSelection` answers that without the
  // Host list; a removed Workspace is reconciled away by the view's live set).
  const workspaceRow = workspaceSelection(selectedNodeId) !== undefined
  const archiveRow = isArchiveSelectionKey(selectedNodeId)
  const topic = !workspaceRow && !archiveRow && state.nodes.some(node => node.id === selectedNodeId)
  if (!workspaceRow && !archiveRow && !topic) return verdict('dangling-selection', false, home, false)
  if (selectedNodeId === home.selection) return verdict('same-row', false, home, false)
  // The archive row is a container above everything it holds, and the Workspace
  // row is the container above the archive row itself. The archive row is *not*
  // an ancestor of the active branch: selecting it while reading an active
  // conversation is a real branch change and must still raise the notice.
  const homeArchived = home.nodeId !== null && inArchive(state, home.nodeId)
  const archiveAncestor = home.workspaceId !== null
    && ((homeArchived && selectedNodeId === archiveKey(home.workspaceId))
      || (isArchiveSelectionKey(home.selection) && selectedNodeId === workspaceKey(home.workspaceId)))
  const aboveHome = archiveAncestor || (home.nodeId !== null
    ? nodePath(state, home.nodeId).slice(0, -1).some(node => node.id === selectedNodeId)
      || (home.workspaceId !== null
        // The owning Workspace row is the container above a filed topic.
        ? selectedNodeId === workspaceKey(home.workspaceId)
        // A legacy rootless topic lives at its space's ungrouped row.
        : selectedNodeId === looseRowKey(state, home.spaceId))
    : false)
  if (aboveHome) return verdict('ancestor', false, home, false)
  return verdict('other-branch', true, home, false)
}

