/**
 * Pure conversation-map model: the topic tree, the conversation index, and
 * every mutation as a state transition.
 *
 * The map hangs off the application's real container hierarchy: a first-level
 * "node" is a Workspace, not a topic this plugin invented. Topic nodes are
 * always inside exactly one Workspace (or in the ungrouped bucket), and a
 * conversation keeps the Workspace the Host accounts it to. That is what makes
 * the map agree with the shipped sidebar: creating a conversation here creates
 * it in that Workspace, and a conversation created anywhere else shows up here.
 *
 * Nothing here touches React, the DOM, or a storage backend, so the same code
 * is inlined into the browser bundle and exercised directly by the unit tests.
 */

/** One topic node. It always belongs to one Workspace (or to the ungrouped bucket). */
export interface MapNode {
  id: string
  parentId: string | null
  title: string
  description: string
  position: number
  /**
   * When the topic was created, as an ISO stamp.
   *
   * Absent on documents written before the info bar existed. The bar then
   * reads "—" instead of inventing a date from `updatedAt`.
   */
  createdAt?: string
  updatedAt: string
  /**
   * Owning Workspace id; `null` means the ungrouped bucket. `undefined` is the
   * migration marker for a node persisted before Workspaces became the map's
   * first level — it is resolved once the Workspace list is known.
   */
  workspaceId?: string | null
  /**
   * When the topic was moved into its Workspace's archive, as an ISO stamp.
   *
   * Only an archived top-level topic carries it: archiving detaches the block
   * (`parentId → null`), so the descendants and conversations inside it need no
   * mark of their own — the block owns the state.
   */
  archivedAt?: string
  /**
   * Parent the topic returns to when it leaves the archive; `null` = it was a
   * Workspace root. Kept while archived, cleared once it is restored.
   */
  archivedParentId?: string | null
}

/**
 * One indexed conversation. `nodeId` is its optional topic inside the owning
 * Workspace; `null` means it sits directly under that Workspace (or, when the
 * Workspace is `null`, in the ungrouped bucket).
 */
export interface ThreadRef {
  sessionId: string
  nodeId: string | null
  title: string
  updatedAt: string
  importedAt: string
  /**
   * Coarse durable origin as the catalog reports it, kept for the Host half.
   *
   * The map's visibility rule is decided from the catalog, but the Host has no
   * catalog: persisting the field lets it recognise a conversation the map
   * never gives a row to (a subagent's Session is reached from its parent).
   * Absent means an ordinary conversation.
   */
  origin?: string
  /** Owning Workspace id; `undefined` until the Host's accounting is known. */
  workspaceId?: string | null
  /**
   * Plugin-local space of a conversation that no Workspace accounts for.
   *
   * Only meaningful while `workspaceId` is `null`; absent means the default
   * space. It is cleared as soon as the Host files the conversation under a
   * Workspace, because Workspace membership wins.
   */
  spaceId?: string | null
  /**
   * When the conversation was archived on its own, as an ISO stamp.
   *
   * `nodeId` is kept: it remembers the topic the conversation returns to when it
   * is unarchived. A conversation filed inside an archived topic carries no mark
   * — the archived block owns the state, and unarchiving it happens as a block.
   */
  archivedAt?: string
}

/** One Workspace projection the map groups by. */
export interface WorkspaceRef {
  workspaceId: string
  path: string
  title: string
  sessionIds: readonly string[]
}

/**
 * One plugin-local group of Workspaces.
 *
 * Spaces are organizational data that only this plugin knows about: the Host
 * never sees them, and they never change Session accounting.
 */
export interface SpaceRef {
  id: string
  title: string
  /** Display order, starting at 1. The default space always sorts first. */
  position: number
  createdAt: string
}

/** The whole persisted map. */
export interface MapState {
  version: 2
  revision: number
  nodes: MapNode[]
  threads: ThreadRef[]
  /** Plugin-local Workspace groups, shown in `position` order. */
  spaces: SpaceRef[]
  /** Id of the space every unassigned Workspace belongs to; always a member. */
  defaultSpaceId: string
  /**
   * Conversations the map knows to be subagent children, durable after their
   * rows are gone.
   *
   * Index-time filtering drops a subagent row before it can be stored, so the
   * document cannot answer "was this a subagent?" from `threads` alone — yet the
   * Host half must answer exactly that when a caller asks to file a conversation
   * under a node. The ledger is written at the one moment the fact is still
   * known (the prune that removes the row) and is append-only: membership means
   * "was recorded as a subagent", which is all the rejection rule needs.
   */
  subagentSessionIds: string[]
  /**
   * Explicit `workspaceId → spaceId` overrides. A missing key means "the
   * default space", which keeps the map sparse: Workspaces created outside the
   * plugin need no write, and deleting a space is just dropping its keys.
   */
  spaceOf: Record<string, string>
}

/** The catalog row a sync feeds in. */
export interface SessionSummaryLike {
  id: string
  displayTitle?: string
  title?: string
  running?: boolean
  /** Host-reported last-activity time, in milliseconds since the epoch. */
  updatedAt?: number
  /** True while the session has been created but never used. */
  blank?: boolean
  /**
   * Coarse durable origin; `'subagent'` marks a child the map never gives a
   * row to, because it is reached from its parent.
   */
  origin?: string
  /**
   * Owning parent conversation: the source a fork branched from, or the parent
   * of a subagent child. Only a fork becomes a row that can inherit its
   * source's place; a subagent child is reached from its parent instead.
   */
  parentId?: string | null
}

/**
 * Selection key naming the ungrouped bucket.
 *
 * Every Workspace is a first-level node whose id is `@ws:<workspaceId>`; the
 * sessions no Workspace accounts for trail in this one bucket, exactly where the
 * shipped sidebar puts them.
 */
export const UNGROUPED_ID = '@ungrouped'

/** Prefix shared by every Workspace selection key. */
export const WORKSPACE_SELECTION_PREFIX = '@ws:'

/**
 * Prefix shared by every "Archived" row selection key.
 *
 * The archive is a synthetic row, not a stored node: it is the last row of one
 * Workspace's topic column and names the Workspace whose archived content it
 * opens. Like `@ws:<id>` it is a first-class selection key, so a selected
 * archive row survives a refresh instead of falling out of the live set.
 */
export const ARCHIVE_SELECTION_PREFIX = '@archive:'

/** Prefix shared by the per-space "ungrouped" row keys (except the default space). */
export const LOOSE_ROW_PREFIX = '@loose:'

/**
 * Stored title marker of the space the plugin creates on first use.
 *
 * This is document data, not display copy: the label shown for it comes from the
 * client dictionary (`common.defaultSpace`), and a renamed space renders its
 * stored title verbatim. Keeping the marker language-neutral is what lets a
 * document move between languages without rewriting user data; the legacy
 * Chinese marker is migrated on read (see `parseMapState`).
 */
export const DEFAULT_SPACE_TITLE = '@default-space'

/** The Chinese marker written by versions before the locale refactor. */
const LEGACY_DEFAULT_SPACE_TITLE = '默认空间'

/** Limits mirroring the plugin's stated first-version bounds. */
export const MAX_DEPTH = 12
export const MAX_NODES = 1500
export const MAX_TITLE = 80
export const MAX_DESCRIPTION = 6000
export const MAX_SPACES = 50
export const MAX_SPACE_TITLE = 40

/** A rejected mutation, carrying a stable code the render site explains. */
export class MapError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(message)
    this.name = 'MapError'
  }
}

/** A fresh, empty map. */
export function emptyMap(): MapState {
  return {
    version: 2, revision: 0, nodes: [], threads: [],
    spaces: [], defaultSpaceId: '', spaceOf: {}, subagentSessionIds: [],
  }
}

/** Read one node, throwing when the caller names a node that is gone. */
function requireNode(state: MapState, id: string): MapNode {
  const node = state.nodes.find(candidate => candidate.id === id)
  if (node === undefined) throw new MapError('NOT_FOUND', 'The target no longer exists; refresh and try again.')
  return node
}

/** Apply one change and bump the revision. */
function mutate(state: MapState, change: (draft: MapState) => void): MapState {
  const next: MapState = {
    ...state,
    version: 2,
    revision: state.revision + 1,
    nodes: state.nodes.map(node => ({ ...node })),
    threads: state.threads.map(thread => ({ ...thread })),
    spaces: state.spaces.map(space => ({ ...space })),
    spaceOf: { ...state.spaceOf },
    subagentSessionIds: [...(state.subagentSessionIds ?? [])],
  }
  change(next)
  return next
}

/** Normalize the optional owner to the value the map groups by. */
function ownerOf(value: string | null | undefined): string | null {
  return value ?? null
}

/** Root topics of one Workspace, in display order. */
export function topNodesOf(state: MapState, workspaceId: string | null): MapNode[] {
  return sorted(state.nodes.filter(node => node.parentId === null && ownerOf(node.workspaceId) === ownerOf(workspaceId)))
}

/** Every topic in one Workspace, in no particular order. */
export function nodesOfWorkspace(state: MapState, workspaceId: string | null): MapNode[] {
  return state.nodes.filter(node => ownerOf(node.workspaceId) === ownerOf(workspaceId))
}

/** Direct children of one parent, in display order. */
export function childrenOf(state: MapState, parentId: string | null): MapNode[] {
  return sorted(state.nodes.filter(node => node.parentId === parentId))
}

/** Stable display order: explicit position, then title. */
function sorted(nodes: readonly MapNode[]): MapNode[] {
  return [...nodes].sort((left, right) => left.position - right.position || left.title.localeCompare(right.title))
}

/** The root-to-node path, nearest root first. Cycle-safe. */
export function nodePath(state: MapState, nodeId: string): MapNode[] {
  const byId = new Map(state.nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  const path: MapNode[] = []
  let current = byId.get(nodeId)
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return path
}

/** The Workspace a topic belongs to, normalized. */
export function workspaceOfNode(node: MapNode): string | null {
  return ownerOf(node.workspaceId)
}

/** The selection key that opens one Workspace. */
export function workspaceNodeId(workspaceId: string): string {
  return `${WORKSPACE_SELECTION_PREFIX}${workspaceId}`
}

/** The selection key for the ungrouped bucket. */
export function workspaceKey(workspaceId: string | null): string {
  return workspaceId === null ? UNGROUPED_ID : workspaceNodeId(workspaceId)
}

/**
 * The rows that place a selected topic in its lineage, from the top down.
 *
 * One key per level above the topic — every ancestor topic id, root first — and
 * the Workspace row that owns the chain (`workspaceKey`; the ungrouped bucket
 * for a legacy rootless topic). A topic inside the archive also names the
 * archive row it was opened from, right below the in-archive ancestors: the
 * archive is a synthetic row between the Workspace row and the topics it stores,
 * so omitting it would draw the chain through a row the reader never opened.
 * The selected row itself is left out: it carries the selection's own mark, and
 * repeating it here would only draw one row twice.
 * Unknown ids yield no rows, so a view pointing at a deleted node marks nothing.
 * @param state - the map document.
 * @param nodeId - the selected topic.
 * @returns row keys from the outermost container inward; empty when unknown.
 */
export function ancestorRowKeys(state: MapState, nodeId: string): string[] {
  const path = nodePath(state, nodeId)
  if (path.length === 0) return []
  const workspaceId = workspaceOfNode(path[0])
  const rows = path.slice(0, -1).map(node => node.id)
  if (inArchive(state, nodeId) && workspaceId !== null) rows.push(archiveKey(workspaceId))
  rows.push(workspaceKey(workspaceId))
  return rows
}

/** The selection key that would be selected after deleting one topic node. */
export function selectionAfterNodeDeletion(state: MapState, nodeId: string): string | null {
  const node = state.nodes.find(candidate => candidate.id === nodeId)
  if (node === undefined) return null
  return node.parentId ?? workspaceKey(workspaceOfNode(node))
}

/** Whether a selection key names a Workspace (or the ungrouped bucket) rather than a topic. */
export function isWorkspaceSelectionKey(key: string | null): boolean {
  return key !== null && (key === UNGROUPED_ID || key.startsWith(WORKSPACE_SELECTION_PREFIX))
}

/**
 * Read a Workspace selection key.
 * @param key - selection key, or null.
 * @returns the Workspace it names (null for the ungrouped bucket), or undefined
 *   when the key is not a Workspace selection at all.
 */
export function workspaceSelection(key: string | null): { workspaceId: string | null } | undefined {
  if (key === null) return undefined
  if (key === UNGROUPED_ID) return { workspaceId: null }
  if (!key.startsWith(WORKSPACE_SELECTION_PREFIX)) return undefined
  return { workspaceId: key.slice(WORKSPACE_SELECTION_PREFIX.length) }
}

/**
 * The selection key that opens one Workspace's archived row.
 * @param workspaceId - the Workspace whose archive the row opens.
 * @returns the stable `@archive:<workspaceId>` key.
 */
export function archiveKey(workspaceId: string): string {
  return `${ARCHIVE_SELECTION_PREFIX}${workspaceId}`
}

/**
 * Whether a selection key names an archived row.
 * @param key - selection key, or null/undefined.
 * @returns true while the key is one of the archive keys.
 */
export function isArchiveSelectionKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(ARCHIVE_SELECTION_PREFIX)
}

/**
 * Read an archive selection key.
 * @param key - selection key, or null/undefined.
 * @returns the Workspace it opens, or undefined when the key names another row.
 */
export function archiveSelection(key: string | null | undefined): { workspaceId: string } | undefined {
  if (typeof key !== 'string' || !isArchiveSelectionKey(key)) return undefined
  const workspaceId = key.slice(ARCHIVE_SELECTION_PREFIX.length)
  return workspaceId === '' ? undefined : { workspaceId }
}

/* ── spaces ──────────────────────────────────────────────────────────────── */

/** Validate and normalize one space title, rejecting duplicates. */
function cleanSpaceTitle(state: MapState, title: string, selfId: string | null): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) throw new MapError('SPACE_TITLE_EMPTY', 'A space name is required.')
  if (trimmed.length > MAX_SPACE_TITLE) throw new MapError('SPACE_TITLE_LONG', `A space name is limited to ${String(MAX_SPACE_TITLE)} characters.`, { max: MAX_SPACE_TITLE })
  const wanted = trimmed.toLocaleLowerCase()
  if (state.spaces.some(space => space.id !== selfId && space.title.toLocaleLowerCase() === wanted)) {
    throw new MapError('SPACE_TITLE_DUP', 'A space with that name already exists; choose another name.')
  }
  return trimmed
}

/** Read one space, throwing when the caller names a space that is gone. */
function requireSpace(state: MapState, id: string): SpaceRef {
  const space = state.spaces.find(candidate => candidate.id === id)
  if (space === undefined) throw new MapError('SPACE_NOT_FOUND', 'That space no longer exists; refresh and try again.')
  return space
}

/** Spaces in display order. */
export function spaceList(state: MapState): SpaceRef[] {
  return [...state.spaces].sort((left, right) => left.position - right.position || left.title.localeCompare(right.title))
}

/**
 * Create the default space on first use, or repair a broken pointer.
 *
 * Idempotent: a healthy document is returned as the same object, so callers can
 * run it on every load without churning the revision.
 * @param state - the map.
 * @returns the map with exactly one default space.
 */
export function ensureDefaultSpace(state: MapState): MapState {
  const known = new Set(state.spaces.map(space => space.id))
  if (state.defaultSpaceId !== '' && known.has(state.defaultSpaceId)) return state
  const first = spaceList(state)[0]
  if (first !== undefined) {
    return { ...state, version: 2, revision: state.revision + 1, defaultSpaceId: first.id }
  }
  const id = crypto.randomUUID()
  return {
    ...state,
    version: 2,
    revision: state.revision + 1,
    spaces: [{ id, title: DEFAULT_SPACE_TITLE, position: 1, createdAt: new Date().toISOString() }],
    defaultSpaceId: id,
  }
}

/** The effective space of one Workspace: an explicit override, else the default space. */
export function spaceOfWorkspace(state: MapState, workspaceId: string): string {
  const explicit = state.spaceOf[workspaceId]
  if (explicit !== undefined && state.spaces.some(space => space.id === explicit)) return explicit
  return state.defaultSpaceId
}

/** The effective space of one conversation. */
export function spaceOfThread(state: MapState, thread: ThreadRef): string {
  const workspaceId = ownerOf(thread.workspaceId)
  if (workspaceId !== null) return spaceOfWorkspace(state, workspaceId)
  const local = thread.spaceId ?? null
  if (local !== null && state.spaces.some(space => space.id === local)) return local
  return state.defaultSpaceId
}

/** Workspaces of one space, in Host order. */
export function workspacesInSpace(
  state: MapState,
  workspaces: readonly WorkspaceRef[],
  spaceId: string,
): WorkspaceRef[] {
  return workspaces.filter(workspace => spaceOfWorkspace(state, workspace.workspaceId) === spaceId)
}

/** Conversations filed directly under one space's ungrouped row, newest first. */
export function looseThreadsInSpace(state: MapState, spaceId: string): ThreadRef[] {
  return newestFirst(state.threads.filter(thread =>
    thread.nodeId === null
    && ownerOf(thread.workspaceId) === null
    && spaceOfThread(state, thread) === spaceId))
}

/**
 * Selection/memory key of one space's ungrouped row.
 *
 * The default space keeps the historical `@ungrouped` key so a restored view
 * still points at the same place; other spaces get a stable key of their own.
 */
export function looseRowKey(state: MapState, spaceId: string): string {
  return spaceId === state.defaultSpaceId ? UNGROUPED_ID : `${LOOSE_ROW_PREFIX}${spaceId}`
}

/**
 * Create one space.
 *
 * An explicit `id` keeps the transition replayable: when a queued client
 * mutation is re-applied on top of a newer Host document, a regenerated uuid
 * would leave the view's `activeSpace` naming a space that no longer exists.
 * Callers that may replay pass the id they already selected.
 * @param state - the current map.
 * @param input - space title and optional caller-owned id.
 * @returns the updated map plus the created space's id.
 */
export function createSpace(state: MapState, input: { title: string; id?: string }): { state: MapState; id: string } {
  const title = cleanSpaceTitle(state, input.title, null)
  if (state.spaces.length >= MAX_SPACES) throw new MapError('SPACE_LIMIT', `At most ${String(MAX_SPACES)} spaces are supported.`, { max: MAX_SPACES })
  const id = input.id ?? crypto.randomUUID()
  const position = state.spaces.reduce((max, space) => Math.max(max, space.position), 0) + 1
  const next = mutate(state, draft => {
    draft.spaces.push({ id, title, position, createdAt: new Date().toISOString() })
  })
  return { state: next, id }
}

/** Rename one space. The default space may be renamed too. */
export function renameSpace(state: MapState, input: { id: string; title: string }): MapState {
  const space = requireSpace(state, input.id)
  const title = cleanSpaceTitle(state, input.title, space.id)
  if (title === space.title) return state
  return mutate(state, draft => {
    const target = draft.spaces.find(candidate => candidate.id === input.id)
    if (target !== undefined) target.title = title
  })
}

/**
 * Delete one non-default space.
 *
 * Its Workspaces and loose conversations fall back to the default space; the
 * Workspaces themselves, their topics, and the conversations are untouched.
 */
export function deleteSpace(state: MapState, id: string): MapState {
  requireSpace(state, id)
  if (id === state.defaultSpaceId) throw new MapError('DEFAULT_SPACE', 'The default space cannot be deleted; rename it instead.')
  return mutate(state, draft => {
    draft.spaces = draft.spaces.filter(space => space.id !== id)
    for (const [workspaceId, spaceId] of Object.entries(draft.spaceOf)) {
      if (spaceId === id) delete draft.spaceOf[workspaceId]
    }
    for (const thread of draft.threads) {
      if (thread.spaceId === id) delete thread.spaceId
    }
  })
}

/** Move one Workspace into a space (its own space is a no-op). */
export function setWorkspaceSpace(state: MapState, workspaceId: string, spaceId: string): MapState {
  requireSpace(state, spaceId)
  if (spaceOfWorkspace(state, workspaceId) === spaceId) return state
  return mutate(state, draft => {
    if (spaceId === state.defaultSpaceId) delete draft.spaceOf[workspaceId]
    else draft.spaceOf[workspaceId] = spaceId
  })
}

/**
 * Move one loose conversation into a space.
 *
 * Leaving the default space also detaches it from a legacy ungrouped topic: a
 * conversation cannot sit in one space and inside another space's topic tree.
 */
export function setThreadSpace(state: MapState, sessionId: string, spaceId: string): MapState {
  requireSpace(state, spaceId)
  const thread = state.threads.find(candidate => candidate.sessionId === sessionId)
  if (thread === undefined) throw new MapError('NOT_FOUND', 'That conversation no longer exists; refresh and try again.')
  if (ownerOf(thread.workspaceId) !== null) throw new MapError('WORKSPACE', 'Only conversations outside every Workspace can be filed into a space.')
  if (spaceOfThread(state, thread) === spaceId) return state
  return mutate(state, draft => {
    const target = draft.threads.find(candidate => candidate.sessionId === sessionId)
    if (target === undefined) return
    if (spaceId === state.defaultSpaceId) delete target.spaceId
    else {
      target.spaceId = spaceId
      target.nodeId = null
    }
  })
}

/**
 * Reconcile the space organization with the Host's Workspace projection.
 *
 * Runs only once the Workspace list is ready (a pending snapshot would prune
 * live overrides). It drops overrides for Workspaces and spaces that no longer
 * exist, normalizes "explicitly the default space" to the sparse form, and
 * clears a loose conversation's space as soon as a Workspace owns it.
 * @param state - the map.
 * @param workspaces - the Host's Workspace rows.
 * @returns the reconciled map, or the same object when nothing changed.
 */
export function reconcileSpaces(state: MapState, workspaces: readonly WorkspaceRef[]): MapState {
  const ensured = ensureDefaultSpace(state)
  const knownWorkspaces = new Set(workspaces.map(workspace => workspace.workspaceId))
  const knownSpaces = new Set(ensured.spaces.map(space => space.id))
  let changed = ensured !== state

  const spaceOf: Record<string, string> = {}
  for (const [workspaceId, spaceId] of Object.entries(ensured.spaceOf)) {
    if (!knownWorkspaces.has(workspaceId) || !knownSpaces.has(spaceId) || spaceId === ensured.defaultSpaceId) {
      changed = true
      continue
    }
    spaceOf[workspaceId] = spaceId
  }

  const threads = ensured.threads.map(thread => {
    const owned = ownerOf(thread.workspaceId) !== null
    const stale = thread.spaceId !== undefined && thread.spaceId !== null
      && (owned || !knownSpaces.has(thread.spaceId))
    if (!stale) return thread
    changed = true
    const next: ThreadRef = { ...thread }
    delete next.spaceId
    return next
  })

  if (!changed) return state
  return {
    version: 2,
    revision: ensured.revision + 1,
    nodes: ensured.nodes,
    threads,
    spaces: ensured.spaces,
    defaultSpaceId: ensured.defaultSpaceId,
    spaceOf,
    subagentSessionIds: ensured.subagentSessionIds ?? [],
  }
}

/** Every node at or below `nodeId`. */
export function descendantIds(state: MapState, nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of state.nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        grew = true
      }
    }
  }
  return ids
}

/**
 * Depth of one node, counting the node itself.
 *
 * Walks the parent chain with a visited set rather than recursing: the parser
 * accepts a hand-built document whose parent pointers form a loop, and both the
 * UI hit test and the depth ceiling call this on every drag frame, so a cycle
 * must answer with a bounded number instead of exhausting the stack.
 * @param state - the map.
 * @param nodeId - the node to measure.
 * @returns its depth in nodes, `0` when the node is gone.
 */
function depthOf(state: MapState, nodeId: string): number {
  const byId = new Map(state.nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  let current = byId.get(nodeId)
  let depth = 0
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    depth += 1
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return depth
}

/**
 * Height of the deepest subtree under `nodeId`, counting the node itself.
 *
 * Breadth-first over the children map with a visited set: a corrupt document
 * whose parent pointers loop would otherwise recurse forever, and the depth
 * ceiling must stay answerable on bad data.
 * @param state - the map.
 * @param nodeId - the subtree root.
 * @returns its height in nodes, `1` for a leaf or an unknown id.
 */
function heightOf(state: MapState, nodeId: string): number {
  const children = new Map<string, string[]>()
  for (const node of state.nodes) {
    if (node.parentId === null) continue
    const siblings = children.get(node.parentId)
    if (siblings === undefined) children.set(node.parentId, [node.id])
    else siblings.push(node.id)
  }
  const seen = new Set<string>([nodeId])
  let height = 1
  let frontier: string[] = [nodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        next.push(child)
      }
    }
    if (next.length === 0) break
    height += 1
    frontier = next
  }
  return height
}

/** Conversation count per node. */
export function countsByNode(state: MapState): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const thread of state.threads) {
    if (thread.nodeId === null) continue
    counts[thread.nodeId] = (counts[thread.nodeId] ?? 0) + 1
  }
  return counts
}

/**
 * Leap directory name of a supported path.
 * @param path - a POSIX or Windows directory path.
 * @returns the final segment, without a trailing separator.
 */
export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(at + 1)
}

/** Localized labels the Workspace title fallback needs. */
export interface WorkspaceTitleLabels {
  /** Shown for the Host's `default-workspace` placeholder title. */
  defaultWorkspace: string
  /** Shown when neither a title nor a directory name is available. */
  workspaceFallback: string
}

/**
 * The label one Workspace row shows.
 * @param workspace - the Host's Workspace row (title and path).
 * @param labels - localized fallback labels; user data renders verbatim.
 * @returns the stored title, the directory name, or a localized fallback.
 */
export function workspaceDisplayTitle(
  workspace: Pick<WorkspaceRef, 'title' | 'path'>,
  labels: WorkspaceTitleLabels,
): string {
  const title = workspace.title.trim()
  if (title === 'default-workspace') return labels.defaultWorkspace
  if (title !== '') return title
  return pathBaseName(workspace.path) || workspace.path || labels.workspaceFallback
}

/**
 * Read one ISO stamp as epoch milliseconds, treating junk as the far past so a
 * malformed row sorts to the bottom instead of poisoning the comparison.
 * @param iso - the stored time stamp.
 * @returns the stamp in milliseconds.
 */
function stampOf(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Order conversations the way the application's own list reads: latest
 * activity first. A conversation just started through the map has "now" as its
 * stamp, so it leads the list it was started under instead of trailing it.
 * @param threads - the conversations to order.
 * @returns a new array, newest activity first.
 */
function newestFirst(threads: readonly ThreadRef[]): ThreadRef[] {
  return [...threads].sort((left, right) => stampOf(right.updatedAt) - stampOf(left.updatedAt))
}

/** Conversations owned by one topic, newest activity first. */
export function threadsOf(state: MapState, nodeId: string): ThreadRef[] {
  return newestFirst(state.threads.filter(thread => thread.nodeId === nodeId))
}

/** Conversations at the top of one Workspace (no topic), newest activity first. */
export function directThreadsOf(state: MapState, workspaceId: string | null): ThreadRef[] {
  return newestFirst(state.threads.filter(thread =>
    thread.nodeId === null && ownerOf(thread.workspaceId) === ownerOf(workspaceId)))
}

/** One indexed conversation, by session id. */
export function threadOfSession(state: MapState, sessionId: string): ThreadRef | undefined {
  return state.threads.find(thread => thread.sessionId === sessionId)
}

/* ── archive ─────────────────────────────────────────────────────────────── */

/*
 * Archiving is stowing content away, not freezing it: an archived topic is
 * detached from the active tree (`parentId → null`, original parent remembered)
 * and its whole block — descendants and conversations — travels with it, while
 * an archived conversation only gains a mark and keeps its place. Nothing here
 * touches the Host's native archive: archived conversations stay openable,
 * searchable, and runnable.
 */

/** Whether a topic carries an archive mark of its own. */
export function isArchivedNode(node: MapNode): boolean {
  return node.archivedAt !== undefined && node.archivedAt !== ''
}

/** Whether a conversation was archived on its own. */
export function isArchivedThread(thread: ThreadRef): boolean {
  return thread.archivedAt !== undefined && thread.archivedAt !== ''
}

/**
 * The nearest archived ancestor of one topic, the topic itself included.
 *
 * Walks the parent chain with a visited set: a hand-built document may loop, and
 * asking "is this in the archive?" must always answer instead of recursing.
 * @param state - the map.
 * @param nodeId - the topic to inspect.
 * @returns the archived block root, or undefined for an active or unknown topic.
 */
export function archivedRootOf(state: MapState, nodeId: string): MapNode | undefined {
  const byId = new Map(state.nodes.map(node => [node.id, node]))
  const seen = new Set<string>()
  let current = byId.get(nodeId)
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    if (isArchivedNode(current)) return current
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return undefined
}

/**
 * Whether one topic is stored in the archive — marked itself or below a marked
 * ancestor.
 * @param state - the map.
 * @param nodeId - the topic to inspect.
 * @returns true while the topic is archived.
 */
export function inArchive(state: MapState, nodeId: string): boolean {
  return archivedRootOf(state, nodeId) !== undefined
}

/** Every topic the archive hides: each archived root together with its subtree. */
function archivedNodeIds(state: MapState): Set<string> {
  const ids = new Set<string>()
  for (const node of state.nodes) {
    if (!isArchivedNode(node)) continue
    for (const id of descendantIds(state, node.id)) ids.add(id)
  }
  return ids
}

/**
 * The archived block roots of one Workspace, newest archive first.
 *
 * Only the roots: a block is restored and deleted as a whole, so listing its
 * descendants here would offer the same action once per level.
 * @param state - the map.
 * @param workspaceId - the Workspace whose archive is listed.
 * @returns the block roots, newest `archivedAt` first, then by title.
 */
export function archivedRootsOf(state: MapState, workspaceId: string): MapNode[] {
  const wanted = ownerOf(workspaceId)
  return state.nodes
    .filter(node => node.parentId === null && isArchivedNode(node) && ownerOf(node.workspaceId) === wanted)
    .sort((left, right) =>
      stampOf(right.archivedAt ?? '') - stampOf(left.archivedAt ?? '')
      || left.title.localeCompare(right.title))
}

/**
 * Conversations archived on their own, newest activity first.
 *
 * A conversation inside an archived block is deliberately left out: it is
 * restored with the block, not from the "Archived conversations" group.
 * @param state - the map.
 * @param workspaceId - the Workspace whose archive is listed.
 * @returns the independently archived conversations of that Workspace.
 */
export function archivedLooseThreadsOf(state: MapState, workspaceId: string): ThreadRef[] {
  const wanted = ownerOf(workspaceId)
  return newestFirst(state.threads.filter(thread =>
    isArchivedThread(thread)
    && ownerOf(thread.workspaceId) === wanted
    && (thread.nodeId === null || !inArchive(state, thread.nodeId))))
}

/**
 * How much one Workspace has stored in its archive.
 *
 * `nodes` counts archived block roots; `sessions` counts the conversations filed
 * anywhere inside those blocks plus the ones archived on their own — the number
 * the archive row shows.
 * @param state - the map.
 * @param workspaceId - the Workspace to measure.
 * @returns the archived topic and conversation counts.
 */
export function archiveStatsOf(state: MapState, workspaceId: string): { nodes: number; sessions: number } {
  const wanted = ownerOf(workspaceId)
  const roots = archivedRootsOf(state, workspaceId)
  const block = new Set<string>()
  for (const root of roots) {
    for (const id of descendantIds(state, root.id)) block.add(id)
  }
  const sessions = state.threads.filter(thread => {
    if (thread.nodeId !== null && block.has(thread.nodeId)) return true
    return isArchivedThread(thread) && ownerOf(thread.workspaceId) === wanted
  }).length
  return { nodes: roots.length, sessions }
}

/**
 * How much the whole document has stored in its archive.
 *
 * The Host reads this for `map_get_state`: the model tools never see archived
 * content, only these counts, so they can tell "it was put away" from "it is
 * gone".
 * @param state - the map.
 * @returns the archived topic and conversation counts.
 */
export function archiveStats(state: MapState): { nodes: number; sessions: number } {
  let nodes = 0
  for (const node of state.nodes) if (isArchivedNode(node)) nodes += 1
  const hidden = archivedNodeIds(state)
  const sessions = state.threads.filter(thread =>
    isArchivedThread(thread) || (thread.nodeId !== null && hidden.has(thread.nodeId))).length
  return { nodes, sessions }
}

/** Root topics of one Workspace that are not archived, in display order. */
export function activeTopNodesOf(state: MapState, workspaceId: string | null): MapNode[] {
  return topNodesOf(state, workspaceId).filter(node => !isArchivedNode(node))
}

/** Direct children of one parent that are not archived, in display order. */
export function activeChildrenOf(state: MapState, parentId: string | null): MapNode[] {
  return childrenOf(state, parentId).filter(node => !isArchivedNode(node))
}

/** Conversations filed under one topic that are not archived, newest first. */
export function activeThreadsOf(state: MapState, nodeId: string): ThreadRef[] {
  return threadsOf(state, nodeId).filter(thread => !isArchivedThread(thread))
}

/** Conversations directly under one Workspace that are not archived, newest first. */
export function activeDirectThreadsOf(state: MapState, workspaceId: string | null): ThreadRef[] {
  return directThreadsOf(state, workspaceId).filter(thread => !isArchivedThread(thread))
}

/**
 * The document without its archived content.
 *
 * The Host half projects `map_get_state`, node/Workspace counts, and search
 * candidates from this view, so filtering happens once at the data entry instead
 * of at every render site. Archived blocks leave as a whole — their descendants
 * and filed conversations leave with them — while independently archived
 * conversations are dropped on their own.
 * @param state - the map.
 * @returns a view with active nodes and conversations only; other fields shared.
 */
export function activeMapView(state: MapState): MapState {
  const hidden = archivedNodeIds(state)
  return {
    ...state,
    nodes: state.nodes.filter(node => !hidden.has(node.id)),
    threads: state.threads.filter(thread =>
      !isArchivedThread(thread) && (thread.nodeId === null || !hidden.has(thread.nodeId))),
  }
}

/**
 * The archived blocks whose original place is inside one topic's subtree.
 *
 * Archiving a child before its parent used to leave the two blocks side by side:
 * the child was already detached when the parent was archived, so the parent's
 * block no longer contained it. A block is supposed to travel as one thing, so
 * before archiving the topic every independently archived root whose remembered
 * parent chain leads back into the topic's current subtree is folded home first.
 *
 * The remembered parent chain is the original lineage: an archived root's
 * `archivedParentId` may name an active node (that is the anchor), another
 * archived root (keep climbing), or nothing (the item was a Workspace root and is
 * not part of any block). A chain that repeats a node is dirty data; it is left
 * alone as an independent archived item instead of being rebuilt into a cycle.
 * @param state - the map.
 * @param nodeId - the topic about to be archived.
 * @param workspaceId - the Workspace the topic belongs to.
 * @returns chains of archived nodes to restore, topmost first, each ending at
 *   the archived root that has to rejoin the block.
 */
function archivedChainsInside(state: MapState, nodeId: string, workspaceId: string | null): MapNode[][] {
  const byId = new Map(state.nodes.map(node => [node.id, node]))
  const inside = descendantIds(state, nodeId)
  const chains: MapNode[][] = []
  for (const root of state.nodes) {
    if (root.id === nodeId || root.parentId !== null || !isArchivedNode(root)) continue
    // A block can only rejoin the tree it was taken out of; a dirty document that
    // points another Workspace's archive into this subtree is left alone.
    if (ownerOf(root.workspaceId) !== workspaceId) continue
    const chain: MapNode[] = []
    const visited = new Set<string>([root.id])
    let cursor = root.archivedParentId ?? null
    let anchorId: string | null = null
    let broken = false
    while (cursor !== null) {
      const parent = byId.get(cursor)
      if (parent === undefined) {
        broken = true
        break
      }
      if (!isArchivedNode(parent)) {
        anchorId = parent.id
        break
      }
      if (visited.has(parent.id)) {
        broken = true
        break
      }
      visited.add(parent.id)
      chain.unshift(parent)
      cursor = parent.archivedParentId ?? null
    }
    if (broken || anchorId === null) continue
    if (anchorId !== nodeId && !inside.has(anchorId)) continue
    chains.push([...chain, root])
  }
  return chains
}

/**
 * Archive one topic together with its whole block.
 *
 * The topic is detached from the tree (`parentId → null`) and remembers the
 * parent it came from; its descendants and conversations travel with it without
 * marks of their own, and any mark they carried is absorbed — a block is
 * archived, restored, and deleted as one thing. `workspaceId`, `position`, and
 * `updatedAt` are untouched: archiving does not move the topic out of its
 * Workspace, and it is not an edit.
 *
 * Blocks archived earlier but originally inside this subtree are folded home
 * first (see {@link archivedChainsInside}): archiving the parent of an already
 * archived child must absorb that child's block, not leave two parallel archive
 * roots. That also keeps the invariant that an archived root's remembered parent
 * is not itself still archived.
 *
 * Idempotent: a topic already in the archive (itself or below an archived block
 * root) is returned as the same state, so a double click cannot rewrite the
 * remembered parent.
 * @param state - the map.
 * @param nodeId - the block root to archive.
 * @returns the updated map.
 */
export function archiveNode(state: MapState, nodeId: string): MapState {
  const node = requireNode(state, nodeId)
  if (workspaceOfNode(node) === null) throw new MapError('WORKSPACE', 'Only topics inside a Workspace can be archived.')
  if (inArchive(state, nodeId)) return state
  const chains = archivedChainsInside(state, nodeId, workspaceOfNode(node))
  const now = new Date().toISOString()
  return mutate(state, draft => {
    // Fold the detached blocks back into the lineage before the block is read,
    // so `descendantIds` below sees them as part of the topic's subtree.
    for (const chain of chains) {
      for (const folded of chain) {
        const target = draft.nodes.find(candidate => candidate.id === folded.id)
        if (target === undefined) continue
        target.parentId = folded.archivedParentId ?? null
        delete target.archivedAt
        delete target.archivedParentId
      }
    }
    const root = draft.nodes.find(candidate => candidate.id === nodeId)
    if (root === undefined) return
    const block = descendantIds(draft, nodeId)
    root.archivedAt = now
    root.archivedParentId = root.parentId
    root.parentId = null
    for (const member of draft.nodes) {
      if (member.id === nodeId || !block.has(member.id)) continue
      // A hand-built document may carry a mark on a descendant; the block's own
      // mark replaces it, and N1 (marks only on detached roots) holds again.
      delete member.archivedAt
      delete member.archivedParentId
    }
    for (const thread of draft.threads) {
      // Conversations inside the block are covered by the block (N2); one that
      // was archived on its own is absorbed rather than marked twice.
      if (thread.nodeId === null || !block.has(thread.nodeId)) continue
      delete thread.archivedAt
    }
  })
}

/**
 * Archive one conversation on its own.
 *
 * Only the mark changes: `nodeId` and `workspaceId` stay, so unarchiving returns
 * the conversation to the topic it came from. A conversation that already
 * belongs to an archived block cannot be archived again — the block owns it, and
 * its removal would be undone the next time the block is restored.
 * @param state - the map.
 * @param sessionId - the conversation to archive.
 * @returns the updated map.
 */
export function archiveThread(state: MapState, sessionId: string): MapState {
  const thread = threadOfSession(state, sessionId)
  if (thread === undefined) throw new MapError('NO_THREAD', 'That conversation no longer exists; refresh and try again.')
  if (ownerOf(thread.workspaceId) === null) throw new MapError('WORKSPACE', 'Only conversations inside a Workspace can be archived.')
  if (isArchivedThread(thread)) return state
  if (thread.nodeId !== null && inArchive(state, thread.nodeId)) {
    throw new MapError('ARCHIVED', 'The conversation already belongs to an archived topic.')
  }
  const now = new Date().toISOString()
  return mutate(state, draft => {
    const target = draft.threads.find(candidate => candidate.sessionId === sessionId)
    if (target !== undefined) target.archivedAt = now
  })
}

/**
 * The parent a restored block root returns under, or `null` for the Workspace
 * top level.
 *
 * The remembered parent only counts while it exists, is active (a parent that is
 * still archived is released by {@link restoreArchivedNode} before this runs),
 * lives in the same Workspace, is not inside the restored subtree, and leaves
 * the subtree within the depth ceiling.
 * @param state - the map.
 * @param node - the archived block root being restored.
 * @param workspaceId - the Workspace the block belongs to.
 * @returns the parent id to use, or `null` for the top level.
 */
function restoredParentOf(state: MapState, node: MapNode, workspaceId: string | null): string | null {
  const storedParentId = node.archivedParentId ?? null
  if (storedParentId === null) return null
  const parent = state.nodes.find(candidate => candidate.id === storedParentId)
  if (parent === undefined || parent.id === node.id) return null
  if (inArchive(state, parent.id)) return null
  if (workspaceOfNode(parent) !== workspaceId) return null
  if (descendantIds(state, node.id).has(parent.id)) return null
  if (depthOf(state, parent.id) + heightOf(state, node.id) > MAX_DEPTH) return null
  return parent.id
}

/**
 * The positions a restored topic and its destination's children take.
 *
 * The topic goes back to the slot its original `position` named, clamped to the
 * destination's current children, and those children are renumbered around it.
 * Restoring therefore puts the sibling order back instead of shoving the topic to
 * the end of the list it came from. Archived roots are not active siblings and
 * are left out.
 * @param state - the map.
 * @param node - the archived block root being restored.
 * @param parentId - the destination parent; `null` = the Workspace top level.
 * @param workspaceId - the Workspace the block belongs to.
 * @returns node id → new 1-based position.
 */
function restoredPositions(
  state: MapState,
  node: MapNode,
  parentId: string | null,
  workspaceId: string | null,
): Map<string, number> {
  const siblings = sorted(state.nodes.filter(candidate =>
    candidate.id !== node.id
    && candidate.parentId === parentId
    && ownerOf(candidate.workspaceId) === ownerOf(workspaceId)
    && !isArchivedNode(candidate)))
  const wanted = Number.isFinite(node.position) ? node.position - 1 : siblings.length
  const index = Math.max(0, Math.min(siblings.length, Math.floor(wanted)))
  const ordered = [...siblings.slice(0, index), node, ...siblings.slice(index)]
  return new Map(ordered.map((candidate, position) => [candidate.id, position + 1]))
}

/**
 * Restore one archived topic to the tree.
 *
 * The remembered parent wins when it is still usable; otherwise the topic
 * returns to the top of its Workspace. The restored topic takes the sibling slot
 * its original `position` named rather than jumping to the end, so a restore puts
 * the tree back the way it read before the archive.
 *
 * A remembered parent that is itself still archived is restored first: archiving
 * a child before its parent used to leave two independent blocks, and restoring
 * the child alone would silently flatten the lineage. Only an archived block root
 * can be restored — a topic inside a block comes back with the block.
 * @param state - the map.
 * @param nodeId - the archived block root to restore.
 * @returns the updated map.
 */
export function unarchiveNode(state: MapState, nodeId: string): MapState {
  return restoreArchivedNode(state, nodeId, new Set<string>())
}

/**
 * Restore one block root, releasing the archived block that holds its remembered
 * parent first.
 *
 * `restoring` is the cycle guard: dirty documents can record two archived roots
 * as each other's remembered parent, and that must not recurse forever. When a
 * remembered parent is still archived after the cascade (the loop case), it is
 * treated as unavailable and the topic falls back to the Workspace top level,
 * exactly like a deleted parent. Restoring the same root twice inside one
 * cascade is a no-op.
 */
function restoreArchivedNode(state: MapState, nodeId: string, restoring: Set<string>): MapState {
  const node = requireNode(state, nodeId)
  if (!isArchivedNode(node)) throw new MapError('NOT_ARCHIVED', 'That topic is not archived; there is nothing to restore.')
  if (restoring.has(nodeId)) return state
  restoring.add(nodeId)
  let working = state
  const storedParentId = node.archivedParentId ?? null
  if (storedParentId !== null) {
    const storedParent = working.nodes.find(candidate => candidate.id === storedParentId)
    const archivedAncestor = storedParent === undefined ? undefined : archivedRootOf(working, storedParent.id)
    if (archivedAncestor !== undefined && archivedAncestor.id !== nodeId) {
      working = restoreArchivedNode(working, archivedAncestor.id, restoring)
    }
  }
  const current = working.nodes.find(candidate => candidate.id === nodeId)
  // Dirty data can nest the restored root inside the block the cascade released.
  if (current === undefined || !isArchivedNode(current)) return working
  const workspaceId = workspaceOfNode(current)
  const parentId = restoredParentOf(working, current, workspaceId)
  const positions = restoredPositions(working, current, parentId, workspaceId)
  return mutate(working, draft => {
    for (const target of draft.nodes) {
      const position = positions.get(target.id)
      if (position !== undefined) target.position = position
    }
    const restored = draft.nodes.find(candidate => candidate.id === nodeId)
    if (restored === undefined) return
    restored.parentId = parentId
    delete restored.archivedAt
    delete restored.archivedParentId
  })
}

/**
 * Restore one independently archived conversation.
 *
 * Only the mark is cleared: its `nodeId` still names the topic it was filed
 * under, so it reappears exactly where it was archived from. A conversation
 * archived as part of a topic block is restored by unarchiving the block.
 * @param state - the map.
 * @param sessionId - the conversation to restore.
 * @returns the updated map.
 */
export function unarchiveThread(state: MapState, sessionId: string): MapState {
  const thread = threadOfSession(state, sessionId)
  if (thread === undefined) throw new MapError('NO_THREAD', 'That conversation no longer exists; refresh and try again.')
  if (!isArchivedThread(thread)) throw new MapError('NOT_ARCHIVED', 'That conversation is not archived; there is nothing to restore.')
  return mutate(state, draft => {
    const target = draft.threads.find(candidate => candidate.sessionId === sessionId)
    if (target !== undefined) delete target.archivedAt
  })
}

/**
 * The row one conversation is filed under, as plain data.
 *
 * This is the single source of truth for the tree's position: a conversation
 * filed under a topic belongs to that topic; one filed directly under a
 * Workspace belongs to the Workspace row; one archived on its own is reached
 * through its Workspace's archive row; and an ungrouped conversation belongs to
 * its space's ungrouped row. A stale index may still name a deleted topic, so
 * the topic only wins while it exists.
 *
 * It lives in the model rather than in `session-home.ts` because both the tree's
 * position and the composer-side home line need the same answer, and that policy
 * module already imports this one (one row, two readers, no second rule).
 * @param state - the map.
 * @param sessionId - the conversation, or null for "nothing open".
 * @returns its home row, or undefined when the index does not know the conversation.
 */
export function sessionHomeRow(
  state: MapState,
  sessionId: string | null,
): { spaceId: string; selection: string; nodeId: string | null; workspaceId: string | null } | undefined {
  if (sessionId === null) return undefined
  const thread = threadOfSession(state, sessionId)
  if (thread === undefined) return undefined
  const spaceId = spaceOfThread(state, thread)
  const workspaceId = ownerOf(thread.workspaceId)
  // A conversation archived on its own is reached through its Workspace's
  // archive row; one that travelled with an archived topic keeps that topic as
  // its home, so the chain reads `工作区 → 已归档 → 主题`.
  if (isArchivedThread(thread) && (thread.nodeId === null || !inArchive(state, thread.nodeId))) {
    return workspaceId === null
      ? { spaceId, selection: looseRowKey(state, spaceId), nodeId: null, workspaceId: null }
      : { spaceId, selection: archiveKey(workspaceId), nodeId: null, workspaceId }
  }
  if (thread.nodeId !== null) {
    const node = state.nodes.find(candidate => candidate.id === thread.nodeId)
    if (node !== undefined) {
      return { spaceId, selection: node.id, nodeId: node.id, workspaceId: workspaceId ?? null }
    }
  }
  if (workspaceId !== null) {
    return { spaceId, selection: workspaceKey(workspaceId), nodeId: null, workspaceId }
  }
  return { spaceId, selection: looseRowKey(state, spaceId), nodeId: null, workspaceId: null }
}

/**
 * The row selection a conversation makes active.
 *
 * Reading a conversation inside the map means being at its home (see
 * {@link sessionHomeRow}); the tree's position is derived from it. An ungrouped
 * conversation resolves to its space's ungrouped row rather than "no selection":
 * the tree has to show where the conversation really is, and leaving the reader
 * in an unrelated branch is the one thing this rule exists to prevent.
 * @param state - the map.
 * @param thread - the conversation that was opened.
 * @returns the row key to activate, or null when the index does not know it.
 */
export function selectionOfThread(state: MapState, thread: ThreadRef): string | null {
  return sessionHomeRow(state, thread.sessionId)?.selection ?? null
}

/**
 * Where one Session lives in the map, as far as the index and the Host know.
 *
 * Native navigation (a sidebar row, a shortcut, another plugin) arrives with a
 * Session identity; the map has to land on the same place instead of keeping an
 * unrelated strip of columns on screen. A Session the index already files is
 * located by its thread — the topic it is filed under, the archive row of the
 * Workspace when it was archived on its own, its Workspace row, or the ungrouped
 * row of its own space. One the index has not seen yet is located by
 * the Host's Workspace accounting; an unknown Session with no Workspace has no
 * place to land and returns `undefined`.
 *
 * An ungrouped conversation resolves to its space's ungrouped row rather than
 * "no selection": navigation from outside the map is an explicit destination,
 * and leaving the reader's old (possibly other-space) selection behind would mix
 * two places on screen.
 * @param state - the map.
 * @param sessionId - the Session to locate.
 * @param workspaceId - its Host Workspace when the caller knows it, `null` when
 *   the Host accounts it to none, `undefined` when nothing names one.
 * @returns the space and the row key to select, or undefined for an unknown Session.
 */
export function homeOfSession(
  state: MapState,
  sessionId: string,
  workspaceId?: string | null,
): { spaceId: string; selection: string } | undefined {
  const row = sessionHomeRow(state, sessionId)
  if (row !== undefined) return { spaceId: row.spaceId, selection: row.selection }
  if (workspaceId === undefined) return undefined
  if (workspaceId === null) {
    return { spaceId: state.defaultSpaceId, selection: looseRowKey(state, state.defaultSpaceId) }
  }
  return { spaceId: spaceOfWorkspace(state, workspaceId), selection: workspaceKey(workspaceId) }
}

/** Validate a user-supplied node title. */
function cleanTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) throw new MapError('TITLE_EMPTY', 'A topic name is required.')
  if (trimmed.length > MAX_TITLE) throw new MapError('TITLE_LONG', `A topic name is limited to ${String(MAX_TITLE)} characters.`, { max: MAX_TITLE })
  return trimmed
}

/** Validate a user-supplied description. */
function cleanDescription(description: string): string {
  if (description.length > MAX_DESCRIPTION) throw new MapError('DESCRIPTION_LONG', `A description is limited to ${String(MAX_DESCRIPTION)} characters.`, { max: MAX_DESCRIPTION })
  return description
}

/**
 * Create a topic node.
 *
 * A child inherits its parent's Workspace — a topic never straddles two
 * Workspaces — while a top-level topic takes the Workspace named by the caller.
 * @param state - the current map.
 * @param input - parent (null for a workspace root), owning Workspace, and copy.
 * @returns the updated map plus the created node's id.
 */
export function createNode(
  state: MapState,
  input: { parentId: string | null; workspaceId?: string | null; title: string; description?: string; id?: string },
): { state: MapState; id: string } {
  const title = cleanTitle(input.title)
  const description = cleanDescription(input.description ?? '')
  let workspaceId: string | null
  if (input.parentId !== null) {
    const parent = requireNode(state, input.parentId)
    // The archive does not grow: a topic is put away with its block and comes
    // back as a whole, so nothing may be created under an archived parent.
    if (inArchive(state, parent.id)) {
      throw new MapError('ARCHIVED', 'The parent topic is archived; unarchive it first.')
    }
    workspaceId = workspaceOfNode(parent)
    if (input.workspaceId !== undefined && ownerOf(input.workspaceId) !== workspaceId) {
      throw new MapError('WORKSPACE', 'A child topic must live in the same Workspace as its parent.')
    }
  } else {
    workspaceId = ownerOf(input.workspaceId)
  }
  if (state.nodes.length >= MAX_NODES) throw new MapError('LIMIT', `At most ${String(MAX_NODES)} nodes are supported.`, { max: MAX_NODES })
  const parentDepth = input.parentId === null ? 0 : depthOf(state, input.parentId)
  if (parentDepth + 1 > MAX_DEPTH) throw new MapError('DEPTH', `At most ${String(MAX_DEPTH)} levels are supported.`, { max: MAX_DEPTH })
  const id = input.id ?? crypto.randomUUID()
  const siblings = state.nodes.filter(node =>
    node.parentId === input.parentId && ownerOf(node.workspaceId) === workspaceId)
  const position = siblings.reduce((max, node) => Math.max(max, node.position), 0) + 1
  const now = new Date().toISOString()
  const next = mutate(state, draft => {
    draft.nodes.push({
      id, parentId: input.parentId, title, description, position,
      createdAt: now, updatedAt: now, workspaceId,
    })
  })
  return { state: next, id }
}

/** Rename or re-describe one node. */
export function updateNode(state: MapState, input: { id: string; title: string; description: string }): MapState {
  requireNode(state, input.id)
  const title = cleanTitle(input.title)
  const description = cleanDescription(input.description)
  return mutate(state, draft => {
    const node = draft.nodes.find(candidate => candidate.id === input.id)
    if (node === undefined) return
    node.title = title
    node.description = description
    node.updatedAt = new Date().toISOString()
  })
}

/**
 * One reason a move cannot be committed, in the shape every caller reports.
 *
 * The code is the same vocabulary {@link MapError} uses, so a hit test, a dialog,
 * and a model tool can all explain the same refusal without committing anything.
 */
export interface MoveIssue {
  readonly code: string
  readonly message: string
  /** Values the client dictionary interpolates (limits, names). */
  readonly params?: Readonly<Record<string, string | number>>
}

/**
 * Why one node cannot be re-parented where the caller asked, or `null` when the
 * move is committable.
 *
 * This is the one judgement the model, the Web UI, and the model tools share:
 * {@link moveNode} throws exactly the issue this returns, and a drag hit test can
 * ask without touching the document. Issues are reported in the order a caller
 * meets them — missing node, then a node or target parent in the archive, then a
 * missing or foreign target parent, then the cycle the re-parent would create,
 * and finally the depth ceiling.
 * @param state - the map.
 * @param id - the node to move.
 * @param parentId - the target parent; `null` = the Workspace root.
 * @returns the blocking issue, or `null` when the move may be committed.
 */
export function moveNodeIssue(state: MapState, id: string, parentId: string | null): MoveIssue | null {
  const node = state.nodes.find(candidate => candidate.id === id)
  if (node === undefined) return { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' }
  // Entering and leaving the archive is only ever the archive/unarchive action:
  // a drag must not be able to move something in or out of a block.
  if (inArchive(state, id)) return { code: 'ARCHIVED', message: 'The topic is archived; unarchive it first.' }
  const workspaceId = workspaceOfNode(node)
  if (parentId !== null) {
    const parent = state.nodes.find(candidate => candidate.id === parentId)
    if (parent === undefined) return { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' }
    if (inArchive(state, parent.id)) return { code: 'ARCHIVED', message: 'The target topic is archived; unarchive it first.' }
    if (workspaceOfNode(parent) !== workspaceId) {
      return { code: 'WORKSPACE', message: 'A node cannot move under a node of a different Workspace.' }
    }
    if (descendantIds(state, id).has(parentId)) {
      return { code: 'CYCLE', message: 'A node cannot move under itself or its descendants.' }
    }
  }
  const targetDepth = parentId === null ? 0 : depthOf(state, parentId)
  if (targetDepth + heightOf(state, id) > MAX_DEPTH) return { code: 'DEPTH', message: `At most ${String(MAX_DEPTH)} levels are supported.`, params: { max: MAX_DEPTH } }
  return null
}

/** Re-parent one node inside its own Workspace, rejecting cycles and over-deep moves. */
export function moveNode(state: MapState, id: string, parentId: string | null): MapState {
  const issue = moveNodeIssue(state, id, parentId)
  if (issue !== null) throw new MapError(issue.code, issue.message, issue.params)
  const workspaceId = workspaceOfNode(requireNode(state, id))
  const siblings = state.nodes.filter(candidate =>
    candidate.parentId === parentId && candidate.id !== id && ownerOf(candidate.workspaceId) === workspaceId)
  const position = siblings.reduce((max, candidate) => Math.max(max, candidate.position), 0) + 1
  return mutate(state, draft => {
    const target = draft.nodes.find(candidate => candidate.id === id)
    if (target === undefined) return
    target.parentId = parentId
    target.position = position
    target.updatedAt = new Date().toISOString()
  })
}

/**
 * Move one node to an exact slot among the destination parent's children.
 *
 * `insertBefore` semantics, borrowed from the DOM: `beforeNodeId` names the
 * sibling the node is placed in front of, and omitting it appends — which is
 * exactly {@link moveNode}. Re-parenting and re-ordering are therefore the same
 * operation, and the target's children are renumbered `position = 1..n`, which
 * also repairs the duplicate positions older documents may carry.
 *
 * The judgement is {@link moveNodeIssue}, so a missing node, a foreign
 * Workspace, a cycle, or an over-deep target is refused with the same code and
 * wording as a plain re-parent. An anchor that is not a child of the destination
 * parent is refused as `ANCHOR` rather than silently treated as "append": a drop
 * that lands somewhere other than the drawn insertion line is worse than a
 * visible refusal. Dropping a node where it already is reports success without
 * writing — the same state comes back, revision and all.
 * @param state - the map.
 * @param id - the node to move.
 * @param parentId - the destination parent; `null` = the Workspace root.
 * @param beforeNodeId - the sibling to insert before; omitted = append.
 * @returns the updated map, or the same state when nothing had to change.
 */
export function insertNodeBefore(
  state: MapState,
  id: string,
  parentId: string | null,
  beforeNodeId?: string,
): MapState {
  const issue = moveNodeIssue(state, id, parentId)
  if (issue !== null) throw new MapError(issue.code, issue.message, issue.params)
  const moved = requireNode(state, id)
  const workspaceId = workspaceOfNode(moved)
  const siblings = sorted(state.nodes.filter(candidate =>
    candidate.parentId === parentId && ownerOf(candidate.workspaceId) === workspaceId))
  const anchor = beforeNodeId === undefined
    ? undefined
    : siblings.find(candidate => candidate.id === beforeNodeId)
  if (beforeNodeId !== undefined && anchor === undefined) {
    throw new MapError('ANCHOR', 'The anchor node is not under the target parent.')
  }
  // The destination parent is already known to be active, so an archived anchor
  // can only come from a hand-built document; it is still refused rather than
  // letting a drop re-order the active tree around a stored block.
  if (anchor !== undefined && inArchive(state, anchor.id)) {
    throw new MapError('ARCHIVED', 'The anchor topic is archived; unarchive it first.')
  }
  // `insertBefore(x, x)` keeps x exactly where it is: nothing to recompute.
  if (anchor !== undefined && anchor.id === id) return state

  const withoutMoved = siblings.filter(candidate => candidate.id !== id)
  // The anchor is a sibling and is not the moved node, so it survives the filter
  // above and this index always names a real slot.
  const at = anchor === undefined
    ? withoutMoved.length
    : withoutMoved.findIndex(candidate => candidate.id === anchor.id)
  const ordered = [...withoutMoved.slice(0, at), moved, ...withoutMoved.slice(at)]
  if (moved.parentId === parentId && ordered.length === siblings.length
    && ordered.every((candidate, index) => candidate.id === siblings[index].id)) {
    return state
  }

  return mutate(state, draft => {
    const positions = new Map(ordered.map((candidate, index) => [candidate.id, index + 1]))
    for (const node of draft.nodes) {
      const position = positions.get(node.id)
      if (position !== undefined) node.position = position
    }
    const target = draft.nodes.find(candidate => candidate.id === id)
    if (target === undefined) return
    target.parentId = parentId
    target.updatedAt = new Date().toISOString()
  })
}

/** Delete a leaf node; its conversations stay in the Workspace, unassigned. */
export function deleteNode(state: MapState, id: string): MapState {
  requireNode(state, id)
  if (state.nodes.some(node => node.parentId === id)) throw new MapError('HAS_CHILDREN', 'Move or delete the child topics first.')
  return deleteNodeSubtree(state, id)
}

/**
 * Delete one node together with every node below it.
 *
 * A conversation is never deleted here: one filed under any removed node is
 * left in the index with `nodeId: null`, exactly as {@link deleteNode} does for
 * a leaf, so the map keeps showing it directly under its Workspace row (or in
 * the space's ungrouped bucket for a rootless topic). Deleting inside the
 * archive is the one exception: the freed conversations stay archived, becoming
 * top-level archived conversations, because a cleanup of old topics must not
 * spill stale conversations back into the active tree. The whole subtree leaves
 * in one revision bump, which is what lets the UI confirm one action and remove
 * every level at once.
 * @param state - the map.
 * @param id - the subtree root to remove.
 * @returns the updated map.
 */
export function deleteNodeSubtree(state: MapState, id: string): MapState {
  const node = requireNode(state, id)
  const doomed = descendantIds(state, id)
  const keepArchived = workspaceOfNode(node) !== null && inArchive(state, id)
  const now = keepArchived ? new Date().toISOString() : ''
  return mutate(state, draft => {
    draft.nodes = draft.nodes.filter(node => !doomed.has(node.id))
    for (const thread of draft.threads) {
      if (thread.nodeId === null || !doomed.has(thread.nodeId)) continue
      thread.nodeId = null
      // A conversation that was archived on its own already carries the mark;
      // one that only lived inside the block gains it now that the block is
      // gone, so it does not resurface in the active tree.
      if (keepArchived && !isArchivedThread(thread)) thread.archivedAt = now
    }
  })
}

/**
 * What deleting one subtree would remove, for the confirmation copy.
 *
 * `nodes` counts the descendants below the target (the copy reads "n more nodes
 * below it"), not the target itself. Counts are read from the index, so a
 * conversation the map has never seen is not counted — it could not have been
 * filed under a node either. An unknown id yields zeros instead of throwing:
 * the dialog may render one tick after another writer removed the node.
 * @param state - the map.
 * @param id - the subtree root.
 * @returns the descendant-node and filed-conversation counts.
 */
export function subtreeDeletionSummary(state: MapState, id: string): { nodes: number; conversations: number } {
  const doomed = descendantIds(state, id)
  let conversations = 0
  for (const thread of state.threads) {
    if (thread.nodeId !== null && doomed.has(thread.nodeId)) conversations += 1
  }
  return { nodes: Math.max(doomed.size - 1, 0), conversations }
}

/**
 * Why one conversation cannot be filed under the named node, or `null` when the
 * move is committable.
 *
 * Mirrors what {@link assignThreads} enforces and adds the subagent refusal the
 * model was missing: a child Session is reached from its parent conversation, so
 * the map gives it no row and filing one under a node is meaningless. Archived
 * conversations and archived target topics are refused as well — the archive is
 * entered and left only through its own actions. An
 * unaccounted conversation (`workspaceId === undefined`) and one the index has
 * never seen stay permissive — there is nothing to file yet.
 * @param state - the map.
 * @param sessionId - the conversation to file.
 * @param nodeId - the target node; `null` = directly under its Workspace.
 * @returns the blocking issue, or `null` when the move may be committed.
 */
export function assignThreadIssue(state: MapState, sessionId: string, nodeId: string | null): MoveIssue | null {
  const node = nodeId === null ? undefined : state.nodes.find(candidate => candidate.id === nodeId)
  if (nodeId !== null && node === undefined) return { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' }
  const thread = state.threads.find(candidate => candidate.sessionId === sessionId)
  // A subagent child never becomes a row of its own, so it can never be a row
  // under a node either: it is reached from its parent conversation instead.
  if (thread?.origin === 'subagent' || isRecordedSubagent(state, sessionId)) {
    return { code: 'SUBAGENT', message: 'A subagent conversation cannot be filed under a topic.' }
  }
  // The archive is not a drag destination either: an archived conversation only
  // leaves through 「取消归档」, and an archived topic only receives the block it
  // already owns. A conversation filed inside an archived block carries no mark
  // of its own (N2), so being below a marked ancestor counts as archived too.
  if (thread !== undefined
    && (isArchivedThread(thread) || (thread.nodeId !== null && inArchive(state, thread.nodeId)))) {
    return { code: 'ARCHIVED', message: 'The conversation is archived; unarchive it first.' }
  }
  if (node !== undefined && inArchive(state, node.id)) {
    return { code: 'ARCHIVED', message: 'The target topic is archived; unarchive it first.' }
  }
  if (thread === undefined || thread.workspaceId === undefined || node === undefined) return null
  const nodeWorkspace = workspaceOfNode(node)
  if (ownerOf(thread.workspaceId) !== nodeWorkspace) {
    return { code: 'WORKSPACE', message: 'A conversation can only be filed under a node of its own Workspace.' }
  }
  // A legacy rootless topic lives in the default space only, so a loose
  // conversation filed there must not belong to another space.
  if (nodeWorkspace === null && spaceOfThread(state, thread) !== state.defaultSpaceId) {
    return { code: 'SPACE', message: 'Only ungrouped conversations in the default space can be filed under the ungrouped topic.' }
  }
  return null
}

/**
 * Set the topic each named conversation is filed under. `nodeId === null`
 * leaves the conversation directly under its Workspace. A conversation can only
 * be filed under a topic of the Workspace that accounts for it.
 *
 * Every id is judged before the document is touched, so a rejected batch leaves
 * the map exactly as it was, and the refusal comes from
 * {@link assignThreadIssue} — the same judgement a drag hit test reads.
 */
export function assignThreads(state: MapState, sessionIds: readonly string[], nodeId: string | null): MapState {
  const node = nodeId === null ? undefined : requireNode(state, nodeId)
  const nodeWorkspace = node === undefined ? undefined : workspaceOfNode(node)
  for (const sessionId of sessionIds) {
    const issue = assignThreadIssue(state, sessionId, nodeId)
    if (issue !== null) throw new MapError(issue.code, issue.message, issue.params)
  }
  const wanted = new Set(sessionIds)
  return mutate(state, draft => {
    for (const thread of draft.threads) {
      if (!wanted.has(thread.sessionId)) continue
      thread.nodeId = nodeId
      if (node !== undefined) {
        thread.workspaceId = nodeWorkspace
        if (nodeWorkspace !== null) delete thread.spaceId
      }
    }
  })
}

/**
 * Merge the visible conversation catalog into the index, preserving ownership.
 * New conversations are filed under the Workspace the Host accounts them to;
 * a conversation created by branching is filed beside the conversation it
 * branched from; existing ones keep their topic and refresh their title.
 *
 * Visibility is applied here rather than by the caller because this is also
 * where a subagent child becomes a durable fact: the child is recorded in
 * {@link MapState.subagentSessionIds} while the catalog still reports its
 * `origin`, and only then dropped — the Host half must reject filing one under a
 * node later, after the row (which never existed) and even the catalog row are
 * gone.
 * @param state - the map.
 * @param sessions - the whole catalog, unfiltered.
 * @param openSessionId - the conversation currently open, if any.
 * @param owners - session id to owning Workspace id (null for ungrouped), when known.
 */
export function syncThreads(
  state: MapState,
  sessions: readonly SessionSummaryLike[],
  openSessionId: string | null = null,
  owners?: ReadonlyMap<string, string | null>,
): MapState {
  return mutate(state, draft => {
    const byId = new Map(draft.threads.map(thread => [thread.sessionId, thread]))
    const recorded = new Set(draft.subagentSessionIds ?? [])
    const now = new Date().toISOString()
    /**
     * Rows this pass created for a Session that names a source conversation.
     *
     * A fork is an ordinary conversation with a `parentId` (subagent children
     * were filtered out above), and the native branch action opens the child
     * immediately — so the reader expects it where its source lives, not at the
     * Workspace root. The inheritance itself runs after the whole catalog has
     * been read: the source may be another row this very pass creates, in any
     * order, and only rows created here may inherit (a row the map already files
     * keeps whatever topic the reader gave it).
     */
    const branched = new Map<string, { thread: ThreadRef; from: string }>()
    for (const session of sessions) {
      // Record before deciding visibility: a subagent child is exactly the row
      // that will never be stored, so this is the only chance to keep the fact.
      if (session.origin === 'subagent' && !recorded.has(session.id)) {
        recorded.add(session.id)
        draft.subagentSessionIds = [...(draft.subagentSessionIds ?? []), session.id]
      }
      if (!conversationVisible(session, openSessionId)) continue
      const title = session.displayTitle ?? session.title ?? session.id
      // Keep the Host's own activity stamp when it offers one: a row's age has
      // to describe the conversation, not the last time this plugin synced.
      const stamp = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
        ? new Date(session.updatedAt).toISOString()
        : now
      const owned = owners !== undefined && owners.has(session.id) ? owners.get(session.id) ?? null : undefined
      const existing = byId.get(session.id)
      if (existing === undefined) {
        const created: ThreadRef = {
          sessionId: session.id, nodeId: null, title, updatedAt: stamp, importedAt: now, workspaceId: owned,
        }
        // Only a row that carries an origin writes one: an absent origin is not
        // the same claim as an empty one, and old documents stay untouched.
        if (session.origin !== undefined) created.origin = session.origin
        draft.threads.push(created)
        byId.set(session.id, created)
        // A missing, empty, or self-referencing parent is not a source: it must
        // not become a destination the row can never inherit from.
        const from = session.parentId
        if (typeof from === 'string' && from !== '' && from !== session.id) {
          branched.set(session.id, { thread: created, from })
        }
        continue
      }
      existing.title = title
      existing.updatedAt = stamp
      if (owned !== undefined) existing.workspaceId = owned
      if (session.origin !== undefined) existing.origin = session.origin
    }
    // Resolve the new branches parent-first. `placed` makes the walk linear, and
    // `path` breaks a malformed parent chain instead of recursing forever.
    const placed = new Set<string>()
    const placeBranch = (sessionId: string, path: Set<string>): void => {
      const branch = branched.get(sessionId)
      if (branch === undefined || placed.has(sessionId) || path.has(sessionId)) return
      path.add(sessionId)
      // The source can be a row this same pass created; place it first so the
      // child inherits the final answer rather than the blank starting point.
      if (branched.has(branch.from)) placeBranch(branch.from, path)
      path.delete(sessionId)
      placed.add(sessionId)
      const source = byId.get(branch.from)
      if (source === undefined) return
      const target = branch.thread
      // The Host attaches a fork to its source's Workspace, but the Workspace
      // list can lag the catalog by one snapshot. Inheriting the source's owner
      // keeps the topic below from being dropped by the reconciliation that
      // follows, without ever overriding an owner the Host did report.
      if (target.workspaceId === undefined && source.workspaceId !== undefined) {
        target.workspaceId = source.workspaceId
      }
      const owner = ownerOf(target.workspaceId)
      if (target.nodeId === null && source.nodeId !== null) {
        const node = draft.nodes.find(candidate => candidate.id === source.nodeId)
        // A topic only ever holds conversations of its own Workspace.
        if (node !== undefined && ownerOf(node.workspaceId) === owner) target.nodeId = node.id
      }
      // A loose conversation is held by its source's plugin-local space; the
      // legacy rootless bucket is the default space, which needs no field.
      if (owner === null && target.spaceId === undefined && source.spaceId !== undefined) {
        target.spaceId = source.spaceId
      }
    }
    for (const sessionId of branched.keys()) placeBranch(sessionId, new Set())
  })
}

/**
 * Run one catalog sync end to end: index, prune, and report what stayed.
 *
 * The two passes have an order that must not be improvised — the whole catalog
 * has to reach {@link syncThreads} so a subagent child is recorded before it is
 * dropped, while only the visible rows may be the {@link pruneMissing} target.
 * A caller that filtered first would still render identically and silently stop
 * recording, so the pair lives here and callers pass the unfiltered catalog.
 * @param state - the stored document.
 * @param catalog - the whole catalog, unfiltered.
 * @param options - the open conversation and the Workspace accounting, when known.
 * @returns the synced document and the rows the map gives a row to.
 */
export function syncCatalog(
  state: MapState,
  catalog: readonly SessionSummaryLike[],
  options: { readonly openSessionId?: string | null; readonly owners?: ReadonlyMap<string, string | null> } = {},
): { readonly state: MapState; readonly visible: SessionSummaryLike[] } {
  const openSessionId = options.openSessionId ?? null
  const visible = indexableSessions(catalog, openSessionId)
  const synced = syncThreads(state, catalog, openSessionId, options.owners)
  return { state: pruneMissing(synced, new Set(visible.map(row => row.id))), visible }
}

/**
 * Drop indexed conversations the catalog no longer lists.
 *
 * The subagent ledger is not this function's business: {@link syncThreads}
 * records a child while the catalog still reports its origin, which happens
 * before a row could exist here.
 * @param state - the map.
 * @param liveIds - ids the catalog still lists.
 * @returns the map without those rows, or the input when nothing changed.
 */
export function pruneMissing(state: MapState, liveIds: ReadonlySet<string>): MapState {
  // Every production path builds a `MapState` through `mutate`, which defines
  // this field; a document read from JSON gets `[]` from `parseMapState`. An
  // object without it is therefore a programming error, and pruning there would
  // destroy the only evidence of which conversations were subagents.
  if (state.subagentSessionIds === undefined) return state
  if (state.threads.every(thread => liveIds.has(thread.sessionId))) return state
  return mutate(state, draft => {
    draft.threads = draft.threads.filter(thread => liveIds.has(thread.sessionId))
  })
}

/**
 * Whether the map recorded one Session as a subagent child.
 *
 * Membership survives the row: see {@link MapState.subagentSessionIds}.
 * @param state - the map.
 * @param sessionId - the Session to classify.
 * @returns true when the id was recorded as a subagent.
 */
export function isRecordedSubagent(state: MapState, sessionId: string): boolean {
  return state.subagentSessionIds?.includes(sessionId) === true
}

/**
 * Whether one Session is a conversation the map gives a row to.
 *
 * Mirrors the shipped sidebar: a subagent child is reached from its parent, so
 * it never becomes a row of its own — not even while it is the open Session.
 * Everything else follows the blank rule: a created-but-unused Session counts
 * only while it is the open one, so abandoning a provisional row removes it
 * instead of leaving an invalid conversation behind.
 * @param session - one catalog row.
 * @param openSessionId - the conversation currently open, if any.
 * @returns true when the row may appear in the index.
 */
export function conversationVisible(session: SessionSummaryLike, openSessionId: string | null): boolean {
  if (session.origin === 'subagent') return false
  return session.blank !== true || session.id === openSessionId
}

/**
 * Drop the sessions that are not conversations yet.
 *
 * The client keeps a created-but-unused session (a "blank" one) in its catalog
 * and leaves the filtering to consumers: only the selected blank entry is shown,
 * and even that stops being shown once focus moves on. Following the same rule
 * keeps never-started sessions out of the index. Subagent children are dropped
 * too, for a different reason: the map gives them no row, and their parent's row
 * carries their state.
 * @param sessions - the catalog rows, in host order.
 * @param openSessionId - the conversation currently open, if any.
 * @returns the rows worth indexing.
 */
export function indexableSessions(sessions: readonly SessionSummaryLike[], openSessionId: string | null): SessionSummaryLike[] {
  return sessions.filter(session => conversationVisible(session, openSessionId))
}

/**
 * Nearest ancestor conversation the map gives a row to.
 *
 * A subagent child is located by its parent's row, never by itself. A row the
 * catalog does not know, and a missing or empty parent pointer, stop the walk at
 * the last conversation it could name; a cyclic parent chain ends it on the
 * conversation the walk started from. Either way the caller never loops and
 * never invents an ancestor.
 * @param byId - catalog rows by session id, as the client holds them.
 * @param sessionId - the Session to resolve.
 * @returns the id of the nearest visible ancestor, or the id the walk had to stop on.
 */
export function visibleAncestorOf(
  byId: Readonly<Record<string, { origin?: string; parentId?: string | null } | undefined>>,
  sessionId: string,
): string {
  const seen = new Set<string>()
  let cursor = sessionId
  while (!seen.has(cursor)) {
    seen.add(cursor)
    const row = byId[cursor]
    if (row === undefined || row.origin !== 'subagent') return cursor
    const parent = row.parentId
    if (parent === undefined || parent === null || parent === '') return cursor
    cursor = parent
  }
  return sessionId
}

/** One session's owning Workspace in the current Host projection. */
function membershipOf(workspaces: readonly WorkspaceRef[]): Map<string, string> {
  const membership = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) membership.set(sessionId, workspace.workspaceId)
  }
  return membership
}

/**
 * Reconcile the map with the Host's Workspace projection.
 *
 * Three things happen here, in order:
 * 1. A topic persisted before Workspaces became the map's first level is filed
 *    into the Workspace its own conversations live in (title/path as the
 *    fallback), and inherited by its children. A topic whose Workspace was
 *    deleted moves to the ungrouped bucket instead of disappearing.
 *    Conversations take the Workspace the Host accounts them to; one whose
 *    recorded owner names a Workspace the Host no longer reports is released to
 *    `null` instead of staying invisible under a stale id.
 * 2. Archived content whose Workspace is gone leaves the archive: the "Archived"
 *    row lives inside a Workspace, so without it the content would be both
 *    hidden and unreachable. A topic returns under its remembered parent when
 *    that node still exists on the same (now ungrouped) side, and to the top
 *    level otherwise; conversations become ordinary ungrouped conversations.
 * 3. Aliases are normalized: `undefined` becomes the concrete owner, so the
 *    document persists a stable shape, and the released archive marks are
 *    cleared.
 *
 * Every step is idempotent, and the order is fixed: ownership is decided before
 * the archive is released, because "whose Workspace is this?" is what decides
 * whether an item has to leave the archive at all.
 * @param state - the map.
 * @param workspaces - the Host's Workspace rows, in Host order.
 * @returns the reconciled map, or the same object when nothing changed.
 */
export function reconcileWorkspaces(state: MapState, workspaces: readonly WorkspaceRef[]): MapState {
  const known = new Set(workspaces.map(workspace => workspace.workspaceId))
  const membership = membershipOf(workspaces)
  const byId = new Map(state.nodes.map(node => [node.id, node]))
  const resolved = new Map<string, string | null>()

  /** Descendants of one node, computed from the original tree. */
  const descendantsOf = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const node of state.nodes) {
        if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id)
          grew = true
        }
      }
    }
    return ids
  }

  /** The Workspace a legacy root topic most plausibly belongs to. */
  const inferWorkspace = (node: MapNode): string | null => {
    const subtree = descendantsOf(node.id)
    const votes = new Map<string, number>()
    for (const thread of state.threads) {
      if (thread.nodeId === null || !subtree.has(thread.nodeId)) continue
      const owner = membership.get(thread.sessionId)
      if (owner === undefined) continue
      votes.set(owner, (votes.get(owner) ?? 0) + 1)
    }
    let best: string | null = null
    let bestCount = 0
    for (const [owner, count] of votes) {
      if (count > bestCount) { best = owner; bestCount = count }
    }
    if (best !== null) return best
    const wanted = node.title.trim().toLocaleLowerCase()
    for (const workspace of workspaces) {
      const title = workspace.title.trim().toLocaleLowerCase()
      const base = pathBaseName(workspace.path).toLocaleLowerCase()
      if (wanted !== '' && (wanted === title || wanted === base)) return workspace.workspaceId
    }
    return null
  }

  /** Resolve one node's owner, walking ancestors and remembering the answer. */
  const resolve = (nodeId: string, guard: Set<string>): string | null => {
    if (resolved.has(nodeId)) return resolved.get(nodeId) ?? null
    const node = byId.get(nodeId)
    if (node === undefined) return null
    let owner: string | null
    if (node.workspaceId !== undefined) {
      owner = node.workspaceId !== null && known.has(node.workspaceId) ? node.workspaceId : null
    } else if (guard.has(nodeId)) {
      owner = null
    } else if (node.parentId !== null && byId.has(node.parentId)) {
      guard.add(nodeId)
      owner = resolve(node.parentId, guard)
    } else {
      owner = inferWorkspace(node)
    }
    resolved.set(nodeId, owner)
    return owner
  }

  let changed = false

  // Step 1 — owners. An archived block is detached, so its own `workspaceId` is
  // the whole answer; a descendant still inherits through its parent chain.
  const owned = state.nodes.map(node => {
    const owner = resolve(node.id, new Set<string>())
    if (owner === ownerOf(node.workspaceId)) return node
    changed = true
    return { ...node, workspaceId: owner }
  })
  const ownedById = new Map(owned.map(node => [node.id, node]))

  // Step 2 — release archived items that no longer have a Workspace row to be
  // shown under. A Workspace that still exists keeps its archive.
  const releasing = new Set<string>()
  for (const node of owned) {
    if (isArchivedNode(node) && ownerOf(node.workspaceId) === null) releasing.add(node.id)
  }
  const releasedParent = new Map<string, string | null>()
  for (const nodeId of releasing) {
    const node = ownedById.get(nodeId)
    if (node === undefined) continue
    const wanted = node.archivedParentId ?? null
    const candidate = wanted === null ? undefined : ownedById.get(wanted)
    // The remembered parent can be a live topic on the same (now ungrouped)
    // side, or another archived root this very pass is releasing. Anything else
    // — deleted, archived for good, or of another Workspace — falls back to the
    // top level.
    const usable = candidate !== undefined
      && candidate.id !== nodeId
      && ownerOf(candidate.workspaceId) === null
      && (!isArchivedNode(candidate) || releasing.has(candidate.id))
    releasedParent.set(nodeId, usable ? candidate.id : null)
  }
  // A hand-built document may record two archived roots as each other's parent;
  // break the loop instead of rebuilding a cycle the rest of the model cannot
  // walk. The repeated node is the one closing the loop, so its own link is the
  // one to drop — a chain that merely runs into a loop stays attached.
  for (const nodeId of releasing) {
    const seen = new Set<string>([nodeId])
    let cursor = releasedParent.get(nodeId) ?? null
    while (cursor !== null && releasing.has(cursor)) {
      if (seen.has(cursor)) {
        releasedParent.set(cursor, null)
        break
      }
      seen.add(cursor)
      cursor = releasedParent.get(cursor) ?? null
    }
  }
  // Released topics are appended after the destination's current children, in
  // document order.
  const released = new Map<string, { parentId: string | null; position: number }>()
  if (releasing.size > 0) {
    let topNext = 1
    for (const node of owned) {
      if (node.parentId === null && ownerOf(node.workspaceId) === null && !releasing.has(node.id)) {
        topNext = Math.max(topNext, node.position + 1)
      }
    }
    const childNext = new Map<string, number>()
    for (const node of owned) {
      if (!releasing.has(node.id)) continue
      const parentId = releasedParent.get(node.id) ?? null
      if (parentId === null) {
        released.set(node.id, { parentId: null, position: topNext })
        topNext += 1
        continue
      }
      let next = childNext.get(parentId)
      if (next === undefined) {
        next = 1
        for (const sibling of owned) {
          if (sibling.parentId === parentId && !releasing.has(sibling.id)) next = Math.max(next, sibling.position + 1)
        }
        childNext.set(parentId, next)
      }
      released.set(node.id, { parentId, position: next })
      childNext.set(parentId, next + 1)
    }
  }

  const nodes = owned.map(node => {
    const target = released.get(node.id)
    if (target !== undefined) {
      changed = true
      const next: MapNode = { ...node, parentId: target.parentId, position: target.position }
      delete next.archivedAt
      delete next.archivedParentId
      return next
    }
    // A stray `archivedParentId` without a mark is meaningless; drop it so the
    // persisted shape stays canonical.
    if (node.archivedAt === undefined && node.archivedParentId !== undefined) {
      changed = true
      const next: MapNode = { ...node }
      delete next.archivedParentId
      return next
    }
    return node
  })

  const nodeWorkspace = new Map(nodes.map(node => [node.id, ownerOf(node.workspaceId)]))
  const threads = state.threads.map(thread => {
    const knownMember = membership.has(thread.sessionId)
    // A stale owner (a Workspace the Host no longer reports) is released instead
    // of kept: it would otherwise hide the conversation under a group that has
    // no row. Membership still wins when the Host does account for the session.
    const owner = knownMember
      ? membership.get(thread.sessionId) ?? null
      : thread.workspaceId !== undefined
        ? thread.workspaceId !== null && known.has(thread.workspaceId) ? thread.workspaceId : null
        : null
    let nodeId = thread.nodeId
    if (nodeId !== null) {
      const topicWorkspace = nodeWorkspace.get(nodeId)
      if (topicWorkspace === undefined || topicWorkspace !== owner) nodeId = null
    }
    // A Workspace owns the conversation: its plugin-local space no longer applies.
    const spaceId = owner === null ? thread.spaceId : undefined
    // Step 3 — an archived conversation whose Workspace is gone has no archive
    // row left to be shown under, so it becomes an ordinary ungrouped
    // conversation; a Workspace that still exists keeps its mark.
    const archivedAt = owner === null ? undefined : thread.archivedAt
    if (nodeId === thread.nodeId && owner === thread.workspaceId && spaceId === thread.spaceId
      && archivedAt === thread.archivedAt) return thread
    changed = true
    const next: ThreadRef = { ...thread, nodeId, workspaceId: owner }
    if (spaceId === undefined) delete next.spaceId
    if (archivedAt === undefined) delete next.archivedAt
    return next
  })

  if (!changed) return state
  return {
    version: 2,
    revision: state.revision + 1,
    nodes,
    threads,
    spaces: state.spaces,
    defaultSpaceId: state.defaultSpaceId,
    spaceOf: state.spaceOf,
    subagentSessionIds: state.subagentSessionIds ?? [],
  }
}

/** Whether a parsed value is a usable persisted map (current version). */
export function isMapState(value: unknown): value is MapState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<MapState>
  return candidate.version === 2
    && typeof candidate.revision === 'number'
    && Array.isArray(candidate.nodes)
    && Array.isArray(candidate.threads)
}

/** Read a persisted owner, keeping `undefined` as the "not reconciled yet" marker. */
function readOwner(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'string') return value
  return undefined
}

/**
 * Read persisted spaces, dropping rows that cannot name a group.
 * @param value - the parsed `spaces` field.
 * @returns sanitized spaces, in persisted order.
 */
function readSpaces(value: unknown): SpaceRef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const space = row as Partial<SpaceRef>
    if (typeof space.id !== 'string' || space.id === '') return []
    if (typeof space.title !== 'string' || space.title.trim() === '') return []
    if (seen.has(space.id)) return []
    seen.add(space.id)
    return [{
      id: space.id,
      title: space.title,
      position: typeof space.position === 'number' && Number.isFinite(space.position) ? space.position : 1,
      createdAt: typeof space.createdAt === 'string' ? space.createdAt : '',
    }]
  })
}

/**
 * Read persisted Workspace→space overrides, keeping only live references.
 * @param value - the parsed `spaceOf` field.
 * @param spaces - the spaces the document defines.
 * @returns the sanitized override table.
 */
function readSpaceOf(value: unknown, spaces: readonly SpaceRef[]): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const known = new Set(spaces.map(space => space.id))
  const result: Record<string, string> = {}
  for (const [workspaceId, spaceId] of Object.entries(value as Record<string, unknown>)) {
    if (typeof spaceId === 'string' && known.has(spaceId)) result[workspaceId] = spaceId
  }
  return result
}

/**
 * Read one persisted node/thread document into the current row shapes.
 * @param value - the parsed document.
 * @param keepOwner - whether version-2 ownership fields are preserved.
 * @param spaces - the spaces a loose conversation may be filed into.
 * @returns sanitized nodes and threads, or undefined when the shape is unusable.
 */
function readRows(
  value: { nodes?: unknown; threads?: unknown },
  keepOwner: boolean,
  spaces: readonly SpaceRef[],
): { nodes: MapNode[]; threads: ThreadRef[] } | undefined {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.threads)) return undefined
  const knownSpaces = new Set(spaces.map(space => space.id))
  const nodes = value.nodes.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const node = row as Partial<MapNode>
    if (typeof node.id !== 'string' || typeof node.title !== 'string') return []
    const created: MapNode = {
      id: node.id,
      parentId: typeof node.parentId === 'string' ? node.parentId : null,
      title: node.title,
      description: typeof node.description === 'string' ? node.description : '',
      position: typeof node.position === 'number' ? node.position : 1,
      updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : '',
    }
    if (typeof node.createdAt === 'string' && node.createdAt !== '') created.createdAt = node.createdAt
    const owner = keepOwner ? readOwner(node.workspaceId) : undefined
    if (owner !== undefined) created.workspaceId = owner
    // Archive marks are plugin-local organization data, not owner accounting:
    // they are read back verbatim in every version so a Host round trip
    // (parse → mutate → submit) cannot silently drop a topic out of the archive.
    if (typeof node.archivedAt === 'string' && node.archivedAt !== '') created.archivedAt = node.archivedAt
    if (node.archivedParentId === null) created.archivedParentId = null
    else if (typeof node.archivedParentId === 'string' && node.archivedParentId !== '') created.archivedParentId = node.archivedParentId
    return [created]
  })
  const ids = new Set(nodes.map(node => node.id))
  const threads = value.threads.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const thread = row as Partial<ThreadRef>
    if (typeof thread.sessionId !== 'string') return []
    const created: ThreadRef = {
      sessionId: thread.sessionId,
      nodeId: typeof thread.nodeId === 'string' && ids.has(thread.nodeId) ? thread.nodeId : null,
      title: typeof thread.title === 'string' ? thread.title : thread.sessionId,
      updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt : '',
      importedAt: typeof thread.importedAt === 'string' ? thread.importedAt : '',
    }
    const owner = keepOwner ? readOwner(thread.workspaceId) : undefined
    if (owner !== undefined) created.workspaceId = owner
    // The origin outlives the catalog: the Host half reads it to recognise a
    // conversation the map never gives a row to.
    if (typeof thread.origin === 'string' && thread.origin !== '') created.origin = thread.origin
    // A space only applies to a conversation no Workspace accounts for.
    if (keepOwner && ownerOf(owner) === null && typeof thread.spaceId === 'string' && knownSpaces.has(thread.spaceId)) {
      created.spaceId = thread.spaceId
    }
    // See the node read above: an archive mark must survive the round trip.
    if (typeof thread.archivedAt === 'string' && thread.archivedAt !== '') created.archivedAt = thread.archivedAt
    return [created]
  })
  return { nodes, threads }
}

/**
 * Parse persisted JSON.
 *
 * A version-1 document — written before Workspaces were the map's first level —
 * upgrades in place: its topic tree is kept, and {@link reconcileWorkspaces}
 * files the roots once the Workspace list arrives. Space fields are additive:
 * an older document simply reads as "no spaces yet" and the panel creates the
 * default space on load.
 * @param text - raw JSON, or null.
 * @returns the parsed map, or an empty one.
 */
export function parseMapState(text: string | null): MapState {
  if (text === null || text === '') return emptyMap()
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return emptyMap()
    const candidate = parsed as {
      version?: unknown; revision?: unknown; nodes?: unknown; threads?: unknown
      spaces?: unknown; defaultSpaceId?: unknown; spaceOf?: unknown; subagentSessionIds?: unknown
    }
    const current = candidate.version === 2 || candidate.version === 1
    if (!current) return emptyMap()
    const parsedSpaces = readSpaces(candidate.spaces)
    const known = new Set(parsedSpaces.map(space => space.id))
    const defaultSpaceId = typeof candidate.defaultSpaceId === 'string' && known.has(candidate.defaultSpaceId)
      ? candidate.defaultSpaceId
      : ''
    // Older documents stored the default space's label as Chinese text; rewrite
    // only the default space's marker so it reads in any language without
    // touching a title the user actually typed on another space.
    const spaces = parsedSpaces.map(space =>
      space.id === defaultSpaceId && space.title === LEGACY_DEFAULT_SPACE_TITLE
        ? { ...space, title: DEFAULT_SPACE_TITLE }
        : space)
    const rows = readRows(candidate, candidate.version === 2, spaces)
    if (rows === undefined) return emptyMap()
    return {
      version: 2,
      revision: typeof candidate.revision === 'number' ? candidate.revision : 0,
      nodes: rows.nodes,
      threads: rows.threads,
      spaces,
      defaultSpaceId,
      spaceOf: readSpaceOf(candidate.spaceOf, spaces),
      subagentSessionIds: Array.isArray(candidate.subagentSessionIds)
        ? candidate.subagentSessionIds.filter((id): id is string => typeof id === 'string' && id !== '')
        : [],
    }
  } catch (_malformed) {
    return emptyMap()
  }
}

/** One node whose title or description matched a search. */
export interface NodeSearchHit {
  node: MapNode
  /** Whether the title carried the hit (title hits rank above description hits). */
  titleMatch: boolean
  /** Case-insensitive match range inside the description, or null. */
  descriptionMatch: { start: number; end: number } | null
}

/** One conversation whose title matched a search. */
export interface ThreadSearchHit {
  thread: ThreadRef
  /** Case-insensitive match range inside the title. */
  titleMatch: { start: number; end: number } | null
}

/** What a query matched, split by kind. */
export interface SearchResults {
  nodes: NodeSearchHit[]
  threads: ThreadSearchHit[]
}

/**
 * First case-insensitive occurrence of `query` inside `text`.
 *
 * Case folding can change a string's length in a few scripts; the returned end
 * is clamped to the original text so a range always slices safely.
 * @param text - haystack.
 * @param query - raw needle (trimmed inside).
 * @returns the matched range in `text`, or null.
 */
export function findTextMatch(text: string, query: string): { start: number; end: number } | null {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '' || text === '') return null
  const folded = text.toLocaleLowerCase()
  const start = folded.indexOf(needle)
  if (start < 0) return null
  return { start, end: Math.min(text.length, start + needle.length) }
}

/**
 * Case-insensitive substring search over node titles and descriptions, and over
 * indexed conversation titles. A blank query matches nothing.
 *
 * Hits carry where they matched: the result column uses the description range
 * for its snippet and the title flag for ranking.
 * @param state - the map to search.
 * @param query - raw user input.
 * @param spaceId - scope the search to one space; omitted searches everything.
 * @returns the matching nodes and conversations, document order preserved.
 */
export function searchMap(state: MapState, query: string, spaceId?: string): SearchResults {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return { nodes: [], threads: [] }
  const inScope = (workspaceId: string | null | undefined, localSpaceId: string | null | undefined): boolean => {
    if (spaceId === undefined) return true
    if (workspaceId === undefined || workspaceId === null) {
      return (localSpaceId ?? state.defaultSpaceId) === spaceId
    }
    return spaceOfWorkspace(state, workspaceId) === spaceId
  }
  const nodes: NodeSearchHit[] = []
  for (const node of state.nodes) {
    if (!inScope(node.workspaceId, undefined)) continue
    const descriptionMatch = findTextMatch(node.description, needle)
    const titleMatch = findTextMatch(node.title, needle) !== null
    if (!titleMatch && descriptionMatch === null) continue
    nodes.push({ node, titleMatch, descriptionMatch })
  }
  const threads: ThreadSearchHit[] = []
  for (const thread of state.threads) {
    if (!inScope(thread.workspaceId, thread.spaceId)) continue
    const titleMatch = findTextMatch(thread.title, needle)
    if (titleMatch === null) continue
    threads.push({ thread, titleMatch })
  }
  return { nodes, threads }
}

/**
 * Human-readable node path, used wherever a node is shown out of tree.
 * @param state - the map.
 * @param nodeId - the node to describe.
 * @returns titles joined with a slash, nearest root first.
 */
export function breadcrumb(state: MapState, nodeId: string): string {
  return nodePath(state, nodeId).map(node => node.title).join(' / ')
}

/** Label of the "directly under the Workspace" destination (localized fallback). */
const WORKSPACE_ROOT_TARGET_LABEL = '(Workspace top level)'

/**
 * Every node one conversation of a Workspace may move to, in the order the map
 * shows them.
 *
 * Built for the 「移动到…」 picker: the Workspace row itself comes first (a
 * conversation can always live directly under its Workspace), then each node
 * depth-first, labelled with its full path so two same-named topics stay apart.
 * Topics inside the archive are left out — a conversation leaves the archive
 * only through 「取消归档」, so they must not be drop destinations. A cycle in a
 * hand-built document cannot make the list grow — an id is emitted once — and no
 * document is touched, so a dialog can build the list per open.
 * @param state - the map.
 * @param workspaceId - the Workspace whose nodes are the targets; `null` = the ungrouped bucket.
 * @param workspaceRootLabel - localized label of the Workspace-row destination.
 * @returns the selectable destinations, the Workspace root (`null`) first.
 */
export function threadMoveTargets(
  state: MapState,
  workspaceId: string | null,
  workspaceRootLabel: string = WORKSPACE_ROOT_TARGET_LABEL,
): Array<{ nodeId: string | null; label: string }> {
  const wanted = ownerOf(workspaceId)
  const targets: Array<{ nodeId: string | null; label: string }> = [
    { nodeId: null, label: workspaceRootLabel },
  ]
  const children = new Map<string, MapNode[]>()
  for (const node of state.nodes) {
    if (node.parentId === null) continue
    const siblings = children.get(node.parentId)
    if (siblings === undefined) children.set(node.parentId, [node])
    else siblings.push(node)
  }
  const seen = new Set<string>()
  const walk = (node: MapNode): void => {
    if (seen.has(node.id)) return
    // The archive is not a destination: a conversation enters it only through
    // its own 「归档」 action and leaves it only through 「取消归档」.
    if (inArchive(state, node.id)) return
    seen.add(node.id)
    targets.push({ nodeId: node.id, label: breadcrumb(state, node.id) })
    const kids = (children.get(node.id) ?? []).filter(candidate => ownerOf(candidate.workspaceId) === wanted)
    for (const child of sorted(kids)) walk(child)
  }
  for (const root of sorted(state.nodes.filter(node => node.parentId === null && ownerOf(node.workspaceId) === wanted))) {
    walk(root)
  }
  // "Every node of the Workspace" has to hold for a hand-built document too: a
  // node whose parent is missing or looped hangs off no root, and leaving it out
  // would hide a destination the map still shows a column for.
  const orphans = state.nodes.filter(node => ownerOf(node.workspaceId) === wanted)
  for (const node of sorted(orphans)) walk(node)
  return targets
}

/**
 * Short, stable fragment of a session id.
 *
 * Titles repeat in practice, so the index shows this beside every conversation:
 * identity comes from the id, never from the title. Session ids carry a
 * `session-` prefix, stripped first — otherwise every chip would read the same.
 * @param sessionId - the full session id.
 * @returns the first eight identifying characters.
 */
export function shortSessionId(sessionId: string): string {
  const bare = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  return bare.slice(0, 8)
}

/**
 * Index a conversation that was just created for one node.
 *
 * `syncThreads` only refreshes rows the catalog already lists, so a brand-new
 * session has to be adopted before its first turn lands — otherwise the new
 * discussion would appear in the ungrouped bucket instead of under the node
 * that started it. Its activity stamp is "now", so it leads that node's list.
 * @param state - the map.
 * @param input - the created session, its provisional title, its owner, and the Workspace it was created in.
 * @returns the updated map.
 */
export function adoptThread(
  state: MapState,
  input: {
    sessionId: string
    title: string
    nodeId: string | null
    workspaceId?: string | null
    /** Space of a loose conversation; ignored when the row owns a Workspace. */
    spaceId?: string | null
  },
): MapState {
  const node = input.nodeId === null ? undefined : requireNode(state, input.nodeId)
  const workspaceId = node === undefined
    ? ownerOf(input.workspaceId)
    : workspaceOfNode(node)
  const requestedSpace = input.spaceId ?? null
  const spaceId = workspaceId !== null || requestedSpace === null || requestedSpace === state.defaultSpaceId
    ? undefined
    : state.spaces.some(space => space.id === requestedSpace) ? requestedSpace : undefined
  return mutate(state, draft => {
    const now = new Date().toISOString()
    const existing = draft.threads.find(thread => thread.sessionId === input.sessionId)
    if (existing === undefined) {
      draft.threads.push({
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        workspaceId,
        spaceId,
        title: input.title === '' ? input.sessionId : input.title,
        updatedAt: now,
        importedAt: now,
      })
      return
    }
    existing.nodeId = input.nodeId
    existing.workspaceId = workspaceId
    if (spaceId === undefined) delete existing.spaceId
    else existing.spaceId = spaceId
    if (input.title !== '') existing.title = input.title
    existing.updatedAt = now
  })
}
