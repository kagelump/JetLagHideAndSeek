import { defineConfig } from "@playwright/test";

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

export default defineConfig({
    testDir: "./e2e",
    webServer: {
        command:
            "lsof -ti:8787 | xargs kill -9 2>/dev/null || true; pnpm start:app",
        url: "http://localhost:8787/JetLagHideAndSeek/",
        timeout: 120_000,
        reuseExistingServer,
    },
    use: { baseURL: "http://localhost:8787/JetLagHideAndSeek/" },
});
