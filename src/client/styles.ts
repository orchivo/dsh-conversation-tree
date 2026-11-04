/** Plugin-owned stylesheet, injected once at activation. */

/** Attribute marking the plugin's own style tag. */
const STYLE_ID = 'dsh-conversation-tree/style'

/**
 * Plain, prefixed classes: the bundle ships no CSS pipeline, so the sheet is
 * injected at activation. Colors come from the client's own theme tokens so the
 * plugin follows light and dark like a shipped surface.
 *
 * The node rows deliberately echo the application's own workspace directory:
 * a node row, its conversations indented beneath it, and hover-revealed tools.
 */
const CSS = `
/* ── the split reservation ─────────────────────────────────────────────── */
/* The only layout change applied to the shipped Conversation: the band's width
   is reserved on the Conversation root, so the product's header, tabs, body and
   composer all shift right and keep the rest of the centre. The variable is set
   by the band and removed with it. */
html[data-conversation-map-split] [data-slot="main.conversation"] > div{padding-left:var(--cm-map-width,0px)}

/* ── the conversation's window-chrome reserve, folded by that strip ────── */
/* The shell publishes --dsh-frame-leading-clearance (160px windowed / 84px
   fullscreen) exactly while the sidebar is fully hidden, which is the state map
   mode puts the frame in (ctx.layout.toggleSidebar()). The shipped header
   spends it once, as a fixed inset on its title row:
   padding-inline-start:max(0px,calc(var(--dsh-frame-leading-clearance,0px) - 20px)).
   That is right only while the Conversation starts at the frame's left edge.
   Behind the strip above it does not: the chrome that inset dodges is the
   traffic lights to x 68 plus the seat's controls to x 152 plus 8px of air, and
   the band covers that band the whole time — the strip, not the title row, is
   what keeps the header clear. So the reserve is read off the frame before it
   is overridden, then folded by the reserved width: what survives is the part
   of the chrome band the strip does not cover, i.e. nothing while the band is
   at least as wide as the chrome (shipped floor: 200 wide, 160 chrome).
   Scoped to the Conversation subtree on purpose: the band's own first row lives
   in the frame overlay (outside it) and split-frame.ts reads the frame's own
   computed value, so both keep the shell's number, and nothing else in the
   product reads this variable. While the band yields, while the sidebar is
   expanded, or outside map mode, data-conversation-map-split is absent and the
   shipped behaviour is untouched. */
html[data-conversation-map-split] [data-slot="main.conversation"]{--cm-chrome-reserve:var(--dsh-frame-leading-clearance,0px)}
html[data-conversation-map-split] [data-slot="main.conversation"] > div{--dsh-frame-leading-clearance:max(0px,calc(var(--cm-chrome-reserve,0px) - var(--cm-map-width,0px)))}

/* ── the window-chrome seat: its bubble stays whole, our chips step aside ─ */
/* The shell mounts the macOS window-chrome seat (traffic lights' reopen
   controls) as a frame child at z-index 15, i.e. *below* the frame overlay
   layer (20) the band is a guest of. Its buttons end at x 152, inside the
   clearance the band's own first control leaves free (160), so the buttons are
   fine — but the design-system tooltip they raise is anchored to the button's
   right edge and ~153px wide (x 126 → 279), so it lands under the band's pills
   and is drawn in slices (measured: 111 of those 153px painted over by the
   「会话」 and space pills at the time of the measurement — that left pill now
   reads 「收起」). Comparing the two z-indexes is the whole fix: the
   seat's own stacking context keeps the bubble's z-index:100 from outranking
   the overlay layer, so the seat has to move above it — one step up, 21. The
   price is stated plainly: the overlay layer as a whole, whatever z-index its
   children carry, now sits under the seat. What stays above is the design
   system's portaled layer (modals, z-index 1000), which is where a full-screen
   surface belongs. Nothing else shifts: the seat's box never overlaps a band
   control, and its tooltip is pointer-events:none. */
html[data-conversation-map-split] [data-shell-leading]{z-index:21}
/* Whole is not enough: the bubble would now lie *on top of* the band's own
   chips — a tooltip may cover content, but covering the reader's controls is
   what gets noticed. So while that bubble exists, the band's first row steps
   aside. No shell DOM is touched and no script runs: :has() simply sees the
   [role="tooltip"] the design system renders inside the seat. Engines without
   :has() keep the row visible, and the rule above still keeps the bubble whole
   — the adaptation degrades, it does not break. pointer-events leaves with the
   opacity: an invisible chip must not keep swallowing clicks. */
.cm-band-head-row > *{transition:opacity 120ms ease}
html[data-conversation-map-split]:has([data-shell-leading] [role="tooltip"]) .cm-band-head-row > *{opacity:0;pointer-events:none}

/* ── the seat's second button yields to the band's own ─────────────────── */
/* Map mode draws its own context-aware 「新建会话」 in exactly that slot (the
   band's first row starts right there, see split-frame.ts), so the shell's
   second seat button has to leave while the band is at the frame's left edge.
   The selector is structural on purpose: button:not(:first-of-type) is the
   seat's SECOND button (新建会话) and never the first (打开侧边栏), and it reads
   no localized wording, so a language change cannot break it.
   The older form was button + button, and it had a defect the shipped shell
   exposes: while either seat tooltip is open the design system renders its
   bubble span[role="tooltip"] *between* the two buttons (cloned in after its
   anchor), so the buttons stop being adjacent siblings, the rule drops out for
   exactly as long as the bubble is up, and the shell's 新建会话 flashes back —
   widening the seat 28 → 64 and displacing the band's own 「新建会话」 for a
   heartbeat ([data-shell-leading] button + button never matched again in that
   frame). :not(:first-of-type) is sibling-agnostic: it keeps matching the
   second button whatever sits between them, and a seat that ever holds only one
   button matches nothing (that button is the first of its type). No script
   touches the shell's DOM — this one rule is the whole coupling. The attribute
   it hangs on is set only while the band really is at that edge: MapPanel.tsx
   removes data-conversation-map-split while the band yields, while it is
   invisible, and of course while the mode is off, so the shell's button comes
   back by itself in each of those states.
   Two failures are possible and both are safe. (1) If a future shell changes the
   seat's structure this rule simply stops matching, and the reader sees today's
   layout: the shell's two buttons plus the plugin's 「收起」. (2) The plugin only
   draws its own 新建会话 when the measured seat is narrow (split-frame.ts's
   seatWidth), i.e. only when this rule did take effect; so a rule that stopped
   matching also means the plugin draws only 「收起」. The failure mode is
   therefore "today's layout", never two 新建会话 buttons. */
html[data-conversation-map-split] [data-shell-leading] button:not(:first-of-type){display:none}

/* ── the shell's collapsed left column stays keyboard-quiet in map mode ── */
/* On macOS the shell collapses its left column to a ZERO-WIDTH, overflow:hidden
   track but keeps the whole subtree mounted — including the sidebar's own
   「打开侧边栏」 toggle (SidebarRoot's .topStrip), whose box is pushed to
   x −26..10, i.e. completely clipped. It is still the document's FIRST tab stop,
   so any keyboard focus that reaches it (Tab from the page body after a click on
   non-focusable content, Shift+Tab through the clipped rows, focus restoration)
   makes the design system render that button's tooltip from the clipped rect.
   The bubble is position:fixed, so the clip does not apply to it: it escapes and
   paints at the window's top-left corner, right over the traffic lights — the
   「打开侧边栏 ⌘B」 bubble that looks like it came from nowhere. The very same
   control is already drawn by the shell in the window-chrome seat while the
   sidebar is hidden, so the clipped column is a duplicate in this state; keeping
   it out of the tab order removes the trigger without changing a pixel.
   visibility, not display: it keeps the geometry the shell measures, and it does
   take the subtree out of the tab order (pointer-events would not — it never
   stops keyboard focus). The descendant * is load-bearing: sibling plugins
   re-state visibility:visible on their own rows (ui-workspace does), which would
   otherwise re-arm the trap for everything below them.
   Scoping is what makes this safe: darwin only, map mode only, and only while
   the frame says [data-sidebar-collapsed]. The zero-width collapse is not
   macOS-only — the Windows desktop shell collapses the column to 0 too — but
   the Windows caption row keeps the reopen controls *visible* as fixed
   buttons inside this same sidebar slot (ui-sidebar's collapsed styles), so
   hiding the subtree there would remove the only visible way back. Web keeps
   its 56px icon rail, whose controls are visible and must stay interactive.
   That is why the rule is keyed to the platform that clips its reopen control,
   not to the collapse state. Expanding the sidebar — the reader may do that in
   map mode at any time — removes that attribute and every rule here stops
   applying, so the real column comes back exactly as the shell draws it. Out
   of map mode nothing changes at all: a manual collapse there is the shell's
   own behaviour and not the plugin's to override. */
html[data-platform="darwin"][data-conversation-map-split] [data-sidebar-collapsed] [data-slot="sidebar"] *{visibility:hidden}
/* A bubble that is already up carries visibility:visible as an inline style,
   which no inherited value can clamp, so a focus that lands in the same frame
   could still leave a stray bubble painted over the chrome. Drop it outright —
   scoped to the sidebar slot so the seat's own bubble (a frame child, also inside
   [data-sidebar-collapsed]) is never touched. */
html[data-platform="darwin"][data-conversation-map-split] [data-sidebar-collapsed] [data-slot="sidebar"] [role="tooltip"]{display:none}

/* ── the map band, a frame-wide overlay over the centre's left edge ────── */
/* The band is transparent and click-through: the shell's macOS window-chrome
   controls sit underneath its top-left corner, so exactly the controls (and the
   node area) opt back into pointer events. */
.cm-band{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;min-width:0;min-height:0;pointer-events:none;container-type:inline-size;font-size:13px;color:var(--dsw-alias-label-primary,currentColor);background:transparent;z-index:1}
/* The band is collapsed by the reader, never squeezed out by geometry: its own
   minimum wins over the Conversation's reservation (see maxMapWidth), so a
   cramped centre narrows the Conversation instead. The only geometry case left
   is a frame too narrow for the band's own minimum, where the band collapses
   itself and the Conversation header's 「展开对话树」 seat takes over. */
.cm-band-loading{display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:var(--dsw-alias-label-secondary,currentColor);pointer-events:auto}
/* The band's top bar is its own two-row chrome (leading row + space/search row),
   at a height the panel computes from the measured leading row — see
   bandHeaderHeight() in MapPanel.tsx. It keeps that height while the shipped
   header is the 40px blank one, so the band's chrome does not reflow when a
   blank Session opens or a Session starts: only the shipped header changes
   height, the band's own second row is always there. The rule under it is
   therefore always drawn, even on the blank landing page where the shipped
   header beside it has none — it separates the band's chrome from its columns,
   and the alternative (dropping it while the right side is blank) would make the
   chrome's own baseline appear and disappear. */
.cm-band-topbar{position:relative;flex:0 0 auto;display:flex;flex-direction:column;box-sizing:border-box;min-width:0;border-bottom:.5px solid var(--dsw-alias-border-l3,color-mix(in srgb,currentColor 14%,transparent));pointer-events:none}
/* The band/Conversation seam is one line for the band's whole height, and it is
   drawn by the resize handle itself (.cm-band-gutter::before, below). It used to
   be split in two: this header's ::after painted y=0..header, and the handle —
   which lived inside .cm-band-body — painted the rest. That made the visible line
   continuous but the *hit area* not: the top 40/76px of the seam was decoration
   over the product's Conversation root, so a press there resized nothing (and on
   macOS it dragged the window, because the top bar is the window-drag row). One
   element now owns both the line and the gesture. */
/* The first row keeps the shipped header's own geometry (offset/height measured
   from the live header), so the single switch is the same box in both views.
   It is also the only row that has to clear the macOS window chrome: that band
   of buttons reaches x=152 plus 8px of air, and only the first row's height
   (y=10..40) overlaps it, so the leading inset stays on this row alone.
   overflow:clip — not hidden — keeps a squeezed row from painting over the
   Conversation column without turning the row into a *scroll container*: a
   scroll container slides its content sideways the moment a child takes focus
   (measured: 48px, which pushed the space switcher off its seat). */
.cm-band-head-row{display:flex;align-items:center;gap:8px;flex:0 0 auto;height:var(--cm-band-head-height,30px);margin-top:var(--cm-band-head-top,10px);padding-left:var(--cm-band-inset,20px);padding-right:16px;min-width:0;overflow:clip;overflow-clip-margin:0;pointer-events:none}
.cm-band-head-row>*{pointer-events:auto}
/* The second row belongs to the node list below it, not to the window chrome.
   Its own small inset puts the space switcher's glyph on the same rail as the
   first column's folder icons (--cm-band-rail = .cm-col-scroll's 6px +
   .cm-node-row's 8px), so the row reads as the node list's own header line —
   and the switcher gets the row's whole width instead of the chrome's leftovers,
   which is why it no longer has to be hidden on a narrow band.
   The window-edge gutter below is part of the same rail: while the band owns
   the frame's left edge, both this row and the first column step right by it
   together, so the switcher keeps sitting on the list's own rail.
   The row is 28px but its contents are 24px and top-aligned: that leaves 4px of
   air above the seam, so the switcher stops reading as a tab glued to the column
   head right below it (measured before: the pill's bottom sat exactly on the
   seam, 0px above that head). */
.cm-band-row2{display:flex;align-items:flex-start;gap:8px;flex:0 0 auto;height:28px;margin-top:8px;padding-left:calc(var(--cm-band-rail,14px) - 8px + var(--cm-band-window-gutter,0px));padding-right:16px;min-width:0;overflow:clip;overflow-clip-margin:0;pointer-events:none}
.cm-band-row2>*{pointer-events:auto}
.cm-band-row2>.cm-crumb{flex:0 1 auto;max-width:100%}
/* Search shares this row, so it takes the same 24px — and border-box, because
   its 1px brand underline would otherwise hang 1px below the switcher and eat
   one of the four pixels of air (measured: 3px instead of 4). */
.cm-band-row2>.cm-band-search{height:24px;box-sizing:border-box}
.cm-band-row2>.cm-search{flex:1 1 auto;min-width:100px;max-width:none}
.cm-search{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:100px;max-width:520px;padding:0 10px;height:28px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 5%,transparent));border:1px solid var(--dsw-alias-border-l1,transparent)}
.cm-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12.5px}
/* Search is on demand: when it opens it occupies the header's second row as an
   inline field (no box), so the resting header keeps the shipped tab row's
   rhythm instead of carrying a permanent input. */
.cm-band-search{max-width:none;height:28px;padding:0 2px;border:0;border-radius:0;background:transparent;border-bottom:1.5px solid var(--dsw-alias-brand-primary,currentColor)}
.cm-band-search-hint{flex:none;font-size:10px;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-band-search-toggle[data-open="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 10%,transparent);color:var(--dsw-alias-brand-primary,currentColor)}
.cm-top-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto}
.cm-band-body{display:flex;flex:1 1 auto;min-height:0;min-width:0;position:relative;overflow:hidden;pointer-events:auto}
.cm-band{--cm-band-gutter-width:8px;--cm-band-rail:14px;--cm-band-window-gutter:0px}
/* The band's right edge, from y=0 to the bottom: one strip that is BOTH the
   seam's hairline and its hit area, for the band's whole height.
   It is a child of .cm-band, not of .cm-band-body, and that is the whole point.
   While it lived in the body it started at the shipped Conversation header's
   foot (40px blank / 76px with a Session), so the top of the seam — the part a
   reader aims at first, because it is the tallest uninterrupted run of the line
   on screen — painted a hairline with no gesture behind it. A press there
   resized nothing; on macOS it dragged the *window*, because the band's top bar
   is the shell's window-drag row. The seam now starts where it is drawn.
   -webkit-app-region:no-drag is required, not decorative: the top bar above
   declares drag over the same strip, Electron composes app-regions in document
   order with the last box winning, and this element comes after it — the same
   construction the sibling workbench band uses for its own edge. Without the
   declaration the strip would keep dragging the window and the handle would stay
   dead exactly where the reader complains it is. */
.cm-band-gutter{position:absolute;top:0;right:0;bottom:0;width:var(--cm-band-gutter-width);cursor:col-resize;touch-action:none;z-index:6;pointer-events:auto;-webkit-app-region:no-drag}
/* One construction for the whole line: placed by its right offset so it keeps a
   single x at every device pixel row. (The old left:50% + translateX(-50%)
   resolved to the same box but painted one device px apart from the header's
   rule at fractional device pixels, which read as the seam breaking at the
   header's foot.) */
.cm-band-gutter::before{content:'';position:absolute;top:0;bottom:0;right:calc(var(--cm-band-gutter-width,8px) / 2 - .5px);width:1px;background:var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 22%,transparent))}
/* Hover and drag keep that hairline as it is, and the handle paints nothing at
   all. A full-height grab bar must not be painted here: the only "brand" token
   the theme defines for a fill is --dsw-alias-brand-primary, and in the light
   theme it resolves to the ink colour (--dsw-alias-label-primary, #0f1115), so
   aiming at the handle drew a hard black line down the middle of the window.
   The shipped handles do not do that either — the Conversation's own width
   handle reveals only a short grip next to the pointer — and they state no
   width readout: no handle in the product paints a number, so this one does
   not either. The seam stays one quiet hairline, the cursor carries the
   affordance, and the width reaches assistive technology through the
   separator's aria value. */
/* Not enough centre for both columns (a right Sidebar on a narrow frame): the
   band falls back to covering the whole centre, and the first strip stays
   transparent so the shell's macOS window-chrome controls remain visible and
   clickable above the native header behind. */

/* The overlay layer is click-through; the band's menus and dialogs are not. */
.cm-band .cm-backdrop,.cm-band .cm-menu,.cm-band .cm-dialog{pointer-events:auto}
/* The band gets narrow when a right Sidebar is open or the window is small.
   The space entry never hides: the breadcrumb sits in the second row, whose
   whole width is available to it, so it survives down to the band's own floor
   (MIN_MAP_WIDTH = 320px; below MIN_CENTRE_FOR_BAND the band collapses itself).
   Past its floor the current segment's label ellipsizes and its status cluster
   gives way first (see spaceBreadcrumbDensities), so the reader can always see
   and change the space. Only the search field folds, and only the field — never
   its row — so the band's header keeps its 76px and the two headers still meet
   on one seam. */
@container (max-width: 360px){.cm-band .cm-band-row2 .cm-band-search{display:none}.cm-band .cm-band-refresh{display:none}}

/* The product DOM did not provide a measurable Conversation column: the band
   cannot be placed, so the only thing on screen is an exit from map mode (the
   product left column may be fully hidden on macOS). */
.cm-band-unavailable{position:fixed;left:16px;top:16px;z-index:30;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 16%,transparent));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-secondary,currentColor);font-size:12px;box-shadow:0 8px 24px color-mix(in srgb,currentColor 14%,transparent)}

/* ── node area ─────────────────────────────────────────────────────────── */
/* The strip is transparent: the gray fill is painted by its frame
   (.cm-band-main, below) for two reasons.
   The fill has to stop half a hairline short of the seam — the divider sits
   half the handle's width minus half a hairline in from the band's right edge,
   so the frame keeps a trailing margin of half the handle's width plus half a
   hairline, and the fill ends exactly at the line's left edge. The divider then
   separates gray from the Conversation's white on its own two sides — the
   relationship the shipped column has with its own border — instead of leaving
   a sliver of fill to the right of it. Reserving the strip narrows nothing a
   reader sees: it was empty fill to begin with.
   And the strip fades its start side while columns are scrolled out of view
   (below); a mask also fades the masked element's own background, so the fill
   behind it has to come from an ancestor or the fade would open a slot onto
   the Conversation's white at the window edge. */
.cm-node-area{display:flex;flex:1 1 auto;min-width:0;min-height:0;overflow-x:auto;overflow-y:hidden}
/* The start side while columns are scrolled out of view there: a scroll cut is
   not a list edge, so it gets the shell's own overflow language — a masked fade
   — rather than a private padding. 24px is the shell's horizontal-strip fade
   (ui-dockkit's STRIP_FADE; the session rows' clipped titles use 12px because
   they fade a text run, this fades a column). The resting window-edge gutter
   above stays where it is: it belongs to the first column's content and scrolls
   out of view with it, which is exactly what makes the cut legible as a cut.
   The end side is deliberately not faded: its cut lands on the band's seam,
   where the hairline and the resize handle already state the boundary. */
.cm-node-area[data-scrolled="true"]{mask-image:linear-gradient(to right,transparent 0,#000 24px)}
/* Dragging owns both edges: the auto-scroll bands and the insertion line are
   aiming surfaces, so the fade steps aside while a row is in flight. */
.cm-node-area[data-scrolled="true"][data-drag="true"]{mask-image:none}

/* ── one node column ───────────────────────────────────────────────────── */
.cm-node-col{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;max-width:720px;overflow:hidden;border-right:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 12%,transparent));background:var(--dsw-specific-sidebar-fill,transparent)}
.cm-col-head{display:flex;align-items:center;justify-content:space-between;gap:6px;height:32px;box-sizing:border-box;padding:0 8px;flex:0 0 auto}
.cm-col-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-col-actions{display:flex;gap:4px;flex:0 0 auto}
.cm-col-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 6px 12px;display:flex;flex-direction:column}
/* ── the window-edge gutter ────────────────────────────────────────────── */
/* Map mode always collapses the product's left column, so on macOS and Windows
   desktop the band's left edge IS the frame's left edge — the band stands
   exactly where the shell's sidebar stood, and it is the only column whose left
   side is a window boundary. It used to bring only its own in-column inset
   (6px pill inset + 8px row padding = a 14px icon rail), which is measured from
   a *seam* and is right for every later column, but reads cramped against the
   window: the shell sidebar spends 12px of window padding
   (--dsh-sidebar-inline-padding) before the same 8px row inset, i.e. a 20px
   icon rail. Collapsing the sidebar took those 12px away with it, which is what
   left the first column hugging the screen edge.
   So while — and only while — the band owns the frame edge, its first column
   pays the missing window padding (--cm-band-window-gutter, set from the
   measured frame.left; 0 in every other state). The 6px value is not a new
   rhythm: the column's own 6px pill inset plus 6px completes the sidebar's
   12px, so the pills land at 12px, the icon rail at 20px and the titles at 42px
   — the product's own Workspace-list rails. The second row above moves by the
   same amount so the space switcher stays on that rail.
   It is padding, not a margin: the gray fill keeps reaching the frame edge
   (the band, like the sidebar it replaces, is an edge-attached strip), and the
   column's outer width is untouched, so no column is narrowed and no horizontal
   scrollbar appears.
   Scoped with :first-child inside .cm-band on purpose: every later column's
   left edge is a column seam, and the panels/dialogs live outside this
   contract. */
.cm-band .cm-node-col:first-child .cm-col-head{padding-left:calc(8px + var(--cm-band-window-gutter,0px))}
.cm-band .cm-node-col:first-child .cm-col-scroll{padding-left:calc(6px + var(--cm-band-window-gutter,0px))}
.cm-band .cm-node-col:first-child .cm-col-footer{padding-left:calc(6px + var(--cm-band-window-gutter,0px))}

/* ── node rows and their conversations ─────────────────────────────────── */
/* Geometry follows the application's own workspace list: a 34px node row over
   32px conversation rows, a 16px leading slot, and one soft hover fill. What
   separates the two kinds of row is the folder, the indent, and the colour.

   The marks answer two different questions and never compete:
   - "which branch does the conversation I am reading live under?" — the home
     node and every container above it (the Workspace row and ancestor topics,
     (data-session-path) carry a filled brand folder and the bold title. The
     chain is permanent: it is the same wherever the navigation cursor points,
     so a reader returning to the tree always sees where the live conversation
     lives, even when its own column is not rendered.
   - "where did I just click?" — the selected row draws a 1.5px inset outline
     (62% brand) and the bold title. A row that is both selected and on the
     home chain shows the chain style, not the outline: the chain is the
     stronger, always-on statement, and the open conversation row itself already
     says "you are reading this".
   The conversation being read keeps the panel's only brand fill (16%, below).
   The brand token equals the row's own ink, so a colour rule on a
   node row paints nothing: the chain has to be stated through the icon fill and
   the weight, and the selection through the inset geometry. Hover is the
   quietest state and never repaints a selected row or a chain row. */
.cm-node-row{display:flex;align-items:center;gap:6px;height:34px;box-sizing:border-box;padding:0 8px;border-radius:var(--dsw-radius-md,12px);cursor:pointer;user-select:none;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,currentColor)}
.cm-node-row[data-selectable="false"]{cursor:default}
.cm-node-row:hover:not([data-selected="true"]):not([data-session-path="true"]):not([data-selectable="false"]),.cm-node-row[data-menu="true"]:not([data-selected="true"]):not([data-session-path="true"]):not([data-selectable="false"]){background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cm-node-row[data-selected="true"]:not([data-session-path="true"]){background:transparent;color:var(--dsw-alias-brand-primary,currentColor);font-weight:600;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 62%,transparent)}
.cm-node-row[data-selected="true"] .cm-slot{color:inherit}
.cm-slot{flex:none;width:16px;height:20px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-row-icon{width:16px;height:16px}
.cm-folder{display:inline-flex}
/* Leading slot: folder at rest, fold arrow only while the row is hovered.
   The rules are scoped under .cm-node-row so they outrank the shared
   .cm-icon-btn display, which would otherwise keep the arrow visible. */
.cm-node-row .cm-chevron{display:none}
.cm-node-row:hover .cm-chevron,.cm-node-row[data-menu="true"] .cm-chevron{display:inline-flex}
.cm-node-row:hover .cm-folder,.cm-node-row[data-menu="true"] .cm-folder{display:none}
.cm-fold{width:16px;height:16px;transition:transform 150ms ease}
.cm-chevron[data-open="true"] .cm-fold{transform:rotate(90deg)}
/* Same leading geometry as a node row, so a conversation title lines up with the
   node title above it and the row spends no width on an extra indent. */
.cm-thread-row{display:flex;align-items:center;gap:6px;height:32px;box-sizing:border-box;padding:0 8px;border-radius:var(--dsw-radius-md,12px);cursor:pointer;user-select:none;font-size:14px;line-height:20px;color:var(--dsw-alias-label-secondary,currentColor)}
.cm-thread-row:hover:not([data-selected="true"]),.cm-thread-row[data-menu="true"]:not([data-selected="true"]){background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent));color:var(--dsw-alias-label-primary,currentColor)}
/* The open conversation is what the reader is actually reading, so it is the
   heaviest mark in the panel: a solid brand tint, brand text, and a quiet age.
   It deliberately adds no leading bar: the tint is the column's only brand fill,
   and the old 2px x 18px stub at the row's left edge read as a text caret next
   to the title — the owner cut it on sight. The fill, the ink and the weight
   are the whole mark. */
.cm-thread-row[data-selected="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 16%,transparent);color:var(--dsw-alias-brand-primary,currentColor);font-weight:500}
.cm-thread-row[data-selected="true"] .cm-ring{color:inherit}
.cm-thread-row[data-selected="true"] .cm-time,.cm-thread-row[data-selected="true"] .cm-compact{color:inherit;opacity:.72}
.cm-row-labels{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}
.cm-row-label{flex:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The search view's second line: where a hit lives, or why it matched. Rows
   carrying one grow just enough to keep the title and the line apart — ordinary
   rows never opt in, so the map's 34/32px rhythm is unchanged. */
.cm-row-note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;font-weight:400;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-input-note{font-style:normal}
.cm-node-row[data-note="true"],.cm-thread-row[data-note="true"]{height:auto;min-height:34px;padding-top:3px;padding-bottom:3px}
.cm-thread-row[data-note="true"]{min-height:32px}
.cm-node-row[data-selected="true"] .cm-row-note,
.cm-thread-row[data-selected="true"] .cm-row-note{color:inherit;opacity:.72}
/* ── the clipped-title tip ─────────────────────────────────────────────── */
/* A row title is one ellipsized line, and the row a reader points at narrows
   again (hover surfaces the actions), so the row under the pointer is exactly
   where the full title cannot be read. RowTitleTip measures the label while the
   row is hovered and shows this bubble only when it really clips.
   The surface is the product's own tooltip: the same --dsw-alias-tooltip-bg
   ink-on-light step, 13/20 type and 150ms fade as the design system's Tooltip,
   so a plugin tip and a shell tip read as one language. It is portaled under
   <body> (the column scroller clips, and the band's container-type is a
   containing block for fixed descendants), which is why the portal layer's
   z-index — the design system's portaled tooltip value, 1100 — is stated here.
   visibility:hidden until RowTitleTip has measured and placed it; the element
   never takes the pointer, because the bubble opens under the row the reader is
   already on. max-width caps by the window as well as by text length, so a
   long path wraps inside the viewport instead of running past its edge. */
.cm-tip{position:fixed;left:0;top:0;z-index:1100;width:max-content;max-width:min(420px,calc(100vw - 24px));padding:3px 7px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-tooltip-bg,#2c2c2e);color:var(--dsw-static-neutral-bluish-00,#fff);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;visibility:hidden;pointer-events:none;animation:cm-tip-in 150ms var(--ds-ease-in-out,ease)}
@keyframes cm-tip-in{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.cm-tip{animation:none}}
.cm-search-context{color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-search-mark{background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 20%,transparent);color:inherit;border-radius:3px;padding:0 1px;font-weight:500}
/* The search view's keyboard cursor: a ring, never a heavier selected mark, so
   the open conversation/selected row keeps its own weight. */
.cm-node-row[data-search-active="true"],.cm-thread-row[data-search-active="true"]{outline:1.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 55%,transparent);outline-offset:-1px}
/* The cursor's wash is spent only on rows that carry no other fill: the
   selected node and the open conversation keep the single surface the map
   allows them, and the cursor is still stated by the outline above. */
.cm-node-row[data-search-active="true"]:not([data-selected="true"]),.cm-thread-row[data-search-active="true"]:not([data-selected="true"]){background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 9%,transparent)}
/* The descendant count keeps the trailing slot only while the row has nothing
   to report. A row that draws a status rollup drops it — the badge takes the
   slot (see showsStatusRollup in Columns.tsx) — and hover hides it too, because
   the row's actions land in that same corner. */
.cm-child-count{flex:none;padding:0 2px;font-size:11px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums}
/* The count yields to the hover actions on ordinary rows; the archive row has no
   actions, so its count is the row's only trailing content and stays. */
.cm-node-row:hover:not([data-kind="archive"]) .cm-child-count{display:none}
/* ── node status rollups ─────────────────────────────────────────────────── */
/* A row's conversations plus every descendant's, by category. The badge is
   read-only: no click, no popover, no hover card. Counts use the theme's state
   tokens so light/dark follow the product; the fresh halo only says "a number
   just moved" and never changes what is counted. */
.cm-rollup{flex:none;display:inline-flex;align-items:center;gap:4px;padding:2px;border-radius:6px;color:var(--dsw-alias-label-secondary,currentColor);font-size:10px;line-height:1;font-variant-numeric:tabular-nums}
.cm-rollup-stat{display:inline-flex;align-items:center;gap:2px}
.cm-rollup-count{font-weight:600}
.cm-rollup-dot{width:7px;height:7px;border-radius:50%;flex:none;display:block;background:var(--dsw-alias-label-tertiary,currentColor)}
.cm-rollup-dot[data-cat="pending"]{background:var(--dsw-alias-state-warn-primary,#d98a0b)}
.cm-rollup-dot[data-cat="error"]{background:var(--dsw-alias-state-error-primary,#e5484d)}
.cm-rollup-dot[data-cat="done"]{background:var(--dsw-alias-state-success-primary,#1f9d63)}
.cm-rollup-ring{width:9px;height:9px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,currentColor) 35%,transparent);border-top-color:var(--dsw-alias-label-tertiary,currentColor);flex:none;display:block;animation:cm-status-spin 1.5s linear infinite}
.cm-rollup-dots{gap:3px;padding:2px 1px}
.cm-rollup-dots .cm-rollup-dot{width:8px;height:8px}
.cm-rollup-dots .cm-rollup-ring{width:10px;height:10px}
.cm-rollup[data-fresh]{box-shadow:0 0 0 3px var(--cm-rollup-halo,transparent);animation:cm-rollup-fresh 1.4s ease-out 2}
.cm-rollup[data-fresh="pending"]{--cm-rollup-halo:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d98a0b) 16%,transparent)}
.cm-rollup[data-fresh="error"]{--cm-rollup-halo:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 16%,transparent)}
.cm-rollup[data-fresh="done"]{--cm-rollup-halo:color-mix(in srgb,var(--dsw-alias-state-success-primary,#1f9d63) 16%,transparent)}
@keyframes cm-status-spin{to{transform:rotate(360deg)}}
@keyframes cm-rollup-fresh{0%{box-shadow:0 0 0 0 var(--cm-rollup-halo,transparent)}70%{box-shadow:0 0 0 4px transparent}100%{box-shadow:0 0 0 3px var(--cm-rollup-halo,transparent)}}
@media (prefers-reduced-motion:reduce){.cm-rollup-ring{animation:none}.cm-rollup[data-fresh]{animation:none}}

.cm-time{flex:none;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor)}
/* Solid state marks: the application's done and warning dots (10px box, a 6px
   currentColor core) so the map never draws a status the shipped list would not. */
.cm-state-dot{position:relative;display:inline-block;flex:none;width:10px;height:10px}
.cm-state-dot::after{content:'';position:absolute;inset:20%;border-radius:50%;background:currentColor}
.cm-state-dot[data-state="done"]{color:var(--dsw-alias-state-success-primary,currentColor)}
.cm-state-dot[data-state="warning"]{color:var(--dsw-alias-state-warn-primary,currentColor)}
/* A pending request states itself in place of the age, as the shipped row does. */
.cm-compact{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor)}

/* Running indicator: the application's ring, at its own 1.5s period. */
.cm-ring{flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-ring-motion{transform-origin:center;animation:dsh-conversation-tree-spin 1.5s linear infinite}
.cm-ring-track,.cm-ring-arc{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.cm-ring-track{opacity:.25}
.cm-ring-arc{stroke-dasharray:12 150;animation:dsh-conversation-tree-dash 1.5s ease-in-out infinite}
@keyframes dsh-conversation-tree-spin{to{transform:rotate(360deg)}}
@keyframes dsh-conversation-tree-dash{0%{stroke-dasharray:12 150;stroke-dashoffset:0}50%{stroke-dasharray:24 150;stroke-dashoffset:-6}100%{stroke-dasharray:12 150;stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.cm-ring-motion,.cm-ring-arc{animation:none}.cm-ring-arc{stroke-dasharray:18 150;stroke-dashoffset:-3}}
/* Trailing actions surface on hover, replacing the time exactly as the
   application's own session rows do. */
.cm-row-actions{flex:none;display:none;align-items:center;gap:10px}
.cm-node-row:hover .cm-row-actions,.cm-node-row[data-menu="true"] .cm-row-actions,
.cm-thread-row:hover .cm-row-actions,.cm-thread-row[data-menu="true"] .cm-row-actions{display:inline-flex}
/* The age yields only to actions that actually exist: a conversation whose menu
   is suppressed (inside an archived block) keeps its age while hovered. */
.cm-thread-row:hover:has(.cm-row-actions) .cm-time,
.cm-thread-row[data-menu="true"]:has(.cm-row-actions) .cm-time{display:none}
.cm-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,currentColor);cursor:pointer}
.cm-icon-btn:hover{color:var(--dsw-alias-label-primary,currentColor)}
.cm-glyph{width:16px;height:16px}
.cm-more-row{font:inherit;font-size:12px;text-align:start;padding:6px 8px 6px 30px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,currentColor);cursor:pointer}
.cm-more-row:hover{color:var(--dsw-alias-label-primary,currentColor)}

/* ── the archive door and the pinned column footer ────────────────────── */
/* 「已归档」 is a door, not a topic. It is pinned as the column's footer, outside
   the column scroller: it never scrolls away, and the drag hit test (which
   measures drop targets through that scroller) cannot read the strip as the
   column's blank tail. Its ink is one step quieter than a topic row's — a
   storage box instead of a folder — and it has no hover actions, so its count is
   the row's only trailing content. Colors are the product's own tokens, so both
   themes follow without a second palette. */
.cm-col-footer{flex:0 0 auto;padding:0 6px 8px;background:var(--dsw-specific-sidebar-fill,transparent);border-top:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 12%,transparent))}
.cm-node-row[data-kind="archive"]{color:var(--dsw-alias-label-secondary,currentColor);font-weight:500}
.cm-node-row[data-kind="archive"] .cm-slot{color:var(--dsw-alias-label-tertiary,currentColor)}
/* The archive row's one live mark sits ahead of the count: the same running ring
   and warning dot a conversation row draws, in a slot that keeps the count's
   right edge still when the mark appears. */
.cm-row-activity{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}


/* The band body stacks the node strip and nothing else: the selected-node
   information bar that used to dock at its bottom was removed, so the strip
   takes the whole height. The gray fill lives here rather than on the strip
   because the strip's start fade masks it (see the node-area block above), and
   the trailing margin is the seam reservation that keeps the fill's right edge
   half a handle's width plus half a hairline short of the band's own edge. */
.cm-band-main{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;margin-right:calc(var(--cm-band-gutter-width,8px) / 2 + .5px);background:var(--dsw-specific-sidebar-fill,color-mix(in srgb,currentColor 3%,transparent))}

/* ── column and region resize handles ──────────────────────────────────── */
/* ── resize handles ────────────────────────────────────────────────────── */
.cm-gutter{position:relative;flex:0 0 6px;cursor:col-resize;background:transparent;touch-action:none}
/* The column boundary is the node column's own hairline (border-right above), so
   the handle adds no line of its own and no readout: the columns' edges stay the
   only verticals on screen, and the width reaches assistive technology through
   the separator's aria value instead of a painted pill. (A brand-coloured bar
   would be black in the light theme — see the band handle.) */

/* ── menus and the node dialog ─────────────────────────────────────────── */
/* One capture layer serves four surfaces — the three menus and the dialog — but
   only the dialog presses the page back: a menu is a popover, the reader may
   still read and click what is behind it, so the bare layer keeps no paint at
   all and the dimming lives on the modifier instead. The scrim is the product's
   own bg-mask-1 step (darker in the dark theme) rather than a mix of the
   plugin's ink, which is what made the old spread ring *brighten* the page in
   the dark theme. No backdrop-filter: the product's mask blur is none, and a
   plugin overlay must not blur where the shell's own mask does not.

   -webkit-app-region:no-drag is required, not decorative. The band's top bar is
   the shell's window-drag row (data-window-drag), and Electron hands those
   boxes to the native window: a press inside one is a title-bar press, so no
   mouse event ever reaches the page. Without this declaration a click on the
   top bar's blank runs — exactly where the reader reaches to dismiss an open
   space list — never reaches this layer's onClick, and the popover stays open
   (measured in .probe/click-dismiss/: the composed app-region box at that point
   is the top bar's drag box while the DOM hit test finds this layer).
   Electron composes app-regions in document order with the last box winning,
   and this layer comes after the top bar and after the Conversation header
   (shell.overlay renders after the centre column), so one declaration
   subtracts every drag strip underneath it for exactly the lifetime of the
   layer — only while a menu or a dialog is open. Same construction as the band
   gutter's declared no-drag above. */
.cm-backdrop{position:fixed;inset:0;z-index:40;-webkit-app-region:no-drag}
.cm-backdrop--dialog{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24))}
.cm-menu{position:fixed;z-index:41;min-width:158px;padding:4px;border-radius:9px;display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 16%,transparent));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));box-shadow:0 8px 24px color-mix(in srgb,currentColor 16%,transparent)}
.cm-menu-item{font:inherit;font-size:12px;text-align:left;padding:6px 9px;border-radius:6px;border:0;background:transparent;color:inherit;cursor:pointer}
.cm-menu-item:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.cm-menu-item[data-danger="true"]{color:var(--dsw-alias-state-error-primary,#d9534f)}
.cm-menu-note{font-size:11px;line-height:1.5;padding:6px 9px;color:var(--dsw-alias-label-secondary,currentColor)}
/* Ten dialog kinds, one geometry. Centred, so the reader's eye stays on the same
   spot while a form's height changes; capped, so a long one (the move tree, an
   error list) cannot run past the window's bottom edge. The width is the plain
   form's 420px — of the ten, only the move dialog widens. The cap is stated here
   as the dialog's own bound, but the scrolling belongs to the card below: a
   scroll container clips the ink of everything inside it, and the elevation the
   card wears is exactly that kind of ink. */
.cm-dialog{position:fixed;z-index:41;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,88vw);max-height:min(86vh,640px)}

/* ── shared controls ───────────────────────────────────────────────────── */
.cm-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;cursor:pointer;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 22%,transparent));white-space:nowrap}
.cm-btn-glyph{display:inline-flex;width:13px;height:13px;flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-btn-glyph svg{width:13px;height:13px}
/* The map's top bar shares the centre column with the native right column; when
   that column is open the centre gets narrow, so action labels fold into icons
   (title/aria-label keep the wording) instead of wrapping the bar. */
@container (max-width: 980px){.cm-top-actions .cm-btn-label{display:none}.cm-top-actions .cm-btn{padding:5px 8px}}
.cm-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.cm-btn:disabled{opacity:.55;cursor:default}
.cm-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary,currentColor);border-color:var(--dsw-alias-brand-primary,currentColor);color:#fff}
.cm-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary,#d9534f);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d9534f) 45%,transparent)}
/* The card wears the host Modal's own recipe instead of an approximation of it:
   border:0, because --dsw-elevation-prominent already draws a 0.5px stroke
   ring and the old 1px border on top of it would read as a double edge; the
   prominent elevation for the lift; and layer-2 as the fill, which is the layer
   the shell's own modal sits on. In the light theme layer-1 and layer-2 are both
   pure white, so the swap changes nothing there — it is what makes the dark theme
   agree with the product. This class has exactly one use in the plugin, the
   dialog's card, so one skin now covers all ten dialogs. The card is also where
   the cap and the scroll live, rather than the dialog around it: a scroll
   container clips the ink of its descendants at its own edge, and the card fills
   the dialog exactly, so a scrolling dialog would clip the stroke ring and the
   glow away entirely — while no box is ever clipped by its own overflow. */
.cm-card{border:0;border-radius:var(--dsw-radius-md,12px);padding:16px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));max-height:min(86vh,640px);overflow:auto;box-shadow:var(--dsw-elevation-prominent,0 0 0 .5px color-mix(in srgb,currentColor 16%,transparent),0 3px 8px rgba(0,0,0,.04),0 0 20px rgba(0,0,0,.05))}
/* The title is the card's one hierarchy marker: a step up from body copy in size
   and weight, tight enough to open a form rather than a page. */
.cm-card h3{margin:0;font-size:15px;font-weight:650;letter-spacing:.01em}
.cm-field{display:flex;flex-direction:column;gap:4px}
.cm-field label{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor)}
.cm-field-row{display:flex;gap:6px;align-items:center}
.cm-field-row .cm-input{flex:1;min-width:0}
/* Dialog copy: quiet explanatory text inside the card. The one-time discovery
   pill beside the seat is .cm-seat-hint — the two rules shared this name once,
   and the pill's absolute placement leaked into every dialog's body copy. */
.cm-hint{margin:0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary,currentColor)}
/* The one lead sentence of a confirmation, one step above the body copy, so the
   question reads before the consequences below it. */
.cm-dialog-lead{margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,currentColor)}
/* Consequences of a destructive action, gathered in one quiet box: the counts
   and the conversation promise must not read as loose asides. */
.cm-dialog-notes{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 12%,transparent));background:var(--dsw-alias-bg-layer-1,color-mix(in srgb,currentColor 3%,transparent))}
.cm-input,.cm-select,.cm-textarea{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 5%,transparent));border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 18%,transparent));border-radius:8px;padding:6px 8px;width:100%;box-sizing:border-box}
.cm-textarea{min-height:56px;resize:vertical}
.cm-toolbar{display:flex;flex-wrap:wrap;gap:6px}
.cm-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#d9534f)}
.cm-field-error{margin:0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#d9534f)}
/* The create dialog's location rail. Every entry point already named the
   parent, so the dialog states where the node will land instead of offering a
   picker: the root and parent stay visible, older ancestors collapse into …
   when the 420px card cannot fit them. The rail is read-only and never enters
   the Tab order; assistive tech reads it through its aria-label. */
.cm-loc-field{display:flex;flex-direction:column;gap:4px}
.cm-loc-label{font-size:11px;color:var(--dsw-alias-label-secondary,currentColor)}
.cm-loc-rail{display:flex;align-items:center;gap:6px;min-width:0;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 10%,transparent));background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 4%,transparent))}
.cm-loc-crumbs{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}
.cm-loc-crumb{min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
.cm-loc-crumb.is-root{flex:none;max-width:130px;display:inline-flex;align-items:center;gap:5px}
.cm-loc-folder{width:13px;height:13px;flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-loc-crumb.is-parent{color:var(--dsw-alias-label-primary,currentColor);font-weight:500}
.cm-loc-sep{flex:none;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.7}
.cm-loc-more{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,currentColor);cursor:help}
.cm-pane-empty{margin:auto;font-size:12px;color:var(--dsw-alias-label-secondary,currentColor);text-align:center;padding:20px;line-height:1.6}

/* ── space switcher ────────────────────────────────────────────────────── */
/* The space the reader is in, one click from anywhere. It leads the band's
   second row, and names itself in the roomy 32px box that row 1 would have
   given it — the row-2 variant below trims that to the row's own 28px rhythm.
   The name ellipsizes instead of pushing anything, and the box has a floor so
   the two glyphs survive even when the label has been squeezed to nothing:
   the switcher shrinks, it never disappears. */
.cm-space-btn{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:62px;max-width:180px;height:32px;padding:0 9px;border-radius:9px;cursor:pointer;color:inherit;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 5%,transparent));border:1px solid var(--dsw-alias-border-l1,transparent)}
/* In the second row the pill takes that row's rhythm, and its inset is what
   lands the glyph on the node list's rail: row inset (rail − 8) + 1px border +
   padding (rail − 7) = rail, i.e. 6 + 1 + 7 = 14px, the same x as every
   workspace folder icon below. The 58px floor (7+1+16+6+6+14+1+7) keeps the
   layers glyph and the chevron whole once the label is gone.
   It rests as a ghost — no fill, no visible border — so the row reads as a
   context label instead of a solid block sitting on the column head; the fill
   and the border come back on hover and while the space menu is open, which is
   where the affordance is actually needed. The name carries 500 so it still
   reads as a label rather than as body text. */
.cm-band-row2 .cm-space-btn{height:24px;min-width:58px;padding:0 calc(var(--cm-band-rail,14px) - 7px);border-radius:8px;font-size:12.5px;font-weight:500;background:transparent;border-color:transparent}
/* The entry carries the active space's status cluster so the reader can compare
   it with the sidebar row's whole-map count; the search field shares that row
   when it opens, so the counts give way instead of squeezing the chrome
   controls — the menu still lists every space's numbers. */
@supports selector(:has(*)){
  /* The search field takes the row; both breadcrumb segments drop their clusters
     together (the root is inside .cm-crumb too, so one descendant selector covers
     the whole entry). A half state — root cluster kept, current cluster gone —
     would read as a different total and is never intentional. */
  .cm-band-row2:has(.cm-search) .cm-crumb .cm-rollup{display:none}
}
/* The fill that comes back is the product's own hover state, not the resting
   surface token: --dsw-alias-bg-layer-2 resolves to an *opaque* surface (white
   in the light theme), so painting it on a white header read as no change at all
   (measured across the pill: 10/255, its centre pixel unchanged). The interactive
   token is the state colour the shipped lists use, and its fallback — a 7%
   currentColor tint — stays visible on either theme. */
.cm-band-row2 .cm-space-btn:hover,
.cm-band-row2 .cm-space-btn[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent));border-color:var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 18%,transparent))}
.cm-space-btn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cm-space-btn .cm-glyph,.cm-space-btn .cm-chevron-glyph{flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-chevron-glyph{width:14px;height:14px}
.cm-space-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The space breadcrumb is one control: the whole bar is a single .cm-space-btn,
   so every pixel — including the whole-map count after 「全部空间」 — opens the
   space menu. No segment is a dead zone and there is never a question of which
   part is the dropdown; the chevron appears once, at the row's end. The menu
   anchors to the bar's left edge, so its position is stable however far right the
   reader clicks. Only the current space's name shrinks; the root label, the
   separator, both clusters and the chevron stay whole. */
.cm-crumb{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:100%}
.cm-crumb-root{display:inline-flex;align-items:center;gap:6px;flex:none;color:var(--dsw-alias-label-secondary,currentColor);font-weight:500;white-space:nowrap}
.cm-crumb-root .cm-glyph{flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-crumb-root-label{white-space:nowrap}
.cm-crumb-sep{flex:none;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-crumb-current{display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;font-weight:600;color:var(--dsw-alias-label-primary,currentColor)}
.cm-crumb-current .cm-space-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-crumb-current .cm-rollup{flex:none}
.cm-space-menu{min-width:230px;max-width:320px}
.cm-space-row{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;cursor:pointer;user-select:none;font-size:12px;line-height:16px}
.cm-space-row:hover,.cm-space-row:focus-visible{background:color-mix(in srgb,currentColor 8%,transparent);outline:none}
.cm-space-row[data-active="true"]{color:var(--dsw-alias-brand-primary,currentColor);font-weight:600}
.cm-space-check{flex:none;width:12px;text-align:center;color:var(--dsw-alias-brand-primary,currentColor)}
.cm-space-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-space-count{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums}
.cm-space-row-menu{display:none;flex:none}
.cm-space-row:hover .cm-space-row-menu,.cm-space-row:focus-within .cm-space-row-menu{display:inline-flex}
.cm-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 12%,transparent))}
/* An empty space (or another non-interactive placeholder) inside a column. */
.cm-hint-row{padding:8px 8px 8px 30px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,currentColor)}
/* Rows that are containers rather than destinations (the ungrouped row). */
.cm-node-row[data-selectable="false"]{cursor:default}

/* ── view control: one box, one action ─────────────────────────────────── */
/* The switch is not a tab pair: it never reports the current view. Its wording
   follows the direction that is actually true — 「对话树」 while the shipped
   Conversation is on screen (the band is genuinely absent, so it is a
   destination), 「收起」 while the band is on screen (the Conversation keeps
   rendering to the band's right, so the click removes the band). Both
   occurrences are the same component in the same 28px box at the content
   header's leading edge, so flipping the view changes the glyph and wording but
   never the position; both visible labels are two characters wide. That contract
   covers the labelled pill; the band-side occurrence is now the icon-only
   variant below, which keeps the same left edge, accessible name and click, and
   gives the label's width back to its row. */
.cm-view-toggle{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;height:28px;min-width:70px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 22%,transparent));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,currentColor);font:inherit;font-size:12.5px;line-height:1;cursor:pointer;white-space:nowrap}
.cm-view-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cm-view-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}
/* The band-side occurrence is the same control as a bare icon box, not a pill:
   it leads a row of 28px chrome controls (the shell's own seat buttons sit 8px
   to its left), so it takes that row's box — no frame, no label, radius-sm, the
   chrome's own secondary ink and hover fill only. Only the box changes: the
   accessible name, title and data-target are untouched (ViewToggle.tsx). */
.cm-view-toggle--icon{min-width:0;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,currentColor)}
.cm-view-toggle--icon:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 6%,transparent))}
/* The pill inks its glyph with label-tertiary; in the icon box the glyph *is*
   the control, so it takes the box's label-secondary — the same ink the shell's
   seat buttons use next to it. */
.cm-view-toggle--icon .cm-view-toggle-glyph{color:inherit}
.cm-view-toggle-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.cm-view-toggle-label{overflow:hidden;text-overflow:ellipsis}
/* The Conversation-header seat clears the macOS window-chrome band exactly like
   the product's title row does; the band measures the same clearance itself. */
.cm-view-toggle-seat{position:relative;display:inline-flex;align-items:center;flex:0 0 auto;margin-inline-start:max(0px,calc(var(--dsh-frame-leading-clearance,0px) - 20px))}

/* The one-time discovery hint: a quiet pill beside the icon-only expand seat.
   It is decorative (the button already carries the name), never takes pointer
   events, and disappears for good after the reader interacts with it or the
   timer runs out. Its own class keeps the absolute placement out of .cm-hint,
   which is the dialogs' body copy. */
.cm-seat-hint{position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);z-index:6;display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 18%,transparent));box-shadow:0 6px 18px -10px rgba(16,22,34,.45);font-size:11.5px;line-height:1;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap;pointer-events:none}

/* The sidebar panel row's glyph (the sidebar.panellist row, 「对话树」).
   The shell owns the row: full-width button, hover fill, label in the wide
   sidebar and a tooltip in the 56px rail, plus its native selected state. Band
   mode never selects a main panel, so the "in use" reading has to come from the
   plugin: the glyph fills and takes the brand ink while the band is on screen.
   That shape/ink change is the only marker (a corner dot would sit next to the
   always-present status cluster and read as one of its counts). */
.cm-panel-glyph{position:relative;display:inline-flex;align-items:center;justify-content:center;color:inherit}
.cm-panel-glyph[data-in-use="true"]{color:var(--dsw-alias-brand-primary,currentColor)}
/* The sidebar row's status cluster (「对话树」): the same mark a node row draws
   — one dot plus count per non-empty category — instead of a badge on the 16px
   glyph. The shell owns the row and the plugin renders inside the glyph cell, so
   the cluster is taken out of that cell: while it is present the row itself
   becomes the containing block and the cell goes static, which lands the cluster
   on the row's trailing edge, clear of both the map mark and the label. Engines
   without :has() keep the cluster hidden rather than misplacing the label; the
   row's title still carries the numbers. */
.cm-panel-glyph > .cm-rollup{display:none}
@supports selector(:has(*)){
  button:has(.cm-panel-glyph > .cm-rollup){position:relative}
  .cm-panel-glyph:has(> .cm-rollup){position:static}
  .cm-panel-glyph > .cm-rollup{display:inline-flex;position:absolute;right:8px;top:50%;transform:translateY(-50%);pointer-events:none}
  /* Rail (56px column, 36px icon-only row): the counts do not fit beside an 18px
     glyph, so only the dots ride the row's top-right corner, above the mark. */
  .cm-panel-glyph[data-seat="rail"] > .cm-rollup{right:0;top:0;transform:none}
}

/* ── the band's own leading-row icon buttons ───────────────────────────── */
/* The band's first row stands in for the shell's window-chrome seat: the shell's
   second button is hidden there (see the seat rule above) and the plugin draws
   its own 「新建会话」, which must be indistinguishable from the button it
   replaces. So this is the plugin's copy of the shell's chrome icon button
   (28×28, no frame, radius-sm, label-secondary ink, a hover fill as the only
   state) built from theme tokens only, and it is defined after .cm-btn and
   .cm-view-toggle so it wins any shared-declaration tie. */
.cm-lead-icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer}
.cm-lead-icon:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 6%,transparent))}
.cm-lead-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}

/* ── drop groups: the whole block is the target ────────────────────────── */
/* A drag target is no longer a row: it is the group (header + the
   conversations it owns + the "show more" footer). The wrapper carries the
   mark inline (Columns.tsx owns the gesture's visuals), so the sheet only
   contributes what must be shared or interaction-wide: the card's geometry, the
   boundary insertion line's stacking, hover silence while dragging, and the
   refused cursor. */
.cm-node-group{position:relative;border-radius:12px}
/* The 2px line sits on the group's own outer edge, so it reads as "between
   groups" rather than "on this row"; keep it above the rows it crosses. */
.cm-node-group>[data-insert]{z-index:4;border-radius:1px}
/* While a drag is in flight the group's mark is the pointer's target. Row hover
   would paint a second, competing fill underneath it; the row tools also stop
   offering themselves under a gesture. */
.cm-node-area[data-drag="true"] .cm-node-row:hover:not([data-selected="true"]):not([data-selectable="false"]),
.cm-node-area[data-drag="true"] .cm-thread-row:hover:not([data-selected="true"]){background:transparent}
.cm-node-area[data-drag="true"] .cm-row-actions{display:none}
/* A refused group says no through the cursor; the pointer label carries the
   wording, so the block itself is never greyed out (that would read as "gone"). */
.cm-node-group[data-drop-group="invalid"],
.cm-node-group[data-drop-group="invalid"] .cm-node-row,
.cm-node-group[data-drop-group="invalid"] .cm-thread-row{cursor:no-drop}
/* Hysteresis: the group under a pointer that has left every group keeps its
   provisional (dashed) mark and the label it had. This rule only de-emphasises
   the inline mark's insertion line so a held group never looks committed. */
.cm-node-group[data-drop-group="held"]>[data-insert]{opacity:.55}


/* ── the move dialog's width (BL-2) ────────────────────────────────────── */
/* The tree picker is the one dialog body that needs more room than a form, so
   the move dialog is wider — 480px, with a floor the deepest indent step can
   still live in. Width is the whole difference now: the heavier frame, its own
   shadow and the spread ring it painted as a scrim are gone, because all ten
   dialogs wear the product's elevation and the dialog's backdrop carries the
   scrim. Ring and backdrop together would have dimmed the page by roughly 30%,
   darker than any mask step the product ships. */
.cm-dialog.cm-dialog--move{width:min(480px,92vw);min-width:min(420px,92vw)}

/* ── the move dialog's tree picker (BL-3) ──────────────────────────────── */
/* One scrollable box, indented by the depth the row carries as a custom
   property: the sheet never has to know how deep the tree goes, and a topic
   nested ten levels down still lines up under its parent. */
.cm-move-tree{max-height:min(46vh,320px);overflow-y:auto;overflow-x:hidden;padding:4px;border:1px solid var(--dsw-alias-border-l1,color-mix(in srgb,currentColor 16%,transparent));border-radius:8px;background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 4%,transparent))}
.cm-move-tree-row{display:flex;align-items:center;gap:6px;padding:5px 8px;padding-left:calc(8px + var(--cm-move-depth, 0) * 14px);border-radius:6px;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,currentColor)}
.cm-move-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent))}
.cm-move-tree-row[data-selected="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 12%,transparent);color:var(--dsw-alias-brand-primary,currentColor);font-weight:500}
.cm-move-tree-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 7%,transparent));box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary,currentColor)}
.cm-move-tree-row[aria-disabled="true"],.cm-move-tree-row[data-disabled="true"]{opacity:.45;cursor:not-allowed}
.cm-move-tree-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;transform:rotate(0deg);transition:transform .12s ease}
.cm-move-tree-toggle[data-expanded="true"]{transform:rotate(90deg)}
.cm-move-tree-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── session-home: the home chain, and the composer line ───────────────── */
/* The map's answer to "where does what I type belong?" is one permanent tree
   mark plus one composer line. The home row and every container above it carry
   data-session-path; the sheet paints the chain with the filled brand folder
   and the bold title — no surface, no ring, no outline — so the branch stays
   readable at a glance after the selection moved elsewhere. The selection
   border only appears on a row that is *not* on the chain (owner's rule: the
   chain wins when both apply). When the selection has left the home, the
   composer gains a quiet 30px line naming the chain — space › workspace ›
   topic — with no verdict and no actions. Plan A removed the 5px gutter ring
   and the two grey lanes that used to carry bits of this meaning. */
.cm-node-row[data-session-path="true"]{background:transparent;font-weight:600}
.cm-node-row[data-session-path="true"] .cm-slot{color:var(--dsw-alias-brand-primary,currentColor)}
.cm-node-row[data-session-path="true"] .cm-row-icon path{fill:currentColor}

/* Hover and a pinned menu swap the folder for the fold arrow (the product's own
   leading-slot rule). The chain row's arrow takes the brand colour too, so the
   always-on mark survives the pointer instead of vanishing under it. */
.cm-node-row[data-session-path="true"]:hover .cm-chevron,
.cm-node-row[data-session-path="true"][data-menu="true"] .cm-chevron{color:var(--dsw-alias-brand-primary,currentColor)}

/* The composer-side context line: a 30px bar on the dock column (the GoalBar
   formula's side clearance and dock inset) capped at the composer card's own
   width, so it lines up with the input card instead of the wider stack. It is a
   soft surface, not a card: a layer-2 fill, an 8px radius, one quiet row, no
   shadow and no controls. The line opens with the 「当前会话」 badge and no
   icon — the badge names the row in words, so a glyph would only repeat it. The
   badge carries the brand accent; the path keeps the secondary ink and its last
   hop — the open conversation's own title — is the only 600-weight text, so the
   row reads as one address that ends at the conversation itself. The title sits
   outside the segment group: that group clips its tail, and a long chain must
   ellipsize instead of pushing the name of the conversation being typed into
   off the bar, so the title keeps a width floor of its own. One line only; the
   hover title keeps the whole address. */
.cm-home-path{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% - 2*var(--dsh-composer-side-clearance) - 4*var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - 4*var(--dsh-composer-dock-inset));height:30px;min-width:0;margin:0 auto;padding:0 10px;overflow:hidden;font-size:12.5px;line-height:1;color:var(--dsw-alias-label-secondary,currentColor);white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 5%,transparent);border-radius:8px}
.cm-home-path-label{flex:none;display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,currentColor) 10%,transparent);color:var(--dsw-alias-brand-primary,currentColor);font-size:11px;font-weight:500;line-height:1}
.cm-home-path-segments{flex:0 1 auto;display:inline-flex;align-items:center;min-width:0;overflow:hidden}
.cm-home-path-part{display:inline-flex;align-items:center;min-width:0}
.cm-home-path-seg{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-home-path-seg[data-last="true"]{color:var(--dsw-alias-label-primary,currentColor);font-weight:600}
.cm-home-path-thread{min-width:84px;max-width:280px;overflow:hidden}
.cm-home-path-thread-seg{max-width:260px}
.cm-home-path-sep{flex:none;padding:0 5px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.7}
/* The bar's own 8px gap already stands between the chain group and the title,
   so its separator carries 3px less on the left to keep the 10px hop rhythm. */
.cm-home-path-thread .cm-home-path-sep{padding:0 5px 0 2px}
`

/**
 * Install the plugin stylesheet once.
 * @returns nothing; repeated calls are no-ops.
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) {
    // A hot reload replaces the bundle, not the sheet: refresh its text so style
    // edits land without a page reload.
    if (existing.textContent !== CSS) existing.textContent = CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
