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

export default ({ config }) => ({
    ...config,
    extra: {
        ...config.extra,
        appLinkBaseUrl: `https://${appLinkDomain}`,
    },
    ios: (() => {
        // associatedDomains is owned ENTIRELY here (not in app.json) so the
        // E2E gate can fully strip it. An associated-domains entitlement forces
        // a signed iOS build, which breaks the unsigned CI simulator build.
        // Defensively drop any inherited value before re-adding when enabled.
        const { associatedDomains: _drop, ...iosBase } = config.ios ?? {};
        void _drop; // stripped below — only used to exclude the key from iosBase
        return shouldUseAssociatedDomains
            ? { ...iosBase, associatedDomains: [`applinks:${appLinkDomain}`] }
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
});
