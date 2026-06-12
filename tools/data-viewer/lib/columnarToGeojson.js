/**
 * Columnar POI data → GeoJSON FeatureCollection converter.
 *
 * CJS module shared between server.mjs, build.mjs, and node --test suites.
 *
 * Pack POI bundles have this shape:
 *   { categories: { "<cat>": { count, lon[], lat[], name[], osmId[], osmType[], … } } }
 */
/* global window */
(function () {
    "use strict";

    /**
     * Convert a columnar POI category to a GeoJSON FeatureCollection.
     *
     * @param {string} category - category name
     * @param {object} cat - columnar data: { count, lon[], lat[], name[], osmId[], osmType[], iata?, nameLength? }
     * @returns {object} GeoJSON FeatureCollection
     */
    function categoryToFeatures(category, cat) {
        var features = [];
        for (var i = 0; i < cat.count; i++) {
            var feat = {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [cat.lon[i], cat.lat[i]],
                },
                properties: {
                    category: category,
                    name: cat.name[i] ?? null,
                    osmId: cat.osmId[i] ?? null,
                    osmType: cat.osmType[i] ?? null,
                },
            };
            if (cat.iata) {
                feat.properties.iata = cat.iata[i] ?? null;
            }
            if (cat.nameLength) {
                feat.properties.nameLength = cat.nameLength[i] ?? null;
            }
            features.push(feat);
        }
        return { type: "FeatureCollection", features: features };
    }

    /**
     * Convert all categories in a POI bundle to a single FeatureCollection.
     *
     * @param {object} poiBundle - the parsed POI bundle JSON
     * @returns {object} GeoJSON FeatureCollection with all POI features
     */
    function allCategoriesToFeatures(poiBundle) {
        var features = [];
        var cats = poiBundle.categories || {};
        var catKeys = Object.keys(cats);
        for (var ci = 0; ci < catKeys.length; ci++) {
            var category = catKeys[ci];
            var cat = cats[category];
            var fc = categoryToFeatures(category, cat);
            features = features.concat(fc.features);
        }
        return { type: "FeatureCollection", features: features };
    }

    var api = {
        categoryToFeatures: categoryToFeatures,
        allCategoriesToFeatures: allCategoriesToFeatures,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof window !== "undefined") {
        window.columnarToGeojson = api;
    }
})();
