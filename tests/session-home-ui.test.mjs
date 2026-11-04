/**
 * Render tests for the session-home surfaces of the map (A′).
 *
 * The approved A′ design answers one question — "where does what I type
 * belong?" — with two surfaces and no in-band chip:
 *
 * - the tree marks the open conversation's home row with a filled folder
 *   (`MapPanel` through `Columns`), and keeps the home's whole chain as a
 *   `data-session-path` attribute (the home chain: filled brand folder + bold
 *   title, no surface; a selected row on the chain keeps it);
 * - the shipped composer gets one read-only 30px context bar
 *   (`HomeNotice`, registered into `conversation.input.dock`, so it is rendered
 *   directly through its own entry): 「当前会话」 badge + the
 *   `space › Workspace › topic › conversation` chain, and nothing else — no
 *   icon, no verdict, no buttons, no dismissal.
 *
 * The band's second row keeps only navigation (space breadcrumb + on-demand
 * search); the chip it used to carry is gone, and a test below pins that.
 *
 * As in `panel.test.mjs`, `react-dom/server` runs no effects and no layout, so
 * every render sees the server stand-ins and the stubs answer the catalog/
 * Workspace hooks. The context line is read-only, so there are no presses to
 * simulate; the live focus/blur behaviour belongs to `scripts/uitest.mjs`.
 *
 * The expected copy is read from the shipped dictionaries instead of being
 * copied into this file: the assertions are about the wiring and the chain, not
 * about a particular translation.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { HomeNotice } from '../lib/home.js'
import { createTranslator, zh } from '../lib/locales.js'
import { ensureDefaultSpace, parseMapState } from '../lib/model.js'
import { MapPanel } from '../lib/panel.js'
import { createMapViewBridge } from '../lib/view-bridge.js'

/** The simplified Chinese translator the expected copy is read from. */
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

/**
 * The Home's map: alpha owns n1 (holding the open conversation s1) and its child
 * n2 (where the reader has selected instead), beta owns the Workspace-level s3,
 * and s2 floats ungrouped.
 */
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

/**
 * The same map with a sibling topic in alpha.
 *
 * The session-path attribute marks the home row while the selection points at a
 * different branch (the sheet paints the always-on home chain for it — plan A,
 * see `styles.test.mjs`); n3 gives the selection somewhere else to be inside the
 * same Workspace without landing on the home's own lineage.
 */
const PATH_MAP = {
  ...MAP,
  nodes: [
    ...MAP.nodes,
    { id: 'n3', parentId: null, workspaceId: 'w1', title: '渠道复盘', description: '另一条分支', position: 2, updatedAt: '' },
  ],
}

/** An index written before the subagent rule, still carrying a child's row. */
const SUBAGENT_MAP = {
  ...MAP,
  threads: [
    ...MAP.threads,
    { sessionId: 'child', nodeId: 'n1', workspaceId: 'w1', title: '子智能体', updatedAt: ago(1), importedAt: '' },
  ],
}

/** The catalog of {@link SUBAGENT_MAP}: the child reports its lineage. */
const SUBAGENT_CATALOG = {
  ids: [...CATALOG.ids, 'child'],
  byId: {
    ...CATALOG.byId,
    child: { displayTitle: '子智能体', origin: 'subagent', parentId: 's1' },
  },
}

/** Two spaces: beta moved to a second space, the rest stays in the default one. */
const TWO_SPACE_MAP = {
  ...MAP,
  spaces: [
    { id: 'sp-default', title: '@default-space', position: 1, createdAt: '' },
    { id: 'sp-work', title: '商业项目', position: 2, createdAt: '' },
  ],
  defaultSpaceId: 'sp-default',
  spaceOf: { w2: 'sp-work' },
}

/** The Host Workspace list: alpha owns s1, beta owns s3, s2 floats ungrouped. */
const WORKSPACES = {
  phase: 'ready',
  items: [
    { workspaceId: 'w1', path: '/tmp/alpha', title: 'alpha', sessionIds: ['s1'] },
    { workspaceId: 'w2', path: '/tmp/beta', title: 'beta', sessionIds: ['s3'] },
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
    activeSpace: '',
    scroll: [],
    columnWidths: [],
    nodePanelWidth: 300,
    mapWidth: 560,
    ...patch,
  }
}

/** A plain in-memory `KeyValueStore`. */
function memory(entries = {}) {
  const backing = new Map(Object.entries(entries))
  return {
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
}

/** The stubbed Workspace Controller snapshot. */
function workspaces(snapshot = WORKSPACES) {
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
  }
}

/**
 * A ready, in-memory map store over the same backing storage the view uses.
 * Mirrors the fake in `panel.test.mjs`; `MapPanel` reads it through
 * `useSyncExternalStore`, so only the read half has to be live.
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
 * Render the band with framework-shaped stubs.
 * @param map - the conversation-map document.
 * @param storedView - the view document.
 * @param overrides - catalog and service replacements.
 * @returns the static markup.
 */
function renderPanel(map, storedView, overrides = {}) {
  const backing = memory({
    'dsh.conversation-map.v1': JSON.stringify(map),
    'dsh.conversation-map.view.v1': JSON.stringify(storedView),
  })
  const services = {
    sessions: { retain: id => ({ sessionId: id, release() {} }) },
    workspaces: workspaces(),
    store: fakeStore(backing),
    ...overrides.services,
  }
  return renderToStaticMarkup(createElement(MapPanel, {
    storage: backing,
    useSessions: overrides.useSessions ?? (selector => selector(CATALOG)),
    ...overrides.props,
    services,
  }))
}

/** One attribute of an opening tag, decoded enough for this DOM (no entities are expected). */
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return match === null ? null : match[1]
}

/** The band's second row only, so ordering against the breadcrumb is unambiguous. */
function row2Markup(markup) {
  const start = markup.indexOf('class="cm-band-row2"')
  if (start < 0) return ''
  const end = markup.indexOf('</header>', start)
  return markup.slice(start, end < 0 ? undefined : end)
}

/** The opening tags of the rows that carry the home anchor. */
function anchorTags(markup) {
  return [...markup.matchAll(/<div class="cm-node-row"[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => tag.includes('data-session-home="true"'))
}

/** The opening tags of the rows that carry the open conversation's path attribute. */
function pathRowTags(markup) {
  return [...markup.matchAll(/<div class="cm-node-row"[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => tag.includes('data-session-path="true"'))
}

/** The opening tags of the rendered conversation rows. */
function threadRowTags(markup) {
  return [...markup.matchAll(/<div class="cm-thread-row"[^>]*>/g)].map(match => match[0])
}

/**
 * The node row of the map document the panel renders, prepared the way the
 * panel's own mount effect would: the document is parsed and given a default
 * space (the raw document has none).
 * @param document - the fixture.
 * @returns the map state `HomeNotice` reads through its injected store.
 */
function mapStateOf(document) {
  return ensureDefaultSpace(parseMapState(JSON.stringify(document)))
}

/** A collapsible store stand-in for the shared band-collapse switch. */
function collapseStore(hidden) {
  return {
    getSnapshot: () => hidden,
    subscribe: () => () => {},
    set() {},
    toggle() {},
  }
}

/** A single-value observable. */
function staticSource(getSnapshot) {
  return { getSnapshot, subscribe: () => () => {} }
}

/** A fake composer-focus reading, injectable through the notice's `focus` prop. */
function focusSource(focused) {
  return staticSource(() => focused)
}

/**
 * Render the composer-side context line with the slot-shaped injections.
 *
 * The bridge is published before the render, exactly in the order the band does
 * it after mount. The line is read-only, so the bridge carries no actions; the
 * `focus` tracker is optional, and an absent tracker reads as focused (the
 * production fallback and the older render tests both behave that way).
 * @param overrides - fixture/gate replacements.
 * @returns the static markup.
 */
function renderNotice(overrides = {}) {
  const {
    document = MAP,
    published = view({ openSessionId: 's1', selectedNodeId: 'n2' }),
    sessionId = 's1',
    mapVisible = true,
    hidden = false,
    catalog = CATALOG,
    collapse = collapseStore(hidden),
    focus = undefined,
  } = overrides
  const state = mapStateOf(document)
  const bridge = createMapViewBridge(memory())
  bridge.publish(published, mapVisible)
  const services = {
    sessions: {},
    workspaces: workspaces(),
    store: staticSource(() => ({ phase: 'ready', doc: state, revision: 0, pending: 0 })),
  }
  return renderToStaticMarkup(createElement(HomeNotice, {
    services,
    bridge,
    collapsed: collapse,
    ...(focus === undefined ? {} : { focus }),
    sessionId,
    useSessions: selector => selector(catalog),
  }))
}

/** The opening tag of the composer-side context line, or null when absent. */
function homePathTag(markup) {
  const match = /<div[^>]*class="cm-home-path"[^>]*>/.exec(markup)
  return match === null ? null : match[0]
}

/**
 * The visible segment texts of the context line, in order.
 *
 * A segment can carry more than one class (the conversation title is
 * `cm-home-path-seg cm-home-path-thread-seg`), so the class is matched as a
 * token anywhere in the attribute rather than as the whole value. The trailing
 * `\b` keeps the `cm-home-path-segments` group from passing for a segment.
 */
function homePathSegments(markup) {
  return [...markup.matchAll(/<span[^>]*class="[^"]*cm-home-path-seg\b[^"]*"[^>]*>(.*?)<\/span>/gs)]
    .map(match => match[1].replace(/<[^>]*>/g, ''))
}

/** The opening tags of the context line's segments, in order. */
function homePathSegTags(markup) {
  return [...markup.matchAll(/<span[^>]*class="[^"]*cm-home-path-seg\b[^"]*"[^>]*>/g)].map(match => match[0])
}

/* ── the band after A′: the reading chip is gone (MapPanel SSR) ─────────── */

/**
 * A′ removed the band's row-2 chip. The tree's filled home folder already marks
 * where the conversation lives, and the composer-side line carries the chain
 * when the reader is about to type, so the band's second row stays a pure
 * navigation row: the space breadcrumb, plus the search field on demand.
 */
test('the band second row carries no reading chip any more', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: 'n2' }))
  const row2 = row2Markup(markup)
  assert.ok(row2.length > 0, 'the second row is still rendered')
  assert.ok(row2.includes('cm-crumb'), 'the space breadcrumb is still the row\'s navigation')
  assert.equal((row2.match(/cm-home-chip/g) ?? []).length, 0, 'the reading chip is gone from the band')
  assert.equal((row2.match(/cm-home-slot/g) ?? []).length, 0, 'its row-2 seat is gone too')
  assert.equal((row2.match(/data-tier=/g) ?? []).length, 0, 'no density tier is rendered in the row')
  assert.equal((markup.match(/cm-home-chip/g) ?? []).length, 0, 'nothing else in the band draws a chip')
  // The tree may carry the anchor's accessible description, but the band row
  // itself must not name the reading context in either wording.
  assert.ok(!row2.includes('正在读') && !row2.includes('当前会话'), 'the band no longer names the reading context')
})

test('no band row names a subagent\'s or an unindexed conversation\'s home', () => {
  for (const storedView of [
    view({ openSessionId: 'ghost', selectedNodeId: 'n2' }),
    view({ openSessionId: 'child', selectedNodeId: 'n2' }),
    view({ openSessionId: null, selectedNodeId: 'n2' }),
  ]) {
    const markup = renderPanel(MAP, storedView, { useSessions: selector => selector(SUBAGENT_CATALOG) })
    assert.equal((markup.match(/cm-home-chip/g) ?? []).length, 0, 'the band never names a context it cannot mark')
  }
})

/* ── the tree anchor (MapPanel SSR) ─────────────────────────────────────── */

/**
 * The anchor is a mark on the home row, independent of what is selected: it
 * must survive the guest selecting another branch, and be unique — the tree may
 * not read as two selection states.
 */
test('the home row carries exactly one anchor, wherever the selection went', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: 'n2' }))
  assert.equal(
    (markup.match(/data-session-home="true"/g) ?? []).length,
    1,
    'the open conversation has exactly one home row',
  )
  const anchors = anchorTags(markup)
  assert.equal(anchors.length, 1, 'the anchor is a `.cm-node-row` mark')
  const anchor = anchors[0]
  assert.ok(anchor.includes('data-node-id="n1"'), `the anchor belongs to the topic row that owns s1: ${anchor}`)
  assert.ok(!anchor.includes('data-node-id="n2"'), 'the anchor does not follow the selection')
  assert.equal(attribute(anchor, 'data-selected'), 'false', 'the anchor is not a second selection state')
  const description = attribute(anchor, 'aria-description')
  assert.notEqual(description, null, 'the row gains an accessible description for the anchor')
  assert.ok(
    description.includes(t('home.anchor.label')),
    `the description names the anchor: ${description}`,
  )

  const sameHome = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: '@ws:w1' }))
  const moved = anchorTags(sameHome)[0]
  assert.ok(moved.includes('data-node-id="n1"'), 'selecting the Workspace above the home keeps the anchor on the topic row')
  assert.ok(
    attribute(moved, 'aria-description').includes(t('home.anchor.label')),
    'the anchor description survives the selection move',
  )
})

test('a Workspace-level conversation anchors its Workspace row', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's3', selectedNodeId: 'n2' }))
  const anchors = anchorTags(markup)
  assert.equal(anchors.length, 1, 'one home row')
  assert.ok(
    anchors[0].includes('data-row-key="@ws:w2"'),
    `the Workspace that owns s3 carries the anchor: ${anchors[0]}`,
  )
})

test('no anchor is drawn without a home', () => {
  for (const storedView of [
    view({ openSessionId: null, selectedNodeId: 'n2' }),
    view({ openSessionId: 'ghost', selectedNodeId: 'n2' }),
  ]) {
    assert.equal(
      (renderPanel(MAP, storedView).match(/data-session-home="true"/g) ?? []).length,
      0,
      'nothing to anchor means no anchor at all',
    )
  }
})

/**
 * A subagent child has no row of its own, so the row the tree marks for it is
 * its nearest visible ancestor: the parent conversation. Reading the child then
 * draws the parent's identity marks — the parent row is the one solid surface,
 * the parent's home carries the anchor, the parent's whole home chain is marked
 * — which is the reader's model of the pair and what the product's own breadcrumb
 * says. The band's pane and `view.openSessionId` still name the child.
 *
 * Attention badges deliberately keep following the *real* open Session (see
 * `panel.test.mjs`), so this fixture has no status source: that is what makes
 * the whole tree comparable, not only its identity marks.
 */
test('a subagent conversation is read through its parent\'s tree marks', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 'child', selectedNodeId: 'n2' }), {
    useSessions: selector => selector(SUBAGENT_CATALOG),
  })
  assert.equal((markup.match(/data-session-home="true"/g) ?? []).length, 1, 'the child inherits its parent\'s home row')
  const anchor = anchorTags(markup)[0]
  assert.ok(anchor.includes('data-node-id="n1"'), `the anchor is the parent's home topic: ${anchor}`)
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 2, 'the home chain is marked as if the parent itself were open')
  assert.ok(paths.some(tag => tag.includes('data-node-id="n1"')), 'the home topic is on the chain')
  assert.ok(paths.some(tag => tag.includes('data-row-key="@ws:w1"')), 'and so is the owning Workspace')
  const parentRow = threadRowTags(markup).find(tag => tag.includes('data-session-id="s1"'))
  assert.notEqual(parentRow, undefined, 'the parent conversation row is on screen')
  assert.equal(attribute(parentRow, 'data-selected'), 'true', 'the parent row is the column\'s one solid surface')
  assert.equal(attribute(parentRow, 'aria-current'), 'page', 'assistive technology hears the same "you are here" a reader sees')

  const asParent = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: 'n2' }))
  assert.equal(markup, asParent, 'the same identity marks, and with no status source the same tree, as the parent')
})

test('a stale row for a subagent never becomes the reading row', () => {
  // A synced index never files a subagent row; only a document written before
  // that rule still carries one. The catalog is what says the child is a child,
  // so even that stale row stays a plain row while the parent is marked.
  const markup = renderPanel(SUBAGENT_MAP, view({ openSessionId: 'child', selectedNodeId: 'n2' }), {
    useSessions: selector => selector(SUBAGENT_CATALOG),
  })
  const childRow = threadRowTags(markup).find(tag => tag.includes('data-session-id="child"'))
  assert.notEqual(childRow, undefined, 'the stale row is still rendered')
  assert.equal(attribute(childRow, 'data-selected'), 'false', 'but it is never the conversation being read')
  const parentRow = threadRowTags(markup).find(tag => tag.includes('data-session-id="s1"'))
  assert.equal(attribute(parentRow, 'data-selected'), 'true', 'the parent row owns the reading mark instead')
})

/* ── the open conversation's path attribute (MapPanel SSR) ───────────────────── */

/**
 * The tree keeps the open conversation's home path as a chain attribute.
 *
 * The attribute is written for every row on the chain — the home row and every
 * container above it — regardless of where the selection points. That is what
 * lets the sheet state the chain permanently (filled folder + bold title), and
 * it is also what lets the owner's priority rule exist: a row that is both
 * selected and on the chain keeps the chain attribute, and the sheet shows the
 * chain style instead of the selection border (pinned in `styles.test.mjs`).
 */
test('a divergent selection keeps the whole home chain marked', () => {
  const markup = renderPanel(PATH_MAP, view({ openSessionId: 's1', selectedNodeId: 'n3' }))
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 2, 'the home topic and its Workspace both carry the chain attribute')
  const homeRow = paths.find(tag => tag.includes('data-node-id="n1"'))
  const wsRow = paths.find(tag => tag.includes('data-row-key="@ws:w1"'))
  assert.notEqual(homeRow, undefined, `the home topic is on the chain: ${paths.join(' | ')}`)
  assert.notEqual(wsRow, undefined, `the owning Workspace is on the chain: ${paths.join(' | ')}`)
  assert.ok(wsRow.includes('data-kind="workspace"'), 'the attribute recognises a Workspace row')
  assert.equal(attribute(homeRow, 'data-selected'), 'false', 'the home row is not the selection here')
  assert.ok(homeRow.includes('data-session-home="true"'), 'the home row keeps its home attribute too')

  const selectedRow = [...markup.matchAll(/<div class="cm-node-row"[^>]*>/g)]
    .map(match => match[0])
    .find(tag => tag.includes('data-selected="true"'))
  assert.notEqual(selectedRow, undefined, 'the divergent selection is rendered')
  assert.ok(!selectedRow.includes('data-session-path="true"'), 'a selected row off the chain stays off the chain')
})

test('a Workspace ancestor joins the open conversation\'s home path', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: '@ws:w2' }))
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 1, 'the home path is one row while the selection is in another Workspace')
  assert.ok(paths[0].includes('data-row-key="@ws:w1"'), `the owning Workspace carries the lane: ${paths[0]}`)
  assert.ok(paths[0].includes('data-kind="workspace"'), 'the attribute recognises a Workspace row')
})

test('a Workspace-level conversation puts the home path on its Workspace row', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's3', selectedNodeId: 'n1' }))
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 1, 'a Workspace-level conversation has a one-row path')
  assert.ok(paths[0].includes('data-row-key="@ws:w2"'), `the lane names the owning Workspace: ${paths[0]}`)
  assert.ok(paths[0].includes('data-session-home="true"'), 'the attribute and the anchor agree on the home row')
})

test('an agreeing selection keeps the home chain on the selected home row', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: 'n1' }))
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 2, 'the home row and its Workspace carry the chain even while the home is selected')
  const homeRow = paths.find(tag => tag.includes('data-node-id="n1"'))
  assert.notEqual(homeRow, undefined, 'the home row is on the chain')
  assert.ok(homeRow.includes('data-selected="true"'), 'the home row is also the selection — the chain still wins')
  assert.ok(homeRow.includes('data-session-home="true"'), 'the home attribute stays on the same row')
})

test('a selected Workspace that is on the chain keeps the chain attribute', () => {
  const markup = renderPanel(MAP, view({ openSessionId: 's1', selectedNodeId: '@ws:w1' }))
  const paths = pathRowTags(markup)
  assert.equal(paths.length, 2, 'selecting the Workspace above the home keeps the chain on both rows')
  const wsRow = paths.find(tag => tag.includes('data-row-key="@ws:w1"'))
  const homeRow = paths.find(tag => tag.includes('data-node-id="n1"'))
  assert.notEqual(wsRow, undefined, 'the selected Workspace is on the chain')
  assert.ok(wsRow.includes('data-selected="true"'), 'the Workspace is also the selection — the chain wins')
  assert.notEqual(homeRow, undefined, 'the home row stays on the chain')
})

/* ── the composer-side context line (HomeNotice SSR) ───────────────────── */

/**
 * The read-only bar is one row: a 「当前会话」 badge and the
 * `space › Workspace › topic › conversation` chain, with no icon leading it. A′
 * deliberately put no verdict and no controls in it, so the tests pin both the
 * chain and the absence of buttons — the reader gets the fact, not another
 * decision to make. The chain closes on the open conversation's own title, so
 * the row is one complete address: the reader can confirm the exact conversation
 * the next keystroke belongs to.
 */
test('a divergence in focus renders the read-only context line', () => {
  const markup = renderNotice()
  const tag = homePathTag(markup)
  assert.notEqual(tag, null, 'the divergent render carries the context line')
  assert.equal(attribute(tag, 'role'), 'status', 'the line is exposed as a status')

  const chain = [t('common.defaultSpace'), 'alpha', '外贸探索', '第一条对话']
  const pathText = chain.join(' › ')
  assert.equal(attribute(tag, 'title'), pathText, 'the title keeps the whole chain')

  const segments = homePathSegments(markup)
  assert.deepEqual(segments, chain, 'the segments spell the chain from the space down to the conversation')
  assert.equal(attribute(tag, 'title'), segments.join(' › '), 'the hover title is exactly the rendered segments')
  assert.equal((markup.match(/cm-home-path-part/g) ?? []).length, chain.length, 'one part per segment')
  assert.equal((markup.match(/cm-home-path-sep/g) ?? []).length, chain.length - 1, 'separators only between segments')

  const segTags = homePathSegTags(markup)
  assert.equal(segTags.length, chain.length, 'every segment is rendered once')
  const lastSeg = segTags.at(-1)
  assert.notEqual(lastSeg, undefined, 'the chain has a last segment')
  assert.equal(attribute(lastSeg, 'data-last'), 'true', 'the conversation title is marked as the chain end')
  assert.equal(attribute(lastSeg, 'data-conversation'), 'true', 'the last segment is named as the conversation')
  assert.equal((markup.match(/data-last="true"/g) ?? []).length, 1, 'only the last segment carries the marker')
  assert.equal((markup.match(/data-conversation="true"/g) ?? []).length, 1, 'only the title segment is the conversation')
  assert.equal((markup.match(/data-last="false"/g) ?? []).length, 0, 'the marker is never written as false either')
  const homeSeg = segTags[segTags.length - 2]
  assert.equal(attribute(homeSeg, 'data-last'), null, 'the home node is no longer the chain end')
  assert.equal(attribute(homeSeg, 'data-conversation'), null, 'the home node is not the conversation')

  // The title sits outside the segment group: that group clips its tail, so a
  // long chain has to ellipsize instead of pushing the conversation's name off
  // the bar.
  const groupStart = markup.indexOf('class="cm-home-path-segments"')
  const threadStart = markup.indexOf('cm-home-path-thread')
  assert.notEqual(groupStart, -1, 'the chain is grouped in its own segment box')
  assert.ok(threadStart > groupStart, 'the conversation title part comes after the chain group')
  const group = markup.slice(groupStart, threadStart)
  assert.ok(!group.includes('data-conversation'), 'the conversation title is not inside the clipped chain group')
  assert.ok(!group.includes('第一条对话'), 'the conversation title is not one of the clipped chain segments')

  assert.ok(!markup.includes('cm-home-path-glyph'), 'the line carries no icon: the badge names it in words')
  assert.ok(!markup.includes('<svg'), 'the bar draws no glyph at all')
  assert.ok(markup.includes('cm-home-path-label'), 'the line opens with its badge')
  const badge = /<span[^>]*class="cm-home-path-label"[^>]*>(.*?)<\/span>/s.exec(markup)
  assert.equal(badge?.[1] ?? '', t('home.path.label'), 'the badge reads 「当前会话」')
  assert.ok(!markup.includes('正在读'), 'the previous wording is gone')
  assert.ok(
    markup.replace(/<[^>]*>/g, '').includes(`${t('home.path.label')} ${pathText}`),
    'the visible text reads 「当前会话 空间 › 工作区 › 节点 › 对话」',
  )

  // A′ is read-only: the line must not grow a button, a dismissal or a card.
  assert.equal((markup.match(/<button/g) ?? []).length, 0, 'the line contains no control')
  assert.ok(!markup.includes('cm-home-notice'), 'the old notice card does not survive')
  assert.ok(!markup.includes('data-cm-home-notice'), 'no notice wrapper is rendered')
  assert.ok(!markup.includes('data-act='), 'no action buttons are rendered')
})

test('a cross-space divergence names the home\'s space in the chain', () => {
  const markup = renderNotice({
    document: TWO_SPACE_MAP,
    sessionId: 's3',
    published: view({ openSessionId: 's3', selectedNodeId: 'n2', activeSpace: '' }),
  })
  const chain = ['商业项目', 'beta', '第三条对话']
  assert.deepEqual(homePathSegments(markup), chain, 'the chain starts at the space the conversation lives in and ends at its title')
  assert.equal(attribute(homePathTag(markup), 'title'), chain.join(' › '), 'the title keeps the cross-space chain')
  assert.equal(
    attribute(homePathSegTags(markup).at(-1), 'data-conversation'),
    'true',
    'the conversation title closes the cross-space chain too',
  )
})

/**
 * The chain's last hop is the conversation's live name. The catalog is what a
 * rename writes first, so its `displayTitle` must win over the indexed row's
 * title (which can still say the old name for a frame); `title` is the fallback
 * inside the catalog row; the map's own row only names the frame before the
 * catalog answers.
 */
test('the conversation title is the catalog\'s live name', () => {
  const home = [t('common.defaultSpace'), 'alpha', '外贸探索']
  for (const [reason, row, expected] of [
    ['a rename lands in the catalog before the index', { displayTitle: '重命名后的对话' }, '重命名后的对话'],
    ['a catalog row that only carries a title still names it', { title: '目录标题' }, '目录标题'],
    ['displayTitle outranks title on the same row', { displayTitle: '显示名', title: '标题' }, '显示名'],
  ]) {
    const markup = renderNotice({ catalog: { ids: ['s1'], byId: { s1: row } } })
    assert.deepEqual(
      homePathSegments(markup),
      [...home, expected],
      `the chain ends with the live title while ${reason}`,
    )
    const lastSeg = homePathSegTags(markup).at(-1)
    assert.equal(attribute(lastSeg, 'data-last'), 'true', `the live title is the chain end while ${reason}`)
    assert.equal(attribute(lastSeg, 'data-conversation'), 'true', `the live title is the conversation while ${reason}`)
    assert.ok(!markup.includes('第一条对话'), 'the stale indexed name is not rendered')
  }
})

/**
 * The catalog may know the conversation without naming it yet — the frame before
 * a title arrives, or a row whose title is empty. The map's indexed row is the
 * fallback, so the address keeps its last hop instead of dropping it.
 */
test('the conversation title falls back to the map\'s indexed row', () => {
  const home = [t('common.defaultSpace'), 'alpha', '外贸探索']
  for (const [reason, row] of [
    ['the catalog row carries no name', {}],
    ['the catalog name is empty', { displayTitle: '' }],
  ]) {
    const markup = renderNotice({ catalog: { ids: ['s1'], byId: { s1: row } } })
    assert.deepEqual(
      homePathSegments(markup),
      [...home, '第一条对话'],
      `the map's own title closes the chain while ${reason}`,
    )
    assert.equal(
      attribute(homePathSegTags(markup).at(-1), 'data-conversation'),
      'true',
      `the fallback title is still the conversation while ${reason}`,
    )
  }
})

/**
 * When nothing names the conversation the address ends at the home node again,
 * exactly as it read before the title segment existed: no blank hop is drawn and
 * the home node keeps the chain-end emphasis it always had.
 */
test('the chain ends at the home node when nothing names the conversation', () => {
  const untitled = {
    ...MAP,
    threads: MAP.threads.map(thread => (
      thread.sessionId === 's1' ? { ...thread, title: '' } : thread
    )),
  }
  const markup = renderNotice({
    document: untitled,
    catalog: { ids: ['s1'], byId: { s1: {} } },
  })
  const chain = [t('common.defaultSpace'), 'alpha', '外贸探索']
  assert.deepEqual(homePathSegments(markup), chain, 'no blank title segment is appended')
  assert.equal(attribute(homePathTag(markup), 'title'), chain.join(' › '), 'the hover title ends at the home node too')
  const lastSeg = homePathSegTags(markup).at(-1)
  assert.equal(attribute(lastSeg, 'data-last'), 'true', 'the home node is the chain end again')
  assert.equal(attribute(lastSeg, 'data-conversation'), null, 'and it is not named as the conversation')
  assert.equal((markup.match(/cm-home-path-thread/g) ?? []).length, 0, 'the title part is not rendered at all')
  assert.equal((markup.match(/data-conversation/g) ?? []).length, 0, 'no conversation attribute is rendered')
})

/**
 * Every gate keeps the line inert. They are pinned one by one because each is a
 * different reason for silence — lifecycle, focus, geometry, identity, catalog,
 * and verdict.
 */
test('the context line stays absent while the map is not the thing being read', () => {
  const published = view({ openSessionId: 's1', selectedNodeId: 'n2' })
  for (const [reason, overrides] of [
    ['the slot names another Session', { sessionId: 's2', published }],
    ['the band is not geometrically on screen', { sessionId: 's1', published, mapVisible: false }],
    ['the band is collapsed', { sessionId: 's1', published, hidden: true }],
    ['no Session is open', { sessionId: 's1', published: view({ openSessionId: null, selectedNodeId: 'n2' }) }],
  ]) {
    assert.equal(renderNotice(overrides), '', `no line while ${reason}`)
  }
})

test('the context line stays absent for conversations with nothing to say', () => {
  const published = view({ openSessionId: 's1', selectedNodeId: 'n2' })
  const blank = { ids: ['s1'], byId: { s1: { displayTitle: '第一条对话', blank: true } } }
  const subagent = { ids: ['s1'], byId: { s1: { displayTitle: '第一条对话', origin: 'subagent' } } }
  for (const [reason, overrides] of [
    ['the conversation is a blank, unsent one', { published, catalog: blank }],
    ['the conversation is a subagent', { published, catalog: subagent }],
    ['the conversation is not indexed', { published: view({ openSessionId: 'ghost', selectedNodeId: 'n2' }), sessionId: 'ghost' }],
  ]) {
    assert.equal(renderNotice(overrides), '', `no line while ${reason}`)
  }
})

/** The verdict itself: same row, an ancestor container, and a dangling selection are all agreement. */
test('the context line stays absent while the selection has not left the home', () => {
  for (const [reason, selectedNodeId] of [
    ['the selected row is the home', 'n1'],
    ['the selected row is the Workspace above the home', '@ws:w1'],
    ['the selection names a row that is gone', 'deleted-node'],
  ]) {
    const markup = renderNotice({ published: view({ openSessionId: 's1', selectedNodeId }) })
    assert.equal(markup, '', `no line while ${reason}`)
  }
})

/**
 * The line is about what the reader is about to type, so it waits for the
 * composer to hold focus: browsing the tree moves focus to the clicked row and
 * stays silent; putting the caret back is what brings the line up. The prop is
 * optional: a mount without a tracker (the fallback and older render tests)
 * reads as focused so the other gates stay authoritative.
 */
test('the context line waits for the composer to take focus', () => {
  const focused = renderNotice({ focus: focusSource(true) })
  assert.notEqual(homePathTag(focused), null, 'a focused composer shows the line')

  const blurred = renderNotice({ focus: focusSource(false) })
  assert.equal(blurred, '', 'a composer that does not hold focus keeps the line away, even while the selection diverges')

  const untracked = renderNotice()
  assert.notEqual(homePathTag(untracked), null, 'no tracker means no extra gate: the old render path is unchanged')
})

/**
 * Focus is an early gate: it must not need the band, the catalog, or the
 * divergence verdict to decide, and no later gate may override it.
 */
test('the focus gate precedes the downstream gates', () => {
  const blurred = focusSource(false)
  for (const [reason, overrides] of [
    ['the selection diverges', { focus: blurred }],
    ['the map is not on screen', { focus: blurred, mapVisible: false }],
    ['the band is collapsed', { focus: blurred, hidden: true }],
    ['the catalogue marks the Session blank', {
      focus: blurred,
      catalog: { ids: ['s1'], byId: { s1: { displayTitle: '第一条对话', blank: true } } },
    }],
    ['the slot names another Session', { focus: blurred, sessionId: 's2' }],
  ]) {
    assert.equal(renderNotice(overrides), '', `a blurred composer renders nothing while ${reason}`)
  }
})
