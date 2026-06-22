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

type FixtureAssets = {
    transit: Record<string, unknown>;
    meta: Record<string, unknown>;
    manifest: Record<string, unknown>;
};

let fixtureAssetsOverride: FixtureAssets | null = null;

/** Test-only hook to avoid bundling real assets in Jest. */
export function __setFixtureAssetsForTest(assets: FixtureAssets): void {
    fixtureAssetsOverride = assets;
}

function loadFixtureAssets(): FixtureAssets {
    if (fixtureAssetsOverride) return fixtureAssetsOverride;

    return {
        transit: require("../../../assets/e2e-fixture/e2e-fixture/transit.json"),
        meta: require("../../../assets/e2e-fixture/e2e-fixture/meta.json"),
        manifest: require("../../../assets/e2e-fixture/e2e-fixture/manifest.json"),
    };
}

type InstalledArtifactEntry = {
    kind: "transit" | "meta" | "poi" | "measuring" | "boundaries";
    category?: string;
    bytes: number;
    status: "installed";
};

/**
 * Pre-install the bundled E2E fixture pack into the app's document directory
 * and register it through the production pack loading path. Gated by
 * {@link E2E_HOOKS_ENABLED}; no-ops in production.
 */
export async function installE2eFixturePack(): Promise<void> {
    if (!E2E_HOOKS_ENABLED) return;

    const { transit, meta, manifest } = loadFixtureAssets();

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

    const transitJson = JSON.stringify(transit);
    const transitFile = new File(PACK_DIR, "transit.json");
    await transitFile.create({ overwrite: true });
    await transitFile.write(transitJson);

    const metaJson = JSON.stringify(meta);
    const metaFile = new File(PACK_DIR, "meta.json");
    await metaFile.create({ overwrite: true });
    await metaFile.write(metaJson);

    await versionFile.create({ overwrite: true });
    await versionFile.write(versionMarker);

    const artifacts: InstalledArtifactEntry[] = [
        { kind: "transit", bytes: transitJson.length, status: "installed" },
        { kind: "meta", bytes: metaJson.length, status: "installed" },
    ];

    const installedPack = {
        id: FIXTURE_ID,
        osmSnapshot: meta.osmSnapshot ?? manifest.sourcePbfDate,
        installedAt: new Date().toISOString(),
        bbox: meta.bbox,
        artifacts,
    };

    const indexKey = OFFLINE.installedIndexKey;
    const raw = await AsyncStorage.getItem(indexKey);
    const index = raw ? JSON.parse(raw) : {};
    index[FIXTURE_ID] = installedPack;
    await AsyncStorage.setItem(indexKey, JSON.stringify(index));

    log.debug("E2E fixture pack installed");
}
