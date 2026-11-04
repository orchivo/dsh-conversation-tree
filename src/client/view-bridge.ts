/**
 * The band's view state, lent to the composer-side context line.
 *
 * `ViewState` (which node is selected, which conversation is open) is owned by
 * `MapPanel`: it is the only writer, it loads the document at mount, and it
 * persists every change. The composer-side line registered into
 * `conversation.input.dock` lives outside the band's React tree, so this bridge
 * is the smallest way to lend it the two readings it needs without moving the
 * state:
 *
 * - `MapPanel` publishes `{view, mapVisible}` after every committed change; it
 *   never subscribes, so there is no feedback loop and no second writer;
 * - the dock entry subscribes and reads a snapshot, exactly like the plugin's
 *   other observable surfaces;
 * - `loadView`/`saveView` stay in `MapPanel`, so startup restore, persistence,
 *   and the native-navigation reconciliation keep exactly one owner.
 *
 * The context line is read-only, so the bridge carries no actions. The tree's
 * filled home folder, the home-path attribute, and the dock line are all derived
 * from the same published `view`; nothing outside the band can change it.
 *
 * The bridge exists only in the browser activation; render tests that mount the
 * panel without one see it as absent and behave exactly as before.
 */
import type { KeyValueStore } from '../shared/persistence.js'
import { loadView, type ViewState } from '../shared/view-state.js'

/** One immutable reading of the band's view state. */
export interface MapViewSnapshot {
  /** The band's current view document. */
  readonly view: ViewState
  /** True while the band is mounted and geometrically on screen. */
  readonly mapVisible: boolean
}

/**
 * A read-only projection of the band's view state.
 *
 * The snapshot is replaced only when a value actually changes, so a regular
 * band render (a status tick, a drag frame) does not wake the dock entry.
 */
export interface MapViewBridge {
  getSnapshot(): MapViewSnapshot
  subscribe(listener: () => void): () => void
  /** Publish the latest view; called by the band after every committed change. */
  publish(view: ViewState, mapVisible: boolean): void
}

/**
 * Open one bridge over the same local store the band reads its view from.
 *
 * The initial view is the remembered one, so a dock entry that mounts before
 * the band (the shell renders the composer even while the band is collapsed)
 * reads a plausible snapshot instead of an empty object; `mapVisible` starts
 * false, which keeps it inert until the band publishes.
 * @param storage - the key/value store holding `ViewState`.
 * @returns the bridge, live for the lifetime of this activation.
 */
export function createMapViewBridge(storage: KeyValueStore): MapViewBridge {
  let snapshot: MapViewSnapshot = { view: loadView(storage), mapVisible: false }
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (view, mapVisible) => {
      if (snapshot.view === view && snapshot.mapVisible === mapVisible) return
      snapshot = { view, mapVisible }
      notify()
    },
  }
}
