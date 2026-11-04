/**
 * Whether the shipped composer is the focused surface.
 *
 * The divergence notice must not turn browsing the tree into a stream of
 * warnings: selecting another node moves the focus to that row, so the composer
 * is not the surface the reader is about to type into. The notice is therefore
 * gated on the composer actually holding focus — the moment the reader puts the
 * caret back into the input, with the selection still on another node, is the
 * moment it appears.
 *
 * Focus is read from the product's own composer region:
 * `[data-conversation-region="composer"]` is the attribute the product itself
 * uses to scope composer-wide behaviour (its stop-shortcut handler resolves the
 * region the same way), so this is the public structural contract rather than a
 * private class. The notice lives inside that region too, so interacting with
 * the notice's own buttons keeps it "focused" while the click is in flight.
 *
 * The tracker is a plain subscribable value so the component can stay
 * `react-dom/server`-renderable: the browser activation injects a live tracker,
 * while tests inject a fake (or nothing, which reads as focused and keeps the
 * notice's other gates authoritative).
 */
import type { ObservableSnapshot } from './services.js'

/** The attribute that scopes the shipped composer region. */
export const COMPOSER_REGION_SELECTOR = '[data-conversation-region="composer"]'

/** A readable, subscribable composer-focus flag plus its teardown. */
export interface ComposerFocusTracker extends ObservableSnapshot<boolean> {
  /** Drop the document listeners; later snapshots stay at the last reading. */
  dispose(): void
}

/** The document surface the tracker needs; narrowed so tests can inject a fake. */
export interface FocusDocumentLike {
  readonly activeElement: unknown
  addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void
}

/**
 * Whether one element is inside the shipped composer region.
 *
 * `closest` is the only DOM API used; a non-element (text node, null, a test
 * double) is outside by definition.
 * @param element - the active element, or anything else.
 * @returns true when the element resolves to the composer region.
 */
export function isComposerFocusTarget(element: unknown): boolean {
  if (element === null || typeof element !== 'object') return false
  const closest = (element as { closest?: unknown }).closest
  if (typeof closest !== 'function') return false
  try {
    return (closest as (selector: string) => unknown).call(element, COMPOSER_REGION_SELECTOR) !== null
  } catch (_notAnElement) {
    return false
  }
}

/** An inert reading used when no document exists (server rendering). */
const NEVER_FOCUSED: ComposerFocusTracker = {
  getSnapshot: () => false,
  subscribe: () => () => {},
  dispose: () => {},
}

/**
 * Open the live composer-focus reading over one document.
 *
 * Focus changes arrive as `focusin`/`focusout` on the capture phase, and are
 * re-read on the next task rather than synchronously: a click that moves focus
 * from the composer to a tree row fires `focusout` before the new element is
 * focused, so reading immediately would miss the destination. The deferred read
 * after the whole gesture settles is the reading the reader actually sees.
 *
 * @param options - the document (defaults to the global one) and a scheduler
 *   (defaults to `setTimeout(0)`, injected by tests).
 * @returns the tracker; call `dispose()` with the plugin activation.
 */
export function createComposerFocusTracker(options: {
  document?: FocusDocumentLike | undefined
  defer?: ((run: () => void) => void) | undefined
} = {}): ComposerFocusTracker {
  const doc = options.document
    ?? (typeof document === 'undefined' ? undefined : document as unknown as FocusDocumentLike)
  if (doc === undefined) return NEVER_FOCUSED
  const defer = options.defer ?? ((run: () => void) => { setTimeout(run, 0) })
  const listeners = new Set<() => void>()
  let focused = false
  let disposed = false
  const read = (): boolean => {
    try {
      return isComposerFocusTarget(doc.activeElement)
    } catch (_unreadable) {
      return false
    }
  }
  const refresh = (): void => {
    if (disposed) return
    const next = read()
    if (next === focused) return
    focused = next
    for (const listener of [...listeners]) listener()
  }
  const schedule = (): void => {
    if (disposed) return
    defer(refresh)
  }
  focused = read()
  doc.addEventListener('focusin', schedule, true)
  doc.addEventListener('focusout', schedule, true)
  return {
    getSnapshot: () => focused,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
      try {
        doc.removeEventListener('focusin', schedule, true)
        doc.removeEventListener('focusout', schedule, true)
      } catch (_alreadyGone) {
        // A disposed document needs no teardown.
      }
    },
  }
}
