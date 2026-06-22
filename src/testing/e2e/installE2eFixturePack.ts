import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { OFFLINE } from "@/config/appConfig";
import { createLogger } from "@/shared/logger";

import { E2E_HOOKS_ENABLED } from "./isE2eHooksEnabled";

const log = createLogger("e2eFixturePack");

const FIXTURE_ID = "e2e-fixture";
const PACK_DIR = new Directory(
    new Directory(Paths.document, "packs"),
    FIXTURE_ID,
);

type ArtifactKind = "transit" | "meta" | "poi" | "measuring" | "boundaries";

/**
 * Map of artifact filename → parsed JSON content. Keys match the filenames
 * listed in manifest.json.artifacts, plus meta.json (always required).
 */
type FixtureBundle = Record<string, Record<string, unknown>>;

let fixtureAssetsOverride: FixtureBundle | null = null;

/** Test-only hook to avoid bundling real assets in Jest. */
export function __setFixtureAssetsForTest(assets: FixtureBundle): void {
    fixtureAssetsOverride = assets;
}

function loadFixtureBundle(): FixtureBundle {
    if (fixtureAssetsOverride) return fixtureAssetsOverride;

    const bundle: FixtureBundle = {
        "transit.json": require("../../../assets/e2e-fixture/e2e-fixture/transit.json"),
        "meta.json": require("../../../assets/e2e-fixture/e2e-fixture/meta.json"),
        "manifest.json": require("../../../assets/e2e-fixture/e2e-fixture/manifest.json"),
    };

    // F2 — measuring artifacts (conditionally bundled).
    const manifest = bundle["manifest.json"] as Record<string, unknown>;
    const artifactNames = Object.keys(
        (manifest.artifacts as Record<string, unknown>) ?? {},
    );

    // Each artifact listed in the manifest must have a matching require().
    // F2/F3 artifacts are tried; missing ones (not yet built / F1-only) are
    // silently skipped.
    for (const filename of artifactNames) {
        if (bundle[filename]) continue; // already loaded above
        try {
            bundle[filename] = require(
                `../../../assets/e2e-fixture/e2e-fixture/${filename}`,
            );
        } catch {
            // Artifact not yet committed (e.g. poi.json before F3 rebuild).
        }
    }

    return bundle;
}

type InstalledArtifactEntry = {
    kind: ArtifactKind;
    category?: string;
    bytes: number;
    status: "installed";
};

function kindFromFilename(filename: string): ArtifactKind {
    if (filename.startsWith("measuring-")) return "measuring";
    if (filename === "transit.json") return "transit";
    if (filename === "meta.json") return "meta";
    if (filename === "boundaries.json") return "boundaries";
    if (filename === "poi.json") return "poi";
    return "meta"; // fallback
}

/**
 * Pre-install the bundled E2E fixture pack into the app's document directory
 * and register it through the production pack loading path. Gated by
 * {@link E2E_HOOKS_ENABLED}; no-ops in production.
 *
 * Does NOT call loadInstalledPacks() — the caller (AppStateProviders) owns
 * that single call after this function completes.
 */
export async function installE2eFixturePack(): Promise<void> {
    if (!E2E_HOOKS_ENABLED) return;

    const bundle = loadFixtureBundle();
    const manifest = bundle["manifest.json"] as Record<string, unknown>;
    const meta = bundle["meta.json"] as Record<string, unknown>;
    const artifactFiles = Object.keys(
        (manifest.artifacts as Record<string, unknown>) ?? {},
    );

    const versionFile = new File(PACK_DIR, "version");
    const versionMarker = `${manifest.id}@${manifest.version ?? 0}:${manifest.sourcePbfDate}`;

    if (versionFile.exists) {
        try {
            const current = await versionFile.text();
            if (current === versionMarker) {
                log.debug("E2E fixture pack already installed");
                return;
            }
        } catch {
            // ignore read failure and reinstall
        }
    }

    if (PACK_DIR.exists) {
        try {
            await PACK_DIR.delete();
        } catch {
            // best-effort
        }
    }
    await PACK_DIR.create({ intermediates: true });

    // Write every artifact declared in the manifest.
    const artifacts: InstalledArtifactEntry[] = [];
    for (const filename of artifactFiles) {
        const content = bundle[filename];
        if (!content) continue;

        const json = JSON.stringify(content);
        const file = new File(PACK_DIR, filename);
        await file.create({ overwrite: true });
        await file.write(json);

        artifacts.push({
            kind: kindFromFilename(filename),
            bytes: json.length,
            status: "installed",
        });
    }

    // Always write meta.json (not listed in manifest.artifacts but required).
    if (!artifactFiles.includes("meta.json")) {
        const metaJson = JSON.stringify(meta);
        const metaFile = new File(PACK_DIR, "meta.json");
        await metaFile.create({ overwrite: true });
        await metaFile.write(metaJson);
        artifacts.push({
            kind: "meta",
            bytes: metaJson.length,
            status: "installed",
        });
    }

    await versionFile.create({ overwrite: true });
    await versionFile.write(versionMarker);

    const installedPack = {
        id: FIXTURE_ID,
        osmSnapshot:
            (meta.osmSnapshot as string) ?? (manifest.sourcePbfDate as string),
        installedAt: new Date().toISOString(),
        bbox: manifest.bbox,
        artifacts,
    };

    const indexKey = OFFLINE.installedIndexKey;
    const raw = await AsyncStorage.getItem(indexKey);
    const index = raw ? JSON.parse(raw) : {};
    index[FIXTURE_ID] = installedPack;
    await AsyncStorage.setItem(indexKey, JSON.stringify(index));

    log.debug("E2E fixture pack installed");
}
