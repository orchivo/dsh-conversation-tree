/**
 * Behavior tests for the drag core (`src/client/row-drag.ts`).
 *
 * The module is pure — no React, no DOM, no store — so these exercise the real
 * shipped source through the neutral `lib/` build, the same way the model tests
 * do. Every case states the pointer situation and the decision the panel will
 * show: refusal code and wording, no-op, plan, and the follow-the-pointer label.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  archiveNode, archiveThread, assignThreads, childrenOf, createNode, emptyMap, insertNodeBefore, syncThreads, threadsOf,
} from '../lib/model.js'
import {
  GROUP_EDGE_PX, GROUP_MIN_INTO_PX, DRAG_THRESHOLD_PX, candidateFromGroupHit, decideDrop,
  exceedsDragThreshold, formatDragLabel, hitGroupAt,
} from '../lib/row-drag.js'
import { createTranslator, zh } from '../lib/locales.js'

/** A topic row under the pointer. */
function nodeRow(nodeId, workspaceId = 'w1') {
  return { kind: 'node', nodeId, workspaceId }
}

/** A Workspace (L1) row under the pointer. */
function workspaceRow(workspaceId = 'w1') {
  return { kind: 'workspace', workspaceId }
}

/** The pointer is not over any droppable row. */
const NO_ROW = { kind: 'none' }

/** The Simplified Chinese translator: these cases pin the wording the pointer shows. */
const tZh = createTranslator(zh)

/**
 * Format a decision's structured pointer label.
 * @param decision - the decision under test.
 * @returns the localized label.
 */
function label(decision) {
  return formatDragLabel(tZh, decision.label)
}

/** The pointer is over the middle of a row. */
function into(row) {
  return { row, edge: 'into' }
}

/** The pointer is on a row's top or bottom edge. */
function edgeOf(row, edge) {
  return { row, edge }
}

/**
 * w1: 外贸探索(a) > 获客方式(a1) > 深一层(a1x), a > 转化路径(a2), 渠道复盘(a3);
 *     产品设计(b). w2: 另一块(c). Ungrouped bucket: 未分组主题(u1).
 * Conversations: s1 under a, s2 under w2's root, s3 unaccounted, `sub` a subagent.
 */
function seed() {
  let state = emptyMap()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '外贸探索', id: 'a' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '产品设计', id: 'b' }).state
  state = createNode(state, { parentId: null, workspaceId: 'w2', title: '另一块', id: 'c' }).state
  state = createNode(state, { parentId: null, workspaceId: null, title: '未分组主题', id: 'u1' }).state
  state = createNode(state, { parentId: 'a', workspaceId: 'w1', title: '获客方式', id: 'a1' }).state
  state = createNode(state, { parentId: 'a', workspaceId: 'w1', title: '转化路径', id: 'a2' }).state
  state = createNode(state, { parentId: 'a', workspaceId: 'w1', title: '渠道复盘', id: 'a3' }).state
  state = createNode(state, { parentId: 'a1', workspaceId: 'w1', title: '深一层', id: 'a1x' }).state
  state = syncThreads(state, [
    { id: 's1', displayTitle: '会话一' },
    { id: 's2', displayTitle: '会话二' },
    { id: 's3', displayTitle: '未对账' },
    { id: 'sub', displayTitle: '子会话', origin: 'subagent' },
  ], null, new Map([['s1', 'w1'], ['s2', 'w2'], ['sub', 'w1']]))
  return assignThreads(state, ['s1'], 'a')
}

/** A Workspace filled to the depth ceiling: d1 → … → d12, plus a loose leaf. */
function deep() {
  let state = emptyMap()
  state = createNode(state, { parentId: null, workspaceId: 'w1', title: '第 1 层', id: 'd1' }).state
  for (let level = 2; level <= 12; level += 1) {
    state = createNode(state, {
      parentId: `d${String(level - 1)}`, workspaceId: 'w1', title: `第 ${String(level)} 层`, id: `d${String(level)}`,
    }).state
  }
  return createNode(state, { parentId: null, workspaceId: 'w1', title: '待移动', id: 'leaf' }).state
}

test('a press becomes a drag only past the threshold', () => {
  const from = { x: 100, y: 100 }
  assert.equal(DRAG_THRESHOLD_PX, 4)
  assert.equal(exceedsDragThreshold(from, from), false, 'a still pointer is a click')
  assert.equal(exceedsDragThreshold(from, { x: 103, y: 100 }), false, '3px across is still a click')
  assert.equal(exceedsDragThreshold(from, { x: 100, y: 97 }), false, '3px along is still a click')
  assert.equal(exceedsDragThreshold(from, { x: 104, y: 100 }), true, '4px across is a drag')
  assert.equal(exceedsDragThreshold(from, { x: 105, y: 100 }), true, '5px across is a drag')
  assert.equal(exceedsDragThreshold(from, { x: 96, y: 100 }), true, 'the direction does not matter')
  assert.equal(exceedsDragThreshold(from, { x: 103, y: 104 }), true, 'a diagonal measures the same')
})

test('a conversation drops under a topic of its own Workspace', () => {
  const decision = decideDrop(seed(), { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.deepEqual(decision.action, { kind: 'thread', sessionId: 's1', nodeId: 'a1' })
  assert.equal(decision.issue, null)
  assert.equal(decision.noop, false)
  assert.equal(label(decision), '移到「获客方式」下')
})

test('a conversation drops back under its Workspace row', () => {
  const decision = decideDrop(seed(), { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(workspaceRow('w1')))
  assert.deepEqual(decision.action, { kind: 'thread', sessionId: 's1', nodeId: null })
  assert.equal(decision.issue, null)
  assert.equal(label(decision), '移到工作区下')
})

test('a conversation already filed there reports no change', () => {
  const state = seed()
  const sameNode = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(sameNode.noop, true)
  assert.equal(sameNode.action, null, 'a no-op hands the store nothing to commit')
  assert.equal(sameNode.issue, null)
  assert.equal(label(sameNode), '位置不变')

  const sameRow = decideDrop(state, { kind: 'session', sessionId: 's2', workspaceId: 'w2' }, into(workspaceRow('w2')))
  assert.equal(sameRow.noop, true)
  assert.equal(sameRow.action, null)
})

test('a conversation never crosses Workspaces, not even onto an L1 row', () => {
  const state = seed()
  const foreignNode = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('c', 'w2')))
  assert.equal(foreignNode.issue.code, 'WORKSPACE')
  assert.equal(foreignNode.action, null)
  assert.equal(foreignNode.noop, false)
  assert.equal(label(foreignNode), '不能移到别的工作区')

  const foreignRow = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(workspaceRow('w2')))
  assert.equal(foreignRow.issue.code, 'WORKSPACE')
  assert.equal(label(foreignRow), '不能移到别的工作区')
})

test('a subagent conversation is refused', () => {
  const decision = decideDrop(seed(), { kind: 'session', sessionId: 'sub', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.equal(decision.issue.code, 'SUBAGENT')
  assert.equal(decision.action, null)
  assert.equal(label(decision), '子智能体会话不能移动')
})

test('the ungrouped bucket takes part in no drag', () => {
  const state = seed()
  const loose = decideDrop(state, { kind: 'session', sessionId: 's3', workspaceId: null }, into(nodeRow('a1')))
  assert.equal(loose.issue.code, 'UNGROUPED')
  assert.equal(label(loose), '未分组不参与拖动')

  // The document outranks the payload: a row the Host has not accounted for yet
  // does not drag even when the caller claims a Workspace.
  const stale = decideDrop(state, { kind: 'session', sessionId: 's3', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.equal(stale.issue.code, 'UNGROUPED')
  assert.equal(label(stale), '未分组不参与拖动')

  const looseTarget = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('u1', null)))
  assert.equal(looseTarget.issue.code, 'UNGROUPED')
})

test('a conversation ignores an edge and says so', () => {
  const state = seed()
  const before = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, edgeOf(nodeRow('a1'), 'before'))
  assert.deepEqual(before.action, { kind: 'thread', sessionId: 's1', nodeId: 'a1' })
  assert.equal(label(before), '移到「获客方式」下（对话不排序）')

  const after = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, edgeOf(workspaceRow('w1'), 'after'))
  assert.deepEqual(after.action, { kind: 'thread', sessionId: 's1', nodeId: null })
  assert.equal(label(after), '移到工作区下（对话不排序）')
})

test('a release over no row, a vanished row, or a vanished conversation is refused', () => {
  const state = seed()
  const nowhere = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(NO_ROW))
  assert.equal(nowhere.issue.code, 'NONE')
  assert.equal(label(nowhere), '不能放在这里')

  const goneTarget = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('ghost')))
  assert.equal(goneTarget.issue.code, 'NOT_FOUND')
  assert.equal(label(goneTarget), '目标节点已不存在')

  const goneSession = decideDrop(state, { kind: 'session', sessionId: 'ghost', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.equal(goneSession.issue.code, 'NO_THREAD')
  assert.equal(label(goneSession), '对话已不存在')

  const goneNode = decideDrop(state, { kind: 'node', nodeId: 'ghost', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.equal(goneNode.issue.code, 'NOT_FOUND')
  assert.equal(label(goneNode), '目标节点已不存在')
})

test('a topic drops under another topic', () => {
  const decision = decideDrop(seed(), { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, into(nodeRow('b')))
  assert.deepEqual(decision.action, { kind: 'node', nodeId: 'a1', parentId: 'b', beforeNodeId: null })
  assert.equal(decision.issue, null)
  assert.equal(decision.noop, false)
  assert.equal(label(decision), '移到「产品设计」下')
})

test('a topic drops to the top of its own Workspace', () => {
  const decision = decideDrop(seed(), { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, into(workspaceRow('w1')))
  assert.deepEqual(decision.action, { kind: 'node', nodeId: 'a1', parentId: null, beforeNodeId: null })
  assert.equal(label(decision), '移到工作区下')
})

test('a topic slots in before or after a sibling', () => {
  const state = seed()
  const before = decideDrop(state, { kind: 'node', nodeId: 'a3', workspaceId: 'w1' }, edgeOf(nodeRow('a1'), 'before'))
  assert.deepEqual(before.action, { kind: 'node', nodeId: 'a3', parentId: 'a', beforeNodeId: 'a1' })
  assert.equal(label(before), '插到「获客方式」之前')

  const after = decideDrop(state, { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, edgeOf(nodeRow('a2'), 'after'))
  assert.deepEqual(after.action, { kind: 'node', nodeId: 'a1', parentId: 'a', beforeNodeId: 'a3' })
  assert.equal(label(after), '插到「转化路径」之后')
})

test('after the last sibling appends', () => {
  const decision = decideDrop(seed(), { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, edgeOf(nodeRow('a3'), 'after'))
  assert.deepEqual(decision.action, { kind: 'node', nodeId: 'a1', parentId: 'a', beforeNodeId: null })
  assert.equal(label(decision), '插到「渠道复盘」之后')
})

test('a topic dropped where it already is reports no change', () => {
  const state = seed()
  const alreadyFirst = decideDrop(state, { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, edgeOf(nodeRow('a2'), 'before'))
  assert.equal(alreadyFirst.noop, true)
  assert.equal(alreadyFirst.action, null)
  assert.equal(alreadyFirst.issue, null)
  assert.equal(label(alreadyFirst), '位置不变')

  const alreadyLast = decideDrop(state, { kind: 'node', nodeId: 'a3', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(alreadyLast.noop, true, 'the last child dropped into its own parent stays put')

  const alreadyAfter = decideDrop(state, { kind: 'node', nodeId: 'a2', workspaceId: 'w1' }, edgeOf(nodeRow('a1'), 'after'))
  assert.equal(alreadyAfter.noop, true, 'right after the sibling it follows')
})

test('dropping a non-last topic into its own parent is a real move, not a no-op', () => {
  const decision = decideDrop(seed(), { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(decision.noop, false, 'the model would append it, which is a change')
  assert.deepEqual(decision.action, { kind: 'node', nodeId: 'a1', parentId: 'a', beforeNodeId: null })
})

test('a no-op decision is exactly a document the model would not write', () => {
  const state = seed()
  const decision = decideDrop(state, { kind: 'node', nodeId: 'a3', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(decision.noop, true)
  assert.equal(insertNodeBefore(state, 'a3', 'a', undefined), state, 'the model hands the same document back')
})

test('a topic cannot land on itself or inside its own subtree', () => {
  const state = seed()
  const self = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(self.issue.code, 'CYCLE')
  assert.equal(label(self), '不能移到自己的子节点下')
  assert.equal(self.action, null)

  const descendant = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('a1x')))
  assert.equal(descendant.issue.code, 'CYCLE')

  const besideDescendant = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, edgeOf(nodeRow('a1x'), 'before'))
  assert.equal(besideDescendant.issue.code, 'CYCLE', 'a sibling slot inside the subtree is the same refusal')
})

test('a topic that would break the depth ceiling is refused', () => {
  const state = deep()
  const tooDeep = decideDrop(state, { kind: 'node', nodeId: 'leaf', workspaceId: 'w1' }, into(nodeRow('d12')))
  assert.equal(tooDeep.issue.code, 'DEPTH')
  assert.equal(tooDeep.action, null)
  assert.equal(label(tooDeep), '超过 12 层')

  const fits = decideDrop(state, { kind: 'node', nodeId: 'leaf', workspaceId: 'w1' }, into(nodeRow('d11')))
  assert.equal(fits.issue, null)
  assert.equal(fits.action.parentId, 'd11')
})

test('a topic never crosses Workspaces, not even onto an L1 row', () => {
  const state = seed()
  const foreignNode = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('c', 'w2')))
  assert.equal(foreignNode.issue.code, 'WORKSPACE')
  assert.equal(label(foreignNode), '不能移到别的工作区')
  assert.equal(foreignNode.action, null)

  const foreignRow = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(workspaceRow('w2')))
  assert.equal(foreignRow.issue.code, 'WORKSPACE')
  assert.equal(label(foreignRow), '不能移到别的工作区')
})

test('an ungrouped topic neither drags nor takes a drop', () => {
  const state = seed()
  const loose = decideDrop(state, { kind: 'node', nodeId: 'u1', workspaceId: null }, into(nodeRow('a')))
  assert.equal(loose.issue.code, 'UNGROUPED')
  assert.equal(label(loose), '未分组不参与拖动')

  const ontoLoose = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('u1', null)))
  assert.equal(ontoLoose.issue.code, 'UNGROUPED')
  assert.equal(label(ontoLoose), '未分组不参与拖动')
})

test('the plan commits cleanly through the model', () => {
  let state = seed()
  const threadPlan = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.notEqual(threadPlan.action, null)
  state = assignThreads(state, [threadPlan.action.sessionId], threadPlan.action.nodeId)
  assert.deepEqual(threadsOf(state, 'a1').map(thread => thread.sessionId), ['s1'])

  const nodePlan = decideDrop(state, { kind: 'node', nodeId: 'a3', workspaceId: 'w1' }, edgeOf(nodeRow('a1'), 'before'))
  assert.notEqual(nodePlan.action, null)
  state = insertNodeBefore(
    state,
    nodePlan.action.nodeId,
    nodePlan.action.parentId,
    nodePlan.action.beforeNodeId ?? undefined,
  )
  assert.deepEqual(childrenOf(state, 'a').map(node => node.id), ['a3', 'a1', 'a2'])
})


/* ── group-level hit testing: the block is the target, not the row ───────── */

/** One column interval; groups are placed inside it by their top/bottom. */
const COLUMN = { key: 'L2', left: 0, right: 200, top: 0, bottom: 600 }

/** One group rectangle, top-aligned inside {@link COLUMN}. */
function group(key, top, bottom, extra = {}) {
  return {
    key, kind: 'node', columnKey: 'L2', nodeId: key.replace('node:', ''), workspaceId: 'w1',
    top, bottom, headerHeight: 34, ...extra,
  }
}

/** A pointer at x=100 (inside the column) and the given y. */
function pointAt(y, x = 100) {
  return { x, y }
}

test('a pointer anywhere inside a group resolves to that group with into', () => {
  const groups = [group('node:n1', 100, 250)]
  for (const y of [100 + 20, 140, 200, 241]) {
    const hit = hitGroupAt(pointAt(y), [COLUMN], groups)
    assert.equal(hit.zone, 'group', `y=${String(y)} is inside the block`)
    assert.equal(hit.group?.key, 'node:n1')
    assert.equal(hit.mode, 'into', `y=${String(y)} means "into the topic", never a row slot`)
  }
})

test('only the group boundaries express before/after, eight pixels deep', () => {
  const groups = [group('node:n1', 100, 250)]
  assert.equal(hitGroupAt(pointAt(100 + 2), [COLUMN], groups).mode, 'before', 'the top band inserts before')
  assert.equal(hitGroupAt(pointAt(100 + GROUP_EDGE_PX), [COLUMN], groups).mode, 'into', 'the band is exactly 8px')
  assert.equal(hitGroupAt(pointAt(250 - 2), [COLUMN], groups).mode, 'after', 'the bottom band inserts after')
  assert.equal(hitGroupAt(pointAt(250 - GROUP_EDGE_PX - 1), [COLUMN], groups).mode, 'into', 'its floor is exact too')
})

test('a collapsed group keeps at least twelve pixels of into between its bands', () => {
  const groups = [group('node:n3', 100, 134, { headerHeight: 34 })]
  assert.equal(GROUP_MIN_INTO_PX, 12)
  assert.equal(hitGroupAt(pointAt(100 + 9), [COLUMN], groups).mode, 'into', 'the first pixel past the top band is into')
  assert.equal(hitGroupAt(pointAt(100 + 16), [COLUMN], groups).mode, 'into', 'the middle of a 34px header still files under it')
  assert.equal(hitGroupAt(pointAt(134 - 9), [COLUMN], groups).mode, 'into', 'the last pixel before the bottom band is into')
  assert.equal(hitGroupAt(pointAt(134 - 2), [COLUMN], groups).mode, 'after', 'the bottom band still reorders')
})

test('a workspace group has no sibling order: every y in it is into', () => {
  const groups = [group('workspace:w1', 100, 200, { kind: 'workspace', nodeId: null })]
  for (const y of [101, 150, 199]) {
    assert.equal(hitGroupAt(pointAt(y), [COLUMN], groups).mode, 'into', `y=${String(y)} targets the Workspace`)
  }
})

test('the pointer in a column\'s 6px padding still hits the group; a gutter hits none', () => {
  const groups = [group('node:n1', 100, 250)]
  assert.equal(hitGroupAt(pointAt(150, 1), [COLUMN], groups).group?.key, 'node:n1', 'the column padding belongs to the column')
  assert.equal(hitGroupAt(pointAt(150, 199), [COLUMN], groups).group?.key, 'node:n1', 'the trailing padding too')
  const gutter = hitGroupAt(pointAt(150, 260), [COLUMN], groups)
  assert.equal(gutter.zone, 'none', 'the inter-column gutter is not a target')
  assert.equal(gutter.group, null)
})

test('the column tail is the last group; a conversation has no target there', () => {
  const groups = [group('node:n1', 100, 250), group('node:n4', 250, 400)]
  const tail = hitGroupAt(pointAt(500), [COLUMN], groups)
  assert.equal(tail.zone, 'tail', 'the blank below the last group is the append zone')
  assert.equal(tail.group?.key, 'node:n4')
  assert.equal(tail.mode, 'after', 'for a topic it means "append after the last group"')
  assert.deepEqual(
    candidateFromGroupHit(tail, { kind: 'node', nodeId: 'n2', workspaceId: 'w1' }),
    { row: { kind: 'node', nodeId: 'n4', workspaceId: 'w1' }, edge: 'after' },
    'a topic payload appends to the level',
  )
  assert.equal(
    candidateFromGroupHit(tail, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }),
    null,
    'a conversation has no slot to append to: no target, so a release writes nothing',
  )
})

test('a conversation inside a group is always into, even on the reorder bands', () => {
  const groups = [group('node:n1', 100, 250)]
  for (const y of [100 + 2, 150, 250 - 2]) {
    const hit = hitGroupAt(pointAt(y), [COLUMN], groups)
    assert.equal(
      candidateFromGroupHit(hit, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }).edge,
      'into',
      `y=${String(y)} files the conversation under the topic; its vertical position is not a sort slot`,
    )
  }
  const top = hitGroupAt(pointAt(100 + 2), [COLUMN], groups)
  assert.equal(
    candidateFromGroupHit(top, { kind: 'node', nodeId: 'n2', workspaceId: 'w1' }).edge,
    'before',
    'a topic payload on the same band does mean sibling order',
  )
})

test('workspace and ungrouped groups map onto the candidates decideDrop already knows', () => {
  const workspace = hitGroupAt(pointAt(150), [COLUMN], [group('workspace:w1', 100, 200, { kind: 'workspace', nodeId: null })])
  assert.deepEqual(
    candidateFromGroupHit(workspace, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }),
    { row: { kind: 'workspace', workspaceId: 'w1' }, edge: 'into' },
    'a conversation lands at the Workspace root',
  )
  assert.deepEqual(
    candidateFromGroupHit(workspace, { kind: 'node', nodeId: 'n2', workspaceId: 'w1' }),
    { row: { kind: 'workspace', workspaceId: 'w1' }, edge: 'into' },
    'a topic lands at the Workspace top level',
  )

  const ungrouped = hitGroupAt(pointAt(150), [COLUMN], [group('ungrouped:@ungrouped', 100, 200, { kind: 'ungrouped', nodeId: null, workspaceId: null })])
  assert.deepEqual(
    candidateFromGroupHit(ungrouped, { kind: 'node', nodeId: 'n2', workspaceId: 'w1' }),
    { row: { kind: 'none' }, edge: 'into' },
    'the ungrouped bucket is not a target; decideDrop refuses it',
  )
})

test('a group hit outside every column or below an empty column has no target', () => {
  assert.equal(hitGroupAt({ x: 100, y: 500 }, [COLUMN], []).zone, 'none', 'an empty column has no group to append to')
  assert.equal(hitGroupAt({ x: 100, y: -10 }, [COLUMN], [group('node:n1', 100, 250)]).zone, 'none', 'above the column is no target')
  assert.equal(
    candidateFromGroupHit(
      hitGroupAt(pointAt(500), [COLUMN], [group('node:n1', 100, 250)]),
      { kind: 'node', nodeId: 'n2', workspaceId: 'w1' },
    )?.row.kind,
    'node',
    'a tail hit still maps to the last group',
  )
})

test('a topic drag states how many conversations travel with it', () => {
  const state = seed()
  const decision = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('b')))
  assert.equal(decision.issue, null)
  assert.equal(decision.label.kind, 'under')
  assert.equal(decision.label.carried, 1, 'the conversation filed under the topic is part of the move')
  assert.match(label(decision), /移到「产品设计」下 · 带走 1 条会话/, 'the pointer label states the cost')
})

test('the F0 regression: a topic candidate without its Workspace is refused as ungrouped', () => {
  const state = seed()
  const decision = decideDrop(
    state,
    { kind: 'session', sessionId: 's1', workspaceId: 'w1' },
    { row: { kind: 'node', nodeId: 'a1', workspaceId: null }, edge: 'into' },
  )
  assert.equal(decision.issue.code, 'UNGROUPED', 'the hit test must carry the topic\'s Workspace, not only its id')
  assert.equal(label(decision), '未分组不参与拖动')
})

test('an archived topic is neither a drag source nor a drop target', () => {
  const state = archiveNode(seed(), 'a1')
  const source = decideDrop(state, { kind: 'node', nodeId: 'a1', workspaceId: 'w1' }, into(workspaceRow('w1')))
  assert.equal(source.issue.code, 'ARCHIVED', 'a put-away topic cannot be dragged back out')
  assert.equal(source.action, null)
  assert.equal(label(source), '「已归档」中的内容不能拖入或拖出，请用取消归档。', 'the pointer says how to leave the archive')

  const target = decideDrop(state, { kind: 'node', nodeId: 'a', workspaceId: 'w1' }, into(nodeRow('a1')))
  assert.equal(target.issue.code, 'ARCHIVED', 'the archive is not a destination either')
  assert.equal(target.action, null)
})

test('an archived conversation cannot be dragged, and archived topics refuse it', () => {
  const state = archiveThread(seed(), 's1')
  const source = decideDrop(state, { kind: 'session', sessionId: 's1', workspaceId: 'w1' }, into(nodeRow('a')))
  assert.equal(source.issue.code, 'ARCHIVED', 'the conversation only leaves through 取消归档')
  assert.equal(source.action, null)
  assert.equal(label(source), '「已归档」中的内容不能拖入或拖出，请用取消归档。')

  const target = decideDrop(state, { kind: 'session', sessionId: 's2', workspaceId: 'w2' }, into(nodeRow('a')))
  assert.equal(target.issue.code, 'WORKSPACE', 'cross-Workspace refusals still come first')
})
