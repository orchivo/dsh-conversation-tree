/**
 * The column strip of the node area.
 *
 * Every column is one level and carries a fixed label, so a column never claims
 * to be the node above it. Rows follow the application's own workspace list: a
 * 34px node row and a 32px conversation row, a 16px leading slot, hover-revealed
 * icon actions, and a trailing time that the actions replace on hover. A node's
 * leading slot is a folder that swaps to a fold arrow while the row is hovered;
 * a conversation's slot carries only an activity dot. Both rows share the same
 * leading geometry, so their titles line up.
 *
 * Columns scroll vertically on their own; horizontal scrolling belongs to the
 * node area that holds them. A column may also pin one footer row (the archive
 * door) under its scroller, so that row stays reachable however long the list
 * grows.
 *
 * A row holds its title on one ellipsized line, and hovering narrows that line
 * again (the row's actions surface in the trailing slot). `RowTitleTip` restores
 * the full title as a hover bubble when — and only when — the label really
 * clips; see `row-tip.tsx`.
 */
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

import type { Translate } from '../shared/copy.js'
import { clampColumnWidth } from '../shared/view-state.js'
import type { StatusRollup } from '../shared/status-rollup.js'
import { useT } from './locale.js'
import type { DragPayload } from './row-drag.js'
import { RowTitleTip } from './row-tip.js'
import { StatusRollupBadge } from './StatusRollup.js'

/** One status mark, drawn exactly as the application's own rows draw it. */
export interface ThreadStatus {
  /** Which mark to draw; `ongoing` is the spinning ring. */
  state: 'done' | 'warning' | 'ongoing'
  /** Full wording, used as the accessible name and the tooltip. */
  label: string
  /** Compact wording that replaces the age while something is pending. */
  compact: string
}

/** One conversation shown under its owning node. */
export interface ThreadRow {
  sessionId: string
  title: string
  /** Compact relative age, empty when unknown. */
  time: string
  /** The status mark, absent for an idle conversation. */
  status?: ThreadStatus
  /**
   * The Workspace the conversation is accounted to; `null` = the ungrouped
   * bucket, `undefined` = the Host has not accounted it yet.
   *
   * Both the ungrouped bucket and an unaccounted conversation take no part in a
   * drag (there is no Workspace for a target to agree with), so the map reads
   * this before a press ever becomes a drag. It is also what a Workspace-level
   * conversation row reports as its parent for hit testing.
   */
  workspaceId?: string | null
  /**
   * Optional second line under the title.
   *
   * The search view uses it for the conversation's home path, or for the
   * message-body snippet with the query highlighted; ordinary rows leave it
   * `undefined` and keep their single 32px line.
   */
  note?: ReactNode
  /**
   * Whether the conversation sits in the archive.
   *
   * An archived conversation is still readable, openable and live — this plugin's
   * archive folds rows away, it does not freeze sessions — but it takes no part
   * in a drag: the menu's archive/unarchive action is the only way in or out, so
   * a drop can neither file something away nor pull it back out. The row states
   * it with `data-archived` for the hit test.
   */
  archived?: boolean
  /**
   * Whether the trailing `⋯` menu is offered. Defaults to true.
   *
   * A conversation inside an archived topic is restored with that whole block,
   * so it has no action of its own: the row stays openable but drops the menu.
   */
  menu?: boolean
}

/** One node row, with the conversations that belong to it nested beneath. */
export interface NodeRow {
  id: string
  title: string
  /**
   * What this row is. The first level lists Workspaces (and each space's
   * ungrouped bucket); every deeper level lists this plugin's topic nodes. An
   * `archive` row is the Workspace's synthetic 「已归档」 door — a system row,
   * not a topic — and a `hint` row is a non-interactive placeholder (an empty
   * space).
   */
  kind: 'workspace' | 'ungrouped' | 'node' | 'hint' | 'archive'
  /**
   * The Workspace this row belongs to, normalised; `null` for the ungrouped
   * bucket and for a legacy rootless topic. It is what the row reports as its
   * drag identity (`data-node-workspace-id`) and what its conversations inherit.
   */
  workspaceId?: string | null
  /**
   * How many child nodes this node has.
   *
   * Drawn only while the row shows no status rollup: the badge already answers
   * "is there anything in here?", and a second number in the same trailing slot
   * reads as another count of the same thing (see {@link showsStatusRollup}).
   */
  childCount: number
  /**
   * The row's status rollup (this row's conversations plus every descendant).
   *
   * Present only when the map has a status source; absent in the pure model
   * tests and when the profile has no `useSessionStatus` face.
   */
  rollup?: StatusRollup | undefined
  threads: ThreadRow[]
  /** Whether the row offers the per-node actions. */
  tools: boolean
  /**
   * Whether the trailing `⋯` menu is offered. `false` keeps the start action but
   * drops the menu: the ungrouped row has nothing to rename or delete.
   */
  menu?: boolean
  /**
   * Whether clicking the row selects it. `false` renders a static container that
   * still folds and starts conversations but never opens a column (the
   * ungrouped row is a conversation list, not a topic container).
   */
  selectable?: boolean
  /** Whether the nested conversation list is folded away. */
  collapsed: boolean
  /** Rendered after this node's conversations, e.g. a "show more" row. */
  threadFooter?: ReactNode
  /**
   * Optional second line under the title, used by the search view for the
   * node's home path or a description snippet with the query highlighted.
   */
  note?: ReactNode
  /**
   * Whether the row is inside the archive: an archived topic, or one of its
   * descendants (the rows of the archive column).
   *
   * An archived row keeps every reading affordance (it selects, folds, opens its
   * conversations) but offers no start action and is neither a drag source nor a
   * drop target: items enter and leave the archive only through the menu, so no
   * gesture can silently file something away or pull it back out. The group
   * states it with `data-group-archived` for the hit test.
   */
  archived?: boolean
  /**
   * Whether the row offers the start-a-conversation action. Defaults to true.
   *
   * A row can keep its menu and still refuse to grow: an archived topic can be
   * renamed, restored or deleted, but new work belongs in the active tree.
   */
  start?: boolean
  /**
   * Tooltip for the trailing number.
   *
   * The archive row counts conversations, so its bare number would otherwise
   * read as a child-topic count.
   */
  countTitle?: string
  /**
   * Whether the archive row is empty (no archived topics and no conversations).
   *
   * An empty archive says how it fills up; a non-empty one says what the row is.
   * The flag is explicit because the row's number counts conversations: a topic
   * put away without any conversation is still content, and must not read as an
   * empty archive.
   */
  empty?: boolean
  /**
   * One live mark the row shows in its trailing slot, ahead of the count.
   *
   * The archive row is the only user: work hidden behind the archive door still
   * has to be visible from the active tree. The archive reports nothing else —
   * its completed work is exactly what the reader chose to put away.
   */
  activity?: { kind: 'running' | 'attention'; label: string }
}

/** One column: a level of nodes, with a label that never changes. */
export interface NodeColumn {
  key: string
  title: string
  rows: NodeRow[]
  /** Buttons belonging to the column itself. */
  headerActions?: ReactNode
  /**
   * A row pinned under the scrolling rows, at the column's own bottom edge.
   *
   * The archive row is the footer: it must stay reachable however long the topic
   * list grows. It is rendered outside `.cm-col-scroll` on purpose — the drag hit
   * test measures drop targets through that scroller, so a pinned strip cannot be
   * mistaken for the column's blank tail.
   */
  footerRow?: NodeRow
}

/** Where a row's "more" menu should open, in viewport coordinates. */
export interface MenuRequest {
  kind: 'node' | 'workspace' | 'thread' | 'space'
  id: string
  x: number
  y: number
}

/**
 * How a release over one group would go; drives that group's `data-drop-group`.
 *
 * `held` is U3's hysteresis: the pointer left every group (a gutter, a column's
 * blank edge, outside the band) but the last candidate is still what the reader
 * is aiming at, so the group keeps its mark instead of going dark. A release
 * there still writes nothing.
 */
export type DropState = 'valid' | 'invalid' | 'noop' | 'held' | 'none'

/** Which edge of a group an insertion line is drawn on. */
export type InsertEdge = 'before' | 'after'

/**
 * The inline mark a dragged conversation row wears while a drag is in flight.
 *
 * Inline on purpose: the plugin's sheet is shared with a concurrent editor, so
 * the gesture's visuals travel with the element that draws them. Only a
 * conversation dims one row; a topic dims its group (see {@link groupDragStyle}).
 * @param dragging - whether this row is the one being dragged.
 * @returns the row's inline style, or undefined when it wears nothing.
 */
function dragSourceStyle(dragging: boolean): CSSProperties | undefined {
  return dragging ? { opacity: 0.45 } : undefined
}

/**
 * The inline mark one drop group wears while a drag is in flight.
 *
 * A group is the target now, so the mark is one card over the header and every
 * row it owns. `into` (and a workspace target) paints the full "this whole block
 * is where it lands" card; a `before`/`after` reorder keeps a much lighter card
 * and lets the group-boundary insertion line carry the intent. `noop`/`held`
 * stay dashed; an `invalid` group is not painted at all — the pointer label owns
 * the refusal wording and the cursor says `no-drop`.
 * @param tone - how a release on this group would go.
 * @param mode - the insertion intent, when the target is a topic.
 * @param dragging - whether this group is the one being dragged.
 * @returns the group's inline style, or undefined when it wears nothing.
 */
function groupDragStyle(
  tone: DropState,
  mode: 'into' | 'before' | 'after' | null,
  dragging: boolean,
): CSSProperties | undefined {
  const style: CSSProperties = {}
  if (dragging) style.opacity = 0.45
  if (tone === 'valid') {
    const reorder = mode === 'before' || mode === 'after'
    style.background = `color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) ${reorder ? '4' : '7'}%, transparent)`
    if (!reorder) {
      style.boxShadow = 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 32%, transparent)'
    }
  } else if (tone === 'noop') {
    style.background = 'color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 6%, transparent)'
    style.outline = '1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 32%, transparent)'
    style.outlineOffset = -1
  } else if (tone === 'held') {
    style.background = 'color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 5%, transparent)'
    style.outline = '1px dashed color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 32%, transparent)'
    style.outlineOffset = -1
    style.opacity = 0.8
  }
  return Object.keys(style).length === 0 ? undefined : style
}

/**
 * The 2px insertion line a topic drop draws on a group's boundary.
 *
 * Inline on purpose: the plugin's sheet is shared with a concurrent editor, so
 * the drag's own visuals travel with the element that draws them. The theme
 * token keeps it in the product's brand colour in both themes.
 * @param edge - the edge the line marks.
 * @returns the line's inline style.
 */
export function insertionLineStyle(edge: InsertEdge): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    background: 'var(--dsw-alias-brand-primary, currentColor)',
    pointerEvents: 'none',
    ...edge === 'before' ? { top: -1 } : { bottom: -1 },
  }
}

/** Props of one rendered column. */
export interface NodeColumnViewProps {
  column: NodeColumn
  width: number
  selectedNodeId: string | null
  /**
   * Row keys above the selection that form the line it lives in: the Workspace
   * row and every ancestor topic, outermost first. These rows wear the
   * selection's quieter mark so the reader can tell which upper level's domain
   * the open column sits in; the selected row itself is not in this set.
   */
  ancestorKeys?: ReadonlySet<string>
  /**
   * The open conversation's home path: the home row and every container above
   * it.
   *
   * The row carries it as `data-session-path`. The sheet states the chain with
   * the filled brand folder and the bold title — always visible, so the reader
   * keeps knowing which branch the open conversation lives under even after the
   * selection moved elsewhere. The attribute is written for every chain row,
   * including a row that is also the current selection: the chain style wins
   * there (the owner's rule), and the selected row only gets the inset border
   * when it is *not* on the chain. The old second grey lane and the icon-only
   * path ink are gone; the composer's context bar names the chain in words.
   */
  sessionPathKeys?: ReadonlySet<string>
  /**
   * The row the search view's keyboard cursor is on (a node id or session id).
   *
   * The column draws one quiet active mark on that row; no other row ever
   * carries it, and ordinary columns pass `null`.
   */
  activeRowKey?: string | null
  /**
   * The conversation the tree marks as being read.
   *
   * It is the open one, except while a subagent child is open: the map gives the
   * child no row of its own, so the panel passes the child's nearest visible
   * ancestor (`readingSessionOf`) and reading a subagent draws the parent's row
   * exactly as reading the parent would. That row is the column's only solid
   * surface and carries `aria-current="page"`; no other row has either.
   */
  openSessionId: string | null
  /**
   * The row the open conversation is filed under, when the map knows it.
   *
   * It is drawn in the icon channel — a filled folder, not a surface and not
   * either selection mark: the reader can see where the conversation they are
   * reading lives even after the selection has moved to another branch, and the
   * filled folder never claims to be the selected row.
   */
  homeRowKey?: string | null
  /** The row whose menu is open, which pins that row's affordances. */
  menuRowId: string | null
  onSelectNode: (nodeId: string) => void
  onOpenThread: (sessionId: string) => void
  onNewThread: (nodeId: string) => void
  onToggleNode: (nodeId: string) => void
  onMenu: (request: MenuRequest) => void
  /**
   * A pointer press on a draggable row: a topic row or a conversation row.
   *
   * The column view knows nothing about dragging — it reports what was pressed,
   * and the map decides whether the press travels far enough to become one. Rows
   * that take no part in a drag (Workspace rows, the ungrouped bucket, legacy
   * rootless topics) do not report at all; the payload's Workspace is the map's
   * second, document-side check.
   */
  onRowPointerDown?: (payload: DragPayload, event: PointerEvent<HTMLDivElement>) => void
  /**
   * The conversation row being dragged, by session id.
   *
   * Only conversations dim a single row: a topic drag dims its whole group
   * (`draggingGroupKey`), because the conversations filed under it travel with
   * it and the group is what moves.
   */
  draggingKey?: string | null
  /** The group being dragged (a topic drag), by group key. */
  draggingGroupKey?: string | null
  /** The group under the pointer; every other group reads `none`. */
  dropGroupKey?: string | null
  /** How a release on `dropGroupKey` would go. */
  dropGroupState?: DropState
  /** The insertion intent the group under the pointer carries, if any. */
  dropGroupMode?: 'into' | 'before' | 'after' | null
  /** The group-boundary line to draw, when a release would insert at one. */
  insertEdge?: InsertEdge | null
}

/**
 * The group key a row answers to.
 *
 * Stable across collapse/expand and column rebuilds, so the measured rect and
 * the DOM mark cannot drift: topics key on their id, Workspaces on their id,
 * the archive row on its selection key, and the ungrouped bucket on its row key
 * (the row already names the space).
 * @param row - the rendered row.
 * @returns the key the hit test and the Mark use.
 */
function groupKeyOf(row: NodeRow): string {
  if (row.kind === 'node') return `node:${row.id}`
  if (row.kind === 'workspace') return `workspace:${row.workspaceId ?? ''}`
  if (row.kind === 'archive') return `archive:${row.id}`
  return `ungrouped:${row.id}`
}

/** Folder glyph marking a node. */
function NodeGlyph(): ReactNode {
  return (
    <svg className="cm-row-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
      <path d="M1.6 4.3c0-.6.5-1.1 1.1-1.1h2.9l1.3 1.6h6.4c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.7c-.6 0-1.1-.5-1.1-1.1z" />
    </svg>
  )
}

/**
 * Storage-box glyph marking the 「已归档」 door.
 *
 * It is deliberately not a folder: an archived topic is still a folder, while
 * this row is the room they were put away in.
 */
function ArchiveGlyph(): ReactNode {
  return (
    <svg className="cm-row-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
      <path d="M1.9 3.1h12.2v3.1H1.9z" />
      <path d="M2.9 6.2v6.1c0 .7.6 1.2 1.2 1.2h7.8c.7 0 1.2-.6 1.2-1.2V6.2" />
      <path d="M6.2 8.7h3.6" />
    </svg>
  )
}

/** Filled triangle: points right when folded, rotates down when open. */
function FoldGlyph(): ReactNode {
  return (
    <svg className="cm-fold" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4.2 11 8l-5 3.8z" fill="currentColor" />
    </svg>
  )
}

/** Speech glyph with a plus: start a conversation here. */
function NewThreadGlyph(): ReactNode {
  return (
    <svg className="cm-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
      <path d="M2.1 3.4h11.8v6.9H7.2L4 12.9v-2.6H2.1z" />
      <path d="M8 5.4v3M6.5 6.9h3" />
    </svg>
  )
}

/**
 * The application's own running indicator: a quiet ring with a breathing arc
 * that rotates continuously.
 *
 * Geometry mirrors the client's `StateDot` ongoing state — a 24-unit viewBox
 * drawn at 14px, a 9.5 radius, a 2-unit stroke, and one 1.5s period shared by
 * the spin and the dash — so a running conversation reads exactly like a
 * running session in the application's own list.
 */
function RunningRing(): ReactNode {
  /**
   * Pin the ring to document time zero.
   *
   * A CSS animation starts when its element is inserted, so rings mounted at
   * different moments turn out of phase. The application aligns its own loaders
   * the same way, which keeps the plugin's ring in step with them.
   * @param element - the mounted ring, or null on unmount.
   */
  const sync = (element: SVGSVGElement | null): void => {
    if (element === null) return
    for (const animation of element.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0
  }
  return (
    <svg ref={sync} className="cm-ring" width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
      <g className="cm-ring-motion">
        <circle className="cm-ring-track" cx={12} cy={12} r={9.5} />
        <circle className="cm-ring-arc" cx={12} cy={12} r={9.5} />
      </g>
    </svg>
  )
}

/** A solid state mark, matching the application's done and warning dots. */
function StatusDot({ state, label }: { state: 'done' | 'warning'; label: string }): ReactNode {
  return <span className="cm-state-dot" data-state={state} role="img" aria-label={label} title={label} />
}

/** Plus glyph: the column's own add action. */
export function PlusGlyph(): ReactNode {
  return (
    <svg className="cm-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.6v8.8M3.6 8h8.8" />
    </svg>
  )
}

/** Three dots: the row's more menu. */
export function EllipsisGlyph(): ReactNode {
  return (
    <svg className="cm-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={3.4} cy={8} r={1.15} fill="currentColor" />
      <circle cx={8} cy={8} r={1.15} fill="currentColor" />
      <circle cx={12.6} cy={8} r={1.15} fill="currentColor" />
    </svg>
  )
}

/**
 * Below this column width the rollup drops its counts and draws dots only.
 *
 * The default column is 220px; four counts plus their dots would take roughly
 * half the row and truncate the title. 200px keeps the default readable while
 * still giving a dragged-narrow column the quieter mark. The exact number is a
 * first-pass constant, measured against the real column widths in the client.
 */
const ROLLUP_DOTS_WIDTH = 200

/**
 * Whether a row's status rollup draws anything.
 *
 * The badge and the descendant count share one trailing slot, and the count sits
 * immediately left of the badge — two bare numbers in a row read as "this many
 * of the same thing". So the badge takes the slot and the count yields: a row
 * that reports a conversation state no longer prints its child-node count. It is
 * keyed to what is actually drawn, not to whether a status source exists, so an
 * idle row (every count zero) keeps its count exactly as before, and a profile
 * without `useSessionStatus` is untouched.
 * @param rollup - the row's counts, when the map has a status source.
 * @returns whether {@link StatusRollupBadge} renders a badge for this row.
 */
export function showsStatusRollup(rollup: StatusRollup | undefined): boolean {
  return rollup !== undefined && rollup.total > 0
}

/** Everything one row group needs from the column that draws it. */
interface RowGroupContext {
  /** The column key the group reports to the drag hit test. */
  columnKey: string
  /** The active translator, read once by the column. */
  t: Translate
  /** Whether a status rollup keeps its counts or draws dots only. */
  rollupDensity: 'dots' | 'cluster'
  /** The column's own props: selection marks, callbacks and drag state. */
  props: NodeColumnViewProps
}

/**
 * Render one row group: its header row (a topic, a Workspace, the ungrouped
 * bucket, or the archive door) plus the conversations nested under it.
 *
 * Extracted from the column loop so the pinned footer row
 * ({@link NodeColumn.footerRow}) is drawn by exactly the same code as a
 * scrolling row: the archive row has to select, answer the keyboard and wear the
 * same trailing count as any other row, and one renderer keeps the two paths
 * from drifting apart. A `hint` row stays a plain placeholder with no group
 * marks.
 * @param props - the row to draw and the context of the column drawing it.
 * @returns the group element.
 */
function NodeGroup({ row, context }: { row: NodeRow; context: RowGroupContext }): ReactNode {
  const { columnKey, t, rollupDensity, props } = context
  if (row.kind === 'hint') return <div className="cm-hint-row">{row.title}</div>
  const archive = row.kind === 'archive'
  // The group, not the row, is the target: every row of this block reports the
  // same key, so a pointer anywhere inside gets the same mark. The insertion
  // line is the only per-edge mark left, and it is drawn on the group's own
  // boundary.
  const groupKey = groupKeyOf(row)
  const dropState: DropState = props.dropGroupKey === groupKey ? props.dropGroupState ?? 'none' : 'none'
  const dropMode = props.dropGroupKey === groupKey ? props.dropGroupMode ?? null : null
  const insertEdge = props.dropGroupKey === groupKey ? props.insertEdge ?? null : null
  const groupStyle = groupDragStyle(dropState, dropMode, props.draggingGroupKey === groupKey)
  // The archive row reports one activity mark and a conversation count, never a
  // status rollup: done work behind the door must not keep nagging.
  const showStatus = !archive && showsStatusRollup(row.rollup)
  // Only a selectable, active topic drags: a Workspace row is not a payload, the
  // ungrouped bucket takes no part in a drag at all, the search result group
  // heading is a heading (its synthetic id must never become a drop target), and
  // an archived row may leave the archive only through its menu.
  const payload: DragPayload | null = row.kind === 'node'
    && row.selectable !== false
    && row.archived !== true
    && props.onRowPointerDown !== undefined
    ? { kind: 'node', nodeId: row.id, workspaceId: row.workspaceId ?? null }
    : null
  // The archive row's native tooltip answers two different questions: an empty
  // archive says how it fills up, a non-empty one says what the row is. Every
  // ordinary row stays native-title-free on purpose: its clipped title is
  // revealed by RowTitleTip, and the browser's own delayed bubble over the same
  // words would read as a second, redundant tip.
  const rowTitle = archive
    ? row.empty === true ? t('panel.archive.emptyHint') : t('panel.archive.rowTitle')
    : undefined
  return (
    <div
      className="cm-node-group"
      data-group-key={groupKey}
      data-group-kind={row.kind}
      data-group-column-key={columnKey}
      data-group-node-id={row.kind === 'node' ? row.id : undefined}
      data-group-workspace-id={row.workspaceId ?? ''}
      data-group-collapsed={row.collapsed ? 'true' : 'false'}
      data-group-archived={row.archived === true ? 'true' : undefined}
      data-dragging-group={props.draggingGroupKey === groupKey ? 'true' : 'false'}
      data-drop-group={dropState}
      data-drop-mode={dropMode ?? undefined}
      style={groupStyle}
    >
      <RowTitleTip text={row.title}>
        <div
          className="cm-node-row"
          data-kind={row.kind}
          data-node-id={row.kind === 'node' ? row.id : undefined}
          data-node-workspace-id={row.kind === 'node' ? row.workspaceId ?? '' : undefined}
          data-row-key={row.kind === 'workspace' || row.kind === 'ungrouped' || row.kind === 'archive'
            ? row.id
            : undefined}
          data-selected={row.selectable !== false && row.id === props.selectedNodeId}
          data-session-home={row.selectable !== false && row.id === props.homeRowKey ? 'true' : undefined}
          aria-description={row.selectable !== false && row.id === props.homeRowKey
            ? t('home.anchor.label')
            : undefined}
          data-note={row.note === undefined ? undefined : 'true'}
          data-search-active={props.activeRowKey !== undefined && row.id === props.activeRowKey ? 'true' : undefined}
          data-path-selected={row.selectable !== false
            && row.id !== props.selectedNodeId
            && props.ancestorKeys?.has(row.id) === true}
          data-session-path={row.selectable !== false
            && props.sessionPathKeys?.has(row.id) === true
            ? 'true'
            : undefined}
          data-collapsed={row.collapsed}
          data-menu={row.id === props.menuRowId}
          data-selectable={row.selectable !== false}
          role={row.selectable === false ? undefined : 'button'}
          tabIndex={row.selectable === false ? undefined : 0}
          title={rowTitle}
          onPointerDown={payload === null ? undefined : (event) => { props.onRowPointerDown?.(payload, event) }}
          onClick={row.selectable === false ? undefined : () => { props.onSelectNode(row.id) }}
          onKeyDown={row.selectable === false
            ? undefined
            : (event) => { if (event.key === 'Enter') props.onSelectNode(row.id) }}
        >
          <span className="cm-slot">
            {archive
              ? <ArchiveGlyph />
              : row.threads.length === 0
                ? <NodeGlyph />
                : (
                  <>
                    <span className="cm-folder"><NodeGlyph /></span>
                    <button
                      type="button"
                      className="cm-icon-btn cm-chevron"
                      data-open={!row.collapsed}
                      aria-expanded={!row.collapsed}
                      aria-label={row.collapsed ? t('columns.expandThreads') : t('columns.collapseThreads')}
                      onClick={(event) => { event.stopPropagation(); props.onToggleNode(row.id) }}
                    >
                      <FoldGlyph />
                    </button>
                  </>
                )}
          </span>
          <span className="cm-row-labels">
            <span className="cm-row-label">{row.title}</span>
            {row.note !== undefined && <span className="cm-row-note">{row.note}</span>}
          </span>
          {archive
            ? (
              <>
                {row.activity !== undefined && (row.activity.kind === 'running'
                  ? (
                    // The ring is aria-hidden, so its wrapper carries the wording.
                    <span
                      className="cm-row-activity"
                      title={row.activity.label}
                      role="img"
                      aria-label={row.activity.label}
                    >
                      <RunningRing />
                    </span>
                  )
                  : <StatusDot state="warning" label={row.activity.label} />)}
                {row.childCount > 0 && (
                  <span
                    className="cm-child-count"
                    title={row.countTitle ?? t('columns.childCount', { n: row.childCount })}
                  >
                    {row.childCount}
                  </span>
                )}
              </>
            )
            : (
              <>
                {row.childCount > 0 && !showStatus && (
                  <span className="cm-child-count" title={t('columns.childCount', { n: row.childCount })}>{row.childCount}</span>
                )}
                <StatusRollupBadge rollup={row.rollup} density={rollupDensity} />
              </>
            )}
          {row.tools && !archive && (row.start !== false || row.menu !== false) && (
            <span className="cm-row-actions">
              {row.start !== false && (
                <button
                  type="button"
                  className="cm-icon-btn"
                  title={row.kind === 'node'
                    ? t('columns.newThreadInNode')
                    : row.kind === 'ungrouped' ? t('columns.newThreadInUngrouped') : t('columns.newThreadInWorkspace')}
                  aria-label={t('common.startConversation')}
                  onClick={(event) => { event.stopPropagation(); props.onNewThread(row.id) }}
                >
                  <NewThreadGlyph />
                </button>
              )}
              {row.menu !== false && (
                <button
                  type="button"
                  className="cm-icon-btn"
                  title={t('common.more')}
                  aria-label={t('common.more')}
                  onClick={(event) => {
                    event.stopPropagation()
                    const rect = event.currentTarget.getBoundingClientRect()
                    props.onMenu({ kind: row.kind === 'node' ? 'node' : 'workspace', id: row.id, x: rect.left, y: rect.bottom })
                  }}
                >
                  <EllipsisGlyph />
                </button>
              )}
            </span>
          )}
        </div>
      </RowTitleTip>

      {!row.collapsed && row.threads.map(thread => {
        const threadSource = props.draggingKey === thread.sessionId
        return (
          <RowTitleTip key={thread.sessionId} text={thread.title}>
            <div
              className="cm-thread-row"
              data-session-id={thread.sessionId}
              data-parent-node-id={row.kind === 'node' ? row.id : undefined}
              // The parent Workspace is the topic's, not only the Workspace row's:
              // a conversation row is a drop target for its topic, and the hit test
              // needs the topic's Workspace to judge a cross-Workspace drop (F0:
              // this attribute used to be written for Workspace-level rows only,
              // which made the whole conversation area under a topic resolve to
              // `null`).
              data-parent-workspace-id={row.kind === 'node' || row.kind === 'workspace'
                ? row.workspaceId ?? ''
                : undefined}
              data-selected={thread.sessionId === props.openSessionId}
              data-note={thread.note === undefined ? undefined : 'true'}
              data-search-active={props.activeRowKey !== undefined && thread.sessionId === props.activeRowKey ? 'true' : undefined}
              data-menu={thread.sessionId === props.menuRowId}
              data-archived={thread.archived === true ? 'true' : undefined}
              data-dragging={threadSource ? 'true' : 'false'}
              style={dragSourceStyle(threadSource)}
              aria-current={thread.sessionId === props.openSessionId ? 'page' : undefined}
              role="button"
              tabIndex={0}
              onPointerDown={props.onRowPointerDown === undefined || thread.archived === true
                ? undefined
                : (event) => {
                  props.onRowPointerDown?.(
                    { kind: 'session', sessionId: thread.sessionId, workspaceId: thread.workspaceId ?? null },
                    event,
                  )
                }}
              onClick={() => { props.onOpenThread(thread.sessionId) }}
              onKeyDown={(event) => { if (event.key === 'Enter') props.onOpenThread(thread.sessionId) }}
            >
              <span className="cm-slot">
                {thread.status !== undefined && (thread.status.state === 'ongoing'
                  ? <RunningRing />
                  : <StatusDot state={thread.status.state} label={thread.status.label} />)}
              </span>
              <span className="cm-row-labels">
                <span className="cm-row-label">{thread.title}</span>
                {thread.note !== undefined && <span className="cm-row-note">{thread.note}</span>}
              </span>
              {thread.status !== undefined && thread.status.compact !== ''
                ? <span className="cm-compact">{thread.status.compact}</span>
                : thread.time !== '' && <span className="cm-time">{thread.time}</span>}
              {thread.menu !== false && (
                <span className="cm-row-actions">
                  <button
                    type="button"
                    className="cm-icon-btn"
                    title={t('common.more')}
                    aria-label={t('common.more')}
                    onClick={(event) => {
                      event.stopPropagation()
                      const rect = event.currentTarget.getBoundingClientRect()
                      props.onMenu({ kind: 'thread', id: thread.sessionId, x: rect.left, y: rect.bottom })
                    }}
                  >
                    <EllipsisGlyph />
                  </button>
                </span>
              )}
            </div>
          </RowTitleTip>
        )
      })}

      {!row.collapsed && row.threadFooter}
      {insertEdge !== null && (
        <span data-insert={insertEdge} style={insertionLineStyle(insertEdge)} aria-hidden="true" />
      )}
    </div>
  )
}

/**
 * Render one level.
 * @param props - the column, its width, and the callbacks its rows use.
 * @returns the column body.
 */
export function NodeColumnView(props: NodeColumnViewProps): ReactNode {
  const { column, width } = props
  const t = useT()
  const rollupDensity = width < ROLLUP_DOTS_WIDTH ? 'dots' : 'cluster'
  const context: RowGroupContext = { columnKey: column.key, t, rollupDensity, props }
  return (
    <div className="cm-node-col" data-col-key={column.key} style={{ width }}>
      <div className="cm-col-head">
        <span className="cm-col-title" title={column.title}>{column.title}</span>
        {column.headerActions !== undefined && <span className="cm-col-actions">{column.headerActions}</span>}
      </div>
      <div className="cm-col-scroll">
        {column.rows.map(row => <NodeGroup key={row.id} row={row} context={context} />)}
      </div>
      {column.footerRow !== undefined && (
        <div className="cm-col-footer">
          <NodeGroup row={column.footerRow} context={context} />
        </div>
      )}
    </div>
  )
}

/** Props of one resize handle. */
export interface GutterProps {
  /** The width the target had when the drag started. */
  width: number
  /** Called with the requested width while dragging. */
  onResize: (width: number) => void
  /** Set for a handle on the right edge, where dragging left grows the target. */
  inverted?: boolean
  /** Ceiling for this target; defaults to the shared column maximum. */
  max?: number
}

/**
 * A drag handle that resizes the column to its left.
 *
 * It draws nothing: the column's own border-right stays the only vertical on
 * screen and the col-resize cursor carries the affordance — the same contract
 * the shipped handles keep, where no handle paints a pill. The width is exposed
 * to assistive technology through the separator's aria value, not painted.
 * @param props - the target's current width and the width sink.
 * @returns the handle.
 */
export function Gutter({ width, onResize, inverted = false, max }: GutterProps): ReactNode {
  const origin = useRef({ x: 0, width })
  return (
    <div
      className="cm-gutter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      onPointerDown={(event) => {
        origin.current = { x: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const delta = event.clientX - origin.current.x
        onResize(clampColumnWidth(origin.current.width + (inverted ? -delta : delta), max))
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />
  )
}
