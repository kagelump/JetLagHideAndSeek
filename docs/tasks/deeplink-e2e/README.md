# Deep-Link E2E Test Suite

Status: **Planning** (no code yet). Owner: TBD. Audience: junior SWEs.

This folder plans a suite of **deep-link-driven end-to-end tests**: Maestro flows
that open a _test-only_ deep link to seed arbitrary app state, then assert on the
**derived** state the app computes (elimination %, eligibility masks, overlay
geometry) using the **real** native GEOS engine and the **real** MapLibre map.

The goal is to cover the cases that unit tests (Jest) and the GEOS parity gate
**cannot** reach: the full pipeline running on a real device, with persistence,
native geometry, and native rendering all in play.

## Read in this order

1. **[research.md](research.md)** — Why this suite exists, what the existing
   coverage gaps are, what's already built that we reuse, and pointers to prior
   research. **Start here.**
2. **[design.md](design.md)** — The technical design: the test-only deep-link
   schema, the debug-readout surface Maestro asserts against, safety/gating, and
   the file-by-file architecture.
3. **[epic.md](epic.md)** — The task breakdown: phased, sequenced, each task
   sized for one junior SWE with clear acceptance criteria.

## One-paragraph summary

Maestro can only _see_ the native accessibility tree, and it drives the UI with
brittle coordinate taps. Today our flows mostly take screenshots and eyeball
them — they don't assert on the numbers that matter (e.g. "this answer eliminated
42% of the hiding zone"). This epic adds (1) a **test-only deep link**
(`jetlag-hide-seek-v2://e2e?...`) that seeds a complete, un-minified scenario
directly into the app stores — no taps, no minification limits, fields that the
production share format would never carry — and (2) a **flag-gated debug readout**
that renders derived values as accessibility-readable text nodes so Maestro can
`assertVisible` exact numbers. Both are compiled out / no-op in production builds.
