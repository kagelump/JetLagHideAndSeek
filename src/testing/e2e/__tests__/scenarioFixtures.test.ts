import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { e2eScenarioSchema } from "../scenarioSchema";

// Guards every committed scenario fixture against the schema, so an authoring
// typo fails in Jest rather than on-device (the route would otherwise just
// render `e2e-error:parse:schema-invalid`). Also the link builder + stack
// injection assume these parse.
const scenariosDir = join(process.cwd(), "e2e", "scenarios");
const files = readdirSync(scenariosDir).filter((f) => f.endsWith(".json"));

describe("e2e/scenarios fixtures", () => {
    it("ships at least one scenario", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)("%s validates against e2eScenarioSchema", (file) => {
        const json = JSON.parse(
            readFileSync(join(scenariosDir, file), "utf8"),
        ) as unknown;
        const result = e2eScenarioSchema.safeParse(json);
        if (!result.success) {
            throw new Error(`${file} is invalid:\n${result.error.message}`);
        }
        expect(result.success).toBe(true);
    });
});
