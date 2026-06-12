# T12 Review 1 — Bundle viewer for offline packs

Reviewed: commit `d411095` ("feat(viewer): implement T12") against
[12-bundle-viewer-packs.md](12-bundle-viewer-packs.md), with live
verification of the local server against the real `dist/` packs and a local
run of the static build. Also noted: the working tree contains an
uncommitted R3 fix (per-region admin-border levels in `buildMeasuring` +
parameterized `admin-<N>` post-filter) — looks right, not reviewed in depth
here; commit it separately with a rebuild.

## Verdict

**Part 1 (local server) is genuinely done and works** — I ran
`server.mjs --pack data/packs/dist` and exercised every route against the
real Netherlands pack: regions list, meta, 1,368 museums, 440 coastline
features, the 12 level-4 provinces by name, and 1,977 transit stations all
came back correct, with the `[\w-]+` route patterns blocking path
traversal. The shared `columnarToGeojson` extraction is clean, and the 14
new node tests pass.

**Part 2 (hosted viewer) has never been executed and is broken three ways
stacked.** `build.mjs` crashes before finishing, the build never copies the
`lib/` scripts the new page requires, and one of those scripts can't run in
a browser anyway. Any one of these would have been caught by running the
build once and opening the output. Worse, the crash isn't contained to the
viewer: `pages.yml` runs `build.mjs` as a deploy step, so **pushing the
current commits will fail every Pages deploy** — catalog, splash, and
deep-link updates all blocked until fixed.

Also: the three newest commits (R1 lint fix, Taiwan rebuild, T12) are
**unpushed**, and the last pushed commit's Maestro E2E run failed on both
platforms (pre-T12; needs separate triage).

---

## Critical

### V1. `build.mjs` crashes — the refactor was never run

[build.mjs:59](tools/data-viewer/build.mjs) calls
`require("./lib/columnarToGeojson.js")` but `const require =
createRequire(...)` is declared ~10 lines **later** (line ~70, next to the
transit section). ESM hoists the `import { createRequire }`, but the
`const require` binding stays in its temporal dead zone until that line
executes:

```
ReferenceError: Cannot access 'require' before initialization
```

Reproduced by running `node tools/data-viewer/build.mjs` — it dies after
the measuring/zones section, before POIs, transit, and the HTML copy.
Since `pages.yml` runs this exact command before `deploy-pages`, the next
push turns the Share Link Pages workflow red and blocks **all four** site
uses from updating. Fix: move the `createRequire` setup to the top of the
file with the other imports. Then actually run it.

### V2. The static build never copies `lib/` — all three page scripts 404

[index-static.html:12-14](tools/data-viewer/index-static.html) loads
`lib/columnarToGeojson.js`, `lib/deltaEncode.js`, `lib/transitGeojson.js`
relative to the deployed page, but `build.mjs` has **no `cpSync` for the
`lib/` directory** (only `index-static.html → index.html`). Confirmed: the
local build output has no `lib/`, and the live site 404s all three paths.
Without them, `window.columnarToGeojson` / `window.deltaEncode` /
`window.transitGeojson` are undefined and the entire drag-drop mode is
dead. Add `cpSync(join(import.meta.dirname, "lib"), join(OUT, "lib"),
{ recursive: true })`.

### V3. `lib/deltaEncode.js` cannot run in a browser

Unlike `columnarToGeojson.js` and `transitGeojson.js` (IIFE with
`module.exports` _and_ `window.*` guards), `deltaEncode.js` is plain CJS —
top-level `module.exports = …` and no `window` assignment. Loaded via
`<script src>`, it throws `ReferenceError: module is not defined` and never
defines `window.deltaEncode`, which
[index-static.html:1270](tools/data-viewer/index-static.html) requires for
boundaries decoding. Wrap it in the same dual-environment IIFE as its two
siblings. (V1→V2→V3 chain: each hides the next; fixing them one at a time
without opening the page each time will feel like whack-a-mole — fix all
three, then do the manual hosted check from the task doc.)

## Major

### V4. The new test suite is not wired into `pretest` — it never runs

`tools/data-viewer/__tests__/sharedTransforms.test.mjs` passes when invoked
directly, but `package.json`'s `pretest` globs cover only
`scripts/`, `data/geofabrik/`, `data/transit/`, and `data/packs/` — the new
suite is invisible to `pnpm test` and CI. The T12 doc (and T1's house
rules) require wiring it in. Add the glob (and consider a
`test:data:viewer` alias to match the existing naming).

### V5. The sniffing tests test a copy, not the implementation

`sniffKind` is **defined inside the test file**
([sharedTransforms.test.mjs:112](tools/data-viewer/__tests__/sharedTransforms.test.mjs))
while the real implementation lives inline in
[index-static.html:912](tools/data-viewer/index-static.html). The two can
drift freely — this is exactly the producer/consumer-tested-against-
-separate-fixtures failure mode reviews 1–3 of the epic kept finding, and
the T12 doc placed sniffing in "the shared transforms in
`tools/data-viewer/lib/`" for that reason. Move `sniffKind` into a lib
module (same dual-environment wrapper), import it from both the page and
the test, and delete the copy.

## Minor

- **Per-request re-read/re-gunzip**: every layer toggle re-reads and
  re-parses the artifact (`boundaries.json.gz` fully re-decoded per level
  toggle; `poi.json.gz` per category). Fine for a local tool; a
  one-entry-per-(region,file) memo keyed on mtime would make level
  browsing snappier on the 1 MB boundaries file. Optional.
- **Running `build.mjs` breaks `pnpm check` locally**: the (git-ignored)
  regenerated JSON under `site/bundle-viewer/data/` is not
  prettier-ignored, so `format:check` fails after any local build (I hit
  this during review and removed the residue). Add `site/bundle-viewer` to
  `.prettierignore` — CI checkouts never contain these files, so this only
  papercuts local runs, but it will hit whoever fixes V1.
- The transit pass-through test asserts a hand-built preset rather than
  loading a real pack artifact (the doc asked it to "assert the post-N3
  schema"). With V5's lib move, consider one fixture generated from
  `buildTransit` (T11 §2 pattern).
- `/packs/catalog.json` is fetched with an absolute path — correct for the
  custom-domain deployment; would break if the site ever moved to a
  `*.github.io/<repo>/` subpath. A comment noting the assumption is enough.
- Jest run during review showed one failure in
  `clipLineFeatures.perf.test.ts` (8.0 s vs 6 s budget) — passes in
  isolation (5.2 s); load-induced flake, unrelated to T12, but the budget
  is evidently close to the line when suites run in parallel.

## Task-doc conformance

| Item                                                                   | Status                                                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Part 1: meta/poi/measuring/transit/boundaries routes                   | ✅ Done, verified against real NL pack                                                               |
| Part 1: pack picker, meta-driven panel, lazy fetch, teardown, bbox fit | ✅ Code present and structured as specced (browser run not independently verified)                   |
| Part 2: catalog browse (same-origin)                                   | ✅ Code present; unreachable until V1–V2 fixed                                                       |
| Part 2: drag-drop + DecompressionStream + sniff + transforms           | ⚠️ Code present; dead on arrival via V1+V2+V3                                                        |
| Part 2: provenance panel incl. per-level boundary counts               | ✅ Code present                                                                                      |
| Part 3 (niceties)                                                      | Not done — explicitly optional, fine                                                                 |
| Shared transforms in `lib/` with node tests wired into pretest         | ⚠️ Lib + tests exist and pass, but not wired (V4) and sniffing not actually shared (V5)              |
| Manual local check                                                     | Evidently done (server works end-to-end)                                                             |
| Manual hosted check                                                    | **Not done** — impossible with V1–V3 present                                                         |
| `pnpm test` + `pnpm check` green                                       | check: lint ✅ format ✅ (after build-residue cleanup) / test: green modulo the unrelated perf flake |

## Suggested fix order

1. V1 + V2 + V3 in one commit, then run `node tools/data-viewer/build.mjs`,
   open `site/bundle-viewer/index.html` locally, and drag a real
   `europe-netherlands-boundaries.json.gz` onto it — the task doc's manual
   check, done locally before any push.
2. V4 + V5 (wire the suite, move `sniffKind` to lib) in the same or a
   follow-up commit.
3. Add `site/bundle-viewer` to `.prettierignore`.
4. Push all pending commits, watch Share Link Pages go green, then do the
   hosted manual check on the live site.
5. Separately: triage the Maestro E2E failure on `fc20a21` (both
   platforms, pre-T12) — it gates the epic's device-validation story, not
   T12.
