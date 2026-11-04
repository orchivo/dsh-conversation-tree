/**
 * Stylesheet invariants the band's interaction with the shell depends on.
 *
 * The plugin's sheet is a template string in `src/client/styles.ts`; the only
 * place it becomes a shipped artifact is the browser bundle, so these tests
 * assert against `lib/client.js` exactly as the client receives it. Most are
 * deliberately about *contracts with the shell* — the z-index the band's host
 * layer publishes, and the scope a rule is allowed to leak into. One is about a
 * contract with the reader instead: every dialog has to wear the product's scrim
 * and its prominent elevation, so a dialog can no longer be a white card on a
 * white page. That test still names no colour: it pins that the plugin asks the
 * design system for its mask and its lift rather than inventing a private one.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Escape a literal selector for use inside a RegExp. */
function escape(selector) {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The declarations of one rule, by its exact selector, or null when absent. */
function declarations(selector) {
  const match = new RegExp(`${escape(selector)}\\{([^}]*)\\}`).exec(bundle)
  return match === null ? null : match[1]
}

/** Every declaration block carrying this exact selector, in sheet order. */
function allDeclarations(selector) {
  return [...bundle.matchAll(new RegExp(`${escape(selector)}\\{([^}]*)\\}`, 'g'))].map(match => match[1])
}

/**
 * The shell stacks the macOS window-chrome seat at z-index 15 and the frame
 * overlay layer — the band's host — at 20 (`AppFrame.module.css`). A seat
 * *below* that layer cannot show its own design-system tooltip: the bubble's
 * `z-index:100` is trapped inside the seat's stacking context, so the band's
 * pills paint over it and the reader sees a black box cut in slices.
 */
test('the window-chrome seat is lifted above the frame overlay layer in map mode', () => {
  const rule = declarations('html[data-conversation-map-split] [data-shell-leading]')
  assert.notEqual(rule, null, 'the seat rule is missing from the shipped sheet')
  const lifted = Number.parseInt(/z-index:\s*(-?\d+)/.exec(rule)?.[1] ?? '', 10)
  assert.ok(Number.isInteger(lifted), `the seat rule must state a z-index: ${rule}`)
  assert.ok(lifted > 20, `the seat must outrank the overlay layer (20): ${String(lifted)}`)
  /* The lift is one step, and its price is explicit: every child of the overlay
     layer loses to the seat whatever its own z-index says. Portaled surfaces
     (the design-system Modal, 1000) must stay on top — the seat is window
     chrome, not a modal. */
  assert.ok(lifted < 1000, `the seat must stay under the portaled layer (1000): ${String(lifted)}`)
})

/** A rule about the shell's chrome must not apply outside the mode that needs it. */
test('the seat rule is scoped to map mode', () => {
  const unscoped = new RegExp(`(^|[^\\w\\]\\s])${escape('[data-shell-leading]')}\\{`, 'm').test(bundle)
  assert.equal(unscoped, false, 'a bare [data-shell-leading] rule would apply in every mode')
})

/**
 * A bubble that is whole but lies across the band's own chips still reads as
 * "the tip covers my buttons". While the shell's chrome tooltip exists, the
 * row steps aside: `:has()` sees the [role="tooltip"] the design system renders
 * inside the seat, so no shell DOM is touched and no script runs. Engines
 * without :has() keep the row — the lift above already keeps the bubble whole,
 * so the adaptation degrades instead of breaking.
 */
test('the band steps aside while the shell shows its window-chrome tooltip', () => {
  const selector = 'html[data-conversation-map-split]:has([data-shell-leading] [role="tooltip"]) .cm-band-head-row > *'
  const rule = declarations(selector)
  assert.notEqual(rule, null, 'the step-aside rule is missing from the shipped sheet')
  assert.match(rule, /opacity:\s*0/, `the chips must step aside: ${rule}`)
  assert.match(rule, /pointer-events:\s*none/, `an invisible chip must not swallow clicks: ${rule}`)
})

/**
 * The shell's clearance is measured from the frame's left edge, but the strip
 * above pushes the Conversation past the band — so the title row's fixed inset
 * (`max(0px, calc(clearance - 20px))`, ui-conversation) becomes dead space the
 * moment the band covers the chrome it dodges. Map mode therefore re-reads the
 * shell's number on the Conversation, folded by the width already reserved, and
 * the fold has to land on the very element that carries the strip.
 */
test('the conversation folds the shell clearance by the reserved width', () => {
  const anchor = 'html[data-conversation-map-split] [data-slot="main.conversation"]'
  const read = declarations(anchor)
  assert.notEqual(read, null, 'the clearance readout rule is missing from the shipped sheet')
  assert.match(
    read,
    /--cm-chrome-reserve:\s*var\(--dsh-frame-leading-clearance\s*,/,
    `the readout must capture the shell's own variable before it is overridden: ${read}`,
  )

  const fold = allDeclarations(`${anchor} > div`)
  assert.ok(fold.length >= 2, `the strip and the fold share one selector: ${JSON.stringify(fold)}`)
  assert.ok(
    fold.some(block => /padding-left:\s*var\(--cm-map-width/.test(block)),
    `the strip rule is missing: ${JSON.stringify(fold)}`,
  )
  const folded = fold.find(block => /--dsh-frame-leading-clearance/.test(block))
  assert.notEqual(folded, undefined, `no fold shares the strip's selector: ${JSON.stringify(fold)}`)
  assert.match(
    folded,
    /--dsh-frame-leading-clearance:\s*max\(0px,\s*calc\(var\(--cm-chrome-reserve[^)]*\)\s*-\s*var\(--cm-map-width/,
    `the fold must subtract the reserved width and never go below zero: ${folded}`,
  )
})

/** Both halves are map-mode-only: any other scope would move the product's title. */
test('the clearance fold is scoped to map mode', () => {
  const bare = /(^|[^\w\]\s])\[data-slot="main\.conversation"\][^{]*\{[^}]*--dsh-frame-leading-clearance/m.test(bundle)
  assert.equal(bare, false, 'a rule without the map-mode gate would move the title outside map mode')
})

/**
 * The space switcher leads the band's second row, on the node list's own rail.
 *
 * Pinned here because the earlier layout hid it across the whole narrow band
 * (`@container (max-width:480px)`), and because what keeps it from reading as a
 * tab glued to the column head below is arithmetic between rules that live far
 * apart in the sheet: the row's inset, the pill's inset and the first column's
 * indent all add up to the same 14px rail, and the row's 28px minus the pill's
 * 24px is the 4px of air above the seam.
 */
test('the space switcher leads the band second row, on the node list rail', () => {
  assert.equal(
    /\.cm-band-space\{display:none\}/.test(bundle),
    false,
    'nothing may hide the space switcher: the band stays visible down to MIN_MAP_WIDTH (320px), so no width is safe to take from it',
  )
  assert.equal(
    /max-width:\s*480px/.test(bundle),
    false,
    'the 480px container query that hid the switcher is gone',
  )

  const row2 = declarations('.cm-band-row2')
  assert.notEqual(row2, null, 'the second row is named for what it is, not for the search box it once held')
  assert.match(row2, /align-items:flex-start/, `28px row, 24px contents, top-aligned: the 4px above the seam is what stops the tab reading: ${row2}`)
  assert.match(
    row2,
    /padding-left:calc\(var\(--cm-band-rail,14px\) - 8px \+ var\(--cm-band-window-gutter,0px\)\)/,
    `no window-chrome clearance on this row; the window-edge gutter rides on the same rail as the first column: ${row2}`,
  )
  assert.match(row2, /overflow:clip/, `clip rather than hidden: a scroll container slides its content when a child takes focus: ${row2}`)
  assert.match(
    declarations('.cm-band-row2>.cm-band-search'),
    /height:24px;box-sizing:border-box/,
    'the search field shares the row 24px, border-box so its 1px underline does not eat one of the four pixels of air',
  )

  const pill = declarations('.cm-band-row2 .cm-space-btn')
  assert.notEqual(pill, null, 'the pill takes the second row rhythm')
  assert.match(pill, /height:24px/)
  assert.match(pill, /min-width:58px/, `the row-2 pill rule keeps its historical floor; the breadcrumb bar overrides it with min-width:0 and is pinned by its own test: ${pill}`)
  assert.match(pill, /padding:0 calc\(var\(--cm-band-rail,14px\) - 7px\)/)
  assert.match(pill, /background:transparent/, `the pill rests as a ghost, not as a solid block on the head: ${pill}`)
  assert.match(
    bundle,
    /\.cm-band-row2 \.cm-space-btn:hover,\s*\.cm-band-row2 \.cm-space-btn\[aria-expanded="true"\]\{background:var\(--dsw-alias-interactive-bg-hover[^}]*border-color:var\(--dsw-alias-border-l1/,
    'the fill comes back on hover and while the space menu is open — and it is the interactive state colour, not the opaque resting surface token that made the hover invisible on a white header',
  )

  // rail = row inset 6 + 1px border + pill padding 7 = col-scroll 6 + node-row 8
  assert.ok(
    allDeclarations('.cm-band').some(block => block.includes('--cm-band-rail:14px')),
    'the rail is one named number, not three coincidences',
  )
  assert.match(declarations('.cm-col-scroll'), /padding:0 6px/)
  assert.match(declarations('.cm-node-row'), /padding:0 8px/)
})

/**
 * The window-edge gutter: the first column pays the sidebar's window padding.
 *
 * Map mode collapses the shell's left column, so on the desktop the band's left
 * edge becomes the frame's left edge — the seat the sidebar used to occupy.
 * The band's own in-column inset is 6px (a seam-relative pill inset), while the
 * shipped sidebar spends 12px of window padding (`--dsh-sidebar-inline-padding`)
 * before the same 8px row inset. The 6px the first column pays while flush
 * completes that 12px, which is why the numbers below are `+ var(...)` over the
 * base rules and not a second, private rhythm.
 *
 * Pinned because the whole fix is arithmetic spread over four rules that live
 * far apart, and because the failure mode is silent: a rule that forgot the
 * `:first-child` scope would indent every column, one that forgot the variable
 * default would move the layout outside the collapsed state, and a margin
 * instead of padding would inset the band's fill and start narrowing columns.
 */
test('the first column pays the sidebar window padding only at the frame edge', () => {
  // One named number, defaulting to "not at the edge": every other state keeps
  // the shipped geometry and the variable is the only switch.
  assert.ok(
    allDeclarations('.cm-band').some(block => block.includes('--cm-band-window-gutter:0px')),
    'the gutter is a named variable with a 0 default, not a 6px baked into four rules',
  )

  // The three surfaces that carry the column's left edge: header, list, footer.
  const head = declarations('.cm-band .cm-node-col:first-child .cm-col-head')
  assert.match(
    head,
    /padding-left:calc\(8px \+ var\(--cm-band-window-gutter,0px\)\)/,
    `the first column's header title moves with the list below it: ${head}`,
  )
  const scroll = declarations('.cm-band .cm-node-col:first-child .cm-col-scroll')
  assert.match(
    scroll,
    /padding-left:calc\(6px \+ var\(--cm-band-window-gutter,0px\)\)/,
    `the list keeps its 6px pill inset and adds the window padding: ${scroll}`,
  )
  const footer = declarations('.cm-band .cm-node-col:first-child .cm-col-footer')
  assert.match(
    footer,
    /padding-left:calc\(6px \+ var\(--cm-band-window-gutter,0px\)\)/,
    `the pinned archive row stays on the same rail: ${footer}`,
  )

  // Only the first column: its left edge is the window; every later column's is
  // a seam, and its base rules must keep the 6px in-column rail. The base
  // selectors are read through allDeclarations because the gutter rule's own
  // selector ends in the same class name.
  assert.equal(declarations('.cm-node-col .cm-col-scroll'), null, 'a gutter rule without :first-child would indent every column')
  assert.ok(allDeclarations('.cm-col-head').some(block => block.includes('padding:0 8px')))
  assert.ok(allDeclarations('.cm-col-scroll').some(block => block.includes('padding:0 6px 12px')))
  assert.ok(allDeclarations('.cm-col-footer').some(block => block.includes('padding:0 6px 8px')))

  // Padding, not a margin and not a width: the column's outer width stays the
  // reader's number and the fill still reaches the frame edge.
  assert.match(declarations('.cm-node-col'), /flex:0 0 auto/, 'the column keeps its fixed outer width')
  assert.equal(/\.cm-node-col:first-child\{[^}]*margin-left/.test(bundle), false, 'a margin would inset the fill; the gutter is padding inside the first column')

  // The second row moves by the same variable, keeping the switcher on the rail.
  assert.match(
    declarations('.cm-band-row2'),
    /var\(--cm-band-window-gutter,0px\)/,
    'the row above the list must step aside with it, or the switcher drifts off the rail',
  )
})

/**
 * A scrolled-away column start is a scroll cut, not a list edge.
 *
 * The window-edge gutter above is the *resting* blank: it belongs to the first
 * column's content and scrolls out of view with that column, so the moment the
 * strip is displaced the window edge cuts whatever column happens to be there.
 * The shell's own overflow language for a cut horizontal strip is a masked fade,
 * not a private padding (ui-dockkit fades its chip strip 24px per hidden side;
 * ui-workspace fades clipped row titles 12px). Three things can silently
 * regress, so all three are pinned: the reading (`data-scrolled`, written by the
 * panel), the fade's width and side (24px, start only), and the fill behind it —
 * a mask also fades the masked element's own background, so the gray has to be
 * painted by the frame, still ending at the seam's half-hairline reservation.
 */
test('a scrolled-away column start fades instead of gaining a private padding', () => {
  // The fill moved to the strip's frame, and only the seam reservation moved
  // with it: the strip itself must keep neither a margin nor a background, or
  // the mask would open onto the Conversation's white at the window edge.
  const area = declarations('.cm-node-area')
  assert.notEqual(area, null, 'the strip rule is missing')
  assert.equal(/margin-right/.test(area), false, `the seam reservation belongs to the frame; a margin here would leave the fade unpainted: ${area}`)
  assert.equal(/background:/.test(area), false, `the fill belongs to the frame; a masked background would reveal the Conversation: ${area}`)

  const frame = declarations('.cm-band-main')
  assert.notEqual(frame, null, 'the strip frame rule is missing')
  assert.match(
    frame,
    /margin-right:calc\(var\(--cm-band-gutter-width,8px\) \/ 2 \+ \.5px\)/,
    `the frame keeps the seam's half-handle-plus-half-hairline reservation: ${frame}`,
  )
  assert.match(
    frame,
    /background:var\(--dsw-specific-sidebar-fill,color-mix\(in srgb,currentColor 3%,transparent\)\)/,
    `the frame paints the band's gray, so the fade ends on fill rather than on white: ${frame}`,
  )

  // One reading, one side, and the shell's horizontal-strip width — not the
  // 12px the shell uses for a clipped text run.
  const fade = declarations('.cm-node-area[data-scrolled="true"]')
  assert.match(
    fade,
    /mask-image:linear-gradient\(to right,transparent 0,#000 24px\)/,
    `the start side fades over 24px while columns are out of view: ${fade}`,
  )
  assert.equal(
    /mask-image:linear-gradient\(to left/.test(bundle),
    false,
    'the end side is not faded: its cut lands on the band\'s seam, where the hairline already states the boundary',
  )

  // A drag's edges are aiming surfaces: the fade must not soften the insertion
  // line or the auto-scroll bands while a row is in flight.
  const drag = declarations('.cm-node-area[data-scrolled="true"][data-drag="true"]')
  assert.match(drag, /mask-image:none/, `the fade yields to a drag: ${drag}`)

  // The fade is the strip's alone: a mask elsewhere would fade content it was
  // never measured for. Selectors are single-line in this sheet, and comments
  // are multi-line, so the selector capture cannot swallow a comment above.
  const masked = [...bundle.matchAll(/([^\n{}]+)\{([^}]*mask-image:[^}]*)\}/g)].map(match => match[1])
  assert.deepEqual(
    masked,
    ['.cm-node-area[data-scrolled="true"]', '.cm-node-area[data-scrolled="true"][data-drag="true"]'],
    `the strip is the only masked surface in the sheet: ${masked.join(' | ')}`,
  )
})

/**
 * The band owns the shell's second seat button by hiding it — and only it.
 *
 * The band draws its own 「新建会话」 in the slot the shell vacates, so the rule
 * must match the *second* button inside the shell's seat and only while the
 * band occupies that edge. The selector is structural, so the rule keeps working
 * if the button's name or language changes; the first button (「打开侧边栏」) is
 * never in the selector, which is the decision that the shell always draws it.
 * It is also deliberately sibling-agnostic: the design system clones a bubble
 * `<span role="tooltip">` in *between* the two buttons while either seat tooltip
 * is open, so the adjacent-sibling form (`button + button`) stopped matching for
 * exactly that frame and the shell's 新建会话 flashed back (seat 28 → 64).
 * `:not(:first-of-type)` survives the interleaved bubble and still matches
 * nothing when a one-button seat leaves no second button to hide. Map mode is
 * the gate rather than a nicety: every state that gives the band's edge back
 * removes `data-conversation-map-split` (band yields, band not visible, mode
 * off), and the shell's button returns with it. If the shell ever changes that
 * markup the rule stops matching, and the band's own button stays unrendered
 * because it waits on the measured seat width (MapPanel.tsx) — today's layout,
 * never two new-session buttons.
 */
test('the band hides exactly the shell second seat button, only in map mode', () => {
  const selector = 'html[data-conversation-map-split] [data-shell-leading] button:not(:first-of-type)'
  const rule = declarations(selector)
  assert.notEqual(rule, null, 'the hide rule is missing from the shipped sheet')
  assert.match(rule, /display:\s*none/, `the shell's 新建会话 must be hidden: ${rule}`)
  const bare = /(^|[^\w\]\s])\[data-shell-leading\] button:not\(:first-of-type\)\{/m.test(bundle)
  assert.equal(bare, false, 'outside map mode the shell keeps both of its seat buttons')
  const generic = /(^|[^\w\]\s])button\s*\+\s*button\{/m.test(bundle)
  assert.equal(generic, false, 'no bare sibling selector may hide a button anywhere else on the page')
  assert.equal(
    /\[data-shell-leading\] button\s*\+\s*button\{/.test(bundle),
    false,
    'the adjacent-sibling form drops out while a seat tooltip sits between the buttons: use :not(:first-of-type)',
  )
})

/**
 * The shell's collapsed left column must not raise tooltips in map mode.
 *
 * On macOS the shell keeps the whole sidebar subtree mounted inside a zero-width
 * `overflow:hidden` track, so the sidebar's own 「打开侧边栏」 toggle stays in the
 * DOM at a fully clipped rect and remains the document's first tab stop. A
 * keyboard focus on it makes the design system render its tooltip from that
 * clipped rect; being `position:fixed`, the bubble escapes the clip and paints
 * over the window's top-left corner — the "打开侧边栏 ⌘B" bubble that appears
 * from nowhere. The seat already draws the same controls in this state, so the
 * clipped column is taken out of the tab order for as long as map mode keeps it
 * fully hidden. `visibility` (not `display`) keeps the geometry the shell
 * measures; the descendant `*` is required because sibling plugins re-state
 * `visibility:visible` on their own rows. Every selector must stay behind the
 * darwin + map-mode + collapsed gates: Windows desktop also collapses to zero
 * width, but keeps its reopen controls visible as fixed caption-row buttons
 * inside the same sidebar slot (hiding them would remove the only visible way
 * back), Web keeps a 56px interactive rail, and outside map mode a manual
 * collapse is the shell's own behaviour.
 */
test('the collapsed shell sidebar is silenced in map mode only', () => {
  const silence = 'html[data-platform="darwin"][data-conversation-map-split] [data-sidebar-collapsed] [data-slot="sidebar"] *'
  const rule = declarations(silence)
  assert.notEqual(rule, null, 'the keyboard-quiet rule is missing from the shipped sheet')
  assert.match(rule, /visibility:\s*hidden/, `the clipped sidebar must leave the tab order: ${rule}`)
  /* The same selector must not exist in any ungated form: strip the gated one and
     no `[data-slot="sidebar"] … visibility:hidden` may remain (a rule without the
     darwin + map-mode + collapsed gates would hide a real, interactive rail). */
  const rest = bundle.split(silence).join('')
  assert.equal(
    /\[data-slot="sidebar"\][^{}]*\{[^}]*visibility:\s*hidden/m.test(rest),
    false,
    'the sidebar may only be silenced behind the darwin + map-mode + collapsed gates',
  )
  const tip = declarations('html[data-platform="darwin"][data-conversation-map-split] [data-sidebar-collapsed] [data-slot="sidebar"] [role="tooltip"]')
  assert.notEqual(tip, null, 'a bubble already up carries inline visibility:visible and must be dropped outright')
  assert.match(tip, /display:\s*none/, `the stray-bubble belt is missing: ${tip}`)
  assert.equal(
    /\[data-sidebar-collapsed\] \[role="tooltip"\]\{[^}]*display:\s*none/m.test(
      bundle.replace('html[data-platform="darwin"][data-conversation-map-split] [data-sidebar-collapsed] [data-slot="sidebar"] [role="tooltip"]', ''),
    ),
    false,
    'the stray-bubble belt must keep the darwin + map-mode gates too',
  )
})

/**
 * The band's two chrome controls take the shell seat's own box geometry.
 *
 * Both boxes sit in the row the shell's seat buttons lead (28×28, radius-sm, no
 * frame, secondary ink), so the band's controls read as the same family instead
 * of as two plugin pills: the icon-only collapse box (`ViewToggle` `compact`)
 * and its own 新建会话. The Conversation header keeps the labelled pill
 * (`.cm-view-toggle` with `min-width:70px`) — that is the deliberate difference
 * between the two occurrences, not an oversight. Hover has to fill in both
 * icon-only boxes: with the visible copy gone, the fill is the only feedback
 * that the glyph is a button.
 */
test('the band draws its two seat controls as 28x28 icon boxes', () => {
  const conversationBox = declarations('.cm-view-toggle')
  assert.notEqual(conversationBox, null, 'the shared control is missing from the shipped sheet')
  assert.match(conversationBox, /min-width:70px/, `the Conversation header keeps its labelled pill: ${conversationBox}`)

  const collapseBox = declarations('.cm-view-toggle--icon')
  assert.notEqual(collapseBox, null, 'the band occurrence needs its own box rule')
  assert.match(collapseBox, /(^|;)min-width:0;/, `the pill floor is dropped for the icon box: ${collapseBox}`)
  assert.match(collapseBox, /width:28px;height:28px/, `the band box is the seat's 28x28: ${collapseBox}`)
  assert.match(collapseBox, /(^|;)border:0;/, `the band box drops the pill frame: ${collapseBox}`)
  assert.match(collapseBox, /border-radius:var\(--dsw-radius-sm/, `radius-sm, the shell seat's radius: ${collapseBox}`)

  const newSessionBox = declarations('.cm-lead-icon')
  assert.notEqual(newSessionBox, null, 'the band 新建会话 needs its own box rule')
  assert.match(newSessionBox, /width:28px;height:28px/, `the band 新建会话 is the seat's 28x28: ${newSessionBox}`)
  assert.match(newSessionBox, /(^|;)border:0;/, `it is a bare icon box, not a pill: ${newSessionBox}`)
  assert.match(newSessionBox, /border-radius:var\(--dsw-radius-sm/, `radius-sm, the shell seat's radius: ${newSessionBox}`)

  for (const hover of ['.cm-lead-icon:hover', '.cm-view-toggle--icon:hover']) {
    const rule = declarations(hover)
    assert.notEqual(rule, null, `an icon-only box needs a hover fill: ${hover}`)
    assert.match(
      rule,
      /background:var\(--dsw-alias-interactive-bg-hover/,
      `with no label left, the hover fill is the only feedback that this is a button: ${rule}`,
    )
  }
})

/**
 * The drop target is a group, and hysteresis has to look provisional.
 *
 * A group is the header row plus every conversation it owns, so the mark and
 * the boundary line belong to the wrapper, not to a row. While the pointer is
 * off every group the candidate is kept (`data-drop-group="held"`) and its line
 * fades, because the line is exactly what the held state has *not* decided.
 * Hover and row tools also go quiet under the gesture: a second hover fill below
 * the group card would read as a second target.
 */
test('the group sheet owns the drop mark, the insertion line and hover silence', () => {
  assert.notEqual(
    declarations('.cm-node-group'),
    null,
    'the shipped sheet needs the group wrapper rule (position + radius)',
  )
  assert.match(bundle, /\.cm-node-group\{position:relative;border-radius:12px\}/, 'the wrapper is the positioned card')

  const line = declarations('.cm-node-group>[data-insert]')
  assert.notEqual(line, null, 'the group-boundary line needs its own stacking rule')
  assert.match(line, /z-index:4/, `the line stays above the rows it crosses: ${line}`)

  const held = declarations('.cm-node-group[data-drop-group="held"]>[data-insert]')
  assert.notEqual(held, null, 'a held group fades the line it was promising')
  assert.match(held, /opacity:\.55/, `the held state has not decided where the line goes: ${held}`)

  assert.match(
    bundle,
    /\.cm-node-area\[data-drag="true"\] \.cm-node-row:hover:not\(\[data-selected="true"\]\)[^{]*\{[^}]*background:transparent/,
    'row hover must not paint a competing fill under the group mark',
  )
  assert.match(
    bundle,
    /\.cm-node-area\[data-drag="true"\] \.cm-row-actions\{[^}]*display:none/,
    'row tools step aside while a drag is in flight',
  )
  assert.match(
    bundle,
    /\.cm-node-group\[data-drop-group="invalid"\][^{]*\{[^}]*cursor:no-drop/,
    'a refused group says no through the cursor',
  )

  assert.equal(bundle.includes('.cm-thread-row[data-drop='), false, 'the retired row-level drop rules are gone')
  assert.equal(bundle.includes('.cm-node-row[data-drop='), false, 'and no row inherits a stray target mark')
  assert.equal(
    /(^|[^\w\]-])\[data-drop-group\]\{/m.test(bundle),
    false,
    'a bare [data-drop-group] rule would mark groups the plugin does not own',
  )
})

/**
 * Every dialog wears the product scrim and the prominent elevation.
 *
 * The audit measured the shipped card as a white sheet on a white page: no
 * shadow ring, a 1.09:1 border, and a fully transparent capture layer behind it —
 * the plugin had its own idea of a raised surface instead of the shell's. The
 * shell's Modal recipe is now the only one: the product's own mask step behind
 * the card, `--dsw-elevation-prominent` (whose 0.5px stroke ring is why the card
 * carries `border:0`), and the layer-2 fill the shell's modal sits on. The scrim
 * hangs off a modifier, because the capture layer is shared with the three
 * menus: a popover is not a modal state, so their layer must stay invisible.
 *
 * The cap and the scroll belong to the card, not to the dialog around it. A
 * scroll container clips the ink of its descendants at its own edge — stroke
 * ring and glow included — and the card fills the dialog exactly, so a scrolling
 * dialog would erase the elevation it was just given. No box is clipped by its
 * own overflow, so the card can be the scroller and keep its shadow.
 */
test('every dialog wears the product scrim and the prominent elevation', () => {
  const scrim = declarations('.cm-backdrop--dialog')
  assert.notEqual(scrim, null, 'the dialog needs its own scrim rule: the shared capture layer stays blank')
  assert.match(
    scrim,
    /background:var\(--dsw-alias-bg-mask-1/,
    `the mask is the product's own step, not a mix of the plugin's ink: ${scrim}`,
  )

  const capture = declarations('.cm-backdrop')
  assert.notEqual(capture, null, 'the capture layer is missing from the shipped sheet')
  assert.equal(
    /background/.test(capture),
    false,
    `a menu's capture layer is a hit target, not a modal state: it must paint nothing: ${capture}`,
  )

  const card = declarations('.cm-card')
  assert.notEqual(card, null, 'the shared card is missing from the shipped sheet')
  assert.match(card, /box-shadow:var\(--dsw-elevation-prominent/, `the lift is the product's: ${card}`)
  assert.match(card, /border:0/, `the stroke lives inside that elevation; a border would double it: ${card}`)
  assert.match(card, /border-radius:var\(--dsw-radius-md/, `the corner is the shell's panel radius: ${card}`)
  assert.match(card, /max-height:min\(86vh,640px\)/, `a long form is capped: ${card}`)
  assert.match(card, /overflow:auto/, `and scrolls inside the card, not off the window: ${card}`)

  const title = declarations('.cm-card h3')
  assert.notEqual(title, null, 'the dialog title is missing from the shipped sheet')
  assert.match(title, /font-size:15px/, `the title leads the form: ${title}`)
  assert.match(title, /font-weight:650/, `and outranks body copy: ${title}`)

  // `.cm-dialog` is named by an earlier combined rule too (the pointer-events
  // opt-in), so its geometry has to be looked for across every block that uses it.
  const dialogs = allDeclarations('.cm-dialog')
  assert.ok(
    dialogs.some(block => /width:min\(420px,88vw\)/.test(block)),
    `the plain dialog keeps its width: ${JSON.stringify(dialogs)}`,
  )
  assert.ok(
    dialogs.some(
      block => /top:50%/.test(block) && /translate\(-50%,-50%\)/.test(block) && /max-height:min\(86vh,640px\)/.test(block),
    ),
    `the dialog is centred in the window and capped: ${JSON.stringify(dialogs)}`,
  )
  const clipping = dialogs.filter(block => /overflow(-[xy])?:/.test(block))
  assert.deepEqual(
    clipping,
    [],
    `the dialog must not scroll: a clip container would cut the card's ring and glow at its own edge: ${JSON.stringify(clipping)}`,
  )
})

/**
 * An open menu must be dismissible by a click on the band's blank chrome.
 *
 * The band's top bar is the shell's window-drag row, and Electron hands the
 * marked boxes to the native window: a press inside one is a title-bar press,
 * and no mouse event reaches the page. So the capture layer's onClick can only
 * run where that layer has subtracted itself from the drag box underneath —
 * Electron composes app-regions in document order with the last box winning,
 * and the layer renders after the top bar and after the Conversation header
 * (`shell.overlay` comes after the centre column).
 *
 * Measured failure (`.probe/click-dismiss/`, the reader's screenshot state):
 * with the space menu open, the composed box at the top bar's blank run was
 * `drag` on `header.cm-band-topbar` while the DOM hit test already found this
 * layer; on macOS desktop the click was consumed as a window drag and the list
 * stayed open. In a browser the same click closed it, which is why only this
 * declaration and not the layer's onClick can regress silently. It is the same
 * construction as the band gutter's declared no-drag, and it lasts exactly as
 * long as the layer — window dragging is untouched while no surface is open.
 */
test('the capture layer subtracts the window-drag strip only while it is mounted', () => {
  const capture = declarations('.cm-backdrop')
  assert.notEqual(capture, null, 'the capture layer is missing from the shipped sheet')
  assert.match(capture, /position:fixed/, `the layer must cover the viewport, not just the band: ${capture}`)
  assert.match(capture, /inset:0/, `and its box must reach every drag row's strip: ${capture}`)
  assert.match(
    capture,
    /-webkit-app-region:no-drag/,
    `without no-drag the window-drag top bar swallows the click that dismisses a menu: ${capture}`,
  )
})

/**
 * The move dialog is wider, not heavier.
 *
 * Its tree is the one body that needs the extra room — 480px, with a floor the
 * deepest indent step can live in — and that is now all the modifier does. The
 * card skin it used to carry (a stronger border, its own shadow, and the spread
 * ring that dimmed the strip behind it) is gone: two scrims would stack to
 * roughly 30% dimming, darker than any mask step the product ships, and the rest
 * of that skin is what every dialog wears today.
 */
test('the move dialog is wider, not heavier', () => {
  const box = declarations('.cm-dialog.cm-dialog--move')
  assert.notEqual(box, null, 'the move dialog needs its own width')
  assert.match(box, /width:min\(480px,92vw\)/, `wider than the 420px form: ${box}`)
  assert.match(box, /min-width:min\(420px,92vw\)/, `with a floor the tree can indent inside: ${box}`)

  assert.equal(bundle.includes('100vmax'), false, '遮罩由 .cm-backdrop--dialog 承担')
  assert.equal(bundle.includes('.cm-card.cm-dialog--move'), false, '移动弹窗不再自带一套卡片皮肤')
})

/**
 * The tree picker indents by the depth each row carries.
 *
 * The sheet must not know how deep a Workspace's topics go: every row publishes
 * its depth as `--cm-move-depth`, and one `padding-left` turns it into the 14px
 * step that makes a parent/child pair readable. The box scrolls rather than
 * growing the dialog, hover and selection are the sheet's usual fills, and a
 * refused destination keeps its row — dimmed and unclickable — so the reader can
 * see *why* it is not offered.
 */
test('the move tree indents by depth and scrolls inside the dialog', () => {
  const tree = declarations('.cm-move-tree')
  assert.notEqual(tree, null, 'the tree container is missing from the shipped sheet')
  assert.match(tree, /max-height:min\(46vh,320px\)/, `the tree scrolls instead of growing the dialog: ${tree}`)
  assert.match(tree, /overflow-y:auto/, `long Workspaces need their own scroller: ${tree}`)
  assert.match(tree, /border:1px solid var\(--dsw-alias-border-l1/, `the box reads as one field: ${tree}`)
  assert.match(tree, /border-radius:8px/, `matching the inputs it replaces: ${tree}`)

  const row = declarations('.cm-move-tree-row')
  assert.notEqual(row, null, 'the tree rows are missing from the shipped sheet')
  assert.match(
    row,
    /padding-left:calc\(8px \+ var\(--cm-move-depth, 0\) \* 14px\)/,
    `depth becomes a 14px step, without the sheet knowing the tree: ${row}`,
  )
  assert.match(row, /cursor:pointer/, `a row is a destination: ${row}`)

  assert.match(
    declarations('.cm-move-tree-row:hover'),
    /background:var\(--dsw-alias-interactive-bg-hover/,
    'hover uses the sheet\'s one interactive fill',
  )
  const selected = declarations('.cm-move-tree-row[data-selected="true"]')
  assert.match(selected, /background:color-mix\(in srgb,var\(--dsw-alias-brand-primary/, `the current destination is tinted: ${selected}`)
  assert.match(selected, /font-weight:500/, `and stated, not only coloured: ${selected}`)
  const disabled = declarations('.cm-move-tree-row[data-disabled="true"]')
  assert.match(disabled, /opacity:\.45/, `a refused destination stays visible, dimmed: ${disabled}`)
  assert.match(disabled, /cursor:not-allowed/, `and says why it cannot be picked: ${disabled}`)
  assert.ok(
    bundle.includes('.cm-move-tree-row[aria-disabled="true"],.cm-move-tree-row[data-disabled="true"]{'),
    'the refusal is keyed on the accessible attribute first, with the data one alongside',
  )
})

/** The fold arrow is the only affordance saying a subtree is open. */
test('the tree fold arrow rotates with its expanded state', () => {
  const toggle = declarations('.cm-move-tree-toggle')
  assert.notEqual(toggle, null, 'the fold arrow is missing from the shipped sheet')
  assert.match(toggle, /width:16px;height:16px/, `the arrow takes the row's leading slot: ${toggle}`)
  assert.match(toggle, /transform:rotate\(0deg\)/, `folded is the resting orientation: ${toggle}`)
  assert.match(toggle, /transition:transform/, `the rotation is the feedback: ${toggle}`)
  const open = declarations('.cm-move-tree-toggle[data-expanded="true"]')
  assert.match(open, /transform:rotate\(90deg\)/, `expanded points the arrow down: ${open}`)

  const label = declarations('.cm-move-tree-label')
  assert.notEqual(label, null, 'the label is missing from the shipped sheet')
  assert.match(label, /overflow:hidden/, `a long breadcrumb must not widen the dialog: ${label}`)
  assert.match(label, /text-overflow:ellipsis/, `${label}`)
  assert.match(label, /white-space:nowrap/, `${label}`)
})

/**
 * The keyboard cursor and the chosen destination are two different facts.
 *
 * ↑/↓ move a cursor over rows that are not (yet) selected, so the row under it
 * wears `data-active` — and it has to be visible, because the arrow keys are the
 * only thing telling the reader where they are. It must not borrow the selection
 * fill either: selection is "this is the destination", the cursor is "this is
 * where the keyboard is", and a reader stepping through on the way to a
 * different row needs to see both at once. Hence a light interactive fill plus a
 * 2px brand bar on the leading edge, with the row left in its normal ink.
 */
test('the tree keyboard cursor is visible and reads apart from the selection', () => {
  const cursor = declarations('.cm-move-tree-row[data-active="true"]')
  assert.notEqual(cursor, null, 'the cursor row has no style: ↑/↓ would move an invisible caret')
  assert.match(
    cursor,
    /background:var\(--dsw-alias-interactive-bg-hover/,
    `the cursor is a light fill, not the selection tint: ${cursor}`,
  )
  assert.match(
    cursor,
    /box-shadow:inset 2px 0 0 var\(--dsw-alias-brand-primary/,
    `a 2px brand bar on the leading edge is what makes the caret findable: ${cursor}`,
  )
  assert.equal(
    /color:var\(--dsw-alias-brand-primary/.test(cursor),
    false,
    'the cursor row keeps its normal ink: only the selection is stated in the brand colour',
  )
  const selected = declarations('.cm-move-tree-row[data-selected="true"]')
  assert.notEqual(selected, cursor, 'the two states must not collapse into one rule')
})

/**
 * The clicked node is an outlined container, unless it is on the home chain.
 *
 * The selection is the temporary navigation cursor: one 1.5px inset outline in
 * brand ink (62%) plus the bold title and no surface. The owner's rule makes one
 * exception: a row that is both selected and on the open conversation's home
 * chain shows the chain style (filled folder + bold), because the chain is the
 * always-on statement and the open conversation row already says what is being
 * read. The sheet expresses that by excluding chain rows from the outline rule.
 */
test('the clicked node is an outlined container unless it is on the home chain', () => {
  const selector = '.cm-node-row[data-selected="true"]:not([data-session-path="true"])'
  const selected = declarations(selector)
  assert.notEqual(selected, null, 'the selected node rule is missing from the shipped sheet')
  assert.match(selected, /background:transparent/, `the selection paints no surface: ${selected}`)
  assert.doesNotMatch(selected, /background:color-mix/, `the selection must not keep a fill: ${selected}`)
  assert.match(
    selected,
    /box-shadow:inset 0 0 0 1\.5px color-mix\(in srgb,var\(--dsw-alias-brand-primary,currentColor\) 62%,transparent\)/,
    `the selection is a 1.5px brand outline: ${selected}`,
  )
  assert.match(selected, /font-weight:600/, `the selected row carries the bold title: ${selected}`)
  assert.doesNotMatch(selected, /outline:/, `the selection must not borrow the outline channel (search cursor): ${selected}`)
  // The chain wins when a row is both: no second selected rule may paint the
  // chain rows, or the priority rule silently dies.
  const bare = declarations('.cm-node-row[data-selected="true"]')
  assert.equal(bare, null, 'the selection outline must always be scoped away from the home chain')
})

/**
 * The selection's ancestors are plain rows again.
 *
 * The owner's marker language reserves two marks: the always-on home chain
 * (filled folder + bold) and the clicked row (inset border). A container above
 * the click is neither, so it does not keep the old soft path outline — it
 * hovers and behaves like any other row. Keeping a third faint mark here was
 * tried and read as a second chain; the tree is calmer without it.
 */
test('the selection ancestors stay plain while the chain owns the marks', () => {
  assert.equal(declarations('.cm-node-row[data-path-selected="true"]'), null, 'the selection path rule left the sheet')
  assert.equal(declarations('.cm-node-row[data-path-selected="true"] .cm-slot'), null, 'the selection path no longer recolours the icon')

  const hoverSelector = '.cm-node-row:hover:not([data-selected="true"]):not([data-session-path="true"])'
  const hoverStart = bundle.indexOf(hoverSelector)
  assert.ok(hoverStart >= 0, 'hover is scoped to rows that are neither selected nor on the home chain')
  const hover = bundle.slice(hoverStart, bundle.indexOf('}', hoverStart))
  assert.match(hover, /background:var\(--dsw-alias-interactive-bg-hover/, `the hover fill is the interactive token: ${hover}`)
  assert.doesNotMatch(hover, /data-path-selected/, 'a selection ancestor is a normal row and takes hover')

  // Blind-spot guard: the attribute still exists in the DOM contract, but no
  // CSS selector may key off it — the sheet has exactly two row marks (the home
  // chain and the clicked row), and a stray `[data-path-selected]` rule would
  // quietly repaint a selection ancestor again.
  assert.equal(bundle.includes('[data-path-selected'), false, 'no CSS selector may key off the selection path')
})

/**
 * The seam is draggable for the band's whole height — including the header.
 *
 * The line and the gesture have to be one element. When the handle lived inside
 * `.cm-band-body` it started at the shipped Conversation header's foot (40px
 * blank / 76px with a Session), so the top of the seam was a painted hairline
 * with no hit area behind it: a press there resized nothing, and on macOS it
 * moved the window, because the band's top bar is the shell's window-drag row
 * and the strip sat under it. Measured before the fix: drag at y=20 left the
 * band at 560px; drag at y=78 moved it to 620px.
 *
 * Two declarations carry the contract, and both are load-bearing:
 *   1. the handle spans the band, so the hit area starts where the line does;
 *   2. it subtracts itself from the window-drag row with `no-drag`, because
 *      Electron composes app-regions in document order and the top bar — which
 *      comes first — would otherwise keep dragging the window.
 */
test('the resize handle spans the band, header included, and is not a window-drag strip', () => {
  const handle = declarations('.cm-band-gutter')
  assert.notEqual(handle, null, 'the band handle rule is missing from the shipped sheet')
  assert.match(handle, /position:absolute/, `the handle rides the band edge: ${handle}`)
  assert.match(handle, /top:0/, `the handle starts at the band's top, not at the body's: ${handle}`)
  assert.match(handle, /bottom:0/, `and runs to the bottom: ${handle}`)
  assert.match(handle, /right:0/, `on the band's right edge: ${handle}`)
  assert.match(handle, /cursor:col-resize/, `the cursor carries the affordance: ${handle}`)
  assert.match(handle, /pointer-events:auto/, `the strip must take the pointer: ${handle}`)
  assert.match(
    handle,
    /-webkit-app-region:no-drag/,
    `without no-drag the window-drag top bar swallows the header half of the seam: ${handle}`,
  )

  /* One element draws the line for the whole height, so the header must not
     paint a second copy of it: a leftover ::after would be a hairline with no
     gesture behind it again, and the two constructions could drift apart. */
  assert.equal(
    declarations('.cm-band-topbar::after'),
    null,
    'the header must not paint its own seam copy: the handle owns the whole line',
  )
  const line = declarations('.cm-band-gutter::before')
  assert.notEqual(line, null, 'the handle draws the seam')
  assert.match(line, /top:0;bottom:0/, `the hairline covers the band's whole height: ${line}`)
  assert.match(line, /right:calc\(var\(--cm-band-gutter-width,8px\) \/ 2 - \.5px\)/, `right-anchored so the seam keeps one x: ${line}`)
})

/**
 * The sidebar row's status cluster is taken out of the 16px glyph cell.
 *
 * The shell hands the plugin a 16px glyph cell in the wide sidebar (18px in the
 * rail — `SidebarRoot.tsx` passes `size: wide ? 16 : 18`) and the plugin only
 * renders inside it, but the cluster the reader asked for is a node row's mark:
 * one dot plus count per category. That does not fit on a 16px icon (the earlier
 * corner badge started at x=4 of the glyph and read as a green speech bubble),
 * so while the cluster is present the shell row becomes the containing block and
 * the glyph cell goes static. Without `:has()` the cluster stays hidden instead
 * of widening the cell and pushing the label.
 */
test('the sidebar status cluster is anchored to the row, not to the glyph cell', () => {
  const row = declarations('button:has(.cm-panel-glyph > .cm-rollup)')
  assert.notEqual(row, null, 'the row must become the containing block while the cluster is present')
  assert.match(row, /position:relative/, `the row carries the cluster: ${row}`)

  const cell = declarations('.cm-panel-glyph:has(> .cm-rollup)')
  assert.notEqual(cell, null, 'the glyph cell must leave the containing-block chain')
  assert.match(cell, /position:static/, `otherwise the cluster would sit on the 16px mark: ${cell}`)

  const cluster = allDeclarations('.cm-panel-glyph > .cm-rollup')
  assert.ok(cluster.some(block => /display:none/.test(block)), 'without :has() the cluster hides instead of misplacing the label')
  assert.ok(
    cluster.some(block => /position:absolute/.test(block) && /right:8px/.test(block) && /top:50%/.test(block)),
    `the wide row draws the cluster on its trailing edge: ${JSON.stringify(cluster)}`,
  )

  const rail = declarations('.cm-panel-glyph[data-seat="rail"] > .cm-rollup')
  assert.notEqual(rail, null, 'the 56px rail needs its own seat for the dots')
  assert.match(rail, /right:0;top:0;transform:none/, `the rail cluster rides the row corner: ${rail}`)

  /* The corner badge is gone: the cluster replaced it, and a leftover pill rule
     would still paint over the mark. */
  assert.equal(declarations('.cm-panel-badge'), null, 'the old corner badge rule must not survive')
})

/**
 * The space entry's status cluster is the active space's count, compared by the
 * reader against the sidebar row's whole-map count. It must not squeeze the
 * chrome controls in the one state where row space is scarce: a search field
 * sharing its row.
 *
 * The header used to have a second such state — the blank Session, where the
 * whole chrome collapsed to one row and the entry became a narrow first-row
 * pill — and that variant is gone: the band's top bar keeps its two rows in
 * every state, so the entry always sits on row two with its normal width and the
 * compact override must not come back.
 */
test('the space entry gives its cluster up when the search field shares its row', () => {
  assert.equal(
    declarations('.cm-band[data-compact] .cm-space-btn .cm-rollup'), null,
    'the one-row blank-Session header variant is gone; no compact cluster rule',
  )
  assert.equal(
    declarations('.cm-band[data-compact="true"] .cm-band-topbar'), null,
    'the top bar keeps its rule on a blank Session instead of dropping it',
  )

  const searching = declarations('.cm-band-row2:has(.cm-search) .cm-crumb .cm-rollup')
  assert.notEqual(searching, null, 'opening the search field on row two hides the counts too')
  assert.match(searching, /display:none/, `the search rule removes the cluster: ${searching}`)
})

/**
 * The band top bar keeps the shipped header's rule and its own two rows even
 * while the shipped header is the blank 40px one: the panel computes the height
 * from the measured leading row (see `bandHeaderHeight` in the render tests) and
 * the sheet only has to keep the rule, which now stands alone on the blank
 * landing page instead of disappearing with the shipped header's.
 */
test('the band top bar always draws its baseline rule', () => {
  const topbar = declarations('.cm-band-topbar')
  assert.notEqual(topbar, null, 'the top bar has its own box')
  assert.match(topbar, /border-bottom:\.5px solid/, `the rule is unconditional: ${topbar}`)
})

/**
 * The space entry is one breadcrumb control: the whole bar is a single button, so
 * every segment (including the whole-map count) opens the space menu. Only the
 * current space's name shrinks; the root label, the separator and both clusters
 * stay whole. The row-2 pill box supplies height/padding, and the direct-child
 * rule lifts the pill's 180px ceiling off the bar.
 */
test('the space breadcrumb is one control with a static root and a shrinkable current name', () => {
  const crumbRules = allDeclarations('.cm-crumb')
  const crumb = crumbRules.find(rule => /display:flex/.test(rule)) ?? null
  assert.notEqual(crumb, null, 'the breadcrumb has its own container rule')
  assert.match(crumb, /min-width:0/, `the row may shrink the breadcrumb: ${crumb}`)

  const rowRule = declarations('.cm-band-row2>.cm-crumb')
  assert.notEqual(rowRule, null, 'the breadcrumb is the row-2 pill seat')
  assert.match(rowRule, /max-width:100%/, `the bar may use the row's width: ${rowRule}`)

  const root = declarations('.cm-crumb-root')
  assert.notEqual(root, null, 'the root segment has its own box')
  assert.match(root, /flex:none/, `the root never participates in shrinking: ${root}`)

  const separator = declarations('.cm-crumb-sep')
  assert.notEqual(separator, null, 'the separator is its own element')
  assert.match(separator, /flex:none/, `the separator never shrinks: ${separator}`)

  const current = declarations('.cm-crumb-current')
  assert.notEqual(current, null, 'the current segment has its own box')
  assert.match(current, /flex:0 1 auto/, `only the current segment may shrink: ${current}`)
  assert.match(current, /min-width:0/, `the current name may ellipsize: ${current}`)
  assert.match(current, /font-weight:600/, `the current space reads as the active level: ${current}`)

  const currentName = declarations('.cm-crumb-current .cm-space-name')
  assert.notEqual(currentName, null, 'the current name owns the ellipsis')
  assert.match(currentName, /text-overflow:ellipsis/, `a long space name truncates: ${currentName}`)
})

/**
 * The search result column's own contracts: a hit may carry a second line, the
 * keyboard cursor must not repaint a row's selected mark, and the matched run is
 * isolated with the theme's brand tint instead of a hardcoded colour.
 */
test('search result rows reserve a second line and keep the cursor separate from selection', () => {
  const note = declarations('.cm-row-note')
  assert.notEqual(note, null, 'the search view needs a note rule')
  assert.match(note, /text-overflow:ellipsis/, `a narrow column must truncate the note: ${note}`)

  const labels = declarations('.cm-row-labels')
  assert.notEqual(labels, null, 'the title and its note share a column')
  assert.match(labels, /flex-direction:column/, `the two lines stack: ${labels}`)

  const active = declarations('.cm-node-row[data-search-active="true"],.cm-thread-row[data-search-active="true"]')
  assert.notEqual(active, null, 'the keyboard cursor needs its own mark')
  assert.match(active, /outline:/, `the cursor is a ring, not the selected background: ${active}`)
  assert.doesNotMatch(active, /background:/, `the cursor never adds a surface to the row it walks: ${active}`)
  assert.ok(!/font-weight:500/.test(active), 'the cursor never claims the selected row weight')

  const wash = declarations('.cm-node-row[data-search-active="true"]:not([data-selected="true"]),.cm-thread-row[data-search-active="true"]:not([data-selected="true"])')
  assert.notEqual(wash, null, 'the cursor wash is scoped away from rows that already carry a fill')
  assert.match(
    wash,
    /background:color-mix\(in srgb,var\(--dsw-alias-brand-primary,currentColor\) 9%,transparent\)/,
    `the wash stays one step quieter than the selected row: ${wash}`,
  )

  const mark = declarations('.cm-search-mark')
  assert.notEqual(mark, null, 'a matched run must be visible inside a snippet')
  assert.match(mark, /var\(--dsw-alias-brand-primary/, `the highlight asks the theme for its brand tint: ${mark}`)
})

/**
 * A group row (「未分组」 without legacy topics) is a conversation list, not a
 * node: it has no click action at all. It used to inherit the node row's pointer
 * cursor and hover wash, so pressing it looked like a broken button. The sheet
 * has to hand that affordance back only to rows that can actually be selected.
 */
test('a row that cannot be selected does not borrow the button affordance', () => {
  const rule = declarations('.cm-node-row[data-selectable="false"]')
  assert.notEqual(rule, null, 'the non-selectable row rule is missing from the shipped sheet')
  assert.match(rule, /cursor:\s*default/, `it must not invite a click: ${rule}`)
  assert.match(
    bundle,
    /\.cm-node-row:hover[^{]*:not\(\[data-selectable="false"\]\)[^{]*\{/,
    'the hover wash must skip rows that have no action',
  )
})

/**
 * Dialog body copy and the seat's one-time discovery pill once shared a class
 * name. The pill's absolute placement then applied to every `.cm-hint` inside a
 * dialog, so confirmation sentences left the card and floated beside it — the
 * reader saw an empty dialog and three stray pills. Pin the two rules apart:
 * exactly one in-flow rule for dialog hints, and the pill anchored in its own.
 */
test('dialog hint copy stays in the card, the discovery pill is the anchored one', () => {
  const hints = allDeclarations('.cm-hint')
  assert.equal(hints.length, 1, 'a second `.cm-hint` rule would override the dialog copy again')
  assert.ok(!/position:\s*absolute/.test(hints[0]), `dialog copy must stay in flow: ${hints[0]}`)
  assert.ok(!/(^|;)left:/.test(hints[0]), 'dialog copy must not be pinned beside an anchor')

  const pill = declarations('.cm-seat-hint')
  assert.notEqual(pill, null, 'the one-time discovery pill owns its own class')
  assert.match(pill, /position:\s*absolute/, 'the pill is the anchored element')
  assert.match(pill, /white-space:nowrap/, 'the pill stays one line')
})

/**
 * A′ removed the band's row-2 reading chip. The chip's seat, its ghost-button
 * geometry and its density variants must leave the sheet with it — a leftover
 * rule would paint a row the panel no longer renders — while the row itself
 * stays the space-breadcrumb / search row it was before the chip.
 */
test('the band second row no longer styles a reading chip', () => {
  assert.notEqual(declarations('.cm-band-row2'), null, 'the second row keeps its own rule')
  assert.equal(declarations('.cm-band-row2>.cm-home-slot'), null, 'the chip seat rule is gone')
  assert.equal(declarations('.cm-home-chip'), null, 'the chip button rule is gone')
  assert.equal(declarations('.cm-home-chip-label'), null, 'the chip label rule is gone')
  assert.equal(declarations('.cm-home-chip[data-tier="icon"] .cm-home-chip-label'), null, 'the density rules are gone')
})

/** The old divergence card was replaced by the read-only line; its rules must not survive. */
test('the retired divergence card has no rules left', () => {
  for (const selector of [
    '.cm-home-notice',
    '.cm-home-notice-card',
    '.cm-home-notice-icon',
    '.cm-home-notice-desc',
    '.cm-home-notice-actions',
    '.cm-home-notice-btn',
    '.cm-home-notice-dismiss',
  ]) {
    assert.equal(declarations(selector), null, `${selector} must leave the sheet with the card`)
  }
})

/**
 * The composer-side context bar is the loudest reading aid A′ ships: a 30px
 * pill on the composer's own width axis — layer-2 surface, 8px radius, 10px
 * side padding — so the chain reads as a breadcrumb instead of a whisper. It
 * borrows the composer's width variables so it lines up with the input card, and
 * keeps no shadow or frame of its own: the surface is the whole chrome.
 */
test('the context bar is one 30px breadcrumb on the composer width axis', () => {
  const line = declarations('.cm-home-path')
  assert.notEqual(line, null, 'the read-only context bar has its own rule')
  assert.match(line, /display:flex/, `the badge and the chain share one row: ${line}`)
  assert.match(line, /align-items:center/, `the row is vertically centred: ${line}`)
  assert.match(line, /height:30px/, `A′ fixed the bar at 30px: ${line}`)
  assert.match(line, /border-radius:8px/, `the bar is a soft pill: ${line}`)
  assert.match(line, /padding:0 10px/, `the bar gives its ends 10px of air: ${line}`)
  assert.match(line, /gap:8px/, `the badge and the chain share an 8px rhythm: ${line}`)
  assert.match(line, /font-size:12\.5px/, `the chain reads one step above caption size: ${line}`)
  assert.match(line, /min-width:0/, `a long chain may shrink: ${line}`)
  assert.match(line, /margin:0 auto/, `the bar centres on the composer card: ${line}`)
  assert.match(line, /overflow:hidden/, `the bar clips its chain instead of growing: ${line}`)
  assert.match(line, /white-space:nowrap/, `the chain stays on one line: ${line}`)
  assert.match(
    line,
    /width:calc\(100% - 2\*var\(--dsh-composer-side-clearance\) - 4\*var\(--dsh-composer-dock-inset\)\)/,
    `the column comes from the composer's own variables: ${line}`,
  )
  assert.match(
    line,
    /max-width:calc\(var\(--dsh-composer-card-max-width\) - 4\*var\(--dsh-composer-dock-inset\)\)/,
    `the cap is the input card's width: ${line}`,
  )
  assert.match(
    line,
    /background:color-mix\(in srgb,var\(--dsw-alias-brand-primary,currentColor\) 5%,transparent\)/,
    `the surface is a quiet brand wash, visible on a white chat column: ${line}`,
  )
  assert.doesNotMatch(line, /(^|;)box-shadow:/, `the bar carries no lift: ${line}`)
  assert.doesNotMatch(line, /(^|;)border:/, `the bar has no frame: ${line}`)
})

/**
 * The bar's parts: the 「当前会话」 badge stays quiet and fixed, the segment boxes
 * shrink and ellipsize, and only the last segment — the open conversation's own
 * title — takes the primary ink and the heavier weight, so the chain reads from
 * the space down to the conversation being typed into. The title sits in its own
 * part with a width floor: the chain group clips its tail, and the one hop the
 * reader is about to type into must not be squeezed out by a long chain. When no
 * title is known the home node keeps the emphasised end it always had. No icon
 * rule survives: the badge is the only mark the line opens with.
 */
test('the context bar parts: badge, chain, and the emphasised conversation title', () => {
  assert.equal(declarations('.cm-home-path-glyph'), null, 'the bubble mark left the sheet with the icon')

  const badge = declarations('.cm-home-path-label')
  assert.notEqual(badge, null, '「当前会话」 is its own badge')
  assert.match(badge, /height:20px/, `the badge is a 20px chip inside the 30px bar: ${badge}`)
  assert.match(badge, /padding:0 8px/, `the badge pads its label: ${badge}`)
  assert.match(badge, /border-radius:6px/, `the badge is softly rounded: ${badge}`)
  assert.match(
    badge,
    /background:color-mix\(in srgb,var\(--dsw-alias-brand-primary,currentColor\) 10%,transparent\)/,
    `the badge is a brand tint one step stronger than the bar: ${badge}`,
  )
  assert.match(badge, /color:var\(--dsw-alias-brand-primary/, `the badge text is brand ink: ${badge}`)
  assert.match(badge, /font-size:11px/, `the badge is one size below the chain: ${badge}`)
  assert.match(badge, /font-weight:500/, `the badge is medium, not bold: ${badge}`)

  const segments = declarations('.cm-home-path-segments')
  assert.notEqual(segments, null, 'the chain is its own inline box')
  assert.match(segments, /min-width:0/, `the chain may shrink: ${segments}`)
  assert.match(segments, /overflow:hidden/, `the chain clips at the bar edge: ${segments}`)

  const part = declarations('.cm-home-path-part')
  assert.notEqual(part, null, 'each chain level is a part')
  assert.match(part, /min-width:0/, `a part may shrink: ${part}`)

  const seg = declarations('.cm-home-path-seg')
  assert.notEqual(seg, null, 'each chain segment owns its ellipsis')
  assert.match(seg, /max-width:220px/, `one very long name cannot eat the whole bar: ${seg}`)
  assert.match(seg, /overflow:hidden/, `an over-long name is clipped: ${seg}`)
  assert.match(seg, /text-overflow:ellipsis/, `the clip reads as an ellipsis: ${seg}`)
  assert.match(seg, /white-space:nowrap/, `the ellipsis needs a single line: ${seg}`)

  const last = declarations('.cm-home-path-seg[data-last="true"]')
  assert.notEqual(last, null, 'the final segment is marked')
  assert.match(
    last,
    /color:var\(--dsw-alias-label-primary/,
    `the chain end — the conversation's title, or the home node when it has none — is the primary reading: ${last}`,
  )
  assert.match(last, /font-weight:600/, `the chain end is emphasised harder than the badge: ${last}`)

  // The title is the chain's last hop and sits outside the clipping segment
  // group, so it keeps a width floor of its own: a long chain ellipsizes instead
  // of eating the name of the conversation the reader is typing into.
  const thread = declarations('.cm-home-path-thread')
  assert.notEqual(thread, null, 'the conversation title sits in a part of its own')
  assert.match(thread, /min-width:84px/, `a width floor keeps a long chain from squeezing the title out: ${thread}`)
  assert.match(thread, /max-width:280px/, `one very long title cannot eat the whole bar either: ${thread}`)
  assert.match(thread, /overflow:hidden/, `the title part clips at its cap: ${thread}`)

  const threadSeg = declarations('.cm-home-path-thread-seg')
  assert.notEqual(threadSeg, null, 'the title segment owns its own ellipsis cap')
  assert.match(threadSeg, /max-width:260px/, `the title ellipsizes before its part's cap: ${threadSeg}`)

  const separator = declarations('.cm-home-path-sep')
  assert.notEqual(separator, null, 'the separators have their own box')
  assert.match(separator, /flex:none/, `separators never shrink: ${separator}`)
  assert.match(separator, /padding:0 5px/, `separators carry their own air: ${separator}`)
  assert.match(separator, /opacity:\.7/, `the separators stay quieter than the names: ${separator}`)

  const threadSeparator = declarations('.cm-home-path-thread .cm-home-path-sep')
  assert.notEqual(threadSeparator, null, 'the title hop has its own separator rhythm')
  assert.match(
    threadSeparator,
    /padding:0 5px 0 2px/,
    `the bar's own 8px gap already supplies the left air: ${threadSeparator}`,
  )

  // The old 「正在读」 prefix rule must not survive the rename.
  assert.equal(declarations('.cm-home-path-prefix'), null, 'the prefix rule left the sheet with the wording')
})

/**
 * The home chain is stated with the filled folder and the bold title — never
 * with a second surface, an outline, or a ring.
 *
 * The home node and every container above it (Workspace row + ancestor topics)
 * carry `data-session-path`; the chain is always on, so after clicking another
 * node the reader can still see which branch the open conversation lives under,
 * even when the home's own column is not rendered. The home row has no bespoke
 * rule any more: it is simply one row of that chain, and the thread rows nested
 * under it show that it owns the conversation. The 5px gutter ring, the 10% lane
 * and the 40% path outline are all gone — each was a second way to say the same
 * thing, or (the ring) a point that collided with the folder slot.
 */
test('the home chain is the filled folder + bold title, with no surface or ring', () => {
  assert.equal(declarations('.cm-node-row[data-session-home="true"]'), null, 'the home row has no bespoke rule')
  assert.equal(declarations('.cm-node-row[data-session-home="true"]::after'), null, 'the 5px ring left the sheet')

  const chain = declarations('.cm-node-row[data-session-path="true"]')
  assert.notEqual(chain, null, 'the home chain rule is missing from the shipped sheet')
  assert.match(chain, /background:transparent/, `the chain paints no surface: ${chain}`)
  assert.doesNotMatch(chain, /box-shadow/, `the chain carries no outline: ${chain}`)
  assert.match(chain, /font-weight:600/, `the chain title is bold: ${chain}`)

  const slot = declarations('.cm-node-row[data-session-path="true"] .cm-slot')
  assert.notEqual(slot, null, 'the chain states itself in the leading icon')
  assert.match(slot, /color:var\(--dsw-alias-brand-primary/, `the chain folder takes the brand colour: ${slot}`)

  const fill = declarations('.cm-node-row[data-session-path="true"] .cm-row-icon path')
  assert.notEqual(fill, null, 'the chain fills the folder glyph, not just its outline')
  assert.match(fill, /fill:currentColor/, `the folder glyph is filled: ${fill}`)

  assert.equal(declarations('.cm-node-row[data-session-path="true"]::before'), null, 'no rail replaced the old lane')
  assert.match(
    bundle,
    /\.cm-node-row\[data-session-path="true"\]:hover \.cm-chevron,[\s\S]*?\{color:var\(--dsw-alias-brand-primary,currentColor\)/,
    'a hovered or menu-pinned chain row keeps the brand glyph through the fold arrow',
  )
})

/**
 * A clipped row title is revealed in the product's own tooltip surface.
 *
 * The bubble is portaled under `<body>` because the column scroller clips and
 * the band's `container-type` is a containing block for fixed descendants, so
 * the sheet has to state the viewport-fixed box and the portal layer's z-index
 * itself. Everything else is the design system's tooltip: its surface token,
 * type scale, radius, 150ms entry, and the pointer pass-through that keeps a
 * hover tip from blocking the row it explains.
 */
test('the clipped-title tip wears the product tooltip surface and escapes the column', () => {
  const rule = declarations('.cm-tip')
  assert.notEqual(rule, null, 'the title tip is missing from the shipped sheet')
  assert.match(rule, /position:fixed/, `the bubble is viewport-fixed, not clipped by the column: ${rule}`)
  assert.match(rule, /z-index:1100/, `the portal layer's tooltip z-index: ${rule}`)
  assert.match(rule, /background:var\(--dsw-alias-tooltip-bg/, `the product tooltip surface token: ${rule}`)
  assert.match(rule, /color:var\(--dsw-static-neutral-bluish-00/, `the tooltip ink token: ${rule}`)
  assert.match(rule, /font-size:13px;line-height:20px/, `the product tooltip type scale: ${rule}`)
  assert.match(rule, /visibility:hidden/, `an unmeasured bubble stays invisible: ${rule}`)
  assert.match(rule, /pointer-events:none/, `the bubble never takes the pointer: ${rule}`)
  assert.match(bundle, /@keyframes cm-tip-in/, 'the bubble enters with the product 150ms fade')
  assert.match(bundle, /@media \(prefers-reduced-motion:reduce\)\{\.cm-tip\{animation:none\}\}/, 'reduced motion keeps it still')
})
