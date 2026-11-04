/**
 * Behavior tests for the conversation-map model and persistence.
 *
 * The model is pure, so these exercise the real shipped source through the
 * neutral `lib/` build rather than a re-implementation.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

/** The Simplified Chinese Workspace-title fallbacks these tests pin. */
const ZH_TITLES = { defaultWorkspace: '默认工作区', workspaceFallback: '工作区' }

import {
  DEFAULT_SPACE_TITLE, LOOSE_ROW_PREFIX, MAX_SPACES, MAX_DEPTH, MapError, UNGROUPED_ID,
  activeChildrenOf, activeDirectThreadsOf, activeMapView, activeThreadsOf, activeTopNodesOf,
  adoptThread, ancestorRowKeys, archiveKey, archiveNode, archiveSelection, archiveStats, archiveStatsOf,
  archiveThread, archivedLooseThreadsOf, archivedRootOf, archivedRootsOf,
  assignThreadIssue, assignThreads, breadcrumb, childrenOf, conversationVisible, createNode, createSpace, deleteNode, deleteNodeSubtree, deleteSpace, descendantIds,
  directThreadsOf, emptyMap, ensureDefaultSpace, homeOfSession, inArchive, indexableSessions, insertNodeBefore,
  isArchiveSelectionKey, isArchivedNode, isArchivedThread, isRecordedSubagent, isWorkspaceSelectionKey, looseRowKey, looseThreadsInSpace, moveNode, moveNodeIssue, nodePath, parseMapState,
  pathBaseName, pruneMissing, reconcileSpaces, reconcileWorkspaces, renameSpace, searchMap,
  selectionAfterNodeDeletion, selectionOfThread, sessionHomeRow, setThreadSpace, setWorkspaceSpace, shortSessionId,
  spaceList, spaceOfThread, spaceOfWorkspace, subtreeDeletionSummary, syncThreads, threadMoveTargets, threadOfSession, threadsOf, topNodesOf,
  unarchiveNode, unarchiveThread, updateNode, visibleAncestorOf, workspaceDisplayTitle, workspaceKey, workspaceNodeId,
  workspaceOfNode, workspaceSelection, workspacesInSpace,
} from '../lib/model.js'
import { STORAGE_KEY, loadMap, saveMap } from '../lib/persistence.js'

/** One Workspace projection, as the Host reports it. */
function workspace(workspaceId, title, sessionIds = [], path = `/tmp/${title}`) {
  return { workspaceId, path, title, sessionIds }
}

/** A map with one topic per Workspace and a child under the first. */
function seed() {
  let state = emptyMap()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '外贸探索', id: 'a' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w2', title: '产品设计', id: 'b' }).state
  state = createNode(state, { parentId: 'a', workspaceId: 'w1', title: '获客方式', id: 'a1' }).state
  return state
}

/**
 * The shared archive fixture.
 *
 * Workspace `w1` keeps one active root (`a`), one archived block (`a1 > a11`),
 * one conversation still in the active tree (`live`), one travelling with the
 * block (`blocked`), and one archived on its own (`loose`). Workspace `w2` keeps
 * its ordinary tree.
 */
function archivedSeed() {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  state = syncThreads(state, [
    { id: 'live', displayTitle: '活跃会话', updatedAt: 1000 },
    { id: 'blocked', displayTitle: '块内会话', updatedAt: 3000 },
    { id: 'loose', displayTitle: '独立归档会话', updatedAt: 2000 },
  ], null, new Map([['live', 'w1'], ['blocked', 'w1'], ['loose', 'w1']]))
  state = assignThreads(state, ['live'], 'a')
  state = assignThreads(state, ['blocked'], 'a11')
  state = archiveThread(state, 'loose')
  state = archiveNode(state, 'a1')
  return state
}

test('a session created but never used is not indexed', () => {
  const rows = [
    { id: 's1', title: '用过的' },
    { id: 's2', title: '刚建的空会话', blank: true },
    { id: 's3', title: '另一个空会话', blank: true },
  ]
  const indexed = indexableSessions(rows, null)
  assert.deepEqual(indexed.map(row => row.id), ['s1'], 'blank sessions stay out of the index')
})

test('the open blank session is indexed so its provisional row can show', () => {
  const rows = [
    { id: 's1', title: '用过的' },
    { id: 's2', title: '刚建的空会话', blank: true },
  ]
  assert.deepEqual(indexableSessions(rows, 's2').map(row => row.id), ['s1', 's2'])
  assert.deepEqual(indexableSessions(rows, 's1').map(row => row.id), ['s1'], 'focus moving on drops it again')
})

test('a subagent conversation is never indexed, not even while it is open', () => {
  const rows = [
    { id: 'p', title: '父会话' },
    { id: 'c', title: '子智能体', origin: 'subagent', parentId: 'p' },
  ]
  assert.deepEqual(indexableSessions(rows, null).map(row => row.id), ['p'], 'the child is not a row of its own')
  assert.deepEqual(indexableSessions(rows, 'c').map(row => row.id), ['p'], 'the parent is the entry point')
  assert.equal(conversationVisible(rows[1], 'c'), false, 'being the open one does not make it a conversation')
  assert.equal(conversationVisible(rows[0], null), true)
})

test('the blank rule still decides every ordinary conversation', () => {
  const blank = { id: 'b', blank: true }
  assert.equal(conversationVisible(blank, null), false, 'an unused session stays out')
  assert.equal(conversationVisible(blank, 'b'), true, 'the open one may show its provisional row')
  assert.equal(conversationVisible({ id: 'used' }, null), true)
  assert.equal(conversationVisible({ id: 'used', blank: false }, null), true)
})

test('visibleAncestorOf walks up to the nearest ordinary conversation', () => {
  const byId = {
    p: { title: '父会话' },
    c: { origin: 'subagent', parentId: 'p' },
    c2: { origin: 'subagent', parentId: 'c' },
    c3: { origin: 'subagent', parentId: 'c2' },
  }
  assert.equal(visibleAncestorOf(byId, 'c'), 'p', 'one level up')
  assert.equal(visibleAncestorOf(byId, 'c2'), 'p', 'two levels up')
  assert.equal(visibleAncestorOf(byId, 'c3'), 'p', 'three levels up')
  assert.equal(visibleAncestorOf(byId, 'p'), 'p', 'an ordinary row is its own answer')
  assert.equal(visibleAncestorOf(byId, 'unknown'), 'unknown', 'an unknown session names itself')
})

test('a subagent without a usable parent pointer stops the walk', () => {
  assert.equal(visibleAncestorOf({ c: { origin: 'subagent' } }, 'c'), 'c', 'no parent at all')
  assert.equal(visibleAncestorOf({ c: { origin: 'subagent', parentId: null } }, 'c'), 'c', 'a null parent')
  assert.equal(visibleAncestorOf({ c: { origin: 'subagent', parentId: '' } }, 'c'), 'c', 'an empty parent')
  assert.equal(visibleAncestorOf({ c: { origin: 'subagent', parentId: 'gone' } }, 'c'), 'gone', 'the walk names the parent it cannot see')
})

test('a cyclic parent chain terminates instead of looping', () => {
  const byId = {
    a: { origin: 'subagent', parentId: 'b' },
    b: { origin: 'subagent', parentId: 'a' },
    self: { origin: 'subagent', parentId: 'self' },
  }
  assert.equal(visibleAncestorOf(byId, 'a'), 'a', 'a two-row loop ends on the row it started from')
  assert.equal(visibleAncestorOf(byId, 'b'), 'b')
  assert.equal(visibleAncestorOf(byId, 'self'), 'self', 'a self-parented row ends on itself')
})

test('syncing records a subagent child in the ledger instead of giving it a row', () => {
  const state = syncThreads(emptyMap(), [
    { id: 'child', displayTitle: '子智能体', origin: 'subagent', parentId: 'p' },
    { id: 'plain', displayTitle: '普通会话' },
  ])
  assert.deepEqual(state.threads.map(thread => thread.sessionId), ['plain'], 'the child never becomes a row')
  assert.deepEqual(state.subagentSessionIds, ['child'], 'the fact is kept where the Host half can read it')
  assert.equal(isRecordedSubagent(state, 'child'), true)
  assert.equal(isRecordedSubagent(state, 'plain'), false, 'an ordinary conversation is never recorded')

  const again = syncThreads(state, [
    { id: 'child', displayTitle: '子智能体', origin: 'subagent', parentId: 'p' },
    { id: 'plain', displayTitle: '普通会话' },
  ])
  assert.deepEqual(again.subagentSessionIds, ['child'], 'recording is idempotent, not cumulative')
})

test('the subagent ledger survives a reload', () => {
  const state = syncThreads(emptyMap(), [{ id: 'child', displayTitle: '子智能体', origin: 'subagent' }])
  const reloaded = parseMapState(JSON.stringify(state))
  assert.deepEqual(reloaded.subagentSessionIds, ['child'], 'the Host half reads it back from the document')
  assert.equal(isRecordedSubagent(reloaded, 'child'), true)
})

test('a subagent row that predates the rule is pruned once the catalog reports the origin', () => {
  // A stored subagent row can only come from a legacy or hand-built document.
  const stale = syncThreads(emptyMap(), [{ id: 'child', displayTitle: '子智能体' }])
  assert.deepEqual(stale.threads.map(thread => thread.sessionId), ['child'], 'the fixture really stores one')
  const rows = indexableSessions([
    { id: 'p', title: '父会话' },
    { id: 'child', title: '子智能体', origin: 'subagent', parentId: 'p' },
  ], null)
  const synced = syncThreads(stale, [
    { id: 'p', title: '父会话' },
    { id: 'child', title: '子智能体', origin: 'subagent', parentId: 'p' },
  ], null)
  const pruned = pruneMissing(synced, new Set(rows.map(row => row.id)))
  assert.deepEqual(pruned.threads.map(thread => thread.sessionId), ['p'], 'the stale row leaves')
  assert.equal(isRecordedSubagent(pruned, 'child'), true, 'and its id is still known')
})

test('a new map is empty and starts at revision zero', () => {
  const state = emptyMap()
  assert.equal(state.revision, 0)
  assert.equal(state.version, 2)
  assert.deepEqual(topNodesOf(state, 'w1'), [])
  assert.deepEqual(directThreadsOf(state, 'w1'), [])
})

test('a topic belongs to the Workspace it is created in, and children inherit it', () => {
  const state = seed()
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a')), 'w1')
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a1')), 'w1')
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'b')), 'w2')
  assert.deepEqual(topNodesOf(state, 'w1').map(node => node.id), ['a'])
  assert.deepEqual(topNodesOf(state, 'w2').map(node => node.id), ['b'])
  assert.deepEqual(childrenOf(state, 'a').map(node => node.id), ['a1'])
})

test('a child may not be created in another Workspace than its parent', () => {
  assert.throws(
    () => createNode(seed(), { parentId: 'a', workspaceId: 'w2', title: '错位' }),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
  )
})

test('nodePath returns the root-first path', () => {
  const state = seed()
  assert.deepEqual(nodePath(state, 'a1').map(node => node.title), ['外贸探索', '获客方式'])
  assert.deepEqual(nodePath(state, 'a').map(node => node.title), ['外贸探索'])
})

test('ancestorRowKeys lists the lineage above the selection, Workspace last', () => {
  const state = seed()
  assert.deepEqual(ancestorRowKeys(state, 'a1'), ['a', '@ws:w1'], 'the top-level topic then the owning Workspace row')
  assert.deepEqual(ancestorRowKeys(state, 'a'), ['@ws:w1'], 'a top-level topic sits directly in its Workspace')
  assert.deepEqual(ancestorRowKeys(state, 'gone'), [], 'an unknown id marks no row')
})

test('ancestorRowKeys ends a legacy rootless chain in the ungrouped bucket', () => {
  const root = createNode(emptyMap(), { parentId: null, workspaceId: null, title: '散落主题' })
  const child = createNode(root.state, { parentId: root.id, workspaceId: null, title: '散落子主题' })
  assert.deepEqual(ancestorRowKeys(child.state, child.id), [root.id, UNGROUPED_ID])
})

test('descendantIds covers the whole subtree', () => {
  const state = seed()
  assert.deepEqual([...descendantIds(state, 'a')].sort(), ['a', 'a1'])
})

test('a blank title is rejected', () => {
  const state = emptyMap()
  assert.throws(() => createNode(state, { parentId: null, workspaceId: 'w1', title: '   ' }), (error) => error instanceof MapError && error.code === 'TITLE_EMPTY')
})

test('nesting deeper than the limit is rejected', () => {
  let state = emptyMap()
  let parentId = null
  for (let level = 1; level <= MAX_DEPTH; level += 1) {
    const created = createNode(state, { parentId, workspaceId: 'w1', title: `L${level}` })
    state = created.state
    parentId = created.id
  }
  assert.throws(
    () => createNode(state, { parentId, workspaceId: 'w1', title: 'too deep' }),
    (error) => error instanceof MapError && error.code === 'DEPTH',
  )
})

test('a node cannot be moved into its own subtree', () => {
  const state = seed()
  assert.throws(
    () => moveNode(state, 'a', 'a1'),
    (error) => error instanceof MapError && error.code === 'CYCLE',
  )
})

test('a node cannot be moved into another Workspace', () => {
  assert.throws(
    () => moveNode(seed(), 'a1', 'b'),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
  )
})

test('moving a node keeps its subtree and its conversations', () => {
  let state = seed()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '第二主题', id: 'a2' }).state
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境建议' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  state = moveNode(state, 'a1', 'a2')
  assert.deepEqual(nodePath(state, 'a1').map(node => node.title), ['第二主题', '获客方式'])
  assert.deepEqual(threadsOf(state, 'a1').map(thread => thread.sessionId), ['s1'])
})

test('deleting a leaf leaves its conversations directly under the Workspace', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境建议' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  assert.equal(threadsOf(state, 'a1').map(thread => thread.sessionId).length, 1)
  state = deleteNode(state, 'a1')
  assert.equal(state.nodes.some(node => node.id === 'a1'), false)
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId), ['s1'])
})

test('a node with children cannot be deleted', () => {
  const state = seed()
  assert.throws(
    () => deleteNode(state, 'a'),
    (error) => error instanceof MapError && error.code === 'HAS_CHILDREN',
  )
})

test('deleting a subtree removes every descendant and frees its conversations', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', workspaceId: 'w1', title: '深一层', id: 'a11' }).state
  state = syncThreads(state, [
    { id: 's1', displayTitle: '跨境建议' },
    { id: 's2', displayTitle: '产品讨论' },
  ], null, new Map([['s1', 'w1'], ['s2', 'w1']]))
  state = assignThreads(state, ['s1'], 'a11')
  state = assignThreads(state, ['s2'], 'a')
  const before = state.revision
  const next = deleteNodeSubtree(state, 'a')
  assert.equal(next.nodes.some(node => ['a', 'a1', 'a11'].includes(node.id)), false, 'the root and every descendant are gone')
  assert.ok(next.nodes.some(node => node.id === 'b'), 'a sibling root survives')
  assert.equal(next.revision, before + 1, 'the whole subtree leaves in one revision bump')
  assert.deepEqual(
    directThreadsOf(next, 'w1').map(thread => thread.sessionId).sort(),
    ['s1', 's2'],
    'conversations under the removed subtree stay in the Workspace, directly under its row',
  )
  assert.deepEqual(
    next.threads.map(thread => thread.title).sort(),
    ['产品讨论', '跨境建议'],
    'conversation rows keep their own data',
  )
})

test('subtreeDeletionSummary counts descendants and filed conversations', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', workspaceId: 'w1', title: '深一层', id: 'a11' }).state
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境建议' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  assert.deepEqual(subtreeDeletionSummary(state, 'a'), { nodes: 2, conversations: 1 }, 'a11 and a1 count as descendants; the filed conversation is counted')
  assert.deepEqual(subtreeDeletionSummary(state, 'a1'), { nodes: 1, conversations: 1 }, 'the root itself never counts as one of the nodes below')
  assert.deepEqual(subtreeDeletionSummary(state, 'b'), { nodes: 0, conversations: 0 }, 'a leaf has nothing below it')
  assert.deepEqual(subtreeDeletionSummary(state, 'missing'), { nodes: 0, conversations: 0 }, 'an unknown id is a zero read, not an error')
})

test('deleting a missing subtree root reports NOT_FOUND', () => {
  assert.throws(
    () => deleteNodeSubtree(seed(), 'missing'),
    (error) => error instanceof MapError && error.code === 'NOT_FOUND',
  )
})

test('each conversation has exactly one topic inside its Workspace', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境建议' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a')
  assert.deepEqual(threadsOf(state, 'a').map(thread => thread.sessionId), ['s1'])
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '另一个主题', id: 'a2' }).state
  state = assignThreads(state, ['s1'], 'a2')
  assert.deepEqual(threadsOf(state, 'a'), [])
  assert.deepEqual(threadsOf(state, 'a2').map(thread => thread.sessionId), ['s1'])
  state = assignThreads(state, ['s1'], null)
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId), ['s1'])
})

test('a conversation can only be filed under a topic of its own Workspace', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境建议' }], null, new Map([['s1', 'w1']]))
  assert.throws(
    () => assignThreads(state, ['s1'], 'b'),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
  )
})

test('syncing the catalog keeps topic ownership and files new conversations by Workspace', () => {
  let state = syncThreads(seed(), [{ id: 's1', displayTitle: '旧标题' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a')
  state = syncThreads(state, [
    { id: 's1', displayTitle: '新标题' },
    { id: 's2', displayTitle: '另一条' },
  ], null, new Map([['s1', 'w1'], ['s2', 'w2']]))
  assert.deepEqual(threadsOf(state, 'a').map(thread => thread.title), ['新标题'])
  assert.equal(state.threads.find(thread => thread.sessionId === 's2')?.workspaceId, 'w2')
  assert.deepEqual(directThreadsOf(state, 'w2').map(thread => thread.sessionId), ['s2'])
})

test('pruning drops conversations the catalog no longer lists', () => {
  let state = syncThreads(seed(), [{ id: 's1', displayTitle: 'A' }, { id: 's2', displayTitle: 'B' }], null, new Map([['s1', 'w1'], ['s2', 'w1']]))
  const pruned = pruneMissing(state, new Set(['s1']))
  assert.deepEqual(pruned.threads.map(thread => thread.sessionId), ['s1'])
  assert.equal(pruneMissing(pruned, new Set(['s1', 's2'])), pruned, 'an unchanged catalog keeps state identity')
})

test('a forked conversation joins the topic of the conversation it branched from', () => {
  let state = syncThreads(seed(), [{ id: 'src', displayTitle: '源会话' }], null, new Map([['src', 'w1']]))
  state = assignThreads(state, ['src'], 'a1')
  state = syncThreads(state, [
    { id: 'src', displayTitle: '源会话' },
    // The catalog names the source conversation through `parentId`; DSH also
    // renames the child, which is why the row reads like a branch.
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w1'], ['fork', 'w1']]))
  const fork = threadOfSession(state, 'fork')
  assert.equal(fork.nodeId, 'a1', 'the branch is filed beside its source, not at the Workspace root')
  assert.equal(fork.workspaceId, 'w1', 'and in the Workspace the Host accounts it to')
  assert.deepEqual(threadsOf(state, 'a1').map(thread => thread.sessionId).sort(), ['fork', 'src'])
  assert.deepEqual(directThreadsOf(state, 'w1'), [], 'nothing was left directly under the Workspace')
})

test('a fork inherits its source Workspace when the Host accounting lags the catalog row', () => {
  let state = syncThreads(seed(), [{ id: 'src', displayTitle: '源会话' }], null, new Map([['src', 'w1']]))
  state = assignThreads(state, ['src'], 'a1')
  // The catalog can report the fork one snapshot before the Workspace list
  // accounts it. Without the source's owner the topic below would be dropped by
  // the reconciliation that follows the sync.
  state = syncThreads(state, [
    { id: 'src', displayTitle: '源会话' },
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w1']]))
  const fork = threadOfSession(state, 'fork')
  assert.equal(fork.workspaceId, 'w1', 'the source Workspace is inherited while the Host list catches up')
  assert.equal(fork.nodeId, 'a1')
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha', ['src', 'fork'])])
  assert.equal(threadOfSession(state, 'fork').nodeId, 'a1', 'the inherited place survives reconciliation')
})

test('a fork whose source is not indexed stays directly under its Workspace', () => {
  const state = syncThreads(seed(), [
    { id: 'fork', parentId: 'ghost', displayTitle: '无源分支' },
  ], null, new Map([['fork', 'w1']]))
  const fork = threadOfSession(state, 'fork')
  assert.equal(fork.nodeId, null, 'the map does not invent a topic for an unknown source')
  assert.equal(fork.workspaceId, 'w1')
})

test('a fork of a topic in another Workspace does not inherit that topic', () => {
  let state = syncThreads(seed(), [{ id: 'src', displayTitle: '源会话' }], null, new Map([['src', 'w2']]))
  state = assignThreads(state, ['src'], 'b')
  // Defensive: the Host attaches a fork to its source's Workspace, so a
  // disagreement here means stale accounting rather than a legal state.
  state = syncThreads(state, [
    { id: 'src', displayTitle: '源会话' },
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w2'], ['fork', 'w1']]))
  const fork = threadOfSession(state, 'fork')
  assert.equal(fork.nodeId, null, 'a topic never holds a conversation of another Workspace')
  assert.equal(fork.workspaceId, 'w1', 'the Host accounting still wins')
})

test('a fork of a fork inherits through the chain, whatever order the catalog lists', () => {
  let state = syncThreads(seed(), [{ id: 'src', displayTitle: '源会话' }], null, new Map([['src', 'w1']]))
  state = assignThreads(state, ['src'], 'a1')
  // Both rows are new in one snapshot, and the catalog lists the child first:
  // the second pass has to place the middle row before the leaf can inherit.
  state = syncThreads(state, [
    { id: 'leaf', parentId: 'middle', displayTitle: '源会话 (2)' },
    { id: 'middle', parentId: 'src', displayTitle: '源会话 (1)' },
    { id: 'src', displayTitle: '源会话' },
  ], null, new Map([['src', 'w1'], ['middle', 'w1'], ['leaf', 'w1']]))
  assert.equal(threadOfSession(state, 'middle').nodeId, 'a1')
  assert.equal(threadOfSession(state, 'leaf').nodeId, 'a1')
})

test('a fork the reader already filed keeps its place on later syncs', () => {
  let state = syncThreads(seed(), [
    { id: 'src', displayTitle: '源会话' },
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w1'], ['fork', 'w1']]))
  state = assignThreads(state, ['src'], 'a')
  // The reader deliberately moved the branch to another topic (or to the
  // Workspace root); a later catalog sync must not pull it back to its source.
  state = assignThreads(state, ['fork'], null)
  const synced = syncThreads(state, [
    { id: 'src', displayTitle: '源会话' },
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w1'], ['fork', 'w1']]))
  assert.equal(threadOfSession(synced, 'fork').nodeId, null, 'inheritance only decides a row the map has never filed')
  assert.deepEqual(directThreadsOf(synced, 'w1').map(thread => thread.sessionId), ['fork'])
})

test('a fork of a loose conversation keeps its source space', () => {
  let state = ensureDefaultSpace(emptyMap())
  state = createSpace(state, { title: '家庭', id: 'fam' }).state
  state = syncThreads(state, [{ id: 'src', displayTitle: '散落会话' }], null)
  state = setThreadSpace(state, 'src', 'fam')
  state = syncThreads(state, [
    { id: 'src', displayTitle: '散落会话' },
    { id: 'fork', parentId: 'src', displayTitle: '散落会话 (1)' },
  ], null)
  assert.equal(threadOfSession(state, 'fork').spaceId, 'fam', 'the branch stays in the space the reader filed its source into')
  assert.equal(threadOfSession(state, 'fork').nodeId, null, 'a loose conversation has no topic to inherit')
})

test('a self-parented catalog row is not a source', () => {
  const state = syncThreads(seed(), [
    { id: 'self', parentId: 'self', displayTitle: '自指' },
  ], null, new Map([['self', 'w1']]))
  assert.equal(threadOfSession(state, 'self').nodeId, null, 'a row cannot inherit from itself')
})

test('a fork whose source topic was deleted falls back to the Workspace root', () => {
  let state = syncThreads(seed(), [{ id: 'src', displayTitle: '源会话' }], null, new Map([['src', 'w1']]))
  state = assignThreads(state, ['src'], 'a1')
  state = deleteNode(state, 'a1')
  state = syncThreads(state, [
    { id: 'src', displayTitle: '源会话' },
    { id: 'fork', parentId: 'src', displayTitle: '源会话 (1)' },
  ], null, new Map([['src', 'w1'], ['fork', 'w1']]))
  assert.equal(threadOfSession(state, 'fork').nodeId, null, 'a stale source topic is not resurrected as a destination')
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId).sort(), ['fork', 'src'])
})

test('syncing records a subagent child without giving it a row, and never invents one', () => {
  let state = syncThreads(seed(), [
    { id: 'p', displayTitle: '父会话' },
    { id: 'c', displayTitle: '子智能体', origin: 'subagent', parentId: 'p' },
    { id: 'o', displayTitle: '普通会话' },
  ], null, new Map([['p', 'w1'], ['c', 'w1'], ['o', 'w1']]))
  assert.deepEqual(state.threads.map(thread => thread.sessionId), ['p', 'o'], 'the child is not indexed')
  assert.deepEqual(state.subagentSessionIds, ['c'], 'the fact survives where the Host half can read it')
  assert.equal(isRecordedSubagent(state, 'c'), true)
  assert.equal(isRecordedSubagent(state, 'p'), false, 'an ordinary conversation is never recorded')
  assert.equal(isRecordedSubagent(state, 'o'), false)

  // Recording is a fact about the catalog, not a guess: without an origin the
  // id is treated as an ordinary conversation.
  state = syncThreads(state, [{ id: 'mystery', displayTitle: '没有来源' }], null, new Map([['mystery', 'w1']]))
  assert.equal(isRecordedSubagent(state, 'mystery'), false)
})

test('a real pre-ledger document parses to an empty ledger and still prunes', () => {
  // The guard in pruneMissing must not misfire on genuine old data: JSON that
  // predates the field parses to [], not undefined.
  const stored = JSON.stringify({
    version: 2, revision: 4, nodes: [], spaces: [], defaultSpaceId: '', spaceOf: {},
    threads: [{ sessionId: 'c', nodeId: null, title: '子智能体', updatedAt: '', importedAt: '', origin: 'subagent' }],
  })
  const legacy = parseMapState(stored)
  assert.deepEqual(legacy.subagentSessionIds, [], 'an absent field reads as an empty ledger')
  assert.deepEqual(pruneMissing(legacy, new Set()).threads, [], 'so the stale row is pruned')
})

test('a hand-built document missing the ledger is left alone rather than pruned blind', () => {
  const broken = { ...emptyMap(), threads: [{ sessionId: 'c', nodeId: null, title: '子智能体', updatedAt: '', importedAt: '', origin: 'subagent' }] }
  delete broken.subagentSessionIds
  assert.equal(pruneMissing(broken, new Set()), broken, 'an impossible state is not destroyed')
})

test('the subagent ledger survives a save and load round trip', () => {
  const state = { ...emptyMap(), subagentSessionIds: ['c1', 'c2'] }
  const loaded = parseMapState(JSON.stringify(state))
  assert.deepEqual(loaded.subagentSessionIds, ['c1', 'c2'])
  assert.deepEqual(parseMapState(JSON.stringify({ ...emptyMap(), subagentSessionIds: ['ok', 7, ''] })).subagentSessionIds, ['ok'],
    'non-string and empty entries are dropped')
})

test('updating a node refreshes title and description', () => {
  const state = updateNode(seed(), { id: 'b', title: '产品设计 2', description: '下一阶段问题' })
  const node = state.nodes.find(candidate => candidate.id === 'b')
  assert.equal(node?.title, '产品设计 2')
  assert.equal(node?.description, '下一阶段问题')
})

test('creating a node records both creation and update time', () => {
  const created = createNode(seed(), { parentId: null, workspaceId: 'w1', title: '第三个主题', id: 'n3' })
  const node = created.state.nodes.find(candidate => candidate.id === 'n3')
  assert.equal(typeof node?.createdAt, 'string')
  assert.equal(node?.createdAt, node?.updatedAt, 'a new node is created and updated at the same instant')
})

test('editing a node keeps its creation time', () => {
  const created = createNode(seed(), { parentId: null, workspaceId: 'w1', title: '第三个主题', id: 'n3' })
  const createdAt = created.state.nodes.find(candidate => candidate.id === 'n3')?.createdAt
  const edited = updateNode(created.state, { id: 'n3', title: '第三个主题 2', description: '补充说明' })
  const node = edited.nodes.find(candidate => candidate.id === 'n3')
  assert.equal(node?.createdAt, createdAt)
  assert.equal(typeof node?.updatedAt, 'string')
})

test('a document written before createdAt existed still parses', () => {
  const legacy = JSON.stringify({
    version: 2,
    revision: 1,
    nodes: [{ id: 'a', parentId: null, title: '旧节点', description: '', position: 1, updatedAt: '' }],
    threads: [],
  })
  const state = parseMapState(legacy)
  assert.equal(state.nodes[0].createdAt, undefined)
})

test('createdAt survives a save and load round trip', () => {
  const backing = new Map()
  const store = {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
  const state = createNode(seed(), { parentId: null, workspaceId: 'w1', title: '带创建时间', id: 'n4' }).state
  saveMap(store, state)
  const loaded = loadMap(store)
  const node = loaded.nodes.find(candidate => candidate.id === 'n4')
  assert.equal(typeof node?.createdAt, 'string')
  assert.equal(node?.createdAt, state.nodes.find(candidate => candidate.id === 'n4')?.createdAt)
})

test('every mutation advances the revision', () => {
  const state = seed()
  const after = createNode(state, { parentId: null, workspaceId: 'w1', title: '第三个主题' }).state
  assert.equal(after.revision, state.revision + 1)
})

test('the map round-trips through a key/value store', () => {
  const backing = new Map()
  const store = {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
  const state = assignThreads(
    syncThreads(seed(), [{ id: 's1', displayTitle: 'A' }], null, new Map([['s1', 'w1']])),
    ['s1'],
    'a',
  )
  saveMap(store, state)
  assert.equal(backing.has(STORAGE_KEY), true)
  assert.deepEqual(loadMap(store), state)
})

test('unreadable persisted content falls back to an empty map', () => {
  assert.deepEqual(parseMapState('{ not json'), emptyMap())
  assert.deepEqual(parseMapState(JSON.stringify({ version: 9 })), emptyMap())
  assert.deepEqual(loadMap({ getItem: () => { throw new Error('denied') }, setItem: () => {} }), emptyMap())
})

test('a version-1 document upgrades without losing its tree', () => {
  const legacy = JSON.stringify({
    version: 1,
    revision: 7,
    nodes: [{ id: 'a', parentId: null, title: '外贸探索', description: '', position: 1, updatedAt: '' }],
    threads: [{ sessionId: 's1', nodeId: 'a', title: '旧对话', updatedAt: '', importedAt: '' }],
  })
  const state = parseMapState(legacy)
  assert.equal(state.version, 2)
  assert.equal(state.revision, 7)
  assert.deepEqual(state.nodes.map(node => node.id), ['a'])
  assert.equal(state.nodes[0].workspaceId, undefined, 'the owner is resolved once the Workspace list is known')
  assert.deepEqual(state.threads.map(thread => thread.sessionId), ['s1'])
})

test('reconciliation files legacy roots into the Workspace their conversations live in', () => {
  let state = parseMapState(JSON.stringify({
    version: 1,
    revision: 1,
    nodes: [{ id: 'a', parentId: null, title: '随便起的标题', description: '', position: 1, updatedAt: '' }],
    threads: [{ sessionId: 's1', nodeId: 'a', title: '在 w2 里', updatedAt: '', importedAt: '' }],
  }))
  state = syncThreads(state, [{ id: 's1', displayTitle: '在 w2 里' }], null, new Map([['s1', 'w2']]))
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha'), workspace('w2', 'beta', ['s1'])])
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a')), 'w2', 'membership outranks the title guess')
  assert.equal(state.threads[0].workspaceId, 'w2')
  assert.equal(state.threads[0].nodeId, 'a')
})

test('reconciliation falls back to a Workspace title when conversations say nothing', () => {
  let state = parseMapState(JSON.stringify({
    version: 1,
    revision: 1,
    nodes: [{ id: 'a', parentId: null, title: 'alpha', description: '', position: 1, updatedAt: '' }],
    threads: [],
  }))
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha'), workspace('w2', 'beta')])
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a')), 'w1')
})

test('a legacy child inherits the Workspace its root was filed into', () => {
  let state = parseMapState(JSON.stringify({
    version: 1,
    revision: 1,
    nodes: [
      { id: 'a', parentId: null, title: 'alpha', description: '', position: 1, updatedAt: '' },
      { id: 'a1', parentId: 'a', title: '子主题', description: '', position: 1, updatedAt: '' },
    ],
    threads: [],
  }))
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha')])
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a1')), 'w1')
})

test('deleting a Workspace moves its topics to the ungrouped bucket', () => {
  let state = seed()
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha'), workspace('w2', 'beta')])
  state = reconcileWorkspaces(state, [workspace('w2', 'beta')])
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a')), null)
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'a1')), null)
  assert.deepEqual(topNodesOf(state, null).map(node => node.id), ['a'])
  assert.equal(workspaceOfNode(state.nodes.find(node => node.id === 'b')), 'w2')
})

test('a conversation that leaves a Workspace also leaves its topic', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '跨境' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a')
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha', ['s1']), workspace('w2', 'beta')])
  assert.equal(state.threads[0].nodeId, 'a')
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha'), workspace('w2', 'beta', ['s1'])])
  assert.equal(state.threads[0].workspaceId, 'w2')
  assert.equal(state.threads[0].nodeId, null, 'the topic belonged to the old Workspace')
})

test('reconciliation is identity-stable when nothing changed', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: 'A' }], null, new Map([['s1', 'w1']]))
  const folded = reconcileWorkspaces(state, [workspace('w1', 'alpha', ['s1']), workspace('w2', 'beta')])
  assert.equal(reconcileWorkspaces(folded, [workspace('w1', 'alpha', ['s1']), workspace('w2', 'beta')]), folded)
})

test('search matches node titles, node descriptions, and conversation titles', () => {
  let state = updateNode(seed(), { id: 'b', title: '产品设计', description: '下一阶段的定价问题' })
  state = syncThreads(state, [{ id: 's1', displayTitle: '阿里国际站外贸模式' }], null, new Map([['s1', 'w1']]))
  assert.deepEqual(searchMap(state, '定价').nodes.map(hit => hit.node.id), ['b'])
  assert.deepEqual(searchMap(state, '外贸').nodes.map(hit => hit.node.id), ['a'])
  assert.deepEqual(searchMap(state, '国际站').threads.map(hit => hit.thread.sessionId), ['s1'])
  assert.deepEqual(searchMap(state, '   '), { nodes: [], threads: [] })
})

test('search is case-insensitive', () => {
  const state = syncThreads(seed(), [{ id: 's1', displayTitle: 'Codex Notes' }], null, new Map([['s1', 'w1']]))
  assert.deepEqual(searchMap(state, 'codex').threads.map(hit => hit.thread.sessionId), ['s1'])
})

test('breadcrumb names the path from the Workspace root', () => {
  const state = seed()
  assert.equal(breadcrumb(state, 'a1'), '外贸探索 / 获客方式')
  assert.equal(breadcrumb(state, 'b'), '产品设计')
})

test('Workspace selection keys name the first level unambiguously', () => {
  assert.equal(workspaceNodeId('w1'), '@ws:w1')
  assert.equal(workspaceKey('w1'), '@ws:w1')
  assert.equal(workspaceKey(null), UNGROUPED_ID)
  assert.equal(isWorkspaceSelectionKey('@ws:w1'), true)
  assert.equal(isWorkspaceSelectionKey(UNGROUPED_ID), true)
  assert.equal(isWorkspaceSelectionKey('node-1'), false)
  assert.deepEqual(workspaceSelection('@ws:w1'), { workspaceId: 'w1' })
  assert.deepEqual(workspaceSelection(UNGROUPED_ID), { workspaceId: null })
  assert.equal(workspaceSelection('node-1'), undefined)
})

test('deleting a top-level node selects its Workspace', () => {
  const state = seed()
  assert.equal(selectionAfterNodeDeletion(state, 'a'), '@ws:w1')
  assert.equal(selectionAfterNodeDeletion(state, 'a1'), 'a')
})

test('Workspace titles prefer the stored title, then the directory name', () => {
  assert.equal(workspaceDisplayTitle({ title: '外贸探索', path: '/tmp/x' }, ZH_TITLES), '外贸探索')
  assert.equal(workspaceDisplayTitle({ title: 'default-workspace', path: '/tmp/x' }, ZH_TITLES), '默认工作区')
  assert.equal(workspaceDisplayTitle({ title: '', path: '/home/me/projects/task-map/' }, ZH_TITLES), 'task-map')
  assert.equal(pathBaseName('/home/me/projects/task-map/'), 'task-map')
  assert.equal(pathBaseName('C:\\work\\alpha'), 'alpha')
})

test('a newly created conversation is adopted under its row and Workspace', () => {
  const state = adoptThread(seed(), { sessionId: 's9', title: '', nodeId: 'a1', workspaceId: 'w1' })
  assert.deepEqual(threadsOf(state, 'a1').map(thread => thread.sessionId), ['s9'])
  assert.equal(state.threads.find(thread => thread.sessionId === 's9')?.title, 's9')
  assert.equal(state.threads.find(thread => thread.sessionId === 's9')?.workspaceId, 'w1')
})

test('adopting directly under a Workspace keeps it out of every topic', () => {
  const state = adoptThread(seed(), { sessionId: 's9', title: '', nodeId: null, workspaceId: 'w2' })
  assert.deepEqual(directThreadsOf(state, 'w2').map(thread => thread.sessionId), ['s9'])
  assert.deepEqual(threadsOf(state, 'b'), [])
})

test('adopting an already indexed conversation moves its ownership', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '旧标题' }], null, new Map([['s1', 'w2']]))
  state = adoptThread(state, { sessionId: 's1', title: '新标题', nodeId: 'b', workspaceId: 'w2' })
  assert.deepEqual(threadsOf(state, 'b').map(thread => thread.title), ['新标题'])
})

test('adopting into a missing node is rejected', () => {
  assert.throws(
    () => adoptThread(seed(), { sessionId: 's9', title: 't', nodeId: 'missing', workspaceId: 'w1' }),
    (error) => error instanceof MapError && error.code === 'NOT_FOUND',
  )
})

test('the id chip strips the session- prefix so ids stay distinguishable', () => {
  assert.equal(shortSessionId('session-4f2a9c31-0000-4000-8000-000000000000'), '4f2a9c31')
  assert.equal(shortSessionId('80556a84-1111-4222-8333-444444444444'), '80556a84')
  assert.notEqual(
    shortSessionId('session-4f2a9c31-0000-4000-8000-000000000000'),
    shortSessionId('session-9b7e1d20-0000-4000-8000-000000000000'),
  )
})

test('a node lists its conversations newest activity first', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 'old', displayTitle: '更早的一轮', updatedAt: Date.parse('2024-01-01T00:00:00.000Z') },
    { id: 'newer', displayTitle: '中间的一轮', updatedAt: Date.parse('2024-06-01T00:00:00.000Z') },
    { id: 'newest', displayTitle: '最近的一轮', updatedAt: Date.parse('2024-12-01T00:00:00.000Z') },
  ], null, new Map([['old', 'w1'], ['newer', 'w1'], ['newest', 'w1']]))
  state = assignThreads(state, ['old', 'newer', 'newest'], 'a')
  assert.deepEqual(threadsOf(state, 'a').map(thread => thread.sessionId), ['newest', 'newer', 'old'])
})

test('a Workspace lists its direct conversations newest activity first', () => {
  const state = syncThreads(seed(), [
    { id: 'old', displayTitle: '更早的一轮', updatedAt: Date.parse('2024-01-01T00:00:00.000Z') },
    { id: 'newest', displayTitle: '最近的一轮', updatedAt: Date.parse('2024-12-01T00:00:00.000Z') },
  ], null, new Map([['old', 'w1'], ['newest', 'w1']]))
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId), ['newest', 'old'])
})

test('a conversation just started under a node lands at the top of its list', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 's1', displayTitle: '旧的一轮', updatedAt: Date.parse('2024-01-01T00:00:00.000Z') },
    { id: 's2', displayTitle: '另一轮', updatedAt: Date.parse('2024-06-01T00:00:00.000Z') },
  ], null, new Map([['s1', 'w1'], ['s2', 'w1']]))
  state = assignThreads(state, ['s1', 's2'], 'a')
  state = adoptThread(state, { sessionId: 's9', title: '', nodeId: 'a', workspaceId: 'w1' })
  assert.deepEqual(threadsOf(state, 'a').map(thread => thread.sessionId), ['s9', 's2', 's1'])
})

test('a conversation just started directly under a Workspace lands at the top', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 's1', displayTitle: '旧的一轮', updatedAt: Date.parse('2024-01-01T00:00:00.000Z') },
  ], null, new Map([['s1', 'w1']]))
  state = adoptThread(state, { sessionId: 's9', title: '', nodeId: null, workspaceId: 'w1' })
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId), ['s9', 's1'])
})

test('conversations sharing an activity stamp keep the Host order', () => {
  const stamp = Date.parse('2024-06-01T00:00:00.000Z')
  const state = syncThreads(seed(), [
    { id: 'first', displayTitle: '先列的', updatedAt: stamp },
    { id: 'second', displayTitle: '后列的', updatedAt: stamp },
  ], null, new Map([['first', 'w1'], ['second', 'w1']]))
  assert.deepEqual(directThreadsOf(state, 'w1').map(thread => thread.sessionId), ['first', 'second'])
})

test('a conversation is looked up by session id', () => {
  const state = syncThreads(seed(), [
    { id: 'known', displayTitle: '已知的', updatedAt: 0 },
  ], null, new Map([['known', 'w1']]))
  assert.equal(threadOfSession(state, 'known').sessionId, 'known')
  assert.equal(threadOfSession(state, 'missing'), undefined)
})

/* ── opening a conversation activates its home ──────────────────────────── */

test('opening a conversation activates the topic it is filed under', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '挂在主题下', updatedAt: 0 }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  assert.equal(selectionOfThread(state, threadOfSession(state, 's1')), 'a1')
})

test('opening a conversation filed directly under a Workspace activates that Workspace row', () => {
  const state = syncThreads(seed(), [{ id: 's2', displayTitle: '工作区直挂', updatedAt: 0 }], null, new Map([['s2', 'w2']]))
  const thread = threadOfSession(state, 's2')
  assert.equal(thread.nodeId, null)
  assert.equal(selectionOfThread(state, thread), workspaceKey('w2'))
})

test('a topic that outlived its deletion in the index activates its Workspace instead', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's3', displayTitle: '孤儿', updatedAt: 0 }], null, new Map([['s3', 'w1']]))
  state = assignThreads(state, ['s3'], 'a1')
  // A topic copy that vanished from the document while the index still names it.
  const stale = { ...state, nodes: state.nodes.filter(node => node.id !== 'a1') }
  const thread = threadOfSession(stale, 's3')
  assert.equal(thread.nodeId, 'a1')
  assert.equal(selectionOfThread(stale, thread), workspaceKey('w1'))
})

test('an ungrouped conversation activates its space ungrouped row', () => {
  // The tree's position is derived from the conversation: an ungrouped one has
  // no node, but it does have a place — its space's ungrouped row. Returning
  // "no selection" would leave the reader in an unrelated branch, which is the
  // exact confusion this rule exists to prevent.
  const state = syncThreads(seed(), [{ id: 's4', displayTitle: '散落', updatedAt: 0 }], null, new Map([['s4', null]]))
  assert.equal(selectionOfThread(state, threadOfSession(state, 's4')), looseRowKey(state, state.defaultSpaceId))
})

test('the home row names the topic, the Workspace row, the ungrouped row, or the archive row', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 'under-topic', displayTitle: '主题下', updatedAt: 0 },
    { id: 'under-workspace', displayTitle: '工作区直挂', updatedAt: 0 },
    { id: 'loose', displayTitle: '散落', updatedAt: 0 },
  ], null, new Map([['under-topic', 'w1'], ['under-workspace', 'w2'], ['loose', null]]))
  state = assignThreads(state, ['under-topic'], 'a1')
  const topicHome = sessionHomeRow(state, 'under-topic')
  assert.equal(topicHome.selection, 'a1')
  assert.equal(topicHome.nodeId, 'a1')
  assert.equal(topicHome.workspaceId, 'w1')
  assert.equal(topicHome.spaceId, spaceOfWorkspace(state, 'w1'))
  assert.equal(sessionHomeRow(state, 'under-workspace').selection, workspaceKey('w2'))
  assert.equal(sessionHomeRow(state, 'loose').selection, looseRowKey(state, state.defaultSpaceId))
  assert.equal(sessionHomeRow(state, 'missing'), undefined)
  assert.equal(sessionHomeRow(state, null), undefined)
})

test('an archived conversation is reached through its Workspace archive row', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 'archived', displayTitle: '归档对话', updatedAt: 0 }], null, new Map([['archived', 'w2']]))
  state = archiveThread(state, 'archived')
  assert.equal(sessionHomeRow(state, 'archived').selection, archiveKey('w2'))
  assert.equal(selectionOfThread(state, threadOfSession(state, 'archived')), archiveKey('w2'))
})

/* ── spaces ─────────────────────────────────────────────────────────────── */

/** A map that has passed first-use bootstrapping. */
function bootstrapped() {
  const state = ensureDefaultSpace(emptyMap())
  return { state, defaultSpaceId: state.defaultSpaceId }
}

/** Two user spaces over a two-Workspace map, plus one loose conversation. */
function spaced() {
  let state = ensureDefaultSpace(emptyMap())
  const defaultSpaceId = state.defaultSpaceId
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  const family = createSpace(state, { title: '家庭空间' })
  state = family.state
  state = setWorkspaceSpace(state, 'w1', work.id)
  state = setWorkspaceSpace(state, 'w2', family.id)
  state = syncThreads(state, [
    { id: 's1', displayTitle: '工作对话' },
    { id: 's2', displayTitle: '家庭对话' },
    { id: 's3', displayTitle: '散落对话' },
  ], null, new Map([['s1', 'w1'], ['s2', 'w2'], ['s3', null]]))
  return { state, defaultSpaceId, work: work.id, family: family.id }
}

test('the first load creates one default space', () => {
  const state = ensureDefaultSpace(emptyMap())
  assert.equal(state.spaces.length, 1)
  assert.equal(state.spaces[0].title, DEFAULT_SPACE_TITLE)
  assert.equal(state.spaces[0].position, 1)
  assert.equal(state.defaultSpaceId, state.spaces[0].id)
  assert.equal(ensureDefaultSpace(state), state, 'bootstrapping is idempotent')
})

test('a broken default space pointer is repaired to the first space', () => {
  const { state } = spaced()
  const repaired = ensureDefaultSpace({ ...state, defaultSpaceId: 'gone' })
  assert.equal(repaired.defaultSpaceId, spaceList(repaired)[0].id)
})

test('a Workspace with no override belongs to the default space', () => {
  const { state, defaultSpaceId } = bootstrapped()
  assert.equal(spaceOfWorkspace(state, 'w1'), defaultSpaceId)
  assert.deepEqual(state.spaceOf, {}, 'the default space is never written')
})

test('spaces can be created and renamed, and names must be unique and non-empty', () => {
  let { state } = bootstrapped()
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  assert.deepEqual(spaceList(state).map(space => space.title), [DEFAULT_SPACE_TITLE, '工作空间'])
  assert.throws(() => createSpace(state, { title: '工作空间' }), (error) => error instanceof MapError && error.code === 'SPACE_TITLE_DUP')
  assert.throws(() => renameSpace(state, { id: work.id, title: '   ' }), (error) => error instanceof MapError && error.code === 'SPACE_TITLE_EMPTY')
  assert.throws(() => createSpace(state, { title: 'x'.repeat(41) }), (error) => error instanceof MapError && error.code === 'SPACE_TITLE_LONG')
  state = renameSpace(state, { id: work.id, title: '个人项目空间' })
  assert.equal(spaceList(state)[1].title, '个人项目空间')
  assert.equal(renameSpace(state, { id: work.id, title: '个人项目空间' }), state, 'renaming to the same title is a no-op')
})

test('the number of spaces is bounded', () => {
  let state = ensureDefaultSpace(emptyMap())
  for (let index = 1; index < MAX_SPACES; index += 1) {
    state = createSpace(state, { title: `空间 ${String(index)}` }).state
  }
  assert.equal(state.spaces.length, MAX_SPACES)
  assert.throws(() => createSpace(state, { title: '多出来的' }), (error) => error instanceof MapError && error.code === 'SPACE_LIMIT')
})

test('the default space cannot be deleted', () => {
  const { state, defaultSpaceId } = bootstrapped()
  assert.throws(() => deleteSpace(state, defaultSpaceId), (error) => error instanceof MapError && error.code === 'DEFAULT_SPACE')
})

test('a Workspace moves between spaces and falls back to the default space', () => {
  let { state, defaultSpaceId } = bootstrapped()
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  state = setWorkspaceSpace(state, 'w1', work.id)
  assert.equal(spaceOfWorkspace(state, 'w1'), work.id)
  assert.deepEqual(state.spaceOf, { w1: work.id }, 'the override is sparse')
  assert.equal(setWorkspaceSpace(state, 'w1', work.id), state, 'moving to the same space changes nothing')
  state = setWorkspaceSpace(state, 'w1', defaultSpaceId)
  assert.deepEqual(state.spaceOf, {}, 'the default space is the absence of an override')
})

test('a space lists only its Workspaces, in Host order', () => {
  const { state, work, family } = spaced()
  const workspaces = [workspace('w2', 'beta'), workspace('w1', 'alpha')]
  assert.deepEqual(workspacesInSpace(state, workspaces, work).map(entry => entry.workspaceId), ['w1'])
  assert.deepEqual(workspacesInSpace(state, workspaces, family).map(entry => entry.workspaceId), ['w2'])
})

test('each space lists only its own loose conversations', () => {
  const { state, defaultSpaceId, work } = spaced()
  assert.deepEqual(looseThreadsInSpace(state, defaultSpaceId).map(thread => thread.sessionId), ['s3'])
  assert.deepEqual(looseThreadsInSpace(state, work), [])
})

test('a loose conversation moves between spaces without touching its Workspace', () => {
  const { state: seeded, defaultSpaceId, work, family } = spaced()
  const state = setThreadSpace(seeded, 's3', work)
  const thread = state.threads.find(candidate => candidate.sessionId === 's3')
  assert.equal(spaceOfThread(state, thread), work)
  assert.equal(thread.workspaceId, null)
  assert.deepEqual(looseThreadsInSpace(state, work).map(entry => entry.sessionId), ['s3'])
  assert.deepEqual(looseThreadsInSpace(state, defaultSpaceId), [])
  const back = setThreadSpace(state, 's3', family)
  assert.deepEqual(looseThreadsInSpace(back, family).map(entry => entry.sessionId), ['s3'])
  assert.throws(() => setThreadSpace(state, 's1', work), (error) => error instanceof MapError && error.code === 'WORKSPACE')
})

test('moving a loose conversation out of the default space detaches it from a rootless topic', () => {
  let { state } = bootstrapped()
  state = createNode(state, { parentId: null, workspaceId: null, title: '无主主题', id: 'u1' }).state
  state = syncThreads(state, [{ id: 's3', displayTitle: '散落' }], null, new Map([['s3', null]]))
  state = assignThreads(state, ['s3'], 'u1')
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  state = setThreadSpace(state, 's3', work.id)
  const thread = state.threads.find(candidate => candidate.sessionId === 's3')
  assert.equal(thread.nodeId, null)
  assert.equal(spaceOfThread(state, thread), work.id)
})

test('a loose conversation filed into another space cannot join a rootless topic', () => {
  let { state } = bootstrapped()
  state = createNode(state, { parentId: null, workspaceId: null, title: '无主主题', id: 'u1' }).state
  state = syncThreads(state, [{ id: 's3', displayTitle: '散落' }], null, new Map([['s3', null]]))
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  state = setThreadSpace(state, 's3', work.id)
  assert.throws(() => assignThreads(state, ['s3'], 'u1'), (error) => error instanceof MapError && error.code === 'SPACE')
})

test('deleting a space returns its Workspaces and loose conversations to the default space', () => {
  let { state } = bootstrapped()
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  state = setWorkspaceSpace(state, 'w1', work.id)
  state = syncThreads(state, [{ id: 's3', displayTitle: '散落' }], null, new Map([['s3', null]]))
  state = setThreadSpace(state, 's3', work.id)
  const after = deleteSpace(state, work.id)
  assert.equal(spaceList(after).length, 1)
  assert.deepEqual(after.spaceOf, {})
  assert.equal(spaceOfThread(after, after.threads.find(thread => thread.sessionId === 's3')), after.defaultSpaceId)
  assert.deepEqual(looseThreadsInSpace(after, after.defaultSpaceId).map(thread => thread.sessionId), ['s3'])
})

test('a conversation claimed by a Workspace loses its local space', () => {
  const { state: seeded, work } = spaced()
  let state = setThreadSpace(seeded, 's3', work)
  state = reconcileWorkspaces(state, [workspace('w1', 'alpha', ['s1', 's3']), workspace('w2', 'beta', ['s2'])])
  const thread = state.threads.find(candidate => candidate.sessionId === 's3')
  assert.equal(thread.workspaceId, 'w1')
  assert.equal(thread.spaceId, undefined)
})

test('space reconciliation drops references to Workspaces and spaces that are gone', () => {
  const { state: seeded } = spaced()
  const orphanWorkspace = { ...seeded, spaceOf: { w1: 'gone-space' } }
  assert.deepEqual(reconcileSpaces(orphanWorkspace, [workspace('w1', 'alpha')]).spaceOf, {})
  const orphanThread = {
    ...seeded,
    threads: seeded.threads.map(thread => thread.sessionId === 's3' ? { ...thread, spaceId: 'gone-space' } : thread),
  }
  const reconciled = reconcileSpaces(orphanThread, [workspace('w1', 'alpha'), workspace('w2', 'beta')])
  assert.equal(reconciled.threads.find(thread => thread.sessionId === 's3').spaceId, undefined)
  assert.equal(reconcileSpaces(seeded, [workspace('w1', 'alpha'), workspace('w2', 'beta')]), seeded, 'a clean map keeps identity')
})

test('the ungrouped row key is stable per space', () => {
  const { state, defaultSpaceId, work } = spaced()
  assert.equal(looseRowKey(state, defaultSpaceId), UNGROUPED_ID)
  assert.equal(looseRowKey(state, work), `${LOOSE_ROW_PREFIX}${work}`)
})

test('a loose conversation started in a space is recorded there', () => {
  const { state: seeded, work, defaultSpaceId } = spaced()
  const state = adoptThread(seeded, { sessionId: 's9', title: '', nodeId: null, workspaceId: null, spaceId: work })
  const thread = state.threads.find(candidate => candidate.sessionId === 's9')
  assert.equal(thread.workspaceId, null)
  assert.equal(spaceOfThread(state, thread), work)
  const back = adoptThread(state, { sessionId: 's9', title: '', nodeId: null, workspaceId: null, spaceId: defaultSpaceId })
  assert.equal(back.threads.find(candidate => candidate.sessionId === 's9').spaceId, undefined)
})

test('an older document reads as having no spaces yet', () => {
  const parsed = parseMapState(JSON.stringify({ version: 2, revision: 4, nodes: [], threads: [] }))
  assert.deepEqual(parsed.spaces, [])
  assert.equal(parsed.defaultSpaceId, '')
  assert.deepEqual(parsed.spaceOf, {})
})

test('spaces survive a save/load round-trip', () => {
  const { state } = spaced()
  const backing = new Map()
  const store = {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
  saveMap(store, state)
  const loaded = loadMap(store)
  assert.deepEqual(loaded.spaces, state.spaces)
  assert.equal(loaded.defaultSpaceId, state.defaultSpaceId)
  assert.deepEqual(loaded.spaceOf, state.spaceOf)
  assert.equal(loaded.threads.find(thread => thread.sessionId === 's3').spaceId, undefined)
})

test('a malformed space document is sanitized instead of breaking the map', () => {
  const parsed = parseMapState(JSON.stringify({
    version: 2,
    revision: 1,
    nodes: [],
    threads: [
      { sessionId: 's1', nodeId: null, workspaceId: 'w1', spaceId: 'sp1', title: 't', updatedAt: '', importedAt: '' },
      { sessionId: 's2', nodeId: null, workspaceId: null, spaceId: 'sp2', title: 't', updatedAt: '', importedAt: '' },
      { sessionId: 's3', nodeId: null, workspaceId: null, spaceId: 'missing', title: 't', updatedAt: '', importedAt: '' },
    ],
    spaces: [
      { id: 'sp1', title: '工作空间', position: 2, createdAt: '' },
      { id: 'sp2', title: '家庭空间', position: 3, createdAt: '' },
      { id: 'sp1', title: '重复', position: 4, createdAt: '' },
      { id: '', title: '无 id', position: 5, createdAt: '' },
    ],
    defaultSpaceId: 'sp1',
    spaceOf: { w1: 'sp1', w2: 'missing' },
  }))
  assert.deepEqual(parsed.spaces.map(space => space.id), ['sp1', 'sp2'])
  assert.deepEqual(parsed.spaceOf, { w1: 'sp1' })
  assert.equal(parsed.threads.find(thread => thread.sessionId === 's1').spaceId, undefined, 'Workspace membership wins')
  assert.equal(parsed.threads.find(thread => thread.sessionId === 's2').spaceId, 'sp2')
  assert.equal(parsed.threads.find(thread => thread.sessionId === 's3').spaceId, undefined)
})

test('search can be scoped to one space', () => {
  let { state } = bootstrapped()
  const work = createSpace(state, { title: '工作空间' })
  state = work.state
  const family = createSpace(state, { title: '家庭空间' })
  state = family.state
  state = setWorkspaceSpace(state, 'w1', work.id)
  state = setWorkspaceSpace(state, 'w2', family.id)
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '外贸主题', id: 'n1' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w2', title: '家庭主题', id: 'n2' }).state
  state = createNode(state, { parentId: null, workspaceId: null, title: '无主主题', id: 'n3' }).state
  state = syncThreads(state, [
    { id: 's1', displayTitle: '外贸对话' },
    { id: 's2', displayTitle: '家庭对话' },
    { id: 's3', displayTitle: '散落主题对话' },
  ], null, new Map([['s1', 'w1'], ['s2', 'w2'], ['s3', null]]))
  assert.deepEqual(searchMap(state, '主题', work.id).nodes.map(hit => hit.node.id), ['n1'])
  assert.deepEqual(searchMap(state, '主题', family.id).nodes.map(hit => hit.node.id), ['n2'])
  assert.deepEqual(searchMap(state, '主题', state.defaultSpaceId).nodes.map(hit => hit.node.id), ['n3'])
  assert.deepEqual(searchMap(state, '对话', state.defaultSpaceId).threads.map(hit => hit.thread.sessionId), ['s3'])
  assert.deepEqual(searchMap(state, '对话', work.id).threads.map(hit => hit.thread.sessionId), ['s1'])
})

test('ordinary mutations keep the space organization', () => {
  const { state: seeded, defaultSpaceId, work } = spaced()
  const before = seeded.spaces.map(space => space.id)
  let state = createNode(seeded, { parentId: null, workspaceId: 'w1', title: '新主题', id: 'n1' }).state
  state = syncThreads(state, [{ id: 's1', displayTitle: '改名' }, { id: 's3', displayTitle: '散落' }], null, new Map([['s1', 'w1'], ['s3', null]]))
  state = assignThreads(state, ['s1'], 'n1')
  state = updateNode(state, { id: 'n1', title: '改名后', description: '' })
  state = renameSpace(state, { id: work, title: '工作区空间' })
  assert.deepEqual(state.spaces.map(space => space.id), before)
  assert.equal(state.defaultSpaceId, defaultSpaceId)
  assert.deepEqual(state.spaceOf, seeded.spaceOf)
})

/*
 * Native navigation lands where the Session lives. The map follows a Session
 * clicked in the product sidebar, so its space and highlighted row must be the
 * Session's home — including a home in a space the map is not currently scoped
 * to (the reader named the destination by clicking it).
 */
test('an indexed conversation resolves to its Workspace row and that Workspace space', () => {
  const { state, work } = spaced()
  assert.deepEqual(homeOfSession(state, 's1'), {
    spaceId: work,
    selection: workspaceKey('w1'),
  })
})

test('an indexed conversation filed under a topic resolves to the topic', () => {
  const { state, work } = spaced()
  const withTopic = createNode(state, { parentId: null, workspaceId: 'w1', title: '主题', id: 'n1' }).state
  const filed = assignThreads(withTopic, ['s1'], 'n1')
  assert.deepEqual(homeOfSession(filed, 's1'), { spaceId: work, selection: 'n1' })
})

test('a loose conversation resolves to the ungrouped row of its own space', () => {
  const { state, defaultSpaceId, work } = spaced()
  assert.deepEqual(homeOfSession(state, 's3'), {
    spaceId: defaultSpaceId,
    selection: UNGROUPED_ID,
  })
  const moved = setThreadSpace(state, 's3', work)
  assert.deepEqual(homeOfSession(moved, 's3'), {
    spaceId: work,
    selection: looseRowKey(moved, work),
  })
})

test('a Session the index has not seen resolves through the Host Workspace accounting', () => {
  const { state, work, family } = spaced()
  assert.deepEqual(homeOfSession(state, 'new-in-w1', 'w1'), {
    spaceId: work,
    selection: workspaceKey('w1'),
  })
  assert.deepEqual(homeOfSession(state, 'new-in-w2', 'w2'), {
    spaceId: family,
    selection: workspaceKey('w2'),
  })
  assert.deepEqual(homeOfSession(state, 'new-loose', null), {
    spaceId: state.defaultSpaceId,
    selection: UNGROUPED_ID,
  })
})

test('an unknown Session with no Workspace has no place to land', () => {
  const { state } = spaced()
  assert.equal(homeOfSession(state, 'ghost'), undefined)
  assert.equal(homeOfSession(state, 'ghost', undefined), undefined)
})

/* ── move issues: the judgement drag, dialogs, and tools all read ───────── */

test('moveNodeIssue names every reason a re-parent is refused', () => {
  const state = seed()
  assert.deepEqual(moveNodeIssue(state, 'ghost', null), { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' })
  assert.deepEqual(moveNodeIssue(state, 'a1', 'ghost'), { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' })
  assert.deepEqual(moveNodeIssue(state, 'a1', 'b'), {
    code: 'WORKSPACE', message: 'A node cannot move under a node of a different Workspace.',
  })
  assert.deepEqual(moveNodeIssue(state, 'a', 'a'), {
    code: 'CYCLE', message: 'A node cannot move under itself or its descendants.',
  })
  assert.deepEqual(moveNodeIssue(state, 'a', 'a1'), {
    code: 'CYCLE', message: 'A node cannot move under itself or its descendants.',
  })
  assert.equal(moveNodeIssue(state, 'a1', null), null, 'the Workspace root is always in reach')
  const sibling = createNode(state, { parentId: null, workspaceId: 'w1', title: '第二个主题', id: 'a2' }).state
  assert.equal(moveNodeIssue(sibling, 'a2', 'a'), null, 'a root may become a child of another root')
  assert.equal(moveNodeIssue(state, 'a1', 'a'), null, 're-parenting to the current parent stays committable')
})

test('moveNodeIssue enforces depth as target depth plus subtree height', () => {
  let deep = seed()
  for (let level = 1; level <= MAX_DEPTH; level += 1) {
    deep = createNode(deep, {
      parentId: level === 1 ? null : `c${level - 1}`,
      workspaceId: 'w1',
      title: `层 ${level}`,
      id: `c${level}`,
    }).state
  }
  let tall = createNode(deep, { parentId: null, workspaceId: 'w1', title: '高子树', id: 'tall' }).state
  tall = createNode(tall, { parentId: 'tall', title: '叶子', id: 'tall-leaf' }).state

  assert.deepEqual(moveNodeIssue(tall, 'tall', `c${MAX_DEPTH - 1}`), {
    code: 'DEPTH', message: `At most ${MAX_DEPTH} levels are supported.`, params: { max: MAX_DEPTH },
  }, '11 + a two-node subtree breaks the ceiling')
  assert.equal(moveNodeIssue(tall, 'tall', `c${MAX_DEPTH - 2}`), null, 'exactly 12 levels still fits')
  assert.deepEqual(moveNodeIssue(tall, 'c1', 'tall'), {
    code: 'DEPTH', message: `At most ${MAX_DEPTH} levels are supported.`, params: { max: MAX_DEPTH },
  }, 'a 12-deep subtree cannot hang under another root')
})

test('moveNode refuses with exactly the issue moveNodeIssue reported', () => {
  const state = seed()
  const before = state.revision
  const refused = [['ghost', null], ['a1', 'ghost'], ['a1', 'b'], ['a', 'a'], ['a', 'a1']]
  for (const [id, parentId] of refused) {
    const issue = moveNodeIssue(state, id, parentId)
    assert.notEqual(issue, null, `${id} → ${String(parentId)} is refused`)
    assert.throws(
      () => moveNode(state, id, parentId),
      (error) => error instanceof MapError && error.code === issue.code && error.message === issue.message,
    )
  }
  assert.equal(state.revision, before, 'a refused move never touches the document')
})

test('assignThreadIssue mirrors the conversation rules and names the refusing code', () => {
  const state = syncThreads(seed(), [
    { id: 'own', displayTitle: '本区会话', updatedAt: 0 },
    { id: 'foreign', displayTitle: '外区会话', updatedAt: 0 },
  ], null, new Map([['own', 'w1'], ['foreign', 'w2']]))

  assert.equal(assignThreadIssue(state, 'own', 'a1'), null, 'a node of its own Workspace is committable')
  assert.equal(assignThreadIssue(state, 'own', null), null, 'so is the Workspace row itself')
  assert.deepEqual(assignThreadIssue(state, 'foreign', 'a1'), {
    code: 'WORKSPACE', message: 'A conversation can only be filed under a node of its own Workspace.',
  })
  assert.deepEqual(assignThreadIssue(state, 'own', 'ghost'), { code: 'NOT_FOUND', message: 'The target node no longer exists; refresh and try again.' })
  assert.equal(assignThreadIssue(state, 'never-indexed', 'a1'), null, 'an unknown Session holds no row to file')

  const unreconciled = {
    ...state,
    threads: [...state.threads, { sessionId: 'unreconciled', nodeId: null, title: '未对账', updatedAt: '', importedAt: '' }],
  }
  assert.equal(assignThreadIssue(unreconciled, 'unreconciled', 'a1'), null,
    'a conversation whose Workspace is not known yet stays permissive')
})

test('assignThreadIssue refuses a subagent conversation by origin and by ledger', () => {
  const state = syncThreads(seed(), [{ id: 'own', displayTitle: '本区会话', updatedAt: 0 }], null, new Map([['own', 'w1']]))
  const child = {
    sessionId: 'child-row', nodeId: null, title: '子智能体', updatedAt: '', importedAt: '', origin: 'subagent',
  }
  const byOrigin = { ...state, threads: [...state.threads, child] }
  assert.deepEqual(assignThreadIssue(byOrigin, 'child-row', 'a1'), {
    code: 'SUBAGENT', message: 'A subagent conversation cannot be filed under a topic.',
  })
  assert.deepEqual(assignThreadIssue(byOrigin, 'child-row', null)?.code, 'SUBAGENT',
    'a child is refused even for the Workspace row')

  const byLedger = { ...state, subagentSessionIds: ['child-ledger'] }
  assert.deepEqual(assignThreadIssue(byLedger, 'child-ledger', 'a1')?.code, 'SUBAGENT',
    'the ledger outlives the row it was recorded from')
})

test('assignThreadIssue keeps the rootless-topic space rule', () => {
  let { state } = bootstrapped()
  state = createNode(state, { parentId: null, workspaceId: null, title: '无主主题', id: 'u1' }).state
  state = syncThreads(state, [{ id: 's3', displayTitle: '散落', updatedAt: 0 }], null, new Map([['s3', null]]))
  assert.equal(assignThreadIssue(state, 's3', 'u1'), null, 'the default space may join a rootless topic')

  const work = createSpace(state, { title: '工作空间' })
  const elsewhere = setThreadSpace(work.state, 's3', work.id)
  assert.deepEqual(assignThreadIssue(elsewhere, 's3', 'u1'), {
    code: 'SPACE', message: 'Only ungrouped conversations in the default space can be filed under the ungrouped topic.',
  })
  assert.throws(
    () => assignThreads(elsewhere, ['s3'], 'u1'),
    (error) => error instanceof MapError && error.code === 'SPACE',
  )
})

test('assignThreads refuses a subagent conversation and keeps a rejected batch atomic', () => {
  const base = syncThreads(seed(), [{ id: 'ok', displayTitle: '普通会话', updatedAt: 0 }], null, new Map([['ok', 'w1']]))
  const ledger = { ...base, subagentSessionIds: ['child-ledger'] }
  assert.throws(
    () => assignThreads(ledger, ['child-ledger'], 'a1'),
    (error) => error instanceof MapError && error.code === 'SUBAGENT',
  )
  assert.throws(
    () => assignThreads(ledger, ['ok', 'child-ledger'], 'a1'),
    (error) => error instanceof MapError && error.code === 'SUBAGENT',
  )
  assert.equal(threadOfSession(ledger, 'ok').nodeId, null, 'the ordinary id in a rejected batch is not filed either')

  const withRow = {
    ...base,
    threads: [
      ...base.threads,
      { sessionId: 'child-row', nodeId: null, title: '子智能体', updatedAt: '', importedAt: '', origin: 'subagent' },
    ],
  }
  assert.throws(
    () => assignThreads(withRow, ['child-row'], 'a1'),
    (error) => error instanceof MapError && error.code === 'SUBAGENT',
  )
})

test('threadMoveTargets lists the Workspace row first, then the tree depth-first', () => {
  const state = seed()
  assert.deepEqual(threadMoveTargets(state, 'w1', '（工作区顶层）'), [
    { nodeId: null, label: '（工作区顶层）' },
    { nodeId: 'a', label: '外贸探索' },
    { nodeId: 'a1', label: '外贸探索 / 获客方式' },
  ])
  assert.deepEqual(threadMoveTargets(state, 'w2', '（工作区顶层）'), [
    { nodeId: null, label: '（工作区顶层）' },
    { nodeId: 'b', label: '产品设计' },
  ])

  const wider = createNode(state, { parentId: null, workspaceId: 'w1', title: '第二个主题', id: 'a2' }).state
  assert.deepEqual(threadMoveTargets(wider, 'w1').map(target => target.nodeId), [null, 'a', 'a1', 'a2'],
    'a child stays with its parent, before the next root')
})

test('threadMoveTargets breaks sibling ties by title and never repeats an id', () => {
  const tied = {
    ...emptyMap(),
    nodes: [
      { id: 'z', parentId: null, workspaceId: 'w1', title: 'Z 主题', description: '', position: 1, updatedAt: '' },
      { id: 'm', parentId: null, workspaceId: 'w1', title: 'M 主题', description: '', position: 1, updatedAt: '' },
      { id: 'other', parentId: null, workspaceId: 'w2', title: '别的工作区', description: '', position: 1, updatedAt: '' },
    ],
  }
  assert.deepEqual(threadMoveTargets(tied, 'w1').map(target => target.nodeId), [null, 'm', 'z'])
})

test('a document whose parent pointers loop cannot exhaust the stack', () => {
  const cyclic = {
    ...emptyMap(),
    nodes: [
      { id: 'x', parentId: 'y', workspaceId: 'w1', title: 'X', description: '', position: 1, updatedAt: '' },
      { id: 'y', parentId: 'x', workspaceId: 'w1', title: 'Y', description: '', position: 1, updatedAt: '' },
      { id: 'z', parentId: null, workspaceId: 'w1', title: 'Z', description: '', position: 1, updatedAt: '' },
    ],
  }
  // A target inside the loop is still a cycle, reported as a plain model error.
  assert.throws(
    () => moveNode(cyclic, 'x', 'y'),
    (error) => error instanceof MapError && error.code === 'CYCLE',
  )
  // Moving a looped node under an outside parent used to recurse forever in the
  // depth ceiling: it has to answer and land.
  const moved = moveNode(cyclic, 'x', 'z')
  assert.equal(moved.nodes.find(node => node.id === 'x').parentId, 'z')
  assert.deepEqual(threadMoveTargets(cyclic, 'w1').map(target => target.nodeId), [null, 'z', 'x', 'y'],
    'every node is still offered exactly once')
})

/* ── inserting at a slot: N7/N10 (drag position) ────────────────────────── */

/** One parent `p` with three ordered children A, B, C, all in `w1`. */
function slotted() {
  let state = createNode(emptyMap(), { parentId: null, workspaceId: 'w1', title: '父', id: 'p' }).state
  for (const id of ['A', 'B', 'C']) {
    state = createNode(state, { parentId: 'p', workspaceId: 'w1', title: id, id }).state
  }
  return state
}

/** Child ids of one parent, in display order. */
function idsUnder(state, parentId) {
  return childrenOf(state, parentId).map(node => node.id)
}

/** Positions of the named nodes, in the order given. */
function positionsOf(state, ids) {
  return ids.map(id => state.nodes.find(node => node.id === id).position)
}

test('insertNodeBefore appends when no anchor is given', () => {
  let state = slotted()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'D', id: 'D' }).state

  const appended = insertNodeBefore(state, 'D', 'p')
  assert.deepEqual(idsUnder(appended, 'p'), ['A', 'B', 'C', 'D'])
  assert.deepEqual(positionsOf(appended, ['A', 'B', 'C', 'D']), [1, 2, 3, 4])
  assert.equal(appended.nodes.find(node => node.id === 'D').parentId, 'p')
})

test('insertNodeBefore places a node at the middle, the head, and before the last sibling', () => {
  let state = slotted()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'D', id: 'D' }).state

  const middle = insertNodeBefore(state, 'D', 'p', 'B')
  assert.deepEqual(idsUnder(middle, 'p'), ['A', 'D', 'B', 'C'])
  assert.deepEqual(positionsOf(middle, ['A', 'D', 'B', 'C']), [1, 2, 3, 4])

  const head = insertNodeBefore(state, 'D', 'p', 'A')
  assert.deepEqual(idsUnder(head, 'p'), ['D', 'A', 'B', 'C'])
  assert.deepEqual(positionsOf(head, ['D', 'A', 'B', 'C']), [1, 2, 3, 4])

  const beforeLast = insertNodeBefore(state, 'D', 'p', 'C')
  assert.deepEqual(idsUnder(beforeLast, 'p'), ['A', 'B', 'D', 'C'])
})

test('re-ordering inside one parent is insertNodeBefore, and an unchanged slot is not written', () => {
  const state = slotted()

  // N10: the same-parent reorder M6 exists for — moveNode would append instead.
  const reordered = insertNodeBefore(state, 'C', 'p', 'A')
  assert.deepEqual(idsUnder(reordered, 'p'), ['C', 'A', 'B'])
  assert.deepEqual(positionsOf(reordered, ['C', 'A', 'B']), [1, 2, 3])

  // Already directly before C: the document must not move, revision and all.
  const unchanged = insertNodeBefore(state, 'B', 'p', 'C')
  assert.equal(unchanged, state, 'an unchanged slot returns the very same state')
  assert.equal(unchanged.revision, state.revision)

  // insertBefore(x, x) keeps x where it is.
  assert.equal(insertNodeBefore(state, 'B', 'p', 'B'), state)
})

test('insertNodeBefore refuses an anchor that is not a child of the target parent', () => {
  let state = slotted()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '另一个父', id: 'q' }).state
  state = createNode(state, { parentId: 'q', title: 'Q', id: 'Q' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w2', title: '别的区', id: 'other' }).state

  assert.throws(
    () => insertNodeBefore(state, 'A', 'p', 'Q'),
    (error) => error instanceof MapError && error.code === 'ANCHOR' && error.message === 'The anchor node is not under the target parent.',
  )
  assert.throws(
    () => insertNodeBefore(state, 'A', 'p', 'other'),
    (error) => error instanceof MapError && error.code === 'ANCHOR',
  )
  assert.throws(
    () => insertNodeBefore(state, 'A', 'p', 'ghost'),
    (error) => error instanceof MapError && error.code === 'ANCHOR',
  )
  // The move itself is judged first: a foreign target reports WORKSPACE, not ANCHOR.
  assert.throws(
    () => insertNodeBefore(state, 'A', 'other', 'ghost'),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
  )
  assert.deepEqual(idsUnder(state, 'p'), ['A', 'B', 'C'], 'every refusal left the tree alone')
})

test('insertNodeBefore reuses the re-parent judgement for cycles and depth', () => {
  const state = slotted()
  assert.throws(
    () => insertNodeBefore(state, 'p', 'A'),
    (error) => error instanceof MapError && error.code === 'CYCLE',
  )

  let deep = createNode(emptyMap(), { parentId: null, workspaceId: 'w1', title: '层 1', id: 'c1' }).state
  for (let level = 2; level <= MAX_DEPTH; level += 1) {
    deep = createNode(deep, { parentId: `c${level - 1}`, title: `层 ${level}`, id: `c${level}` }).state
  }
  deep = createNode(deep, { parentId: null, workspaceId: 'w1', title: '高', id: 'tall' }).state
  deep = createNode(deep, { parentId: 'tall', title: '叶', id: 'leaf' }).state
  assert.throws(
    () => insertNodeBefore(deep, 'tall', `c${MAX_DEPTH - 1}`, `c${MAX_DEPTH}`),
    (error) => error instanceof MapError && error.code === 'DEPTH',
  )
  assert.throws(
    () => insertNodeBefore(deep, 'c1', 'tall', 'leaf'),
    (error) => error instanceof MapError && error.code === 'DEPTH',
  )
})

test('insertNodeBefore renumbers the target children and repairs duplicate positions', () => {
  let state = slotted()
  // A hand-built document may carry two children claiming the same slot.
  state = { ...state, nodes: state.nodes.map(node => node.id === 'B' ? { ...node, position: 1 } : node) }
  assert.deepEqual(idsUnder(state, 'p'), ['A', 'B', 'C'], 'the tie is broken by title, as sorted() does')

  const reordered = insertNodeBefore(state, 'C', 'p', 'A')
  assert.deepEqual(idsUnder(reordered, 'p'), ['C', 'A', 'B'])
  assert.deepEqual(positionsOf(reordered, ['C', 'A', 'B']), [1, 2, 3], 'duplicates are gone')
})

test('insertNodeBefore leaves the parent it came from in order', () => {
  let state = slotted()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '另一个父', id: 'q' }).state
  state = createNode(state, { parentId: 'q', title: 'Q1', id: 'Q1' }).state
  state = createNode(state, { parentId: 'q', title: 'Q2', id: 'Q2' }).state

  const moved = insertNodeBefore(state, 'Q2', 'p', 'B')
  assert.deepEqual(idsUnder(moved, 'p'), ['A', 'Q2', 'B', 'C'])
  assert.deepEqual(idsUnder(moved, 'q'), ['Q1'], 'the old parent keeps its remaining child')
  assert.equal(moved.nodes.find(node => node.id === 'Q1').position, 1, 'and its position is not renumbered')
})

test('moveNode still appends, so same-parent reordering stays insertNodeBefore\'s job', () => {
  const state = slotted()
  assert.deepEqual(idsUnder(moveNode(state, 'A', 'p'), 'p'), ['B', 'C', 'A'])
  assert.deepEqual(idsUnder(insertNodeBefore(state, 'C', 'p', 'B'), 'p'), ['A', 'C', 'B'])
})


test('a legacy default-space title migrates to the neutral marker, user titles stay verbatim', () => {
  const legacy = {
    version: 2,
    revision: 1,
    nodes: [],
    threads: [],
    spaces: [{ id: 'sp-1', title: '默认空间', position: 1, createdAt: '' }],
    defaultSpaceId: 'sp-1',
    spaceOf: {},
    subagentSessionIds: [],
  }
  const migrated = parseMapState(JSON.stringify(legacy))
  assert.equal(migrated.spaces[0].title, DEFAULT_SPACE_TITLE, 'the legacy marker is rewritten on read')
  const renamed = { ...legacy, spaces: [{ ...legacy.spaces[0], title: '工作空间' }] }
  assert.equal(parseMapState(JSON.stringify(renamed)).spaces[0].title, '工作空间', 'a typed title is user data')
})

/* ── archive: detach, restore, guards, and reconciliation ────────────────── */

test('the archive selection key names one Workspace archive row', () => {
  assert.equal(archiveKey('w1'), '@archive:w1', 'the key carries the Workspace whose archive it opens')
  assert.equal(isArchiveSelectionKey(null), false)
  assert.equal(isArchiveSelectionKey(undefined), false)
  assert.equal(isArchiveSelectionKey(UNGROUPED_ID), false, 'the ungrouped bucket has no archive')
  assert.equal(isArchiveSelectionKey(workspaceNodeId('w1')), false, 'a Workspace row is not an archive row')
  assert.equal(isArchiveSelectionKey(archiveKey('w1')), true)
  assert.deepEqual(archiveSelection(archiveKey('w1')), { workspaceId: 'w1' })
  assert.equal(archiveSelection(workspaceNodeId('w1')), undefined, 'a Workspace key names the Workspace, not its archive')
  assert.equal(archiveSelection(null), undefined)
})

test('archiving a topic detaches its whole block and remembers the old parent', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  const before = state.nodes.find(node => node.id === 'a1')
  const archived = archiveNode(state, 'a1')
  const root = archived.nodes.find(node => node.id === 'a1')
  assert.equal(root.parentId, null, 'the block root is taken out of the tree')
  assert.equal(root.archivedParentId, 'a', 'the parent it returns to is remembered')
  assert.equal(typeof root.archivedAt, 'string', 'the archive is stamped')
  assert.equal(root.workspaceId, 'w1', 'archiving never moves a topic out of its Workspace')
  assert.equal(root.position, before.position, 'archiving is not an edit: the slot is kept')
  assert.equal(root.updatedAt, before.updatedAt)
  const child = archived.nodes.find(node => node.id === 'a11')
  assert.equal(child.parentId, 'a1', 'descendants stay inside the block')
  assert.equal(child.archivedAt, undefined, 'N1: only the detached root carries a mark')
  assert.equal(inArchive(archived, 'a11'), true, 'a descendant is in the archive through its root')
  assert.equal(inArchive(archived, 'a'), false, 'an active topic is not')
  assert.equal(archivedRootOf(archived, 'a11')?.id, 'a1', 'the nearest marked ancestor is the block root')
  assert.deepEqual(
    topNodesOf(archived, 'w1').map(node => node.id).sort(),
    ['a', 'a1'],
    'the stored view still sees the detached root',
  )
  assert.deepEqual(activeTopNodesOf(archived, 'w1').map(node => node.id), ['a'], 'the active view does not')
  assert.deepEqual(childrenOf(archived, 'a'), [], 'the appended position is not a child slot')
  assert.deepEqual(activeChildrenOf(archived, 'a'), [])
  assert.equal(archived.revision, state.revision + 1, 'the whole block leaves in one revision bump')
})

test('archiving a topic absorbs marks the block already carries', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  state = syncThreads(state, [{ id: 'blocked', displayTitle: '块内会话' }], null, new Map([['blocked', 'w1']]))
  state = assignThreads(state, ['blocked'], 'a1')
  state = archiveThread(state, 'blocked')
  // A hand-built document may carry a mark below a block that gets archived later.
  state = {
    ...state,
    nodes: state.nodes.map(node => node.id === 'a11'
      ? { ...node, archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId: 'a1' }
      : node),
  }
  const archived = archiveNode(state, 'a1')
  assert.equal(threadOfSession(archived, 'blocked').archivedAt, undefined, 'the block now owns the conversation (N2)')
  assert.equal(isArchivedNode(archived.nodes.find(node => node.id === 'a11')), false, 'the descendant mark is absorbed (N1)')
  assert.equal(isArchivedNode(archived.nodes.find(node => node.id === 'a1')), true)
})

test('archiving a parent absorbs a child block that was archived first', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  state = syncThreads(state, [{ id: 'in-block', displayTitle: '块内会话' }], null, new Map([['in-block', 'w1']]))
  state = assignThreads(state, ['in-block'], 'a11')
  state = archiveNode(state, 'a1')
  assert.deepEqual(archivedRootsOf(state, 'w1').map(node => node.id), ['a1'], 'the child block is out first')
  const absorbed = archiveNode(state, 'a')
  assert.deepEqual(archivedRootsOf(absorbed, 'w1').map(node => node.id), ['a'], 'one block, not two parallel roots')
  assert.equal(absorbed.revision, state.revision + 1, 'the fold and the archive are one revision bump')
  assert.equal(isArchivedNode(absorbed.nodes.find(node => node.id === 'a1')), false, 'the child root is folded back in')
  assert.equal(absorbed.nodes.find(node => node.id === 'a1').archivedParentId, undefined)
  assert.equal(absorbed.nodes.find(node => node.id === 'a1').parentId, 'a')
  assert.equal(absorbed.nodes.find(node => node.id === 'a11').parentId, 'a1')
  assert.equal(isArchivedThread(threadOfSession(absorbed, 'in-block')), false, 'the block conversation stays unmarked (N2)')
  const restored = unarchiveNode(absorbed, 'a')
  assert.equal(restored.nodes.find(node => node.id === 'a1').parentId, 'a', 'unarchiving the parent brings the whole block back')
  assert.equal(restored.nodes.find(node => node.id === 'a11').parentId, 'a1')
  assert.deepEqual(archivedRootsOf(restored, 'w1'), [])
})

test('archiving a topic folds a chain of archived ancestors back into the block', () => {
  // Pre-fix documents can nest archived roots: `z` remembers `y`, `y` remembers
  // `x`, and `x` is a live child of `n`, so archiving `n` has to fold the chain.
  const archivedRow = (id, archivedParentId, position) => ({
    id, parentId: null, workspaceId: 'w1', title: id.toUpperCase(), description: '', position,
    updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId,
  })
  const state = {
    ...ensureDefaultSpace(emptyMap()),
    nodes: [
      { id: 'n', parentId: null, workspaceId: 'w1', title: 'N', description: '', position: 1, updatedAt: '' },
      { id: 'x', parentId: 'n', title: 'X', description: '', position: 1, updatedAt: '' },
      archivedRow('y', 'x', 2),
      archivedRow('z', 'y', 3),
    ],
    threads: [],
  }
  const archived = archiveNode(state, 'n')
  assert.deepEqual(archivedRootsOf(archived, 'w1').map(node => node.id), ['n'], 'the whole chain joins the block')
  assert.equal(archived.nodes.find(node => node.id === 'y').parentId, 'x')
  assert.equal(archived.nodes.find(node => node.id === 'z').parentId, 'y')
  assert.deepEqual(
    archived.nodes.filter(node => isArchivedNode(node)).map(node => node.id),
    ['n'],
    'and only the block root carries a mark',
  )
})

test('an archived block anchored outside the topic is not absorbed', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  state = archiveNode(state, 'b')
  assert.deepEqual(archivedRootsOf(state, 'w1').map(node => node.id), ['a1'], 'its anchor is not in the archived subtree')
  assert.deepEqual(archivedRootsOf(state, 'w2').map(node => node.id), ['b'], 'a sibling Workspace archive is untouched')
})

test('an archived block filed under another Workspace cannot be folded in', () => {
  // Dirty data only: a fold would silently move another Workspace's block into
  // this one, so the block stays an independent archived item.
  const state = {
    ...ensureDefaultSpace(emptyMap()),
    nodes: [
      { id: 'n', parentId: null, workspaceId: 'w1', title: 'N', description: '', position: 1, updatedAt: '' },
      { id: 'x', parentId: 'n', title: 'X', description: '', position: 1, updatedAt: '' },
      { id: 'r', parentId: null, workspaceId: 'w9', title: 'R', description: '', position: 1, updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId: 'x' },
    ],
    threads: [],
  }
  const archived = archiveNode(state, 'n')
  assert.deepEqual(archivedRootsOf(archived, 'w1').map(node => node.id), ['n'])
  assert.equal(isArchivedNode(archived.nodes.find(node => node.id === 'r')), true, 'the foreign block stays archived')
  assert.equal(archivedRootsOf(archived, 'w9').length, 1)
})

test('a cyclic remembered chain is left as independent archived blocks', () => {
  const archivedRow = (id, archivedParentId, position) => ({
    id, parentId: null, workspaceId: 'w1', title: id.toUpperCase(), description: '', position,
    updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId,
  })
  const state = {
    ...ensureDefaultSpace(emptyMap()),
    nodes: [
      { id: 'n', parentId: null, workspaceId: 'w1', title: 'N', description: '', position: 1, updatedAt: '' },
      archivedRow('r1', 'r2', 2),
      archivedRow('r2', 'r1', 3),
    ],
    threads: [],
  }
  const archived = archiveNode(state, 'n')
  assert.equal(isArchivedNode(archived.nodes.find(node => node.id === 'r1')), true, 'the loop is left alone')
  assert.equal(isArchivedNode(archived.nodes.find(node => node.id === 'r2')), true)
  assert.deepEqual(archivedRootsOf(archived, 'w1').map(node => node.id).sort(), ['n', 'r1', 'r2'])
})

test('archiving a topic is idempotent and refuses what it cannot hold', () => {
  const state = archivedSeed()
  assert.equal(archiveNode(state, 'a1'), state, 'a second archive returns the same state')
  assert.equal(archiveNode(state, 'a11'), state, 'a topic inside a block is already archived')
  assert.throws(
    () => archiveNode(seed(), 'ghost'),
    (error) => error instanceof MapError && error.code === 'NOT_FOUND',
  )
  const ungrouped = createNode(emptyMap(), { parentId: null, workspaceId: null, title: '散落主题', id: 'u1' }).state
  assert.throws(
    () => archiveNode(ungrouped, 'u1'),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
    'ungrouped content has no archive row to live behind',
  )
})

test('archiving a conversation keeps its filing and is idempotent', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '会话一' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  const archived = archiveThread(state, 's1')
  const thread = threadOfSession(archived, 's1')
  assert.equal(thread.nodeId, 'a1', 'the topic it returns to is remembered')
  assert.equal(thread.workspaceId, 'w1', 'the Workspace is untouched')
  assert.equal(typeof thread.archivedAt, 'string')
  assert.equal(archiveThread(archived, 's1'), archived, 'a second archive returns the same state')
  assert.throws(
    () => archiveThread(archived, 'ghost'),
    (error) => error instanceof MapError && error.code === 'NO_THREAD',
  )
  const ungrouped = syncThreads(emptyMap(), [{ id: 'loose', displayTitle: '散落' }], null, new Map([['loose', null]]))
  assert.throws(
    () => archiveThread(ungrouped, 'loose'),
    (error) => error instanceof MapError && error.code === 'WORKSPACE',
  )
})

test('archived roots are listed newest archive first, then by title', () => {
  let state = seed()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'Alpha', id: 'x1' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'Beta', id: 'x3' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'Old', id: 'x2' }).state
  const stamp = (stampValue, next) => ({
    ...next,
    nodes: next.nodes.map(node => ['a', 'x1', 'x2', 'x3'].includes(node.id)
      ? { ...node, archivedAt: stampValue[node.id] ?? node.archivedAt }
      : node),
  })
  state = stamp({ a: '2024-01-01T00:00:00.000Z' }, archiveNode(state, 'a'))
  state = stamp({ x1: '2024-01-02T00:00:00.000Z' }, archiveNode(state, 'x1'))
  state = stamp({ x3: '2024-01-02T00:00:00.000Z' }, archiveNode(state, 'x3'))
  state = stamp({ x2: '2024-01-03T00:00:00.000Z' }, archiveNode(state, 'x2'))
  assert.deepEqual(
    archivedRootsOf(state, 'w1').map(node => node.id),
    ['x2', 'x1', 'x3', 'a'],
    'newest first; the same stamp falls back to title order',
  )
  assert.deepEqual(archivedRootsOf(state, 'w2'), [], 'another Workspace has its own archive')
})

test('conversations archived on their own are listed newest activity first', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 'older', displayTitle: '旧', updatedAt: 1000 },
    { id: 'newer', displayTitle: '新', updatedAt: 3000 },
    { id: 'middle', displayTitle: '中', updatedAt: 2000 },
    { id: 'blocked', displayTitle: '块内' },
  ], null, new Map([['older', 'w1'], ['newer', 'w1'], ['middle', 'w1'], ['blocked', 'w1']]))
  state = assignThreads(state, ['blocked'], 'a1')
  state = archiveThread(state, 'older')
  state = archiveThread(state, 'newer')
  state = archiveThread(state, 'middle')
  state = archiveNode(state, 'a1')
  assert.deepEqual(
    archivedLooseThreadsOf(state, 'w1').map(thread => thread.sessionId),
    ['newer', 'middle', 'older'],
    'independently archived conversations, newest first',
  )
  assert.deepEqual(archivedLooseThreadsOf(state, 'w2'), [])
})

test('archiveStatsOf counts block roots and every conversation the archive holds', () => {
  const state = archivedSeed()
  assert.deepEqual(
    archiveStatsOf(state, 'w1'),
    { nodes: 1, sessions: 2 },
    'one archived block with one conversation, plus one archived on its own',
  )
  assert.deepEqual(archiveStatsOf(state, 'w2'), { nodes: 0, sessions: 0 })
  assert.deepEqual(archiveStats(state), { nodes: 1, sessions: 2 }, 'the global count sums every Workspace')
  assert.deepEqual(archiveStats(seed()), { nodes: 0, sessions: 0 })
})

test('the active views hide the archive without changing the stored tree', () => {
  const state = archivedSeed()
  assert.deepEqual(activeTopNodesOf(state, 'w1').map(node => node.id), ['a'])
  assert.deepEqual(activeChildrenOf(state, 'a'), [])
  assert.deepEqual(activeThreadsOf(state, 'a').map(thread => thread.sessionId), ['live'])
  assert.deepEqual(activeDirectThreadsOf(state, 'w1'), [], 'the archived loose conversation left the Workspace row')
  const view = activeMapView(state)
  assert.deepEqual(view.nodes.map(node => node.id).sort(), ['a', 'b'])
  assert.deepEqual(view.threads.map(thread => thread.sessionId), ['live'])
  assert.equal(view.revision, state.revision, 'a view is a read, not a mutation')
  assert.deepEqual(state.nodes.map(node => node.id).sort(), ['a', 'a1', 'a11', 'b'], 'the document keeps the archive')
  assert.deepEqual(state.threads.map(thread => thread.sessionId).sort(), ['blocked', 'live', 'loose'])
})

test('unarchiving a topic returns it to its original sibling slot', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a', title: '第二个子题', id: 'a2' }).state
  state = createNode(state, { parentId: 'a', title: '第三个子题', id: 'a3' }).state
  state = archiveNode(state, 'a2')
  const restored = unarchiveNode(state, 'a2')
  const node = restored.nodes.find(candidate => candidate.id === 'a2')
  assert.equal(node.parentId, 'a')
  assert.equal(node.archivedAt, undefined)
  assert.equal(node.archivedParentId, undefined)
  assert.deepEqual(childrenOf(restored, 'a').map(child => child.id), ['a1', 'a2', 'a3'], 'the middle slot is restored')
  assert.deepEqual(childrenOf(restored, 'a').map(child => child.position), [1, 2, 3], 'siblings are renumbered around it')
})

test('restoring the first and the last sibling puts each back in place', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a', title: '第二个子题', id: 'a2' }).state
  state = createNode(state, { parentId: 'a', title: '第三个子题', id: 'a3' }).state
  let restored = unarchiveNode(archiveNode(state, 'a1'), 'a1')
  assert.deepEqual(childrenOf(restored, 'a').map(child => child.id), ['a1', 'a2', 'a3'], 'the first slot is restored')
  restored = unarchiveNode(archiveNode(restored, 'a3'), 'a3')
  assert.deepEqual(childrenOf(restored, 'a').map(child => child.id), ['a1', 'a2', 'a3'], 'the last slot is restored')
})

test('a restored slot past the end of the current list clamps to the end', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a', title: '第二个子题', id: 'a2' }).state
  state = createNode(state, { parentId: 'a', title: '第三个子题', id: 'a3' }).state
  state = archiveNode(state, 'a2')
  state = deleteNodeSubtree(state, 'a1')
  const restored = unarchiveNode(state, 'a2')
  assert.deepEqual(childrenOf(restored, 'a').map(child => child.id), ['a3', 'a2'], 'the original slot no longer exists')
})

test('the Workspace-top fallback also restores the original position slot', () => {
  let state = seed()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '第二个顶层主题', id: 'a2' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '第三个顶层主题', id: 'a3' }).state
  state = archiveNode(state, 'a2')
  const restored = unarchiveNode(state, 'a2')
  assert.deepEqual(topNodesOf(restored, 'w1').map(node => node.id), ['a', 'a2', 'a3'])
})

test('unarchiving a topic falls back to the Workspace top level when the parent is gone', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  state = deleteNodeSubtree(state, 'a')
  const restored = unarchiveNode(state, 'a1')
  const node = restored.nodes.find(candidate => candidate.id === 'a1')
  assert.equal(node.parentId, null, 'the Workspace top level is the fallback')
  assert.equal(node.archivedParentId, undefined, 'the stale location is forgotten')
  assert.deepEqual(activeTopNodesOf(restored, 'w1').map(top => top.id), ['a1'])
})

test('unarchiving a topic releases the archived block that holds its remembered parent', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  // Reproduce a document written before parents absorbed their archived children:
  // the parent was archived while the child block was already out, so both roots
  // sit in the archive instead of one block.
  state = {
    ...state,
    nodes: state.nodes.map(node => node.id === 'a'
      ? { ...node, archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId: null }
      : node),
  }
  assert.deepEqual(archivedRootsOf(state, 'w1').map(node => node.id).sort(), ['a', 'a1'])
  const restored = unarchiveNode(state, 'a1')
  assert.equal(isArchivedNode(restored.nodes.find(node => node.id === 'a')), false, 'the parent block is released first')
  assert.equal(restored.nodes.find(node => node.id === 'a').parentId, null)
  assert.equal(restored.nodes.find(node => node.id === 'a1').parentId, 'a', 'then the child returns under it')
  assert.equal(restored.nodes.find(node => node.id === 'a1').archivedAt, undefined)
})

test('restoring a topic whose parent is still archived keeps its sibling slot', () => {
  let state = emptyMap()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '父主题', id: 'p' }).state
  state = createNode(state, { parentId: 'p', title: '第一个子题', id: 'c1' }).state
  state = createNode(state, { parentId: 'p', title: '第二个子题', id: 'c2' }).state
  state = createNode(state, { parentId: 'p', title: '第三个子题', id: 'c3' }).state
  state = archiveNode(state, 'c2')
  state = { ...state, nodes: state.nodes.map(node => node.id === 'p' ? { ...node, archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId: null } : node) }
  const restored = unarchiveNode(state, 'c2')
  assert.equal(restored.nodes.find(node => node.id === 'p').archivedAt, undefined)
  assert.deepEqual(childrenOf(restored, 'p').map(child => child.id), ['c1', 'c2', 'c3'], 'the cascade and the slot work together')
})

test('archived roots that remember each other are restored without recursing forever', () => {
  const archivedRow = (id, archivedParentId, position) => ({
    id, parentId: null, workspaceId: 'w1', title: id.toUpperCase(), description: '', position,
    updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId,
  })
  const pair = {
    ...ensureDefaultSpace(emptyMap()),
    nodes: [archivedRow('p', 'q', 1), archivedRow('q', 'p', 2)],
    threads: [],
  }
  const restored = unarchiveNode(pair, 'p')
  assert.equal(isArchivedNode(restored.nodes.find(node => node.id === 'p')), false)
  assert.equal(isArchivedNode(restored.nodes.find(node => node.id === 'q')), false)
  assert.equal(restored.nodes.find(node => node.id === 'p').parentId, 'q', 'the released parent is used once it is active')
  assert.equal(restored.nodes.filter(node => node.parentId !== null).length, 1, 'the loop is flattened, not rebuilt')

  const selfParent = {
    ...ensureDefaultSpace(emptyMap()),
    nodes: [archivedRow('s', 's', 1)],
    threads: [],
  }
  const selfRestored = unarchiveNode(selfParent, 's')
  assert.equal(selfRestored.nodes[0].parentId, null, 'a self-reference falls back to the top level')
  assert.equal(isArchivedNode(selfRestored.nodes[0]), false)
})

test('a restore that would break the depth ceiling returns to the top level', () => {
  let state = emptyMap()
  let parentId = null
  for (let level = 1; level <= MAX_DEPTH; level += 1) {
    const created = createNode(state, { parentId, workspaceId: 'w1', title: `L${level}`, id: `l${level}` })
    state = created.state
    parentId = created.id
  }
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: 'Block', id: 'block' }).state
  state = createNode(state, { parentId: 'block', title: 'Block child', id: 'block-child' }).state
  state = archiveNode(state, 'block')
  state = {
    ...state,
    nodes: state.nodes.map(node => node.id === 'block' ? { ...node, archivedParentId: `l${MAX_DEPTH}` } : node),
  }
  const restored = unarchiveNode(state, 'block')
  assert.equal(restored.nodes.find(node => node.id === 'block').parentId, null, '11 levels plus a two-node block breaks the ceiling')
})

test('only an archived block root can be restored', () => {
  const state = archivedSeed()
  assert.throws(
    () => unarchiveNode(state, 'a'),
    (error) => error instanceof MapError && error.code === 'NOT_ARCHIVED',
  )
  assert.throws(
    () => unarchiveNode(state, 'a11'),
    (error) => error instanceof MapError && error.code === 'NOT_ARCHIVED',
    'a topic inside a block comes back with the block',
  )
  assert.throws(
    () => unarchiveNode(state, 'ghost'),
    (error) => error instanceof MapError && error.code === 'NOT_FOUND',
  )
})

test('unarchiving a conversation clears only its mark', () => {
  let state = seed()
  state = syncThreads(state, [{ id: 's1', displayTitle: '会话一' }], null, new Map([['s1', 'w1']]))
  state = assignThreads(state, ['s1'], 'a1')
  state = archiveThread(state, 's1')
  const restored = unarchiveThread(state, 's1')
  assert.equal(isArchivedThread(threadOfSession(restored, 's1')), false)
  assert.equal(threadOfSession(restored, 's1').nodeId, 'a1', 'the filing is untouched')
  assert.throws(
    () => unarchiveThread(restored, 's1'),
    (error) => error instanceof MapError && error.code === 'NOT_ARCHIVED',
  )
  assert.throws(
    () => unarchiveThread(state, 'ghost'),
    (error) => error instanceof MapError && error.code === 'NO_THREAD',
  )
})

test('the archive is a guard, not a drag destination', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 'live', displayTitle: '活跃会话' },
    { id: 'blocked', displayTitle: '块内会话' },
    { id: 'own', displayTitle: '独立归档会话' },
  ], null, new Map([['live', 'w1'], ['blocked', 'w1'], ['own', 'w1']]))
  state = assignThreads(state, ['blocked'], 'a1')
  state = archiveThread(state, 'own')
  const block = archiveNode(state, 'a1')

  assert.throws(
    () => createNode(block, { parentId: 'a1', title: '归档里长出来的' }),
    (error) => error instanceof MapError && error.code === 'ARCHIVED',
    'the archive does not grow',
  )
  assert.deepEqual(moveNodeIssue(block, 'a1', null), {
    code: 'ARCHIVED', message: 'The topic is archived; unarchive it first.',
  })
  assert.deepEqual(moveNodeIssue(block, 'a', 'a1'), {
    code: 'ARCHIVED', message: 'The target topic is archived; unarchive it first.',
  })
  assert.throws(
    () => moveNode(block, 'a1', null),
    (error) => error instanceof MapError && error.code === 'ARCHIVED',
    'moveNode throws exactly the issue it reported',
  )
  assert.throws(
    () => insertNodeBefore(block, 'a', 'a1'),
    (error) => error instanceof MapError && error.code === 'ARCHIVED',
  )
  assert.deepEqual(assignThreadIssue(block, 'own', 'a'), {
    code: 'ARCHIVED', message: 'The conversation is archived; unarchive it first.',
  })
  assert.deepEqual(assignThreadIssue(block, 'blocked', 'a'), {
    code: 'ARCHIVED', message: 'The conversation is archived; unarchive it first.',
  }, 'a conversation inside a block carries no mark but is still archived')
  assert.throws(
    () => assignThreads(block, ['own'], 'a'),
    (error) => error instanceof MapError && error.code === 'ARCHIVED',
  )
  assert.deepEqual(
    threadMoveTargets(block, 'w1').map(target => target.nodeId),
    [null, 'a'],
    'archived topics are not picker destinations',
  )
  assert.equal(assignThreadIssue(block, 'own', 'a') !== null, true, 'the conversation rule is independent of the target')
  assert.equal(assignThreadIssue(block, 'live', 'a'), null, 'an active conversation still files under an active topic')
})

test('the archive refuses a drop whose anchor is archived in a hand-built document', () => {
  const state = createNode(seed(), { parentId: null, workspaceId: 'w1', title: '另一个主题', id: 'a2' }).state
  // N1 makes this impossible through the model, but the parser accepts it.
  const handBuilt = {
    ...state,
    nodes: state.nodes.map(node => node.id === 'a1'
      ? { ...node, archivedAt: '2024-01-01T00:00:00.000Z' }
      : node),
  }
  assert.throws(
    () => insertNodeBefore(handBuilt, 'a2', 'a', 'a1'),
    (error) => error instanceof MapError && error.code === 'ARCHIVED',
  )
})

test('deleting an archived topic keeps its conversations in the archive', () => {
  const state = archivedSeed()
  const deleted = deleteNodeSubtree(state, 'a1')
  assert.equal(deleted.nodes.some(node => node.id === 'a1' || node.id === 'a11'), false)
  const thread = threadOfSession(deleted, 'blocked')
  assert.equal(thread.nodeId, null, 'the filed topic is gone')
  assert.equal(typeof thread.archivedAt, 'string', 'the conversation becomes an top-level archived one')
  assert.deepEqual(archiveStatsOf(deleted, 'w1'), { nodes: 0, sessions: 2 })
  assert.deepEqual(activeDirectThreadsOf(deleted, 'w1'), [], 'it does not fall back into the active tree')
})

test('deleting an active topic keeps an independently archived conversation archived', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  state = syncThreads(state, [{ id: 'own', displayTitle: '独立归档会话' }], null, new Map([['own', 'w1']]))
  state = assignThreads(state, ['own'], 'a11')
  state = archiveThread(state, 'own')
  const deleted = deleteNodeSubtree(state, 'a')
  const thread = threadOfSession(deleted, 'own')
  assert.equal(thread.nodeId, null, 'the filed topic is gone')
  assert.equal(isArchivedThread(thread), true, 'the mark survives the deletion, so the conversation stays stored')
})

test('deleting an active topic never touches an archived block', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  const deleted = deleteNodeSubtree(state, 'a')
  assert.equal(inArchive(deleted, 'a1'), true, 'the detached archive survives the ancestor it came from')
  assert.deepEqual(archiveStatsOf(deleted, 'w1'), { nodes: 1, sessions: 0 })
})

test('an archived conversation selects the archive path, not a row it is not under', () => {
  let state = seed()
  state = syncThreads(state, [
    { id: 'loose', displayTitle: '独立归档会话' },
    { id: 'blocked', displayTitle: '块内会话' },
  ], null, new Map([['loose', 'w1'], ['blocked', 'w1']]))
  state = assignThreads(state, ['blocked'], 'a1')
  state = archiveThread(state, 'loose')
  assert.equal(selectionOfThread(state, threadOfSession(state, 'loose')), '@archive:w1')
  state = archiveNode(state, 'a1')
  assert.equal(
    selectionOfThread(state, threadOfSession(state, 'blocked')),
    'a1',
    'a conversation inside a block selects its topic; the archive row is drawn by ancestorRowKeys',
  )
  assert.deepEqual(homeOfSession(state, 'loose'), {
    spaceId: state.defaultSpaceId,
    selection: '@archive:w1',
  })
  // A hand-built document may archive a conversation but leave its topic active.
  const handBuilt = {
    ...state,
    threads: state.threads.map(thread => thread.sessionId === 'blocked'
      ? { ...thread, archivedAt: '2024-01-01T00:00:00.000Z' }
      : thread),
  }
  assert.equal(selectionOfThread(handBuilt, threadOfSession(handBuilt, 'blocked')), 'a1', 'only a node inside the archive outranks the archive row')
})

test('ancestorRowKeys puts the archive row between the Workspace row and its content', () => {
  let state = seed()
  state = createNode(state, { parentId: 'a1', title: '更深的子题', id: 'a11' }).state
  assert.deepEqual(ancestorRowKeys(state, 'a11'), ['a', 'a1', '@ws:w1'], 'active rows are unchanged')
  state = archiveNode(state, 'a')
  assert.deepEqual(ancestorRowKeys(state, 'a11'), ['a', 'a1', '@archive:w1', '@ws:w1'])
  assert.deepEqual(ancestorRowKeys(state, 'a'), ['@archive:w1', '@ws:w1'])
})

test('archived marks survive a save and load round trip', () => {
  const state = archivedSeed()
  const parsed = parseMapState(JSON.stringify(state))
  assert.deepEqual(parsed, state, 'the Host round trip keeps every mark')
  const node = parsed.nodes.find(candidate => candidate.id === 'a1')
  assert.equal(typeof node.archivedAt, 'string')
  assert.equal(node.archivedParentId, 'a')
  assert.equal(typeof threadOfSession(parsed, 'loose').archivedAt, 'string')
  assert.equal(threadOfSession(parsed, 'blocked').archivedAt, undefined, 'the block conversation stays unmarked')

  const backing = new Map()
  const store = {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
  saveMap(store, state)
  assert.deepEqual(loadMap(store), state)
})

test('a hand-built document with unusable archive fields parses to a clean shape', () => {
  const parsed = parseMapState(JSON.stringify({
    version: 2,
    revision: 1,
    nodes: [
      { id: 'z', parentId: null, title: 'Z', description: '', position: 1, updatedAt: '', archivedAt: '', archivedParentId: 12 },
      { id: 'y', parentId: null, title: 'Y', description: '', position: 2, updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId: null },
    ],
    threads: [
      { sessionId: 's', nodeId: null, title: 'S', updatedAt: '', importedAt: '', archivedAt: '' },
    ],
    spaces: [], defaultSpaceId: '', spaceOf: {}, subagentSessionIds: [],
  }))
  assert.equal(parsed.nodes[0].archivedAt, undefined, 'a blank mark is not an archive')
  assert.equal(parsed.nodes[0].archivedParentId, undefined)
  assert.equal(parsed.nodes[1].archivedParentId, null, 'a Workspace-root archive keeps its explicit null')
  assert.equal(parsed.threads[0].archivedAt, undefined)
})

test('reconciliation releases archived content whose Workspace is gone', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  const released = reconcileWorkspaces(state, [workspace('w2', 'beta')])
  const root = released.nodes.find(node => node.id === 'a')
  const block = released.nodes.find(node => node.id === 'a1')
  assert.equal(root.workspaceId, null, 'the tree falls to the ungrouped bucket with the Workspace')
  assert.equal(block.workspaceId, null)
  assert.equal(block.parentId, 'a', 'the remembered parent is restored')
  assert.equal(block.archivedAt, undefined, 'no archive row is left to file it under')
  assert.equal(block.archivedParentId, undefined)
  assert.equal(released.revision, state.revision + 1)
})

test('released archived topics fall back to the top level when their parent is gone', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  state = deleteNodeSubtree(state, 'a')
  const released = reconcileWorkspaces(state, [])
  assert.equal(released.nodes.find(node => node.id === 'a1').parentId, null)
  assert.equal(released.nodes.find(node => node.id === 'a1').archivedAt, undefined)
})

test('released archived topics re-form their chain, and a recorded cycle is broken', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  state = archiveNode(state, 'a')
  const released = reconcileWorkspaces(state, [])
  assert.equal(released.nodes.find(node => node.id === 'a').parentId, null)
  assert.equal(released.nodes.find(node => node.id === 'a1').parentId, 'a', 'both released roots re-form their hierarchy')

  const archivedNode = (id, position, archivedParentId) => ({
    id, parentId: null, workspaceId: 'w-gone', title: id.toUpperCase(), description: '', position,
    updatedAt: '', archivedAt: '2024-01-01T00:00:00.000Z', archivedParentId,
  })
  const broken = reconcileWorkspaces({
    ...ensureDefaultSpace(emptyMap()),
    // A two-node loop, and a chain that only runs into one.
    nodes: [
      archivedNode('x', 1, 'y'),
      archivedNode('y', 2, 'x'),
      archivedNode('z', 3, 'y'),
      archivedNode('w', 4, 'z'),
    ],
    threads: [],
  }, [])
  assert.equal(broken.nodes.some(node => node.archivedAt !== undefined), false, 'every released mark is cleared')
  const byId = new Map(broken.nodes.map(node => [node.id, node]))
  for (const node of broken.nodes) {
    const seen = new Set([node.id])
    let cursor = node.parentId
    while (cursor !== null) {
      assert.equal(seen.has(cursor), false, `${node.id} does not sit in a rebuilt cycle`)
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
  }
  assert.equal(broken.nodes.filter(node => node.parentId !== null).length >= 2, true, 'the non-cyclic parent links are kept')
})

test('reconciliation keeps archived content while its Workspace exists', () => {
  let state = seed()
  state = archiveNode(state, 'a1')
  const kept = reconcileWorkspaces(state, [workspace('w1', 'alpha'), workspace('w2', 'beta')])
  assert.equal(isArchivedNode(kept.nodes.find(node => node.id === 'a1')), true)
  assert.equal(kept.nodes.find(node => node.id === 'a1').parentId, null)
  assert.equal(
    reconcileWorkspaces(kept, [workspace('w1', 'alpha'), workspace('w2', 'beta')]),
    kept,
    'reconciliation stays identity-stable when nothing has to change',
  )
})

test('reconciliation releases a conversation whose recorded Workspace is gone', () => {
  // A document read from a previous build may carry an owner the Host no longer
  // reports; building it directly is the only way to reproduce that state.
  const state = {
    ...ensureDefaultSpace(emptyMap()),
    threads: [
      { sessionId: 'stale', nodeId: null, title: '旧会话', updatedAt: '', importedAt: '', workspaceId: 'w-gone', archivedAt: '2024-01-01T00:00:00.000Z' },
    ],
  }
  const released = reconcileWorkspaces(state, [workspace('w2', '产品设计')])
  assert.equal(threadOfSession(released, 'stale').workspaceId, null, 'a stale owner would hide the row under a missing group')
  assert.equal(isArchivedThread(threadOfSession(released, 'stale')), false, 'and the archive mark goes with it')

  const claimed = reconcileWorkspaces(state, [workspace('w2', '产品设计', ['stale'])])
  assert.equal(threadOfSession(claimed, 'stale').workspaceId, 'w2', 'Host membership still wins')
  assert.equal(isArchivedThread(threadOfSession(claimed, 'stale')), true, 'the archive row of a live Workspace still holds it')
})
