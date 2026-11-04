/**
 * The composer-side context line: where the open conversation lives.
 *
 * The map has two states that may drift apart — the row the reader selected
 * (the navigation cursor, which also decides where a new conversation lands)
 * and the conversation the shipped column is actually showing (the work
 * context: everything typed into the composer belongs to it). Selecting another
 * row is a legitimate way to browse, so the map does not follow the cursor; but
 * typing into the old conversation while the tree highlights another place is
 * exactly the mistake this line exists to prevent.
 *
 * It therefore answers two facts about the same row and nothing else: **which
 * chain does the conversation I am reading belong to, and which conversation is
 * it?** It sits in `conversation.input.dock`, immediately above the composer
 * card, and renders one 30px bar:
 *
 *     [当前会话]  商业项目 › task-map › 运营策略 › 运营策略周会
 *
 * The chain names the place (space › Workspace › topic); it ends with the open
 * conversation's own title, so the row is one complete address and the reader
 * can confirm the exact conversation the next keystroke belongs to — useful
 * when one topic holds several. The title is the catalog's live name (a rename
 * lands immediately) and falls back to the indexed row title; when the map
 * knows no title the bar degrades to the chain alone, exactly as it read
 * before this segment existed.
 *
 * The 「当前会话」 badge is the line's only mark. A speech-bubble glyph used to
 * lead it, but the bar only ever appears above a Session's composer and the
 * badge already says 「当前会话」 in words, so the icon only repeated the label.
 * It deliberately carries no verdict (no "not under the selected node"), no
 * actions (no "new conversation here" / "back to the home") and no dismissal.
 * The band's row-2 chip is gone: the tree's filled home folder already shows
 * where the conversation lives, and the line appears only when the reader is
 * about to type, so there is nothing to dismiss and nothing to decide.
 *
 * The verdict is the pure policy in `shared/session-home.ts`; this component is
 * only the presentation and the identity gates:
 *
 * - the slot must hand us a Session id, and it must be the Session the map
 *   itself remembers as open (a native navigation echo publishes its two view
 *   fields atomically, so the transitional frame never flashes the line);
 * - the composer must actually hold focus (the reader is about to type, not
 *   browsing the tree);
 * - the band must be expanded and geometrically on screen;
 * - a blank conversation or a subagent has nothing to say here;
 * - the line appears only while the selection has left the conversation's home;
 *   selecting the home row (or one of its containers) silences it.
 *
 * No DOM is touched: every value arrives through the slot, the injected
 * services, or the view bridge, so `react-dom/server` renders it directly.
 */
import type { ReactNode } from 'react'

import type { Translate } from '../shared/copy.js'
import type { BandCollapseStore } from '../shared/mode-memory.js'
import {
  threadOfSession,
  workspaceDisplayTitle,
  type MapState,
  type WorkspaceTitleLabels,
} from '../shared/model.js'
import {
  sessionHomeDivergence, type SessionHomeSelection,
} from '../shared/session-home.js'
import { emptyView } from '../shared/view-state.js'
import { displaySpaceTitle, workspaceTitleLabels } from './display.js'
import { useLocaleT, type LocaleService } from './locale.js'
import {
  useSnapshot,
  type CatalogRow,
  type MapServices,
  type ObservableSnapshot,
  type RootPanelProps,
  type WorkspaceViewLike,
} from './services.js'
import type { MapViewBridge, MapViewSnapshot } from './view-bridge.js'

/** Props the `conversation.input.dock` entry injects plus the slot's standards. */
export interface HomeNoticeProps {
  /** Injected service faces: the map document, the Workspace list, the catalog. */
  services: MapServices
  /**
   * The band's read-only view projection.
   *
   * Optional so a mount without the browser activation (or a render test that
   * only cares about the gates) stays inert instead of throwing; when absent the
   * line renders nothing.
   */
  bridge?: MapViewBridge | undefined
  /** Alias of {@link HomeNoticeProps.bridge} under the registration site's name. */
  viewBridge?: MapViewBridge | undefined
  /** The shared band-collapse switch; true means the tree is not on screen. */
  collapsed: BandCollapseStore
  /**
   * Whether the shipped composer currently holds focus.
   *
   * The line is about what the reader is about to type, so browsing the tree
   * (which moves focus to the clicked row) must stay silent: it appears only
   * when the caret is back in the composer and the selection still points away
   * from the open conversation. Absent in render tests (or a profile without the
   * tracker), where the other gates remain authoritative.
   */
  focus?: ObservableSnapshot<boolean> | undefined
  /** The DSH locale service, when this profile provides one. */
  locale?: LocaleService | undefined
  /** The Session this composer belongs to (standard slot prop). */
  sessionId?: string | undefined
  /** The application's catalog hook (standard slot prop). */
  useSessions?: RootPanelProps['useSessions'] | undefined
}

/** The inert reading a mount without a bridge subscribes to. */
const NO_BRIDGE_SNAPSHOT: MapViewSnapshot = { view: emptyView(), mapVisible: false }

/** Stable no-op bridge: the line is invisible while no band publishes. */
const NO_BRIDGE: MapViewBridge = {
  getSnapshot: () => NO_BRIDGE_SNAPSHOT,
  subscribe: () => () => {},
  publish: () => {},
}

/**
 * The reading used when no focus tracker is injected (render tests).
 *
 * Tests exercise the other gates (identity, blank, divergence, focus); the
 * tracker itself is covered by its own unit tests and by the live walkthrough,
 * and a mount without a tracker must not silently disable the line.
 */
const ALWAYS_FOCUSED: ObservableSnapshot<boolean> = {
  getSnapshot: () => true,
  subscribe: () => () => {},
}

/** One node's title from the map document. */
function nodeTitleOf(state: MapState, nodeId: string): string | undefined {
  return state.nodes.find(node => node.id === nodeId)?.title
}

/** One Workspace's display label, read off the Host-authoritative list. */
function workspaceLabelOf(
  workspaces: readonly WorkspaceViewLike[],
  workspaceId: string,
  labels: WorkspaceTitleLabels,
): string | undefined {
  const workspace = workspaces.find(candidate => candidate.workspaceId === workspaceId)
  return workspace === undefined ? undefined : workspaceDisplayTitle(workspace, labels)
}

/**
 * The conversation's home chain, from the space down to the home node.
 *
 * The same three levels the chip used to spell out, without any verdict or
 * selection wording: space › Workspace (or ungrouped bucket) › topic (only when
 * the conversation is filed under one).
 */
function homePath(
  t: Translate,
  state: MapState,
  home: SessionHomeSelection,
  workspaces: readonly WorkspaceViewLike[],
  labels: WorkspaceTitleLabels,
): readonly string[] {
  const space = state.spaces.find(candidate => candidate.id === home.spaceId)
  const spaceName = space === undefined ? '' : displaySpaceTitle(t, space, state)
  const workspaceName = home.workspaceId === null
    ? ''
    : workspaceLabelOf(workspaces, home.workspaceId, labels) ?? t('common.workspace')
  const nodeName = home.nodeId === null ? '' : nodeTitleOf(state, home.nodeId) ?? ''
  const parts = [spaceName, workspaceName, nodeName].filter(part => part !== '')
  return parts.length === 0 ? [t('home.ungrouped')] : parts
}

/**
 * The open conversation's own title: the line's last segment.
 *
 * The catalog is the live authority — a rename reaches it before the indexed
 * row does — and the map's thread row is the fallback for the frame before the
 * catalog arrives. An absent title ends the chain at the home row, exactly as
 * the line read before this segment existed, instead of rendering a blank hop.
 * @param state - the map document (fallback source).
 * @param sessionId - the conversation (already known to be open and indexed).
 * @param catalogRow - the catalog row read through the slot, when present.
 * @returns the title, or the empty string when nothing names the conversation.
 */
function conversationTitleOf(
  state: MapState,
  sessionId: string,
  catalogRow: CatalogRow | undefined,
): string {
  const live = catalogRow?.displayTitle ?? catalogRow?.title
  if (live !== undefined && live !== '') return live
  return threadOfSession(state, sessionId)?.title ?? ''
}

/**
 * Render the composer-side context line, or nothing while the map and the
 * conversation agree (or while the reader is browsing the tree).
 * @param props - injected services, the view bridge, the collapse switch, the
 *   focus tracker, the locale service, and the slot's standard Session/catalog
 *   props.
 * @returns the context line, or null.
 */
export function HomeNotice({
  services, bridge, viewBridge, collapsed, focus, locale, sessionId, useSessions,
}: HomeNoticeProps): ReactNode {
  const t = useLocaleT(locale)
  const hidden = useSnapshot(collapsed)
  const composerFocused = useSnapshot(focus ?? ALWAYS_FOCUSED)
  const snapshot = useSnapshot(bridge ?? viewBridge ?? NO_BRIDGE)
  const storeSnapshot = useSnapshot(services.store)
  const workspaceSnapshot = useSnapshot(services.workspaces.list)
  const catalogRow = (useSessions?.((state) => (
    sessionId === undefined ? undefined : state.byId[sessionId]
  )) ?? undefined) as CatalogRow | undefined

  const view = snapshot.view
  const state = storeSnapshot.doc

  // The tree is what the reader browses: while it is folded or geometrically
  // absent there is no "selected place" to disagree with.
  if (sessionId === undefined || hidden) return null
  // The line is about the next thing typed: while focus is on a tree row (a
  // click just moved it there), browsing stays silent. Putting the caret back
  // into the composer is the moment the context becomes useful.
  if (!composerFocused) return null
  if (!snapshot.mapVisible) return null
  // Identity gate: only the Session the map itself remembers as open. A native
  // navigation echo writes both view fields in one commit, so the frame between
  // the two publishes never satisfies this and the line cannot flash.
  if (view.openSessionId !== sessionId) return null
  // A brand-new conversation has no old content to confuse, and a subagent has
  // no row of its own in the map.
  if (catalogRow?.origin === 'subagent' || catalogRow?.blank === true) return null
  const verdict = sessionHomeDivergence({
    state,
    openSessionId: view.openSessionId,
    selectedNodeId: view.selectedNodeId,
    activeSpace: view.activeSpace,
    catalog: catalogRow,
  })
  if (!verdict.divergent || verdict.home === null) return null

  const labels = workspaceTitleLabels(t)
  const chain = homePath(t, state, verdict.home, workspaceSnapshot.items, labels)
  // The conversation itself closes the address. Without a title the chain is
  // the whole line, and its home end keeps the emphasis it always had.
  const conversationTitle = conversationTitleOf(state, sessionId, catalogRow)
  const parts = conversationTitle === '' ? chain : [...chain, conversationTitle]
  const pathText = parts.join(' › ')

  return (
    <div className="cm-home-path" role="status" title={pathText}>
      <span className="cm-home-path-label">{t('home.path.label')}</span>{' '}
      <span className="cm-home-path-segments">
        {chain.map((part, index) => (
          <span key={`${index}:${part}`} className="cm-home-path-part">
            {index > 0 && <span className="cm-home-path-sep" aria-hidden="true"> › </span>}
            <span
              className="cm-home-path-seg"
              data-last={conversationTitle === '' && index === chain.length - 1 ? 'true' : undefined}
            >
              {part}
            </span>
          </span>
        ))}
      </span>
      {/* The title renders outside the segment group on purpose: that group
          clips its tail, so a long chain must ellipsize instead of eating the
          conversation's name (the one hop the reader is about to type into). */}
      {conversationTitle !== '' && (
        <span className="cm-home-path-part cm-home-path-thread">
          <span className="cm-home-path-sep" aria-hidden="true"> › </span>
          <span className="cm-home-path-seg cm-home-path-thread-seg" data-last="true" data-conversation="true">
            {conversationTitle}
          </span>
        </span>
      )}
    </div>
  )
}

/** The name the slot registration site uses in the implementation map. */
export const SessionHomeNotice = HomeNotice
