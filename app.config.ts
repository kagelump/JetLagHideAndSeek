import { withAppDelegate } from "expo/config-plugins";

function envValue(name: string, fallback: string) {
    const value = process.env[name]?.trim();
    return value ? value : fallback;
}

const appLinkDomain = envValue(
    "EXPO_PUBLIC_APP_LINK_DOMAIN",
    "jetlag.hinoka.org",
);
const shouldUseAssociatedDomains =
    process.env.E2E_DISABLE_IOS_ASSOCIATED_DOMAINS !== "1";
const isE2eBuild = process.env.EXPO_PUBLIC_E2E_HOOKS === "1";

// E2E-only: stop the iOS dev-client dev menu from auto-showing its onboarding.
// That onboarding renders in a SEPARATE native window XCUITest/Maestro cannot
// query (its text can't be asserted/tapped) yet it obscures the bottom sheet,
// so the app's home button is unhittable until it is dismissed. It re-appears
// every flow because Maestro's `clearState` wipes the UserDefault that records
// "onboarding seen" (registered default = false → `shouldShowOnboarding()` is
// true → dev menu launches on start). Re-set that flag at the very top of
// `didFinishLaunchingWithOptions` — it runs on every launch, after clearState
// and before the RN bridge / DevMenuManager initialize, so the onboarding never
// shows. Gated on EXPO_PUBLIC_E2E_HOOKS so human dev-client builds are
// unaffected. See e2e/bootstrap.yaml.
const DEV_MENU_ANCHOR = "    let delegate = ReactNativeDelegate()";
function withDevMenuOnboardingDisabled(config: { [key: string]: unknown }) {
    return withAppDelegate(config, (cfg) => {
        const contents: string = cfg.modResults.contents;
        if (contents.includes("EXDevMenuIsOnboardingFinished")) {
            return cfg; // idempotent
        }
        if (!contents.includes(DEV_MENU_ANCHOR)) {
            console.warn(
                "[withDevMenuOnboardingDisabled] AppDelegate anchor not found; " +
                    "dev-menu onboarding suppression NOT applied (E2E may flake).",
            );
            return cfg;
        }
        cfg.modResults.contents = contents.replace(
            DEV_MENU_ANCHOR,
            "    // E2E: suppress dev-menu onboarding (see app.config.ts)\n" +
                '    UserDefaults.standard.set(true, forKey: "EXDevMenuIsOnboardingFinished")\n' +
                DEV_MENU_ANCHOR,
        );
        return cfg;
    });
}

export default ({ config }) => {
    const merged = {
        ...config,
        extra: {
            ...config.extra,
            appLinkBaseUrl: `https://${appLinkDomain}`,
        },
        ios: (() => {
            // associatedDomains is owned ENTIRELY here (not in app.json) so the
            // E2E gate can fully strip it. An associated-domains entitlement
            // forces a signed iOS build, which breaks the unsigned CI simulator
            // build. Defensively drop any inherited value before re-adding when
            // enabled.
            const { associatedDomains: _drop, ...iosBase } = config.ios ?? {};
            void _drop; // stripped below — only used to exclude the key from iosBase
            return shouldUseAssociatedDomains
                ? {
                      ...iosBase,
                      associatedDomains: [`applinks:${appLinkDomain}`],
                  }
                : iosBase;
        })(),
        android: {
            ...config.android,
            intentFilters: [
                {
                    action: "VIEW",
                    autoVerify: true,
                    category: ["BROWSABLE", "DEFAULT"],
                    data: [
                        {
                            host: appLinkDomain,
                            pathPrefix: "/i",
                            scheme: "https",
                        },
                    ],
                },
            ],
        },
    };

    return isE2eBuild ? withDevMenuOnboardingDisabled(merged) : merged;
};
