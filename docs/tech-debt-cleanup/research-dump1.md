# Overall goal

Do research on codebase for cleaning up tech debt. Below is result of earlier agent research.
Create detailed plan doc for (target audience: junior devs) each task item.

# Agent 1

Code Quality / Tech Debt Audit: src/state/ and src/sharing/

1. Question schemas are triplicated across three files (no single source of truth)
   Severity: Critical
   Files: src/state/appState.ts:40-258, src/sharing/wire/schema.ts:35-252, src/sharing/wire/minified.ts:95-202
   The full per-question Zod schemas exist in two near-identical copies (appState.ts and wire/schema.ts) plus a third hand-divergent minified copy (minified.ts). The radarDistanceOptionSchema, matchingCategorySchema, measuringCategorySchema, tentaclesCategorySchema, candidate object schema, and the radius→radar .transform are all duplicated verbatim between appState.ts and schema.ts. Any new category, distance option, or field must be edited in 3+ places with no compiler enforcement that they agree.
   Why it's a problem: This is the single largest drift risk in the audited code. A category added to matchingCategorySchema in schema.ts but forgotten in appState.ts silently drops the question on persistence reload (or vice-versa on import). The minified schema (minified.ts) deliberately loosens category to z.string().min(1) (lines 127, 158, 177), so the wire path won't even catch a bad category — it gets caught only later, inconsistently.
   Remediation: Extract shared leaf schemas (radarDistanceOptionSchema, the three category enums, the candidate schema, the legacy-radius transform) into one module (e.g. src/sharing/wire/questionSchemas.ts or a shared/questionSchemas.ts) and import into all three. Derive the appState schemas from the wire schemas where the shapes match (they are nearly identical apart from boundary presence). At minimum, factor the enums.
2. Radius→radar and POI-answer normalization logic is duplicated 4× with three different mechanisms
   Severity: High
   Files: questionStore.tsx:819-872 (imperative normalizeQuestionState + 4 type guards), appState.ts:128-150 & :209-248 (Zod .transform), schema.ts:123-145 & :204-243 (Zod .transform), minified.ts:707-754 (manual object building with inline derivePoiAnswer).
   The same two normalizations — legacy type:"radius" → type:"radar", and "re-derive answer from selectedOsmId" — are reimplemented in the store as hand-written type guards, twice as Zod transforms, and once as imperative un-minify code. The comments at minified.ts:715-718 and schema.ts:236-238 explicitly acknowledge they're maintaining "symmetry" by hand.
   Why it's a problem: Four copies of a load-bearing invariant ("answer must be derivable from selectedOsmId") that the repo docs flag as having already caused a polarity bug. The store's normalizeQuestionState (lines 819-854) duplicates the Zod schemas' job but is invoked separately on the import path — meaning a payload can be validated by Zod then re-normalized by hand-written guards that could disagree.
   Remediation: Make the Zod schemas the only normalizer. Have questionStore.importQuestions/addImportedQuestion run payloads through appStateQuestionsSchema.parse instead of the bespoke normalizeQuestionState + guards (lines 856-904 can then be deleted). Centralize derivePoiAnswer re-derivation in one reusable Zod transform helper applied by all schemas.
3. The minifier/un-minifier is a 871-line hand-maintained codec full of unsafe casts
   Severity: High
   File: src/sharing/wire/minified.ts (entire file; esp. unminifyQuestion:581-776, minifyAppState:535-579, unminifyAppState:806-871)
   unminifyQuestion is a ~190-line function that reads every field via q[FIELD_MAP.x] as SomeType — dozens of unchecked casts (e.g. lines 599-645). minifyEnvelope/unminifyEnvelope end with return mini as unknown as WireEnvelopeMinified (lines 532, 578) and full as unknown as AppStateEnvelopeV1 (line 870), fully bypassing type checking at the most error-prone boundary. The forward FIELD_MAP and string discriminator codes ("r", "m", "g", "h", "c") are maintained by hand with comments noting reused keys (r/du shared across question types, lines 25, 42).
   Why it's a problem: This is the most fragile file in the audit. The double-cast pattern means a structural bug in minify/unminify won't surface at compile time and will only manifest as a corrupt shared link at runtime. The shared single-char field abbreviations create aliasing hazards (e.g. radiusMeters/r reused for measuring distance and tentacles distance) that are invisible to the type system.
   Remediation: Generate the minified schema and minify/unminify mappings from a single field-descriptor table (full key, short key, type) rather than maintaining FIELD_MAP, REVERSE_FIELD_MAP, the minified Zod schemas, and the imperative codec separately. Replace the as unknown as returns by building objects that structurally satisfy the inferred types, and parse the minified output through the schema (round-trip self-check) in dev. REVERSE_FIELD_MAP (lines 62-68) is built but appears unused — confirm and remove.
4. migratePersistedAppState returns null on any validation failure → silent total data loss
   Severity: High
   Files: appState.ts:359-362, persistence.ts:38-47, 109-123, 153-162
   migratePersistedAppState does a single safeParse and returns null if anything fails; callers in persistence.ts respond by deleting the persisted slices (lines 111-113, 121-123) and silently swallow every error with empty catch {} blocks (lines 44, 55, 120, 160, 169). persistAppState also silently ignores write failures (line 44).
   Why it's a problem: A single malformed/forward-incompatible question (e.g. a category from a newer app version, exactly the drift risk in finding #1) causes the user's entire game setup — play area, hiding zones, all questions — to be wiped on next launch, with no log, no telemetry, no partial recovery. Combined with finding #1's drift surface this is a realistic data-loss path.
   Remediation: Validate slices independently so one bad slice doesn't nuke the others; drop only the failing slice. Surface failures (at least console.warn/dev assert) instead of silent catch {}. Consider per-question safeParse so unknown question types are skipped rather than discarding the array.
5. createAppStateV1 / buildAppStateEnvelope / import-mappers are parallel hand-copied field lists
   Severity: Medium
   Files: appState.ts:306-357 (createAppStateV1), appState.ts:428-462 (three ...ToImportState mappers), buildEnvelope.ts:19-61, AppStateProviders.tsx:213-236
   The play-area/hiding-zone/question-settings field lists are spelled out by hand in at least four places: the AppState factory, the three appStateXToImportState converters (each a verbatim field-for-field copy), the export envelope builder, and the persistence-coordinator's createAppStateV1 call. These are pure structural identity mappings ({ bbox, boundary, center, label, osmId, osmType } repeated).
   Why it's a problem: Adding a field to a slice requires touching every copy; missing one drops the field on a specific path (persist vs. share vs. import). The ...ToImportState functions add no logic over a spread.
   Remediation: Where the source and target types are identical, replace the manual converters with direct passthrough (or a shared pick). Define each slice's field set once and reuse.
6. QuestionProvider is a 904-line file mixing context wiring with ~15 exported pure helpers and normalization
   Severity: Medium
   File: questionStore.tsx (whole file)
   The file contains the provider, 8 context objects with hand-nested providers (lines 509-539, a 9-deep JSX pyramid), ~15 exported pure update helpers (updateRadar*, updateThermometerPin, selectTentaclesPoi, etc., lines 576-724), question-factory logic (createDefaultQuestion:732-817), and the normalization/type-guard block (lines 819-904). Several helpers are duplicative: updateRadarQuestionCenter = updateQuestionCenter (line 606) is a pointless alias; setGameMode/setActiveQuestionId/setSeekingStartedAt/markRestored are trivial 1-line wrappers around setters that could be the setters themselves.
   Why it's a problem: Hard to navigate; the pure helpers and normalization have nothing to do with React context and complicate testing/reuse. The 9-level provider nesting is error-prone to reorder.
   Remediation: Split into questionStore.tsx (provider + contexts), questionMutations.ts (the pure update*/select\* helpers), questionFactory.ts (createDefaultQuestion), and fold normalization into the shared schema module (finding #2). Collapse the provider nesting with a small composeProviders helper. Drop the redundant alias.
7. Cross-store coupling: hidingZoneStore and questionStore reach into each other via module-level side effects
   Severity: Medium
   Files: hidingZoneStore.tsx:17,216 (imports useLabelLanguage from questionStore), questionStore.tsx:381,405,435 + AppStateProviders.tsx:199-204 (setDefaultAdminConfig module-level mutation)
   hidingZoneStore depends on questionStore for labelLanguage, forcing the provider ordering in AppStateProviders.tsx:76-78 (QuestionProvider must wrap... but it's actually inside HidingZoneProvider, so useLabelLanguage in hidingZone reads a value from a provider rendered below it — it works only because the contexts have defaults). Separately, admin-division label state is mutated through a module-level singleton setDefaultAdminConfig called from 4 sites (store callbacks + a coordinator effect) to keep non-React code paths in sync.
   Why it's a problem: labelLanguage is conceptually display/i18n state living in the question store but consumed by hiding zones — the wrong home creates a hidden inter-store dependency and fragile provider ordering. The module-level setDefaultAdminConfig mutable global is a classic React anti-pattern (state duplicated between context and a module variable, kept in sync by hand across 4 call sites).
   Remediation: Hoist labelLanguage (and admin-division config) into a dedicated settings/i18n context that both stores consume, removing the question→hidingzone import. Replace the setDefaultAdminConfig global with a passed-in accessor or a derived selector so there's one source of truth.
8. Manual version gating is duplicated and partial
   Severity: Low
   Files: codec.ts:48-49,67-72 (getUnsupportedVersion reads .v), minified.ts:235-238 (discriminated union also pins v: literal(1)), appState.ts:296,359-387 (version: literal(1) + addMissingV1Slices only runs when version === 1)
   Version handling is spread across the codec (manual .v peek before schema parse), the Zod literal, and the persistence migrator. addMissingV1Slices early-returns unchanged for any version !== 1 (line 366), so a future v2 persisted blob silently fails parse → data wipe (finding #4).
   Why it's a problem: No central versioning strategy; three places must agree on "version 1" and the migration story for v2 doesn't exist yet, so the first schema bump is a latent data-loss event.
   Remediation: Centralize version detection/migration in one migrate(value) chain keyed by version, used by both persistence and wire decode. Document the bump procedure.
   Top priorities: Findings #1 and #2 (schema/normalization triplication) are the root cause that makes #3 (fragile codec) and #4 (silent data wipe) dangerous — fixing the single-source-of-truth problem shrinks all four. The highest-leverage single change is consolidating the per-question Zod schemas + normalization transforms into one shared module that the persistence, wire, and minified paths all derive from.

# Agent2

Tech Debt Audit: Geometry Module & src/shared/

1. Quadruplicated GEOS op pipeline across 4 languages (High)
   Files: ios/GeosCore.swift:164-346, android/.../native-geometry-jni.cpp:51-291, src/shared/geometry/geosWasmNode.ts:134-205, plus the orchestration in geosGeometryBackend.ts.
   The identical "parse WKB → GEOSisValid_r → GEOSMakeValid_r recovery → run op → GEOSGeomToWKB_buf → free handles" sequence is hand-reimplemented in Swift, Kotlin/C++ JNI, and wasm-JS. Three of these (Swift, JNI) are over the same GEOS C API and differ only in host-memory marshalling. This is the root cause of the 3-parity-surface burden (iOS XCTest + Android instrumented + geos-wasm golden) — every behavioral change (new op, validity policy, buffer params) must be made and re-tested in 4 places. The wasm path notably omits the MakeValid recovery step that both native paths perform (geosWasmNode.ts:165-178 unaryUnion has no GEOSisValid_r/GEOSMakeValid_r), so the "reference oracle" used by golden fixtures does not actually match runtime native behavior on invalid input.
   Remediation: Extract the parse/validate/op/write/free state machine into a single C++ core (geos_ops.cpp) compiled into both the iOS pod and the Android .so, exposing one runOp(opcode, wkbA, wkbB) -> wkb entry point. Swift/Kotlin become ~10-line marshalling shims. Align the wasm helper's validity policy (add MakeValid) or explicitly document it as a deliberate oracle divergence. This collapses 3 native parity surfaces toward 1 logic surface.
2. WKB decoder silently drops geometry / hard-throws on GeometryCollection members (High)
   File: wkb.ts:374-418, esp. 402-410.
   decodeWkb cannot skip an unknown sub-geometry's bytes (no length-prefixed framing for Point/LineString), so on any non-polygon member inside a GeometryCollection it throws WkbError, which the backend's catch routes to the full JS polyclip fallback (geosGeometryBackend.ts:386-393 etc.). GEOS legitimately emits mixed GeometryCollections from GEOSDifference/GEOSIntersection on touching geometries (slivers + lines + points). So a correct native result is discarded and recomputed in slow JS — silently, only a console.warn. Separately, the GC branch flattens away lower-dimensional members (373 comment) which is correct for area ops but means the decoder's behavior is op-dependent yet op-unaware.
   Remediation: Set the native WKB writer to strip to polygonal output before serialization (e.g. GEOSGeom_extractUniqueComponents / collection-type filtering on the native side, where you have a full GEOS parser), so the JS decoder only ever sees Polygon/MultiPolygon. Then the GC-handling branch in wkb.ts:374-418 can be deleted entirely. This removes both the silent-fallback path and a chunk of fragile parser code.
3. Unconditional, per-op console.log in the geometry hot path (High)
   File: geosGeometryBackend.ts — 20 console.\* calls; the [geos] ... in Xms summary logs (e.g. :318, :332, :374, :410, :448, :526) and bufferAndWrite NSLog/LOGD fire on every op regardless of **DEV**. The per-step [geosPerf] logs are **DEV**-gated, but the summaries are not.
   Mask building (maskBuilder, measuring dissolve) runs these ops in tight loops over many polygons. Unconditional console.log in React Native is a synchronous bridge call and a real per-op cost in production, plus it floods logs. The native Swift/JNI sides also NSLog/LOGD on the success path.
   Remediation: Gate all summary logs behind **DEV** (or a DEBUG_GEOMETRY flag), or remove them and rely on parityMetrics.ts. Drop the success-path LOGD("...success...") / NSLog in native.
4. require("native-geometry") re-invoked inside every backend method (Medium)
   File: geosGeometryBackend.ts:209, 357, 399, 434, 472 — each method does its own require("native-geometry") as {…} with an inline structural cast.
   Done to let Jest mock per-test, but it (a) repeats an unsafe hand-written type assertion 6×, (b) re-resolves the module registry on every geometry op, and (c) scatters the native surface contract across the file instead of one typed import. The casts are unchecked — if a native function signature drifts, TS won't catch it because each call site re-declares the shape.
   Remediation: Import the typed surface once from modules/native-geometry/src/index.ts (which already exports properly typed bufferWKB/differenceWKB/etc.) and reference those. Keep a single injectable seam (like \_\_setGeometryBackendForTest) for Jest rather than relying on require re-resolution.
5. Two divergent backends kept in lockstep "bug-for-bug" by manual policy (Medium)
   Files: geosGeometryBackend.ts:9-19 header, :301-322 FC handling; jsGeometryBackend.ts:69-86; interface JSDoc geometryBackend.ts:37-74.
   The bufferMeters(FC) "buffer each feature, keep only features[0], silently drop the rest" quirk is deliberately replicated in both backends and enforced only by prose comments and parity tests. This is a latent footgun: the API name (bufferMeters on a FeatureCollection) strongly implies a union, the JSDoc spends ~25 lines warning it isn't, and the documented workaround (pass a MultiPoint, or call unaryUnion) is easy to miss. unionPolygons in geojson.ts:25-50 exists precisely because of this gap. The "Phase B / G5" deferral comments are now stale given unaryUnion shipped.
   Remediation: Either make bufferMeters(FC) throw (forcing callers to the explicit union path) or split into bufferFeature / bufferAndUnion so the contract is in the type, not the comment. Audit call sites for accidental reliance on the drop-the-rest behavior, then remove the bug-for-bug coupling.
6. Diagnostic coordSanity walk runs on every buffered feature (Medium)
   File: geosGeometryBackend.ts:147-260.
   bufferFeature walks the entire projected coordinate array (coordSanity, :240) on every call to detect NaN/unclosed-ring corruption that GEOS would reject — even on the happy path where it finds nothing. For dense polygons this is an extra full O(n) pass per buffer purely for a warning. It's effectively permanent debug instrumentation left in the hot path, and ~115 lines of the 539-line file.
   Remediation: Run coordSanity only inside the failure branch — when the native call returns null — to explain why it failed, rather than pre-emptively on every input. That preserves the diagnostic value at zero happy-path cost and shrinks the hot function.
7. ABI handshake is advisory-only; stale binary degrades silently to JS (Medium)
   Files: geometryBackend.ts:221-238, src/index.ts:15, NativeGeometryModule.swift:14, GeosBridge.kt:29.
   The ABI version (2) is hardcoded in four independent places (TS EXPECTED_NATIVE_ABI, TS expected check, Swift nativeAbiVersion, Kotlin NATIVE_ABI_VERSION) and must be bumped in manual lockstep. On mismatch the code only console.warns once and silently runs overlay ops in JS — which per the project docs can hard-lock ~25s on body-of-water dissolve. So the single most user-impacting failure mode (stale dev binary) surfaces as one easily-missed warning, not a visible/blocking signal. The Kotlin constant (NATIVE_ABI_VERSION = 2) isn't even wired into the JS check path the way Swift's nativeAbiVersion() Function is — risk of the two drifting.
   Remediation: Derive the ABI constant from one source (generate the Swift/Kotlin/TS constants from a shared JSON, or assert them equal in a test). For the dev-experience problem, surface a persistent in-app dev banner (not just a log) when nativeAbi < expected, since the consequence is a multi-second lock.
8. JNI uses JNI_ABORT release but copies via GetByteArrayElements (Low)
   File: native-geometry-jni.cpp:117-147, 231-239, 322-331.
   GetByteArrayElements(..., nullptr) may copy the whole WKB array (JVM's choice), then ReleaseByteArrayElements(..., JNI_ABORT) discards it. Correct, but for large polygon WKB this is an avoidable copy. GetPrimitiveArrayCritical / GetByteArrayRegion into a stack/heap buffer avoids the copy-then-discard. Minor, but these are exactly the body-of-water-sized payloads where it matters. Memory handling is otherwise correct (handles freed on every error path) — this is a perf nit, not a leak.
   Remediation: Switch input reads to GetByteArrayRegion into a std::vector<jbyte> (or GetPrimitiveArrayCritical with the usual no-JNI-call-while-held discipline).
9. offsetPosition uses a different Earth radius than the rest of the codebase (Low)
   File: geojson.ts:129 hardcodes R = 6371000, while haversineDistanceMeters (same file, :94) and all buffering use the shared EARTH_RADIUS_METERS from earthRadius.ts. Inconsistent constants produce small but real drift between "offset a pin by N meters" and "measure distance to that pin." Trivial fix: use EARTH_RADIUS_METERS.
   Summary of impact ranking
   The big wins are structural: #1 (collapse 4 reimplementations → 1 C++ core, the only real fix for the 3-parity-surface tax) and #2 (eliminate the GC-decode fragility that silently throws away correct native results). #3/#6 are cheap, high-value hot-path cleanups. #4/#5/#7 reduce manual-lockstep fragility. #8/#9 are minor.
   The native memory management is actually sound (every error path frees its handles in all three native impls) — the debt here is duplication and silent fallback, not leaks. The shared non-geometry helpers (distanceUnits, location, useDebouncedValue) are clean; only geojson.ts:129 has a minor inconsistency (#9).

# Agent 3

Tech Debt Audit: screens / map / sheet / playArea / hidingZone / components / config / theme

1. Duplicated eligibility-mask pipeline (MainDrawer ↔ NativeMap)
   Severity: Critical
   MainDrawer.tsx:372-416 (MainSheetContent) and NativeMap.tsx:108-166 build the exact same buildCombinedEligibilityMask call — the same hit/miss constraint ordering across all 6 question types, the same asSeparateMaskConstraints decomposition, and the same load-bearing comment about transit-line circles needing union semantics. Two copies of the most polarity-sensitive geometry in the app. The AGENTS.md mask-polarity rule warns a single inverted constraint silently breaks elimination; here any future answer-path change must be mirrored in two files or they diverge — one drives the map overlay, the other drives the "Eliminated %" stat, so they would disagree without any error.
   Fix: Extract a single useCombinedEligibilityMask() hook (or selector over questionMapRenderState) returning the mask; have both NativeMap and MainSheetContent consume it. The mask polarity test then has one target.
2. MainDrawer is a god module mixing routing, animation, geometry, and HUD
   Severity: High
   MainDrawer.tsx (1041 lines) owns: a hand-rolled slide-transition state machine (beginTransition, dual useEffect animation drivers, transitionIdRef/startedTransitionIdRef/cleanupTimerRef, lines 78-203), the full route switch (271-341), the entire first-run + active-game HUD with elimination math (343-626), and three geometry helpers (featureCollectionArea, asSeparateMaskConstraints, formatElapsed). It imports buildCombinedEligibilityMask, geomAreaM2, and every question render-state — a navigation shell should not import geometry.
   Fix: Split into MainDrawer (route container + transition machine), MainSheetContent (own file), and move asSeparateMaskConstraints/featureCollectionArea into a shared geometry util (they're already duplicated with maskBuilder.ts). Target ~250 lines for the shell.
3. Hand-rolled navigation/animation state machine reinvents a router
   Severity: High
   MainDrawer.tsx:60-269 implements forward/back slide transitions manually with shared values, z-index juggling (getLeavingLayerStyle/getEnteringLayerStyle), a setTimeout cleanup tied to TRANSITION_MS, an id-based race guard, plus a parallel routeDepth map in sheetNav.ts:3-15 that must stay hand-synced with the SheetRouteName union and the getBackTarget switch. Three sources of truth (union, depth map, back-target switch) for one route graph; adding a route means editing all three plus renderRouteContent. The setTimeout cleanup is fragile — a fast double-navigation can leave transition stale if ids race.
   Fix: Encode the route graph as one data structure ({ name, parent }[]) and derive depth + back-target from it. Consider whether react-navigation/expo-router nested navigator could replace the bespoke transition machine, given Reanimated is already present.
4. HidingZoneScreen mixes data partitioning, an inline modal, and an absolute-positioned sub-screen
   Severity: High
   HidingZoneScreen.tsx (873 lines) holds 4 useState toggles, 4 derived useMemos, an inline radius Modal (294-351), and OperatorDrillDown (486-611) rendered as a full-screen position:absolute overlay (zIndex:10) — a screen-within-a-screen that bypasses the app's actual sheet routing in sheetRoutes.ts. Inline IIFEs in JSX (140-154, 224-237) for the operator summary and "selected elsewhere" filter hurt readability, and PresetSection vs the inline operator-section render two near-identical layouts.
   Fix: Promote OperatorDrillDown and the radius modal to their own components/sheet routes. Hoist the IIFE-derived values into useMemos. Unify the operator/coverage/browse sections through one PresetSection.
5. Pervasive as any casts erase type safety at geometry boundaries
   Severity: High
   15 as any casts in MainDrawer.tsx alone (all in the elimination useMemo, 376-413), plus geomAreaM2(feature.geometry as any) (642). The render-state feature collections and playArea.boundary are cast away precisely where polarity/shape correctness matters most. This defeats the compiler on the code most likely to silently break (per the mask-polarity rule).
   Fix: Align GeoJsonFeatureCollection / render-state types with what buildCombinedEligibilityMask and geomAreaM2 accept so the casts disappear; if a genuine variance exists, add one typed adapter rather than 15 inline anys.
6. PlayAreaScreen is a side-effect coordinator with brittle interdependent effects
   Severity: High
   PlayAreaScreen.tsx (579 lines) runs 6 useEffects plus 4 useRef "skip first render" guards (isFirstSelection, adminPresetInitialised, dismissedOsmId, plus focus/scroll timers). The offline-pack prompt effect (127-145), admin-preset auto-select effect (152-170), and install-result effect (172-186) are coupled through playArea.osmId and refs, with effect deps that omit referenced values (e.g. 170 omits installedPackInfos; 186 omits onNavigate/installMutation) — classic stale-closure / exhaustive-deps fragility. Magic timers (400, 100, 350) are scattered inline.
   Fix: Extract the offline-pack prompt and admin-preset auto-selection into dedicated hooks (useOfflinePackPrompt, useAutoAdminPreset) with explicit, complete deps. Move timer constants to appConfig. This screen should orchestrate hooks, not inline 6 effects.
7. console.log shipping in a hot derived-data path
   Severity: Medium
   hidingZone.ts:540-543 — getPresetPlayAreaStats logs station counts on every call. It's invoked from a useMemo keyed on [presets, playArea] (HidingZoneScreen.tsx:57-61), so it fires on every play-area/preset change in production. Noisy and a minor perf/PII-adjacent leak.
   Fix: Remove or gate behind **DEV**/a debug flag.
8. GeometryParityScreen ships in the route union with 4× copy-pasted state reducers
   Severity: Medium
   The dev parity screen is correctly **DEV**-gated at the entry point (SettingsScreen.tsx:223), but it's a permanent member of the SheetRouteName union, routeDepth, getBackTarget, and renderRouteContent (MainDrawer.tsx:306-311) — so production builds still bundle the screen and its parityHarness import graph unless tree-shaking is perfect, and every route-graph edit must carry the dead case. Internally, the 4 handlers (handleRunParity/Sweep/Fuzz/Stress, 58-210) duplicate the same ~12-line "merge into done base" reducer block verbatim.
   Fix: Either lazy-import the screen so it's fully excluded from production bundles, or accept it but extract the repeated setState((prev) => ...done base...) into one mergeDoneResult(partial) helper. Confirm parityHarness (with its fixtures) isn't pulled into the prod bundle.
9. Magic numbers for layout/animation bypass the config + theme system
   Severity: Medium
   The app has a thorough appConfig.ts and colors.ts, yet UI/animation constants stay inline: TRANSITION_MS=300, SHEET_WIDTH, swipe thresholds 80/500 (MainDrawer.tsx:61,198), camera padding factors 0.48/120/40 (camera.ts:75-78), timers 400/100/350 (PlayAreaScreen.tsx:39,76,82), and hardcoded hex #b42318 error red (PlayAreaScreen.tsx:484) / #d32f2f/#2e7d32 (GeometryParityScreen.tsx:433,467-468) instead of theme tokens. colors.ts has no error/success token despite three screens needing one.
   Fix: Add error/success/danger tokens to colors.ts; move animation/timer magic numbers into appConfig (a ui/animation section) where camera helpers already pull tuning.
10. Empty container: {} styles and dead style entries
    Severity: Low
    HidingZoneScreen.tsx:645 and PlayAreaScreen.tsx:470 both declare container: {} (empty) passed as style={styles.container} to SheetScrollView — confusing no-ops. MainDrawer styles include unused/orphan entries (actions, detail, header at 812-814, 864-869, 908-911 aren't referenced in the visible JSX). Minor bloat and reader confusion.
    Fix: Drop empty/unused style keys; if SheetScrollView needs no per-screen style, omit the prop.
11. Duplicated asSeparateMaskConstraints / pluralization / row patterns
    Severity: Low
    asSeparateMaskConstraints exists in both MainDrawer.tsx:647-655 and maskBuilder.ts (imported by NativeMap). Inline ${n} station${n===1?"":"s"} pluralization is repeated ~6 times across HidingZoneScreen and MainDrawer. The card/row Pressable pattern (styles.resultRow/presetRow/action with identical pressed?opacity handling) is re-implemented in 4 screens.
    Fix: Single shared asSeparateMaskConstraints (delete the MainDrawer copy), a pluralize(n, noun) util, and a shared <ListRow>/<PressableCard> component (one likely already partially exists as SheetListRow).
    Highest-impact first three
    Finding 1 — deduplicate the eligibility-mask pipeline (correctness risk, two divergent copies of polarity-sensitive geometry).
    Finding 2/3 — break up MainDrawer and consolidate the route graph into one source of truth.
    Finding 5 — remove the 15 as any casts at the geometry boundary so the compiler guards the riskiest code.
    Key files: /home/user/JetLagHideAndSeek/src/features/sheet/MainDrawer.tsx, /home/user/JetLagHideAndSeek/src/features/map/NativeMap.tsx, /home/user/JetLagHideAndSeek/src/features/hidingZone/HidingZoneScreen.tsx, /home/user/JetLagHideAndSeek/src/features/hidingZone/hidingZone.ts, /home/user/JetLagHideAndSeek/src/features/playArea/PlayAreaScreen.tsx, /home/user/JetLagHideAndSeek/src/features/sheet/sheetNav.ts, /home/user/JetLagHideAndSeek/src/features/sheet/GeometryParityScreen.tsx, /home/user/JetLagHideAndSeek/src/theme/colors.ts, /home/user/JetLagHideAndSeek/src/config/appConfig.ts.
    Note: MapAppScreen.tsx (111 lines) is genuinely still a thin coordinator — it holds only sheet/route refs and pin-placement wiring, delegating all geometry to hooks. It is the healthiest file in scope and does not violate the repo's god-object warning.

# Angles not yet researched

The following research subagents were not able to produce a report due to quota

- questions subsystem
- offline packs and data pipelines
