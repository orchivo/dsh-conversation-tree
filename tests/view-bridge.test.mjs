/**
 * Behavior tests for the band's read-only view bridge.
 *
 * `createMapViewBridge` is the seam that lends `ViewState` (owned by `MapPanel`)
 * to the contribution rendered outside the band's React tree — the composer-side
 * context line in `conversation.input.dock`. It is a plain observable, and the
 * context line is read-only, so the bridge carries exactly two readings
 * (`view`, `mapVisible`) and no action handset. These tests drive it directly:
 * no DOM, no React, and a real `loadView` over a fake key/value store for the
 * initial snapshot.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { createMapViewBridge } from '../lib/view-bridge.js'
import { VIEW_STORAGE_KEY, emptyView } from '../lib/view-state.js'

/** One complete stored view document, built the way `emptyView` shapes it. */
function view(patch = {}) {
  return { ...emptyView(), ...patch }
}

/**
 * A key/value store backed by a plain Map.
 * @param stored - raw text to remember under the view key, if any.
 * @returns a `KeyValueStore`-shaped test double.
 */
function fakeStorage(stored) {
  const backing = new Map()
  if (stored !== undefined) backing.set(VIEW_STORAGE_KEY, stored)
  return {
    backing,
    getItem: key => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, value) },
  }
}

test('the bridge opens on the remembered view and starts inert', () => {
  const stored = view({ selectedNodeId: 'n2', openSessionId: 's1', activeSpace: 'sp-work', mapWidth: 500 })
  const bridge = createMapViewBridge(fakeStorage(JSON.stringify(stored)))
  const snapshot = bridge.getSnapshot()

  // The initial view is exactly what `loadView` restores — the dock entry may
  // mount before the band, and must read the remembered place rather than an
  // empty object.
  assert.deepEqual(snapshot.view, stored)
  assert.equal(snapshot.mapVisible, false, 'the band has not published yet, so the bridge is inert')
  // The bridge is a read-only projection: the context line cannot ask the band
  // to do anything, so there is no action handset in the reading.
  assert.deepEqual(Object.keys(snapshot).sort(), ['mapVisible', 'view'])
})

test('a missing or unreadable stored view opens as a fresh view', () => {
  assert.deepEqual(createMapViewBridge(fakeStorage()).getSnapshot().view, emptyView())
  assert.deepEqual(createMapViewBridge(fakeStorage('{not json')).getSnapshot().view, emptyView())
})

test('publishing a changed view or visibility wakes subscribers', () => {
  const bridge = createMapViewBridge(fakeStorage())
  let calls = 0
  const unsubscribe = bridge.subscribe(() => { calls += 1 })
  const first = view({ selectedNodeId: 'n1' })
  const second = view({ selectedNodeId: 'n2' })

  bridge.publish(first, false)
  assert.equal(calls, 1)
  assert.equal(bridge.getSnapshot().view, first, 'the published view is lent by reference')
  assert.equal(bridge.getSnapshot().mapVisible, false)

  bridge.publish(second, false)
  assert.equal(calls, 2, 'a different view reference is a change')

  bridge.publish(second, true)
  assert.equal(calls, 3, 'visibility alone is a change')
  assert.equal(bridge.getSnapshot().mapVisible, true)
  assert.equal(bridge.getSnapshot().view, second)

  unsubscribe()
})

test('one publish carries the view and the visibility as one immutable reading', () => {
  const bridge = createMapViewBridge(fakeStorage())
  const next = view({ selectedNodeId: 'n3', openSessionId: 's2' })
  const seen = []
  bridge.subscribe(() => seen.push(bridge.getSnapshot()))

  bridge.publish(next, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].view, next, 'the view and the visibility are read from the same snapshot')
  assert.equal(seen[0].mapVisible, true)
})

test('publishing the same view reference and visibility is a no-op', () => {
  const bridge = createMapViewBridge(fakeStorage())
  const published = view({ selectedNodeId: 'n1' })
  bridge.publish(published, true)
  const settled = bridge.getSnapshot()
  let calls = 0
  bridge.subscribe(() => { calls += 1 })

  bridge.publish(published, true)
  assert.equal(calls, 0, 'a regular band render does not wake the dock entry')
  assert.equal(bridge.getSnapshot(), settled, 'not even the snapshot object is replaced')

  // Equality is reference equality on purpose: a same-content object is a new
  // document as far as the bridge can tell, and consumers must re-read it.
  bridge.publish(view({ selectedNodeId: 'n1' }), true)
  assert.equal(calls, 1)
})

test('unsubscribing stops notifications while the snapshot keeps updating', () => {
  const bridge = createMapViewBridge(fakeStorage())
  const first = []
  const second = []
  const unsubscribeFirst = bridge.subscribe(() => first.push('tick'))
  bridge.subscribe(() => second.push('tick'))

  bridge.publish(view({ selectedNodeId: 'n1' }), false)
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)

  unsubscribeFirst()
  const next = view({ selectedNodeId: 'n2' })
  bridge.publish(next, false)
  assert.equal(first.length, 1, 'the unsubscribed listener is not called again')
  assert.equal(second.length, 2, 'the remaining listener still hears the change')
  assert.equal(bridge.getSnapshot().view, next, 'the snapshot updates with nobody listening')
})
