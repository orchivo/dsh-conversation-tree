/**
 * Render tests for the conversation-management page.
 *
 * The plugin's real panel is rendered outside the browser through
 * `react-dom/server`, with the slot props the framework would inject stubbed
 * and a plain object standing in for the backing store. Effects do not run under
 * this renderer, so what is asserted here is the structure the user sees before
 * any conversation binds.
 *
 * The first level is the Host's Workspace list, so the stubbed Workspaces
 * service is a real part of every fixture.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_PX, DragLabel, MapPanel, MoveThreadField, NodeColumnView,
  NodeLocationRail, NodePositionField, SPRING_LOAD_MS, applyDragPlan, autoScrollStep, commitsOnEnter,
  bandHeaderHeight, consumeOneShot, dialogClass, dialogPrimaryLabel, dragLabelStyle, enterCommits,
  browsingForRow, browsingForSpace, followAfterMove, followNativeNavigation, followSessionHome, heldOverlay, insertionLineStyle, moveFailureMessage, moveTreeRows,
  nodeTitleIssue, planFromDecision, scrolledFromStart, selectionAfterArchive, showsStatusRollup, siblingTargets, springLoadTarget, threadMenuModel, threadMoveChange,
  threadMoveDefault, threadMoveIsNoop, threadMoveOptions, titleTipPlacement, treeStep, visibleTreeRows, SpaceMenuTrailing,
  overlayOffset, nextSpaceBreadcrumbDensity, spaceBreadcrumbDensities, WINDOW_EDGE_GUTTER, windowEdgeGutter,
} from '../lib/panel.js'
import { MapError } from '../lib/model.js'
import { ensureDefaultSpace, parseMapState, syncCatalog } from '../lib/model.js'
import { createStatusLedger } from '../lib/status-ledger.js'
import { createTranslator, zh } from '../lib/locales.js'

/** The Simplified Chinese translator the exported copy builders are asserted against. */
const t = createTranslator(zh)

/** Two hours ago, as an ISO stamp. */
function ago(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

/** The catalog the stubbed `useSessions` answers from. */
const CATALOG = {
  ids: ['s1', 's2', 's3'],
  byId: {
    s1: { displayTitle: '第一条对话' },
    s2: { displayTitle: '散落对话' },
    s3: { displayTitle: '第三条对话' },
  },
}

/** The Host Workspace list: alpha owns s1, beta owns s3, s2 floats ungrouped. */
const WORKSPACES = {
  phase: 'ready',
  items: [
    { workspaceId: 'w1', path: '/tmp/alpha', title: 'alpha', sessionIds: ['s1'] },
    { workspaceId: 'w2', path: '/tmp/beta', title: 'beta', sessionIds: ['s3'] },
  ],
}

/**
 * Stub the application's status hook.
 * @param entries - per-session status values.
 * @returns a `useSessionStatus`-shaped function.
 */
function useStatus(entries) {
  const snapshot = new Map(Object.entries(entries))
  return selector => selector(snapshot)
}

/** A session whose own subagents are still working. */
const SUBAGENT_CATALOG = {
  ...CATALOG,
  byId: { ...CATALOG.byId, child: { displayTitle: '子智能体' } },
  projectionsBySession: { s1: { values: { subagentCatalog: [{ id: 'child' }] } } },
}

/** Two subagent children of s1, as the catalog reports them: parented, not rows. */
const SUBAGENT_CHILDREN = {
  ids: [...CATALOG.ids, 'child1', 'child2'],
  byId: {
    ...CATALOG.byId,
    child1: { displayTitle: '子智能体一', origin: 'subagent', parentId: 's1' },
    child2: { displayTitle: '子智能体二', origin: 'subagent', parentId: 's1' },
  },
}

/** A topic tree inside Workspace alpha, plus one ungrouped conversation. */
const MAP = {
  version: 2,
  revision: 1,
  nodes: [
    { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '从零起步', position: 1, updatedAt: '' },
    { id: 'n2', parentId: 'n1', workspaceId: 'w1', title: '获客方式', description: '先看低成本渠道', position: 1, updatedAt: '' },
  ],
  threads: [
    { sessionId: 's1', nodeId: 'n1', workspaceId: 'w1', title: '第一条对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's2', nodeId: null, workspaceId: null, title: '散落对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's3', nodeId: null, workspaceId: 'w2', title: '第三条对话', updatedAt: ago(1), importedAt: '' },
  ],
}

/** An index written before the rule: the two children were conversations of their own. */
const PRE_RULE_MAP = {
  ...MAP,
  threads: [
    ...MAP.threads,
    { sessionId: 'child1', nodeId: null, workspaceId: null, title: '子智能体一', updatedAt: ago(1), importedAt: '' },
    { sessionId: 'child2', nodeId: null, workspaceId: null, title: '子智能体二', updatedAt: ago(1), importedAt: '' },
  ],
}

/** One node holding more conversations than the preview shows. */
const BUSY_MAP = {
  version: 2,
  revision: 1,
  nodes: [
    { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '', position: 1, updatedAt: '' },
  ],
  threads: Array.from({ length: 7 }, (_, index) => ({
    sessionId: `b${String(index)}`,
    nodeId: 'n1',
    workspaceId: 'w1',
    title: `对话 ${String(index)}`,
    updatedAt: ago(2),
    importedAt: '',
  })),
}

/** The same node, with two of its conversations owning subagent children. */
const BUSY_WITH_CHILDREN = {
  ...BUSY_MAP,
  threads: [
    ...BUSY_MAP.threads,
    { sessionId: 'child1', nodeId: 'n1', workspaceId: 'w1', title: '子智能体一', updatedAt: ago(1), importedAt: '' },
    { sessionId: 'child2', nodeId: 'n1', workspaceId: 'w1', title: '子智能体二', updatedAt: ago(1), importedAt: '' },
  ],
}

/** The catalog of {@link BUSY_WITH_CHILDREN}: seven rows and two subagent children. */
const BUSY_WITH_CHILDREN_CATALOG = {
  ids: [...BUSY_MAP.threads.map(thread => thread.sessionId), 'child1', 'child2'],
  byId: {
    ...Object.fromEntries(BUSY_MAP.threads.map(thread => [thread.sessionId, { displayTitle: thread.title }])),
    child1: { displayTitle: '子智能体一', origin: 'subagent', parentId: 'b0' },
    child2: { displayTitle: '子智能体二', origin: 'subagent', parentId: 'b1' },
  },
}

/** A Workspace holding direct conversations whose stored order is oldest-first. */
const DIRECT_ORDER_MAP = {
  version: 2,
  revision: 1,
  nodes: [],
  threads: [
    { sessionId: 'old', nodeId: null, workspaceId: 'w1', title: '更早的一轮', updatedAt: '2024-01-01T00:00:00.000Z', importedAt: '' },
    { sessionId: 'newest', nodeId: null, workspaceId: 'w1', title: '最近的一轮', updatedAt: '2024-12-01T00:00:00.000Z', importedAt: '' },
  ],
}

/** A complete stored view document. */
function view(patch = {}) {
  return {
    version: 1,
    selectedNodeId: null,
    collapsedIds: [],
    navCollapsed: false,
    openSessionId: null,
    scroll: [],
    columnWidths: [],
    nodePanelWidth: 300,
    mapWidth: 560,
    ...patch,
  }
}

/**
 * Build the backing store the panel reads.
 * @param map - conversation-map document, or undefined for none.
 * @param stored - view document, or undefined for none.
 * @returns the injected store.
 */
function store(map, stored) {
  const backing = new Map()
  if (map !== undefined) backing.set('dsh.conversation-map.v1', JSON.stringify(map))
  if (stored !== undefined) backing.set('dsh.conversation-map.view.v1', JSON.stringify(stored))
  return {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
}

/**
 * Apply the index pass the panel's catalog effect runs.
 *
 * Effects do not run under `renderToStaticMarkup`, so a fixture that wants to
 * show what a catalog sync produces runs the same pure passes itself. The order
 * matters and mirrors `MapPanel`: the WHOLE catalog goes to `syncThreads` (it
 * applies visibility itself and records subagent children in the ledger), while
 * the filtered rows are only the prune target.
 * @param map - the stored conversation-map document.
 * @param catalog - the catalog fixture the stubbed hook answers from.
 * @param openSessionId - the conversation currently open, if any.
 * @returns the synced document.
 */
function synced(map, catalog, openSessionId = null) {
  const document = ensureDefaultSpace(parseMapState(JSON.stringify(map)))
  const rows = catalog.ids.map(id => ({
    id,
    displayTitle: catalog.byId[id]?.displayTitle ?? catalog.byId[id]?.title ?? id,
    updatedAt: catalog.byId[id]?.updatedAt,
    blank: catalog.byId[id]?.blank,
    origin: catalog.byId[id]?.origin,
    parentId: catalog.byId[id]?.parentId,
  }))
  // The panel and this helper share one entry point, so the pass order cannot
  // drift between them: `syncCatalog` takes the whole catalog and reports the
  // visible rows itself.
  return syncCatalog(document, rows, { openSessionId }).state
}

/**
 * Stub the Workspace Controller.
 * @param snapshot - the snapshot the panel reads; defaults to the fixture.
 * @returns a service-shaped object.
 */
function workspaces(snapshot = WORKSPACES) {
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    create: async input => ({ workspaceId: 'w9', path: input.path, title: '新工作区', sessionIds: [] }),
    rename: async (workspaceId, title) => ({ workspaceId, path: '/tmp/x', title, sessionIds: [] }),
    delete: async () => {},
  }
}

/**
 * A ready, in-memory map store over the same backing storage the view uses.
 *
 * Production reads the Host; the render tests only need the page's read model,
 * so the fake applies mutations synchronously to the parsed document.
 * @param backing - the injected view/business storage.
 * @returns a `MapStore`-shaped object.
 */
function fakeStore(backing) {
  let snapshot = {
    phase: 'ready',
    doc: ensureDefaultSpace(parseMapState(backing.getItem('dsh.conversation-map.v1'))),
    revision: 0,
    pending: 0,
  }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update(change) {
      snapshot = { ...snapshot, doc: change(snapshot.doc) }
      for (const listener of [...listeners]) listener()
      return { ok: true }
    },
    refresh: async () => {},
    load: async () => {},
    dispose() {},
  }
}

/**
 * Render the panel with framework-shaped stubs.
 * @param storage - the backing store to inject.
 * @param overrides - props to replace.
 * @returns the static markup.
 */
function render(storage, overrides = {}) {
  const services = {
    sessions: { retain: id => ({ sessionId: id, release() {} }) },
    workspaces: workspaces(),
    store: fakeStore(storage),
    ...overrides.services,
  }
  return renderToStaticMarkup(createElement(MapPanel, {
    storage,
    useSessions: selector => selector(CATALOG),
    ...overrides,
    services,
  }))
}

/** Count rendered node columns. */
function columnCount(markup) {
  return markup.split('class="cm-node-col"').length - 1
}

test('an empty map still renders the band, node area, and Workspace list', () => {
  const markup = render(store(undefined, undefined))
  assert.ok(markup.includes('cm-band'))
  assert.ok(markup.includes('cm-node-area'))
  assert.ok(markup.includes('cm-node-col'))
  assert.ok(markup.includes('alpha'), 'the first Workspace is listed')
  assert.ok(markup.includes('beta'), 'the second Workspace is listed')
  assert.ok(markup.includes('class="cm-col-title" title="L1"'), 'the level column carries its number')
  assert.ok(!markup.includes('cm-chat'), 'the map no longer embeds a Conversation occurrence')
})

test('first-level nodes are the Host Workspaces, in Host order', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(markup.includes('data-kind="workspace"'), 'Workspace rows carry their own kind')
  assert.equal((markup.match(/data-kind="workspace"/g) ?? []).length, 2, 'one row per Workspace')
  assert.ok(markup.indexOf('alpha') < markup.indexOf('beta'), 'the Host order is kept')
})

test('the ungrouped bucket trails the Workspaces and holds conversations outside every Workspace', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(markup.includes('未分组'))
  assert.ok(markup.indexOf('beta') < markup.indexOf('未分组'), 'the bucket trails the Workspaces')
  const ungrouped = markup.indexOf('未分组')
  assert.ok(ungrouped < markup.indexOf('散落对话'), 'the unowned conversation sits under the bucket')
})

test('a Workspace shows the conversations the Host accounts to it directly', () => {
  const markup = render(store(MAP, undefined))
  const beta = markup.indexOf('beta')
  const direct = markup.indexOf('第三条对话')
  assert.ok(beta < direct, 'the direct conversation follows its Workspace row')
})

test('selecting a Workspace opens its topic column, labelled by level', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:w1' })))
  assert.equal(columnCount(markup), 2, 'the Workspace column plus the open Workspace topic column')
  assert.ok(markup.includes('外贸探索'), 'the top-level topic is listed')
  const titles = [...markup.matchAll(/class="cm-col-title" title="([^"]*)"/g)].map(match => match[1])
  assert.deepEqual(titles, ['L1', 'L2'])
})

test('an empty Workspace opens no topic column', () => {
  const empty = { phase: 'ready', items: [{ workspaceId: 'w1', path: '/tmp/empty', title: '空的', sessionIds: [] }] }
  const markup = render(store(undefined, view({ selectedNodeId: '@ws:w1' })), {
    services: { sessions: { retain: id => ({ sessionId: id, release() {} }) }, workspaces: workspaces(empty) },
  })
  assert.equal(columnCount(markup), 1, 'an empty column beside the tree is dead space, so it is not drawn')
  assert.ok(!markup.includes('aria-label="新增节点"'), 'the first topic is created from the Workspace row menu instead')
})

test('selecting a node or a Workspace no longer renders the removed information bar', () => {
  for (const selection of ['n1', '@ws:w1']) {
    const markup = render(store(MAP, view({ selectedNodeId: selection })))
    assert.ok(!markup.includes('class="cm-info"'), 'the bottom information bar is gone')
    assert.ok(!markup.includes('详情'), 'its 详情 affordance is gone too')
    assert.ok(!markup.includes('aria-controls="cm-info-body"'), 'no panel body is left behind')
  }
})

test('selecting a topic opens every level beneath it', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.equal(columnCount(markup), 3, 'Workspaces, its topics, and the selected topic children')
  assert.ok(markup.includes('获客方式'), 'the child is listed')
  const titles = [...markup.matchAll(/class="cm-col-title" title="([^"]*)"/g)].map(match => match[1])
  assert.deepEqual(titles, ['L1', 'L2', 'L3'])
})

test('every deeper column keeps counting levels instead of naming a kind', () => {
  // A five-deep chain: selecting the middle node opens L1 through L5, so the
  // fifth level reads "L5" rather than a semantic label that stops at four.
  const deep = {
    version: 2,
    revision: 1,
    nodes: [1, 2, 3, 4, 5].map(step => ({
      id: `d${String(step)}`,
      parentId: step === 1 ? null : `d${String(step - 1)}`,
      workspaceId: 'w1',
      title: `第 ${String(step)} 层`,
      description: '',
      position: 1,
      updatedAt: '',
    })),
    threads: [],
  }
  const markup = render(store(deep, view({ selectedNodeId: 'd3' })))
  const titles = [...markup.matchAll(/class="cm-col-title" title="([^"]*)"/g)].map(match => match[1])
  assert.deepEqual(titles, ['L1', 'L2', 'L3', 'L4', 'L5'])
})

test('a topic conversation list is nested under its row', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  const topic = markup.indexOf('外贸探索')
  const owned = markup.indexOf('第一条对话')
  assert.ok(topic < owned, 'the filed conversation sits under its topic')
})

test('only a selected row adds a deeper column', () => {
  const markup = render(store(MAP, view({ selectedNodeId: null })))
  assert.equal(columnCount(markup), 1, 'nothing is selected, so only the Workspace column exists')
})

test('a selected leaf adds no empty trailing column', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n2' })))
  assert.equal(columnCount(markup), 3, 'Workspaces, the topic column, and the column the leaf sits in')
})

test('the Workspace column offers adopting a Workspace, topic columns offer adding topics', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:w1' })))
  assert.ok(markup.includes('aria-label="新增工作区"'), 'the first level adds Workspaces')
  assert.ok(markup.includes('aria-label="新增节点"'), 'the second level adds topics')
  assert.equal((markup.match(/class="cm-col-actions"/g) ?? []).length, columnCount(markup), 'one add button per column')
})

test('a Workspace draws its conversations newest activity first', () => {
  const markup = render(store(DIRECT_ORDER_MAP, undefined))
  const newest = markup.indexOf('最近的一轮')
  const oldest = markup.indexOf('更早的一轮')
  assert.ok(newest !== -1 && oldest !== -1, 'both rows are drawn')
  assert.ok(newest < oldest, 'the newest conversation sits above the older one')
})

test('a node draws its conversations newest activity first', () => {
  const ordered = {
    version: 2,
    revision: 1,
    nodes: [
      { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '', position: 1, updatedAt: '' },
    ],
    threads: [
      { sessionId: 'a', nodeId: 'n1', workspaceId: 'w1', title: '更早的一轮', updatedAt: '2024-01-01T00:00:00.000Z', importedAt: '' },
      { sessionId: 'b', nodeId: 'n1', workspaceId: 'w1', title: '最新的一轮', updatedAt: '2024-12-01T00:00:00.000Z', importedAt: '' },
    ],
  }
  const markup = render(store(ordered, view({ selectedNodeId: 'n1' })))
  const newest = markup.indexOf('最新的一轮')
  const oldest = markup.indexOf('更早的一轮')
  assert.ok(newest !== -1 && oldest !== -1, 'both rows are drawn')
  assert.ok(newest < oldest, 'the newest conversation sits above the older one')
})

test('a Workspace folds its conversation list away', () => {
  const open = render(store(MAP, undefined))
  assert.ok(open.includes('第三条对话'), 'the list is shown by default')
  const folded = render(store(MAP, view({ collapsedIds: ['@ws:w2'] })))
  assert.ok(!folded.includes('第三条对话'), 'folding hides that Workspace conversations')
  assert.ok(folded.includes('beta'), 'the Workspace row itself stays')
})

test('no conversation row shows an id or an open button', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(!markup.includes('cm-id'), 'ids are gone from the list')
  assert.ok(!markup.includes('>打开<'), 'opening is the row click, not a button')
})

test('every node row carries the two per-row actions', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(markup.includes('cm-node-row'), 'node rows are rendered')
  assert.ok(markup.includes('aria-label="发起对话"'), 'a row offers starting a conversation')
  assert.ok(markup.includes('aria-label="更多"'), 'a row offers a more menu')
})

test('a Workspace row starts conversations in its own Workspace', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(markup.includes('title="在该工作区发起新对话"'), 'the row says where the conversation will live')
})

test('a conversation row carries its age behind the hover actions', () => {
  const markup = render(store(MAP, undefined))
  assert.match(markup, /<span class="cm-time">[^<]+<\/span>/, 'the age is rendered')
  assert.ok(markup.includes('cm-row-actions'), 'the actions sit in the trailing cell')
  assert.ok(markup.indexOf('cm-time') < markup.indexOf('cm-row-actions', markup.indexOf('cm-thread-row')), 'the actions follow the age')
})

test('an ordinary conversation row keeps its single line, whatever its position', () => {
  // Regression: `threads.map(threadRowOf)` once handed the array index to the
  // row builder's optional `note`, so every ordinary row grew a second line with
  // its own 0-based position ("0", "1", …). The note belongs to the search view.
  const markup = render(store(BUSY_MAP, view({ selectedNodeId: 'n1' })))
  assert.ok(markup.includes('cm-thread-row'), 'the fixture still draws conversation rows')
  assert.ok(!markup.includes('class="cm-row-note"'), 'no ordinary row draws a second line')
  assert.ok(!markup.includes('data-note="true"'), 'no ordinary row advertises a note')
})

test('the ungrouped bucket shows unassigned conversations', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ungrouped' })))
  assert.ok(markup.includes('未分组'))
  assert.ok(markup.includes('散落对话'))
})

test('a node with more conversations than the preview folds them', () => {
  const markup = render(store(BUSY_MAP, view({ selectedNodeId: 'n1' })))
  const shown = (markup.match(/class="cm-thread-row"/g) ?? []).length
  assert.equal(shown, 5, 'only the preview is drawn')
  assert.ok(markup.includes('显示更多（还有 2 条）'), 'the rest wait behind a reveal row')
})

test('a node within the preview shows no reveal row', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.ok(!markup.includes('显示更多'), 'a single conversation needs no reveal row')
})

test('a view pointing at a deleted node falls back without crashing', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'gone', openSessionId: 'gone' })))
  assert.equal(columnCount(markup), 1)
  assert.ok(markup.includes('alpha'))
})

test('a view pointing at a removed Workspace falls back to no selection', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:gone' })))
  assert.equal(columnCount(markup), 1)
  assert.ok(!markup.includes('title="L2"'), 'no topic column for a Workspace that is gone')
})

test('the open conversation is marked current and its owning node stays selected', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })))
  assert.equal((markup.match(/data-selected="true"/g) ?? []).length, 2, 'one node and one conversation are marked')
  assert.match(markup, /class="cm-thread-row"[^>]*data-session-id="s1"[^>]*aria-current="page"/)
  assert.match(markup, /class="cm-node-row"[^>]*data-node-id="n1"[^>]*data-selected="true"/)
})

test('a closed conversation is not marked current', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.equal((markup.match(/data-selected="true"/g) ?? []).length, 1, 'only the selected node is marked')
  assert.ok(!markup.includes('aria-current="page"'), 'no conversation claims to be the one being read')
})

test('a deep selection marks its whole lineage, Workspace row included', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n2' })))
  assert.match(markup, /class="cm-node-row"[^>]*data-node-id="n2"[^>]*data-selected="true"/, 'the selected leaf keeps the selection mark')
  assert.match(markup, /class="cm-node-row"[^>]*data-node-id="n1"[^>]*data-path-selected="true"/, 'the parent row marks the path')
  assert.match(markup, /data-kind="workspace"[^>]*data-row-key="@ws:w1"[^>]*data-path-selected="true"/, 'the owning Workspace row marks the path')
  assert.equal((markup.match(/data-path-selected="true"/g) ?? []).length, 2, 'one mark per level above the selection, no more')
})

test('rows off the lineage stay unmarked', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n2' })))
  assert.match(markup, /data-kind="workspace"[^>]*data-row-key="@ws:w2"[^>]*data-path-selected="false"/, 'a sibling Workspace is not on the path')
  assert.match(markup, /data-kind="ungrouped"[^>]*data-row-key="@ungrouped"[^>]*data-path-selected="false"/, 'the ungrouped bucket is not on the path')
})

test('an open conversation marks its owning node and the lineage above it', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })))
  assert.equal((markup.match(/data-selected="true"/g) ?? []).length, 2, 'the conversation and its owning node keep the selection marks')
  assert.equal((markup.match(/data-path-selected="true"/g) ?? []).length, 1, 'only the Workspace row is above the owning node')
  assert.match(markup, /data-kind="workspace"[^>]*data-row-key="@ws:w1"[^>]*data-path-selected="true"/)
})

test('a Workspace selection has no lineage above it', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:w1' })))
  assert.equal((markup.match(/data-path-selected="true"/g) ?? []).length, 0, 'the first level is the top of the chain')
  assert.match(markup, /class="cm-node-row"[^>]*data-row-key="@ws:w1"[^>]*data-selected="true"/)
})

test('every level above a deep selection marks the path, not just the parent', () => {
  const deep = {
    version: 2,
    revision: 1,
    nodes: [1, 2, 3, 4, 5].map(step => ({
      id: `d${String(step)}`,
      parentId: step === 1 ? null : `d${String(step - 1)}`,
      workspaceId: 'w1',
      title: `第 ${String(step)} 层`,
      description: '',
      position: 1,
      updatedAt: '',
    })),
    threads: [],
  }
  const markup = render(store(deep, view({ selectedNodeId: 'd3' })))
  const marked = [...markup.matchAll(/class="cm-node-row"[^>]*data-path-selected="true"[^>]*>/g)]
    .map(match => /data-(?:node-id|row-key)="([^"]*)"/.exec(match[0])?.[1])
  assert.deepEqual(marked, ['@ws:w1', 'd1', 'd2'], 'Workspace, then each ancestor from the root down')
})

test('a missing session service does not break the render', () => {
  const markup = render(store(MAP, undefined), { useSessions: undefined })
  assert.ok(markup.includes('cm-band'))
})

test('a still-arriving Workspace list says so instead of showing an empty level', () => {
  const pending = render(store(MAP, undefined), {
    services: {
      sessions: { retain: id => ({ sessionId: id, release() {} }) },
      workspaces: workspaces({ phase: 'pending', items: [] }),
    },
  })
  assert.ok(pending.includes('正在同步工作区…'))
  assert.ok(!pending.includes('散落对话'), 'nothing is filed into a Workspace before the list arrives')
})

test('a running conversation shows the application spinner, not a dot', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), { useSessionStatus: useStatus({ s1: { running: true } }) })
  assert.ok(markup.includes('class="cm-ring"'), 'the spinning ring marks a running conversation')
  assert.ok(markup.includes('cm-ring-track') && markup.includes('cm-ring-arc'), 'the ring draws track and arc')
  assert.ok(!markup.includes('cm-state-dot'), 'no solid dot for a running conversation')
})

test('an idle conversation shows no mark at all', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), { useSessionStatus: useStatus({ s1: { running: false } }) })
  assert.ok(!markup.includes('cm-ring'), 'nothing spins')
  assert.ok(!markup.includes('cm-state-dot'), 'an idle row is blank, exactly like the shipped list')
})

test('a pending approval warns and states itself instead of the age', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'approval' } } }),
  })
  assert.ok(markup.includes('data-state="warning"'), 'a warning mark is drawn')
  assert.ok(markup.includes('>待审批<'), 'the compact wording takes the age cell')
})

test('plan review and question requests use their own wording', () => {
  const review = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'plan-review' } } }),
  })
  assert.ok(review.includes('>计划待审<'))
  const question = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'question' } } }),
  })
  assert.ok(question.includes('>待回答<'))
})

test('a pending request outranks live activity', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { running: true, pendingInteraction: { kind: 'approval' } } }),
  })
  assert.ok(markup.includes('data-state="warning"'), 'the warning wins')
  assert.ok(!markup.includes('cm-ring'), 'the ring gives way to the pending request')
})

test('an unread completion draws the done mark', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { completionUnread: true } }),
  })
  assert.ok(markup.includes('data-state="done"'), 'a done mark is drawn')
})

test('a session whose subagents are still working reads as ongoing', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessions: selector => selector(SUBAGENT_CATALOG),
    useSessionStatus: useStatus({ child: { running: true } }),
  })
  assert.ok(markup.includes('class="cm-ring"'), 'live subagents keep the row spinning')
})

test('a catalog holding subagent children renders no row for them', () => {
  const markup = render(store(synced(PRE_RULE_MAP, SUBAGENT_CHILDREN), view({ selectedNodeId: '@ungrouped' })))
  assert.ok(!markup.includes('子智能体'), 'no row names a subagent child')
  assert.ok(markup.includes('散落对话'), 'ordinary conversations stay listed')
})

test('a catalog sync records each subagent child in the ledger as well as hiding it', () => {
  // Pins the pass order the panel uses: the whole catalog reaches syncThreads,
  // so the child is recorded before it is dropped. A caller that pre-filtered
  // its rows would render identically and still empty the ledger — the exact
  // regression this assertion exists to catch.
  const document = synced(PRE_RULE_MAP, SUBAGENT_CHILDREN)
  assert.deepEqual(document.subagentSessionIds?.slice().sort(), ['child1', 'child2'], 'each child is recorded')
  assert.ok(
    !document.threads.some(thread => thread.sessionId === 'child1' || thread.sessionId === 'child2'),
    'and none of them holds a row',
  )
  assert.ok(document.threads.some(thread => thread.sessionId === 's1'), 'ordinary conversations are still indexed')
})

test('the reveal count measures conversations, not subagent children', () => {
  const markup = render(store(synced(BUSY_WITH_CHILDREN, BUSY_WITH_CHILDREN_CATALOG), view({ selectedNodeId: 'n1' })))
  assert.equal((markup.match(/class="cm-thread-row"/g) ?? []).length, 5, 'only the preview is drawn')
  assert.ok(markup.includes('显示更多（还有 2 条）'), 'the two subagent children are not counted')
  assert.ok(!markup.includes('子智能体'), 'and they draw no row of their own')
})

test('an unknown interaction kind draws nothing', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'something-new' } } }),
  })
  assert.ok(!markup.includes('cm-state-dot'), 'only the shipped kinds are drawn')
})

test('only nodes carry a glyph', () => {
  const markup = render(store(MAP, undefined))
  assert.ok(markup.includes('M1.6 4.3'), 'a folder glyph marks a node')
  assert.ok(!markup.includes('M2.1 3.6'), 'a conversation carries no glyph of its own')
})

/* ── spaces ─────────────────────────────────────────────────────────────── */

/**
 * Two Workspaces filed into two spaces, one loose conversation in the work
 * space, one legacy rootless topic in the default space, and one empty space.
 */
const SPACES_MAP = {
  version: 2,
  revision: 1,
  nodes: [
    { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '', position: 1, updatedAt: '' },
    { id: 'u1', parentId: null, workspaceId: null, title: '历史无主主题', description: '', position: 1, updatedAt: '' },
  ],
  threads: [
    { sessionId: 's1', nodeId: 'n1', workspaceId: 'w1', title: '第一条对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's2', nodeId: null, workspaceId: null, spaceId: 'sp-work', title: '散落对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's3', nodeId: null, workspaceId: 'w2', title: '第三条对话', updatedAt: ago(1), importedAt: '' },
  ],
  spaces: [
    { id: 'sp-default', title: '默认空间', position: 1, createdAt: '' },
    { id: 'sp-work', title: '工作空间', position: 2, createdAt: '' },
    { id: 'sp-family', title: '家庭空间', position: 3, createdAt: '' },
    { id: 'sp-empty', title: '空的空间', position: 4, createdAt: '' },
  ],
  defaultSpaceId: 'sp-default',
  spaceOf: { w1: 'sp-work', w2: 'sp-family' },
}

/** The markup of one rendered node row, up to its first conversation row. */
function rowMarkup(markup, kind) {
  const start = markup.indexOf(`data-kind="${kind}"`)
  assert.ok(start !== -1, `the ${kind} row is rendered`)
  const threadStart = markup.indexOf('cm-thread-row', start)
  return markup.slice(start, threadStart === -1 ? start + 1500 : threadStart)
}

test('the very first render bootstraps one default space in the breadcrumb’s current segment', () => {
  const markup = render(store(undefined, undefined))
  assert.ok(markup.includes('默认空间'), 'the current segment names the default space')
  const viewToggle = markup.indexOf('cm-view-toggle')
  const spaceSwitcher = markup.indexOf('cm-space-btn cm-crumb')
  const searchToggle = markup.indexOf('cm-band-search-toggle')
  assert.ok(viewToggle !== -1 && spaceSwitcher !== -1 && searchToggle !== -1)
  const row2 = markup.indexOf('cm-band-row2')
  assert.ok(row2 !== -1 && row2 < spaceSwitcher, 'the breadcrumb leads the second row, on the node list rail')
  assert.ok(spaceSwitcher < markup.indexOf('cm-crumb-root'), 'the whole bar is the space switcher')
  assert.ok(viewToggle < searchToggle, 'the single view button leads the head row, then the search action')
  assert.ok(!markup.includes('cm-brand'), 'the band carries no brand of its own')
})

test('search is on demand: the resting header keeps the row but shows no input', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.ok(markup.includes('cm-band-row2'), 'the second row stays, so the band keeps the shipped tab row height')
  assert.ok(!markup.includes('aria-label="搜索节点或对话"'), 'no search box on screen until it is asked for')
  assert.match(markup, /class="cm-btn cm-band-search-toggle"[^>]*aria-label="搜索"[^>]*aria-expanded="false"/)
})

/**
 * The band's chrome is two rows in every Session state.
 *
 * The shipped Conversation header is 76px while a Session is open and 40px on
 * the blank landing page. Making the band's top bar follow it down to one row
 * folded the space switcher into row 1 — a different control, at a different
 * place and width — and moved the whole map chrome whenever a blank Session
 * opened or a Session started. The band instead keeps its own two-row height
 * (`bandHeaderHeight`), and the shipped height stays the floor so a future,
 * taller header still lines the seam up.
 */
test('the band top bar keeps its two rows on a blank Session and follows a taller shipped header', () => {
  assert.equal(
    bandHeaderHeight({ headerHeight: 40, headTop: 10, headHeight: 30 }), 76,
    'the blank 40px header does not shrink the band top bar',
  )
  assert.equal(
    bandHeaderHeight({ headerHeight: 76, headTop: 10, headHeight: 30 }), 76,
    'with a Session open the band top bar is exactly the shipped header height',
  )
  assert.equal(
    bandHeaderHeight({ headerHeight: 96, headTop: 12, headHeight: 32 }), 96,
    'a taller shipped header still wins over the band own two rows',
  )
})

/**
 * The band's top bar is a window-chrome row, so it claims the shell's drag mark.
 *
 * macOS desktop dragging is opt-in per row: the shell's base.css declares the
 * one darwin drag rule for `[data-window-drag]` (plus the global no-drag list
 * that keeps controls clickable), and every chrome row marks itself — the
 * sidebar's top strip and logo row, and the Conversation header. Map mode
 * collapses the product's left column, so the sidebar's two rows leave with it,
 * and the plugin's reservation shifts the Conversation header one band-width
 * right. This top bar is the row left over that strip, and the drag geometry is
 * not inherited from the neighbouring header: without the mark the window
 * cannot be dragged from the band's blank runs at all.
 */
test('the band top bar claims the shell window drag row', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })))
  const topbar = markup.match(/<header[^>]*cm-band-topbar[^>]*>/)?.[0] ?? ''
  assert.notEqual(topbar, '', 'the band renders its top bar')
  assert.match(topbar, /data-window-drag/, 'the top bar is the map surface\'s window drag row')
})

/**
 * The resize handle is the band's child, not the body's — so its hit area starts
 * at y=0 and covers the seam's header portion too.
 *
 * The handle draws the whole seam line, and the header no longer paints a copy
 * of it. Rendering it inside `.cm-band-body` left the top 40/76px of the line as
 * decoration: a press there resized nothing (and on macOS dragged the window,
 * since the top bar above owns the drag region). The structural half is pinned
 * here; `tests/styles.test.mjs` pins the declarations that make it work.
 */
test('the resize handle is a child of the band, after the body, so the header seam is draggable', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })))
  const handle = markup.indexOf('cm-band-gutter')
  const body = markup.indexOf('cm-band-body')
  const topbar = markup.indexOf('cm-band-topbar')
  assert.notEqual(handle, -1, 'the band renders its resize handle')
  assert.notEqual(body, -1, 'the band renders its body')
  assert.ok(topbar !== -1 && topbar < body, 'the header precedes the body')
  assert.ok(
    handle > body,
    'the handle must not be nested inside the body: a body child starts at the shipped header\'s foot',
  )

  /* It has to follow the body in document order: Electron composes app-regions
     with the last matching box winning, so the handle's `no-drag` only overrides
     the top bar's `drag` while it comes after it. */
  const afterBody = markup.slice(body)
  const bodyEnd = afterBody.indexOf('</div></div>')
  assert.ok(
    bodyEnd === -1 || handle > body + bodyEnd,
    'the handle sits after the body\'s closing tag, not inside it',
  )
  assert.match(
    markup.slice(handle - 200, handle + 40),
    /role="separator"/,
    'and it stays the separator assistive technology reads',
  )
})

test('a document with spaces shows both segments inside one breadcrumb control', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work' })))
  const crumbStart = markup.indexOf('cm-space-btn cm-crumb')
  assert.notEqual(crumbStart, -1, 'the breadcrumb control is rendered')
  const crumbOpen = markup.lastIndexOf('<button', crumbStart)
  const crumbClose = markup.indexOf('</button>', crumbStart)
  const crumb = markup.slice(crumbOpen, crumbClose + '</button>'.length)
  assert.ok(crumb.includes('全部空间'), 'the root segment names the whole map')
  assert.ok(crumb.includes('工作空间'), 'the current segment names the active space')
  assert.match(
    crumb,
    /<button[^>]*class="cm-space-btn cm-crumb"[^>]*aria-haspopup="menu"/,
    'the whole bar is the space menu trigger',
  )
  assert.equal((crumb.match(/<button/g) ?? []).length, 1, 'one control: no nested buttons')
  assert.ok(crumb.includes('cm-crumb-root'), 'the root segment lives inside the control')
  assert.ok(crumb.includes('cm-crumb-root-label'), 'the root label is visible text, not a nested trigger')
  assert.ok(crumb.includes('cm-crumb-sep'), 'a separator sits between the two segments')
  assert.ok(crumb.includes('cm-crumb-current'), 'the current segment lives inside the control')
  assert.ok(crumb.includes('cm-chevron-glyph'), 'the chevron sits once, at the end of the control')
})

test('the breadcrumb reads the whole map on the root and only the active space on the current segment', () => {
  // The root totals every space (the sidebar row's whole-map figure, by
  // construction), while the current segment repeats the tree's scope. The two
  // must use one counting rule; the difference is the other spaces' work.
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work' })), {
    useSessionStatus: useStatus({
      s1: { pendingInteraction: { kind: 'approval' } },
      s2: { running: true },
      s3: { completionUnread: true },
    }),
  })
  const rootStart = markup.indexOf('cm-crumb-root')
  const currentStart = markup.indexOf('cm-crumb-current')
  const root = markup.slice(rootStart, currentStart)
  const current = markup.slice(currentStart, currentStart + 900)
  assert.ok(
    root.includes('aria-label="会话状态：1 条待响应，1 条已完成，1 条运行中（全部空间全部会话）"'),
    'the root totals every space',
  )
  assert.ok(
    current.includes('aria-label="会话状态：1 条待响应，1 条运行中（当前空间全部会话）"'),
    'the current segment counts only the active space',
  )
  assert.ok(!current.includes('条已完成'), 'a conversation in another space is not on the current segment')
})

test('an idle active space leaves the current segment quiet while the root keeps the whole map', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-empty' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'approval' } } }),
  })
  const rootStart = markup.indexOf('cm-crumb-root')
  const currentStart = markup.indexOf('cm-crumb-current')
  const root = markup.slice(rootStart, currentStart)
  const current = markup.slice(currentStart, currentStart + 700)
  assert.ok(root.includes('cm-rollup'), 'the root still totals the whole map')
  assert.ok(!current.includes('cm-rollup'), 'nothing in this space needs a look, so nothing is added')
})

test('a single-space document spends no cluster on the current segment', () => {
  // First run: the root and the current segment would print exactly the same
  // numbers. The quieter confirmed form keeps the current segment's name only.
  const markup = render(store(MAP, undefined), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'approval' } } }),
  })
  const currentStart = markup.indexOf('cm-crumb-current')
  assert.notEqual(currentStart, -1, 'the single-space breadcrumb still shows where you are')
  assert.ok(!markup.slice(currentStart, currentStart + 700).includes('cm-rollup'), 'the repeated cluster is gone')
  const rootStart = markup.indexOf('cm-crumb-root')
  assert.ok(markup.slice(rootStart, currentStart).includes('cm-rollup'), 'the root keeps the whole-map total')
})

test('the breadcrumb’s current cluster is measured in the browser, so the server keeps it whole', () => {
  // The density is chosen by measuring the row (the current space's name must
  // not ellipsize), and a server render has no layout to measure: it keeps the
  // richest form and the browser's layout effect walks it down. The band-width
  // thresholds this replaced dropped the numbers on every band under 480px,
  // leaving >100px of the row unused at 378px.
  const status = useStatus({ s1: { pendingInteraction: { kind: 'approval' } } })
  for (const mapWidth of [320, 400, 440, 480]) {
    const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work', mapWidth })), { useSessionStatus: status })
    const start = markup.indexOf('cm-crumb-current')
    const current = markup.slice(start, start + 900)
    assert.ok(current.includes('cm-rollup'), `mapWidth ${mapWidth}: the first paint keeps the current cluster`)
    assert.ok(!current.includes('cm-rollup-dots'), 'the first paint is the number cluster, not the presence-only dots')
  }
})

test('the breadcrumb density ladder only ever gives the current segment away', () => {
  assert.equal(nextSpaceBreadcrumbDensity('cluster'), 'dots', 'numbers give way to dots first')
  assert.equal(nextSpaceBreadcrumbDensity('dots'), 'none', 'dots give way last')
  assert.equal(nextSpaceBreadcrumbDensity('none'), 'none', 'nothing is left to give away')
  for (const current of ['cluster', 'dots', 'none']) {
    assert.deepEqual(
      spaceBreadcrumbDensities({ search: false, singleSpace: false, current }),
      { root: 'cluster', current },
      'the root keeps its numbers at every rung',
    )
  }
  assert.deepEqual(spaceBreadcrumbDensities({ search: true, singleSpace: false, current: 'cluster' }), { root: 'none', current: 'none' })
  assert.deepEqual(spaceBreadcrumbDensities({ search: false, singleSpace: true, current: 'cluster' }), { root: 'cluster', current: 'none' })
})

test('the target column only lists the Workspaces of the active space, in Host order', () => {
  const work = render(store(SPACES_MAP, view({ activeSpace: 'sp-work' })))
  assert.ok(work.includes('alpha'))
  assert.ok(!work.includes('beta'), 'a Workspace of another space stays out')
  const family = render(store(SPACES_MAP, view({ activeSpace: 'sp-family' })))
  assert.ok(family.includes('beta'))
  assert.ok(!family.includes('alpha'))
  assert.ok(family.indexOf('beta') < family.indexOf('第三条对话') || family.includes('第三条对话'))
})

test('each space lists only its own ungrouped conversations', () => {
  const work = render(store(SPACES_MAP, view({ activeSpace: 'sp-work' })))
  assert.ok(work.includes('散落对话'), 'the loose conversation filed into this space is listed')
  const family = render(store(SPACES_MAP, view({ activeSpace: 'sp-family' })))
  assert.ok(!family.includes('散落对话'), 'another space never borrows it')
  assert.equal((family.match(/data-kind="ungrouped"/g) ?? []).length, 1, 'every space keeps its own ungrouped row')
})

test('every space keeps an ungrouped row so a goal-less conversation can start anywhere', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-empty' })))
  const row = rowMarkup(markup, 'ungrouped')
  assert.ok(row.includes('在未分组发起对话'), 'the empty space still offers the start action')
  assert.ok(row.includes('data-selectable="true"'), 'it can be selected like any other row')
})


test('the ungrouped row can be selected, but it is not a container', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work' })))
  const row = rowMarkup(markup, 'ungrouped')
  assert.ok(row.includes('data-selectable="true"'), 'the reader can select the row')
  assert.ok(row.includes('在未分组发起对话'), 'it starts a conversation without a Workspace')
  assert.ok(!row.includes('aria-label="更多"'), 'it has nothing to rename or delete')
  assert.ok(!row.includes('aria-label="新增节点"'), 'no child node can be created under it')
})

test('selecting the ungrouped row marks it without opening a column', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ungrouped' })))
  const row = rowMarkup(markup, 'ungrouped')
  assert.ok(row.includes('data-selected="true"'), 'the row carries the selected state')
  assert.equal(columnCount(markup), 1, 'it opens no topic column of its own')
})

test('a legacy rootless topic still opens a read-only column in the default space', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-default', selectedNodeId: '@ungrouped' })))
  assert.equal(columnCount(markup), 2, 'the default space opens the legacy topic column')
  assert.ok(markup.includes('历史无主主题'))
  assert.ok(!markup.includes('aria-label="新增节点"'), 'legacy topics can no longer grow')
})

test('a default space without legacy topics opens no column for the ungrouped row', () => {
  const markup = render(store(MAP, view({ activeSpace: 'sp-default', selectedNodeId: '@ungrouped' })))
  assert.equal(columnCount(markup), 1, 'the ungrouped row is a list, not a container')
})

test('an empty space says how to fill it instead of rendering a blank column', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-empty' })))
  assert.ok(markup.includes('还没有工作区'), 'the empty state is explained')
  assert.ok(markup.includes('cm-hint-row'), 'the placeholder is a non-interactive hint row')
})

test('a selected Workspace without topics opens no topic column', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-family', selectedNodeId: '@ws:w2' })))
  assert.equal(columnCount(markup), 1, 'an empty column is dead space, so it is not drawn at all')
  assert.ok(!markup.includes('还没有主题'), 'no placeholder stands in for the column either')
})

test('a Workspace with topics still opens its topic column', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w1' })))
  assert.equal(columnCount(markup), 2, 'a populated Workspace lists its topics')
  assert.ok(markup.includes('外贸探索'))
})

test('a selected Workspace of another space opens nothing', () => {
  const markup = render(store(SPACES_MAP, view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w2' })))
  assert.equal(columnCount(markup), 1, 'out-of-scope selection is inert')
})

/*
 * 对话树模式: the band's top bar carries the single view button at the content
 * header's leading edge. The shipped Conversation header keeps its own controls
 * (right Sidebar toggle, tabs, utilities) because the shell is not replaced, so
 * the map must not draw second copies of them.
 */
test('an open conversation offers the single view button and no product-header substitutes', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })), {
    services: {
      sessions: {},
      workspaces: workspaces(),
      exit() {},
    },
  })
  assert.ok(!markup.includes('aria-label="左栏"'), 'the map leaves the product left column to the shell')
  assert.ok(!markup.includes('aria-label="右栏"'), 'the shipped Conversation header keeps the right-column toggle')
  assert.ok(!markup.includes('aria-label="视图切换"'), 'the two-segment switch is gone')
  assert.ok(markup.includes('data-target="conversation"'), 'the single button points back to the Conversation')
  assert.ok(markup.includes('aria-label="收起对话树栏，会话恢复整宽"'), 'the accessible name states the action')
  assert.ok(markup.includes('title="收起对话树栏，会话恢复整宽"'), 'the hover title keeps exactly the same wording')
  /* The band's occurrence is the icon-only box the band's chrome row asks for
     (`ViewToggle` 的 `compact` 形态，见 src/client/ViewToggle.tsx 顶部说明)：可见
     文案让位给那个 28×28 的座位，动作名仍留在 aria-label/title 上。带内其它地方不会
     出现 `>收起</span>`——「显示更多／收起」是按钮文案（`>收起</button>`），所以下面
     那条负断言仍然有效。 */
  assert.ok(markup.includes('class="cm-view-toggle cm-view-toggle--icon"'), 'the band renders the icon-only variant of the one shared control')
  assert.ok(!markup.includes('cm-view-toggle-label'), 'the band box draws no label span at all')
  assert.ok(!markup.includes('>收起</span>'), 'the band box drops the visible copy it no longer needs')
  assert.ok(!markup.includes('>会话</span>'), 'the band no longer names a destination that is already on screen')
  assert.match(
    markup,
    /class="cm-band-head-row"><button type="button" class="cm-view-toggle cm-view-toggle--icon"/,
    'the collapse control is the head row\'s first control while the shell seat is not narrowed',
  )
  assert.ok(markup.indexOf('cm-view-toggle') < markup.indexOf('cm-space-btn'), 'the view button leads the band head')
  assert.ok(!markup.includes('aria-label="返回会话"'), 'leaving is the same button, not a separate exit control')
})

test('the catalog pull is demoted into the top-bar overflow menu', () => {
  const withRefresh = render(store(MAP, view({ openSessionId: 's1' })), {
    services: {
      sessions: { refresh() {} },
      workspaces: workspaces(),
    },
  })
  assert.ok(withRefresh.includes('aria-label="更多操作"'), 'the top bar offers its overflow entry')
  assert.ok(!withRefresh.includes('aria-label="同步会话"'), 'the maintenance action no longer takes a first-level seat')
  assert.ok(!withRefresh.includes('>刷新会话列表<'), 'the action stays inside the closed menu')
  const withoutRefresh = render(store(MAP, view({ openSessionId: 's1' })))
  assert.ok(!withoutRefresh.includes('aria-label="更多操作"'), 'no empty overflow without a catalog to pull')
})

test('without an open conversation the band keeps only the single view button', () => {
  const markup = render(store(MAP, view({ openSessionId: null })))
  assert.ok(!markup.includes('aria-label="左栏"'), 'the band never draws a left-column control')
  assert.ok(!markup.includes('aria-label="右栏"'), 'the shipped Conversation header owns the right-column toggle')
  assert.ok(markup.includes('aria-label="收起对话树栏，会话恢复整宽"'), 'the view button is the way back in every state')
  assert.ok(markup.includes('data-target="conversation"'), 'the band button points at the Conversation')
  assert.ok(!markup.includes('aria-label="返回会话"'), 'leaving through a separate exit button is gone')
})

/**
 * With the fallback frame the shell still owns the only new-session button.
 *
 * `renderToStaticMarkup` never runs layout effects, so every render here sees
 * the hook's fallback frame (`seatWidth: 0`, see `split-frame.ts`). That is
 * exactly the state the guard in `MapPanel` protects: the band may draw its own
 * 「新建会话」 only after *measuring* that the shell's second seat button is
 * really gone, because the shell's published clearance is a hardcoded constant
 * and mounting the seat + hiding its button are two independent facts. The
 * negative case is the one worth pinning — the screen must never carry two
 * new-session buttons — so the band markup carries none and the shell's is the
 * one left on screen.
 *
 * The positive branch (a measured seat of 28px, i.e. `0 < seatWidth <= 32`)
 * cannot be reached from this harness: the hook is imported by `MapPanel`
 * itself rather than injected through props, and a static render has no DOM for
 * it to measure. The boxes that branch draws are pinned in `styles.test.mjs`.
 */
test('without a measured narrowed seat the band draws no new-session button', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })))
  // Count the controls themselves, never the words: the phrase may also sit in
  // copy that is not a button (a title or tooltip, say), and a
  // full-text scan cannot tell that apart from a second entry. The band's own
  // two facts are the box it would draw (`.cm-lead-icon`) and the accessible
  // name it would give it (`aria-label`, i.e. `common.newSession`).
  const leadIcons = (markup.match(/class="cm-lead-icon"/g) ?? []).length
  const namedButtons = (markup.match(/aria-label="新建会话"/g) ?? []).length
  assert.equal(leadIcons, 0, 'the band does not claim the shell seat before measuring it')
  assert.equal(namedButtons, 0, 'the shell keeps the only 新建会话 while its seat is unmeasured')
  assert.equal(
    leadIcons + namedButtons,
    0,
    'the band adds no second new-session entry: the screen shows exactly the shell\'s one',
  )
})

/**
 * An unmeasured frame starts the band at the Conversation header's own inset.
 *
 * This is the reachable one of `split-frame.ts`'s three inset cases: nothing is
 * published (`--dsh-frame-leading-clearance` is unreadable before layout) and no
 * seat is measured, so `leadingInset` returns its 20px floor, which the panel
 * hands to CSS as `--cm-band-inset`. The seat-intact case (160) and the
 * narrowed-seat case (124 = seat right 116 + 8) both need a live
 * `getComputedStyle` against a mounted `[data-shell-leading]`, which a static
 * render cannot provide.
 *
 * They are NOT covered by any automation today. `scripts/uitest.mjs` predates
 * this round and asserts none of `--cm-band-inset`, `cm-lead-icon` or the seat
 * width, so nothing fails if either number drifts. A real-machine pass (map
 * band on screen, macOS desktop branch so the seat is mounted) should add:
 * (1) `--cm-band-inset` is 160px while the seat is intact; (2) once the hide
 * rule lands and the seat measures 28px, `--cm-band-inset` is 124px,
 * `.cm-lead-icon` is visible, and `[data-shell-leading]` holds exactly one
 * button; (3) the band's collapse control keeps the same anchored x in both.
 */
test('an unmeasured frame starts the band at the conversation inset floor', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })))
  assert.match(markup, /style="[^"]*--cm-band-inset:20px/, 'the fallback frame leaves the Conversation header\'s own inset')
  assert.match(markup, /style="[^"]*top:0;/, 'the band starts at its measured box, not at the overlay layer edge')
  assert.match(
    markup,
    /style="[^"]*--cm-band-window-gutter:0px/,
    'an unmeasured frame must not reserve the window-edge gutter: FALLBACK_FRAME.left is 0, so a gutter that forgot `ready` would indent the first column and then snap back',
  )
  assert.ok(!markup.includes('--cm-band-inset:160px'), 'the published clearance is not assumed when it cannot be read')
  assert.ok(!markup.includes('--cm-band-inset:124px'), 'and the narrowed-seat inset is never assumed before measurement')
})

/**
 * The window-edge gutter is a measured fact, not a platform guess.
 *
 * The rule is "the band's left edge is the frame's left edge", which is exactly
 * `frame.left === 0` in the overlay layer's coordinates — the state map mode
 * puts macOS and Windows desktop in after the shell's left column collapses to
 * zero width. It is deliberately not a platform/`data-sidebar-collapsed` test:
 * the Web client keeps a 56px rail when collapsed, so its band's left edge is a
 * seam, and indenting from the seam would push its first column off the rail.
 * `FALLBACK_FRAME` also has `left: 0`, so `ready` gates the first paint.
 */
test('the window-edge gutter exists only while the band owns the frame left edge', () => {
  /** A measured frame; the fields the gutter does not read keep the fallback. */
  const frame = (overrides = {}) => ({
    ready: true,
    left: 0,
    top: 0,
    centerWidth: 900,
    headerHeight: 76,
    headTop: 10,
    headHeight: 30,
    inset: 20,
    seatWidth: 0,
    ...overrides,
  })

  assert.equal(WINDOW_EDGE_GUTTER, 6, '6px completes the shell sidebar\'s 12px window padding over the column\'s own 6px pill inset')
  assert.equal(windowEdgeGutter(frame({ left: 0 })), 6, 'macOS/Windows desktop with the left column hidden: the band owns the frame edge')
  assert.equal(windowEdgeGutter(frame({ left: 0.4 })), 6, 'a rounded sub-pixel frame edge is still the frame edge')
  assert.equal(windowEdgeGutter(frame({ left: 56 })), 0, 'the Web 56px rail puts a seam to the band\'s left, not the window')
  assert.equal(windowEdgeGutter(frame({ left: 240 })), 0, 'an expanded left column is a seam too')
  assert.equal(windowEdgeGutter(frame({ ready: false })), 0, 'an unmeasured first paint keeps the shipped geometry')
})

/**
 * The strip's start fade is a browser reading, not a render.
 *
 * The panel writes `data-scrolled` straight to the strip once columns leave the
 * start side, so the stylesheet can fade the cut without a re-render; the
 * server renderer measures nothing and therefore renders no hook. The pure
 * reading is what this test can pin: the shell's 1px tolerance means a
 * sub-pixel scroll position is still rest, and only the start side is read —
 * the end side's cut lands on the band's seam, where the hairline and the
 * resize handle already state the boundary.
 */
test('the strip\'s start fade begins only after a whole pixel of scroll', () => {
  assert.equal(scrolledFromStart({ scrollLeft: 0 }), false, 'at rest there is no cut to fade')
  assert.equal(scrolledFromStart({ scrollLeft: 1 }), false, 'a sub-pixel scroll position is not a scroll')
  assert.equal(scrolledFromStart({ scrollLeft: 1.5 }), true, 'past one whole pixel the start side is cut')
  assert.equal(scrolledFromStart({ scrollLeft: 318 }), true, 'the reading does not lift once the strip is scrolled far')

  const markup = render(store(undefined, undefined))
  assert.ok(markup.includes('cm-node-area'), 'the strip is rendered on the server')
  assert.equal(markup.includes('data-scrolled'), false, 'the fade is a browser reading: no hook is rendered without a measurement')
})

/**
 * The band's box is measured against the frame-wide overlay layer.
 *
 * macOS/Web: the overlay starts at the frame's edge and so does the Conversation
 * column, so the two coordinate systems agree and the old numbers are unchanged.
 * Windows desktop: the shell keeps its caption row in the frame's padding, while
 * the overlay still spans the frame's border box — the Conversation column (and
 * with it the band) starts below the overlay's top edge. Measuring `left` from
 * the layer but `top` from the conversation would shift every band row up by the
 * caption-row height; both offsets come from `overlayOffset` instead.
 */
test('the band box is measured in the overlay layer, including the Windows caption row', () => {
  assert.deepEqual(overlayOffset({ left: 0, top: 0 }, { left: 56, top: 0 }), { left: 56, top: 0 })
  assert.deepEqual(overlayOffset({ left: 0, top: 0 }, { left: 56, top: 40 }), { left: 56, top: 40 })
  assert.deepEqual(overlayOffset({ left: 10.4, top: 2.6 }, { left: 66.6, top: 62.6 }), { left: 56, top: 60 })
})

/* ── subagent navigation ────────────────────────────────────────────────── */

/** The lineage of a subagent child of s1, as the catalog reports it. */
const SUBAGENT_LINEAGE = {
  s1: { displayTitle: '第一条对话' },
  child: { displayTitle: '子智能体', origin: 'subagent', parentId: 's1' },
}

/** The Host accounting of the spaces fixture, as the panel reads it. */
const SPACES_OWNERS = new Map([['s1', 'w1'], ['s3', 'w2']])

test('opening a subagent lands on its parent row without leaving the space', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, SUBAGENT_LINEAGE, SPACES_OWNERS, 'child', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w1' }),
  )
  assert.equal(landed.openSessionId, 'child', 'the pane still names the conversation being read')
  assert.equal(landed.activeSpace, 'sp-work', 'the space does not move')
  assert.equal(landed.selectedNodeId, 'n1', 'the highlight is the parent topic')
  const markup = render(store(SPACES_MAP, landed))
  assert.match(markup, /class="cm-node-row"[^>]*data-node-id="n1"[^>]*data-selected="true"/)
  assert.ok(!markup.includes('子智能体'), 'no row is invented for the child')
})

test('a subagent draws its parent\'s identity marks in the tree', () => {
  // The pane names the child, but the tree has no row for one: it marks the
  // parent conversation as the conversation being read, so every identity mark
  // (the one solid row, the home anchor, the home chain) is what the parent
  // itself would draw. Attention badges are the one thing that deliberately
  // does not follow — they keep watching the Session that is really open (pinned
  // by "reading a subagent keeps its parent's attention badge"); this fixture
  // has no status source, so the whole tree still matches.
  const landed = followNativeNavigation(
    SPACES_MAP, SUBAGENT_LINEAGE, SPACES_OWNERS, 'child', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w1' }),
  )
  const catalog = { ids: [...CATALOG.ids, 'child'], byId: { ...CATALOG.byId, ...SUBAGENT_LINEAGE } }
  const useCatalog = selector => selector(catalog)
  const markup = render(store(SPACES_MAP, landed), { useSessions: useCatalog })
  assert.match(
    markup,
    /class="cm-thread-row"[^>]*data-session-id="s1"[^>]*data-selected="true"/,
    'the parent conversation row is the one being read',
  )
  assert.match(
    markup,
    /class="cm-thread-row"[^>]*data-session-id="s1"[^>]*aria-current="page"/,
    'and the only current page in the column',
  )
  assert.equal((markup.match(/data-session-home="true"/g) ?? []).length, 1, 'the parent home keeps the anchor')
  assert.match(
    markup,
    /class="cm-node-row"[^>]*data-node-id="n1"[^>]*data-session-path="true"/,
    'the parent home and its Workspace stay on the home chain',
  )
  const asParent = render(store(SPACES_MAP, { ...landed, openSessionId: 's1' }), { useSessions: useCatalog })
  assert.equal(markup, asParent, 'with no status source, the tree is the tree the parent itself would draw')
  assert.equal(landed.openSessionId, 'child', 'while the pane and the view still name the subagent')
})

test('a subagent never pulls the reader into another space', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, SUBAGENT_LINEAGE, SPACES_OWNERS, 'child', 'sp-family',
    view({ activeSpace: 'sp-family', selectedNodeId: '@ws:w2' }),
  )
  assert.equal(landed.activeSpace, 'sp-family', 'the reader keeps the space they chose')
  assert.equal(landed.selectedNodeId, 'n1', 'the parent row is still the destination')
  const markup = render(store(SPACES_MAP, landed))
  assert.ok(markup.includes('家庭空间'), 'the band still names the space the reader chose')
})

test('a loose parent takes its own space along', () => {
  const lineage = {
    s2: { displayTitle: '散落对话' },
    child: { displayTitle: '子智能体', origin: 'subagent', parentId: 's2' },
  }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, SPACES_OWNERS, 'child', 'sp-family',
    view({ activeSpace: 'sp-family', selectedNodeId: '@ws:w2' }),
  )
  assert.equal(landed.activeSpace, 'sp-work', 'an ungrouped parent is followed to its own space')
  assert.equal(landed.selectedNodeId, '@loose:sp-work', 'and to its ungrouped row')
  assert.equal(landed.openSessionId, 'child')
})

test('a subagent whose parent the catalog cannot name holds the reader place', () => {
  const start = view({ activeSpace: 'sp-family', selectedNodeId: '@ws:w2' })
  const landed = followNativeNavigation(
    SPACES_MAP,
    { orphan: { displayTitle: '子智能体', origin: 'subagent', parentId: 'gone' } },
    new Map(), 'orphan', 'sp-family', start,
  )
  assert.equal(landed.activeSpace, 'sp-family')
  assert.equal(landed.selectedNodeId, '@ws:w2')
  assert.equal(landed.openSessionId, 'orphan', 'only the open conversation follows')
})

test('a cyclic parent chain cannot move the map either', () => {
  const lineage = {
    a: { displayTitle: '子智能体甲', origin: 'subagent', parentId: 'b' },
    b: { displayTitle: '子智能体乙', origin: 'subagent', parentId: 'a' },
  }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, new Map(), 'a', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w1' }),
  )
  assert.equal(landed.activeSpace, 'sp-work')
  assert.equal(landed.selectedNodeId, '@ws:w1')
  assert.equal(landed.openSessionId, 'a')
})

test('an ordinary conversation still takes the map to its own space', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, { s3: { displayTitle: '第三条对话' } }, SPACES_OWNERS, 's3', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: 'n1' }),
  )
  assert.equal(landed.activeSpace, 'sp-family', 'a filed conversation switches the space')
  assert.equal(landed.selectedNodeId, '@ws:w2')
  assert.equal(landed.openSessionId, 's3')
})

test('a fork that is not indexed yet lands on its source topic', () => {
  // The branch action opens the child before the catalog pass that files it has
  // run, so the map has no row for the fork yet; its catalog row already names
  // the source, and the index files the branch there a moment later.
  const lineage = {
    s1: { displayTitle: '第一条对话' },
    fork: { displayTitle: '第一条对话 (1)', parentId: 's1' },
  }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, SPACES_OWNERS, 'fork', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: '@ws:w1' }),
  )
  assert.equal(landed.openSessionId, 'fork', 'the pane names the conversation being read')
  assert.equal(landed.activeSpace, 'sp-work', 'the source topic keeps the space the reader is in')
  assert.equal(landed.selectedNodeId, 'n1', 'the highlight lands on the source topic, not the Workspace row')
})

test('a fork of a conversation in another space takes that space', () => {
  const lineage = {
    s3: { displayTitle: '第三条对话' },
    fork: { displayTitle: '第三条对话 (1)', parentId: 's3' },
  }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, SPACES_OWNERS, 'fork', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: 'n1' }),
  )
  assert.equal(landed.activeSpace, 'sp-family', 'the source conversation’s space is followed')
  assert.equal(landed.selectedNodeId, '@ws:w2', 'and the source’s home row')
})

test('a fork whose source nothing can name falls back to its own accounted Workspace', () => {
  const lineage = { fork: { displayTitle: '无源分支', parentId: 'ghost' } }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, new Map([['fork', 'w1']]), 'fork', 'sp-family',
    view({ activeSpace: 'sp-family', selectedNodeId: '@ws:w2' }),
  )
  assert.equal(landed.activeSpace, 'sp-work', 'the accounted Workspace is followed')
  assert.equal(landed.selectedNodeId, '@ws:w1')
})

test('a fork does not treat a subagent parent as a destination', () => {
  const lineage = {
    child: { displayTitle: '子智能体', origin: 'subagent', parentId: 's1' },
    fork: { displayTitle: '子会话分支', parentId: 'child' },
  }
  const landed = followNativeNavigation(
    SPACES_MAP, lineage, new Map([['fork', 'w1']]), 'fork', 'sp-work',
    view({ activeSpace: 'sp-work', selectedNodeId: 'n1' }),
  )
  assert.equal(landed.selectedNodeId, '@ws:w1', 'the subagent has no row to land on; the fork falls back to its Workspace')
})

/* ── the tree's position is derived from the open conversation ──────────── */

test('the tree lands on the open conversation’s ungrouped row', () => {
  const landed = followSessionHome(
    SPACES_MAP,
    view({ openSessionId: 's2', selectedNodeId: '@ws:w2', activeSpace: 'sp-family' }),
    'sp-family',
  )
  assert.equal(landed.activeSpace, 'sp-work', 'the conversation’s own space')
  assert.equal(landed.selectedNodeId, '@loose:sp-work', 'and its ungrouped row')
})

test('the tree stays put when it already names the home', () => {
  const start = view({ openSessionId: 's1', selectedNodeId: 'n1', activeSpace: 'sp-work' })
  assert.equal(followSessionHome(SPACES_MAP, start, 'sp-work'), start, 'same object: no re-render')
})

test('a browse is left alone', () => {
  const browsing = view({ openSessionId: 's1', selectedNodeId: '@ws:w1', activeSpace: 'sp-work', browsing: true })
  assert.equal(followSessionHome(SPACES_MAP, browsing, 'sp-work'), browsing, 'the reader’s excursion is not stolen')
})

test('nothing open, or a conversation the index does not know, leaves the tree alone', () => {
  const idle = view({ openSessionId: null, selectedNodeId: 'n1', activeSpace: 'sp-work' })
  assert.equal(followSessionHome(SPACES_MAP, idle, 'sp-work'), idle)
  const pending = view({ openSessionId: 'not-indexed', selectedNodeId: 'n1', activeSpace: 'sp-work' })
  assert.equal(followSessionHome(SPACES_MAP, pending, 'sp-work'), pending)
})

test('external navigation to an ungrouped conversation lands on its ungrouped row', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, CATALOG, SPACES_OWNERS, 's2', 'sp-family',
    view({ selectedNodeId: '@ws:w2', activeSpace: 'sp-family' }),
  )
  assert.equal(landed.activeSpace, 'sp-work')
  assert.equal(landed.selectedNodeId, '@loose:sp-work')
  assert.equal(landed.openSessionId, 's2')
})

test('a conversation event ends the reader’s browse', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, CATALOG, SPACES_OWNERS, 's3', 'sp-work',
    view({ selectedNodeId: 'n1', activeSpace: 'sp-work', browsing: true }),
  )
  assert.equal(landed.browsing, false, 'the tree follows again')
  assert.equal(landed.selectedNodeId, '@ws:w2')
})

test('landing on an ungrouped conversation draws only the Workspace column', () => {
  const landed = followNativeNavigation(
    SPACES_MAP, CATALOG, SPACES_OWNERS, 's2', 'sp-family',
    view({ selectedNodeId: '@ws:w2', activeSpace: 'sp-family' }),
  )
  const markup = render(store(SPACES_MAP, landed))
  assert.equal(columnCount(markup), 1, 'the ungrouped row is a conversation list, not a container')
  const row = rowMarkup(markup, 'ungrouped')
  assert.ok(row.includes('data-row-key="@loose:sp-work"'), 'it is the conversation\'s own space bucket')
  assert.ok(row.includes('data-selected="true"'), 'and the tree stands on it')
})

test('a manual row move browses unless it lands on the home row', () => {
  assert.equal(browsingForRow(SPACES_MAP, 's1', 'n1'), false, 'the home row ends the browse')
  assert.equal(browsingForRow(SPACES_MAP, 's1', '@ws:w2'), true)
  assert.equal(browsingForRow(SPACES_MAP, null, 'n1'), false, 'nothing open is no browse')
})

test('a manual space switch browses unless it returns to the home space', () => {
  assert.equal(browsingForSpace(SPACES_MAP, 's1', 'sp-work'), false)
  assert.equal(browsingForSpace(SPACES_MAP, 's1', 'sp-family'), true)
  assert.equal(browsingForSpace(SPACES_MAP, null, 'sp-family'), false)
})

/* ── moving a conversation to another node (「移动到…」) ───────────────────── */

/** Parse one fixture into the document the pure helpers read. */
function doc(map) {
  return ensureDefaultSpace(parseMapState(JSON.stringify(map)))
}

/** The conversation row of one fixture. */
function threadOf(map, sessionId) {
  const found = doc(map).threads.find(thread => thread.sessionId === sessionId)
  assert.notEqual(found, undefined, `the ${sessionId} conversation is in the fixture`)
  return found
}

/** The node of one fixture. */
function nodeOf(map, nodeId) {
  const found = doc(map).nodes.find(node => node.id === nodeId)
  assert.notEqual(found, undefined, `the ${nodeId} node is in the fixture`)
  return found
}

/** The topics fixture with its direct conversation accounted to the same Workspace. */
const SHORTCUT_MAP = {
  ...MAP,
  threads: MAP.threads.map(thread =>
    thread.sessionId === 's3' ? { ...thread, workspaceId: 'w1' } : thread),
}

/** A conversation row the map refuses to move: a recorded subagent child. */
const SUBAGENT_THREAD_MAP = {
  ...MAP,
  subagentSessionIds: ['child'],
  threads: [
    ...MAP.threads,
    {
      sessionId: 'child', nodeId: null, workspaceId: 'w1', origin: 'subagent',
      title: '子智能体', updatedAt: ago(1), importedAt: '',
    },
  ],
}

/*
 * The `⋯` menu is state-driven, so `renderToStaticMarkup` can never open it.
 * What the menu *decides* is therefore a pure function on purpose, and that is
 * what these cases pin: which entries exist and which note replaces a shortcut.
 */

test('a conversation menu offers the one-step move and nothing that depends on the selection', () => {
  const state = doc(SHORTCUT_MAP)
  assert.deepEqual(
    threadMenuModel(state, threadOf(SHORTCUT_MAP, 's1'), t),
    { move: true, notice: null },
    'a filed conversation offers the picker and nothing else (BL-1: its Workspace row is in the picker)',
  )
  for (const gone of ['quickTarget', 'unassign']) {
    assert.ok(
      !(gone in threadMenuModel(state, threadOf(SHORTCUT_MAP, 's1'), t)),
      `the ${gone} entry is gone from the model, so no render path can reach it`,
    )
  }
  assert.deepEqual(
    threadMenuModel(state, threadOf(SHORTCUT_MAP, 's3'), t),
    { move: true, notice: null },
    'an unfiled conversation is offered the same single entry, with nothing to explain',
  )
})

test('the resting band offers no shortcut or unfile entry at all', () => {
  const markup = render(store(SHORTCUT_MAP, view({ selectedNodeId: 'n2', openSessionId: 's3' })))
  assert.ok(!markup.includes('关联到'), 'the shortcut is gone from the panel, not merely hidden by a state')
  assert.ok(!markup.includes('移出节点'), 'and so is the unfile entry, which the picker now covers (BL-1)')
})

test('a subagent row offers no move of its own and says why', () => {
  const state = doc(SUBAGENT_THREAD_MAP)
  const recorded = threadMenuModel(state, threadOf(SUBAGENT_THREAD_MAP, 'child'), t)
  assert.deepEqual(recorded, { move: false, notice: '子智能体会话由它的父对话带出来，不能单独移动。' })

  const byOrigin = { ...state, subagentSessionIds: [] }
  assert.equal(
    threadMenuModel(byOrigin, threadOf(SUBAGENT_THREAD_MAP, 'child'), t).move,
    false,
    'the catalog origin alone is enough while the ledger is not written yet',
  )

  const filedChild = { ...state, threads: state.threads.map(thread => thread.sessionId === 'child' ? { ...thread, nodeId: 'n1' } : thread) }
  const filed = threadMenuModel(filedChild, filedChild.threads.find(thread => thread.sessionId === 'child'), t)
  assert.equal(filed.move, false, 'a filed subagent row is offered nothing either — the model refuses that write')
  assert.match(filed.notice, /子智能体/, 'and it still says what it is')
})

/** Two Workspaces with one topic each: a selection that must not travel. */
const TWO_WORKSPACE_MAP = {
  version: 2,
  revision: 1,
  nodes: [
    { id: 'a1', parentId: null, workspaceId: 'w1', title: '甲的节点', description: '', position: 1, updatedAt: '' },
    { id: 'b1', parentId: null, workspaceId: 'w2', title: '乙的节点', description: '', position: 1, updatedAt: '' },
  ],
  threads: [
    { sessionId: 'sa', nodeId: 'a1', workspaceId: 'w1', title: '甲的对话', updatedAt: ago(1), importedAt: '' },
    { sessionId: 'sb', nodeId: null, workspaceId: 'w2', title: '乙的散落对话', updatedAt: ago(1), importedAt: '' },
    { sessionId: 'sc', nodeId: 'b1', workspaceId: 'w2', title: '乙的对话', updatedAt: ago(2), importedAt: '' },
  ],
}

test('the picker starts on the selected topic, then on the conversation own home', () => {
  const state = doc(TWO_WORKSPACE_MAP)
  assert.equal(
    threadMoveDefault(state, threadOf(TWO_WORKSPACE_MAP, 'sb'), nodeOf(TWO_WORKSPACE_MAP, 'b1')),
    'b1',
    'a selected topic of its own Workspace is the default — the old shortcut, now visible in the picker',
  )
  assert.equal(
    threadMoveDefault(state, threadOf(TWO_WORKSPACE_MAP, 'sc'), nodeOf(TWO_WORKSPACE_MAP, 'a1')),
    'b1',
    'a topic of another Workspace is ignored: the conversation starts on its own node',
  )
  assert.equal(
    threadMoveDefault(state, threadOf(TWO_WORKSPACE_MAP, 'sb'), undefined),
    '',
    'with nothing selected an unfiled conversation starts on the Workspace row',
  )
  assert.equal(
    threadMoveDefault(state, threadOf(TWO_WORKSPACE_MAP, 'sa'), undefined),
    'a1',
    'and a filed one starts on its own node',
  )
})

test('a destination the model refuses is never the default', () => {
  assert.equal(
    threadMoveDefault(doc(SPACES_MAP), threadOf(SPACES_MAP, 's2'), nodeOf(SPACES_MAP, 'u1')),
    '',
    'the legacy rootless topic of another space is skipped, so the picker never opens on a disabled option',
  )
})

test('the move picker lists the Workspace row first, then every node of that Workspace', () => {
  assert.deepEqual(threadMoveOptions(doc(MAP), 's1', 'w1', t), [
    { value: '', label: '（工作区顶层）', disabled: false },
    { value: 'n1', label: '外贸探索', disabled: false },
    { value: 'n2', label: '外贸探索 / 获客方式', disabled: false },
  ], 'the Workspace row leads, and every destination carries its full path')
})

test('a Workspace with no nodes still offers the Workspace row', () => {
  const empty = { version: 2, revision: 1, nodes: [], threads: [] }
  assert.deepEqual(threadMoveOptions(doc(empty), 's1', 'w1', t), [
    { value: '', label: '（工作区顶层）', disabled: false },
  ], 'a conversation can always be left directly under its Workspace')
})

test('the picker offers only the conversation own Workspace, and disables what the model would refuse', () => {
  const options = threadMoveOptions(doc(SPACES_MAP), 's2', null, t)
  assert.deepEqual(options.map(option => option.value), ['', 'u1'], 'the ungrouped bucket lists only its own legacy topics')
  assert.ok(!options.some(option => option.value === 'n1'), 'another Workspace node is never offered')
  assert.equal(options[1].disabled, true, 'a loose conversation of another space cannot file itself in a default-space topic')
})

test('the move picker renders the destinations as a foldable tree, on the current home', () => {
  const markup = renderToStaticMarkup(createElement(MoveThreadField, {
    state: doc(MAP), sessionId: 's1', workspaceId: 'w1', value: 'n2', onChange: () => {},
  }))
  assert.match(markup, /class="cm-move-tree"/, 'the picker is the tree the sheet styles')
  assert.match(markup, /role="tree"/, 'and it announces itself as one')
  assert.match(markup, /id="cm-move-thread-target"[^>]*aria-labelledby="cm-move-thread-label"/, 'named by its own label')
  assert.match(markup, /class="cm-move-tree-row"[^>]*role="treeitem"[^>]*data-depth="0"/, 'the Workspace row leads at depth 0')
  assert.match(markup, /data-depth="2"[^>]*data-selected="true"/, 'and the conversation current home is the selected row')
  assert.match(markup, /data-depth="0"[^>]*data-selected="false"/, 'the Workspace row is not selected while the conversation sits deeper')
  assert.match(markup, /--cm-move-depth/, 'each row carries its own depth for the sheet to indent by')
  assert.ok(markup.includes('（工作区顶层）'), 'the Workspace row is always offered')
  assert.ok(markup.includes('外贸探索'), 'along with the Workspace topics')

  const deep = renderToStaticMarkup(createElement(MoveThreadField, {
    state: doc(MAP), sessionId: 's1', workspaceId: 'w1', value: 'n1', onChange: () => {},
  }))
  assert.match(deep, /data-depth="1"[^>]*data-selected="true"/, 'a top-level topic sits at depth 1 and is selected when it is the home')
  assert.match(deep, /data-depth="2"[^>]*>[\s\S]{0,220}?获客方式/, 'its child sits one level deeper')
  assert.match(deep, /class="cm-move-tree-toggle"[^>]*data-expanded="true"/, 'a row with children offers a toggle, expanded by default')
})

test('a destination the model refuses is rendered unselectable', () => {
  const markup = renderToStaticMarkup(createElement(MoveThreadField, {
    state: doc(SPACES_MAP), sessionId: 's2', workspaceId: null, value: '', onChange: () => {},
  }))
  assert.match(markup, /data-depth="1"[^>]*aria-disabled="true"[^>]*data-disabled="true"/, 'the refused target says so to CSS and to assistive tech')
  assert.ok(markup.includes('历史无主主题'), 'and stays visible, so the limit can be seen')
  assert.match(markup, /data-depth="0"[^>]*data-selected="true"/, 'the Workspace row stays selectable')
})

test('confirming the home a conversation already has changes nothing, and any other value commits it', () => {
  const state = doc(MAP)
  assert.equal(threadMoveIsNoop(state, 's1', 'n1'), true, 'n1 is where s1 already sits')
  assert.equal(threadMoveIsNoop(state, 's1', ''), false, 'the Workspace row is a real destination for a filed conversation')
  assert.equal(threadMoveIsNoop(state, 's3', ''), true, 'an unfiled conversation already sits on its Workspace row')
  assert.equal(threadMoveIsNoop(state, 'gone', ''), false, 'an unknown conversation is not silently "already there"')
})

test('the confirmed move writes the new node and leaves the conversation itself alone', () => {
  const state = doc(MAP)
  const before = threadOf(MAP, 's1')
  const moved = threadMoveChange('s1', 'n2')(state)
  const after = moved.threads.find(thread => thread.sessionId === 's1')
  assert.equal(after.nodeId, 'n2', 'the conversation moves to the chosen node')
  assert.equal(after.updatedAt, before.updatedAt, 'moving does not restamp the conversation')
  assert.equal(moved.threads.find(thread => thread.sessionId === 's2').nodeId, null, 'other conversations stay put')
  assert.equal(
    threadMoveChange('s1', '')(state).threads.find(thread => thread.sessionId === 's1').nodeId,
    null,
    'the picker empty value is the Workspace row',
  )
})

test('the move dialog is not part of the resting band', () => {
  const markup = render(store(MAP, view({ openSessionId: 's1' })))
  assert.ok(!markup.includes('cm-move-thread-target'), 'the picker is state-driven, not always mounted')
  assert.ok(!markup.includes('移动对话'), 'and its title only exists while it is open')
})

/* ── pointer drag: identities, decisions, and the visuals they carry ─────── */

test('every draggable row carries the identity the hit test reads', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.ok(markup.includes('data-node-id="n1"'), 'a topic row names itself')
  assert.ok(markup.includes('data-node-workspace-id="w1"'), 'and the Workspace it belongs to')
  assert.ok(markup.includes('data-row-key="@ws:w1"'), 'a Workspace row answers to its selection key')
  assert.ok(markup.includes('data-session-id="s1"'), 'a conversation row names its session')
  assert.ok(markup.includes('data-parent-node-id="n1"'), 'and the topic it is filed under')
  assert.ok(markup.includes('data-dragging="false"'), 'no row is dragged at rest')
  assert.ok(markup.includes('data-parent-workspace-id="w2"'), 'a Workspace-level conversation names its Workspace')
})

test('the group wrapper is the drop target, and it names its column', () => {
  const markup = renderToStaticMarkup(createElement(NodeColumnView, columnProps()))
  assert.match(markup, /class="cm-node-group"[^>]*data-group-key="node:n1"/, 'the wrapper is the group and keeps a stable key')
  assert.match(markup, /data-group-kind="node"/, 'the group states what kind of header it has')
  assert.match(markup, /data-group-column-key="L2"/, 'and which column it lives in')
  assert.match(markup, /data-group-node-id="n1"/, 'a topic group names its node')
  assert.match(markup, /data-group-workspace-id="w1"/, 'and the Workspace the hit test must agree with')
  assert.match(markup, /data-drop-group="none"/, 'at rest no group is a target')
  assert.ok(!/class="cm-node-row"[^>]*data-drop=/.test(markup), 'rows no longer carry a drop mark of their own')
  assert.ok(markup.includes('data-parent-workspace-id="w1"'), 'the conversation row carries its topic\'s Workspace (F0)')
})

test('a group owns its conversation rows and its footer', () => {
  const row = {
    ...DRAG_COLUMN.rows[0],
    threadFooter: createElement('button', { type: 'button', className: 'cm-more-row' }, '显示更多'),
  }
  const markup = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    column: { ...DRAG_COLUMN, rows: [row] },
  })))
  const group = markup.indexOf('data-group-key="node:n1"')
  const conversation = markup.indexOf('data-session-id="s1"')
  const footer = markup.indexOf('cm-more-row')
  assert.ok(group !== -1 && conversation !== -1 && footer !== -1, 'the group, its conversation and its footer all render')
  assert.ok(group < conversation && conversation < footer, 'both live inside the group, in reading order')
  assert.equal(markup.split('data-group-key="node:n1"').length - 1, 1, 'one group wrapper, no accidental duplicate')

  const collapsed = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    column: { ...DRAG_COLUMN, rows: [{ ...row, collapsed: true }] },
  })))
  assert.match(collapsed, /data-group-key="node:n1"[^>]*data-group-collapsed="true"/, 'a collapsed group says so')
  assert.ok(!collapsed.includes('data-session-id="s1"'), 'and renders only its header: the block is exactly the header')
})

test('a topic group paints the whole block, and the line lands on the group edge', () => {
  const target = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'valid', dropGroupMode: 'into',
  })))
  assert.match(target, /data-group-key="node:n1"[^>]*data-drop-group="valid"/, 'the whole group is the target')
  assert.match(target, /data-drop-mode="into"/, 'and its intent is into the topic')
  assert.match(target, /background:color-mix\(in srgb, var\(--dsw-alias-brand-primary/, 'the group card is tinted')
  assert.match(target, /box-shadow:inset 0 0 0 1px color-mix/, 'with one inner ring around the block')
  assert.ok(!target.includes('data-insert'), 'an into target promises no sibling slot')

  const reorder = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'valid', dropGroupMode: 'after', insertEdge: 'after',
  })))
  assert.match(reorder, /data-drop-mode="after"/, 'a group-edge drop keeps its mode')
  assert.match(reorder, /data-insert="after"/, 'and draws the line on the group boundary')
  assert.match(reorder, /height:2px/, 'two pixels, as designed')
  assert.match(reorder, /pointer-events:none/, 'the line never takes the pointer it reports')

  const refused = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'invalid',
  })))
  assert.match(refused, /data-drop-group="invalid"/, 'a refused group still names the target')
  assert.ok(!refused.includes('background:color-mix'), 'but is not tinted: the label carries the reason')
  assert.ok(!refused.includes('data-insert'), 'and no insertion line is promised')
})

test('only a decision with a real move becomes a plan', () => {
  const state = doc(MAP)
  assert.deepEqual(
    planFromDecision({ action: { kind: 'thread', sessionId: 's1', nodeId: 'n2' }, issue: null, noop: false, label: 'x' }),
    { kind: 'thread', sessionId: 's1', nodeId: 'n2' },
  )
  assert.equal(planFromDecision({ action: null, issue: null, noop: true, label: '位置不变' }), null, 'a no-op commits nothing')
  assert.equal(
    planFromDecision({ action: null, issue: { code: 'WORKSPACE', message: '不' }, noop: false, label: '不' }),
    null,
    'a refused drop commits nothing — the label is the whole feedback',
  )
  const moved = applyDragPlan(state, { kind: 'thread', sessionId: 's1', nodeId: 'n2' })
  assert.equal(moved.threads.find(thread => thread.sessionId === 's1').nodeId, 'n2', 'a conversation plan files it')
  const slotted = applyDragPlan(state, { kind: 'node', nodeId: 'n2', parentId: null, beforeNodeId: null })
  assert.equal(slotted.nodes.find(node => node.id === 'n2').parentId, null, 'a topic plan re-parents it')
})

test('a one-shot flag is taken exactly once', () => {
  const flag = { pending: false }
  assert.equal(consumeOneShot(flag), false, 'nothing to consume while it is clear')
  flag.pending = true
  assert.equal(consumeOneShot(flag), true, 'the click that follows the drag is eaten')
  assert.equal(consumeOneShot(flag), false, 'and no later click is')
})

/** One fabricated column: a topic with a conversation under it. */
const DRAG_COLUMN = {
  key: 'L2',
  title: 'L2',
  rows: [{
    id: 'n1', title: '外贸探索', kind: 'node', childCount: 0, tools: true, collapsed: false,
    workspaceId: 'w1',
    threads: [{ sessionId: 's1', title: '第一条对话', time: '2 小时', workspaceId: 'w1' }],
  }],
}

/** The view props one fabricated column needs. */
function columnProps(extra = {}) {
  return {
    column: DRAG_COLUMN,
    width: 220,
    selectedNodeId: null,
    openSessionId: null,
    menuRowId: null,
    onSelectNode: () => {},
    onOpenThread: () => {},
    onNewThread: () => {},
    onToggleNode: () => {},
    onMenu: () => {},
    ...extra,
  }
}

test('the drop marks are group-level, and the insertion line sits on the group boundary', () => {
  const before = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'valid', dropGroupMode: 'before', insertEdge: 'before',
  })))
  assert.match(before, /data-insert="before"/, 'the line is drawn on the edge the pointer chose')
  assert.match(before, /height:2px/, 'two pixels, as designed')
  assert.match(before, /position:absolute/, 'inside the group, so it spans the block width')
  assert.match(before, /pointer-events:none/, 'the line never takes the pointer it reports')
  assert.match(before, /data-drop-group="valid"/, 'the target group is lit as one block')
  assert.match(before, /data-drop-mode="before"/, 'with the boundary intent it carries')

  const after = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'valid', dropGroupMode: 'after', insertEdge: 'after',
  })))
  assert.match(after, /data-insert="after"/, 'the other boundary draws its own line')
  assert.ok(!/class="cm-thread-row"[^>]*data-drop=/.test(after), 'no conversation row is marked as the target')

  const noLine = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'valid', dropGroupMode: 'into',
  })))
  assert.ok(!noLine.includes('data-insert'), 'a conversation payload draws no line: conversations are not sorted by hand')
})

test('a dragged conversation dims its row; a dragged topic dims its whole group', () => {
  const thread = renderToStaticMarkup(createElement(NodeColumnView, columnProps({ draggingKey: 's1' })))
  assert.match(thread, /data-session-id="s1"[^>]*data-dragging="true"/, 'the conversation row is the source')
  assert.match(thread, /data-dragging="true"[^>]*opacity:0.45/, 'the source row steps back while its copy follows the pointer')
  assert.ok(!/class="cm-node-row"[^>]*data-dragging=/.test(thread), 'the topic row is not dimmed for a conversation drag')

  const topic = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    draggingGroupKey: 'node:n1',
  })))
  assert.match(topic, /data-group-key="node:n1"[^>]*data-dragging-group="true"/, 'the topic dims its group as one block')
  assert.match(topic, /data-dragging-group="true"[^>]*opacity:0.45/, 'so its conversations read as travelling with it')
})

test('the pointer label says what a release would do, in the decisions own tone', () => {
  const valid = renderToStaticMarkup(createElement(DragLabel, { label: '移到「获客方式」下', tone: 'valid' }))
  assert.match(valid, /data-drag-label="valid"/)
  assert.ok(valid.includes('移到「获客方式」下'), 'the label carries the decision wording')
  assert.match(valid, /pointer-events:none/, 'the label follows the pointer without taking it')
  assert.match(valid, /position:fixed/)
  const invalid = renderToStaticMarkup(createElement(DragLabel, { label: '不能移到别的工作区', tone: 'invalid' }))
  assert.match(invalid, /data-drag-label="invalid"/)
  assert.match(dragLabelStyle('invalid').color, /error/, 'a refused drop reads as a warning')
  assert.match(dragLabelStyle('noop').color, /label-secondary/, 'an unchanged one stays quiet')
  assert.match(dragLabelStyle('valid').color, /brand-primary/, 'a real move reads as the action it is')
})

/* ── P2: hysteresis, auto scroll, spring loading, view follow, wording ───── */

test('a pointer that leaves every row keeps the last candidate, held', () => {
  assert.equal(heldOverlay(null), null, 'nothing to hold before a row was ever reached')
  const live = { label: '移到「获客方式」下', tone: 'valid', groupKey: 'node:n2', mode: 'into', insertEdge: null, held: false }
  assert.deepEqual(heldOverlay(live), { ...live, held: true }, 'the candidate stays, marked as held')
  const held = heldOverlay(live)
  assert.equal(heldOverlay(held), held, 'holding an already held candidate writes nothing new, so no frame re-renders')
})

test('a held group is drawn as a hint, and its insertion line stays', () => {
  const markup = renderToStaticMarkup(createElement(NodeColumnView, columnProps({
    dropGroupKey: 'node:n1', dropGroupState: 'held', dropGroupMode: 'before', insertEdge: 'before',
  })))
  assert.match(markup, /data-drop-group="held"/, 'the group is still the candidate (U3)')
  assert.match(markup, /outline:1px dashed/, 'drawn as a hint rather than a live target')
  assert.match(markup, /data-insert="before"/, 'and the line it was showing stays where it was')
})

test('auto scroll ramps in from the edge and only inside the dead zone', () => {
  assert.equal(autoScrollStep(500, 100, 900), 0, 'the middle of a strip never scrolls itself')
  assert.ok(autoScrollStep(105, 100, 900) < 0, 'the leading edge scrolls back')
  assert.ok(autoScrollStep(895, 100, 900) > 0, 'the trailing edge scrolls on')
  assert.equal(AUTO_SCROLL_EDGE_PX, 18, 'the dead zone the reader aims into')
  const shallow = Math.abs(autoScrollStep(100 + AUTO_SCROLL_EDGE_PX - 2, 100, 900))
  const deep = Math.abs(autoScrollStep(101, 100, 900))
  assert.ok(deep > shallow, 'the deeper into the zone, the faster the scroll')
  assert.equal(deep, AUTO_SCROLL_MAX_PX, 'a pointer pressed against the edge scrolls fastest')
  assert.equal(autoScrollStep(150, 100, 110), 0, 'a strip narrower than its two dead zones cannot be aimed at')
})

test('only a topic whose next column is missing springs open', () => {
  const state = doc(MAP)
  assert.equal(springLoadTarget(state, 'n1', false), true, 'n1 has a child and no column of its own yet')
  assert.equal(springLoadTarget(state, 'n1', true), false, 'its child column is already on screen')
  assert.equal(springLoadTarget(state, 'n2', false), false, 'a leaf has nothing to open')
  assert.equal(SPRING_LOAD_MS, 600, 'the rest the pointer must hold first')
})

test('a landed move brings its row, its column and the highlight along', () => {
  const state = doc(MAP)
  assert.deepEqual(
    followAfterMove(state, { kind: 'thread', sessionId: 's1', nodeId: 'n2' }, { openSessionId: 's1' }),
    { focusKey: 's1', expandKey: 'n2', selectedNodeId: 'n2' },
    'the conversation that was being read keeps naming itself in the highlight',
  )
  assert.deepEqual(
    followAfterMove(state, { kind: 'thread', sessionId: 's1', nodeId: 'n2' }, { openSessionId: 's3' }),
    { focusKey: 's1', expandKey: 'n2', selectedNodeId: null },
    'moving a conversation the reader is not reading leaves the selection alone',
  )
  assert.deepEqual(
    followAfterMove(state, { kind: 'thread', sessionId: 's1', nodeId: null }, { openSessionId: 's1' }),
    { focusKey: 's1', expandKey: '@ws:w1', selectedNodeId: '@ws:w1' },
    'filing one under its Workspace row unfolds and selects that row',
  )
  assert.deepEqual(
    followAfterMove(state, { kind: 'node', nodeId: 'n2', parentId: null, beforeNodeId: null }, { openSessionId: null }),
    { focusKey: 'n2', expandKey: null, selectedNodeId: null },
    'a moved topic needs its new parent unfolded, and nobody else moves',
  )
})

test('a refused move is restated in the reader own vocabulary', () => {
  assert.equal(
    moveFailureMessage(t, new MapError('NOT_FOUND', '节点已不存在，请刷新。')),
    '目标节点已不存在，本次移动没有生效。',
  )
  assert.equal(moveFailureMessage(t, new MapError('DEPTH', '最多支持 12 层。')), '这次移动会让层级超过 12 层。')
  assert.equal(moveFailureMessage(t, new MapError('ANCHOR', '锚点不在目标位置下')), '插入位置已失效，请重试。')
  assert.equal(moveFailureMessage(t, new MapError('WORKSPACE', '不能把节点移动到其他工作区的节点下。')), '不能移到别的工作区。')
  assert.equal(moveFailureMessage(t, new MapError('CYCLE', '不能移到自己下面。')), '不能移到自己下面。', 'an unmapped refusal keeps the model wording')
  assert.equal(moveFailureMessage(t, new Error('boom')), 'boom', 'a transport failure is not flattened into a move message')
})

/* ── D9: where a node lands among its siblings ──────────────────────────── */

test('the position picker lists the siblings a node can go in front of', () => {
  const state = doc(MAP)
  assert.deepEqual(
    siblingTargets(state, null, 'w1', 'n1').map(node => node.id),
    [],
    'a node is never offered as its own anchor',
  )
  const siblings = siblingTargets(doc(SHORTCUT_MAP), null, 'w1', 'n1')
  assert.ok(siblings.every(node => workspaceOfNode(node) === 'w1' || node.workspaceId === 'w1'), 'only its own Workspace')
  const markup = renderToStaticMarkup(createElement(NodePositionField, {
    state: doc(MAP), parentId: null, workspaceId: 'w1', selfId: 'n1', value: '', onChange: () => {},
  }))
  assert.match(markup, /id="cm-node-position"[^>]*class="cm-select"|class="cm-select"[^>]*id="cm-node-position"/, 'the shipped select style is reused')
  assert.match(markup, /<option value=""[^>]*>放到最后<\/option>/, 'the default anchor is the end of the list')
  assert.ok(!markup.includes('放到「外贸探索」之前'), 'the node itself is not a candidate')
  const twoSiblings = {
    ...MAP,
    nodes: [
      ...MAP.nodes,
      { id: 'n3', parentId: null, workspaceId: 'w1', title: '第二个顶层节点', description: '', position: 2, updatedAt: '' },
    ],
  }
  const withSiblings = renderToStaticMarkup(createElement(NodePositionField, {
    state: doc(twoSiblings), parentId: null, workspaceId: 'w1', selfId: 'n1', value: '', onChange: () => {},
  }))
  assert.ok(withSiblings.includes('放到「第二个顶层节点」之前'), 'a sibling is offered as an anchor')
})

/* ── BL-2/BL-3: the tree, as data and as markup ─────────────────────────── */

test('the move tree keeps the document shape: the Workspace row, then topics by depth', () => {
  const rows = moveTreeRows(doc(MAP), 's1', 'w1', t)
  assert.deepEqual(
    rows.map(row => [row.key, row.depth, row.hasChildren]),
    [['', 0, false], ['n1', 1, true], ['n2', 2, false]],
    'the Workspace row leads at depth 0, and each topic follows its parent',
  )
  assert.equal(rows[0].label, '（工作区顶层）', 'the root row is named by the model')
  assert.equal(rows[0].nodeId, null)
  assert.ok(rows.every(row => row.disabled === false), 'every destination of its own Workspace is available')

  const refused = moveTreeRows(doc(SPACES_MAP), 's2', null, t)
  assert.deepEqual(refused.map(row => [row.key, row.depth, row.disabled]), [['', 0, false], ['u1', 1, true]])
})

test('folding a branch hides its subtree, and the cursor steps over refusals', () => {
  const rows = moveTreeRows(doc(MAP), 's1', 'w1', t)
  assert.deepEqual(
    visibleTreeRows(rows, new Set(['n1'])).map(row => row.key),
    ['', 'n1'],
    'folding n1 hides n2 and nothing else',
  )
  assert.deepEqual(visibleTreeRows(rows, new Set()).map(row => row.key), ['', 'n1', 'n2'])
  assert.equal(treeStep(rows, 0, 1), 1, 'down moves one row')
  assert.equal(treeStep(rows, 0, -1), 0, 'up at the top stays put')
  assert.equal(treeStep(rows, 2, 1), 2, 'down at the end stays put')
  const withRefusal = rows.map(row => row.key === 'n1' ? { ...row, disabled: true } : row)
  assert.equal(treeStep(withRefusal, 0, 1), 2, 'a refused row is stepped over, never landed on')
})

test('the move dialog is the marked one', () => {
  assert.equal(dialogClass({ kind: 'move-thread' }), 'cm-dialog cm-dialog--move', 'BL-2: the card says which dialog it is')
  assert.equal(dialogClass({ kind: 'node' }), 'cm-dialog')
  assert.equal(dialogClass({ kind: 'thread-space' }), 'cm-dialog')
  assert.equal(dialogClass({ kind: 'node-delete', nodeId: 'n1', title: 'x' }), 'cm-dialog', 'the delete confirmation is a plain card')
})

test('only the five one-line dialogs commit on Enter', () => {
  for (const kind of ['node', 'workspace-create', 'workspace-rename', 'space-create', 'space-rename']) {
    assert.equal(enterCommits(kind), true, `${kind} has a one-line input and commits`)
  }
  // The textarea's dialog keeps Enter for line breaks, the pickers and the move
  // tree consume it natively, and the three delete confirmations hold no input:
  // Enter must never confirm them.
  for (const kind of ['workspace-delete', 'space-delete', 'node-delete', 'move-thread', 'workspace-space', 'thread-space']) {
    assert.equal(enterCommits(kind), false, `${kind} must not commit on Enter`)
  }
})

test('an Enter commits unless an IME or Shift owns it', () => {
  assert.equal(commitsOnEnter({ key: 'Enter' }), true, 'a plain Enter commits')
  assert.equal(commitsOnEnter({ key: 'Enter', shiftKey: true }), false, 'Shift+Enter stays a line break')
  assert.equal(
    commitsOnEnter({ key: 'Enter', nativeEvent: { isComposing: true } }),
    false,
    'the IME keeps the Enter that confirms its candidate',
  )
  assert.equal(commitsOnEnter({ key: 'Enter', keyCode: 229 }), false, 'legacy IME reporting is guarded too')
  assert.equal(commitsOnEnter({ key: 'a' }), false)
  assert.equal(commitsOnEnter({ key: 'Escape' }), false)
  assert.equal(
    commitsOnEnter({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } }),
    true,
    'a finished composition does not block the next Enter',
  )
})


test('a node row rolls up its own conversations and every descendant', () => {
  const ledger = createStatusLedger({ now: () => Date.now() })
  const statuses = { s1: { pendingInteraction: { kind: 'approval' } }, s3: { completionUnread: true } }
  ledger.observe(new Map(Object.entries(statuses)), ['s1', 's2', 's3'])
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus(statuses),
    services: { statusLedger: ledger },
  })
  assert.ok(markup.includes('class="cm-rollup"'), 'the rollup badge is rendered')
  assert.ok(markup.includes('aria-label="会话状态：1 条待响应（含全部下游节点）"'), 'n1 reports the pending conversation')
  assert.ok(markup.includes('aria-label="会话状态：1 条已完成（含全部下游节点）"'), 'beta reports its direct completed conversation')
  assert.ok(markup.includes('data-cat="pending"'), 'the pending dot is present')
  assert.ok(markup.includes('data-cat="done"'), 'the done dot is present')
})

test('the open conversation is not counted in the attention rollup', () => {
  const statuses = { s1: { pendingInteraction: { kind: 'approval' } } }
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })), {
    useSessionStatus: useStatus(statuses),
  })
  assert.ok(!markup.includes('cm-rollup'), 'the only conversation is open, so no row needs a badge')
})

test('reading a subagent keeps its parent\'s attention badge', () => {
  // The tree's identity marks name the parent row as the one being read (see
  // "a subagent draws its parent's marks"), but the attention rollup keeps
  // reading the Session that is really open: a parent whose turn finished, or
  // which asks for an answer, must still be able to remind the reader while its
  // subagent is in front. Only the *parent being open* is exempt — its own
  // attention is already on screen.
  const statuses = { s1: { completionUnread: true } }
  const catalog = {
    ids: [...CATALOG.ids, 'child'],
    byId: { ...CATALOG.byId, child: { displayTitle: '子智能体', origin: 'subagent', parentId: 's1' } },
  }
  const readingParent = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })), {
    useSessionStatus: useStatus(statuses),
  })
  assert.ok(!readingParent.includes('cm-rollup'), 'the open parent\'s attention is already in front of the reader')

  const readingChild = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 'child' })), {
    useSessionStatus: useStatus(statuses),
    useSessions: selector => selector(catalog),
  })
  assert.match(readingChild, /data-session-home="true"/, 'the tree still marks the parent as the place being read')
  assert.ok(readingChild.includes('class="cm-rollup"'), 'the parent\'s completion still reaches the tree')
  assert.ok(readingChild.includes('data-cat="done"'), 'and it stays in the completed category')
})

test('a narrow column drops the counts and keeps the dots', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', columnWidths: [180] })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'question' } } }),
  })
  const firstRow = markup.slice(markup.indexOf('data-kind="workspace"'), markup.indexOf('data-kind="node"'))
  assert.ok(firstRow.includes('cm-rollup-dots'), 'the L1 row is narrow and uses the dot-only mark')
  assert.ok(!firstRow.includes('cm-rollup-stat'), 'no counts on the narrow row')
})

test('a row that reports a status gives its trailing slot to the badge, not the count', () => {
  // MAP files s1 under n1, and n1 is the only top-level node of Workspace alpha:
  // both rows roll the conversation up and both have children, so both used to
  // draw "1  ⟳1" — two bare numbers the reader could read as one quantity.
  const running = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { running: true } }),
  })
  assert.ok(running.includes('class="cm-rollup"'), 'the running conversation is reported')
  assert.ok(!running.includes('cm-child-count'), 'the running badge takes the slot from the descendant count')

  const pending = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { pendingInteraction: { kind: 'approval' } } }),
  })
  assert.ok(pending.includes('class="cm-rollup"'), 'a pending conversation is reported too')
  assert.ok(!pending.includes('cm-child-count'), 'any category takes the slot, not only running')
})

test('the badge and the descendant count share one slot, keyed to what is drawn', () => {
  const counts = { pending: 0, error: 0, done: 0, running: 0 }
  const idle = { counts, direct: counts, total: 0, attention: 0 }
  assert.equal(showsStatusRollup(undefined), false, 'no status source draws no badge')
  assert.equal(showsStatusRollup(idle), false, 'a subtree with nothing in flight draws no badge')
  assert.equal(
    showsStatusRollup({ ...idle, counts: { ...counts, running: 1 }, total: 1 }),
    true,
    'one running conversation is enough to draw a badge',
  )
})

test('an idle row keeps the product’s descendant count', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: { running: false } }),
  })
  assert.ok(!markup.includes('cm-rollup'), 'an idle subtree needs no badge')
  assert.ok(markup.includes('class="cm-child-count"'), 'so the descendant count stays exactly as before')
})

test('without a status source the rows stay exactly as before', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })))
  assert.ok(!markup.includes('cm-rollup'), 'no rollup markup is invented without Session status')
  assert.ok(markup.includes('class="cm-child-count"'), 'and the descendant count is still the row’s only number')
})


test('a forwarded error is counted until the conversation is opened', () => {
  const ledger = createStatusLedger({ now: () => Date.now() })
  ledger.observe(new Map([['s1', {}]]), ['s1', 's2', 's3'])
  ledger.observeError('s1')
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: {} }),
    services: { statusLedger: ledger },
  })
  assert.ok(markup.includes('aria-label="会话状态：1 条异常（含全部下游节点）"'), 'the node shows the failed conversation')
  const opened = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })), {
    useSessionStatus: useStatus({ s1: {} }),
    services: { statusLedger: ledger },
  })
  assert.ok(!opened.includes('cm-rollup'), 'opening it clears the attention count')
})


test('a completion the product cannot mark shows on its node row until opened', () => {
  // The product never flags its main view as unread; the sidebar row holds the
  // stop in the shared ledger, and the tree draws it exactly like any other
  // unread completion (completion-watch.ts).
  const ledger = createStatusLedger({ now: () => Date.now() })
  ledger.observe(new Map([['s1', {}]]), ['s1', 's2', 's3'])
  ledger.setCompletions(new Map([['s1', Date.now()]]))
  const markup = render(store(MAP, view({ selectedNodeId: 'n1' })), {
    useSessionStatus: useStatus({ s1: {} }),
    services: { statusLedger: ledger },
  })
  assert.ok(
    markup.includes('aria-label="会话状态：1 条已完成（含全部下游节点）"'),
    'the held completion is a normal done mark on the tree',
  )
  assert.ok(markup.includes('data-cat="done"'), 'with the green dot the rows already use')
  const opened = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })), {
    useSessionStatus: useStatus({ s1: {} }),
    services: { statusLedger: ledger },
  })
  assert.ok(!opened.includes('cm-rollup'), 'opening the conversation clears the mark')
})

test('opening one conversation does not hide other completed conversations', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })), {
    useSessionStatus: useStatus({
      s1: { pendingInteraction: { kind: 'approval' } },
      s3: { completionUnread: true },
    }),
  })
  assert.ok(markup.includes('aria-label="会话状态：1 条已完成（含全部下游节点）"'),
    'beta keeps its completed conversation while another conversation is open')
  assert.ok(!markup.includes('1 条待响应'), 'the open pending conversation stays excluded')
})

test('a space row shows its status badge in place of the workspace count', () => {
  const counts = { pending: 1, error: 0, done: 2, running: 1 }
  const rollup = { counts, direct: { ...counts }, total: 4, attention: 3 }
  const markup = renderToStaticMarkup(createElement(SpaceMenuTrailing, { rollup, workspaceCount: 6 }))
  assert.ok(markup.includes('class="cm-rollup"'), 'the space carries the same status mark as a node row')
  assert.ok(markup.includes('data-cat="pending"') && markup.includes('data-cat="done"'), 'with one dot per category')
  assert.ok(
    markup.includes('aria-label="会话状态：1 条待响应，2 条已完成，1 条运行中（该空间全部会话）"'),
    'the accessible name names the space scope',
  )
  assert.ok(!markup.includes('cm-space-count'), 'the status badge takes the single trailing slot')
})

test('an idle space keeps the product’s workspace count', () => {
  const markup = renderToStaticMarkup(createElement(SpaceMenuTrailing, { workspaceCount: 6 }))
  assert.ok(markup.includes('class="cm-space-count"'), 'no status, so the shipped count stays')
  assert.ok(markup.includes('title="6 个工作区"'), 'with the same tooltip it always had')
  assert.ok(!markup.includes('cm-rollup'), 'and no empty badge is invented')
})

test('a zero rollup from an empty status pass falls back to the workspace count', () => {
  const counts = { pending: 0, error: 0, done: 0, running: 0 }
  const rollup = { counts, direct: { ...counts }, total: 0, attention: 0 }
  const markup = renderToStaticMarkup(createElement(SpaceMenuTrailing, { rollup, workspaceCount: 2 }))
  assert.ok(markup.includes('cm-space-count'), 'the count remains the row’s number')
})

/**
 * The search view's rendering contract: a hit may carry a second line (its
 * context path or a match snippet), the keyboard cursor is drawn on exactly one
 * row, and the synthetic 「匹配的对话」 group is a heading rather than a node.
 */
test('the search column renders hit notes, one cursor row, and a non-selectable group heading', () => {
  const column = {
    key: 'search',
    title: '搜索结果（2）',
    rows: [
      {
        id: 'n1', title: '外贸探索', kind: 'node', childCount: 0, tools: false, collapsed: false,
        workspaceId: 'w1', threads: [], note: '外贸工作区 · 从零起步',
      },
      {
        id: '@matches', title: '匹配的对话', kind: 'node', childCount: 0, tools: false, collapsed: false,
        selectable: false,
        threads: [{ sessionId: 's1', title: '第一条对话', time: '', workspaceId: 'w1', note: '…关键词…' }],
      },
    ],
  }
  const markup = renderToStaticMarkup(createElement(NodeColumnView, columnProps({ column, activeRowKey: 'n1' })))
  assert.match(markup, /data-note="true"/, 'rows carrying a note advertise the second line')
  assert.match(markup, /class="cm-row-note"/, 'the note renders under the title')
  assert.equal(markup.split('data-search-active="true"').length - 1, 1, 'only the cursor row is marked')
  assert.match(markup, /data-node-id="n1"[^>]*data-search-active="true"/, 'the cursor sits on the navigable hit')
  assert.match(markup, /data-node-id="@matches"[^>]*data-selectable="false"/, 'the group heading is not selectable')
  assert.match(markup, /…关键词…/, 'the conversation snippet is rendered too')
})

test('the create dialog states its location as a read-only chain, never a picker', () => {
  const ancestors = [
    { id: 'n1', workspaceId: 'w1', parentId: null, position: 1, title: '外贸探索', description: '' },
    { id: 'n2', workspaceId: 'w1', parentId: 'n1', position: 1, title: '获客方式', description: '' },
  ]
  const markup = renderToStaticMarkup(createElement(NodeLocationRail, { workspaceLabel: 'alpha', ancestors }))
  assert.match(markup, /class="cm-loc-rail"[^>]*role="group"/, 'the rail is a group with its own accessible name')
  assert.match(markup, /alpha/, 'the Workspace root is named')
  assert.match(markup, /外贸探索/, 'the grandparent stays visible')
  assert.match(markup, /获客方式/, 'the parent stays visible')
  assert.match(markup, /aria-label="将创建在 alpha \/ 外贸探索 \/ 获客方式"/, 'the accessible name carries the full path')
  assert.doesNotMatch(markup, /<select/, 'the rail is not a picker')
  assert.doesNotMatch(markup, /新节点/, 'the redundant create-target hint is gone')
  assert.doesNotMatch(markup, /焦点|tabindex/, 'the read-only rail never enters the Tab order')

  const top = renderToStaticMarkup(createElement(NodeLocationRail, { workspaceLabel: 'alpha', ancestors: [] }))
  assert.match(top, /aria-label="将创建在 alpha 工作区顶层"/, 'top-level create names the Workspace top level')
  assert.doesNotMatch(top, /新节点/, 'top-level create carries no extra target hint either')
})

test('create requires a non-blank title and says 创建; edit still says 保存', () => {
  assert.equal(nodeTitleIssue(''), 'required', 'an empty title blocks creation')
  assert.equal(nodeTitleIssue('   '), 'required', 'a whitespace-only title blocks creation')
  assert.equal(nodeTitleIssue('首屏加载优化'), null, 'a real title passes')
  const createDraft = { kind: 'node', workspaceId: 'w1', parentId: null, title: '', description: '' }
  assert.equal(dialogPrimaryLabel(t, createDraft), '创建', 'the create dialog creates')
  assert.equal(dialogPrimaryLabel(t, { ...createDraft, id: 'n1', title: '已有节点' }), '保存', 'the edit dialog saves')
  assert.equal(dialogPrimaryLabel(t, { kind: 'workspace-create', path: '' }), '创建', 'other create dialogs are unchanged')
  assert.equal(dialogPrimaryLabel(t, { kind: 'node-delete', nodeId: 'n1', title: '外贸探索' }), '删除', 'delete dialogs keep their verb')
})

/** {@link MAP} plus one archived block (a1 > a2) and one independently archived conversation. */
const ARCHIVE_MAP = {
  version: 2,
  revision: 3,
  nodes: [
    { id: 'n1', parentId: null, workspaceId: 'w1', title: '外贸探索', description: '', position: 1, updatedAt: '' },
    { id: 'n2', parentId: 'n1', workspaceId: 'w1', title: '获客方式', description: '', position: 1, updatedAt: '' },
    {
      id: 'a1', parentId: null, workspaceId: 'w1', title: '旧项目', description: '', position: 2, updatedAt: '',
      archivedAt: '2026-10-01T00:00:00.000Z', archivedParentId: 'n1',
    },
    { id: 'a2', parentId: 'a1', workspaceId: 'w1', title: '旧方案', description: '', position: 1, updatedAt: '' },
  ],
  threads: [
    { sessionId: 's1', nodeId: 'n1', workspaceId: 'w1', title: '第一条对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's2', nodeId: null, workspaceId: null, title: '散落对话', updatedAt: ago(2), importedAt: '' },
    { sessionId: 's3', nodeId: null, workspaceId: 'w2', title: '第三条对话', updatedAt: ago(1), importedAt: '' },
    { sessionId: 'sa1', nodeId: 'a1', workspaceId: 'w1', title: '归档内的对话', updatedAt: ago(1), importedAt: '' },
    {
      sessionId: 'sa2', nodeId: 'n1', workspaceId: 'w1', title: '单独归档的对话', updatedAt: ago(1), importedAt: '',
      archivedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
}

test('the archive row is a fixed footer of the Workspace topic column', () => {
  const markup = render(store(ARCHIVE_MAP, view({ selectedNodeId: '@ws:w1' })))
  assert.equal(columnCount(markup), 2, 'the Workspace column and its topic column')
  assert.match(markup, /class="cm-col-footer"/, 'the archive row sits outside the scrolling rows')
  assert.match(markup, /data-kind="archive"/, 'it is the synthetic archive row')
  assert.match(markup, /data-row-key="@archive:w1"/, 'its selection key names the Workspace')
  assert.match(markup, />已归档</, 'the row is named')
  assert.match(markup, /title="已归档 2 条会话 · 1 个主题"/, 'the count is conversations, with topics in the tooltip')
  assert.ok(!markup.includes('旧项目'), 'archived content stays out of the active columns until the row is opened')
})

test('an empty archive still offers the row, with an empty-state tooltip', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:w1' })))
  assert.match(markup, /data-kind="archive"/, 'the row is fixed even with nothing put away')
  assert.match(markup, /title="归档旧的节点或会话后会出现在这里"/, 'it says how it fills up')
})

test('selecting the archive row opens the archive column: blocks then standalone conversations', () => {
  const markup = render(store(ARCHIVE_MAP, view({ selectedNodeId: '@archive:w1' })))
  assert.equal(columnCount(markup), 3, 'Workspace column, topic column, archive column')
  assert.match(markup, /class="cm-col-title" title="L3"/, 'the archive column is one level deeper')
  assert.match(markup, /旧项目/, 'the archived block root is listed')
  assert.ok(!markup.includes('旧方案'), 'the block is not flattened: its child comes with the block, not beside it')
  assert.match(markup, /已归档会话/, 'independently archived conversations get their own group')
  assert.match(markup, /单独归档的对话/, 'and their title is listed')
  assert.match(markup, /data-group-archived="true"/, 'archived rows are marked for the drag hit test')
})

test('selecting an archived topic unfolds through the archive, and archived topics grow no topics', () => {
  const markup = render(store(ARCHIVE_MAP, view({ selectedNodeId: 'a1' })))
  assert.equal(columnCount(markup), 4, "Workspace, topics, archive, then the archived block's children")
  assert.match(markup, /class="cm-col-title" title="L4"/, "the block's children sit below the archive column")
  assert.match(markup, /旧方案/, "the archived block's child is listed")
  assert.equal((markup.match(/class="cm-col-actions"/g) ?? []).length, 2, 'only the active columns offer adding')
  assert.match(markup, /data-selected="true"[^>]*data-node-id="a1"|data-node-id="a1"[^>]*data-selected="true"/, 'the archived node carries the selection')
})

test('the archive row offers no start action and no menu', () => {
  // The footer is the last thing in the two-column view (the archive column is
  // closed), so the slice from it to the end is exactly one row.
  const markup = render(store(ARCHIVE_MAP, view({ selectedNodeId: '@ws:w1' })))
  const footer = markup.slice(markup.indexOf('class="cm-col-footer"'))
  assert.ok(footer.includes('data-kind="archive"'), 'the footer is the archive row')
  assert.ok(!footer.includes('aria-label="发起对话"'), 'the archive never starts conversations')
  assert.ok(!footer.includes('aria-label="更多操作"'), 'the archive row has no menu of its own')
})

test('archiving keeps the reader’s row; only a selection inside the block moves up', () => {
  assert.equal(selectionAfterArchive(MAP, 'n2', null), null, 'no selection stays no selection')
  assert.equal(selectionAfterArchive(MAP, 'n2', 'n1'), 'n1', 'another row keeps its selection')
  assert.equal(selectionAfterArchive(MAP, 'n2', 'n2'), 'n1', 'the archived child hands the cursor to its parent')
  assert.equal(selectionAfterArchive(MAP, 'n1', 'n1'), '@ws:w1', 'an archived root hands the cursor to its Workspace row')
})

test('an empty archive row opens no empty column and is not a selection target', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@archive:w1' })))
  assert.equal(columnCount(markup), 2, 'no empty third column is drawn for an empty archive')
  const footer = markup.slice(markup.indexOf('class="cm-col-footer"'))
  assert.match(footer, /data-row-key="@archive:w1"[\s\S]{0,1600}?data-selectable="false"/,
    'the placeholder row is not a selectable container')
})

test('a row title lives in full in the label, with no native tooltip to double it', () => {
  const markup = render(store(MAP, view({ selectedNodeId: 'n1', openSessionId: 's1' })))
  assert.match(markup, /class="cm-row-label">外贸探索</, 'the full title is the label text, so the hover tip has words to show')
  assert.match(markup, /class="cm-row-label">第一条对话</)
  /* The archive footer is the one exception: its native title is an explanation
     of the row, not the row's own clipped label, so it must survive. */
  const rows = [...markup.matchAll(/<div class="cm-node-row"[^>]*>/g)].map(match => match[0])
  assert.ok(rows.length > 0, 'the fixture renders node rows')
  assert.ok(
    rows.filter(row => !row.includes('data-kind="archive"')).every(row => !row.includes(' title="')),
    'an ordinary node row must not fall back to the browser tooltip',
  )
  const threads = [...markup.matchAll(/<div class="cm-thread-row"[^>]*>/g)].map(match => match[0])
  assert.ok(threads.length > 0 && threads.every(row => !row.includes(' title="')), 'a conversation row neither')
  assert.ok(!markup.includes('class="cm-tip"'), 'the bubble only exists while a clipped row is hovered')
})

test('the archive row keeps its native explanatory title', () => {
  const markup = render(store(MAP, view({ selectedNodeId: '@ws:w1' })))
  const footer = markup.slice(markup.indexOf('class="cm-col-footer"'))
  assert.match(footer, /data-kind="archive"[^>]*title="归档旧的节点或会话后会出现在这里"/,
    'the system row still explains itself with the browser tooltip')
})

test('a clipped title tip opens below its row and stays inside the window', () => {
  const viewport = { width: 1200, height: 900 }
  const below = titleTipPlacement(
    { left: 120, top: 200, right: 340, bottom: 234 },
    { width: 260, height: 26 },
    viewport,
  )
  assert.deepEqual(below, { left: 120, top: 240, side: 'bottom' }, 'there is room below the row, so the bubble drops')
})

test('a title tip near the right edge is pulled left to keep its gutter', () => {
  const at = titleTipPlacement(
    { left: 1000, top: 200, right: 1180, bottom: 234 },
    { width: 260, height: 26 },
    { width: 1200, height: 900 },
  )
  assert.equal(at.left, 928, 'the bubble right edge stops at the 12px window gutter')
})

test('a title tip with no room below flips above its row', () => {
  const at = titleTipPlacement(
    { left: 120, top: 846, right: 340, bottom: 880 },
    { width: 260, height: 26 },
    { width: 1200, height: 900 },
  )
  assert.deepEqual(at, { left: 120, top: 814, side: 'top' }, 'the bubble opens upward instead of running off screen')
})

test('a title tip wider than the window stays pinned at the gutter', () => {
  const at = titleTipPlacement(
    { left: 2, top: 100, right: 180, bottom: 134 },
    { width: 900, height: 40 },
    { width: 800, height: 900 },
  )
  assert.equal(at.left, 12, 'a clamped bubble keeps the left gutter rather than sliding off screen')
  assert.equal(at.top, 140, 'and still drops below its row')
})
