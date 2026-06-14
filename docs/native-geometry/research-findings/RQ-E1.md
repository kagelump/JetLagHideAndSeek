# RQ-E1 — Do the two infra fixes make the one smoke flow green on CI?

- Owner: Claude (pairing w/ Ryan) Date: 2026-06-14 Time spent: ~0.5 day
- Result: **PARTIAL** — both fixes implemented and verified locally; the
  green-on-CI-×2 confirmation needs a `gh workflow run` (outward-facing, costs CI
  minutes), handed off to the maintainer.
- One-line answer: The flow reduction already happened (commit `c6f2362`); the
  two app-build blockers are real and now fixed — `native-geometry` is a declared
  `link:` dep (so `pnpm install --frozen-lockfile` creates the symlink on CI) and
  the iOS associated-domains entitlement is now fully strippable by the E2E gate
  (it was leaking from `app.json` past the gate in `app.config.ts`).

## What we changed (branch: research/RQ-A1-ios-standalone)

1. **Android Metro resolution.** `native-geometry` was only a stray
   `node_modules/native-geometry` symlink, absent from `package.json` and
   `pnpm-lock.yaml` (0 refs) — so a clean CI `pnpm install --frozen-lockfile`
   never created it and Android Metro couldn't bundle it.
    - Added `"native-geometry": "link:./modules/native-geometry"` to
      `package.json` dependencies.
    - Ran `pnpm install`, then `npx prettier --write pnpm-lock.yaml` (the repo
      commits a prettier-formatted lockfile; raw `pnpm install` reformats it to
      pnpm's native style → a spurious 29k-line diff. Re-prettifying reduces the
      real diff to **3 lines**).
2. **iOS associated-domains gate.** `app.config.ts` has a
   `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS` gate, but `app.json` _also_ hardcoded
   `ios.associatedDomains`, which leaked through `...config.ios` regardless of the
   gate — forcing a signed iOS build that breaks the unsigned CI sim build.
    - Removed `associatedDomains` from `app.json` (now owned entirely by
      `app.config.ts`).
    - Made the gate defensive: it destructures and drops any inherited
      `associatedDomains`, re-adding it only when enabled.

## Evidence (local)

```
# Lockfile is CI-consistent and minimal:
$ pnpm install --frozen-lockfile        → Done, exit 0
$ git diff --stat pnpm-lock.yaml         → 1 file changed, 3 insertions(+)
  +            native-geometry:
  +                specifier: link:./modules/native-geometry
  +                version: link:modules/native-geometry

# iOS gate now actually strips the entitlement:
$ npx expo config --type public | grep associatedDomains
      associatedDomains: [ 'applinks:jetlag.hinoka.org' ]      # default: present
$ E2E_DISABLE_IOS_ASSOCIATED_DOMAINS=1 npx expo config ... | grep -c associatedDomains
  0                                                            # gate on: ABSENT

# Source changes are clean:
$ npx prettier --check app.config.ts app.json package.json    → all pass
$ pnpm typecheck                                               → pass
```

Cross-checked against `.github/workflows/maestro-e2e.yml`: both Android (L80) and
iOS (L140) run `pnpm install --frozen-lockfile`; the iOS "Build and install dev
client" step sets `E2E_DISABLE_IOS_ASSOCIATED_DOMAINS: "1"` (L171) before `expo
prebuild` + `expo run:ios`. With `app.json` cleaned, prebuild now emits
entitlements without associated-domains, so the sim build needs no signing team.
The workflow's `flow` input already offers `smoke`.

## What's left (hand-off)

The terminal goal — "one smoke flow green on both platforms ×2 (flake check)" —
requires running the workflow, which costs CI minutes and is outward-facing.
Trigger when ready:

```bash
gh workflow run "Maestro E2E" --ref research/RQ-A1-ios-standalone -f platform=all -f flow=smoke
gh run watch     # run twice for the flake check
```

If iOS still demands signing after this, the belt-and-suspenders is to pass
`CODE_SIGNING_ALLOWED=NO` to the build — but `expo run:ios` doesn't forward it
cleanly, so prefer confirming the entitlement is gone in the prebuilt
`ios/*.entitlements` first (the local `expo config` check above already proves
the source of truth is correct).

## Follow-ups / new risks

- **Pre-existing lockfile hygiene issue:** the committed `pnpm-lock.yaml` is
  prettier-formatted; any contributor running bare `pnpm install` will produce a
  giant reformatting diff unless they re-prettify. Consider a pre-commit hook or
  `.prettierignore` decision (out of scope here; noted for the maintainer).
- These edits (`package.json`, `app.json`, `app.config.ts`, `pnpm-lock.yaml`) are
  real fixes, not spike throwaway — they should graduate to a proper PR
  independent of the spike branch.
