import { z } from "zod";

// Reuse the FULL-key wire schemas (not the minified codec variants). A scenario
// authors play area / hiding zones / questions in exactly the shape `applyImport`
// already understands, so `applyE2eScenario` needs no extra modeling. This schema
// is deliberately SEPARATE from `wireEnvelopeSchema`: it is un-minified, free to
// evolve, ships behind the E2E gate, and carries non-shareable test controls.
import {
    adminDivisionsWireSchema,
    hidingZonesWireSchema,
    playAreaWireSchema,
    questionWireSchema,
} from "@/sharing/wire/schema";

export const e2eControlsSchema = z.object({
    /** Force the geometry backend on-device. Omit to leave app config. */
    geometryBackend: z.enum(["auto", "js", "geos"]).optional(),
    /** Override the simulated device location as `[lon, lat]`. */
    location: z.tuple([z.number(), z.number()]).optional(),
    /** Show the debug-readout overlay (default true for e2e links). */
    showReadout: z.boolean().default(true),
});

export const e2eExpectSchema = z.object({
    totalPctMin: z.number().optional(),
    totalPctMax: z.number().optional(),
});

export const e2eScenarioSchema = z.object({
    kind: z.literal("e2e-scenario"),
    /** Free-form name, surfaced in the readout for flow debugging. */
    name: z.string().min(1),
    controls: e2eControlsSchema.default({ showReadout: true }),
    state: z.object({
        adminDivisions: adminDivisionsWireSchema.optional(),
        hidingZones: hidingZonesWireSchema.optional(),
        playArea: playAreaWireSchema.optional(),
        questions: z.array(questionWireSchema).optional(),
    }),
    /**
     * Optional expectations a flow may also assert in YAML. Recorded in the
     * readout so a failing flow shows expected-vs-actual side by side.
     */
    expect: e2eExpectSchema.optional(),
});

export type E2eControls = z.infer<typeof e2eControlsSchema>;
export type E2eExpect = z.infer<typeof e2eExpectSchema>;
export type E2eScenario = z.infer<typeof e2eScenarioSchema>;
