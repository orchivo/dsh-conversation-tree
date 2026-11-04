/**
 * The hover bubble that reveals a row's clipped title.
 *
 * A node or conversation row holds its title on one ellipsized line, and the
 * row a reader points at narrows again: hovering surfaces the start and menu
 * actions in the trailing slot, which is exactly where the tail of the title
 * used to live. So the row under the pointer is often the one place its full
 * title cannot be read — the screenshot that asked for this feature was exactly
 * such a row. Resting the pointer on the row shows the product's own tooltip
 * bubble with the whole title; a title that still fits shows nothing.
 *
 * The bubble is appended under `<body>` rather than rendered in the React tree.
 * The column scroller clips its content and the band sets `container-type`,
 * which is a containing block for fixed descendants, so a bubble drawn inside
 * the strip would be cut at the column's edge or anchored to the band instead
 * of the window. Writing one plain span there also keeps hover out of the
 * panel's render path — the same reason the strip's scroll fade is written
 * straight to the DOM — and keeps the bubble out of the row's click target and
 * out of the drag hit test.
 */
import {
  cloneElement, useCallback, useEffect, useRef,
  type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode,
} from 'react'

/**
 * How long the pointer must rest on a row before its clipped title is revealed.
 *
 * Long enough that sweeping across the strip does not flash a bubble on every
 * row, short enough that pointing at a row and reading it is one gesture. The
 * shell waits 500ms for its own hover cards; the product's action tooltips are
 * instant because their label is already known to the reader.
 */
const TITLE_TIP_DELAY_MS = 400

/** Free space kept between the bubble and its row, and at the window edges. */
const TITLE_TIP_GAP_PX = 6
const TITLE_TIP_EDGE_PX = 12

/** One viewport rectangle a title tip is placed against. */
export interface TipAnchor {
  left: number
  top: number
  right: number
  bottom: number
}

/** The measured size of a title tip bubble, in viewport pixels. */
export interface TipSize {
  width: number
  height: number
}

/** Where a title tip lands, and the side of its row it opened on. */
export interface TipPlacement {
  left: number
  top: number
  side: 'top' | 'bottom'
}

/**
 * Place a title tip under its row, or above it when the window has no room
 * below; either way the bubble stays inside the window.
 *
 * The bubble's left edge follows the title rather than the row's folder slot, so
 * the full text starts where the clipped text started. When the bubble is wider
 * than the room left of the window edge it is pulled left to keep the gutter —
 * and a bubble wider than the window itself stays pinned at the gutter instead
 * of sliding off the left side.
 * @param anchor - the row's title line, in viewport pixels.
 * @param size - the bubble's measured size, in viewport pixels.
 * @param viewport - the window's inner size, in viewport pixels.
 * @returns the fixed-position coordinates and the chosen side.
 */
export function titleTipPlacement(anchor: TipAnchor, size: TipSize, viewport: TipSize): TipPlacement {
  const rightmost = Math.max(TITLE_TIP_EDGE_PX, viewport.width - TITLE_TIP_EDGE_PX - size.width)
  const left = Math.min(Math.max(anchor.left, TITLE_TIP_EDGE_PX), rightmost)
  const fitsBelow = anchor.bottom + TITLE_TIP_GAP_PX + size.height <= viewport.height - TITLE_TIP_EDGE_PX
  const fitsAbove = anchor.top - TITLE_TIP_GAP_PX - size.height >= TITLE_TIP_EDGE_PX
  const side: TipPlacement['side'] = fitsBelow || !fitsAbove ? 'bottom' : 'top'
  const wanted = side === 'bottom'
    ? anchor.bottom + TITLE_TIP_GAP_PX
    : anchor.top - TITLE_TIP_GAP_PX - size.height
  const top = Math.max(TITLE_TIP_EDGE_PX, Math.min(wanted, viewport.height - TITLE_TIP_EDGE_PX - size.height))
  return { left, top, side }
}

/** The handlers `RowTitleTip` adds to the row it wraps. */
interface RowTipAnchorProps {
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerOver?: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * Reveal the full title of a row whose one-line label is clipped.
 *
 * The truncation decision is measured while the row is hovered, i.e. with the
 * row's action buttons already surfaced, so a title that only narrows on hover
 * gets its bubble and a title that still fits gets none. Scroll, resize, Escape
 * and any press put the bubble away: the anchor's screen position is only valid
 * while it stays put, and a press is already changing what the row means.
 *
 * The bubble's text is the visible row's own title, so the tip never invents a
 * label: it is the same words the label would show if the lane were wide
 * enough.
 * @param props.text - the row's full title.
 * @param props.children - the row element; the tooltip chains its pointer handlers.
 * @returns the row, with the bubble appended to `<body>` only while open.
 */
export function RowTitleTip({ text, children }: { text: string; children: ReactElement }): ReactNode {
  const row = useRef<HTMLElement | null>(null)
  const bubble = useRef<HTMLSpanElement | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Listeners installed while the bubble is open, removed by {@link hide}. */
  const windowListeners = useRef<(() => void) | null>(null)
  /** Whether the pointer last rested on the row's own controls (its actions). */
  const overActions = useRef(false)

  /** Drop a pending reveal, so leaving the row before the delay ends shows nothing. */
  const cancel = useCallback((): void => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])

  /** Put away both the pending reveal and the open bubble. */
  const hide = useCallback((): void => {
    cancel()
    if (windowListeners.current !== null) {
      windowListeners.current()
      windowListeners.current = null
    }
    bubble.current?.remove()
    bubble.current = null
  }, [cancel])

  // A row unmounted while its timer or bubble is live must not leave either
  // behind: the bubble lives outside the React tree, so React cannot remove it.
  useEffect(() => hide, [hide])

  // A row retitled under the pointer no longer owns what the bubble says: put
  // it away, and let the next pointer rest reveal the new title.
  useEffect(() => { hide() }, [text, hide])

  /** Measure the hovered row and show its bubble only while the title really clips. */
  const show = useCallback((): void => {
    const element = row.current
    if (element === null || !element.isConnected) return
    // The row's own controls answer with their own action tips; while the
    // pointer rests on one, the row's title tip belongs to neither.
    if (element.querySelector('.cm-row-actions:hover') !== null) return
    const label = element.querySelector('.cm-row-label')
    if (!(label instanceof HTMLElement)) return
    // The label clips its own text, so `scrollWidth` is the full title width and
    // `clientWidth` the lane it may occupy: only the wider one needs a bubble.
    // The +1 absorbs the sub-pixel rounding of a title that exactly fills it.
    if (label.scrollWidth <= label.clientWidth + 1) return
    hide()
    const rowRect = element.getBoundingClientRect()
    const labelRect = label.getBoundingClientRect()
    // Born hidden by the sheet (see `.cm-tip`), measured, placed, then shown —
    // all before the next paint, so the bubble never appears at the origin.
    const node = document.createElement('span')
    node.className = 'cm-tip'
    node.setAttribute('role', 'tooltip')
    node.textContent = text
    document.body.append(node)
    bubble.current = node
    const box = node.getBoundingClientRect()
    const at = titleTipPlacement(
      { left: labelRect.left, right: labelRect.right, top: rowRect.top, bottom: rowRect.bottom },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    node.style.left = `${Math.round(at.left)}px`
    node.style.top = `${Math.round(at.top)}px`
    node.dataset.side = at.side
    node.style.visibility = 'visible'
    // The anchor's viewport rectangle is only valid while the window and the
    // column scroller stay still — so any scroll (capture: the scroller does not
    // bubble), resize, press or Escape closes the bubble instead of leaving it
    // floating over unrelated content.
    const putAway = (): void => { hide() }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    window.addEventListener('scroll', putAway, true)
    window.addEventListener('resize', putAway)
    window.addEventListener('pointerdown', putAway, true)
    window.addEventListener('keydown', onKeyDown)
    windowListeners.current = () => {
      window.removeEventListener('scroll', putAway, true)
      window.removeEventListener('resize', putAway)
      window.removeEventListener('pointerdown', putAway, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [hide, text])

  /** Arm one reveal after the pointer has rested long enough. */
  const arm = useCallback((): void => {
    cancel()
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, TITLE_TIP_DELAY_MS)
  }, [cancel, show])

  const anchorProps: RowTipAnchorProps = {
    onPointerEnter: (event) => {
      // Touch has no hover: a tap opens the row rather than revealing it.
      if (event.pointerType === 'touch') return
      row.current = event.currentTarget
      arm()
    },
    onPointerLeave: () => {
      row.current = null
      overActions.current = false
      hide()
    },
    onPointerOver: (event) => {
      const onActions = event.target instanceof Element
        && event.target.closest('.cm-row-actions') !== null
      if (onActions) {
        // The row's own controls answer with their own action tips; stepping
        // onto one withdraws the title tip instead of stacking two bubbles.
        overActions.current = true
        hide()
        return
      }
      // Stepping back off the controls onto the row body re-arms the reveal:
      // the title is readable there again, and the reader should not have to
      // leave and re-enter the row to ask for it.
      if (!overActions.current) return
      overActions.current = false
      if (row.current !== null) arm()
    },
  }

  return cloneElement(children, anchorProps)
}
