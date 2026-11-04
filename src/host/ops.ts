/**
 * Pure node-tree operations behind the model tools.
 *
 * Every function is a state transition over the shared `MapState` model: it
 * validates and mutates in memory and returns the next document plus the tool's
 * canonical value. The store persists the returned document exactly once, so a
 * batch that fails partway leaves no trace (no partial trees, no revision bump).
 *
 * Tree invariants (workspace binding, depth/node ceilings, cycle rejection, leaf
 * deletion) are delegated to `src/shared/model.ts` — the same functions the Web
 * UI uses — so the tool surface cannot drift from the map's semantics.
 *
 * The archive is invisible to the model: views and counts are taken from the
 * active tree only, a read that names archived content fails with `ARCHIVED`,
 * and every write guard refuses an archived target. Only the archive totals are
 * reported back, so the model knows something is put away without seeing it.
 */
import {
  activeChildrenOf,
  activeMapView,
  activeTopNodesOf,
  adoptThread,
  archiveStats,
  assignThreadIssue,
  assignThreads,
  createNode,
  deleteNode,
  inArchive,
  insertNodeBefore,
  isArchivedThread,
  isRecordedSubagent,
  updateNode,
  workspaceOfNode,
  type MapNode,
  type MapState,
  type ThreadRef,
} from '../shared/model.js'
import { MapToolError } from './errors.js'
import type {
  AttachSessionsInput, CreateNodesInput, DeleteNodesInput, MoveNodesInput, MoveSessionsInput, NodeInput,
  PlanGoalInput, UpdateNodesInput,
} from './args.js'
import { MAX_BATCH_NODES } from './paths.js'

/** One created node as the model receives it. */
export interface CreatedNode {
  readonly nodeId: string
  readonly title: string
  readonly parentId: string | null
  readonly ref?: string
}

/** One projected node in the compact state view. */
export interface NodeView {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly childCount: number
  readonly children?: NodeView[]
}

/** Archived content the model may not read: the archive counts only. */
export interface ArchiveCounts {
  /** Archived top-level topics (an archived subtree counts once). */
  readonly nodes: number
  /** Conversations the archive hides, inside archived topics or filed loose. */
  readonly sessions: number
}

/** Workspace-level summary used when no scope was requested. */
export interface WorkspaceNodeCount {
  readonly workspaceId: string
  readonly nodeCount: number
  readonly threadCount: number
}

/** One compact state projection addressed to the model. */
export interface StateView {
  readonly scope: { readonly workspaceId?: string; readonly nodeId?: string }
  readonly nodes?: NodeView[]
  readonly workspaces?: WorkspaceNodeCount[]
  readonly ungroupedNodes?: number
  readonly ungroupedThreads?: number
  readonly archived: ArchiveCounts
  readonly truncated: boolean
}

/** Maximum projected nodes per state view. */
const MAX_VIEW_NODES = 300

/** Children of one parent in one workspace bucket, archived topics excluded. */
function childrenOf(doc: MapState, parentId: string | null, workspaceId: string | null): MapNode[] {
  return activeChildrenOf(doc, parentId).filter(node => workspaceOfNode(node) === workspaceId)
}

/** The tool failure for a read or write that names hidden (archived) content. */
function archivedNodeError(nodeId: string): MapToolError {
  return new MapToolError(
    'ARCHIVED',
    `node ${JSON.stringify(nodeId)} is archived; unarchive it in the map before reading or changing it`,
  )
}

/** One conversation the archive hides, rejected with the model's code vocabulary. */
function archivedSessionRejection(sessionId: string): RejectedSession {
  return {
    sessionId,
    code: 'ARCHIVED',
    message: `session ${JSON.stringify(sessionId)} is archived; unarchive it in the map before filing it again`,
  }
}

/** Whether the archive hides one conversation: marked itself, or filed inside an archived topic. */
function isArchivedConversation(doc: MapState, thread: ThreadRef): boolean {
  return isArchivedThread(thread) || (thread.nodeId !== null && inArchive(doc, thread.nodeId))
}

/** Refuse a write that names a topic the archive hides (or a descendant of one). */
function requireActiveNode(doc: MapState, nodeId: string): void {
  if (inArchive(doc, nodeId)) throw archivedNodeError(nodeId)
}

/**
 * Create a nested batch of nodes under one parent (or a workspace root).
 * @param doc - current document.
 * @param input - parent, owning workspace, and nested node drafts.
 * @param idFactory - id generator (injectable for deterministic tests).
 * @returns next document plus the created nodes, parents before children.
 */
export function createNodes(
  doc: MapState,
  input: CreateNodesInput & { readonly workspaceId: string },
  idFactory: () => string,
): { doc: MapState; value: { created: CreatedNode[] } } {
  const created: CreatedNode[] = []
  let state = doc

  const walk = (items: readonly NodeInput[], parentId: string | null): void => {
    for (const item of items) {
      if (created.length >= MAX_BATCH_NODES) {
        throw new MapToolError('TOO_MANY_NODES', `a single call may create at most ${MAX_BATCH_NODES} nodes`)
      }
      const result = createNode(state, {
        parentId,
        ...parentId === null ? { workspaceId: input.workspaceId } : {},
        title: item.title,
        ...item.description === undefined ? {} : { description: item.description },
        id: idFactory(),
      })
      state = result.state
      created.push({
        nodeId: result.id,
        title: item.title,
        parentId,
        ...item.ref === undefined ? {} : { ref: item.ref },
      })
      if (item.children !== undefined && item.children.length > 0) walk(item.children, result.id)
    }
  }

  if (input.parentId !== null) requireActiveNode(doc, input.parentId)
  walk(input.nodes, input.parentId)
  return { doc: state, value: { created } }
}

/**
 * Create a goal node with its strategy layer and optional task layer in one
 * transaction.
 * @param doc - current document.
 * @param input - goal, strategies, tasks, and owning workspace.
 * @param idFactory - id generator.
 * @returns next document plus every created id.
 */
export function planGoal(
  doc: MapState,
  input: PlanGoalInput & { readonly workspaceId: string },
  idFactory: () => string,
): {
  doc: MapState
  value: {
    goalNodeId: string
    strategies: Array<{ nodeId: string; taskNodeIds: string[] }>
    createdCount: number
  }
} {
  let state = doc
  let createdCount = 0
  const budget = (next: number): void => {
    createdCount += next
    if (createdCount > MAX_BATCH_NODES) {
      throw new MapToolError('TOO_MANY_NODES', `a single call may create at most ${MAX_BATCH_NODES} nodes`)
    }
  }

  const goal = createNode(state, {
    parentId: null,
    workspaceId: input.workspaceId,
    title: input.goal.title,
    ...input.goal.description === undefined ? {} : { description: input.goal.description },
    id: idFactory(),
  })
  state = goal.state
  budget(1)

  const strategies: Array<{ nodeId: string; taskNodeIds: string[] }> = []
  for (const strategy of input.strategies) {
    const node = createNode(state, {
      parentId: goal.id,
      title: strategy.title,
      ...strategy.description === undefined ? {} : { description: strategy.description },
      id: idFactory(),
    })
    state = node.state
    budget(1)
    const taskNodeIds: string[] = []
    for (const task of strategy.tasks ?? []) {
      const taskNode = createNode(state, {
        parentId: node.id,
        title: task.title,
        ...task.description === undefined ? {} : { description: task.description },
        id: idFactory(),
      })
      state = taskNode.state
      budget(1)
      taskNodeIds.push(taskNode.id)
    }
    strategies.push({ nodeId: node.id, taskNodeIds })
  }

  return { doc: state, value: { goalNodeId: goal.id, strategies, createdCount } }
}

/**
 * Rename and/or re-describe existing nodes atomically.
 *
 * A node the archive hides is refused: the model may not edit content it cannot
 * read, and the whole batch is rejected before the store sees a document.
 * @param doc - current document.
 * @param input - per-node patches.
 * @returns next document plus the updated count.
 */
export function updateNodes(doc: MapState, input: UpdateNodesInput): { doc: MapState; value: { updated: number } } {
  let state = doc
  for (const update of input.updates) {
    const node = state.nodes.find(candidate => candidate.id === update.nodeId)
    if (node === undefined) throw new MapToolError('NOT_FOUND', `node ${JSON.stringify(update.nodeId)} does not exist`)
    if (inArchive(state, update.nodeId)) throw archivedNodeError(update.nodeId)
    state = updateNode(state, {
      id: update.nodeId,
      title: update.title ?? node.title,
      description: update.description ?? node.description,
    })
  }
  return { doc: state, value: { updated: input.updates.length } }
}

/**
 * Re-parent (and optionally re-order) existing nodes inside their own workspace
 * atomically.
 *
 * Each move goes through the model's `insertNodeBefore`, so an omitted
 * `before_node_id` appends exactly as before and a given one places the node
 * ahead of that sibling; the whole list is one transaction. A move that touches
 * the archive — the node itself, the target parent, or the anchor — is refused.
 * @param doc - current document.
 * @param input - per-node target parents (`null` = workspace root) and anchors.
 * @returns next document plus the moved count.
 */
export function moveNodes(doc: MapState, input: MoveNodesInput): { doc: MapState; value: { moved: number } } {
  for (const move of input.moves) {
    requireActiveNode(doc, move.nodeId)
    if (move.parentId !== null) requireActiveNode(doc, move.parentId)
    if (move.beforeNodeId !== undefined) requireActiveNode(doc, move.beforeNodeId)
  }
  let state = doc
  for (const move of input.moves) {
    state = insertNodeBefore(state, move.nodeId, move.parentId, move.beforeNodeId)
  }
  return { doc: state, value: { moved: input.moves.length } }
}

/** One conversation an operation could not file, with the model's own reason. */
export interface RejectedSession {
  readonly sessionId: string
  readonly code: string
  readonly message: string
}

/**
 * Move already-indexed conversations to another topic inside their own workspace.
 *
 * Every id must already have a row: unlike {@link attachSessions} nothing is
 * adopted here, and filing a row only rewrites its `nodeId`, so the conversation
 * keeps its activity stamp instead of jumping to the top of the target list.
 * A hidden target topic refuses the whole call, and a conversation the archive
 * hides is rejected per id so the rest of the batch still lands.
 * @param doc - current document.
 * @param input - target topic (`null` = the conversation's workspace row) and session ids.
 * @returns next document plus the moved ids and the per-id rejections.
 */
export function moveSessions(
  doc: MapState,
  input: MoveSessionsInput,
): { doc: MapState; value: { moved: string[]; rejected: RejectedSession[] } } {
  if (input.nodeId !== null) requireActiveNode(doc, input.nodeId)
  let state = doc
  const moved: string[] = []
  const rejected: RejectedSession[] = []
  for (const sessionId of input.sessionIds) {
    const thread = doc.threads.find(candidate => candidate.sessionId === sessionId)
    if (thread !== undefined && isArchivedConversation(doc, thread)) {
      rejected.push(archivedSessionRejection(sessionId))
      continue
    }
    // The model's own judgement decides: missing target node, workspace, space
    // and subagent children. It stays permissive for an id the index has never
    // seen, so the row check below turns that silent no-op into NO_THREAD.
    const issue = assignThreadIssue(state, sessionId, input.nodeId)
    if (issue !== null) {
      rejected.push({ sessionId, code: issue.code, message: issue.message })
      continue
    }
    if (!state.threads.some(candidate => candidate.sessionId === sessionId)) {
      rejected.push({
        sessionId,
        code: 'NO_THREAD',
        message: `session ${JSON.stringify(sessionId)} has no row in the map yet; file it with map_attach_sessions first`,
      })
      continue
    }
    state = assignThreads(state, [sessionId], input.nodeId)
    moved.push(sessionId)
  }
  return { doc: state, value: { moved, rejected } }
}

/**
 * Delete nodes leaf-first. `subtree` expands each target to its whole subtree
 * before deleting; `leaf` refuses any node that still has children.
 *
 * Deleting a topic the archive hides is refused, so the model cannot destroy
 * content it never saw; the refusal lands before any node is removed.
 * @param doc - current document.
 * @param input - targets and mode.
 * @returns next document plus deleted ids (children before parents).
 */
export function deleteNodes(doc: MapState, input: DeleteNodesInput): { doc: MapState; value: { deleted: string[] } } {
  for (const nodeId of input.nodeIds) requireActiveNode(doc, nodeId)
  const ordered: string[] = []
  const seen = new Set<string>()
  const expand = (nodeId: string): void => {
    if (seen.has(nodeId)) return
    const node = doc.nodes.find(candidate => candidate.id === nodeId)
    if (node !== undefined) {
      for (const child of doc.nodes.filter(candidate => candidate.parentId === nodeId)) expand(child.id)
    }
    seen.add(nodeId)
    ordered.push(nodeId)
  }
  for (const nodeId of input.nodeIds) expand(nodeId)

  let state = doc
  const deleted: string[] = []
  for (const nodeId of input.mode === 'subtree' ? ordered : input.nodeIds) {
    state = deleteNode(state, nodeId)
    deleted.push(nodeId)
  }
  return { doc: state, value: { deleted } }
}

/**
 * File existing conversations under one node (adopting not-yet-indexed sessions).
 *
 * A session that already has a row is re-filed through the model's own move rule
 * — the same one the UI and `map_move_session` use — so it merely changes topic
 * and keeps its activity stamp. Only a session the map has never indexed is
 * adopted (row created with a "now" stamp): that is the new-session path this
 * tool exists for. A hidden target topic refuses the whole call, and a
 * conversation the archive hides is rejected per id.
 * @param doc - current document.
 * @param input - target node and session ids.
 * @returns next document plus attached and rejected ids.
 */
export function attachSessions(
  doc: MapState,
  input: AttachSessionsInput,
): {
  doc: MapState
  value: { attached: string[]; rejected: RejectedSession[] }
} {
  const node = doc.nodes.find(candidate => candidate.id === input.nodeId)
  if (node === undefined) throw new MapToolError('NOT_FOUND', `node ${JSON.stringify(input.nodeId)} does not exist`)
  if (inArchive(doc, node.id)) throw archivedNodeError(node.id)
  const workspaceId = workspaceOfNode(node)
  let state = doc
  const attached: string[] = []
  const rejected: RejectedSession[] = []
  for (const sessionId of input.sessionIds) {
    const thread = state.threads.find(candidate => candidate.sessionId === sessionId)
    if (thread !== undefined && isArchivedConversation(doc, thread)) {
      rejected.push(archivedSessionRejection(sessionId))
      continue
    }
    // A subagent child never becomes a map row, so filing one under a node is
    // refused for the same reason the index never gives it a row in the first
    // place. The fact survives its row in the document's ledger.
    if (isRecordedSubagent(doc, sessionId) || thread?.origin === 'subagent') {
      rejected.push({
        sessionId,
        code: 'SUBAGENT',
        message: `session ${JSON.stringify(sessionId)} is a subagent child and cannot be filed under a node`,
      })
      continue
    }
    const owner = thread?.workspaceId
    if (owner !== undefined && owner !== workspaceId) {
      rejected.push({
        sessionId,
        code: 'WORKSPACE',
        message: `session ${JSON.stringify(sessionId)} belongs to another workspace`,
      })
      continue
    }
    if (thread !== undefined) {
      // Already indexed: move it with the shared judgement instead of adopting
      // it again, which would rewrite its `updatedAt` and its title.
      const issue = assignThreadIssue(state, sessionId, node.id)
      if (issue !== null) {
        rejected.push({ sessionId, code: issue.code, message: issue.message })
        continue
      }
      state = assignThreads(state, [sessionId], node.id)
      attached.push(sessionId)
      continue
    }
    state = adoptThread(state, {
      sessionId,
      title: '',
      nodeId: node.id,
      workspaceId,
    })
    attached.push(sessionId)
  }
  return { doc: state, value: { attached, rejected } }
}

/**
 * Project one subtree into the compact model-facing shape.
 * @param doc - current document.
 * @param node - subtree root.
 * @param depth - remaining expansion depth (0 = only the node itself).
 * @param budget - shared projection budget object.
 * @returns the projected node.
 */
function projectNode(
  doc: MapState,
  node: MapNode,
  depth: number,
  budget: { remaining: number; truncated: boolean },
): NodeView {
  budget.remaining -= 1
  const children = childrenOf(doc, node.id, workspaceOfNode(node))
  const view: { id: string; title: string; description?: string; childCount: number; children?: NodeView[] } = {
    id: node.id,
    title: node.title,
    ...node.description === '' ? {} : { description: node.description },
    childCount: children.length,
  }
  if (depth > 1 && children.length > 0) {
    const projected: NodeView[] = []
    for (const child of children) {
      if (budget.remaining <= 0) {
        budget.truncated = true
        break
      }
      projected.push(projectNode(doc, child, depth - 1, budget))
    }
    if (projected.length > 0) view.children = projected
    if (projected.length < children.length) budget.truncated = true
  } else if (children.length > 0) {
    budget.truncated = true
  }
  return view
}

/**
 * Project the document into the compact view addressed by the request.
 *
 * The archive stays invisible to the model: archived topics (and their whole
 * subtrees) and hidden conversations are filtered out of every scope and count,
 * and only their totals are reported back as `archived`. Asking for one archived
 * node explicitly is an `ARCHIVED` failure rather than a silent `NOT_FOUND`, so
 * the model learns the content exists but is put away.
 * @param doc - current document.
 * @param input - scope and expansion depth.
 * @returns the projection consumed by `map_get_state`.
 */
export function viewState(
  doc: MapState,
  input: { workspaceId?: string; nodeId?: string; depth: number },
): { value: StateView } {
  const budget = { remaining: MAX_VIEW_NODES, truncated: false }
  const archived = archiveStats(doc)
  if (input.nodeId !== undefined) {
    const node = doc.nodes.find(candidate => candidate.id === input.nodeId)
    if (node === undefined) throw new MapToolError('NOT_FOUND', `node ${JSON.stringify(input.nodeId)} does not exist`)
    if (inArchive(doc, node.id)) throw archivedNodeError(node.id)
    return {
      value: {
        scope: { nodeId: input.nodeId },
        nodes: [projectNode(doc, node, input.depth, budget)],
        archived,
        truncated: budget.truncated,
      },
    }
  }
  if (input.workspaceId !== undefined) {
    const roots = activeTopNodesOf(doc, input.workspaceId)
    const nodes: NodeView[] = []
    for (const root of roots) {
      if (budget.remaining <= 0) {
        budget.truncated = true
        break
      }
      nodes.push(projectNode(doc, root, input.depth, budget))
    }
    return {
      value: {
        scope: { workspaceId: input.workspaceId },
        nodes,
        archived,
        truncated: budget.truncated,
      },
    }
  }

  const active = activeMapView(doc)
  const counts = new Map<string, { nodeCount: number; threadCount: number }>()
  let ungroupedNodes = 0
  let ungroupedThreads = 0
  for (const node of active.nodes) {
    const workspaceId = workspaceOfNode(node)
    if (workspaceId === null) {
      ungroupedNodes += 1
      continue
    }
    const entry = counts.get(workspaceId) ?? { nodeCount: 0, threadCount: 0 }
    entry.nodeCount += 1
    counts.set(workspaceId, entry)
  }
  for (const thread of active.threads) {
    const workspaceId = thread.workspaceId ?? null
    if (workspaceId === null) {
      ungroupedThreads += 1
      continue
    }
    const entry = counts.get(workspaceId) ?? { nodeCount: 0, threadCount: 0 }
    entry.threadCount += 1
    counts.set(workspaceId, entry)
  }
  return {
    value: {
      scope: {},
      workspaces: [...counts.entries()]
        .map(([workspaceId, count]) => ({ workspaceId, ...count }))
        .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)),
      ...ungroupedNodes === 0 ? {} : { ungroupedNodes },
      ...ungroupedThreads === 0 ? {} : { ungroupedThreads },
      archived,
      truncated: false,
    },
  }
}
