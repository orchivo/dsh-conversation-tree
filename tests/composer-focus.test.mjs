/**
 * Unit tests for the composer-focus tracker.
 *
 * The tracker decides whether the divergence notice may appear at all, so the
 * cases are the reading itself (is the active element inside the shipped
 * composer region?), the event/defer contract (a gesture is read after it
 * settles), and teardown (a disposed tracker neither notifies nor keeps
 * listeners). A fake document stands in for the browser: the module's only DOM
 * dependency is `activeElement.closest`, which the fakes model directly.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  COMPOSER_REGION_SELECTOR,
  createComposerFocusTracker,
  isComposerFocusTarget,
} from '../lib/composer-focus.js'

/** One element inside the composer region. */
const COMPOSER_ELEMENT = {
  closest(selector) {
    return selector === COMPOSER_REGION_SELECTOR ? { tagName: 'DIV' } : null
  },
}

/** One element outside it (a tree row, say). */
const OUTSIDE_ELEMENT = {
  closest() {
    return null
  },
}

/** One element whose `closest` throws (a stale node, or a hostile double). */
const THROWING_ELEMENT = {
  closest() {
    throw new TypeError('not an element')
  },
}

/**
 * A document double: stores listeners by type, exposes the active element, and
 * lets a test dispatch one event by hand.
 * @param initial - the active element at creation.
 * @returns the document, an event emitter, and listener counts.
 */
function fakeDocument(initial) {
  const listeners = new Map()
  const document = {
    activeElement: initial,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
  }
  return {
    document,
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type })
    },
    count(type) {
      return (listeners.get(type) ?? []).length
    },
  }
}

test('an active element inside the composer region counts as focused', () => {
  assert.equal(isComposerFocusTarget(COMPOSER_ELEMENT), true)
})

test('anything that is not an element, or cannot resolve the region, is outside', () => {
  assert.equal(isComposerFocusTarget(null), false)
  assert.equal(isComposerFocusTarget(undefined), false)
  assert.equal(isComposerFocusTarget('textarea'), false)
  assert.equal(isComposerFocusTarget(42), false)
  assert.equal(isComposerFocusTarget({}), false)
  assert.equal(isComposerFocusTarget(OUTSIDE_ELEMENT), false)
  assert.equal(isComposerFocusTarget(THROWING_ELEMENT), false)
})

test('without a document the tracker is inert and reads as not focused', () => {
  const tracker = createComposerFocusTracker({ document: undefined })
  assert.equal(tracker.getSnapshot(), false)
  let notified = 0
  const stop = tracker.subscribe(() => { notified += 1 })
  tracker.dispose()
  stop()
  assert.equal(notified, 0)
})

test('the initial reading is the document\'s active element', () => {
  const focused = createComposerFocusTracker({
    document: fakeDocument(COMPOSER_ELEMENT).document,
    defer: (run) => { run() },
  })
  assert.equal(focused.getSnapshot(), true)
  const unfocused = createComposerFocusTracker({
    document: fakeDocument(OUTSIDE_ELEMENT).document,
    defer: (run) => { run() },
  })
  assert.equal(unfocused.getSnapshot(), false)
})

test('focusin and focusout re-read the active element after the gesture settles', () => {
  const fake = fakeDocument(OUTSIDE_ELEMENT)
  const tracker = createComposerFocusTracker({ document: fake.document, defer: (run) => { run() } })
  const readings = []
  tracker.subscribe(() => { readings.push(tracker.getSnapshot()) })

  fake.document.activeElement = COMPOSER_ELEMENT
  fake.emit('focusin')
  assert.deepEqual(readings, [true], 'moving focus into the composer notifies once')

  // A second event with the same reading is a no-op for subscribers.
  fake.emit('focusin')
  assert.deepEqual(readings, [true])

  fake.document.activeElement = OUTSIDE_ELEMENT
  fake.emit('focusout')
  assert.deepEqual(readings, [true, false], 'leaving the composer notifies once more')
})

test('the deferred read is what counts, not the element at event time', () => {
  // focusout fires before the next element receives focus; the scheduled read
  // must therefore see the destination (a tree row), not the composer.
  const fake = fakeDocument(COMPOSER_ELEMENT)
  const queued = []
  const tracker = createComposerFocusTracker({
    document: fake.document,
    defer: (run) => { queued.push(run) },
  })
  assert.equal(tracker.getSnapshot(), true)
  fake.document.activeElement = OUTSIDE_ELEMENT
  fake.emit('focusout')
  assert.equal(tracker.getSnapshot(), true, 'nothing changes before the deferred read runs')
  for (const run of queued.splice(0)) run()
  assert.equal(tracker.getSnapshot(), false)
})

test('unsubscribe stops notifications but not the reading', () => {
  const fake = fakeDocument(OUTSIDE_ELEMENT)
  const tracker = createComposerFocusTracker({ document: fake.document, defer: (run) => { run() } })
  let notified = 0
  const stop = tracker.subscribe(() => { notified += 1 })
  stop()
  fake.document.activeElement = COMPOSER_ELEMENT
  fake.emit('focusin')
  assert.equal(notified, 0)
  assert.equal(tracker.getSnapshot(), true)
})

test('dispose removes the listeners and freezes the reading', () => {
  const fake = fakeDocument(OUTSIDE_ELEMENT)
  const tracker = createComposerFocusTracker({ document: fake.document, defer: (run) => { run() } })
  assert.equal(fake.count('focusin'), 1)
  assert.equal(fake.count('focusout'), 1)
  let notified = 0
  tracker.subscribe(() => { notified += 1 })
  tracker.dispose()
  assert.equal(fake.count('focusin'), 0)
  assert.equal(fake.count('focusout'), 0)
  fake.document.activeElement = COMPOSER_ELEMENT
  fake.emit('focusin')
  assert.equal(notified, 0)
  assert.equal(tracker.getSnapshot(), false)
})
