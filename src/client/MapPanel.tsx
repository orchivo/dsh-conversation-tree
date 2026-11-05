/**
 * The map band.
 *
 * A frame-wide overlay entry occupying the centre column's left edge while
 * 对话树模式 is on. It draws only navigation: a compact top bar (the single view
 * button, the space switcher, search and the maintenance overflow) and the
 * cascading node columns. The shipped Conversation column keeps rendering to
 * its right — header, view tabs, utilities, body, composer and right Sidebar —
 * and is shifted right by the band's width through one `padding-left` rule on
 * the Conversation root (see `styles.ts` and `split-frame.ts`). The map never
 * renders a Session.
 *
 * The node strip's first column is the application's own Workspace list — it is
 * not a topic list this plugin invented, so the map and the shipped sidebar
 * always name the same containers, and creating a Workspace here creates it
 * there (and vice versa). Every deeper column is one level of this plugin's
 * topics. Conversations sit directly under their Workspace (or under the topic
 * they were filed in), and are created in the Workspace that owns that row, so
 * the Host's list and the map never disagree.
 *
 * Columns scroll vertically on their own and the strip scrolls horizontally, so
 * growing it never disturbs the shipped Conversation column. Opening a
 * conversation goes through the application's own navigation, so the map's
 * highlight, the product's current Session and the right Sidebar always name
 * the same conversation.
 *
 * Organization lives in the pure model and view memory in a separate view
 * document, so choosing, opening, or resizing never churns the index's revision.
 */
import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type Ref,
} from 'react'

import {
  MapError, MAX_DEPTH, DEFAULT_SPACE_TITLE, UNGROUPED_ID, activeChildrenOf, activeDirectThreadsOf, activeMapView,
  activeThreadsOf, activeTopNodesOf, adoptThread, ancestorRowKeys, archiveKey, archiveNode, archiveSelection,
  archiveStatsOf, archiveThread, archivedLooseThreadsOf, archivedRootsOf, assignThreadIssue,
  isArchiveSelectionKey,
  assignThreads, breadcrumb, createNode,
  createSpace, deleteNodeSubtree, deleteSpace, descendantIds, homeOfSession, inArchive, insertNodeBefore,
  isArchivedThread, isRecordedSubagent,
  looseRowKey, looseThreadsInSpace, moveNode, nodePath,
  reconcileSpaces, reconcileWorkspaces, renameSpace, searchMap, selectionAfterNodeDeletion,
  selectionOfThread, setThreadSpace, setWorkspaceSpace, spaceList, spaceOfThread, spaceOfWorkspace,
  subtreeDeletionSummary, syncCatalog, threadMoveTargets, threadOfSession, unarchiveNode, unarchiveThread,
  updateNode, visibleAncestorOf, workspaceDisplayTitle, workspaceKey, workspaceOfNode, workspaceSelection,
  workspacesInSpace, type MapNode, type MapState, type SpaceRef, type ThreadRef, type WorkspaceRef,
} from '../shared/model.js'
import type { Translate } from '../shared/copy.js'
import type { KeyValueStore } from '../shared/persistence.js'
import {
  emptyStatusRollup, mergeStatusRollups, rollupStatuses, rollupStatusesBySpace,
  type ObservedSessionStatus, type SpaceRollupThread, type StatusCategory, type StatusRollup,
} from '../shared/status-rollup.js'
import { relativeTimeLabel } from '../shared/time.js'
import {
  buildSearchView, type ContentSearchHit, type SearchNodeItem, type SearchSnippet, type SearchThreadItem,
} from '../shared/search.js'
import {
  MIN_CENTRE_FOR_BAND, MIN_MAP_WIDTH, clampMapWidth, loadView, maxMapWidth, reconcileView, saveView,
  type ViewState,
} from '../shared/view-state.js'
import { readingSessionOf, sessionHomeSelection } from '../shared/session-home.js'
import {
  EllipsisGlyph, Gutter, NodeColumnView, PlusGlyph, type DropState, type InsertEdge, type MenuRequest,
  type NodeColumn, type NodeRow, type ThreadRow, type ThreadStatus,
} from './Columns.js'
import {
  DRAG_THRESHOLD_PX, candidateFromGroupHit, decideDrop, exceedsDragThreshold, formatDragLabel, hitGroupAt,
  type ColumnRect, type DragPayload, type DropCandidate, type DropDecision, type GroupRect,
} from './row-drag.js'
import {
  useSnapshot, type MapServices, type ObservableSnapshot, type RootPanelProps, type SessionStatusLike,
} from './services.js'
import { useBandFrame, windowEdgeGutter, type BandFrame } from './split-frame.js'
import { browserStorage } from './storage.js'
import { describeError } from './error-text.js'
import { displaySpaceTitle, workspaceTitleLabels } from './display.js'
import { formatMapNotice } from './map-store.js'
import { LocaleProvider, useLocaleT, useT } from './locale.js'
import { NewChatGlyph, SearchGlyph } from './Glyph.js'
import { StatusRollupBadge } from './StatusRollup.js'
import { ViewToggle } from './ViewToggle.js'

/**
 * Re-exported for the render tests.
 *
 * The rows' identity attributes, the insertion line, the rule that decides
 * which cells a row's trailing slot holds, and the placement of the clipped-row
 * title tip belong to the column view, and the Node build has no separate entry
 * for it (see `tsdown.config.ts`), so the panel's own entry is where the tests
 * can reach them.
 */
export { NodeColumnView, insertionLineStyle, showsStatusRollup } from './Columns.js'
export { titleTipPlacement } from './row-tip.js'

/**
 * Re-exported for the render tests.
 *
 * The band's box is measured against the frame-wide overlay layer, not against
 * whichever element happens to be its anchor; the pure offset rule is small but
 * it is the difference between a band that sits on the Conversation column and
 * one shifted by the Windows desktop caption row. The window-edge gutter is
 * pinned the same way: its rule ("the band's left edge is the frame's left
 * edge") is one comparison, and the render test must be able to call it with a
 * measured frame the server renderer never produces.
 */
export { WINDOW_EDGE_GUTTER, overlayOffset, windowEdgeGutter } from './split-frame.js'

/** Fallback width of one cascading node column. */
const NODE_COLUMN_WIDTH = 220

/** One rung of the space breadcrumb's cluster ladder. */
export type SpaceBreadcrumbDensity = 'cluster' | 'dots' | 'none'

/** How much of the space breadcrumb's status clusters the row can draw. */
export interface SpaceBreadcrumbDensities {
  /** The root segment's density: the whole map's total always keeps its numbers. */
  readonly root: 'cluster' | 'none'
  /** The current space's density; it gives way before the space name ellipsizes. */
  readonly current: SpaceBreadcrumbDensity
}

/**
 * Give the current segment's cluster one rung down its ladder.
 *
 * The panel picks that density by *measuring the row*, not by a band-width
 * threshold: after every width or content change it starts at the richest form
 * and walks down while the space name is still ellipsized, then stops. A narrow
 * band with a short space name therefore keeps its numbers — at 378px the whole
 * bar measures ~234px, while the old 480/420px thresholds had already dropped or
 * dot-ified the counts with more than 100px of the row unused.
 * @param density - the density currently on screen.
 * @returns the next rung down; `none` is terminal.
 */
export function nextSpaceBreadcrumbDensity(density: SpaceBreadcrumbDensity): SpaceBreadcrumbDensity {
  return density === 'cluster' ? 'dots' : 'none'
}

/**
 * Combine the measured current density with the states that suppress clusters.
 *
 * The root segment never degrades: in map mode the product's left column is
 * collapsed, so the band's root is the only always-on whole-map readout. The
 * current segment's cluster is redundant with the tree's node rows, so it gives
 * way first — first to dots, then entirely — while its name keeps ellipsizing.
 * Search occupies the same row and takes its clusters out altogether. A single
 * space repeats the root's numbers exactly, so the current segment keeps only its
 * name (the reader confirmed this is the quieter first-run state).
 * @param options - whether search is open, whether only one space exists, and
 *   the density the row measurement settled on.
 * @returns the densities for the root and current segments.
 */
export function spaceBreadcrumbDensities(options: {
  search: boolean
  singleSpace: boolean
  current: SpaceBreadcrumbDensity
}): SpaceBreadcrumbDensities {
  if (options.search) return { root: 'none', current: 'none' }
  return { root: 'cluster', current: options.singleSpace ? 'none' : options.current }
}

/**
 * Width-relevant signature of one rollup.
 *
 * The breadcrumb re-measures when a badge changes width, and the categories and
 * counts are what decide that width; `fresh` (the halo) does not. Joining the
 * four numbers keeps the signature cheap and stable across snapshots that only
 * touch other rows.
 * @param rollup - the segment's counts, when it has any.
 * @returns a stable string for the measured row's dependency list.
 */
function rollupCountsSignature(rollup: StatusRollup | undefined): string {
  if (rollup === undefined) return ''
  const { pending, error, done, running } = rollup.counts
  return `${String(pending)}.${String(error)}.${String(done)}.${String(running)}`
}

/**
 * What the band's second row adds below the measured leading row: the row's own
 * 8px top gap plus its 28px height (`.cm-band-row2` in `styles.ts`).
 *
 * Both numbers live in the sheet; they are restated here because the top bar's
 * height is computed from the *measured* leading row (so the single switch keeps
 * the shipped header's baseline) and has to add the band's own second row on top
 * of it.
 */
const BAND_SECOND_ROW_BLOCK = 36

/**
 * Height of the band's top bar.
 *
 * The band's chrome is always the two-row shape: the leading row measured from
 * the shipped header, then the second row that carries the space switcher (and,
 * when asked for, the search field). Following the shipped header down to its
 * one-row blank form instead would fold the space switcher into row 1 — a
 * different control (32px pill, own width) sitting in a different place — and
 * move the whole map chrome every time a blank Session opens or a Session
 * starts. The blank header draws nothing the band could line up with, so a
 * stable chrome is worth the band header being 36px taller than it while the
 * right column sits on the blank landing page.
 *
 * The shipped height is still the floor: if a future header grows taller than
 * the band's own two rows, the seam keeps following it.
 * @param frame - the measured Conversation column geometry.
 * @returns the top bar's height in CSS pixels.
 */
export function bandHeaderHeight(frame: Pick<BandFrame, 'headerHeight' | 'headTop' | 'headHeight'>): number {
  return Math.max(frame.headerHeight, frame.headTop + frame.headHeight + BAND_SECOND_ROW_BLOCK)
}

/** How many of a node's conversations are shown before a "show more" row. */
const PREVIEW_THREADS = 5

/** How many more each click reveals. */
const PREVIEW_STEP = 5

/** Stand-in for the status snapshot when the framework does not supply one. */
const NO_STATUS: ReadonlyMap<string, SessionStatusLike> = new Map()

/** Stand-in observation when no status ledger is injected (render tests). */
const NO_OBSERVED: ReadonlyMap<string, ObservedSessionStatus> = new Map()

/** Stable empty current-Session source, so the hook order holds without uiSession. */
const NO_EXTERNAL_CURRENT: ObservableSnapshot<string | null> = {
  getSnapshot: () => null,
  subscribe: () => () => {},
}

/** Synthetic row shown while the Host's Workspace list is still arriving. */
const PENDING_ROW_ID = '@workspaces-pending'

/** Synthetic row holding search-matched conversations that belong to no node. */
const SEARCH_THREADS_ID = '@matches'

/** Synthetic hint row shown when a query matches nothing at all. */
const SEARCH_EMPTY_ID = '@search-empty'

/** Synthetic hint row reporting conversation-body indexing progress. */
const SEARCH_PROGRESS_ID = '@search-progress'

/** Body search only runs from two characters up; one letter would match everything. */
const BODY_QUERY_MIN = 2

/** How long the browser waits after the last keystroke before asking the Host. */
const BODY_QUERY_DEBOUNCE_MS = 220

/** How soon the browser asks the Host again while its index is still filling. */
const BODY_QUERY_CONTINUE_MS = 120

/**
 * Name one level's column by its depth, so a column never claims to be the node
 * above it: `L1` is the Workspace column, `L2` the first topic column, and every
 * deeper level just carries its own number.
 * @param index - zero-based level.
 * @returns the column's fixed label.
 */
function levelLabel(index: number): string {
  return `L${index + 1}`
}

/** One open dialog: a topic, a Workspace adoption, a space/归属 change, or a conversation move. */
type Draft =
  | {
    kind: 'node'
    id?: string
    workspaceId: string | null
    parentId: string | null
    title: string
    description: string
    /**
     * The parent the node had when this dialog opened.
     *
     * Only a parent the reader actually changed is written: a drag that landed
     * while the dialog was open must not be undone by saving an untouched form.
     */
    originalParentId?: string | null
    /**
     * D9: the sibling the node is placed in front of, or `null`/absent for the
     * end of the list. An anchor is a real move even under the same parent.
     */
    beforeNodeId?: string | null
    /**
     * The node lives in the archive: its title/description are editable, but
     * location is not (the dialog hides the parent and position fields). Moving
     * archived content is what unarchiving is for.
     */
    archived?: boolean
  }
  | {
    kind: 'workspace-create'
    path: string
    /** The name this Workspace should carry; `''` until a directory yields one. */
    title: string
    /**
     * Whether the reader edited the name by hand.
     *
     * An untouched name follows the directory's basename — and never renames a
     * directory that is already registered, because typing a known path is
     * adoption, not a rename. A name the reader typed is an explicit intent and
     * is applied after the Workspace resolves.
     */
    titleTouched: boolean
  }
  | { kind: 'workspace-rename'; workspaceId: string; title: string }
  | { kind: 'workspace-delete'; workspaceId: string; title: string }
  | { kind: 'space-create'; title: string }
  | { kind: 'space-rename'; spaceId: string; title: string }
  | { kind: 'space-delete'; spaceId: string; title: string }
  | { kind: 'node-delete'; nodeId: string; title: string }
  | { kind: 'workspace-space'; workspaceId: string; title: string; spaceId: string }
  | { kind: 'thread-space'; sessionId: string; title: string; spaceId: string }
  | {
    kind: 'move-thread'
    sessionId: string
    /** The Workspace whose nodes the conversation may move to; `null` = ungrouped. */
    workspaceId: string | null
    /** The destination the picker currently names; `''` in the select means `null`. */
    nodeId: string | null
  }

/** Props the map-band registration supplies to the page. */
export interface MapPanelProps extends RootPanelProps {
  services: MapServices
  /**
   * Backing store override.
   *
   * Production reads the browser's own storage; a render test injects a plain
   * object instead of reaching for a global the test runner may already own.
   */
  storage?: KeyValueStore
}

/** One destination offered by the 「移动到…」 picker. */
export interface ThreadMoveOption {
  /** The select's value; `''` names the Workspace row itself (`nodeId === null`). */
  value: string
  /** The path the reader sees. */
  label: string
  /** True when the model would refuse this destination. */
  disabled: boolean
}

/**
 * The destinations one conversation may move to, as the picker renders them.
 *
 * The list is exactly {@link threadMoveTargets}: the Workspace's own topics,
 * with the Workspace row itself always first — and always present, so a
 * Workspace with no topics still offers it. Each entry carries the model's own
 * verdict from {@link assignThreadIssue}: a destination the model would refuse
 * (a legacy rootless topic of another space, say) is shown but not selectable,
 * so the limit is visible instead of arriving as an error after confirming.
 * @param state - the map.
 * @param sessionId - the conversation being moved.
 * @param workspaceId - its Workspace; `null` = the ungrouped bucket.
 * @param t - the active translator (its dictionary names the Workspace row).
 * @returns the select's options, in display order.
 */
export function threadMoveOptions(
  state: MapState,
  sessionId: string,
  workspaceId: string | null,
  t: Translate,
): ThreadMoveOption[] {
  return threadMoveTargets(state, workspaceId, t('common.workspaceTopLevel')).map(target => ({
    value: target.nodeId ?? '',
    label: target.label,
    disabled: assignThreadIssue(state, sessionId, target.nodeId) !== null,
  }))
}

/**
 * Whether one picker value names the destination a conversation already has.
 *
 * A same-value submit is not free: `assignThreads` bumps the document revision
 * and commits it, so the picker short-circuits here instead of writing a
 * document that says exactly what the old one said.
 * @param state - the map.
 * @param sessionId - the conversation being moved.
 * @param value - the select's value; `''` = the Workspace row.
 * @returns true when confirming would change nothing.
 */
export function threadMoveIsNoop(state: MapState, sessionId: string, value: string): boolean {
  const thread = threadOfSession(state, sessionId)
  if (thread === undefined) return false
  return thread.nodeId === (value === '' ? null : value)
}

/**
 * The document change one confirmed move commits.
 *
 * The picker's own value vocabulary lives here: `''` is the Workspace row
 * (`nodeId === null`), anything else names a topic. The dialog and the future
 * drag commit share it, so both speak the same mapping.
 * @param sessionId - the conversation being moved.
 * @param value - the select's value.
 * @returns the change `store.update` applies.
 */
export function threadMoveChange(sessionId: string, value: string): (current: MapState) => MapState {
  return current => assignThreads(current, [sessionId], value === '' ? null : value)
}

/** Props of the 「移动到…」 picker field. */
export interface MoveThreadFieldProps {
  state: MapState
  sessionId: string
  workspaceId: string | null
  /** The current selection, in the select's own vocabulary. */
  value: string
  onChange: (next: string) => void
}

/**
 * The one field the 「移动到…」 dialog needs: the destinations as a foldable tree.
 *
 * A flat list of breadcrumbs made two same-named topics distinguishable but the
 * shape of the tree invisible; folding a branch away is what lets a Workspace
 * with dozens of topics be navigated at all (BL-3). The root row is the
 * Workspace itself, and every row a refused destination is shown but cannot be
 * chosen — the reader sees where the limit is instead of meeting it after
 * confirming.
 * @param props - the map, the conversation, and the selected destination.
 * @returns the field.
 */
export function MoveThreadField(props: MoveThreadFieldProps): ReactNode {
  const t = useT()
  const rows = moveTreeRows(props.state, props.sessionId, props.workspaceId, t)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [activeKey, setActiveKey] = useState<string>(() => props.value)
  const visible = visibleTreeRows(rows, collapsed)
  const cursor = ((): number => {
    const at = visible.findIndex(row => row.key === activeKey)
    return at === -1 ? 0 : at
  })()
  /** Fold or unfold one branch. */
  const toggle = (key: string): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const at = treeStep(visible, cursor, event.key === 'ArrowDown' ? 1 : -1)
      const row = visible[at]
      if (row !== undefined) setActiveKey(row.key)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const row = visible[cursor]
      if (row === undefined || !row.hasChildren) return
      event.preventDefault()
      const folded = collapsed.has(row.key)
      if (event.key === 'ArrowRight' && folded) toggle(row.key)
      if (event.key === 'ArrowLeft' && !folded) toggle(row.key)
      return
    }
    if (event.key !== 'Enter') return
    const row = visible[cursor]
    if (row === undefined || row.disabled) return
    event.preventDefault()
    props.onChange(row.key)
  }
  return (
    <div className="cm-field">
      <span className="cm-move-tree-label" id="cm-move-thread-label">{t('panel.moveTo')}</span>
      <div
        className="cm-move-tree"
        id="cm-move-thread-target"
        role="tree"
        aria-labelledby="cm-move-thread-label"
        tabIndex={0}
        autoFocus
        onKeyDown={onKeyDown}
      >
        {visible.map(row => (
          <div
            key={row.key}
            className="cm-move-tree-row"
            role="treeitem"
            data-depth={row.depth}
            data-selected={row.key === props.value}
            data-active={row.key === activeKey ? 'true' : undefined}
            aria-selected={row.key === props.value}
            aria-disabled={row.disabled ? 'true' : undefined}
            data-disabled={row.disabled ? 'true' : undefined}
            data-expanded={row.hasChildren ? (collapsed.has(row.key) ? 'false' : 'true') : undefined}
            style={{ '--cm-move-depth': row.depth } as CSSProperties}
            title={row.label}
            onClick={() => { if (!row.disabled) { setActiveKey(row.key); props.onChange(row.key) } }}
          >
            {row.hasChildren
              ? (
                <button
                  type="button"
                  className="cm-move-tree-toggle"
                  data-expanded={collapsed.has(row.key) ? 'false' : 'true'}
                  aria-expanded={!collapsed.has(row.key)}
                  aria-label={collapsed.has(row.key) ? t('panel.expandChildren') : t('panel.collapseChildren')}
                  onClick={(event) => { event.stopPropagation(); toggle(row.key) }}
                >
                  <ChevronGlyph />
                </button>
              )
              : <span className="cm-move-tree-toggle" aria-hidden="true" />}
            <span className="cm-move-tree-label">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Why a subagent child has no move of its own. */
const MOVE_SUBAGENT_NOTICE_KEY = 'panel.subagentMoveNotice'

/** What one conversation row's `⋯` menu offers. */
export interface ThreadMenuModel {
  /** The one-step 「移动到…」 entry; absent for a subagent child. */
  move: boolean
  /** The explanation a subagent row carries instead of a move. */
  notice: string | null
}

/**
 * Decide one conversation row's `⋯` menu.
 *
 * One entry, plus one explanatory sentence for a subagent child. The picker
 * carries every destination the conversation has, including its Workspace row,
 * so there is no second entry to explain and nothing that appears only when the
 * reader happens to have selected a topic of the same Workspace (BL-1). A
 * subagent child is offered nothing at all: the model refuses to file it, so its
 * row only says where such a conversation is managed.
 * @param state - the map.
 * @param thread - the conversation the menu belongs to.
 * @param t - the active translator.
 * @returns the entries to render.
 */
export function threadMenuModel(state: MapState, thread: ThreadRef, t: Translate): ThreadMenuModel {
  const move = !isRecordedSubagent(state, thread.sessionId) && thread.origin !== 'subagent'
  return {
    move,
    notice: move ? null : t(MOVE_SUBAGENT_NOTICE_KEY),
  }
}

/**
 * The destination the 「移动到…」 picker starts on.
 *
 * The efficiency the menu's old shortcut carried lives here instead, where the
 * destination is visible before it is used: the topic the reader has selected
 * wins while it is a legal destination of the conversation's own Workspace —
 * that is the topic they are looking at — and otherwise the conversation starts
 * on its current home, its node or its Workspace row. Every step of the fallback
 * is a destination the model accepts, so the default is never a disabled option.
 * @param state - the map.
 * @param thread - the conversation being moved.
 * @param selectedTopic - the topic the reader has selected, if any.
 * @returns the picker's initial value: a node id, or `''` for the Workspace row.
 */
export function threadMoveDefault(
  state: MapState,
  thread: ThreadRef,
  selectedTopic: MapNode | undefined,
): string {
  if (selectedTopic !== undefined
    && !inArchive(state, selectedTopic.id)
    && workspaceOfNode(selectedTopic) === (thread.workspaceId ?? null)
    && assignThreadIssue(state, thread.sessionId, selectedTopic.id) === null) {
    return selectedTopic.id
  }
  return thread.nodeId ?? ''
}

/**
 * The selection that survives archiving one topic.
 *
 * Archiving is a put-away action, not navigation. A reader who selected another
 * row keeps looking at that row; only when the archived topic itself was the
 * selection does the cursor have to move somewhere the rows still exist — one
 * level up to its parent, or the Workspace row for a root, exactly like
 * deleting the topic. Jumping to the archive row instead would swap the open
 * column (the parent's children become the archive's contents) and read as if
 * the sibling list had changed.
 * @param state - the map before the archive write.
 * @param nodeId - the topic being archived.
 * @param selectedNodeId - the row the reader currently has selected.
 * @returns the row key to keep or adopt; `null` leaves nothing selected.
 */
export function selectionAfterArchive(
  state: MapState,
  nodeId: string,
  selectedNodeId: string | null,
): string | null {
  if (selectedNodeId === null || selectedNodeId !== nodeId) return selectedNodeId
  const node = state.nodes.find(candidate => candidate.id === nodeId)
  if (node === undefined) return selectedNodeId
  return node.parentId ?? workspaceKey(workspaceOfNode(node))
}

/* ── the pointer drag: its pure half ─────────────────────────────────────── */

/** What a release would write; `null` means a release writes nothing at all. */
export type DragPlan = NonNullable<DropDecision['action']>

/**
 * The plan a release commits, or `null` when it must not commit.
 *
 * A refused drop (`issue`) and an unchanged one (`noop`) both answer `null`:
 * the model's own judgement decides what is legal, and a move that would write
 * the document it already has is simply not written.
 * @param decision - what the pointer's target resolved to.
 * @returns the plan to hand the store, or null.
 */
export function planFromDecision(decision: DropDecision): DragPlan | null {
  return decision.issue === null && !decision.noop && decision.action !== null ? decision.action : null
}

/**
 * Write one committed drag.
 *
 * Both payloads land here so the pointer and the dialogs share one commit path:
 * a conversation is filed with `assignThreads`, a topic is re-parented and
 * slotted with `insertNodeBefore` (the model's DOM-insertBefore-shaped move).
 * @param current - the map.
 * @param plan - the decision's plan.
 * @returns the updated map.
 */
export function applyDragPlan(current: MapState, plan: DragPlan): MapState {
  return plan.kind === 'thread'
    ? assignThreads(current, [plan.sessionId], plan.nodeId)
    : insertNodeBefore(current, plan.nodeId, plan.parentId, plan.beforeNodeId ?? undefined)
}

/** A flag one caller sets and the next click consumes, at most once. */
export interface OneShot {
  pending: boolean
}

/**
 * Take a one-shot flag, if it is set.
 *
 * The drag release is followed by a `click` on whatever the pointer landed on,
 * so the gesture has to eat exactly that one click — and no later one. Taking
 * the flag is therefore the only way to read it: the second caller gets false.
 * @param flag - the mutable flag.
 * @returns true the first time it is called while set.
 */
export function consumeOneShot(flag: OneShot): boolean {
  if (!flag.pending) return false
  flag.pending = false
  return true
}

/** How the pointer's label reads a decision: refused, unchanged, or a real move. */
export function dragLabelTone(decision: DropDecision): 'invalid' | 'noop' | 'valid' {
  if (decision.issue !== null) return 'invalid'
  return decision.noop ? 'noop' : 'valid'
}

/**
 * The follow-the-pointer label's inline style.
 *
 * Inline on purpose: the plugin's sheet is being edited concurrently, so the
 * gesture's own visuals travel with the element that draws them. Only existing
 * theme tokens are used, so the label follows light and dark like the band.
 * @param tone - what the label is reporting.
 * @returns the label's style.
 */
export function dragLabelStyle(tone: 'invalid' | 'noop' | 'valid'): CSSProperties {
  const color = tone === 'invalid'
    ? 'var(--dsw-alias-state-error-primary, #d9534f)'
    : tone === 'noop'
      ? 'var(--dsw-alias-label-secondary, currentColor)'
      : 'var(--dsw-alias-brand-primary, currentColor)'
  return {
    position: 'fixed',
    left: 0,
    top: 0,
    zIndex: 30,
    pointerEvents: 'none',
    maxWidth: 260,
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    lineHeight: '18px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color,
    background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff))',
    border: `1px solid ${tone === 'invalid' ? color : 'var(--dsw-alias-border-l1, transparent)'}`,
  }
}

/**
 * The label the pointer carries: what releasing here would do.
 *
 * Hidden from assistive technology on purpose — it changes on every row the
 * pointer crosses, and the keyboard path to the same move is the 「移动到…」
 * dialog, which names its destination in a real form control.
 * @param props - the decision's label and tone.
 * @returns the label element.
 */
export function DragLabel(props: {
  label: string
  tone: 'invalid' | 'noop' | 'valid'
  /** The map positions it by writing to this node's transform, per frame. */
  elementRef?: Ref<HTMLDivElement>
}): ReactNode {
  return (
    <div ref={props.elementRef} data-drag-label={props.tone} aria-hidden="true" style={dragLabelStyle(props.tone)}>
      {props.label}
    </div>
  )
}

/* ── U3 hysteresis: the candidate the pointer left behind ────────────────── */

/** What the pointer's label and marks show while a drag is in flight. */
export interface DragOverlayState {
  label: string
  tone: 'valid' | 'invalid' | 'noop'
  /** The group to mark; `null` only before the first group is ever reached. */
  groupKey: string | null
  /** The insertion intent the group carries; `null` for a workspace/no target. */
  mode: 'into' | 'before' | 'after' | null
  insertEdge: InsertEdge | null
  /** The pointer left every group; the candidate is kept as a hint (U3). */
  held: boolean
}

/**
 * Hold the last candidate after the pointer leaves every row.
 *
 * A gutter, a column's blank tail or the band's edge is not a new target, and
 * blanking the mark would tell the reader their aim was lost. The candidate
 * stays — marked `data-drop-group="held"` — while a release there still commits
 * nothing (the commit reads the live hit, never this).
 * @param current - the indicator as it stands.
 * @returns the held indicator, the same object when it is already held.
 */
export function heldOverlay(current: DragOverlayState | null): DragOverlayState | null {
  return current === null || current.held ? current : { ...current, held: true }
}

/* ── U4: auto scroll and spring loading ─────────────────────────────────── */

/** Dead zone at a strip's edge that starts auto scrolling, in CSS pixels. */
export const AUTO_SCROLL_EDGE_PX = 18
/** Fastest auto scroll, in CSS pixels per frame. */
export const AUTO_SCROLL_MAX_PX = 18
/** Slowest auto scroll, in CSS pixels per frame. */
const AUTO_SCROLL_MIN_PX = 2
/** How long the pointer must rest on a row before its column springs open. */
export const SPRING_LOAD_MS = 600

/**
 * How far one axis should scroll this frame.
 *
 * The speed ramps with how deep the pointer is inside the dead zone, so a
 * nudge scrolls slowly and a push against the edge scrolls fast; the sign is
 * the direction the content must move.
 * @param position - pointer position on the axis, in viewport coordinates.
 * @param start - the strip's leading edge.
 * @param end - the strip's trailing edge.
 * @param edge - the dead zone's width.
 * @returns pixels to scroll this frame, negative towards the start.
 */
export function autoScrollStep(
  position: number,
  start: number,
  end: number,
  edge: number = AUTO_SCROLL_EDGE_PX,
): number {
  // A strip narrower than its own two dead zones cannot be aimed at: leave it be.
  if (end - start <= edge * 2) return 0
  const ramp = (depth: number): number =>
    Math.min(AUTO_SCROLL_MAX_PX, Math.max(AUTO_SCROLL_MIN_PX, Math.round(depth * 1.2)))
  if (position < start + edge) return -ramp(start + edge - position)
  if (position > end - edge) return ramp(position - (end - edge))
  return 0
}

/**
 * Whether a topic row should open its next column under a resting pointer.
 *
 * Only a row that has children and whose column is not on screen yet has
 * anything to open: springing a leaf open, or a row whose children are already
 * listed beside it, would move the columns for nothing (U4).
 * @param state - the map.
 * @param nodeId - the row the pointer rests on.
 * @param childColumnVisible - whether one of its children is already rendered.
 * @returns true when selecting the row would reveal new targets.
 */
export function springLoadTarget(state: MapState, nodeId: string, childColumnVisible: boolean): boolean {
  return !childColumnVisible && activeChildrenOf(state, nodeId).length > 0
}

/* ── the strip's start fade ────────────────────────────────────────────── */

/**
 * Whether the node strip has columns scrolled out of view at its start.
 *
 * The stylesheet fades that side while this reads true. The resting
 * window-edge gutter is not a substitute: it belongs to the first column's
 * content and scrolls out of view with it, leaving the window edge cutting
 * whatever column happens to be there. The 1px tolerance is the shell's own —
 * a sub-pixel scroll position is not a scroll (ui-dockkit's `hiddenSides`,
 * ui-workspace's `placeTitle`). The end side is not read: its cut lands on the
 * band's seam, where the hairline and the resize handle already state the
 * boundary.
 * @param box - the strip's scroll metrics.
 * @returns true while columns are out of view at the strip's start.
 */
export function scrolledFromStart(box: { scrollLeft: number }): boolean {
  return box.scrollLeft > 1
}

/* ── U6: what follows a committed move ──────────────────────────────────── */

/** What the view does once a move has landed. */
export interface MoveFollow {
  /** The row to bring back into view: a `data-node-id` / `data-session-id` value. */
  focusKey: string | null
  /** The row key to unfold, in the view's own vocabulary, or null. */
  expandKey: string | null
  /** The selection to adopt, or null when the reader's selection stays. */
  selectedNodeId: string | null
}

/**
 * Follow one committed move with the view (U6).
 *
 * The row that moved is the thing to look at, so it is what gets scrolled into
 * view; a move into a folded row unfolds it, or the reader would be told a
 * conversation moved and shown nothing. When the conversation being read is the
 * one that moved, the highlighted node follows it — the map's own rule is that
 * the highlight names what is on screen.
 * @param state - the map, before the move is applied.
 * @param plan - the move that was committed.
 * @param current - what the reader currently has open.
 * @returns the follow-up the panel applies.
 */
export function followAfterMove(
  state: MapState,
  plan: DragPlan,
  current: { openSessionId: string | null },
): MoveFollow {
  if (plan.kind === 'node') {
    return { focusKey: plan.nodeId, expandKey: plan.parentId, selectedNodeId: null }
  }
  const thread = threadOfSession(state, plan.sessionId)
  const workspaceId = thread?.workspaceId ?? null
  const home = plan.nodeId ?? (workspaceId === null ? null : workspaceKey(workspaceId))
  return {
    focusKey: plan.sessionId,
    expandKey: home,
    selectedNodeId: current.openSessionId === plan.sessionId ? home : null,
  }
}

/* ── U7: the wording a refused move wears ───────────────────────────────── */

/**
 * The dictionary key of one refusal's dialog-shaped wording.
 *
 * These are longer than the pointer's short labels on purpose: a failed commit
 * has room to explain itself. The model's code is the identity the wording is
 * chosen by; a code missing here falls through to {@link describeError}.
 */
export const MOVE_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  NOT_FOUND: 'panel.moveIssue.NOT_FOUND',
  DEPTH: 'panel.moveIssue.DEPTH',
  ANCHOR: 'panel.moveIssue.ANCHOR',
  WORKSPACE: 'panel.moveIssue.WORKSPACE',
}

/**
 * The message a failed move shows.
 *
 * A refusal the model states in its own vocabulary is restated in the reader's
 * ("移动" throughout, and no model jargon); anything else — a transport failure,
 * a store conflict — keeps its own wording rather than being flattened into a
 * generic one.
 * @param t - the active translator.
 * @param error - whatever the store rejected with.
 * @returns the message for the band's error line.
 */
export function moveFailureMessage(t: Translate, error: unknown): string {
  // Duck-typed as well as `instanceof`: a refusal can cross a module boundary
  // (the Host half, a render test's own copy of the model), and the code is what
  // the reader's wording is chosen by either way.
  const code = error instanceof MapError
    ? error.code
    : typeof (error as { code?: unknown } | null)?.code === 'string'
      ? (error as { code: string }).code
      : null
  const key = code === null ? undefined : MOVE_ISSUE_MESSAGES[code]
  return key === undefined ? describeError(t, error) : t(key, { max: MAX_DEPTH })
}

/* ── D9: where a node lands among its new siblings ──────────────────────── */

/**
 * The siblings a node may be placed in front of.
 *
 * Same parent, same Workspace, the node itself left out — a node cannot be
 * inserted before itself, and the model's own sibling order is what the reader
 * sees, so the list is sorted the way the columns sort it.
 * @param state - the map.
 * @param parentId - the parent the node will live under; `null` = the Workspace.
 * @param workspaceId - the Workspace those siblings must belong to.
 * @param excludeId - the node being placed, if it exists yet.
 * @returns the anchors, in display order.
 */
export function siblingTargets(
  state: MapState,
  parentId: string | null,
  workspaceId: string | null,
  excludeId?: string | undefined,
): MapNode[] {
  return state.nodes
    .filter(node => node.parentId === parentId
      && workspaceOfNode(node) === (workspaceId ?? null)
      && node.id !== excludeId
      && !inArchive(state, node.id))
    .sort((left, right) => left.position - right.position || left.title.localeCompare(right.title))
}

/** Props of the 「位置」 field the node dialog carries. */
export interface NodePositionFieldProps {
  state: MapState
  /** The parent the node will live under. */
  parentId: string | null
  workspaceId: string | null
  /** The node being edited, excluded from its own sibling list. */
  selfId?: string | undefined
  /** The chosen anchor, in the select's vocabulary: `''` = the end. */
  value: string
  onChange: (next: string) => void
}

/**
 * D9: choose where among its siblings a node lands.
 * @param props - the map, the destination parent, and the chosen anchor.
 * @returns the field.
 */
export function NodePositionField(props: NodePositionFieldProps): ReactNode {
  const t = useT()
  const anchors = siblingTargets(props.state, props.parentId, props.workspaceId, props.selfId)
  return (
    <div className="cm-field">
      <label htmlFor="cm-node-position">{t('panel.position')}</label>
      <select
        id="cm-node-position"
        className="cm-select"
        value={props.value}
        onChange={(event) => { props.onChange(event.target.value) }}
      >
        <option value="">{t('panel.positionEnd')}</option>
        {anchors.map(node => <option key={node.id} value={node.id}>{t('panel.positionBefore', { title: node.title })}</option>)}
      </select>
    </div>
  )
}

/* ── create context: where the new node will land ───────────────────────── */

/** Props of the read-only location rail the create dialog carries. */
export interface NodeLocationRailProps {
  /** The Workspace the new node will belong to, already display-resolved. */
  workspaceLabel: string
  /** Root-to-parent chain of the parent the new node will land under; empty = Workspace top level. */
  ancestors: MapNode[]
}

/** A folder mark for the rail's Workspace root. */
function LocationFolderGlyph(): ReactNode {
  return (
    <svg className="cm-loc-folder" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M1.8 4.4c0-.7.6-1.3 1.3-1.3h3l1.3 1.5h5.5c.7 0 1.3.6 1.3 1.3v5.3c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The create dialog's location rail.
 *
 * Every entry point already named the parent, so the dialog states where the
 * node will land instead of offering a location picker. The rail is read-only:
 * the Workspace root and the parent stay visible, older ancestors collapse into
 * `…` when the 420px card cannot fit them, and widening the rail brings them
 * back.
 * @param props - the Workspace label and the parent's ancestor chain.
 * @returns the field.
 */
export function NodeLocationRail(props: NodeLocationRailProps): ReactNode {
  const t = useT()
  const [trim, setTrim] = useState(0)
  const railRef = useRef<HTMLDivElement | null>(null)
  // A different parent is a different context: start from the full chain again.
  const contextKey = `${props.workspaceLabel}\u0000${props.ancestors.map(node => `${node.id}:${node.title}`).join('\u0000')}`
  const maxTrim = Math.max(0, props.ancestors.length - 1)
  const effectiveTrim = Math.min(trim, maxTrim)
  const shown = props.ancestors.slice(effectiveTrim)
  const parent = props.ancestors.length === 0 ? null : props.ancestors[props.ancestors.length - 1]
  const fullPath = [props.workspaceLabel, ...props.ancestors.map(node => node.title)].join(' / ')
  const label = parent === null
    ? t('panel.dialogLocationAriaTop', { workspace: props.workspaceLabel })
    : t('panel.dialogLocationAria', { path: fullPath })

  useEffect(() => { setTrim(0) }, [contextKey])

  // Collapse the oldest ancestor while an older, still-shown crumb ellipsizes.
  useLayoutEffect(() => {
    const rail = railRef.current
    if (rail === null || effectiveTrim >= maxTrim) return
    for (const crumb of rail.querySelectorAll<HTMLElement>('.cm-loc-crumb[data-ancestor="true"]')) {
      if (crumb.scrollWidth > crumb.clientWidth + 1) {
        setTrim(value => Math.min(value + 1, maxTrim))
        return
      }
    }
  }, [effectiveTrim, maxTrim, contextKey])

  // Wider rail: let the collapsed ancestors come back.
  useEffect(() => {
    const rail = railRef.current
    if (rail === null || typeof ResizeObserver === 'undefined') return undefined
    let width = rail.clientWidth
    const observer = new ResizeObserver(() => {
      if (rail.clientWidth > width) setTrim(0)
      width = rail.clientWidth
    })
    observer.observe(rail)
    return () => { observer.disconnect() }
  }, [])

  return (
    <div className="cm-loc-field">
      <div className="cm-loc-label">{t('panel.dialogLocation')}</div>
      <div className="cm-loc-rail" role="group" aria-label={label} ref={railRef}>
        <div className="cm-loc-crumbs" aria-hidden="true">
          <span className="cm-loc-crumb is-root" title={props.workspaceLabel}>
            <LocationFolderGlyph />
            {props.workspaceLabel}
          </span>
          {effectiveTrim > 0 && (
            <>
              <span className="cm-loc-sep">›</span>
              <span className="cm-loc-more" title={t('panel.dialogLocationFullPath', { path: fullPath })}>…</span>
            </>
          )}
          {shown.map((node, index) => {
            const isParent = index === shown.length - 1
            return (
              <Fragment key={node.id}>
                <span className="cm-loc-sep">›</span>
                <span
                  className={isParent ? 'cm-loc-crumb is-parent' : 'cm-loc-crumb'}
                  data-ancestor={isParent ? undefined : 'true'}
                  title={node.title}
                >
                  {node.title}
                </span>
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── BL-2/BL-3: the move picker as a tree ───────────────────────────────── */

/** One row of the 「移动到…」 tree. */
export interface MoveTreeRow {
  /** Stable key: `''` for the Workspace row itself, else a node id. */
  key: string
  label: string
  /** `0` is the Workspace row; a top-level topic sits at `1`. */
  depth: number
  /** `null` = the Workspace row itself. */
  nodeId: string | null
  hasChildren: boolean
  /** The model would refuse this destination. */
  disabled: boolean
}

/**
 * Build the move picker's tree.
 *
 * The same document walk as {@link threadMoveTargets}, but kept nested so the
 * picker can fold a branch away: depth-first order, roots in display order, and
 * the Workspace row (`depth 0`) always first. A hand-built document with a cycle
 * cannot make the list grow — an id is emitted once.
 * @param state - the map.
 * @param sessionId - the conversation being moved.
 * @param workspaceId - its Workspace; `null` = the ungrouped bucket.
 * @param t - the active translator (its dictionary names the Workspace row).
 * @returns every destination, in the order the tree shows them.
 */
export function moveTreeRows(
  state: MapState,
  sessionId: string,
  workspaceId: string | null,
  t: Translate,
): MoveTreeRow[] {
  const wanted = workspaceId ?? null
  const children = new Map<string, MapNode[]>()
  for (const node of state.nodes) {
    if (node.parentId === null) continue
    const siblings = children.get(node.parentId)
    if (siblings === undefined) children.set(node.parentId, [node])
    else siblings.push(node)
  }
  const ordered = (nodes: readonly MapNode[]): MapNode[] =>
    [...nodes].sort((left, right) => left.position - right.position || left.title.localeCompare(right.title))
  const rows: MoveTreeRow[] = [{
    key: '',
    label: t('common.workspaceTopLevel'),
    depth: 0,
    nodeId: null,
    hasChildren: false,
    disabled: assignThreadIssue(state, sessionId, null) !== null,
  }]
  const seen = new Set<string>()
  const walk = (node: MapNode, depth: number): void => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    const kids = ordered((children.get(node.id) ?? []).filter(child => workspaceOfNode(child) === wanted))
    rows.push({
      key: node.id,
      label: node.title,
      depth,
      nodeId: node.id,
      hasChildren: kids.length > 0,
      disabled: assignThreadIssue(state, sessionId, node.id) !== null,
    })
    for (const kid of kids) walk(kid, depth + 1)
  }
  for (const root of ordered(state.nodes.filter(node => node.parentId === null && workspaceOfNode(node) === wanted))) {
    walk(root, 1)
  }
  return rows
}

/**
 * The rows a folded tree shows.
 *
 * A folded row hides its whole subtree, which is every following row deeper than
 * it — the flat list is depth-first, so that is a single depth comparison.
 * @param rows - the full tree, in display order.
 * @param collapsed - the keys whose children are hidden.
 * @returns the visible rows.
 */
export function visibleTreeRows(
  rows: readonly MoveTreeRow[],
  collapsed: ReadonlySet<string>,
): MoveTreeRow[] {
  const visible: MoveTreeRow[] = []
  let hiddenBelow: number | null = null
  for (const row of rows) {
    if (hiddenBelow !== null) {
      if (row.depth > hiddenBelow) continue
      hiddenBelow = null
    }
    visible.push(row)
    if (row.hasChildren && collapsed.has(row.key)) hiddenBelow = row.depth
  }
  return visible
}

/**
 * Move the tree's cursor by one row, skipping destinations the model refuses.
 * @param rows - the visible rows.
 * @param from - the current index.
 * @param delta - `1` for down, `-1` for up.
 * @returns the next index, clamped at the ends.
 */
export function treeStep(rows: readonly MoveTreeRow[], from: number, delta: 1 | -1): number {
  let index = from + delta
  while (index >= 0 && index < rows.length && rows[index].disabled) index += delta
  return index >= 0 && index < rows.length ? index : from
}

/** The dialog's own class list: the move picker gets its modifier (BL-2). */
export function dialogClass(draft: Draft): string {
  return draft.kind === 'move-thread' ? 'cm-dialog cm-dialog--move' : 'cm-dialog'
}

/**
 * Whether a dialog commits when Enter is pressed in one of its one-line inputs.
 *
 * Only the five kinds whose first field is a single-line `<input>` take part.
 * The node dialog's description `<textarea>` needs Enter for its own line
 * breaks, the three `<select>` pickers and the move tree consume it natively,
 * and the three delete confirmations hold no input at all — Enter must never be
 * a way to confirm a destructive dialog (03-keyboard-enter §3.4).
 * @param kind - the open dialog's kind.
 * @returns `true` when Enter presses that dialog's primary button.
 */
export function enterCommits(kind: Draft['kind']): boolean {
  return kind === 'node' || kind === 'workspace-create' || kind === 'workspace-rename'
    || kind === 'space-create' || kind === 'space-rename'
}

/**
 * Whether one keydown is a plain, finished Enter press.
 *
 * An IME's confirming Enter arrives with `isComposing` (or as legacy
 * `keyCode` 229 when the browser reports composition only that way), and it
 * belongs to the IME: committing there would submit a half-typed word.
 * Shift+Enter is a line break wherever it means anything, so it stays put.
 * @param event - the key event's relevant fields.
 * @returns `true` when the key is an Enter that should commit.
 */
export function commitsOnEnter(event: { key: string; shiftKey?: boolean; nativeEvent?: { isComposing?: boolean }; keyCode?: number }): boolean {
  if (event.key !== 'Enter' || event.shiftKey === true) return false
  if (event.nativeEvent?.isComposing === true || event.keyCode === 229) return false
  return true
}

/** A house: the breadcrumb's root glyph ("全部空间"). 16-unit box. */
function HomeGlyph(): ReactNode {
  return (
    <svg className="cm-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 7.2 8 2.9l5.2 4.3V13a.8.8 0 0 1-.8.8h-2.7V9.5H6.3v4.3H3.6a.8.8 0 0 1-.8-.8z" />
    </svg>
  )
}

/** Small chevron: the space switcher's trailing affordance. */
function ChevronGlyph(): ReactNode {
  return (
    <svg className="cm-chevron-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.6 6.4 3.4 3.2 3.4-3.2" />
    </svg>
  )
}

/**
 * Stable "the Conversation is the selected main panel" reading, for profiles
 * that cannot provide the layout's panel source.
 */
const NO_PANEL_READING = { activePanelId: null }
const NO_PANEL_INFO: ObservableSnapshot<{ activePanelId: string | null }> = {
  getSnapshot: () => NO_PANEL_READING,
  subscribe: () => () => {},
}

/**
 * Drag handle on the band's right edge: it resizes the band, and therefore the
 * shipped Conversation column, which keeps the rest of the centre.
 *
 * It draws nothing — no readout, no grab bar: the seam is the only vertical on
 * screen and the col-resize cursor carries the affordance, exactly like the
 * shipped handles. The width is exposed to assistive technology through the
 * separator's aria values, not painted.
 * @param props - current width, live ceiling, and the resize callback.
 * @returns the separator element.
 */
function BandGutter(props: { width: number; max: number; onResize: (width: number) => void }): ReactNode {
  const t = useT()
  const origin = useRef({ x: 0, width: props.width })
  return (
    <div
      className="cm-band-gutter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('panel.resizeBand')}
      aria-valuemin={MIN_MAP_WIDTH}
      aria-valuemax={Math.round(props.max)}
      aria-valuenow={Math.round(props.width)}
      onPointerDown={(event) => {
        origin.current = { x: event.clientX, width: props.width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const delta = event.clientX - origin.current.x
        props.onResize(clampMapWidth(origin.current.width + delta, props.max))
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />
  )
}

/** The catalog row shape the page reads through the framework hook. */
interface CatalogByIdRow {
  displayTitle?: string
  title?: string
  running?: boolean
  blank?: boolean
  updatedAt?: number
  /**
   * Coarse durable origin; `'subagent'` rows are reached through their parent
   * and never become rows of their own.
   */
  origin?: string
  /** Owning parent conversation: a fork's source, or a subagent child's parent. */
  parentId?: string | null
  /** Local reference counts by source; `mainView` marks the current Session. */
  retainedBy?: Readonly<Record<string, number>> | undefined
}

/**
 * The conversation a not-yet-indexed fork branched from.
 *
 * The branch action opens the child immediately, while the catalog pass that
 * files it runs on a later render. The child's own catalog row already names its
 * source, so the map can land on the source's place instead of the Workspace
 * root the fork has not been filed under yet. A subagent parent is no
 * destination (it has no row either), and a self pointer is no source.
 * @param byId - catalog rows by session id.
 * @param sessionId - the conversation the shell reports as current.
 * @returns the source conversation's id, or undefined when the row names none.
 */
function forkSourceOf(
  byId: Readonly<Record<string, { origin?: string; parentId?: string | null } | undefined>>,
  sessionId: string,
): string | undefined {
  const parentId = byId[sessionId]?.parentId
  if (typeof parentId !== 'string' || parentId === '' || parentId === sessionId) return undefined
  return byId[parentId]?.origin === 'subagent' ? undefined : parentId
}

/**
 * The view a native navigation leads to.
 *
 * Native navigation (a sidebar row, New Session, another plugin) is a map
 * navigation too: the pane follows and the map lands where the Session lives. A
 * Session filed in another space takes the map's space with it — the reader
 * named a destination by clicking it, so leaving an unrelated node strip beside
 * the pane would show two places at once.
 *
 * A subagent Session is different: the map gives it no row, so it is located by
 * its nearest visible ancestor ({@link visibleAncestorOf}). The space then stays
 * put, except when that ancestor is itself an ungrouped conversation — its own
 * space is its home, and following it is exactly what opening the parent would
 * do. A parent chain the catalog cannot name, or one that loops, leaves the
 * reader's space and selection alone; only the open Session follows, because the
 * reading pane and the highlight must never lie about what is on screen.
 *
 * A fork is a third case. The branch action opens the child before the catalog
 * pass that files it has run in this component, so the map may not have a row
 * for the child yet; the catalog row itself already names the source
 * conversation, and the index will file the branch under the source's place a
 * moment later. Landing on that place now keeps the highlight from claiming the
 * Workspace root and then jumping.
 * @param state - the map.
 * @param byId - catalog rows by session id; they carry each row's origin and parent.
 * @param owners - Session id to owning Workspace id, as the Host accounts them.
 * @param nativeCurrent - the Session the shell reports as current.
 * @param activeSpaceId - the space the reader is in.
 * @param view - the current view.
 * @returns the next view; the same object when nothing changes.
 */
export function followNativeNavigation(
  state: MapState,
  byId: Readonly<Record<string, { origin?: string; parentId?: string | null } | undefined>>,
  owners: ReadonlyMap<string, string | null>,
  nativeCurrent: string,
  activeSpaceId: string,
  view: ViewState,
): ViewState {
  const opened = view.openSessionId === nativeCurrent ? view : { ...view, openSessionId: nativeCurrent }
  // A conversation event ends the reader's browse: the tree follows again.
  const following: ViewState = opened.browsing === true ? { ...opened, browsing: false } : opened
  if (byId[nativeCurrent]?.origin !== 'subagent') {
    const thread = threadOfSession(state, nativeCurrent)
    // The fork's own row can lag the navigation that opens it; the source's
    // place is the destination the index is about to give the child. A source
    // neither the index nor the Host accounting can name is no destination, so
    // the fork itself answers.
    const source = thread === undefined ? forkSourceOf(byId, nativeCurrent) : undefined
    const sourceKnown = source !== undefined
      && (threadOfSession(state, source) !== undefined || owners.get(source) !== undefined)
    const anchor = sourceKnown ? source : nativeCurrent
    const home = homeOfSession(state, anchor, owners.get(anchor))
    if (home === undefined) return following
    if (home.selection === following.selectedNodeId && home.spaceId === activeSpaceId) return following
    return { ...following, activeSpace: home.spaceId, selectedNodeId: home.selection }
  }
  // A missing parent, and a loop back to this Session, both end the walk here.
  const ancestor = visibleAncestorOf(byId, nativeCurrent)
  if (ancestor === nativeCurrent) return following
  const home = homeOfSession(state, ancestor, owners.get(ancestor))
  if (home === undefined) return following
  const parentThread = threadOfSession(state, ancestor)
  if (parentThread === undefined || (parentThread.workspaceId ?? null) !== null) {
    // The parent is filed under a Workspace or a topic: only the highlight moves.
    return home.selection === following.selectedNodeId
      ? following
      : { ...following, selectedNodeId: home.selection }
  }
  // The parent is an ungrouped conversation, so its own space is its home.
  return home.spaceId === activeSpaceId && home.selection === following.selectedNodeId
    ? following
    : { ...following, activeSpace: home.spaceId, selectedNodeId: home.selection }
}

/**
 * Whether a manual tree move leaves the open conversation's home.
 *
 * A row click is the reader browsing: the tree moves, the conversation does not.
 * Landing on the conversation's own home row (or asking for a row while nothing
 * is open) ends the excursion, so later conversation events keep following.
 * @param state - the map.
 * @param openSessionId - the open conversation, or null.
 * @param selection - the row the reader pressed.
 * @returns whether the tree is now browsing.
 */
export function browsingForRow(state: MapState, openSessionId: string | null, selection: string): boolean {
  const home = sessionHomeSelection(state, openSessionId)
  return home !== null && home.selection !== selection
}

/**
 * Whether a manual space switch leaves the open conversation's space.
 *
 * The conversation keeps rendering while the map shows another space, so that is
 * a browse; switching back to the conversation's own space ends it.
 * @param state - the map.
 * @param openSessionId - the open conversation, or null.
 * @param spaceId - the space the reader asked for.
 * @returns whether the tree is now browsing.
 */
export function browsingForSpace(state: MapState, openSessionId: string | null, spaceId: string): boolean {
  const home = sessionHomeSelection(state, openSessionId)
  return home !== null && home.spaceId !== spaceId
}

/**
 * Land the tree on the open conversation's home, unless the reader is browsing.
 *
 * This is the steady-state half of the "the tree's position is derived from the
 * conversation" rule. It is written as a pure function so the render tests can
 * drive it directly: the declared space wins over the stored one (a deleted or
 * empty scope means the default space, which is what the pane shows), and the
 * function returns the same object when the tree is already there.
 * @param state - the map.
 * @param view - the current view.
 * @param activeSpaceId - the space the map is effectively showing.
 * @returns the next view; the same object when nothing changes.
 */
export function followSessionHome(state: MapState, view: ViewState, activeSpaceId: string): ViewState {
  if (view.browsing === true || view.openSessionId === null) return view
  const home = sessionHomeSelection(state, view.openSessionId)
  if (home === null) return view
  if (home.selection === view.selectedNodeId && home.spaceId === activeSpaceId) return view
  return { ...view, activeSpace: home.spaceId, selectedNodeId: home.selection }
}

/** Projection map shape the page reads through the framework hook. */
type Projections = Readonly<Record<string, { values?: { subagentCatalog?: ReadonlyArray<{ id: string }> } }>>

/** Props one space-menu row's trailing slot composes. */
export interface SpaceMenuTrailingProps {
  /** The space's status rollup, when the map has a status source. */
  readonly rollup?: StatusRollup | undefined
  /** How many Workspaces the space holds, shown while it reports no status. */
  readonly workspaceCount: number
}

/**
 * The one number a space-menu row carries.
 *
 * A row's trailing slot holds one number, exactly like a node row (§0.2): while
 * the space has conversations in any of the four categories the status badge
 * takes the slot, so a reader can tell which space needs a look without
 * switching into it; an idle space keeps the shipped Workspace count. The
 * counts are the tree's own counting rule (open conversation's attention
 * excluded, running kept as context, nothing expires), so a space's badge adds
 * up to what its node rows show.
 * @param props - the space's rollup and Workspace count.
 * @returns the status badge, or the product's Workspace count.
 */
export function SpaceMenuTrailing({ rollup, workspaceCount }: SpaceMenuTrailingProps): ReactNode {
  const t = useT()
  if (rollup !== undefined && rollup.total > 0) {
    return <StatusRollupBadge rollup={rollup} density="cluster" scope={t('panel.scope.spaceAll')} />
  }
  return (
    <span className="cm-space-count" title={t('panel.workspaceCount', { n: workspaceCount })}>
      {workspaceCount}
    </span>
  )
}

/**
 * Render the map band.
 *
 * The DSH locale service is read here and handed to the subtree through the
 * locale context, so a language switch re-renders the band and every nested
 * component (the columns, the dialogs, the pointer label) reads the new
 * dictionary through {@link useT}.
 * @param props - framework render share plus the Sessions and Workspaces services.
 * @returns the positioned band, or nothing while it cannot be measured.
 */
export function MapPanel(props: MapPanelProps): ReactNode {
  const t = useLocaleT(props.services.locale)
  return <LocaleProvider translator={t}><MapPanelView {...props} /></LocaleProvider>
}

/** The band body, rendered under the locale provider {@link MapPanel} mounts. */
function MapPanelView(props: MapPanelProps): ReactNode {
  const t = useT()
  const { services } = props
  const ids = (props.useSessions?.((state) => state.ids) ?? []) as string[]
  const byId = (props.useSessions?.((state) => state.byId) ?? {}) as Record<string, CatalogByIdRow>

  // The application's own unified status source, the same one its sidebar rows
  // read: pending requests, live activity, and unread completions all come from
  // here, so the map never invents a status of its own.
  const statuses = (props.useSessionStatus?.((snapshot) => snapshot) ?? NO_STATUS) as ReadonlyMap<string, SessionStatusLike>
  const projections = (props.useSessions?.((state) => state.projectionsBySession) ?? {}) as Projections

  // The Host's Workspace list is the map's first level. `phase` separates "not
  // arrived yet" from "no Workspaces": rendering the former as an empty list
  // would move every conversation to the ungrouped bucket for a frame.
  // The catalog arrives asynchronously too: while it is pending, an empty id
  // list says "not loaded yet", not "every conversation is gone". Any pass over
  // the persisted index has to wait for it, or restoring the map at boot would
  // prune the reader's conversations before the Host has named them.
  const catalogPhase = (props.useSessions?.((state) => state.phase) ?? 'ready') as 'pending' | 'ready' | undefined
  const catalogReady = catalogPhase === undefined || catalogPhase === 'ready'

  const workspaceSnapshot = useSnapshot(services.workspaces.list)
  const workspaces = workspaceSnapshot.items
  const workspaceReady = workspaceSnapshot.phase === undefined || workspaceSnapshot.phase === 'ready'
  const workspaceSignature = `${workspaceReady ? 'ready' : 'pending'}|${workspaces
    .map(workspace => `${workspace.workspaceId}\u0001${workspace.title}\u0001${workspace.path}\u0001${workspace.sessionIds.join(',')}`)
    .join('\u0000')}`

  /** Session id → owning Workspace id (null for ungrouped), from the Host list. */
  const owners = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) map.set(sessionId, workspace.workspaceId)
    }
    return map
    // The signature is the value identity of the list; the rows themselves are
    // re-created by every snapshot, so depending on them would loop.
  }, [workspaceSignature])

  const fallbackStore = useMemo(browserStorage, [])
  /** Backing store for view state only; the business document lives in the Host store. */
  const store = props.storage ?? fallbackStore
  // The authoritative business document is a projection of the Host file. The
  // store owns loading/migration, optimistic commits, and the polling loop; the
  // page reads one immutable snapshot and routes every mutation through it.
  // The server snapshot equals the client one: tests render this page with
  // `renderToStaticMarkup`, where the store's snapshot is already final.
  const snapshot = useSyncExternalStore(
    services.store.subscribe,
    services.store.getSnapshot,
    services.store.getSnapshot,
  )
  const state = snapshot.doc
  // The band is the only writer of the view document. It loads the remembered
  // document at mount (fresh, even if another window wrote in the meantime) and
  // publishes it to the bridge; the composer-side entry starts inert
  // (`mapVisible: false`) and only sees a snapshot after this panel is up, so
  // there is no second owner and no stale pre-mount reading.
  const [view, setView] = useState<ViewState>(() => loadView(store))
  // The latest committed view, for the bridge's unmount publish: a ref so the
  // cleanup reads the document this render committed, not the one its effect
  // closed over.
  const viewRef = useRef(view)
  viewRef.current = view
  const [draft, setDraft] = useState<Draft | null>(null)
  // The IME's own state, tracked beside the draft because Safari can deliver
  // the confirming Enter only after `compositionend`, when the event's own
  // `isComposing` is already `false` (see `commitOnEnter`).
  const composingRef = useRef(false)
  const [menu, setMenu] = useState<MenuRequest | null>(null)
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number } | null>(null)
  /** The space trigger that opened the menu: focus returns here when it is dismissed by keyboard. */
  const spaceTriggerRef = useRef<HTMLButtonElement | null>(null)
  // The top bar's overflow. Maintenance actions (a manual catalog pull) are not
  // a first-level control: they live in a menu the reader opens on purpose.
  // Anchored by its right edge because the trigger sits at the window's right.
  const [overflowMenu, setOverflowMenu] = useState<{ right: number; top: number } | null>(null)
  const [query, setQuery] = useState('')
  // 搜索不再常驻：第一行有一个放大镜，点它（或 ⌘K）才在第二行就地展开输入；
  // 关闭时清空查询，避免“结果还在、输入框没了”的悬空状态。
  const [searchOpen, setSearchOpen] = useState(false)
  // Which result row the keyboard cursor is on (-1 = none). The search view is
  // a flat list, so ↑/↓ walk it directly instead of moving DOM focus.
  const [activeResult, setActiveResult] = useState(-1)
  // Conversation-body hits from the Host index, keyed by session id. The index
  // fills in over several RPC calls, so hits arrive progressively.
  const [contentHits, setContentHits] = useState<Map<string, ContentSearchHit>>(() => new Map())
  const [contentProgress, setContentProgress] = useState<{ scanned: number; total: number; done: boolean } | null>(null)
  // A profile whose Host half predates the body index (the client half hot
  // reloads, the Host process does not) answers `undefined`; the panel then
  // gives up on body search instead of leaving a progress row on screen forever.
  const [bodySearchUnsupported, setBodySearchUnsupported] = useState(false)
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  // The create dialog validates its one required field locally: the model's own
  // refusals stay on the shared error line, while a blank title never reaches a
  // write at all. The ref puts focus back on the field after a failed submit.
  const [nodeTitleError, setNodeTitleError] = useState(false)
  const nodeTitleRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  // True while a directory chooser is out: the shell's dialog is window-owned
  // (or, without it, the Host's OS panel is on screen), so a second request
  // must not stack another one behind it.
  const [picking, setPicking] = useState(false)

  const [now, setNow] = useState(() => Date.now())

  // The status observation is in-memory and per client instance; it is absent in
  // pure render tests and in profiles without the Session status face. The page
  // still renders every conversation, just without the node rollups.
  const statusLedger = services.statusLedger
  const observed = useSyncExternalStore(
    useCallback(notify => statusLedger?.subscribe(notify) ?? (() => {}), [statusLedger]),
    useCallback(() => statusLedger?.getSnapshot() ?? NO_OBSERVED, [statusLedger]),
    useCallback(() => statusLedger?.getSnapshot() ?? NO_OBSERVED, [statusLedger]),
  )
  // The panel folds the live snapshot in while it is mounted; the sidebar entry
  // does the same while the band is collapsed. Neither pass prunes here: the
  // catalog owner prunes, so a panel pass cannot drop a session that belongs to
  // another space.
  useEffect(() => {
    statusLedger?.observe(statuses)
  }, [statusLedger, statuses])
  // Opening a conversation is also the acknowledgement for an error marker;
  // unread completions are cleared by the product itself when it becomes main.
  useEffect(() => {
    if (view.openSessionId !== null) statusLedger?.acknowledge(view.openSessionId)
  }, [statusLedger, view.openSessionId])

  /**
   * One category per indexed conversation, for the rollup pass.
   *
   * Precedence follows the shipped rows (pending > running > unread completion)
   * with the forwarded error overlaid only while the session is not running.
   * The conversation open in the reading pane is excluded from the attention
   * side: the reader is already looking at it. Running remains visible there as
   * live context.
   */
  const categories = useMemo(() => {
    const next = new Map<string, ObservedSessionStatus>()
    const errors = statusLedger?.getErrors()
    for (const thread of state.threads) {
      const sessionId = thread.sessionId
      const status = statuses.get(sessionId)
      const children = projections[sessionId]?.values?.subagentCatalog ?? []
      const subagentRunning = children.some(child =>
        statuses.get(child.id)?.running === true || byId[child.id]?.running === true)
      const running = status?.running === true || subagentRunning
      const open = view.openSessionId === sessionId
      const previous = observed.get(sessionId)
      let category: StatusCategory | undefined
      if (open) category = running ? 'running' : undefined
      else if (status?.pendingInteraction !== undefined) category = 'pending'
      else if (running) category = 'running'
      else if (errors?.get(sessionId) !== undefined) category = 'error'
      else if (status?.completionUnread === true) category = 'done'
      if (category === undefined) continue
      next.set(sessionId, {
        category,
        // A category that has not moved keeps its original stamp; a first
        // observation has no stamp, so it cannot light the "new" halo.
        changedAt: previous?.category === category ? previous.changedAt : 0,
      })
    }
    // Completions the product cannot mark: a turn that stopped while a global
    // panel covered the Conversation (the sidebar row observes the transition —
    // see completion-watch.ts). They are shown exactly like an unread completion
    // and cleared when the conversation is opened (the ledger's acknowledge), so
    // the tree and the sidebar cluster always agree.
    for (const [sessionId, completedAt] of statusLedger?.getCompletions() ?? []) {
      if (next.has(sessionId) || view.openSessionId === sessionId) continue
      if (!state.threads.some(thread => thread.sessionId === sessionId)) continue
      next.set(sessionId, { category: 'done', changedAt: completedAt })
    }
    return next
  }, [state.threads, statuses, projections, byId, view.openSessionId, observed, statusLedger])

  /**
   * The document as the active tree sees it.
   *
   * Archived topics (and their subtrees) and individually archived conversations
   * are still indexed — they are searchable and openable — but they must not
   * contribute to any row's counts or status badge. Every aggregation below
   * reads this projection instead of the raw document.
   */
  const activeRows = useMemo(() => activeMapView(state), [state])

  /** One rollup per node, Workspace, and the ungrouped bucket. */
  const statusRollups = useMemo(() => rollupStatuses({
    nodes: activeRows.nodes,
    threads: activeRows.threads,
    statuses: categories,
    openSessionId: view.openSessionId,
    showRunning: true,
    now,
  }), [activeRows, categories, view.openSessionId, now])

  const rollupForThreads = useCallback((threads: readonly ThreadRef[]): StatusRollup => {
    if (threads.length === 0) return emptyStatusRollup()
    return rollupStatuses({
      nodes: [],
      threads: threads.map(thread => ({ sessionId: thread.sessionId, nodeId: null })),
      statuses: categories,
      openSessionId: view.openSessionId,
      showRunning: true,
      now,
    }).ungrouped
  }, [categories, view.openSessionId, now])

  // The band is a frame-wide overlay: it must follow the shipped Conversation
  // column's live geometry (a right Sidebar, a window resize, and the left
  // column's collapse all move or resize that column) and disappear while
  // another main panel is in front.
  const panelInfo = useSnapshot(services.panelInfo ?? NO_PANEL_INFO)
  const frame = useBandFrame(panelInfo.activePanelId)
  // Server rendering has no DOM to measure; the render tests still get the whole
  // map body from the fallback geometry.
  const visible = (frame.ready || typeof window === 'undefined') && panelInfo.activePanelId === null
  const maxWidth = maxMapWidth(frame.centerWidth)
  // A missing Conversation root while the Conversation is selected means the
  // product DOM no longer matches the split contract (or is still mounting). If
  // it persists, the band cannot be placed; offer an always-reachable exit
  // instead of leaving map mode with no visible control (the sidebar may be
  // fully hidden on macOS).
  const [mountFailed, setMountFailed] = useState(false)
  useEffect(() => {
    if (frame.ready || panelInfo.activePanelId !== null) {
      setMountFailed(false)
      return undefined
    }
    const timer = setTimeout(() => {
      setMountFailed(true)
      console.error('conversation-map: could not measure the Conversation column; hiding the map band')
    }, 6000)
    return () => { clearTimeout(timer) }
  }, [frame.ready, panelInfo.activePanelId])
  const bandWidth = clampMapWidth(view.mapWidth, maxWidth)
  // The band is a column, not a popup: the reader collapses it, and geometry
  // never squeezes it out. Its own minimum (MIN_MAP_WIDTH) wins over the
  // Conversation's reservation, so a cramped centre narrows the Conversation
  // instead of removing the band. Only below MIN_CENTRE_FOR_BAND can even the
  // band's minimum plus its handle not fit; there the band collapses itself so
  // exactly one control (the header's 「展开对话树」) stays on screen.
  const centreFits = !frame.ready || frame.centerWidth >= MIN_CENTRE_FOR_BAND
  const reservedWidth = centreFits ? bandWidth : 0

  useEffect(() => {
    if (!frame.ready || panelInfo.activePanelId !== null) return
    if (centreFits) return
    // Self-healing: collapse rather than leave the screen without a control.
    services.collapse?.()
  }, [frame.ready, frame.centerWidth, panelInfo.activePanelId, centreFits, services])

  // ── the view, lent to the composer-side context line ──────────────────────
  // The band remains the only writer (see view-bridge.ts): it publishes its
  // committed view for the read-only line registered in the composer dock, and
  // never reads the bridge back, so there is no feedback loop and no second
  // owner of the document. A panel without a bridge (render tests) skips it.
  const viewBridge = services.viewBridge
  useEffect(() => {
    viewBridge?.publish(view, visible && centreFits)
  }, [viewBridge, view, visible, centreFits])
  useEffect(() => {
    if (viewBridge === undefined) return undefined
    return () => { viewBridge.publish(viewRef.current, false) }
  }, [viewBridge])

  // ── spaces ───────────────────────────────────────────────────────────────
  // The space organization is part of the business document, so every value
  // here derives from `state`; the signature keeps memos stable while ordinary
  // topic/session edits change the state object.
  const orderedSpaces = spaceList(state)
  const defaultSpaceId = state.defaultSpaceId
  const spaceSignature = `${defaultSpaceId}\u0002${state.spaces
    .map(space => `${space.id}\u0001${space.title}\u0001${space.position}`)
    .join('\u0000')}\u0003${Object.entries(state.spaceOf).map(([workspaceId, spaceId]) => `${workspaceId}=${spaceId}`).join('\u0001')}`
  const activeSpaceId = state.spaces.some(space => space.id === view.activeSpace) ? view.activeSpace : defaultSpaceId
  const activeSpace: SpaceRef | undefined = state.spaces.find(space => space.id === activeSpaceId)
  const scopedWorkspaces = useMemo(
    () => workspacesInSpace(state, workspaces, activeSpaceId),
    // The two signatures are the value identity of the inputs; the rows and the
    // map object itself are re-created by every snapshot/mutation.
    [workspaceSignature, spaceSignature, activeSpaceId],
  )
  const scopedWorkspaceIds = useMemo(
    () => new Set(scopedWorkspaces.map(workspace => workspace.workspaceId)),
    [scopedWorkspaces],
  )
  const looseKey = looseRowKey(state, activeSpaceId)
  const legacyTopics = activeSpaceId === defaultSpaceId ? activeTopNodesOf(state, null) : []
  const workspaceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const space of state.spaces) counts.set(space.id, 0)
    for (const workspace of workspaces) {
      const spaceId = spaceOfWorkspace(state, workspace.workspaceId)
      counts.set(spaceId, (counts.get(spaceId) ?? 0) + 1)
    }
    return counts
  }, [workspaceSignature, spaceSignature])
  /**
   * One rollup per space, for the space switcher's menu.
   *
   * The tree in front shows one space; the menu is where a reader checks the
   * others, so it repeats the node rows' counting rule rather than inventing a
   * second one (open conversation's attention excluded — it is already in front
   * — running kept as context, nothing expires). The space of a conversation is
   * the model's own `spaceOfThread`, so the per-space badges always add up to
   * the sidebar cluster's global count.
   */
  const spaceRollups = useMemo(() => {
    const threads: SpaceRollupThread[] = activeRows.threads.map(thread => ({
      sessionId: thread.sessionId,
      nodeId: thread.nodeId,
      spaceId: spaceOfThread(state, thread),
    }))
    return rollupStatusesBySpace({
      spaces: orderedSpaces.map(space => space.id),
      threads,
      statuses: categories,
      openSessionId: view.openSessionId,
      showRunning: true,
      now,
    })
    // `spaceSignature` is the value identity of the space list and its overrides;
    // `state.threads` changes with every index snapshot, so the memo only misses
    // when a status, a space, or the index actually changed.
  }, [spaceSignature, state.threads, activeRows, categories, view.openSessionId, now])
  /**
   * The whole map's status, for the breadcrumb's root segment.
   *
   * It is the sum of the per-space rollups, not a second pass over the threads:
   * "合计 = Σ 各空间" is then true by construction, and the root can never
   * disagree with the space menu or the sidebar row about a conversation.
   */
  const allSpaceRollup = useMemo(() => mergeStatusRollups(spaceRollups.values()), [spaceRollups])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60000)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key !== 'Escape') return
      // A drag in flight is the topmost interaction: Escape drops it without
      // writing, exactly like a lost pointer.
      if (pressRef.current?.active === true) {
        cancelDrag()
        return
      }
      // Then the dialog: a reader who opened 「移动到…」 from the keyboard must be
      // able to leave it the same way. Closing clears exactly what `closeDraft`
      // clears, state by state.
      if (draft !== null) {
        setDraft(null)
        setDialogError('')
        setError('')
        return
      }
      // The space menu is the breadcrumb's own popup; Escape closes it and puts
      // focus back on the root trigger, so a keyboard reader can reopen or move on.
      if (spaceMenu !== null) {
        spaceTriggerRef.current?.focus()
        setSpaceMenu(null)
        return
      }
      if (searchOpen) {
        setSearchOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [searchOpen, draft, spaceMenu])

  useEffect(() => { saveView(store, view) }, [store, view])

  // The catalog is the index's source of truth: new sessions join the
  // Workspace the Host accounts them to, removed ones leave, and every existing
  // topic assignment is preserved. A session created but never used is not a
  // conversation yet, so it stays out of the index except while it is the open
  // one; losing focus drops its provisional row. A subagent child never joins
  // the index at all: its parent's row carries its state. A forked conversation
  // joins beside the conversation it branched from (its catalog `parentId`), so
  // the signature carries that pointer too — the row must be placed from the
  // snapshot that first reports it. The same pass reconciles the topic tree with
  // the Workspace list (legacy roots, removed Workspaces).
  const catalogSignature = `${ids.length}|${ids.map(id => `${id}:${byId[id]?.displayTitle ?? byId[id]?.title ?? ''}:${byId[id]?.blank === true ? 'blank' : ''}:${byId[id]?.origin ?? ''}:${byId[id]?.parentId ?? ''}`).join('\u0000')}`
  // The Session the shell reports as current. The uiSession binding is the
  // authoritative source the right column and the document title already follow;
  // the catalog's retained `mainView` marker is the fallback for profiles without
  // it. The fallback is read per render rather than through a signature memo:
  // a retained mainView moves between rows without changing any catalog row's
  // identity, so a memoized scan would keep naming the previous Session and
  // native navigation would never be adopted.
  const externalCurrent = useSnapshot(services.externalCurrent ?? NO_EXTERNAL_CURRENT)
  const catalogCurrent = (() => {
    for (const id of ids) {
      if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
    }
    return null
  })()
  const nativeCurrent = externalCurrent ?? catalogCurrent
  const lastNativeCurrent = useRef<string | null | undefined>(undefined)
  /**
   * The Session the map itself just asked the shell to open, until its echo
   * arrives. The map's own state update (open conversation plus its home
   * selection) is already in flight; adopting the echo could run against a
   * render that has not applied it yet and pull the selection elsewhere.
   */
  const mapNavigation = useRef<string | null>(null)

  useEffect(() => {
    if (!catalogReady) return
    // Only a *change* is adopted: the catalog lags the navigation the page just
    // made, and re-reading the same value could overwrite a freshly opened
    // conversation with the previous one until the next snapshot.
    if (lastNativeCurrent.current === nativeCurrent) return
    lastNativeCurrent.current = nativeCurrent
    // Consume the marker on every navigation event: an echo of the map's own
    // open is skipped, and any other event supersedes it.
    const echo = mapNavigation.current === nativeCurrent
    mapNavigation.current = null
    if (nativeCurrent === null) return
    if (echo) return
    // Landing is decided by `followNativeNavigation`, which also knows how a
    // subagent Session — one the map gives no row — is located by its parent.
    setView(view => followNativeNavigation(state, byId, owners, nativeCurrent, activeSpaceId, view))
  }, [catalogReady, nativeCurrent, activeSpaceId])

  /**
   * Keep the tree on the open conversation's home.
   *
   * The tree's position is derived from the conversation, and this effect is its
   * steady state: whenever the home is known and the reader is not browsing, the
   * tree lands on it. It also covers the session events no navigation call
   * announces — a fresh conversation earning its home when the catalog row
   * appears, `blank` clears, or the Host's Workspace accounting arrives. The
   * state update returns the same object when the tree is already home, so this
   * runs without re-rendering.
   */
  useEffect(() => {
    if (!catalogReady || !workspaceReady) return
    setView(current => followSessionHome(state, current, activeSpaceId))
  }, [catalogReady, workspaceReady, state, activeSpaceId, view.openSessionId, view.browsing, view.selectedNodeId])

  useEffect(() => {
    if (!catalogReady) return
    // The whole catalog goes in: `syncCatalog` applies visibility itself and has
    // to see a subagent child before dropping it, so its id reaches the ledger.
    const catalog = ids.map(id => ({
      id,
      displayTitle: byId[id]?.displayTitle ?? byId[id]?.title ?? id,
      updatedAt: byId[id]?.updatedAt,
      blank: byId[id]?.blank,
      origin: byId[id]?.origin,
      parentId: byId[id]?.parentId,
    }))
    services.store.update(previous => {
      const synced = syncCatalog(previous, catalog, {
        openSessionId: view.openSessionId,
        ...(workspaceReady ? { owners } : {}),
      })
      if (!workspaceReady) return synced.state
      return reconcileSpaces(reconcileWorkspaces(synced.state, workspaces), workspaces)
    })
    // `owners` and `workspaces` are read through the two signatures: their row
    // identities change on every snapshot even when nothing about them did.
  }, [catalogReady, catalogSignature, workspaceSignature, view.openSessionId])

  // A restored view never points at a topic, Workspace, space, or conversation
  // that is gone. The ungrouped bucket stays a valid destination, like the old
  // inbox; each space has its own row key so folding memory stays per space.
  const liveWorkspaceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const workspace of workspaces) {
      keys.add(workspaceKey(workspace.workspaceId))
      // The archive row is a live first-class selection key: keeping it here is
      // what stops a store tick from clearing a reader who is looking at it.
      keys.add(archiveKey(workspace.workspaceId))
    }
    for (const space of state.spaces) keys.add(looseRowKey(state, space.id))
    return keys
    // The signatures carry the value identity of both inputs.
  }, [workspaceSignature, spaceSignature])
  useEffect(() => {
    // Only a fully arrived Workspace list and catalog may judge what is gone.
    if (!workspaceReady || !catalogReady) return
    // The Session the shell currently shows is live by definition, even while
    // the catalog pass that files it has not run yet; dropping it here would
    // close the conversation the map just adopted from native navigation.
    const liveSessions = new Set(state.threads.map(thread => thread.sessionId))
    if (nativeCurrent !== null) liveSessions.add(nativeCurrent)
    // A Session the catalog holds but the index never gives a row to is still
    // open: a subagent child arrives through its parent's projection rather than
    // through the id list, so testing the index alone would close the very
    // conversation that was just opened.
    if (view.openSessionId !== null && byId[view.openSessionId] !== undefined) liveSessions.add(view.openSessionId)
    setView(current => reconcileView(
      current,
      new Set(state.nodes.map(node => node.id)),
      liveSessions,
      liveWorkspaceKeys,
    ))
  }, [state, liveWorkspaceKeys, workspaceReady, catalogReady, nativeCurrent, view.openSessionId])

  const selectedNodeId = view.selectedNodeId
  const results = searchMap(state, query, activeSpaceId)
  const searching = query.trim() !== ''
  const bodyQuery = query.trim()

  // Every indexed conversation the title search can see in this space. Body
  // hits are resolved back to one of these rows, so a stale Host hit (a session
  // the map dropped) can never create a row of its own.
  const candidateThreads = useMemo(
    () => state.threads.filter(thread => spaceOfThread(state, thread) === activeSpaceId),
    [state, activeSpaceId],
  )
  const workspaceLabels = workspaceTitleLabels(t)
  const workspaceTitles = useMemo(() => {
    const titles: Record<string, string> = {}
    for (const workspace of workspaces) titles[workspace.workspaceId] = workspaceDisplayTitle(workspace, workspaceLabels)
    return titles
    // `workspaceSignature` is the value identity of the Workspace list; the two
    // label strings are what a row shows, so a language switch rebuilds the map.
  }, [workspaceSignature, workspaceLabels.defaultWorkspace, workspaceLabels.workspaceFallback])
  const searchLabels = {
    ungrouped: t('common.ungrouped'),
    untitled: t('common.untitledConversation'),
    workspaceFallback: t('common.workspace'),
    archived: t('panel.archiveRow'),
  }
  const searchView = useMemo(
    () => buildSearchView({ state, results, candidateThreads, workspaceTitles, contentHits, labels: searchLabels }),
    [
      state, results, candidateThreads, workspaceTitles, contentHits,
      searchLabels.ungrouped, searchLabels.untitled, searchLabels.workspaceFallback, searchLabels.archived,
    ],
  )

  const bodySearchAvailable = typeof services.store.searchContent === 'function'

  /**
   * Search conversation bodies through the Host index.
   *
   * The Host builds its index in budgeted batches, so a reply may say
   * `done: false`; the browser then asks again shortly. Every new query restarts
   * the pass and clears the previous body hits, which keeps stale snippets from
   * lingering while the index answers.
   */
  useEffect(() => {
    if (!searching || bodyQuery.length < BODY_QUERY_MIN || !bodySearchAvailable || bodySearchUnsupported) {
      setContentHits(current => (current.size === 0 ? current : new Map()))
      setContentProgress(current => (current === null ? current : null))
      return undefined
    }
    setContentHits(current => (current.size === 0 ? current : new Map()))
    setContentProgress(null)
    let cancelled = false
    let timer: number | undefined
    const sessionIds = candidateThreads.map(thread => thread.sessionId)
    const run = async (): Promise<void> => {
      if (cancelled) return
      let reply: Awaited<ReturnType<NonNullable<typeof services.store.searchContent>>> | undefined
      try {
        reply = await services.store.searchContent?.({ query: bodyQuery, sessionIds })
      } catch (_thrown) {
        reply = undefined
      }
      if (cancelled) return
      if (reply === undefined) {
        setBodySearchUnsupported(true)
        return
      }
      setContentHits(new Map(reply.hits.map(hit => [hit.sessionId, hit])))
      setContentProgress({ scanned: reply.scanned, total: reply.total, done: reply.done })
      if (!reply.done) timer = window.setTimeout(() => { void run() }, BODY_QUERY_CONTINUE_MS)
    }
    timer = window.setTimeout(() => { void run() }, BODY_QUERY_DEBOUNCE_MS)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [searching, bodyQuery, bodySearchAvailable, bodySearchUnsupported, candidateThreads, services.store])

  // A new query is a new list: the cursor starts outside it.
  useEffect(() => { setActiveResult(-1) }, [bodyQuery, searching])

  // Keep the keyboard cursor's row visible while ↑/↓ walk the list.
  useEffect(() => {
    if (!searching || activeResult < 0) return undefined
    const frame = window.requestAnimationFrame(() => {
      document.querySelector('.cm-node-area [data-search-active="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [activeResult, searching, searchView])

  /** Why/where one hit sits: the context path, plus the highlighted snippet when there is one. */
  const searchNote = (context: string, snippet: SearchSnippet | null): ReactNode => {
    if (snippet === null) return context
    return (
      <>
        <span className="cm-search-context">{context} · </span>
        {snippet.before}
        <mark className="cm-search-mark">{snippet.match}</mark>
        {snippet.after}
      </>
    )
  }

  /** Open one result: a node jumps into the tree, a conversation opens natively. */
  const openSearchItem = (item: SearchNodeItem | SearchThreadItem): void => {
    if (item.kind === 'thread') {
      openThread(item.thread.sessionId)
      return
    }
    select(item.node.id)
    closeSearch()
    // The tree opens around the selection; bring the row itself into view, or a
    // deep result would land off-screen.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.querySelector(`.cm-node-area [data-node-id="${item.node.id}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    }
  }

  /** A node row's click: inside the search view it also leaves the result list. */
  const selectNodeRow = (key: string): void => {
    select(key)
    if (searching) closeSearch()
  }
  const selectionWorkspace = workspaceSelection(selectedNodeId)
  const selectionArchive = archiveSelection(selectedNodeId)
  // Scope: a Workspace selection only counts while that Workspace is listed in
  // the active space; the ungrouped bucket only exists in the default space; an
  // archive row follows the same scoping rule as its Workspace.
  const selectionInScope = selectionWorkspace !== undefined
    ? selectionWorkspace.workspaceId === null
      ? activeSpaceId === defaultSpaceId
      : scopedWorkspaceIds.has(selectionWorkspace.workspaceId)
    : selectionArchive !== undefined
      ? scopedWorkspaceIds.has(selectionArchive.workspaceId)
      : undefined
  const selectedTopic = selectedNodeId !== null && selectionWorkspace === undefined && selectionArchive === undefined
    ? state.nodes.find(node => {
      if (node.id !== selectedNodeId) return false
      const owner = workspaceOfNode(node)
      return owner === null ? activeSpaceId === defaultSpaceId : scopedWorkspaceIds.has(owner)
    })
    : undefined
  const activeWorkspaceId = selectionWorkspace !== undefined
    ? (selectionInScope === true ? selectionWorkspace.workspaceId : undefined)
    : selectionArchive !== undefined
      ? (selectionInScope === true ? selectionArchive.workspaceId : undefined)
      : selectedTopic === undefined ? undefined : workspaceOfNode(selectedTopic)

  /*
   * The selection's lineage, top down: the Workspace row plus every ancestor
   * topic. The columns already draw each level on its own, but only the selected
   * row was marked, so from a deep selection the reader could not tell which
   * upper level's domain the open columns sit in — the one thing they need to
   * know before adding a sibling or a child. Marking the whole chain answers it.
   * Search results are a flat list of matches rather than the tree, so they are
   * left out: there the path rows would be results, not navigation.
   *
   * An archived topic's chain is stated through the archive row instead of the
   * nodes it was taken out from: `工作区 → 已归档 → …`. Selecting the archive row
   * itself marks only the Workspace it belongs to.
   */
  const ancestorKeys: ReadonlySet<string> | undefined = searching
    ? undefined
    : selectedTopic !== undefined
      ? new Set(ancestorRowKeys(state, selectedTopic.id))
      : selectionArchive !== undefined && selectionInScope === true
        ? new Set([workspaceKey(selectionArchive.workspaceId)])
        : undefined

  const update = (patch: Partial<ViewState>): void => setView(current => ({ ...current, ...patch }))
  const resizeMap = (next: number): void => {
    update({ mapWidth: clampMapWidth(next, maxMapWidth(frame.centerWidth)) })
  }
  /**
   * Move the tree by hand: a node row, a search result, a menu destination.
   *
   * The tree's position otherwise follows the open conversation; this is the one
   * write that may leave it. `browsing` records the excursion, and landing on the
   * conversation's own home row ends it (so later conversation events keep
   * following again).
   */
  const select = (key: string): void => {
    update({ selectedNodeId: key, browsing: browsingForRow(state, view.openSessionId, key) })
  }

  /**
   * A selection left on an empty archive row has nothing to open.
   *
   * The view document remembers the row across reloads; a Workspace whose
   * archive was emptied (or whose archive marks were lost by an older writer)
   * would otherwise keep an empty third column on screen forever. Move the
   * cursor to the Workspace row instead — the same place the reader would land
   * by clicking there.
   */
  useEffect(() => {
    if (selectionArchive === undefined || selectionInScope !== true) return
    const stats = archiveStatsOf(state, selectionArchive.workspaceId)
    if (stats.nodes > 0 || stats.sessions > 0) return
    update({ selectedNodeId: workspaceKey(selectionArchive.workspaceId) })
    // `update` is re-created per render but only this state change matters.
  }, [selectionArchive, selectionInScope, state])

  // Reserve the band's width on the shipped Conversation column. The rule lives
  // in the plugin stylesheet under `html[data-conversation-map-split]`; layout
  // effects keep mount and unmount in the same paint as the band itself, so
  // neither state ever shows a column padded without a band (or vice versa).
  useLayoutEffect(() => {
    if (!visible || !centreFits || typeof document === 'undefined') return undefined
    const root = document.documentElement
    root.setAttribute('data-conversation-map-split', '')
    return () => { root.removeAttribute('data-conversation-map-split') }
  }, [visible, centreFits])

  // `data-conversation-map-split` above is the only marker the shipped header
  // reacts to. The collapsed state needs no marker: the band is not mounted at
  // all, and its seat in the Conversation header draws the single control.

  useLayoutEffect(() => {
    if (!visible || typeof document === 'undefined') return undefined
    const root = document.documentElement
    root.style.setProperty('--cm-map-width', `${Math.round(reservedWidth)}px`)
    return () => { root.style.removeProperty('--cm-map-width') }
  }, [visible, reservedWidth])
  /**
   * Open one conversation through the application's own navigation.
   *
   * The native action retains the Session as the main view and reveals the
   * Conversation; the shell's right column follows that current Session, so the
   * map's pane and the right column can never point at different conversations.
   *
   * Opening a conversation is also a navigation inside the map: its home — the
   * topic it is filed under, the Workspace row it sits at, an archive row, or a
   * space's ungrouped row — becomes the tree's position, so the highlighted row
   * always names the conversation being read. An ungrouped conversation lands on
   * its space's ungrouped row (the column then stops there: the ungrouped row is
   * a conversation list, not a container). The reader's earlier browse ends
   * here, because opening a conversation is a conversation event.
   *
   * @param sessionId - the conversation to open.
   */
  const openThread = (sessionId: string): void => {
    statusLedger?.acknowledge(sessionId)
    const home = sessionHomeSelection(state, sessionId)
    setView(current => {
      const opened = { ...current, openSessionId: sessionId, browsing: false }
      return home === null ? opened : { ...opened, activeSpace: home.spaceId, selectedNodeId: home.selection }
    })
    mapNavigation.current = sessionId
    try {
      services.openSession?.(sessionId)
    } catch (thrown) {
      mapNavigation.current = null
      // A profile without the navigation service still gets the embedded pane;
      // only the right column would then be out of step.
      console.warn('conversation-map: native navigation unavailable', thrown)
      setError(describeError(t, thrown))
    }
  }

  /**
   * Follow the shell's current Session.
   *
   * The map is a presentation of the Conversation, so the Session the shell
   * reports (the session-maybe scope's `sessionId`) is the single source of
   * truth: native navigation — a sidebar row, New Session, another plugin —
   * changes it and the map adopts it instead of keeping a stale pane.
   *
   * Only a present Session is adopted, and only when it changes. A transient
   * absence is not a navigation: treating it as one would clear the open
   * conversation while a freshly created Session is still being opened, which
   * drops the provisional blank row the map itself just filed.
   */
  /**
   * Move the map to another space by hand.
   *
   * Switching space is a browse: the conversation on screen keeps rendering, so
   * the tree must be allowed to leave its home. Switching back to the space the
   * conversation lives in ends the browse.
   */
  const switchSpace = (spaceId: string): void => {
    update({ activeSpace: spaceId, browsing: browsingForSpace(state, view.openSessionId, spaceId) })
  }

  const resizeNodeColumn = (index: number, next: number): void => {
    setView(current => {
      const widths = [...current.columnWidths]
      while (widths.length <= index) widths.push(NODE_COLUMN_WIDTH)
      widths[index] = next
      return { ...current, columnWidths: widths }
    })
  }

  // ── pointer drag ─────────────────────────────────────────────────────────
  // One press, two payloads. The gesture is deliberately thin: the rules live in
  // `row-drag.ts` (what a drop means) and in the model (what is legal), and this
  // half only answers "what is under the pointer" and runs the plan. Nothing
  // enters React state per frame — the label follows the pointer through its own
  // DOM node, and only a change of *decision* re-renders the rows.

  /** One press in flight: what it carries, where it started, and whether it drags. */
  interface PressState {
    payload: DragPayload
    /** The group the press started in: a topic drag dims that whole group. */
    sourceGroupKey: string | null
    origin: { x: number; y: number }
    pointerId: number
    active: boolean
  }

  /** One resolved pointer position. */
  interface DragHit {
    groupKey: string | null
    mode: 'into' | 'before' | 'after' | null
    candidate: DropCandidate
    decision: DropDecision
    insertEdge: InsertEdge | null
  }

  const areaRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<PressState | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const frameRef = useRef(0)
  /** The group the pointer is resting on, waiting to spring its column open. */
  const springRef = useRef<{ nodeId: string; since: number } | null>(null)
  /** One frame's work, refreshed every render so the loop never judges a stale map. */
  const dragFrameRef = useRef<(stamp: number) => void>(() => {})
  const swallowClickRef = useRef<OneShot>({ pending: false })
  const [overlay, setOverlay] = useState<DragOverlayState | null>(null)
  /** The conversation row being dragged; a topic dims its group instead. */
  const [dragKey, setDragKey] = useState<string | null>(null)
  /** The group being dragged, when the payload is a topic. */
  const [dragGroupKey, setDragGroupKey] = useState<string | null>(null)

  /**
   * Measure the columns and drop groups the pointer could be over.
   *
   * Geometry is read from the same data attributes the column view renders
   * (`data-col-key` / `data-group-*`), so the hit test never has to guess
   * structure. Rects are viewport coordinates and are re-measured every frame:
   * scrolling, collapsing and column rebuilds all invalidate cached geometry,
   * and the cost is a handful of `getBoundingClientRect` calls on elements that
   * are already on screen (well under 50 groups in practice).
   * @returns the column intervals and the group rectangles of this render.
   */
  const measureDropGeometry = (): { columns: ColumnRect[]; groups: GroupRect[] } => {
    const area = areaRef.current
    if (area === null) return { columns: [], groups: [] }
    const columns: ColumnRect[] = []
    const columnKeys = new Map<Element, string>()
    for (const scroller of area.querySelectorAll<HTMLElement>('.cm-col-scroll')) {
      const columnKey = scroller.closest<HTMLElement>('.cm-node-col')?.dataset.colKey ?? ''
      if (columnKey === '') continue
      // The archive is a reading surface, not a drop surface: entering or
      // leaving it is a menu action (archive / unarchive), never a drag. Its
      // column is left out of the hit-test geometry entirely.
      if (isArchiveSelectionKey(columnKey)) continue
      const rect = scroller.getBoundingClientRect()
      columns.push({
        key: columnKey, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      })
      columnKeys.set(scroller, columnKey)
    }
    const groups: GroupRect[] = []
    for (const element of area.querySelectorAll<HTMLElement>('.cm-node-group')) {
      const scroller = element.closest<HTMLElement>('.cm-col-scroll')
      const columnKey = scroller === null ? '' : columnKeys.get(scroller) ?? ''
      if (columnKey === '') continue
      const rect = element.getBoundingClientRect()
      const header = element.querySelector<HTMLElement>('.cm-node-row')
      const headerHeight = header === null ? rect.height : header.getBoundingClientRect().height
      const kind = element.dataset.groupKind
      groups.push({
        key: element.dataset.groupKey ?? '',
        kind: kind === 'workspace' || kind === 'ungrouped' ? kind : 'node',
        columnKey,
        nodeId: element.dataset.groupNodeId ?? null,
        workspaceId: element.dataset.groupWorkspaceId === undefined || element.dataset.groupWorkspaceId === ''
          ? null
          : element.dataset.groupWorkspaceId,
        top: rect.top,
        bottom: rect.bottom,
        headerHeight,
      })
    }
    return { columns, groups }
  }

  /**
   * Judge one pointer position against the document.
   *
   * The group under the pointer is the candidate; `decideDrop` keeps every
   * semantic rule it already had. A `null` answer is a real "no target here":
   * a conversation over a column's blank tail is exactly that (the old row
   * fallback silently filed it under the last topic), and the caller then holds
   * the previous candidate without committing.
   * @param x - pointer x, in viewport coordinates.
   * @param y - pointer y, in viewport coordinates.
   * @param payload - the row the drag started from.
   * @returns the resolved hit, or null when there is no target.
   */
  const resolveHit = (x: number, y: number, payload: DragPayload): DragHit | null => {
    const { columns, groups } = measureDropGeometry()
    const hit = hitGroupAt({ x, y }, columns, groups)
    const candidate = candidateFromGroupHit(hit, payload)
    if (candidate === null) return null
    const decision = decideDrop(state, payload, candidate)
    // A Workspace target means "move to the top level", not an ordered slot:
    // the boundary line belongs to topic siblings only.
    const needsLine = payload.kind === 'node' && decision.issue === null && !decision.noop
      && candidate.row.kind === 'node'
    const mode: 'into' | 'before' | 'after' | null = hit.zone === 'tail' ? 'after' : hit.mode
    return {
      groupKey: hit.group?.key ?? null,
      mode,
      candidate,
      decision,
      insertEdge: needsLine && (hit.mode === 'before' || hit.mode === 'after') ? hit.mode : null,
    }
  }

  /** Keep the label under the pointer without re-rendering the rows. */
  const placeLabel = (x: number, y: number): void => {
    const label = labelRef.current
    if (label === null) return
    label.style.transform = `translate3d(${String(Math.round(x + 12))}px, ${String(Math.round(y + 16))}px, 0)`
  }

  /** Draw one frame: the label's position, then any change of decision. */
  const drawOverlay = (): void => {
    const press = pressRef.current
    if (press === null || !press.active) return
    const { x, y } = pointerRef.current
    placeLabel(x, y)
    const hit = resolveHit(x, y, press.payload)
    if (hit === null) {
      // U3: the pointer left every group, but the reader is still aiming at the
      // last one — hold it, quietly, and let a release there write nothing.
      setOverlay(current => heldOverlay(current))
      return
    }
    const next: DragOverlayState = {
      label: formatDragLabel(t, hit.decision.label),
      tone: dragLabelTone(hit.decision),
      groupKey: hit.groupKey,
      mode: hit.mode,
      insertEdge: hit.insertEdge,
      held: false,
    }
    setOverlay(current => current !== null
      && current.label === next.label
      && current.tone === next.tone
      && current.groupKey === next.groupKey
      && current.mode === next.mode
      && current.insertEdge === next.insertEdge
      && current.held === false
      ? current
      : next)
  }

  /** Scroll whichever strip the pointer is pressed against (U4). */
  const scrollUnderPointer = (): void => {
    const { x, y } = pointerRef.current
    const area = areaRef.current
    if (area !== null) {
      const rect = area.getBoundingClientRect()
      if (y >= rect.top && y <= rect.bottom) {
        const step = autoScrollStep(x, rect.left, rect.right)
        if (step !== 0) area.scrollLeft += step
      }
    }
    if (typeof document === 'undefined') return
    const element = document.elementFromPoint(x, y)
    const column = element instanceof HTMLElement ? element.closest<HTMLElement>('.cm-col-scroll') : null
    if (column === null) return
    const rect = column.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right) {
      const step = autoScrollStep(y, rect.top, rect.bottom)
      if (step !== 0) column.scrollTop += step
    }
  }

  /**
   * Open a column under a resting pointer (U4).
   *
   * A topic whose children are one column further right is only reachable if
   * that column exists, so holding a dragged row over such a topic long enough
   * selects it — the drag survives, because the gesture is captured on the strip
   * and not on the row that may be unmounted when the columns rebuild.
   * @param stamp - the frame's timestamp, in milliseconds.
   */
  const springLoadUnderPointer = (stamp: number): void => {
    // A group is the target now, so resting anywhere inside it (header or any
    // conversation row) aims at its topic. Collapsed leaves have nothing to
    // open, and {@link springLoadTarget} keeps a row whose child column is
    // already visible from rebuilding the columns for nothing.
    const { columns, groups } = measureDropGeometry()
    const hit = hitGroupAt(pointerRef.current, columns, groups)
    const nodeId = hit.zone === 'group' && hit.group !== null && hit.group.kind === 'node'
      ? hit.group.nodeId ?? ''
      : ''
    if (nodeId === '' || typeof document === 'undefined') {
      springRef.current = null
      return
    }
    const children = activeChildrenOf(state, nodeId)
    const visible = children.some(child => document.querySelector(`[data-node-id="${child.id}"]`) !== null)
    if (!springLoadTarget(state, nodeId, visible)) {
      springRef.current = null
      return
    }
    const pending = springRef.current
    if (pending === null || pending.nodeId !== nodeId) {
      springRef.current = { nodeId, since: stamp }
      return
    }
    if (stamp - pending.since < SPRING_LOAD_MS) return
    springRef.current = null
    select(nodeId)
  }

  /**
   * The drag's own frame loop: it runs only while a drag is active, and it also
   * runs while the pointer is still, which is what makes auto scrolling and
   * spring loading work at all. The work itself is read through a ref, so a
   * document that arrives mid-drag (the store polls) is judged by the newest
   * render rather than by the one that started the loop.
   */
  const tickDrag = (stamp: number): void => {
    const press = pressRef.current
    if (press === null || !press.active) {
      frameRef.current = 0
      return
    }
    frameRef.current = requestAnimationFrame(tickDrag)
    dragFrameRef.current(stamp)
  }

  /** Start the frame loop once per drag. */
  const startDragLoop = (): void => {
    if (frameRef.current !== 0) return
    frameRef.current = requestAnimationFrame(tickDrag)
  }

  /** Stop the drag without writing anything. */
  const cancelDrag = (pointerId?: number): void => {
    const press = pressRef.current
    pressRef.current = null
    springRef.current = null
    if (frameRef.current !== 0) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    if (press?.active === true) {
      // The gesture still owes the page one click: eat it, or the row under the
      // release would open a conversation / select a node the reader never chose.
      swallowClickRef.current.pending = true
      const area = areaRef.current
      if (area !== null && pointerId !== undefined && area.hasPointerCapture(pointerId)) {
        area.releasePointerCapture(pointerId)
      }
    }
    setDragKey(null)
    setDragGroupKey(null)
    setOverlay(null)
  }

  /**
   * A pointer went down on a draggable row.
   *
   * Nothing happens yet: a press is a click until it travels
   * {@link DRAG_THRESHOLD_PX}, so the row's own click behaviour is untouched.
   * @param payload - what the row carries.
   * @param event - the press.
   */
  const beginRowDrag = (payload: DragPayload, event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    // U5: the search view lists matches, not the document, so nothing there drags.
    if (searching) return
    const target = event.target
    if (target instanceof Element && target.closest('button') !== null) return
    // D6 and the accounting rule: the ungrouped bucket and a conversation the
    // Host has not accounted to have no Workspace for a target to agree with.
    if (payload.workspaceId === null || payload.workspaceId === undefined) return
    swallowClickRef.current.pending = false
    pointerRef.current = { x: event.clientX, y: event.clientY }
    // The group the press started in is read now, while the row is still
    // mounted: a spring-loaded column rebuild can unmount it mid-drag, and the
    // source group is what dims as a whole for a topic payload.
    const sourceGroupKey = event.currentTarget.closest<HTMLElement>('[data-group-key]')?.dataset.groupKey ?? null
    pressRef.current = {
      payload,
      sourceGroupKey,
      origin: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      active: false,
    }
  }

  /** Follow one pointer move: threshold, capture, then a decision per frame. */
  const moveRowDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current
    if (press === null) return
    pointerRef.current = { x: event.clientX, y: event.clientY }
    if (!press.active) {
      if (!exceedsDragThreshold(press.origin, pointerRef.current)) return
      // It is a drag now. The pointer is captured on the strip rather than on the
      // row: a hover that opens a column rebuilds the columns, and the row the
      // gesture started from can be unmounted underneath it (U1).
      press.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
      // A conversation dims its own row; a topic dims its whole group, because
      // its conversations travel with it.
      setDragKey(press.payload.kind === 'session' ? press.payload.sessionId : null)
      setDragGroupKey(press.payload.kind === 'node' ? press.sourceGroupKey : null)
      // U8: a drag and an open surface are mutually exclusive.
      setMenu(null)
      setSpaceMenu(null)
      setOverflowMenu(null)
      setDraft(null)
      setDialogError('')
      startDragLoop()
      return
    }
  }

  /** Release: commit the plan of the target under the *final* pointer position. */
  const endRowDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const press = pressRef.current
    pressRef.current = null
    springRef.current = null
    if (frameRef.current !== 0) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    setDragKey(null)
    setDragGroupKey(null)
    setOverlay(null)
    if (press === null || !press.active) return
    swallowClickRef.current.pending = true
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // U3: only a release that really resolves a target commits — a release
    // over a gutter, or a conversation over a column's blank tail, keeps the
    // last label on screen but writes nothing.
    const hit = resolveHit(event.clientX, event.clientY, press.payload)
    if (hit === null) return
    const plan = planFromDecision(hit.decision)
    if (plan === null) return
    const follow = followAfterMove(state, plan, { openSessionId: view.openSessionId })
    setError('')
    const outcome = services.store.update(current => applyDragPlan(current, plan))
    if (!outcome.ok) {
      // U7: the refusal is restated in the reader's own vocabulary.
      setError(moveFailureMessage(t, outcome.error))
      return
    }
    // U6: show where it went.
    applyFollow(follow)
  }

  /** The click that follows a drag release is the gesture's, not the row's. */
  const swallowClick = (event: { preventDefault: () => void; stopPropagation: () => void }): void => {
    if (!consumeOneShot(swallowClickRef.current)) return
    event.preventDefault()
    event.stopPropagation()
  }

  // A cancelled surface is not a place to keep dragging from: switching space or
  // opening the search view ends the gesture, like Escape and a lost pointer.
  useEffect(() => {
    const onBlur = (): void => { cancelDrag() }
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('blur', onBlur) }
  }, [])

  useEffect(() => { cancelDrag() }, [activeSpaceId, searching])

  // The label mounts under the pointer, not at the frame's corner: the first
  // frame it exists in must already carry its position. The same layout effect
  // hands the loop this render's closures.
  useLayoutEffect(() => {
    dragFrameRef.current = (stamp: number) => {
      scrollUnderPointer()
      springLoadUnderPointer(stamp)
      drawOverlay()
    }
    placeLabel(pointerRef.current.x, pointerRef.current.y)
  })

  /**
   * Follow one landed move with the view (U6).
   *
   * Unfold the destination, move the highlight when the conversation being read
   * is the one that moved, and bring the row that moved back into sight — a move
   * the reader cannot see the result of reads as a move that did not happen.
   * @param follow - what the committed move asks for.
   */
  const applyFollow = (follow: MoveFollow): void => {
    setView(current => {
      const collapsedIds = follow.expandKey === null
        ? current.collapsedIds
        : current.collapsedIds.filter(id => id !== follow.expandKey)
      if (collapsedIds === current.collapsedIds && follow.selectedNodeId === null) return current
      return {
        ...current,
        collapsedIds,
        selectedNodeId: follow.selectedNodeId ?? current.selectedNodeId,
      }
    })
    const key = follow.focusKey
    if (key === null || typeof document === 'undefined') return
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-node-id="${key}"], [data-session-id="${key}"]`)
      row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
  /** Close the open dialog and clear its own error. */
  const closeDraft = (): void => { setDraft(null); setDialogError(''); setError(''); setNodeTitleError(false) }

  /** Create or edit a topic, adopt a Workspace, or edit the space organization. */
  const submitDraft = (): void => {
    if (draft === null || busy) return
    setDialogError('')
    if (draft.kind === 'node') {
      try {
        if (draft.id === undefined) {
          if (nodeTitleIssue(draft.title) !== null) {
            setNodeTitleError(true)
            nodeTitleRef.current?.focus()
            return
          }
          // The id is minted here so a conflict replay recreates the same node
          // and the selection still names it.
          const id = crypto.randomUUID()
          const outcome = services.store.update(current => createNode(current, {
            parentId: draft.parentId,
            workspaceId: draft.workspaceId,
            title: draft.title,
            description: draft.description,
            id,
          }).state)
          if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
          select(id)
          closeDraft()
          return
        }
        const id = draft.id
        const anchor = draft.beforeNodeId ?? null
        const parentChanged = draft.parentId !== (draft.originalParentId ?? null)
        const outcome = services.store.update(current => {
          const next = updateNode(current, { id, title: draft.title, description: draft.description })
          // A chosen anchor is a real move even under the same parent (D9/N10).
          // Without one, only a parent the reader actually changed re-parents the
          // node: a drag that landed while this dialog was open must not be
          // undone by saving a form nobody touched (U8).
          if (anchor !== null) return insertNodeBefore(next, id, draft.parentId, anchor)
          return parentChanged ? moveNode(next, id, draft.parentId) : next
        })
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'node-delete') {
      removeNodeSubtree(draft.nodeId)
      return
    }
    if (draft.kind === 'workspace-delete') {
      removeWorkspace(draft.workspaceId)
      return
    }
    if (draft.kind === 'workspace-rename') {
      const workspaceId = draft.workspaceId
      const title = draft.title.trim()
      if (title === '') { setDialogError(t('panel.error.workspaceTitleEmpty')); return }
      setBusy(true)
      void (async () => {
        try {
          await services.workspaces.rename(workspaceId, title)
          closeDraft()
        } catch (thrown) {
          setDialogError(describeError(t, thrown))
        } finally {
          setBusy(false)
        }
      })()
      return
    }
    if (draft.kind === 'space-create') {
      try {
        // Mint the id up front for replayability, then select it in the view.
        const id = crypto.randomUUID()
        const outcome = services.store.update(current => createSpace(current, { title: draft.title, id }).state)
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        update({ activeSpace: id })
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'space-rename') {
      try {
        const outcome = services.store.update(current => {
          // The default space's label is dictionary copy, not stored text. Its
          // rename dialog opens with that localized name; submitting it
          // unchanged keeps the language-neutral marker instead of writing the
          // active language into user data.
          const space = current.spaces.find(candidate => candidate.id === draft.spaceId)
          const unchangedDefault = space !== undefined
            && space.id === current.defaultSpaceId
            && space.title === DEFAULT_SPACE_TITLE
            && draft.title.trim() === t('common.defaultSpace')
          return renameSpace(current, {
            id: draft.spaceId,
            title: unchangedDefault ? DEFAULT_SPACE_TITLE : draft.title,
          })
        })
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'space-delete') {
      try {
        const outcome = services.store.update(current => deleteSpace(current, draft.spaceId))
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        if (activeSpaceId === draft.spaceId) update({ activeSpace: services.store.getSnapshot().doc.defaultSpaceId })
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'workspace-space') {
      try {
        const outcome = services.store.update(current => setWorkspaceSpace(current, draft.workspaceId, draft.spaceId))
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'thread-space') {
      try {
        const outcome = services.store.update(current => setThreadSpace(current, draft.sessionId, draft.spaceId))
        if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      }
      return
    }
    if (draft.kind === 'move-thread') {
      const value = draft.nodeId ?? ''
      // Confirming the home a conversation already has is not free: the model
      // bumps the document revision and commits it, so the picker makes it a
      // close instead of a write.
      if (threadMoveIsNoop(state, draft.sessionId, value)) { closeDraft(); return }
      try {
        const outcome = services.store.update(threadMoveChange(draft.sessionId, value))
        if (!outcome.ok) { setDialogError(moveFailureMessage(t, outcome.error)); return }
        applyFollow(followAfterMove(
          state,
          { kind: 'thread', sessionId: draft.sessionId, nodeId: draft.nodeId },
          { openSessionId: view.openSessionId },
        ))
        closeDraft()
      } catch (thrown) {
        setDialogError(moveFailureMessage(t, thrown))
      }
      return
    }
    const path = draft.path.trim()
    if (path === '') { setDialogError(t('panel.error.workspacePathEmpty')); return }
    // The directory names the Workspace by default, but the field is the
    // outcome: a name the reader typed is applied after the Host resolves the
    // directory, because `create` cannot carry a name. A name the reader
    // cleared is an explicit "no name" and is refused like any blank title; an
    // untouched name never renames a directory that is already registered —
    // typing a known path is adoption, not a rename.
    // The field is the outcome: a typed name wins, an untouched field asks the
    // directory to name it, and a field the reader cleared is an explicit "no
    // name" — refused like any blank title.
    const workspaceName = workspaceCreateName(draft)
    if (workspaceName === '') { setDialogError(t('panel.error.workspaceTitleEmpty')); return }
    setBusy(true)
    void (async () => {
      try {
        const created = await services.workspaces.create({ path })
        // The Host keys a Workspace by directory path and resolves an already
        // registered path idempotently. Only a genuinely new (or default-space)
        // Workspace joins the active space: a Workspace that already lives in
        // another space is never moved just because its path was typed again.
        const existingOverride = state.spaceOf[created.workspaceId]
        const existingSpace = existingOverride !== undefined
          && state.spaces.some(space => space.id === existingOverride)
          ? existingOverride
          : defaultSpaceId
        if (existingSpace !== defaultSpaceId && existingSpace !== activeSpaceId) {
          const owner = state.spaces.find(space => space.id === existingSpace)
          closeDraft()
          switchSpace(existingSpace)
          select(workspaceKey(created.workspaceId))
          setError(t('panel.error.workspaceInOtherSpace', { space: owner?.title ?? t('panel.otherSpace') }))
          return
        }
        // The row exists now, so the tree shows where it went before the name
        // round-trip: if the Host refuses the name, the directory is still
        // registered, the row is still selected, and the dialog stays open for
        // another name — registering the directory was the request, only the
        // name failed.
        if (activeSpaceId !== defaultSpaceId) {
          services.store.update(current => setWorkspaceSpace(current, created.workspaceId, activeSpaceId))
        }
        select(workspaceKey(created.workspaceId))
        if (draft.titleTouched && workspaceName !== created.title) {
          // The Host refuses a duplicate title; asking here first answers in the
          // reader's language, and the predicate mirrors the Host's own rule.
          if (workspaceTitleTaken(services.workspaces.list.getSnapshot().items, created.workspaceId, workspaceName)) {
            setDialogError(t('panel.error.workspaceTitleDup', { title: workspaceName }))
            return
          }
          await services.workspaces.rename(created.workspaceId, workspaceName)
        }
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * Enter in a one-line input presses the dialog's primary button.
   *
   * This is the *only* Enter path this plugin adds, and it lives on the inputs
   * themselves — never on `document`: a document listener would also fire for
   * the move tree (whose own Enter only calls `preventDefault`) and would turn
   * one keypress in a delete confirmation into an unconfirmed deletion.
   * Re-entry is safe because `submitDraft` itself returns early on `draft ===
   * null || busy`, and a second Enter arrives after the first has closed the
   * dialog.
   * @param event - the input's keydown.
   */
  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (draft === null || !enterCommits(draft.kind)) return
    // Two guards, because browsers order the confirming Enter differently: the
    // ref covers presses delivered while the composition is still open on this
    // side, and `commitsOnEnter` reads the event's own `isComposing`/legacy 229
    // where the IME already reported the composition as finished.
    if (composingRef.current || !commitsOnEnter(event)) return
    event.preventDefault()
    submitDraft()
  }

  /** An IME session began: the next Enter confirms a candidate, not the dialog. */
  const onCompositionStart = (): void => { composingRef.current = true }

  /** The IME session ended; a later Enter belongs to the dialog again. */
  const onCompositionEnd = (): void => { composingRef.current = false }

  /**
   * Start a conversation under one row.
   *
   * This is the plain "new conversation" action: the session is created in the
   * Workspace the row belongs to (so the Host's own list groups it there), filed
   * under the row's topic when it has one, and opened in the conversation
   * region, where the user writes in the native composer. Nothing is sent on
   * their behalf, and its "now" stamp makes it lead that row's list.
   *
   * The ungrouped row is special: the conversation is created without a
   * Workspace (the Host files it under its own ungrouped bucket) and this
   * plugin records which space it belongs to, so each space keeps its own
   * ungrouped conversations.
   * @param nodeKey - a topic id, a Workspace key, or the ungrouped row key.
   */
  const newThread = (nodeKey: string): void => {
    setError('')
    const looseRow = nodeKey === looseKey
    const rowWorkspace = workspaceSelection(nodeKey)
    const topic = rowWorkspace === undefined && !looseRow
      ? state.nodes.find(node => node.id === nodeKey)
      : undefined
    if (rowWorkspace === undefined && topic === undefined && !looseRow) return
    if (topic !== undefined && inArchive(state, topic.id)) return
    const workspaceId = topic !== undefined ? workspaceOfNode(topic) : rowWorkspace?.workspaceId ?? null
    const nodeId = topic === undefined ? null : topic.id
    const spaceId = looseRow ? activeSpaceId : null
    void (async () => {
      try {
        const created = await services.sessions.create?.(workspaceId === null ? {} : { workspaceId })
        if (created === undefined) throw new Error(t('panel.error.noCreateSession'))
        services.store.update(current => adoptThread(current, { sessionId: created, title: '', nodeId, workspaceId, spaceId }))
        // Creating a conversation is a conversation event: it lands on the row
        // that was pressed (the ungrouped row included) and ends any browse.
        update({ openSessionId: created, selectedNodeId: nodeKey, browsing: false })
        mapNavigation.current = created
        try {
          services.openSession?.(created)
        } catch (thrown) {
          mapNavigation.current = null
          console.warn('conversation-map: opening the new conversation failed', thrown)
          setError(describeError(t, thrown))
        }
      } catch (thrown) {
        console.warn('conversation-map: creating a conversation failed', thrown)
        setError(describeError(t, thrown))
      }
    })()
  }

  /**
   * The row a plain 「新建会话」 starts under.
   *
   * The band keeps its own row-level entries (`Columns.tsx` hover action, the
   * ⋯ menus, the information bar) for conversations the reader starts at a place
   * they picked. This one is the row-less entry — the seat the shell's own
   * 「新建会话」 used to occupy — so it has to derive its place from where the
   * reader already is, in this order:
   *
   * 1. the reader's explicit selection, while it still resolves (a recycled
   *    selection is not a destination);
   * 2. otherwise the home of the conversation on screen: opening one already
   *    activates its owning node, so this is "the same place as what I am
   *    reading";
   * 3. otherwise the most recently active Workspace of the space on screen;
   * 4. otherwise that space's ungrouped row.
   *
   * Selection outranks the open conversation on purpose: opening a conversation
   * moves the selection to its home, so any later click on another node is a
   * deliberate change of destination and must not be overwritten by the
   * conversation still open behind it. Steps 3 and 4 never leave the space the
   * reader is looking at, so the new row appears where they can see it.
   * @returns a row key `newThread` already accepts (topic id, Workspace key, or
   *   the space's ungrouped key).
   */
  const newThreadKey = (): string => {
    // 1. The selection, accepted exactly while it names something the rows can
    //    start from: a topic from the rows, an in-scope Workspace key, or the
    //    ungrouped row.
    const looseSelection = selectedNodeId === looseKey || selectedNodeId === UNGROUPED_ID
    if (selectedTopic !== undefined && !inArchive(state, selectedTopic.id)) return selectedTopic.id
    if (selectionWorkspace !== undefined && selectionInScope === true) return selectedNodeId as string
    if (looseSelection) return looseKey
    // 2. The open conversation's home, while it lives in the space on screen.
    const openSessionId = view.openSessionId
    if (openSessionId !== null) {
      const thread = threadOfSession(state, openSessionId)
      // An archived conversation is not a place to start from: its row is a
      // reading shelf, so the fallback moves on to the recent Workspace.
      const archived = thread !== undefined
        && (isArchivedThread(thread) || (thread.nodeId !== null && inArchive(state, thread.nodeId)))
      if (thread !== undefined && !archived) {
        const home = selectionOfThread(state, thread)
        if (home !== null) return home
        const homeSpace = spaceOfThread(state, thread)
        if (homeSpace === activeSpaceId) return looseRowKey(state, homeSpace)
      }
    }
    // 3. The most recently active Workspace of this space; the first one when
    //    none has conversations yet (an empty Workspace still beats no target).
    let recent: WorkspaceRef | undefined
    let recentAt = ''
    for (const workspace of scopedWorkspaces) {
      const newest = activeDirectThreadsOf(state, workspace.workspaceId)[0]
      const at = newest?.updatedAt ?? ''
      if (recent === undefined || at > recentAt) {
        recent = workspace
        recentAt = at
      }
    }
    return recent === undefined ? looseKey : workspaceKey(recent.workspaceId)
  }

  /** Rename one Workspace through the Host. */
  const openWorkspaceRename = (workspace: WorkspaceRef): void => {
    setDialogError('')
    setDraft({ kind: 'workspace-rename', workspaceId: workspace.workspaceId, title: workspaceDisplayTitle(workspace, workspaceLabels) })
  }

  /** Move one Workspace into another space (or back to the default one). */
  const openWorkspaceSpace = (workspace: WorkspaceRef): void => {
    setDialogError('')
    setDraft({
      kind: 'workspace-space',
      workspaceId: workspace.workspaceId,
      title: workspaceDisplayTitle(workspace, workspaceLabels),
      spaceId: spaceOfWorkspace(state, workspace.workspaceId),
    })
  }

  /** Move one loose conversation into another space. */
  const openThreadSpace = (thread: ThreadRef): void => {
    setDialogError('')
    setDraft({
      kind: 'thread-space',
      sessionId: thread.sessionId,
      title: thread.title,
      spaceId: spaceOfThread(state, thread),
    })
  }

  /**
   * Open the one-step 「移动到…」 picker for one conversation.
   *
   * Every destination of its own Workspace is in the list, so the reader needs
   * no prior selection. The picker starts on the topic they have selected while
   * that is a legal destination — the old shortcut's efficiency, now stated
   * where it can be seen before it is used — and otherwise on the conversation's
   * current home.
   * @param thread - the conversation to move.
   */
  const openThreadMove = (thread: ThreadRef): void => {
    setDialogError('')
    const target = threadMoveDefault(state, thread, selectedTopic)
    setDraft({
      kind: 'move-thread',
      sessionId: thread.sessionId,
      workspaceId: thread.workspaceId ?? null,
      nodeId: target === '' ? null : target,
    })
  }

  /** Open the new-space dialog. */
  const openSpaceCreate = (): void => {
    setDialogError('')
    setDraft({ kind: 'space-create', title: '' })
  }

  /** Open the rename dialog for one space. */
  const openSpaceRename = (space: SpaceRef): void => {
    setDialogError('')
    setDraft({ kind: 'space-rename', spaceId: space.id, title: displaySpaceTitle(t, space, state) })
  }

  /** Ask before deleting one (non-default) space. */
  const openSpaceDelete = (space: SpaceRef): void => {
    setDialogError('')
    setDraft({ kind: 'space-delete', spaceId: space.id, title: displaySpaceTitle(t, space, state) })
  }

  /** Ask before removing a Workspace registration; its Sessions and files stay. */
  const openWorkspaceDelete = (workspace: WorkspaceRef): void => {
    setDialogError('')
    setDraft({ kind: 'workspace-delete', workspaceId: workspace.workspaceId, title: workspaceDisplayTitle(workspace, workspaceLabels) })
  }

  /** Ask before deleting one topic and every node below it. */
  const openNodeDelete = (nodeId: string, title: string): void => {
    setDialogError('')
    setDraft({ kind: 'node-delete', nodeId, title })
  }

  /** Remove one Workspace registration; its Sessions and files stay. */
  const removeWorkspace = (workspaceId: string): void => {
    setDialogError('')
    setBusy(true)
    void (async () => {
      try {
        await services.workspaces.delete(workspaceId)
        closeDraft()
      } catch (thrown) {
        setDialogError(describeError(t, thrown))
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * Derive one conversation's status the way the application's own rows do.
   *
   * The precedence is the shipped one: a pending request outranks live activity,
   * live activity outranks an unread completion, and an idle conversation draws
   * no mark at all. A pending request also replaces the row's age with its
   * compact wording.
   * @param sessionId - the conversation to describe.
   * @returns the mark to draw, or undefined when the conversation is idle.
   */
  const statusOf = (sessionId: string): ThreadStatus | undefined => {
    const status = statuses.get(sessionId)
    switch (status?.pendingInteraction?.kind) {
      case 'approval':
        return {
          state: 'warning',
          label: t('panel.status.awaitApproval'),
          compact: t('panel.status.awaitApprovalCompact'),
        }
      case 'plan-review':
        return {
          state: 'warning',
          label: t('panel.status.planReview'),
          compact: t('panel.status.planReview'),
        }
      case 'question':
        return {
          state: 'warning',
          label: t('panel.status.awaitAnswer'),
          compact: t('panel.status.awaitAnswerCompact'),
        }
      default: break
    }
    if (status?.running === true) return { state: 'ongoing', label: t('panel.status.running'), compact: '' }
    // A session whose own subagents are still working is live even when its own
    // turn has stopped, exactly as the shipped list reports it.
    const subagents = projections[sessionId]?.values?.subagentCatalog ?? []
    if (subagents.some(child => (statuses.get(child.id)?.running ?? byId[child.id]?.running) === true)) {
      return { state: 'ongoing', label: t('panel.status.subagentRunning'), compact: '' }
    }
    if (status?.completionUnread === true) return { state: 'done', label: t('panel.status.done'), compact: '' }
    return undefined
  }

  /**
   * Build one conversation row.
   *
   * Never hand this function to `Array.prototype.map` directly: `map` passes the
   * element index as the second argument, which this signature reads as the
   * optional `note`, so every ordinary row would grow a second line showing its
   * own position. Call sites spread groups with an arrow and pass only the
   * thread; the search view is the one caller with a real note.
   * @param thread - the indexed conversation.
   * @param note - optional second line (search context or match snippet).
   * @returns the row.
   */
  const threadRowOf = (thread: ThreadRef, note?: ReactNode): ThreadRow => {
    const summary = byId[thread.sessionId]
    // A conversation inside an archived topic travels with that block: it is
    // not individually about to be unarchived, so it carries no menu of its own
    // and takes no part in a drag. A conversation archived on its own keeps its
    // menu (`unarchive` is exactly the action it needs).
    const insideArchive = thread.nodeId !== null && inArchive(state, thread.nodeId)
    return {
      sessionId: thread.sessionId,
      // A provisional row says what it is instead of borrowing the Workspace or
      // session id as a title.
      title: summary?.blank === true ? 'New Session' : thread.title,
      time: relativeTimeLabel(t, thread.updatedAt, now),
      status: statusOf(thread.sessionId),
      workspaceId: thread.workspaceId ?? null,
      archived: insideArchive || isArchivedThread(thread),
      menu: !insideArchive,
      ...note === undefined ? {} : { note },
    }
  }

  /**
   * Fold a group of conversations down to the preview, with a row to reveal more.
   *
   * A row that has collected dozens of conversations would otherwise bury the
   * nodes below it; the application's own list caps a group the same way.
   * @param key - the row whose reveal count this is (topic id or Workspace key).
   * @param threads - every conversation in that group.
   * @returns the rows to render, and the reveal row when there is one.
   */
  const threadGroup = (key: string, threads: ThreadRef[]): { threads: ThreadRow[]; footer?: ReactNode } => {
    if (threads.length <= PREVIEW_THREADS) return { threads: threads.map(thread => threadRowOf(thread)) }
    const revealed = view.revealedThreads[key] ?? PREVIEW_THREADS
    const visible = threads.slice(0, revealed)
    const remaining = threads.length - visible.length
    return {
      threads: visible.map(thread => threadRowOf(thread)),
      footer: (
        <button
          type="button"
          className="cm-more-row"
          onClick={() => {
            setView(current => ({
              ...current,
              revealedThreads: {
                ...current.revealedThreads,
                [key]: remaining > 0 ? revealed + PREVIEW_STEP : PREVIEW_THREADS,
              },
            }))
          }}
        >
          {remaining > 0 ? t('panel.showMoreRemaining', { n: remaining }) : t('common.collapse')}
        </button>
      ),
    }
  }

  /** One Workspace row: the first level, with conversations filed directly under it. */
  const workspaceRow = (workspace: WorkspaceRef): NodeRow => {
    const key = workspaceKey(workspace.workspaceId)
    const group = threadGroup(key, activeDirectThreadsOf(state, workspace.workspaceId))
    return {
      id: key,
      title: workspaceDisplayTitle(workspace, workspaceLabels),
      kind: 'workspace',
      workspaceId: workspace.workspaceId,
      childCount: activeTopNodesOf(state, workspace.workspaceId).length,
      rollup: statusRollups.workspaces.get(workspace.workspaceId) ?? emptyStatusRollup(),
      tools: true,
      collapsed: view.collapsedIds.includes(key),
      threads: group.threads,
      threadFooter: group.footer,
    }
  }

  /**
   * Whether anything inside one Workspace's archive still needs the reader.
   *
   * The archive is folded away, so a running turn or a pending request inside it
   * would otherwise be invisible. Only the attention categories light the mark:
   * an unread completion is exactly what the reader chose to put away, and it
   * must not keep nagging from behind the archive row.
   * @param workspaceId - the Workspace whose archive is drawn.
   * @returns the activity mark, or undefined when the archive is quiet.
   */
  const archiveActivity = (workspaceId: string): NodeRow['activity'] => {
    let running = false
    let attention = false
    for (const thread of state.threads) {
      if ((thread.workspaceId ?? null) !== workspaceId) continue
      const archived = isArchivedThread(thread)
        || (thread.nodeId !== null && inArchive(state, thread.nodeId))
      if (!archived) continue
      const category = categories.get(thread.sessionId)?.category
      if (category === 'running') running = true
      else if (category === 'pending' || category === 'error') attention = true
    }
    if (running) return { kind: 'running', label: t('panel.archive.activity') }
    if (attention) return { kind: 'attention', label: t('panel.archive.activity') }
    return undefined
  }

  /**
   * The fixed archive row for one Workspace.
   *
   * It is the footer of the Workspace's topic column: a synthetic selection key
   * (`@archive:<workspaceId>`), no menu, no start action, no drag. Its count is
   * conversations, not child topics — "how much did I put away" is the question
   * this row answers — and its activity mark surfaces live work the archive is
   * hiding.
   * @param workspaceId - the Workspace whose archive row this is.
   * @returns the row.
   */
  const archiveRow = (workspaceId: string): NodeRow => {
    const stats = archiveStatsOf(state, workspaceId)
    return {
      id: archiveKey(workspaceId),
      title: t('panel.archiveRow'),
      kind: 'archive',
      workspaceId,
      empty: stats.nodes === 0 && stats.sessions === 0,
      childCount: stats.sessions,
      countTitle: t('panel.archive.countTitle', { n: stats.sessions, m: stats.nodes }),
      activity: archiveActivity(workspaceId),
      tools: false,
      menu: false,
      // An empty archive is a placeholder, not a container: there is no column
      // to open, and the tooltip says how it fills up. A selection left on the
      // row by an earlier session is moved back to the Workspace row below.
      selectable: stats.nodes > 0 || stats.sessions > 0,
      collapsed: true,
      threads: [],
    }
  }

  /**
   * One topic row, with the conversations filed under it.
   * @param node - the topic.
   * @param note - optional second line (search context or match snippet).
   * @returns the row.
   */
  const nodeRow = (node: MapNode, note?: ReactNode): NodeRow => {
    const archived = inArchive(state, node.id)
    const group = threadGroup(node.id, activeThreadsOf(state, node.id))
    return {
      id: node.id,
      title: node.title,
      kind: 'node',
      workspaceId: workspaceOfNode(node),
      archived,
      start: !archived,
      childCount: activeChildrenOf(state, node.id).length,
      rollup: archived ? undefined : statusRollups.nodes.get(node.id) ?? emptyStatusRollup(),
      tools: true,
      collapsed: view.collapsedIds.includes(node.id),
      threads: group.threads,
      threadFooter: group.footer,
      ...note === undefined ? {} : { note },
    }
  }

  /**
   * The rows of one Workspace's archive column.
   *
   * Archived topics first (most recently archived first), then one heading row
   * holding the conversations archived on their own. The heading is not a topic:
   * it is not selectable and owns no menu, exactly like the search view's
   * 「匹配会话」 group.
   * @param workspaceId - the Workspace whose archive is open.
   * @returns the rows.
   */
  const archiveColumnRows = (workspaceId: string): NodeRow[] => {
    const rows: NodeRow[] = archivedRootsOf(state, workspaceId).map(node => nodeRow(node))
    const loose = archivedLooseThreadsOf(state, workspaceId)
    if (loose.length > 0) {
      const key = archiveKey(workspaceId)
      const group = threadGroup(key, loose)
      rows.push({
        id: `${key}:threads`,
        title: t('panel.archive.groupThreads'),
        kind: 'node',
        workspaceId,
        archived: true,
        childCount: 0,
        tools: false,
        selectable: false,
        collapsed: false,
        threads: group.threads,
        threadFooter: group.footer,
      })
    }
    return rows
  }

  /** A non-interactive placeholder row (an empty space). */
  const hintRow = (id: string, title: string): NodeRow => ({
    id,
    title,
    kind: 'hint',
    childCount: 0,
    threads: [],
    tools: false,
    collapsed: true,
  })

  /**
   * One space's ungrouped row: its loose conversations, and nothing else.
   *
   * Every space keeps this row so a conversation without a goal can be started
   * from anywhere, exactly as the design's "each space keeps its own ungrouped"
   * rule requires. It is a conversation list, not a topic container: selecting it
   * marks the row (the reader gets the same selected state every row gives), but
   * it opens no column and offers no `⋯` menu — there is nothing to rename or
   * delete, and no child can be created under it. It does offer starting a
   * conversation. Only the default space can also show the legacy rootless topics
   * older versions could create there (and only then does selecting it open a
   * read-only column).
   * @param spaceId - the space whose loose conversations it lists.
   * @returns the row.
   */
  const looseRow = (spaceId: string): NodeRow => {
    const key = looseRowKey(state, spaceId)
    const threads = looseThreadsInSpace(state, spaceId)
    const legacy = spaceId === defaultSpaceId ? activeTopNodesOf(state, null) : []
    const group = threadGroup(key, threads)
    return {
      id: key,
      title: t('common.ungrouped'),
      kind: 'ungrouped',
      workspaceId: null,
      childCount: legacy.length,
      rollup: rollupForThreads(threads),
      tools: true,
      menu: false,
      // Selectable for its own highlight only: no column, no menu, no children.
      selectable: true,
      collapsed: view.collapsedIds.includes(key),
      threads: group.threads,
      threadFooter: group.footer,
    }
  }

  /**
   * Delete one topic and every node below it, after the reader confirmed.
   *
   * The model never deletes a conversation: ones filed under the removed nodes
   * fall back to the Workspace row (`nodeId: null`). Selection follows only when
   * it pointed inside the removed subtree — one level up to the parent topic, or
   * to the Workspace row for a root — so the column listing its siblings stays.
   * A rejected write keeps the dialog open with the reason.
   * @param nodeId - the subtree root to remove.
   */
  const removeNodeSubtree = (nodeId: string): void => {
    const node = state.nodes.find(candidate => candidate.id === nodeId)
    const doomed = descendantIds(state, nodeId)
    // Removing an archived block lands on its Workspace row: the archive row it
    // was opened from may be gone with it, and a selection on a row that no
    // longer exists would leave the columns with no anchor.
    const archived = node !== undefined && inArchive(state, node.id)
    const workspaceId = node === undefined ? null : workspaceOfNode(node)
    const nextSelection = archived && workspaceId !== null
      ? workspaceKey(workspaceId)
      : selectionAfterNodeDeletion(state, nodeId)
    const archiveRowKey = archived && workspaceId !== null ? archiveKey(workspaceId) : null
    const outcome = services.store.update(current => deleteNodeSubtree(current, nodeId))
    if (!outcome.ok) { setDialogError(describeError(t, outcome.error)); return }
    setView(current => current.selectedNodeId !== null
      && (doomed.has(current.selectedNodeId) || current.selectedNodeId === archiveRowKey)
      ? { ...current, selectedNodeId: nextSelection }
      : current)
    closeDraft()
  }

  /**
   * Put one topic subtree into its Workspace's archive.
   *
   * The whole block travels (the model detaches it in one revision bump), so
   * there is nothing to confirm: the move is visible (the archive footer count
   * updates), reversible and names the same Workspace it came from. The action
   * deliberately does not navigate: a reader keeps the row they were looking at,
   * and only a selection that pointed into the archived block moves up to its
   * parent (see {@link selectionAfterArchive}).
   * @param node - the topic to archive.
   */
  const putNodeInArchive = (node: MapNode): void => {
    const nextSelection = selectionAfterArchive(state, node.id, view.selectedNodeId)
    setError('')
    try {
      const outcome = services.store.update(current => archiveNode(current, node.id))
      if (!outcome.ok) { setError(describeError(t, outcome.error)); return }
      if (nextSelection !== view.selectedNodeId) update({ selectedNodeId: nextSelection })
    } catch (thrown) {
      setError(describeError(t, thrown))
    }
  }

  /**
   * Bring one archived topic back under the parent it came from.
   *
   * The model decides where it lands (original parent, else the Workspace root);
   * the view follows the restored row and scrolls it into sight.
   * @param node - the archived top-level topic.
   */
  const restoreNodeFromArchive = (node: MapNode): void => {
    setError('')
    try {
      const outcome = services.store.update(current => unarchiveNode(current, node.id))
      if (!outcome.ok) { setError(describeError(t, outcome.error)); return }
      if (searching) closeSearch()
      select(node.id)
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          document.querySelector(`.cm-node-area [data-node-id="${node.id}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        })
      }
    } catch (thrown) {
      setError(describeError(t, thrown))
    }
  }

  /**
   * Put one conversation into its Workspace's archive.
   * @param thread - the conversation to archive.
   */
  const putThreadInArchive = (thread: ThreadRef): void => {
    setError('')
    try {
      const outcome = services.store.update(current => archiveThread(current, thread.sessionId))
      if (!outcome.ok) { setError(describeError(t, outcome.error)); return }
      // Filing a conversation away is not a navigation: the reader keeps the
      // row and column they were looking at; only the footer count moves.
    } catch (thrown) {
      setError(describeError(t, thrown))
    }
  }

  /**
   * Bring one archived conversation back to the topic it was filed under (or the
   * Workspace row when that topic is gone).
   * @param thread - the archived conversation.
   */
  const restoreThreadFromArchive = (thread: ThreadRef): void => {
    setError('')
    try {
      const outcome = services.store.update(current => unarchiveThread(current, thread.sessionId))
      if (!outcome.ok) { setError(describeError(t, outcome.error)); return }
      if (searching) closeSearch()
      const home = thread.nodeId !== null && state.nodes.some(node => node.id === thread.nodeId)
        ? thread.nodeId
        : (typeof thread.workspaceId === 'string' ? workspaceKey(thread.workspaceId) : null)
      if (home !== null) select(home)
    } catch (thrown) {
      setError(describeError(t, thrown))
    }
  }

  /** Fold or unfold one row's conversation list. */
  const toggleCollapsed = (key: string): void => {
    setView(current => ({
      ...current,
      collapsedIds: current.collapsedIds.includes(key)
        ? current.collapsedIds.filter(id => id !== key)
        : [...current.collapsedIds, key],
    }))
  }

  /** Open the Workspace-adoption dialog. */
  const openWorkspaceCreate = (): void => {
    setDialogError('')
    setDraft({ kind: 'workspace-create', path: '', title: '', titleTouched: false })
  }

  /**
   * Set the dialog's directory; an untouched name follows it.
   *
   * The name field is a proposal, not a second input the reader has to keep in
   * sync: picking a directory must fill the name it would get anyway, while a
   * name the reader typed stays theirs when they re-pick.
   * @param path - the typed or picked directory.
   */
  const setWorkspaceCreatePath = (path: string): void => {
    setDraft(current => current === null || current.kind !== 'workspace-create'
      ? current
      : {
          ...current,
          path,
          title: current.titleTouched ? current.title : workspaceNameFromPath(path),
        })
  }

  /** Fill the dialog path from the desktop shell's or the Host's directory chooser. */
  const chooseDirectory = (): void => {
    if (services.pickDirectory === undefined || draft === null || draft.kind !== 'workspace-create') return
    if (picking) return
    setDialogError('')
    setPicking(true)
    void (async () => {
      try {
        const picked = await services.pickDirectory?.()
        if (picked !== null && picked !== undefined) setWorkspaceCreatePath(picked)
      } catch (thrown) {
        // Every failure here is recoverable by hand: the field beside the
        // button takes an absolute path, so the guidance rides the message.
        setDialogError(t('panel.error.pickerFallback', { message: describeError(t, thrown) }))
      } finally {
        setPicking(false)
      }
    })()
  }

  /** The add button a topic column header carries: a topic owned by that column's parent. */
  const addTopicButton = (workspaceId: string | null, parentId: string | null): ReactNode => (
    <button
      type="button"
      className="cm-icon-btn"
      title={parentId === null ? t('panel.addTopNode') : t('panel.addChildNode')}
      aria-label={t('panel.addNode')}
      onClick={() => {
        setQuery('')
        setDialogError('')
        setDraft({ kind: 'node', workspaceId, parentId, title: '', description: '' })
      }}
    >
      <PlusGlyph />
    </button>
  )

  /** The Workspace column's add button: adopt a real directory as a Workspace. */
  const addWorkspaceButton: ReactNode = (
    <button
      type="button"
      className="cm-icon-btn"
      title={t('panel.addWorkspace')}
      aria-label={t('panel.addWorkspace')}
      onClick={openWorkspaceCreate}
    >
      <PlusGlyph />
    </button>
  )

  /** The Workspace whose column is open, when one is. */
  const activeWorkspace = activeWorkspaceId === undefined || activeWorkspaceId === null
    ? undefined
    : scopedWorkspaces.find(workspace => workspace.workspaceId === activeWorkspaceId)
  // The default space's ungrouped row may carry legacy rootless topics; selecting
  // it opens their column (read-only: no `＋`, no new topics). Any other
  // ungrouped row is just a conversation list and opens nothing.
  const legacyColumnOpen = activeSpaceId === defaultSpaceId && activeWorkspaceId === null && legacyTopics.length > 0
  /** Top-level topics of the selected Workspace; empty when none is selected. */
  const workspaceTopics = activeWorkspace === undefined ? [] : activeTopNodesOf(state, activeWorkspace.workspaceId)
  /** How much one Workspace holds in its archive (the footer row's own count). */
  const activeArchiveStats = activeWorkspace === undefined
    ? { nodes: 0, sessions: 0 }
    : archiveStatsOf(state, activeWorkspace.workspaceId)
  /**
   * Whether the archive column is open.
   *
   * It opens when the reader selected the archive row, or when the selection
   * lives inside the archive (a topic or a conversation filed there): the column
   * chain then reads `工作区 → 已归档 → …` without requiring the reader to
   * unfold the archive by hand first.
   */
  const archiveColumnOpen = activeWorkspace !== undefined
    && (activeArchiveStats.nodes > 0 || activeArchiveStats.sessions > 0)
    && (
      (selectionArchive !== undefined && selectionInScope === true)
      || (selectedTopic !== undefined && inArchive(state, selectedTopic.id))
    )
  // A Workspace opens its topic column when it has active topics, archived
  // content (the archive row is this column's footer), or the legacy rootless
  // bucket. An empty column is not a container, it is dead space beside the
  // tree; the archive footer is what keeps this one meaningful.
  const topicColumnOpen = legacyColumnOpen || workspaceTopics.length > 0
    || activeArchiveStats.nodes > 0 || activeArchiveStats.sessions > 0

  /** One column per level the selection has opened. */
  const columns: NodeColumn[] = searching
    ? (() => {
      const rows: NodeRow[] = searchView.nodes.map(item => nodeRow(item.node, searchNote(item.context, item.snippet)))
      if (searchView.threads.length > 0) {
        rows.push({
          id: SEARCH_THREADS_ID,
          title: t('panel.search.matchedThreads'),
          kind: 'node' as const,
          childCount: 0,
          tools: false,
          // The group heading is not a node: selecting it used to write the
          // synthetic id into `selectedNodeId`, leaving the tree with no row.
          selectable: false,
          collapsed: false,
          threads: searchView.threads.map(item => threadRowOf(item.thread, searchNote(item.context, item.snippet))),
        })
      }
      // The Host index fills over several polls, and the first reply itself
      // takes a debounce plus one budgeted read. Until it says it is done, an
      // empty list is not an answer — claiming 「没有匹配」 there flashed for
      // ~0.5s on the first body query before the hits arrived.
      const bodyPending = searching
        && bodySearchAvailable
        && !bodySearchUnsupported
        && bodyQuery.length >= BODY_QUERY_MIN
        && (contentProgress === null || !contentProgress.done)
      if (searchView.empty && !bodyPending) {
        rows.push(hintRow(
          SEARCH_EMPTY_ID,
          t('panel.search.empty', { query: bodyQuery }),
        ))
      }
      if (searchView.empty && bodyPending) {
        rows.push(hintRow(
          SEARCH_PROGRESS_ID,
          contentProgress === null
            ? t('panel.search.scanning')
            : t('panel.search.scanningProgress', {
              scanned: contentProgress.scanned,
              total: contentProgress.total,
            }),
        ))
      }
      return [{
        key: 'search',
        title: searchView.items.length === 0
          ? t('panel.search.title')
          : t('panel.search.titleCount', { n: searchView.items.length }),
        rows,
      }]
    })()
    : (() => {
      const built: NodeColumn[] = [{
        key: 'workspaces',
        title: levelLabel(0),
        headerActions: addWorkspaceButton,
        rows: workspaceReady
          ? (() => {
            const rows: NodeRow[] = []
            if (scopedWorkspaces.length === 0) {
              rows.push(hintRow(
                '@hint-empty-space',
                t('panel.emptySpace', {
                  space: activeSpace === undefined
                    ? t('panel.thisSpace')
                    : displaySpaceTitle(t, activeSpace, state),
                }),
              ))
            }
            for (const workspace of scopedWorkspaces) rows.push(workspaceRow(workspace))
            // Every space keeps its own ungrouped row so a goal-less
            // conversation can be started from anywhere.
            rows.push(looseRow(activeSpaceId))
            return rows
          })()
          : [{
            id: PENDING_ROW_ID,
            title: t('panel.syncingWorkspaces'),
            kind: 'node' as const,
            childCount: 0,
            tools: false,
            collapsed: true,
            threads: [],
          }],
      }]
      if (workspaceReady && topicColumnOpen) {
        built.push(legacyColumnOpen
          ? {
            key: UNGROUPED_ID,
            title: levelLabel(1),
            rows: legacyTopics.map(node => nodeRow(node)),
          }
          : {
            key: activeWorkspace?.workspaceId ?? 'workspace-topics',
            title: levelLabel(1),
            headerActions: addTopicButton(activeWorkspace?.workspaceId ?? null, null),
            rows: workspaceTopics.map(node => nodeRow(node)),
            // The archive row is a fixed footer of this column: it never scrolls
            // out of reach, and it costs the active tree no row above it.
            ...(activeWorkspace === undefined ? {} : { footerRow: archiveRow(activeWorkspace.workspaceId) }),
          })
      }
      if (activeWorkspace !== undefined && archiveColumnOpen) {
        built.push({
          key: archiveKey(activeWorkspace.workspaceId),
          title: levelLabel(built.length),
          rows: archiveColumnRows(activeWorkspace.workspaceId),
        })
      }
      // Only a topic the selection actually passes through opens a column, and
      // only when it has children to show: an empty trailing column tells the
      // reader nothing. Archived topics grow nothing (`＋` omitted) but their
      // children still open normally.
      if (selectedTopic !== undefined) {
        for (const node of nodePath(state, selectedTopic.id)) {
          if (activeChildrenOf(state, node.id).length === 0) continue
          built.push({
            key: node.id,
            title: levelLabel(built.length),
            headerActions: inArchive(state, node.id) ? undefined : addTopicButton(workspaceOfNode(node), node.id),
            rows: activeChildrenOf(state, node.id).map(child => nodeRow(child)),
          })
        }
      }
      return built
    })()

  // The strip's start fade is chrome, not content: a reading never changes what
  // the panel renders, only how the stylesheet fades it, so the hook is written
  // straight to the DOM (the shell's tab strip keeps the same contract). It is
  // re-read after every commit that can change the strip's horizontal extent —
  // the column set and the reader's widths are its only inputs besides scroll
  // and measured size — and on the strip's own scroll and resize. The band's
  // gates (`visible`, `centreFits`) and the loading body unmount the strip, so
  // they are deps too: a fresh element arrives with neither the reading nor the
  // listener.
  const nodeAreaSignature = columns
    .map((column, index) => `${column.key}:${view.columnWidths[index] ?? NODE_COLUMN_WIDTH}`)
    .join('\u0000')
  useLayoutEffect(() => {
    const area = areaRef.current
    if (area === null) return undefined
    const apply = (): void => {
      if (scrolledFromStart(area)) area.dataset.scrolled = 'true'
      else delete area.dataset.scrolled
    }
    apply()
    area.addEventListener('scroll', apply, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(area)
    return () => {
      area.removeEventListener('scroll', apply)
      observer?.disconnect()
    }
  }, [nodeAreaSignature, visible, centreFits, snapshot.phase])

  /** Close the open menu and run its action. */
  const menuAction = (run: () => void): void => {
    setMenu(null)
    run()
  }

  const menuBody: ReactNode = (() => {
    if (menu === null) return null
    if (menu.kind === 'space') {
      const space = state.spaces.find(candidate => candidate.id === menu.id)
      if (space === undefined) return null
      return (
        <>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { openSpaceRename(space) }) }}>{t('panel.menu.renameSpace')}</button>
          {space.id !== defaultSpaceId && (
            <button type="button" className="cm-menu-item" data-danger="true" onClick={() => { menuAction(() => { openSpaceDelete(space) }) }}>{t('panel.menu.deleteSpace')}</button>
          )}
        </>
      )
    }
    if (menu.kind === 'workspace') {
      const selection = workspaceSelection(menu.id)
      if (selection === undefined || selection.workspaceId === null) return null
      const workspace = workspaces.find(candidate => candidate.workspaceId === selection.workspaceId)
      if (workspace === undefined) return null
      return (
        <>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { openWorkspaceRename(workspace) }) }}>{t('panel.menu.renameWorkspace')}</button>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { openWorkspaceSpace(workspace) }) }}>{t('panel.menu.workspaceSpace')}</button>
          <button type="button" className="cm-menu-item" onClick={() => {
            menuAction(() => {
              select(workspaceKey(workspace.workspaceId))
              setDialogError('')
              setDraft({ kind: 'node', workspaceId: workspace.workspaceId, parentId: null, title: '', description: '' })
            })
          }}>{t('panel.menu.newChild')}</button>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { newThread(workspaceKey(workspace.workspaceId)) }) }}>{t('panel.menu.startHere')}</button>
          <button type="button" className="cm-menu-item" data-danger="true" onClick={() => { menuAction(() => { openWorkspaceDelete(workspace) }) }}>{t('panel.menu.deleteWorkspace')}</button>
        </>
      )
    }
    if (menu.kind === 'node') {
      const node = state.nodes.find(candidate => candidate.id === menu.id)
      if (node === undefined) return null
      const archived = inArchive(state, node.id)
      const archiveRoot = typeof node.archivedAt === 'string' && node.archivedAt !== ''
      const editItem = (
        <button type="button" className="cm-menu-item" onClick={() => {
          menuAction(() => {
            setDialogError('')
            setDraft({
              kind: 'node',
              id: node.id,
              workspaceId: workspaceOfNode(node),
              parentId: node.parentId,
              originalParentId: node.parentId,
              title: node.title,
              description: node.description,
              ...archived ? { archived: true } : {},
            })
          })
        }}>{t('panel.menu.editNode')}</button>
      )
      if (archived) {
        return (
          <>
            {editItem}
            {archiveRoot && (
              <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { restoreNodeFromArchive(node) }) }}>
                {t('panel.menu.unarchive')}
              </button>
            )}
            <button type="button" className="cm-menu-item" data-danger="true" onClick={() => { menuAction(() => { openNodeDelete(node.id, node.title) }) }}>{t('panel.menu.deleteNode')}</button>
          </>
        )
      }
      return (
        <>
          {editItem}
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { select(node.id); setDialogError(''); setDraft({ kind: 'node', workspaceId: workspaceOfNode(node), parentId: node.id, title: '', description: '' }) }) }}>{t('panel.menu.newChild')}</button>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { newThread(node.id) }) }}>{t('panel.menu.startHere')}</button>
          <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { putNodeInArchive(node) }) }}>{t('panel.menu.archive')}</button>
          <button type="button" className="cm-menu-item" data-danger="true" onClick={() => { menuAction(() => { openNodeDelete(node.id, node.title) }) }}>{t('panel.menu.deleteNode')}</button>
        </>
      )
    }
    const thread = state.threads.find(candidate => candidate.sessionId === menu.id)
    if (thread === undefined) return null
    if (isArchivedThread(thread)) {
      return (
        <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { restoreThreadFromArchive(thread) }) }}>
          {t('panel.menu.unarchive')}
        </button>
      )
    }
    // A conversation inside an archived block has no menu of its own; it is
    // reachable, openable and renameable through the topic that owns it.
    if (thread.nodeId !== null && inArchive(state, thread.nodeId)) return null
    const loose = (thread.workspaceId ?? null) === null
    const entries = threadMenuModel(state, thread, t)
    const spaceItem = loose
      ? (
        <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { openThreadSpace(thread) }) }}>{t('panel.menu.assignSpace')}</button>
      )
      : null
    // The picker is the whole offer: every destination, including the Workspace
    // row itself, so there is no second entry and nothing that appears only
    // under conditions the reader cannot see (BL-1).
    const moveItem = entries.move
      ? (
        <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { openThreadMove(thread) }) }}>{t('panel.menu.moveTo')}</button>
      )
      : null
    // Only a conversation the Host accounts to a Workspace can enter that
    // Workspace's archive: ungrouped rows have no archive row to land in, and a
    // subagent child is reached from its parent.
    const archiveItem = entries.move && typeof thread.workspaceId === 'string'
      ? (
        <button type="button" className="cm-menu-item" onClick={() => { menuAction(() => { putThreadInArchive(thread) }) }}>{t('panel.menu.archive')}</button>
      )
      : null
    // A subagent row has no move of its own, so it says where it is managed
    // instead — the one explanation the conversation menu still carries.
    const noticeItem = entries.notice !== null
      ? <span className="cm-menu-note">{entries.notice}</span>
      : null
    return (
      <>
        {spaceItem}
        {moveItem}
        {archiveItem}
        {noticeItem}
      </>
    )
  })()

  /**
   * The editing dialog's parent options: topics inside the same Workspace.
   *
   * Creating never offers a destination anymore (the entry point already named
   * the parent), so only an edit computes the list.
   */
  const parentOptions: MapNode[] = (() => {
    if (draft === null || draft.kind !== 'node' || draft.id === undefined) return []
    const selfId = draft.id
    const workspaceId = draft.workspaceId
    return state.nodes.filter(node =>
      workspaceOfNode(node) === workspaceId
      && node.id !== selfId
      && !inArchive(state, node.id)
      && !nodePath(state, node.id).some(ancestor => ancestor.id === selfId))
  })()

  /** The owning Workspace's label for the topic dialog. */
  const dialogWorkspaceLabel = draft !== null && draft.kind === 'node'
    ? (() => {
      const workspace = workspaces.find(candidate => candidate.workspaceId === draft.workspaceId)
      return workspace === undefined ? t('common.ungrouped') : workspaceDisplayTitle(workspace, workspaceLabels)
    })()
    : ''

  /** Surface a store-level sync/conflict message next to local errors. */
  const displayError = error !== ''
    ? error
    : snapshot.error === undefined ? '' : formatMapNotice(t, snapshot.error)

  // Geometry handed to CSS: the band's box over the Conversation column
  // (left/top/width in the overlay layer's coordinates — the Windows desktop
  // caption row lives in the frame's padding, so the band's top is not 0 there),
  // the shipped header's leading-row offset/height (so the switch lines up with
  // the product's own header), the window-chrome inset the first control must
  // clear, and the window-edge gutter the first column owes while the band
  // covers the shell sidebar's seat (0 whenever a column still stands to its
  // left; see `windowEdgeGutter`).
  const bandStyle = {
    left: frame.left,
    top: frame.top,
    width: bandWidth,
    '--cm-band-head-top': `${frame.headTop}px`,
    '--cm-band-head-height': `${frame.headHeight}px`,
    '--cm-band-inset': `${frame.inset}px`,
    '--cm-band-window-gutter': `${windowEdgeGutter(frame)}px`,
  } as CSSProperties
  // The top bar keeps the band's own two-row chrome in every state; see
  // `bandHeaderHeight()` for why the blank Session does not shorten it.
  const topbarHeight = bandHeaderHeight(frame)
  // Whether the band draws the shell's second seat button itself.
  //
  // The shell hides that button while the band owns the leading row (the
  // `[data-shell-leading] button:not(:first-of-type)` rule in styles.ts), and the
  // band then draws its own in the same slot, so 「新建会话」 lands on the map's
  // selection instead of on the Workspace alone. `seatWidth` is the guard rather
  // than a nicety: mounting the seat and hiding its button are two independent
  // facts, so the band claims the slot only after *measuring* that the seat
  // really shrank from two 28px buttons (64px) to one (28px). If the rule ever
  // stops matching — it is a locale-independent structural selector, but it is
  // still the shell's DOM — the seat stays 64px wide, this flag stays false, and
  // the reader keeps today's layout with exactly one 新建会话 button; no
  // combination yields two. The selector is sibling-agnostic on purpose: while a
  // seat tooltip is open the design system clones the bubble in between the two
  // buttons, and the older adjacent-sibling form dropped out for that frame.
  const newSessionInSeat = frame.seatWidth > 0 && frame.seatWidth <= 32

  /** 关闭搜索：同时清空查询，否则结果视图会留在没有输入框的带里。 */
  const closeSearch = (): void => {
    setSearchOpen(false)
    setQuery('')
    setActiveResult(-1)
    setContentHits(current => (current.size === 0 ? current : new Map()))
    setContentProgress(current => (current === null ? current : null))
  }

  const searchField = (
    <label className="cm-search cm-band-search">
      <input
        aria-label={t('common.searchNodesOrConversations')}
        placeholder={activeSpace === undefined
          ? t('common.searchNodesOrConversations')
          : t('panel.search.inSpace', { space: displaySpaceTitle(t, activeSpace, state) })}
        value={query}
        autoFocus
        onChange={(event) => { setQuery(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { closeSearch(); return }
          const count = searchView.items.length
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (count === 0) return
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActiveResult(current => {
              if (current < 0) return step === 1 ? 0 : count - 1
              return (current + step + count) % count
            })
            return
          }
          if (event.key === 'Enter') {
            const item = searchView.items[activeResult]
            if (item === undefined) return
            event.preventDefault()
            openSearchItem(item)
          }
        }}
      />
      <span className="cm-band-search-hint" aria-hidden="true">
        {searchView.items.length > 0 ? t('panel.search.selectHint') : 'Esc'}
      </span>
    </label>
  )

  // 空间入口住在第二行，现在是一条面包屑：
  //
  //   [⌂ 全部空间 + Σ各空间状态簇]  ›  [当前空间 + 自身状态簇 + ⌄]
  //
  // 整条面包屑是一个控件：根段、分隔符、当前段、末尾 chevron 都在这一个
  // button 里，点任意位置（包括「全部空间」后面的数字）都会打开空间菜单。
  // 这样两段都没有死区，也不存在「哪个才是下拉」的问题；chevron 只出现一次，
  // 放在行尾（与参考图一致），菜单锚定整条 rect 的左缘，位置稳定。
  // 两段同屏，根 − 当前就是其他空间。状态簇沿用同一套四类与清零规则，根段只
  // 从 Σ spaceRollups 算，因此「合计 = Σ 各空间 = 菜单逐行相加」由构造保证。
  //
  // 密度按实际可用宽度测量（见 nextSpaceBreadcrumbDensity / spaceBreadcrumbDensities）：
  // 根段始终保留数字；每次宽度或内容变化后，当前段从最富的形态开始，只在空间
  // 名字真的被省略号挤压时逐级让出（数字簇 → 圆点 → 无），不再用固定带宽阈值。
  // 第二行在任何会话状态下都在（空会话也一样，见 bandHeaderHeight），所以入口
  // 不再需要在两行之间搬家。
  const currentSpaceRollup = spaceRollups.get(activeSpaceId)
  const currentSpaceTitle = activeSpace === undefined
    ? t('common.space')
    : displaySpaceTitle(t, activeSpace, state)
  // The row's leftover width, not the band's width, decides how much of the
  // current segment survives: at 378px the whole bar (both clusters, a
  // four-character space name and the chevron) measures 234px, so the old
  // 480/420px thresholds dropped the numbers with the row almost half empty.
  // The measured ladder starts rich and steps down only while the space name is
  // actually ellipsized; the key resets it after every width/content change so a
  // wider row (or a shorter name) climbs back up.
  const [measuredCurrentDensity, setMeasuredCurrentDensity] = useState<SpaceBreadcrumbDensity>('cluster')
  const crumbNameRef = useRef<HTMLSpanElement | null>(null)
  /** The last measurement key the ladder was (re)started for. */
  const crumbMeasureKeyRef = useRef('')
  const crumbMeasureKey = [
    visible ? 'visible' : 'hidden',
    bandWidth,
    windowEdgeGutter(frame),
    searchOpen ? 'search' : 'list',
    orderedSpaces.length <= 1 ? 'single' : 'multiple',
    currentSpaceTitle,
    rollupCountsSignature(allSpaceRollup),
    rollupCountsSignature(currentSpaceRollup),
  ].join('\u0000')
  useLayoutEffect(() => {
    // One effect drives the whole ladder, so a reset and a step can never compose
    // into the wrong rung: a width/content change first re-renders the richest
    // form (the commit below), and only the next pass measures that render and
    // steps down while the space name is being ellipsized.
    if (crumbMeasureKeyRef.current !== crumbMeasureKey) {
      crumbMeasureKeyRef.current = crumbMeasureKey
      if (measuredCurrentDensity !== 'cluster') {
        setMeasuredCurrentDensity('cluster')
        return
      }
    }
    const name = crumbNameRef.current
    if (name === null) return
    if (name.scrollWidth <= name.clientWidth + 1) return
    if (measuredCurrentDensity === 'none') return
    setMeasuredCurrentDensity(nextSpaceBreadcrumbDensity(measuredCurrentDensity))
  }, [measuredCurrentDensity, crumbMeasureKey])
  const densities = spaceBreadcrumbDensities({
    search: searchOpen,
    singleSpace: orderedSpaces.length <= 1,
    current: measuredCurrentDensity,
  })
  const openSpaceMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    spaceTriggerRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    setSpaceMenu(current => current === null ? { x: rect.left, y: rect.bottom + 6 } : null)
  }
  const spaceBreadcrumb = (
    <button
      type="button"
      className="cm-space-btn cm-crumb"
      aria-haspopup="menu"
      aria-expanded={spaceMenu !== null}
      aria-label={t('panel.spaceSwitcherLabel', { space: currentSpaceTitle })}
      title={t('panel.switchSpace')}
      onClick={openSpaceMenu}
    >
      <span className="cm-crumb-root">
        <HomeGlyph />
        <span className="cm-crumb-root-label">{t('common.allSpaces')}</span>
        {densities.root === 'cluster' && (
          <StatusRollupBadge rollup={allSpaceRollup} density="cluster" scope={t('panel.scope.allSpacesAll')} />
        )}
      </span>
      <span className="cm-crumb-sep" aria-hidden="true">›</span>
      <span className="cm-crumb-current">
        <span className="cm-space-name" ref={crumbNameRef}>{currentSpaceTitle}</span>
        {densities.current !== 'none' && currentSpaceRollup !== undefined && (
          <StatusRollupBadge rollup={currentSpaceRollup} density={densities.current} scope={t('panel.scope.currentSpaceAll')} />
        )}
      </span>
      <ChevronGlyph />
    </button>
  )

  // ── the open conversation's home: the filled folder, the dock line ───────
  // The band's second row no longer carries a reading chip: the composer-side
  // line (registered into `conversation.input.dock`) names the home chain only
  // when the reader is about to type, and the tree itself states the same home
  // with a filled folder (plus a brand folder outline on its lineage). The only
  // shared fact is this projection of the open conversation's home; everything
  // visual is derived from it (and from the view the bridge publishes).
  //
  // The tree marks the row that stands for the conversation on screen, which is
  // not always `view.openSessionId`: a subagent child has no row of its own, so
  // the row is the child's nearest visible ancestor (`readingSessionOf`).
  // Reading a subagent therefore draws the same marks as reading its parent —
  // one solid conversation row, the filled home folder, the home chain — while
  // the view and the band's pane keep naming the child that is really open.
  const readingSessionId = readingSessionOf(byId, view.openSessionId)
  const sessionHome = useMemo(
    () => sessionHomeSelection(state, readingSessionId),
    [state, readingSessionId],
  )
  // The open conversation's home path as row keys: the home row plus every
  // container above it (the Workspace row and ancestor topics). The rows carry
  // `data-session-path`; the sheet states the chain with the filled brand folder
  // and the bold title — always on, so a reader returning to the tree still
  // knows which branch the live conversation lives under, even when the home's
  // own column is not rendered. The attribute is written for every chain row,
  // including a row that is also the current selection: the chain style wins
  // there, and the selection border only appears off the chain. The composer
  // line names the chain in words.
  const sessionPathKeys: ReadonlySet<string> | undefined = sessionHome === null
    ? undefined
    : (() => {
      if (sessionHome.nodeId === null) {
        const keys = new Set([sessionHome.selection])
        if (isArchiveSelectionKey(sessionHome.selection) && sessionHome.workspaceId !== null) {
          keys.add(workspaceKey(sessionHome.workspaceId))
        }
        return keys
      }
      const keys = new Set(ancestorRowKeys(state, sessionHome.nodeId))
      keys.add(sessionHome.nodeId)
      return keys
    })()

  if (!visible) {
    if (!mountFailed) return null
    return (
      <div className="cm-band-unavailable" role="status">
        <span>{t('panel.mountFailed')}</span>
        <button type="button" className="cm-btn" onClick={() => { services.collapse?.() }}>{t('panel.collapseTree')}</button>
      </div>
    )
  }

  // Below MIN_CENTRE_FOR_BAND the band cannot exist at any usable width. The
  // effect above collapses the store in that case, so the header's expand seat
  // takes over and this render is the single frame before that commit; it never
  // becomes a state the reader can sit in.
  if (!centreFits) return null

  if (snapshot.phase === 'loading') {
    return (
      <section
        className="cm-band"
        data-conversation-map=""
        data-conversation-map-loading=""
        style={bandStyle}
      >
        <div className="cm-band-loading" role="status">{t('panel.loadingTree')}</div>
      </section>
    )
  }

  return (
    <section
      className="cm-band"
      data-conversation-map=""
      data-status-source={typeof props.useSessionStatus === 'function' ? 'live' : 'none'}
      style={bandStyle}
      aria-label={t('common.panelTitle')}
    >
      {/* The band's top bar is this surface's window-chrome row. The shell's
          macOS drag contract is opt-in per row: ui-web's base.css declares the
          only darwin drag rule (`html[data-platform=darwin] [data-window-drag]`,
          and its global no-drag list keeps buttons/inputs clickable), and each
          chrome row marks itself — the sidebar's 52px top strip and logo row,
          and the Conversation's `<header>`. Map mode collapses the product's
          left column, so the sidebar's two rows leave with it, and the plugin's
          reservation shifts the Conversation header one band-width right; this
          top bar is what is left over that strip. It keeps the band's own
          two-row height in every state (`bandHeaderHeight()`), so while a
          Session is open it is the same 76px row as the header beside it; it
          claims the same drag mark either way and the window stays draggable
          from the band's blank runs. Only the mark is added here: the drag rule
          itself stays the shell's, and the controls keep their own `no-drag`
          from the shell's global list. */}
      <header className="cm-band-topbar" data-window-drag style={{ height: topbarHeight }}>
        <div className="cm-band-head-row">
          {/* The leading row keeps the shell's order — 打开侧边栏, 新建会话,
              收起 — and only changes who draws the second and third controls.
              The shell's own 新建会话 is hidden in the same state (styles.ts),
              so this button lands on the exact slot it vacates (x 124 while the
              seat's remaining button ends at 116), and the row's own 8px gap puts
              the collapse control back at x 160: the numbers do not move. */}
          {newSessionInSeat && (
            <button
              type="button"
              className="cm-lead-icon"
              title={t('common.newSession')}
              aria-label={t('common.newSession')}
              onClick={() => { newThread(newThreadKey()) }}
            >
              <NewChatGlyph />
            </button>
          )}
          <ViewToggle target="conversation" compact onSelect={() => { services.collapse?.() }} />
          <div className="cm-top-actions">
            {snapshot.phase === 'local' && (
              <span className="cm-error" title={t('panel.localModeHint')} style={{ opacity: 0.75 }}>{t('common.localMode')}</span>
            )}
            {displayError !== '' && <span className="cm-error">{displayError}</span>}
            <button
              type="button"
              className="cm-btn cm-band-search-toggle"
              data-open={searchOpen ? 'true' : undefined}
              title={searchOpen ? t('panel.search.close') : t('panel.search.openTitle')}
              aria-label={searchOpen ? t('panel.search.close') : t('common.search')}
              aria-expanded={searchOpen}
              onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true) }}
            >
              <span className="cm-btn-glyph" aria-hidden="true"><SearchGlyph /></span>
            </button>
            {typeof services.sessions.refresh === 'function' && (
              <button
                type="button"
                className="cm-btn cm-band-refresh"
                title={t('panel.moreActions')}
                aria-label={t('panel.moreActions')}
                aria-haspopup="menu"
                aria-expanded={overflowMenu !== null}
                onClick={(event) => {
                  if (overflowMenu !== null) {
                    setOverflowMenu(null)
                    return
                  }
                  const rect = event.currentTarget.getBoundingClientRect()
                  setOverflowMenu({
                    right: (typeof window === 'undefined' ? 0 : window.innerWidth) - rect.right,
                    top: rect.bottom + 6,
                  })
                }}
              >
                <span className="cm-btn-glyph" aria-hidden="true"><EllipsisGlyph /></span>
              </button>
            )}
          </div>
        </div>
        {/* 第二行与原生会话头的页签行等高：左侧是空间面包屑，右侧只在搜索时
            展开输入框（归属说明已移到 composer 上方的常驻上下文行，不再占用
            这一行）。空会话也保留这一行，见 bandHeaderHeight()。 */}
        <div className="cm-band-row2">
          {spaceBreadcrumb}
          {searchOpen && searchField}
        </div>
      </header>

      <div className="cm-band-body">
        <div className="cm-band-main">
          <div
            className="cm-node-area"
            ref={areaRef}
            data-drag={dragKey !== null || dragGroupKey !== null ? 'true' : undefined}
            onPointerMove={moveRowDrag}
            onPointerUp={endRowDrag}
            onPointerCancel={(event) => { cancelDrag(event.pointerId) }}
            onLostPointerCapture={() => { cancelDrag() }}
            onPointerDownCapture={() => { swallowClickRef.current.pending = false }}
            onClickCapture={swallowClick}
          >
            {columns.map((column, index) => (
              <Fragment key={column.key}>
                <NodeColumnView
                  column={column}
                  width={view.columnWidths[index] ?? NODE_COLUMN_WIDTH}
                  selectedNodeId={selectedNodeId}
                  ancestorKeys={ancestorKeys}
                  sessionPathKeys={sessionPathKeys}
                  activeRowKey={searching ? searchView.items[activeResult]?.key ?? null : null}
                  openSessionId={readingSessionId}
                  homeRowKey={sessionHome === null ? null : sessionHome.selection}
                  menuRowId={menu?.id ?? null}
                  onSelectNode={selectNodeRow}
                  onOpenThread={openThread}
                  onNewThread={newThread}
                  onToggleNode={toggleCollapsed}
                  onMenu={setMenu}
                  onRowPointerDown={beginRowDrag}
                  draggingKey={dragKey}
                  draggingGroupKey={dragGroupKey}
                  dropGroupKey={overlay?.groupKey ?? null}
                  dropGroupState={overlay === null ? 'none' : overlay.held ? 'held' : overlay.tone}
                  dropGroupMode={overlay?.mode ?? null}
                  insertEdge={overlay?.insertEdge ?? null}
                />
                <Gutter
                  width={view.columnWidths[index] ?? NODE_COLUMN_WIDTH}
                  onResize={(next) => { resizeNodeColumn(index, next) }}
                />
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      {/* The handle is a child of the band, not of `.cm-band-body`: the seam it
          draws runs from y=0 through the shipped header, so its hit area has to
          start there too. Inside the body it began at the header's foot, and the
          header's 40/76px of seam was decoration over the product's Conversation
          root — a press there resized nothing (on macOS the top bar's
          `data-window-drag` took it and moved the window instead). See the
          `.cm-band-gutter` rule in styles.ts for the app-region half of this. */}
      <BandGutter width={bandWidth} max={maxWidth} onResize={resizeMap} />

      {/* The gesture's own layer: it follows the pointer and never takes one. */}
      {overlay !== null && (
        <DragLabel label={overlay.label} tone={overlay.tone} elementRef={labelRef} />
      )}

      {menu !== null && menuBody !== null && (
        <>
          <div className="cm-backdrop" onClick={() => { setMenu(null) }} />
          <div className="cm-menu" style={{ left: menu.x, top: menu.y }} role="menu">{menuBody}</div>
        </>
      )}

      {spaceMenu !== null && (
        <>
          <div className="cm-backdrop" onClick={() => { setSpaceMenu(null) }} />
          <div className="cm-menu cm-space-menu" style={{ left: spaceMenu.x, top: spaceMenu.y }} role="menu" aria-label={t('panel.switchSpace')}>
            {orderedSpaces.map(space => {
              const active = space.id === activeSpaceId
              return (
                <div
                  key={space.id}
                  className="cm-space-row"
                  data-active={active}
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={0}
                  title={t('panel.spaceRowTitle', {
                    space: displaySpaceTitle(t, space, state),
                    n: workspaceCounts.get(space.id) ?? 0,
                  })}
                  onClick={() => { setSpaceMenu(null); switchSpace(space.id) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') { setSpaceMenu(null); switchSpace(space.id) } }}
                >
                  <span className="cm-space-check" aria-hidden="true">{active ? '✓' : ''}</span>
                  <span className="cm-space-row-title">{displaySpaceTitle(t, space, state)}</span>
                  <SpaceMenuTrailing
                    rollup={spaceRollups.get(space.id)}
                    workspaceCount={workspaceCounts.get(space.id) ?? 0}
                  />
                  <button
                    type="button"
                    className="cm-icon-btn cm-space-row-menu"
                    title={t('panel.spaceSettings')}
                    aria-label={t('panel.spaceSettings')}
                    onClick={(event) => {
                      event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      setSpaceMenu(null)
                      setMenu({ kind: 'space', id: space.id, x: rect.left, y: rect.bottom })
                    }}
                  >
                    <EllipsisGlyph />
                  </button>
                </div>
              )
            })}
            <div className="cm-menu-sep" />
            <button type="button" className="cm-menu-item" onClick={() => { setSpaceMenu(null); openSpaceCreate() }}>{t('panel.newSpaceAction')}</button>
            {orderedSpaces.length <= 1 && (
              <span className="cm-menu-note">{t('panel.spaceCreateNote')}</span>
            )}
          </div>
        </>
      )}

      {overflowMenu !== null && (
        <>
          <div className="cm-backdrop" onClick={() => { setOverflowMenu(null) }} />
          <div
            className="cm-menu"
            style={{ right: overflowMenu.right, top: overflowMenu.top }}
            role="menu"
            aria-label={t('panel.moreActions')}
          >
            <button
              type="button"
              className="cm-menu-item"
              title={t('panel.refreshSessionsHint')}
              onClick={() => { setOverflowMenu(null); void services.sessions.refresh?.() }}
            >
              {t('panel.refreshSessions')}
            </button>
          </div>
        </>
      )}

      {draft !== null && (
        <>
          <div className="cm-backdrop cm-backdrop--dialog" onClick={closeDraft} />
          <div className={dialogClass(draft)} role="dialog" aria-modal="true" aria-label={dialogTitle(t, draft)}>
            <div className="cm-card">
              <h3>{dialogTitle(t, draft)}</h3>
              {draft.kind === 'node' && (
                <>
                  {draft.id === undefined && (
                    <NodeLocationRail
                      workspaceLabel={dialogWorkspaceLabel}
                      ancestors={draft.parentId === null ? [] : nodePath(state, draft.parentId)}
                    />
                  )}
                  <div className="cm-field">
                    <label htmlFor="cm-draft-title">{t('common.name')}</label>
                    <input
                      id="cm-draft-title"
                      className="cm-input"
                      value={draft.title}
                      autoFocus
                      ref={draft.id === undefined ? nodeTitleRef : undefined}
                      placeholder={draft.id === undefined ? t('panel.nodeTitlePlaceholder') : undefined}
                      aria-invalid={draft.id === undefined && nodeTitleError ? true : undefined}
                      aria-describedby={draft.id === undefined && nodeTitleError ? 'cm-draft-title-error' : undefined}
                      onChange={(event) => {
                        if (draft.id === undefined) setNodeTitleError(false)
                        setDraft({ ...draft, title: event.target.value })
                      }}
                      onKeyDown={commitOnEnter}
                      onCompositionStart={onCompositionStart}
                      onCompositionEnd={onCompositionEnd}
                    />
                    {draft.id === undefined && nodeTitleError && (
                      <p className="cm-field-error" id="cm-draft-title-error" role="alert">{t('panel.nodeTitleRequired')}</p>
                    )}
                  </div>
                  <div className="cm-field">
                    <label htmlFor="cm-draft-desc">{t('common.description')}</label>
                    <textarea
                      id="cm-draft-desc"
                      className="cm-textarea"
                      value={draft.description}
                      placeholder={draft.id === undefined ? t('panel.nodeDescriptionPlaceholder') : undefined}
                      onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }}
                    />
                  </div>
                  {draft.id !== undefined && draft.archived !== true && (
                    <>
                      <div className="cm-field">
                        <label htmlFor="cm-draft-parent">{t('panel.parentNode')}</label>
                        <select
                          id="cm-draft-parent"
                          className="cm-select"
                          value={draft.parentId ?? ''}
                          onChange={(event) => {
                            // D9: an anchor only means something inside one parent's
                            // sibling list, so changing the parent clears it.
                            setDraft({
                              ...draft,
                              parentId: event.target.value === '' ? null : event.target.value,
                              beforeNodeId: null,
                            })
                          }}
                        >
                          <option value="">{t('common.workspaceTopLevel')}</option>
                          {parentOptions.map(node => <option key={node.id} value={node.id}>{breadcrumb(state, node.id)}</option>)}
                        </select>
                      </div>
                      <NodePositionField
                        state={state}
                        parentId={draft.parentId}
                        workspaceId={draft.workspaceId}
                        selfId={draft.id}
                        value={draft.beforeNodeId ?? ''}
                        onChange={(next) => { setDraft({ ...draft, beforeNodeId: next === '' ? null : next }) }}
                      />
                      <p className="cm-hint">{t('panel.dialogWorkspace', { workspace: dialogWorkspaceLabel })}</p>
                    </>
                  )}
                  {draft.id !== undefined && draft.archived === true && (
                    <p className="cm-hint">{t('panel.archive.editNote')}</p>
                  )}
                </>
              )}
              {draft.kind === 'workspace-create' && (
                <>
                  <p className="cm-hint">{t('panel.workspaceCreateHint')}</p>
                  <div className="cm-field">
                    <label htmlFor="cm-workspace-path">{t('panel.directory')}</label>
                    <div className="cm-field-row">
                      <input
                        id="cm-workspace-path"
                        className="cm-input"
                        value={draft.path}
                        autoFocus
                        placeholder="~/projects/…"
                        onChange={(event) => { setWorkspaceCreatePath(event.target.value) }}
                        onKeyDown={commitOnEnter}
                        onCompositionStart={onCompositionStart}
                        onCompositionEnd={onCompositionEnd}
                      />
                      {services.pickDirectory !== undefined && (
                        <button
                          type="button"
                          className="cm-btn"
                          aria-busy={picking || undefined}
                          // The click must leave the card exactly as it was
                          // until the OS panel appears: taking focus dropped
                          // the path field's ring, and the old disabled style
                          // plus an extra hint line changed the card's height
                          // and re-centred it — visible movement during the
                          // wait, while native shows nothing at all.
                          onMouseDown={(event) => { event.preventDefault() }}
                          onClick={chooseDirectory}
                        >
                          {t('panel.chooseDirectory')}
                        </button>
                      )}
                    </div>
                    {picking && <span className="cm-sr-only" role="status">{t('panel.pickerPending')}</span>}
                  </div>
                  <div className="cm-field">
                    <label htmlFor="cm-workspace-create-title">{t('panel.workspaceName')}</label>
                    <input
                      id="cm-workspace-create-title"
                      className="cm-input"
                      value={draft.title}
                      placeholder={t('panel.workspaceNamePlaceholder')}
                      onChange={(event) => {
                        setDraft({ ...draft, title: event.target.value, titleTouched: true })
                      }}
                      onKeyDown={commitOnEnter}
                      onCompositionStart={onCompositionStart}
                      onCompositionEnd={onCompositionEnd}
                    />
                    <p className="cm-hint">{t('panel.workspaceNameHint')}</p>
                  </div>
                </>
              )}
              {draft.kind === 'workspace-rename' && (
                <div className="cm-field">
                  <label htmlFor="cm-workspace-title">{t('panel.workspaceName')}</label>
                  <input
                    id="cm-workspace-title"
                    className="cm-input"
                    value={draft.title}
                    autoFocus
                    onChange={(event) => { setDraft({ kind: 'workspace-rename', workspaceId: draft.workspaceId, title: event.target.value }) }}
                    onKeyDown={commitOnEnter}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={onCompositionEnd}
                  />
                </div>
              )}
              {draft.kind === 'workspace-delete' && (() => {
                const stats = archiveStatsOf(state, draft.workspaceId)
                const archivedItems = stats.nodes + stats.sessions
                return (
                  <>
                    <p className="cm-hint">{t('panel.workspaceDeleteConfirm', { title: draft.title })}</p>
                    {archivedItems > 0 && (
                      <p className="cm-hint">{t('panel.workspaceDeleteArchiveNote', { n: archivedItems })}</p>
                    )}
                  </>
                )
              })()}
              {draft.kind === 'node-delete' && (() => {
                const node = state.nodes.find(candidate => candidate.id === draft.nodeId)
                const ungrouped = node !== undefined && workspaceOfNode(node) === null
                const archived = node !== undefined && inArchive(state, node.id)
                const summary = subtreeDeletionSummary(state, draft.nodeId)
                const consequences = summary.nodes > 0 || summary.conversations > 0
                return (
                  <>
                    <p className="cm-dialog-lead">{t('panel.nodeDeleteConfirm', { title: draft.title })}</p>
                    {consequences && (
                      <div className="cm-dialog-notes">
                        {summary.nodes > 0 && (
                          <p className="cm-hint">{t('panel.nodeDeleteSubtreeNote', { n: summary.nodes })}</p>
                        )}
                        {summary.conversations > 0 && (
                          <p className="cm-hint">
                            {t(archived
                              ? 'panel.nodeDeleteArchivedNote'
                              : ungrouped ? 'panel.nodeDeleteSessionsNoteUngrouped' : 'panel.nodeDeleteSessionsNote', { n: summary.conversations })}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="cm-hint">{t('panel.nodeDeleteIrreversible')}</p>
                  </>
                )
              })()}
              {draft.kind === 'space-create' && (
                <>
                  <p className="cm-hint">{t('panel.spaceCreateHint')}</p>
                  <div className="cm-field">
                    <label htmlFor="cm-space-title">{t('panel.spaceName')}</label>
                    <input
                      id="cm-space-title"
                      className="cm-input"
                      value={draft.title}
                      autoFocus
                      placeholder={t('panel.spaceNamePlaceholder')}
                      onChange={(event) => { setDraft({ kind: 'space-create', title: event.target.value }) }}
                      onKeyDown={commitOnEnter}
                      onCompositionStart={onCompositionStart}
                      onCompositionEnd={onCompositionEnd}
                    />
                  </div>
                </>
              )}
              {draft.kind === 'space-rename' && (
                <div className="cm-field">
                  <label htmlFor="cm-space-rename-title">{t('panel.spaceName')}</label>
                  <input
                    id="cm-space-rename-title"
                    className="cm-input"
                    value={draft.title}
                    autoFocus
                    onChange={(event) => { setDraft({ kind: 'space-rename', spaceId: draft.spaceId, title: event.target.value }) }}
                    onKeyDown={commitOnEnter}
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={onCompositionEnd}
                  />
                </div>
              )}
              {draft.kind === 'space-delete' && (
                <p className="cm-hint">{t('panel.spaceDeleteConfirm', { title: draft.title })}</p>
              )}
              {draft.kind === 'workspace-space' && (
                <>
                  <p className="cm-hint">{t('panel.workspaceSpaceHint', { title: draft.title })}</p>
                  <div className="cm-field">
                    <label htmlFor="cm-workspace-space">{t('common.space')}</label>
                    <select
                      id="cm-workspace-space"
                      className="cm-select"
                      value={draft.spaceId}
                      onChange={(event) => { setDraft({ kind: 'workspace-space', workspaceId: draft.workspaceId, title: draft.title, spaceId: event.target.value }) }}
                    >
                      {orderedSpaces.map(space => (
                        <option key={space.id} value={space.id}>{displaySpaceTitle(t, space, state)}{space.id === defaultSpaceId ? t('panel.defaultSuffix') : ''}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {draft.kind === 'thread-space' && (
                <>
                  <p className="cm-hint">{t('panel.threadSpaceHint', { title: draft.title })}</p>
                  <div className="cm-field">
                    <label htmlFor="cm-thread-space">{t('common.space')}</label>
                    <select
                      id="cm-thread-space"
                      className="cm-select"
                      value={draft.spaceId}
                      onChange={(event) => { setDraft({ kind: 'thread-space', sessionId: draft.sessionId, title: draft.title, spaceId: event.target.value }) }}
                    >
                      {orderedSpaces.map(space => (
                        <option key={space.id} value={space.id}>{displaySpaceTitle(t, space, state)}{space.id === defaultSpaceId ? t('panel.defaultSuffix') : ''}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {draft.kind === 'move-thread' && (
                <>
                  <p className="cm-hint">
                    {t('panel.moveThreadHint', {
                      title: threadOfSession(state, draft.sessionId)?.title ?? t('panel.thisConversation'),
                    })}
                  </p>
                  <MoveThreadField
                    state={state}
                    sessionId={draft.sessionId}
                    workspaceId={draft.workspaceId}
                    value={draft.nodeId ?? ''}
                    onChange={(next) => { setDraft({ ...draft, nodeId: next === '' ? null : next }) }}
                  />
                </>
              )}
              {dialogError !== '' && <p className="cm-error" role="alert">{dialogError}</p>}
              <div className="cm-toolbar">
                <button
                  type="button"
                  className="cm-btn"
                  data-primary={draft.kind !== 'workspace-delete' && draft.kind !== 'space-delete' && draft.kind !== 'node-delete'}
                  data-danger={draft.kind === 'workspace-delete' || draft.kind === 'space-delete' || draft.kind === 'node-delete' ? 'true' : undefined}
                  disabled={busy}
                  onClick={submitDraft}
                >
                  {busy ? t('panel.working') : dialogPrimaryLabel(t, draft)}
                </button>
                <button type="button" className="cm-btn" autoFocus={draft.kind === 'node-delete'} onClick={closeDraft}>{t('common.cancel')}</button>
                {draft.kind === 'node' && draft.id !== undefined && (
                  <button
                    type="button"
                    className="cm-btn"
                    onClick={() => { openNodeDelete(draft.id as string, state.nodes.find(node => node.id === draft.id)?.title ?? draft.title) }}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Title one dialog.
 * @param t - the active translator.
 * @param draft - the open dialog.
 * @returns its heading.
 */
function dialogTitle(t: Translate, draft: Draft): string {
  if (draft.kind === 'workspace-create') return t('panel.dialog.workspaceCreate')
  if (draft.kind === 'workspace-rename') return t('panel.dialog.workspaceRename')
  if (draft.kind === 'workspace-delete') return t('panel.dialog.workspaceDelete')
  if (draft.kind === 'space-create') return t('panel.dialog.spaceCreate')
  if (draft.kind === 'space-rename') return t('panel.dialog.spaceRename')
  if (draft.kind === 'space-delete') return t('panel.dialog.spaceDelete')
  if (draft.kind === 'node-delete') return t('panel.dialog.nodeDelete')
  if (draft.kind === 'workspace-space') return t('panel.dialog.workspaceSpace')
  if (draft.kind === 'thread-space') return t('panel.dialog.threadSpace')
  if (draft.kind === 'move-thread') return t('panel.dialog.moveThread')
  return draft.id === undefined ? t('panel.dialog.nodeCreate') : t('panel.dialog.nodeEdit')
}

/**
 * The default Workspace name a directory yields: its final path segment.
 *
 * Trailing separators are ignored so a path pasted from a file manager's
 * breadcrumb ("/srv/projects/alpha/") names the directory itself rather
 * than an empty segment, and both separators are accepted because the field may
 * carry a path copied from another platform. A root ("/") has no segment: the
 * reader has to name that Workspace themselves.
 * @param path - the typed or picked directory.
 * @returns the basename, or `''` when the path names no segment.
 */
export function workspaceNameFromPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/u, '')
  const segment = trimmed.split(/[\\/]/u).pop() ?? ''
  return segment.trim()
}

/**
 * The name a Workspace-create dialog intends, before the Host resolves the path.
 *
 * The name field is the outcome, not a second input to keep in sync: a name the
 * reader typed wins, an untouched field asks the directory to name it, and a
 * field the reader cleared is an explicit "no name" — refused as a blank title.
 * @param draft - the create draft's path, name and whether the name was edited.
 * @returns the intended name, or `''` when it names nothing.
 */
export function workspaceCreateName(draft: { path: string; title: string; titleTouched: boolean }): string {
  const typed = draft.title.trim()
  if (typed !== '') return typed
  return draft.titleTouched ? '' : workspaceNameFromPath(draft.path)
}

/**
 * Whether another Workspace already carries this name.
 *
 * The Host refuses a duplicate title when renaming; asking here first lets the
 * dialog answer in the reader's language. The Workspace being named never
 * conflicts with itself.
 * @param items - the Host's Workspace rows.
 * @param exceptId - the Workspace being named.
 * @param name - the intended title.
 * @returns whether another row carries that title.
 */
export function workspaceTitleTaken(
  items: readonly { workspaceId: string; title: string }[],
  exceptId: string | null,
  name: string,
): boolean {
  return items.some(workspace => workspace.workspaceId !== exceptId && workspace.title === name)
}

/**
 * Why a node title would block creating it.
 * @param title - the raw input.
 * @returns `'required'` for a blank title, else `null`.
 */
export function nodeTitleIssue(title: string): 'required' | null {
  return title.trim() === '' ? 'required' : null
}

/**
 * Label a dialog's primary button.
 *
 * The create dialog creates; everything else keeps its old vocabulary. The
 * split lives here rather than in the JSX so the new-node / edit-node wording
 * is unit-testable without opening a renderer.
 * @param t - the active translator.
 * @param draft - the open dialog.
 * @returns the action label.
 */
export function dialogPrimaryLabel(t: Translate, draft: Draft): string {
  if (draft.kind === 'workspace-create' || draft.kind === 'space-create') return t('common.create')
  if (draft.kind === 'workspace-delete' || draft.kind === 'space-delete' || draft.kind === 'node-delete') return t('common.delete')
  if (draft.kind === 'move-thread') return t('common.move')
  if (draft.kind === 'node' && draft.id === undefined) return t('common.create')
  return t('common.save')
}
