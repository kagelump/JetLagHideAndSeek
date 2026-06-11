# GTFS Feed Playbook

Repeatable process for adding an operator's GTFS feed. If any step requires
touching pipeline code, the pipeline is missing a generic feature — stop and
file it against the design doc instead of special-casing.

See `docs/tasks/transit-expansion/09-add-gtfs-feeds-playbook.md` for the full
version. This file is the quick-reference checklist.

## Per-feed checklist

1. **Find the feed.** Search the Mobility Database catalog
   (https://mobilitydatabase.org). Record the `mdb-<id>` and direct download
   URL. Prefer the most official source.

2. **License check (blocking).** Read the feed's terms. CC-BY / ODPT-style
   attribution terms are fine; NC or no-redistribution terms are **not**
   (we commit derived data). Record the verdict in the config `license` field
   and `data/transit/sources.md`.

3. **Inspect the feed** (unzip into `data/transit/cache/`):

    - `routes.txt`: `route_type`s present? → choose `routeTypes` allowlist.
      Directional variants with one `route_short_name`? → `lineGrouping: short_name`.
    - `stops.txt`: `parent_station` used? (Pipeline handles it.)
    - `agency.txt`: multiple agencies? → `presets:` split list.
    - `translations.txt` present? (English names for free.)

4. **Config entry.** Add to `locales[japan].gtfs` in `config.yaml`:

    ```yaml
    - id: <feed-id>
      label: <display name>
      namespace: <unique-ns> # never reuse — lineIds are persisted
      url: "<download-url>"
      requiresKey: false
      lineGrouping: short_name # or route_id for line-granular feeds
      routeTypes: [0, 1, 2, [100, 117], [400, 404]]
      defaultColor: "#<hex>"
      license: "<terms>"
    ```

5. **Operator declaration.** Add to `locales[japan].operators`:

    ```yaml
    - match: { gtfsNamespace: <ns>, osmOperator: ["<ja-name>", "<en-name>"] }
      routeSource: gtfs
    ```

    Copy `osmOperator` strings from the T6 build report's operator list.

6. **Run + review.** `pnpm data:transit`. Check the build report for:

    - Operator's OSM lines dropped (no I3 doubles)
    - Near-miss list triaged
    - Plausible line count

7. **Spot-check in app.** Play area covering the operator; transit-line
   question at a known transfer station lists expected lines.

8. **Commit** regenerated `assets/transit/`, config, `NOTICE.md`, `sources.md`.

## JR East (next feed)

The build report lists JR East as the largest operator in Kantō with no line
source. Follow this playbook to add the JR East GTFS feed. Key facts:

- **Mobility DB**: search for "JR East" at https://mobilitydatabase.org
- **Routes**: ~70+ lines (check — if single digits, mode filter is wrong)
- **Config**: `lineGrouping: short_name`, `routeTypes: [0, 1, 2, [100, 117]]`
  (includes Shinkansen via extended rail types)
- **Operator**: `osmOperator: ["JR東日本", "East Japan Railway Company"]`

## Future locales

The same playbook works for London (TfL), Taipei (TDX/MOTC), SF Bay Area
(511.org + agency split), and Schengen NAP feeds — plus a new `locales:` entry
the first time a locale is touched.
