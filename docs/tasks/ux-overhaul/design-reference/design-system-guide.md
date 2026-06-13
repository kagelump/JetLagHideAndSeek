# Hide & Seek Mapper — Design System

A design system distilled from **Hide & Seek Mapper** (working title _Hide & Seek
Mapper v2_), a local-first mobile app for running _Jet Lag: The Game_–style
**Hide & Seek**. The app turns a phone into a live, shared map: an organizer
picks a play area and which transit stations are in play, everyone shares one
link or QR, and as the seekers ask the hider questions and record answers, the
map visibly **shades away** the places the hider can no longer be.

> "You're the seeker. Ask the hider questions, record their answers, and watch
> the map narrow down where they can be."

This system captures that product's look and feel — a **warm "paper map"
surface**, a **teal accent**, **near-black filled controls**, an Apple-Maps-style
**bottom sheet**, and the **native system typeface** — so you can build
on-brand screens, mockups, and marketing pages.

---

## Sources

Everything here was reverse-engineered from the public repository. If you have
access, read these to go deeper than this system can capture:

- **GitHub (app + marketing site + docs):**
  https://github.com/kagelump/JetLagHideAndSeek
    - `src/theme/colors.ts` — the canonical color palette (source of truth).
    - `src/features/sheet/` — the bottom sheet, MainDrawer, SettingsScreen.
    - `src/components/` — `SheetListRow`, `UnitSegmentedControl` (primitives).
    - `src/features/hidingZone/`, `src/features/playArea/`, `src/features/map/`.
    - `site/index.html` — the marketing landing page (green-tinted variant).
    - `assets/icon.png`, `site/assets/app-preview.png` — brand imagery.
- **UX overhaul plan** (branch `claude/expo-app-ux-assessment-v59xm4`, under
  `docs/tasks/ux-overhaul/`) — the OOTB & sheet UX direction this system
  follows: first-run fork (Set up / Join), compact 42%-resting sheets, the
  setup checklist, and the operator→line hiding-zone drill-down.

Explore the repository further to build richer, more accurate designs than this
distilled system alone provides.

---

## Tech reality (read before you "fix" anything)

The product is an **Expo / React Native** app. Two consequences shape the whole
system:

1. **There are no custom webfonts.** The app renders in the **platform system
   font** (San Francisco on iOS, Roboto on Android); the marketing site uses the
   same `-apple-system` stack. Type tokens point at a system stack on purpose —
   do **not** add a webfont or substitute Inter/Roboto-the-webfont.
2. **Styling is inline (`StyleSheet`), not CSS.** The components here are faithful
   web re-creations of those native styles, driven by the CSS custom properties
   in `tokens/`.

---

## Content fundamentals — how the product talks

The voice is **plain, calm, and instructional** — a competent utility, not a
hype brand. It explains _what a control does and why_, in one short line.

- **Person & address:** Speaks to **"you"** ("watch the map narrow down where
  _they_ can be"). The hider is "the hider," the seeker is "you." Imperative for
  actions ("Pick which transit stations the hider can be near", "Share the
  setup").
- **Sentence case everywhere** for body and descriptions. **Title Case** for
  buttons, row titles, and screen titles ("Play Area", "Hiding Zones", "Reset
  Game", "Share"). **ALL-CAPS** only for tiny eyebrows/section labels ("RADAR
  QUESTION", "DISPLAY", "MAINTENANCE", "DATA & ATTRIBUTION").
- **Descriptions are functional, not salesy.** Each settings row pairs a Title
  Case title with one sentence-case line of _what it does_:
    - "Eligible transit stations for the hiding zone."
    - "Opening a shared question link answers it from your current location."
    - "Show POI names in English when available."
    - "Download offline POI packs for matching questions."
- **Marketing copy** is short, confident, benefit-led, and still concrete:
    - Eyebrow: "Mobile mapper for hide and seek"
    - H1: "Plan the play area. Share the setup. Keep the game moving."
    - Lede: "A local-first Expo app for Jet Lag-style hide and seek: native maps,
      hiding-zone overlays, radar questions, and share links built for chat and QR
      codes."
- **Honesty over polish.** Unavailable things say so plainly: "Not ready yet",
  "App-store builds are not published yet."
- **Destructive actions spell out the consequence.** "Start a new game? This
  clears all questions and resets your play area and hiding zones."
- **No emoji in prose.** Emoji appear only as _functional glyphs_ on map
  controls (🗺️ 📍). No exclamatory marketing, no winking tone, no jargon beyond
  the game's own terms (play area, hiding zone, radar/matching/thermometer
  questions, seeker/hider).
- **Domain vocabulary:** _play area_, _hiding zone_, _preset/operator/line_,
  _radar question_, _matching question_, _thermometer_, _seeker_ / _hider_,
  _Hit_ / _Miss_ / _Unanswered_, _share / import setup_.

---

## Visual foundations — the look and feel

### Overall vibe

A **warm, analog "paper map"** utility. The surface is an off-white paper
(`#f7f4ee`); cards and the bottom sheet are a slightly warmer near-white
(`#fffefa`). The mood is quiet and legible so the _map_ — full of color, transit
lines, and shading — is the star. The chrome gets out of the way.

### Color

- **Surfaces:** warm paper `--paper #f7f4ee` (app bg) → `--card #fffefa` (cards,
  sheet) → `--paper-tint #ece7dc` (insets/subtle buttons). Borders are a warm
  hairline `--line #d9d4ca`.
- **Text:** near-black `--ink #17202a` for primary; `--muted #667085` for
  descriptions, meta, and chevrons.
- **Accent is teal** `--teal #1f6f78` — links ("Back"), eyebrows, active
  borders, the "on" switch track, and the active-row wash `--teal-tint-bg
#e6f2ef`. The marketing site shifts this toward green `#176b4d`.
- **Filled controls are teal.** As of the UX overhaul the **primary button and
  the _selected_ segment of any segmented / answer control fill teal**
  (`--fill-control` → `--teal`) with white text — one accent everywhere, the
  Apple-Maps model. Near-black navy (`--ink-button #111827`,
  `--fill-control-strong`) is kept as a rare neutral-strong option (the
  Seeker/Hider mode chip).
- **Brand blue** `#2d7dd2` comes from the app icon (a compass arrow + cursor).
- **Map palette** is its own world: water `#9ec5df`, parks `#9bc4a3`, roads
  `#f1d083`, over a paper land `#e9e4da`; the radar/measuring ray is pure red
  `#ff0000`; the question pin is a warm brown-red.
- **Semantic:** destructive text `#b42318` on a light wash with a pink border
  (`#f4b4ae`); success/active read teal-green.

### Typography

- **System font stack**, no webfonts. Heavy by default — the brand leans on
  weight, not size, for hierarchy: descriptions are 400, body 600, row titles
  700, titles 800, hero/figures 900.
- **Scale (px):** 12 eyebrow · 13 meta/description · 14 button · 16 body · 17
  row title · 20 map glyph · 24 sheet title · 34 display.
- **Eyebrows** are 12px/800, uppercase, +0.5px tracking, teal. **Section
  labels** are the same but muted.
- **Tabular numerals** for distances, counts, and coordinates (2,000 m · 37 /
  412 · 35.6878, 139.7239 in mono).

### Spacing, radius, elevation

- **4px base grid;** common gaps are 8, 12, 16, 20, 24.
- **Corners are gently rounded:** 8px is the default for cards, rows, buttons,
  inputs; 7px for inner segmented buttons; the **FAB is a 28px circle**; the
  **bottom sheet has 32px top corners**; chips/switches are full pills.
- **Borders carry the structure, not shadows.** In-sheet cards are **border-only
  (no shadow)**. A drop shadow appears **only on controls floating over the map**
  — the map-control buttons and the FAB (`0 4px 10px rgba(0,0,0,.14)` + a
  `rgba(23,32,42,.14)` border). The sheet has a soft upward shadow; modals a
  deep one.

### Motion & interaction

- **Press feedback is a single, uniform opacity dip to 0.72** across every
  tappable element — no scale, no color shift on press. Honor this everywhere.
- **Selection** is a fill/wash change: segmented selected → navy fill; active
  row/preset → teal wash + teal border.
- **Sheet navigation** is a 300ms horizontal slide between routes (forward
  pushes left, back slides right), with an edge-swipe-back gesture. The sheet
  itself snaps between **18% / 42% / 88%**; **42% is the resting state** so the
  shading map stays visible behind it. 88% is reserved for deep browse/search.
- Switches animate the knob ~160ms. Otherwise motion is minimal and functional.

### Imagery & backgrounds

- The **hero image is the live map** — real OSM raster tiles, warm and slightly
  desaturated, overlaid with translucent **white hiding-zone circles**, colored
  **transit lines**, **station dots**, and a single **question pin**.
- No decorative gradients, no illustration, no texture on the chrome. The app
  background is a flat warm paper; the marketing page adds only a whisper of a
  top-down white→paper gradient.

### Iconography

See the **Iconography** section below.

---

## The bottom sheet — anatomy & the half-open ideal

The app is, essentially, **a map with one bottom sheet**. Getting that sheet
right _is_ the design system. Apple-Maps is the north star: the sheet rests
**half-open** and you do most of your work there, watching the map react behind
it.

### Snap points

- **18% — peek.** Just the grabber + a HUD line. Glanceable.
- **42% — the resting state and the workhorse.** Every common task must be
  completable here **without expanding**. This is the test for "is this screen
  done": primary control + its result/answer must sit above the 42% fold.
- **88% — deep browse only.** Reserved for long search/lists (browse-all
  operators, candidate lists). Never the default.

### Anatomy (always, in this order)

1. **Grabber** — the 44×5 handle.
2. **`SheetHeader`** (optional) — teal "‹ Back" · centered title · trailing
   accessory (lock toggle / "…" menu / Share). Identical on every child sheet.
3. **Scroll body** — the controls, in priority order (primary first).
4. **Sticky `footer`** (optional) — the culminating CTA ("Continue" in setup,
   "Done"). Detail sheets usually omit it (the answer auto-applies).

### The map is the canvas; the sheet is a thin control surface

Because the sheet sits at 42%, the **map stays visible and does the talking**:
the radar circle, the hot/cold tint, tentacle candidate pins, the measuring
line, the ward boundary. Manipulating a control in the sheet should produce an
**immediate, visible change on the map**. If a screen needs 88% to be usable,
it's too heavy — push secondary options into drill-ins.

## Question sheets — the meat of the app

Five question types, each a compact sheet that keeps **primary control + answer
above the 42% fold** and shades the map live:

| Type            | Primary control                    | Answer (`AnswerSelector type`)                    | Map reaction                                            | Cost           |
| --------------- | ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | -------------- |
| **Radar**       | distance `ChipGroup`               | Hit / Miss                                        | darkens **outside** (Hit) or **inside** (Miss) the ring | Draw 2, pick 1 |
| **Thermometer** | Start/End pin segmented            | Hotter / Colder                                   | warm/cool tint toward the End pin                       | Draw 2, pick 1 |
| **Measuring**   | "compared to" drill-in             | Closer / Farther                                  | measuring line to the target                            | Draw 3, pick 1 |
| **Matching**    | category drill-in                  | Hit / Miss                                        | tints the candidate region                              | Draw 2, pick 1 |
| **Tentacles**   | range `ChipGroup` + candidate list | _selects a place_ (POI model — no AnswerSelector) | range circle + line to the winner                       | Draw 4, pick 2 |

Rules of thumb, codified:

- **Radar/Thermometer/Measuring/Matching** record a binary answer → use
  `AnswerSelector` with the matching `type` for correct polarity labels.
- **Tentacles** is a _POI_ question — you pick the winning place from a list
  (radio rows), there is no Hit/Miss.
- Distance presets are a horizontal **`ChipGroup`**, not a wide segmented
  control, so the answer stays on screen at 42%.
- Surface **cost · time** (`QuestionMeta`) on the Add-Question rows and detail
  headers — the game's card economy matters.
- A **lock toggle** (🔒) in the header freezes an answered question so the map
  shading doesn't change by accident.

## Iconography

The app **ships no icon font or SVG icon set** — iconography is deliberately
minimal and native:

- **Functional emoji** for the two map controls: 🗺️ (fit play area) and 📍
  (locate me). A 🔒 lock toggle and 📡 radar appear in question contexts.
- **Unicode glyphs** for affordances: `›` / `‹` chevrons (muted, 28px) for
  navigation, and the **three-dot mark** (`•••`) on the FAB — that dot-triad is
  the app's own little brand affordance for "open the sheet."
- **One raster asset:** `assets/question-pin.png`, the map pin.
- **App icon** (`assets/logo-icon.png`): a blue rounded square with a white
  circle, a dark north-arrow, and a white cursor — "navigate + tap."

**If you need a richer icon set** (the codebase has none), substitute
**Lucide** (thin stroke, rounded joins — closest to the calm, modern feel) from
its CDN, and **flag the substitution** to the user. Keep stroke weight light and
corners rounded. Don't introduce filled/duotone icon families.

---

## What's in here (index)

| Path                     | What it is                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `styles.css`             | Entry point — `@import`s every token file. Consumers link this.                                                |
| `tokens/colors.css`      | Color custom properties (base + semantic aliases).                                                             |
| `tokens/typography.css`  | Font stacks, size scale, weights.                                                                              |
| `tokens/spacing.css`     | Spacing grid, radii, elevation, interaction tokens.                                                            |
| `components/core/`       | `Button`, `Chip`, `Badge`, `Eyebrow`, `SectionHeading`, `Card`, `QuestionMeta`.                                |
| `components/forms/`      | `SegmentedControl`, `Switch`, `TextField`, `AnswerSelector`, `ChipGroup`.                                      |
| `components/sheet/`      | `ListRow`, `BottomSheet` (snap + sticky footer), `SheetHeader`.                                                |
| `components/map/`        | `MapControlButton`, `Fab`.                                                                                     |
| `guidelines/*.card.html` | Foundation specimen cards (Colors, Type, Spacing, Brand).                                                      |
| `ui_kit/app/`            | Interactive app recreation — map + bottom sheet, the **question sheets** at the 42% rest driving the live map. |
| `assets/`                | `logo-icon.png`, `app-preview.png`, `question-pin.png`.                                                        |
| `SKILL.md`               | Agent Skill entry point (for use in Claude Code).                                                              |

Each component directory also carries a `.prompt.md` (what & when + usage) and a
`*.card.html` thumbnail. Use components via the compiled bundle:

```html
<link rel="stylesheet" href="styles.css" />
<script src="_ds_bundle.js"></script>
<script type="text/babel">
    const { Button, SegmentedControl, ListRow } =
        window.HideSeekMapperDesignSystem_ee69a9;
</script>
```

---

## Using this brand in one paragraph

Lay calm, heavy, sentence-explained controls on a warm paper surface; let a
colorful live map be the only loud thing. Accent with teal, fill the one
committing action (and any selected segment) in near-black navy, and round
corners gently. Reserve shadow for things floating over the map. Speak plainly
to "you," in Title Case for actions and sentence case for everything else, and
never let the chrome upstage the map.
