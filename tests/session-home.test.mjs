/**
 * Boundary-table tests for the conversation-home policy shared by the tree and
 * the composer-side context line.
 *
 * `src/shared/session-home.ts` is the read-only verdict the band and the
 * composer-side notice both derive, so every case below is a product decision:
 * which pairs of "row selected" and "conversation open" are allowed to disagree,
 * and what each surface is told. Fixtures are parsed through the real
 * `parseMapState` (the shape the band actually holds), except where a test
 * deliberately patches a stale in-memory index.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  effectiveSpaceId,
  readingSessionOf,
  sessionHomeDivergence,
  sessionHomeSelection,
} from '../lib/session-home.js'
import { archiveKey, ensureDefaultSpace, looseRowKey, parseMapState, workspaceKey } from '../lib/model.js'

/** The spaces every fixture shares: the default one, plus two named scopes. */
const SPACES = [
  { id: 'sp-default', title: '默认空间', position: 1, createdAt: '' },
  { id: 'sp-work', title: '工作空间', position: 2, createdAt: '' },
  { id: 'sp-family', title: '家庭空间', position: 3, createdAt: '' },
]

/**
 * The shared document.
 *
 * - the work space owns `w1`: topics `n1 > n2` plus the sibling root `n4`;
 * - the family space owns `w2`: topic `n3`;
 * - `w3` is left in the default space (no `spaceOf` override);
 * - conversations exist for every home kind: a topic, a Workspace row, and both
 *   loose rows (one per space).
 */
const MAP = {
  version: 2,
  revision: 1,
  nodes: [
    { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '', position: 1, updatedAt: '' },
    { id: 'n2', parentId: 'n1', workspaceId: 'w1', title: '获客方式', description: '', position: 1, updatedAt: '' },
    { id: 'n4', parentId: null, workspaceId: 'w1', title: '另一条分支', description: '', position: 2, updatedAt: '' },
    { id: 'n3', parentId: null, workspaceId: 'w2', title: '产品设计', description: '', position: 1, updatedAt: '' },
  ],
  threads: [
    { sessionId: 'in-n1', nodeId: 'n1', workspaceId: 'w1', title: '根话题会话', updatedAt: '', importedAt: '' },
    { sessionId: 'in-n2', nodeId: 'n2', workspaceId: 'w1', title: '子话题会话', updatedAt: '', importedAt: '' },
    { sessionId: 'at-w2', nodeId: null, workspaceId: 'w2', title: '工作区级会话', updatedAt: '', importedAt: '' },
    { sessionId: 'at-w3', nodeId: null, workspaceId: 'w3', title: '默认空间工作区会话', updatedAt: '', importedAt: '' },
    { sessionId: 'loose-work', nodeId: null, workspaceId: null, spaceId: 'sp-work', title: '工作空间散落会话', updatedAt: '', importedAt: '' },
    { sessionId: 'loose-default', nodeId: null, workspaceId: null, title: '默认空间散落会话', updatedAt: '', importedAt: '' },
  ],
  spaces: SPACES,
  defaultSpaceId: 'sp-default',
  spaceOf: { w1: 'sp-work', w2: 'sp-family' },
}

/** Parse one stored document into the live shape the band holds. */
function doc(map = MAP) {
  return ensureDefaultSpace(parseMapState(JSON.stringify(map)))
}

/** The shared document, parsed once: every function under test is read-only. */
const STATE = doc()

/** Copy one thread with patched fields, to model a stale in-memory index. */
function withThread(state, sessionId, patch) {
  return {
    ...state,
    threads: state.threads.map(thread => sessionId === thread.sessionId ? { ...thread, ...patch } : thread),
  }
}

/** The home row of `in-n2`, the conversation filed under the topic `n2`. */
const HOME_N2 = { spaceId: 'sp-work', selection: 'n2', nodeId: 'n2', workspaceId: 'w1', title: '获客方式' }
/** The home row of `in-n1`, the root topic of the work space's tree. */
const HOME_N1 = { spaceId: 'sp-work', selection: 'n1', nodeId: 'n1', workspaceId: 'w1', title: '外贸探索' }
/** The home row of `at-w2`, a conversation sitting directly under Workspace `w2`. */
const HOME_AT_W2 = { spaceId: 'sp-family', selection: workspaceKey('w2'), nodeId: null, workspaceId: 'w2', title: null }
/** The home row of `loose-work`, the work space's ungrouped bucket. */
const HOME_LOOSE_WORK = { spaceId: 'sp-work', selection: looseRowKey(STATE, 'sp-work'), nodeId: null, workspaceId: null, title: null }

/**
 * The verdict for the shared map under the fixture's usual assumptions.
 *
 * Every case starts from "the work space is on screen"; overrides spell out
 * what the case actually varies (the open conversation, the selected row, the
 * catalog row).
 */
function judge(overrides = {}) {
  return sessionHomeDivergence({
    state: STATE,
    openSessionId: null,
    selectedNodeId: null,
    activeSpace: 'sp-work',
    ...overrides,
  })
}

/* ── the early returns: nothing to compare, or nothing worth warning about ── */

test('nothing open: no-session, no divergence, no home', () => {
  // A selection that would diverge if a conversation were open, so the assertion
  // proves the early return rather than the fixture's neutrality.
  assert.deepEqual(
    judge({ selectedNodeId: 'n4' }),
    { reason: 'no-session', divergent: false, home: null, crossSpace: false },
  )
})

test('a subagent child has no row of its own, so it never diverges', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n4', catalog: { origin: 'subagent' } }),
    { reason: 'subagent', divergent: false, home: null, crossSpace: false },
  )
  // The catalog fact outranks the index: a child the index has not seen is still
  // reported as a subagent, not as an unindexed conversation.
  assert.deepEqual(
    judge({ openSessionId: 'child-not-indexed', catalog: { origin: 'subagent' } }),
    { reason: 'subagent', divergent: false, home: null, crossSpace: false },
  )
})

test('an unindexed conversation is reported as no-thread, not as divergent', () => {
  assert.deepEqual(
    judge({ openSessionId: 'never-indexed', selectedNodeId: 'n4' }),
    { reason: 'no-thread', divergent: false, home: null, crossSpace: false },
  )
})

test('a blank conversation suppresses the notice before the selection check', () => {
  // Selecting `n4` would be an other-branch divergence for a used conversation;
  // a brand-new one must not greet its reader with a warning.
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n4', catalog: { blank: true } }),
    { reason: 'blank', divergent: false, home: HOME_N2, crossSpace: false },
  )
})

/* ── the reading cursor is inside the conversation's own domain ─────────── */

test('selecting the conversation own node is same-row', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n2' }),
    { reason: 'same-row', divergent: false, home: HOME_N2, crossSpace: false },
  )
})

test('selecting an ancestor topic is still inside the conversation domain', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n1' }),
    { reason: 'ancestor', divergent: false, home: HOME_N2, crossSpace: false },
  )
})

test('selecting the owning Workspace row is an ancestor of a topic conversation', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: workspaceKey('w1') }),
    { reason: 'ancestor', divergent: false, home: HOME_N2, crossSpace: false },
  )
})

/* ── the selection left the conversation: divergent branches ─────────────── */

test('selecting another branch of the same space diverges without crossSpace', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n4' }),
    { reason: 'other-branch', divergent: true, home: HOME_N2, crossSpace: false },
  )
})

test('selecting a descendant of the home topic is another branch, not an ancestor', () => {
  // `n2` is a descendant of `n1`; the conversation is home on `n1` itself.
  assert.deepEqual(
    judge({ openSessionId: 'in-n1', selectedNodeId: 'n2' }),
    { reason: 'other-branch', divergent: true, home: HOME_N1, crossSpace: false },
  )
})

/* ── a Workspace-level conversation is home on the Workspace row ─────────── */

test('a Workspace-level conversation is home on the Workspace row, not on its topics', () => {
  assert.deepEqual(
    judge({ openSessionId: 'at-w2', selectedNodeId: workspaceKey('w2'), activeSpace: 'sp-family' }),
    { reason: 'same-row', divergent: false, home: HOME_AT_W2, crossSpace: false },
  )
  assert.deepEqual(
    judge({ openSessionId: 'at-w2', selectedNodeId: 'n3', activeSpace: 'sp-family' }),
    { reason: 'other-branch', divergent: true, home: HOME_AT_W2, crossSpace: false },
  )
})

test('a loose conversation is ungrouped and never diverges', () => {
  // Any selection is allowed: opening a loose conversation deliberately leaves
  // the reader's cursor alone, so warning on every such open would be noise.
  assert.deepEqual(
    judge({ openSessionId: 'loose-work', selectedNodeId: 'n4' }),
    { reason: 'ungrouped', divergent: false, home: HOME_LOOSE_WORK, crossSpace: false },
  )
})

/* ── spaces, stale scope, and selections that name nothing live ──────────── */

test('a conversation in another space diverges with crossSpace when the selection is elsewhere', () => {
  // Home is in the family space; the family space's own topic is selected; the
  // band shows the work space, so the home row is not even on screen.
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n3', activeSpace: 'sp-family' }),
    { reason: 'other-space', divergent: true, home: HOME_N2, crossSpace: true },
  )
})

test('a stale activeSpace falls back to the default space before comparing', () => {
  // `sp-deleted` no longer exists, so the band shows the default space; the
  // conversation's Workspace `w3` lives there too and the selection is its row.
  // Judging against the stale id would wrongly report other-space.
  const home = { spaceId: 'sp-default', selection: workspaceKey('w3'), nodeId: null, workspaceId: 'w3', title: null }
  assert.deepEqual(
    judge({ openSessionId: 'at-w3', selectedNodeId: workspaceKey('w3'), activeSpace: 'sp-deleted' }),
    { reason: 'same-row', divergent: false, home, crossSpace: false },
  )
})

test('no selection, or a selection nothing names, leaves the conversation alone', () => {
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: null }),
    { reason: 'no-selection', divergent: false, home: HOME_N2, crossSpace: false },
  )
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'node-that-is-gone' }),
    { reason: 'dangling-selection', divergent: false, home: HOME_N2, crossSpace: false },
  )
})

test('a deleted home topic falls back to the owning Workspace row', () => {
  // `parseMapState` already clears a node id it cannot resolve, so a dangling
  // one only exists in a stale in-memory index; patch it in after parsing.
  const orphaned = withThread(STATE, 'in-n2', { nodeId: 'n2-removed' })
  const home = sessionHomeSelection(orphaned, 'in-n2')
  assert.deepEqual(home, {
    spaceId: 'sp-work',
    selection: workspaceKey('w1'),
    nodeId: null,
    workspaceId: 'w1',
    title: null,
  }, 'the deleted topic falls back to its Workspace, exactly like the index does')
  assert.deepEqual(
    sessionHomeDivergence({ state: orphaned, openSessionId: 'in-n2', selectedNodeId: workspaceKey('w1'), activeSpace: 'sp-work' }),
    { reason: 'same-row', divergent: false, home, crossSpace: false },
  )
})

test('effectiveSpaceId keeps a live space and falls back to the default otherwise', () => {
  assert.equal(effectiveSpaceId(STATE, 'sp-work'), 'sp-work', 'a live scope is used as stored')
  assert.equal(effectiveSpaceId(STATE, 'sp-family'), 'sp-family')
  assert.equal(effectiveSpaceId(STATE, 'sp-deleted'), 'sp-default', 'a removed space falls back')
  assert.equal(effectiveSpaceId(STATE, ''), 'sp-default', 'an empty scope means the default space')
  assert.equal(effectiveSpaceId(STATE, null), 'sp-default')
  assert.equal(effectiveSpaceId(STATE, undefined), 'sp-default')
})

/* ── the home row itself ─────────────────────────────────────────────────── */

test('a topic home is the topic row, titled by the topic', () => {
  assert.deepEqual(sessionHomeSelection(STATE, 'in-n2'), {
    spaceId: 'sp-work',
    selection: 'n2',
    nodeId: 'n2',
    workspaceId: 'w1',
    title: '获客方式',
  })
})

test('a Workspace-level home is the Workspace row with no title of its own', () => {
  // The caller names Workspace rows from the live Workspace list; the map only
  // stores an id, so `title` stays null and the selection is the row key.
  assert.deepEqual(sessionHomeSelection(STATE, 'at-w2'), HOME_AT_W2)
  assert.deepEqual(sessionHomeSelection(STATE, 'at-w3'), {
    spaceId: 'sp-default',
    selection: workspaceKey('w3'),
    nodeId: null,
    workspaceId: 'w3',
    title: null,
  })
})

test('a loose home is its own space ungrouped row', () => {
  assert.deepEqual(sessionHomeSelection(STATE, 'loose-work'), HOME_LOOSE_WORK)
  assert.equal(HOME_LOOSE_WORK.selection, '@loose:sp-work', 'a named space has a row of its own')
  const defaultLoose = sessionHomeSelection(STATE, 'loose-default')
  assert.deepEqual(defaultLoose, {
    spaceId: 'sp-default',
    selection: looseRowKey(STATE, 'sp-default'),
    nodeId: null,
    workspaceId: null,
    title: null,
  })
  assert.equal(defaultLoose.selection, '@ungrouped', 'the default space keeps the historical key')
})

test('no Session, or one the index does not know, has no home row', () => {
  assert.equal(sessionHomeSelection(STATE, null), null)
  assert.equal(sessionHomeSelection(STATE, 'never-indexed'), null)
})

/* ── the row that stands for the open conversation ───────────────────────── */

/**
 * The catalog lineage the row-resolution cases are judged against: a subagent
 * child of an indexed conversation, a child of that child, a fork (a `parentId`
 * but an ordinary conversation), a child of that fork, and children whose parent
 * pointer is missing, empty, or names nothing the catalog holds.
 */
const LINEAGE = {
  'in-n2': { displayTitle: '子话题会话' },
  child: { displayTitle: '子智能体', origin: 'subagent', parentId: 'in-n2' },
  grandchild: { displayTitle: '孙辈子智能体', origin: 'subagent', parentId: 'child' },
  fork: { displayTitle: '分支会话', parentId: 'in-n2' },
  forkChild: { displayTitle: '分支里的子智能体', origin: 'subagent', parentId: 'fork' },
  rootless: { displayTitle: '没有父指针的子智能体', origin: 'subagent' },
  emptyParent: { displayTitle: '父指针为空的子智能体', origin: 'subagent', parentId: '' },
  orphan: { displayTitle: '父链缺失的子智能体', origin: 'subagent', parentId: 'gone' },
}

test('an ordinary conversation is the row that stands for itself', () => {
  assert.equal(readingSessionOf(LINEAGE, 'in-n2'), 'in-n2')
  assert.equal(readingSessionOf(LINEAGE, 'fork'), 'fork', 'a fork has a row of its own, so it names itself')
  assert.equal(readingSessionOf(LINEAGE, 'never-indexed'), 'never-indexed', 'an unknown row is the last id the walk has')
  assert.equal(readingSessionOf(LINEAGE, null), null)
})

test('a subagent conversation is read through its nearest visible ancestor', () => {
  // The map gives a subagent child no row: reading it must draw the parent's
  // row, so the tree looks the same as when the parent itself is open.
  assert.equal(readingSessionOf(LINEAGE, 'child'), 'in-n2', 'one level up')
  assert.equal(readingSessionOf(LINEAGE, 'grandchild'), 'in-n2', 'a whole chain of children resolves to the same row')
  assert.deepEqual(sessionHomeSelection(STATE, readingSessionOf(LINEAGE, 'child')), HOME_N2, 'the parent home is the home of the pair')
  assert.deepEqual(sessionHomeSelection(STATE, readingSessionOf(LINEAGE, 'grandchild')), HOME_N2)
})

test('a subagent above a fork stops at the fork, and a parent-less child stays itself', () => {
  // A fork is an ordinary row even though it names a `parentId`, so the climb
  // must stop on it; a missing or empty pointer never invents a parent.
  assert.equal(readingSessionOf(LINEAGE, 'forkChild'), 'fork', 'the fork has a row, so it is the row being read')
  assert.equal(readingSessionOf(LINEAGE, 'rootless'), 'rootless', 'no parent pointer: nothing to climb')
  assert.equal(readingSessionOf(LINEAGE, 'emptyParent'), 'emptyParent', 'an empty pointer is no parent either')
  assert.equal(sessionHomeSelection(STATE, readingSessionOf(LINEAGE, 'rootless')), null, 'and no row is claimed')
})

test('a parent chain the catalog cannot name resolves to a row the map does not have', () => {
  // The band then finds no home (no anchor, no chain), exactly as an unindexed
  // conversation has none: the walk's last reachable id is honest, not invented.
  assert.equal(readingSessionOf(LINEAGE, 'orphan'), 'gone')
  assert.equal(sessionHomeSelection(STATE, readingSessionOf(LINEAGE, 'orphan')), null)
})

test('a cyclic parent chain ends the walk on the conversation it started from', () => {
  const cyclic = {
    a: { origin: 'subagent', parentId: 'b' },
    b: { origin: 'subagent', parentId: 'a' },
  }
  assert.equal(readingSessionOf(cyclic, 'a'), 'a', 'the loop gives up instead of climbing forever')
  assert.equal(readingSessionOf(cyclic, 'b'), 'b')
  assert.equal(sessionHomeSelection(STATE, readingSessionOf(cyclic, 'a')), null, 'and no row is claimed')
})

/* ── cross-space outranks the same-space rows (lead review, 2026-10-31) ─── */

test('a conversation from another space diverges even when the stale selection names its home', () => {
  // Switching space does not clear the stored selection, so the old key can
  // still equal the home row while that row is not rendered anywhere. Treating
  // it as "same row" would hide the strongest mismatch the notice exists for.
  assert.deepEqual(
    judge({ openSessionId: 'in-n2', selectedNodeId: 'n2', activeSpace: 'sp-default' }),
    { reason: 'other-space', divergent: true, home: HOME_N2, crossSpace: true },
  )
})

test('cross-space also outranks the ungrouped silence for a loose conversation', () => {
  // A loose conversation in the work space while the default space is on screen
  // is not the ordinary "opening a loose conversation leaves the selection
  // alone" case: its row belongs to a space the reader cannot see.
  const verdict = judge({ openSessionId: 'loose-work', selectedNodeId: 'n4', activeSpace: 'sp-default' })
  assert.equal(verdict.reason, 'other-space')
  assert.equal(verdict.divergent, true)
  assert.equal(verdict.crossSpace, true)
  assert.deepEqual(verdict.home, HOME_LOOSE_WORK)
})

/* ── a legacy rootless topic lives at its space's ungrouped row ─────────── */

test('a legacy rootless topic counts its space ungrouped row as an ancestor', () => {
  // Old documents may hold topics with no Workspace (`workspaceId: null`); the
  // tree shows them under the space's ungrouped row, so selecting that row is
  // being inside the conversation's own domain, not another branch.
  const rootless = {
    ...STATE,
    nodes: [
      ...STATE.nodes,
      { id: 'legacy', parentId: null, workspaceId: null, title: '遗留主题', description: '', position: 9, updatedAt: '' },
    ],
    threads: [
      ...STATE.threads,
      { sessionId: 'in-legacy', nodeId: 'legacy', workspaceId: null, title: '遗留会话', updatedAt: '', importedAt: '' },
    ],
  }
  const verdict = sessionHomeDivergence({
    state: rootless,
    openSessionId: 'in-legacy',
    selectedNodeId: looseRowKey(STATE, 'sp-default'),
    activeSpace: 'sp-default',
  })
  assert.equal(verdict.reason, 'ancestor')
  assert.equal(verdict.divergent, false)
  assert.equal(verdict.home?.selection, 'legacy')
})


/* ── the Workspace archive is a home of its own ──────────────────────────── */

/**
 * The shared document plus one Workspace archive: the work space stores a block
 * (`n5 > n6`) with a conversation inside it, and one conversation archived on
 * its own. Both live in `w1`, so both are reached through the same archive row.
 */
const ARCHIVED_MAP = {
  ...MAP,
  nodes: [
    ...MAP.nodes,
    { id: 'n5', parentId: null, workspaceId: 'w1', title: '旧项目', description: '', position: 9, updatedAt: '', archivedAt: '2024-01-02T00:00:00.000Z', archivedParentId: null },
    { id: 'n6', parentId: 'n5', workspaceId: 'w1', title: '旧子题', description: '', position: 1, updatedAt: '' },
  ],
  threads: [
    ...MAP.threads,
    { sessionId: 'loose-archived', nodeId: null, workspaceId: 'w1', title: '独立归档会话', updatedAt: '', importedAt: '', archivedAt: '2024-01-03T00:00:00.000Z' },
    { sessionId: 'block-archived', nodeId: 'n6', workspaceId: 'w1', title: '块内会话', updatedAt: '', importedAt: '' },
  ],
}

/** The archived fixture, parsed once: every function under test is read-only. */
const ARCHIVED_STATE = doc(ARCHIVED_MAP)

/** The home row of a conversation archived on its own: the archive row. */
const HOME_ARCHIVED_LOOSE = {
  spaceId: 'sp-work', selection: archiveKey('w1'), nodeId: null, workspaceId: 'w1', title: null,
}

/** The verdict for the archived map, under the usual "work space is on screen". */
function judgeArchived(overrides = {}) {
  return sessionHomeDivergence({
    state: ARCHIVED_STATE,
    openSessionId: null,
    selectedNodeId: null,
    activeSpace: 'sp-work',
    ...overrides,
  })
}

test('a conversation archived on its own is homed on its Workspace archive row', () => {
  assert.deepEqual(
    sessionHomeSelection(ARCHIVED_STATE, 'loose-archived'),
    HOME_ARCHIVED_LOOSE,
    'the Workspace row would point at a row the conversation is not shown under',
  )
})

test('a conversation inside an archived topic keeps that topic as its home', () => {
  assert.deepEqual(sessionHomeSelection(ARCHIVED_STATE, 'block-archived'), {
    spaceId: 'sp-work',
    selection: 'n6',
    nodeId: 'n6',
    workspaceId: 'w1',
    title: '旧子题',
  }, 'the chain reads Workspace → archive → topic, so the innermost row is the topic')
})

test('the archive row is a live selection that contains the archive it shows', () => {
  assert.deepEqual(
    judgeArchived({ openSessionId: 'loose-archived', selectedNodeId: archiveKey('w1') }),
    { reason: 'same-row', divergent: false, home: HOME_ARCHIVED_LOOSE, crossSpace: false },
  )
  assert.deepEqual(
    judgeArchived({ openSessionId: 'block-archived', selectedNodeId: archiveKey('w1') }),
    { reason: 'ancestor', divergent: false, home: sessionHomeSelection(ARCHIVED_STATE, 'block-archived'), crossSpace: false },
    'the archive row sits above the topics it stores',
  )
})

test('the archive row is not an ancestor of the active branch', () => {
  assert.deepEqual(
    judgeArchived({ openSessionId: 'in-n1', selectedNodeId: archiveKey('w1') }),
    { reason: 'other-branch', divergent: true, home: sessionHomeSelection(ARCHIVED_STATE, 'in-n1'), crossSpace: false },
    'clicking the archive row while reading an active conversation is a real navigation',
  )
})

test('an active row outside the archive still diverges from archived content', () => {
  assert.deepEqual(
    judgeArchived({ openSessionId: 'loose-archived', selectedNodeId: 'n4' }),
    { reason: 'other-branch', divergent: true, home: HOME_ARCHIVED_LOOSE, crossSpace: false },
  )
  assert.equal(
    judgeArchived({ openSessionId: 'block-archived', selectedNodeId: 'n4' }).reason,
    'other-branch',
    'an archived topic is not an ancestor of an active branch',
  )
})

test('an archived conversation from another space diverges with crossSpace', () => {
  const verdict = judgeArchived({ openSessionId: 'loose-archived', selectedNodeId: 'n4', activeSpace: 'sp-default' })
  assert.equal(verdict.reason, 'other-space')
  assert.equal(verdict.divergent, true)
  assert.equal(verdict.crossSpace, true, 'its home row is not on screen at all')
})

test('a stale archive mark on an active topic still resolves to the archive row', () => {
  // N2 keeps this pairing out of the document, but an in-memory index can still
  // hold it; the home must not claim a topic row the archive does not draw.
  const stale = withThread(ARCHIVED_STATE, 'block-archived', {
    archivedAt: '2024-01-01T00:00:00.000Z',
    nodeId: 'n2',
  })
  assert.equal(sessionHomeSelection(stale, 'block-archived').selection, archiveKey('w1'))
})

test('the Workspace row is a container above the archive row it opens', () => {
  const verdict = judgeArchived({ openSessionId: 'loose-archived', selectedNodeId: workspaceKey('w1') })
  assert.equal(verdict.reason, 'ancestor', 'the Workspace row contains its own archive row')
  assert.equal(verdict.divergent, false, 'browsing above the archive is not leaving the conversation')
  assert.equal(verdict.home?.selection, archiveKey('w1'))
})
