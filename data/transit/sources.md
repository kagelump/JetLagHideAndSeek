# Transit Data Sources

This file tracks the provenance of each data source used by the transit
pipeline. For attribution and licensing, see the generated `NOTICE.md`.

## GTFS Feeds

### Tokyo Metro

- **Source:** Public Transportation Open Data Center (ODPT) authenticated API
- **URL:** `https://api.odpt.org/api/v4/files/TokyoMetro/data/TokyoMetro-Train-GTFS.zip`
- **Requires key:** Yes (`ODPT_KEY` environment variable)
- **License:** ODPT terms — see `NOTICE.md`
- **Notes:** Station-per-line modeling; lines are already route-granular so
  `lineGrouping: route_id` is used.

### Toei Subway

- **Source:** ODPT public file API
- **URL:** `https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip`
- **Requires key:** No
- **License:** ODPT terms — see `NOTICE.md`
- **Notes:** Same per-line granularity as Tokyo Metro.

## Future Sources

Additional GTFS feeds (JR East, JR West, etc.) will be added via the Mobility
Database catalog or operator-specific URLs. See the feeds playbook (T9) for the
process.
