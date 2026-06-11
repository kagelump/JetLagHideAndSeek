## Settings

### Play Area

- Admin level should default to country of play area
- Should automatic find and download offline data pack for the play area (or loudly error if it doesn't exist)
    - Error can be like a permanent red (!) on the settings when offline pack isn't downloaded for play area

### Hiding zones

## Train lines

- OSM based train lines (eg JR East) rendering is super broken.
- Add all of the other Tokyo transit lines, see if we can cover all Japan with some generic way (WIP, has bugs)

### Offline data

- Actually support offline data packs

### Other

## Questions - Overall

- Set to my location button should be smaller or placed in a better location.
- Tap to set pin should be reversed, tap + hold to set pin instead (assuming there isn't another pin nearby)
    - This is partially implemented, but it should be set on lift, so it doesn't interfere with panning the map.
- Add some sort of loading / calculating animation when work (masking, etc) is being done.
- Delta encode bundles docs/tasks/admin-boundaries-delta-encoding.md

## Thermometer

- There shouldn't be the Active Pin: Start/End system. Press+hold drag should just be based on which one is closer to the press.
- The two pins should have two different colors
- Start/End position sections taking too much verticle space.
- Nice to have: Label on top of the line. Eg <1 km, 1km, 5km, 15km, 75km.
- Even for N/A, it would be nice to have a dotted preview line (chopped at play area)
- I think now that we moves to GEOS this render should be cheap, maybe we can render the mask while moving the pin?

## Tentacles

- Must load all POIs in play area
- Aquarium / Amusement Park overflows weirdly. We should use carousels for category items

## Measuring

## Android Issues

- UI flicker when clicking into a menu item
- Back button doesn't always seem to work from question deatils sheet (swipe to go back works)
- Questions -> [Radar|Measuring|Tenticles] Very long delay or just doesn't work

## Viewer

- Add toggles for turn on layers (also will need to cluster layers, eg POI, etc)

## Extra Polish

- Nice logos
- Add casting costs to question details
