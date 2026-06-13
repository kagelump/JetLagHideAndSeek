/* screens.jsx — the bottom-sheet route contents for the app kit.
   Composes the design-system primitives from the compiled bundle. */
const {
    Button,
    Chip,
    Badge,
    Eyebrow,
    SectionHeading,
    Card,
    SegmentedControl,
    Switch,
    TextField,
    ListRow,
} = window.HideSeekMapperDesignSystem_ee69a9;

const OPERATORS = [
    {
        id: "tokyo-metro",
        name: "Tokyo Metro",
        meta: "9 lines · 180 stations",
        color: "#2d7dd2",
        suggested: true,
    },
    {
        id: "toei",
        name: "Toei Subway",
        meta: "4 lines · 106 stations",
        color: "#1f6f78",
        suggested: true,
    },
    {
        id: "yamanote",
        name: "JR Yamanote Line",
        meta: "1 line · 30 stations",
        color: "#1f8a5b",
        suggested: true,
    },
    {
        id: "keio",
        name: "Keiō Line",
        meta: "3 lines · 69 stations",
        color: "#9b1f6e",
        suggested: false,
    },
    {
        id: "odakyu",
        name: "Odakyū Line",
        meta: "3 lines · 47 stations",
        color: "#f29f05",
        suggested: false,
    },
];

const Dot = ({ c }) => (
    <span
        style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: c,
            display: "inline-block",
        }}
    />
);

/* ── shared header row for child sheets ── */
function BackRow({ title, onBack, accessory }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                minHeight: 44,
                gap: 8,
            }}
        >
            <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                style={{ padding: "4px 4px", marginLeft: -4 }}
            >
                ‹ Back
            </Button>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    textAlign: "center",
                    pointerEvents: "none",
                    fontSize: "var(--text-body)",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                }}
            >
                {title}
            </div>
            <div style={{ flex: 1 }} />
            {accessory}
        </div>
    );
}

/* ── MAIN: first-run welcome OR live game HUD ── */
function MainSheet(props) {
    const { configured, area, questions, stations, hider } = props;
    if (!configured) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                    <Eyebrow>Hide &amp; Seek Mapper</Eyebrow>
                    <h1
                        style={{
                            fontSize: "var(--text-title)",
                            fontWeight: 800,
                            margin: "6px 0 8px",
                            color: "var(--text-primary)",
                        }}
                    >
                        Set up your game
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            fontSize: "var(--text-body)",
                            lineHeight: 1.45,
                            color: "var(--text-secondary)",
                        }}
                    >
                        You're the seeker. Ask the hider questions, record their
                        answers, and watch the map narrow down where they can
                        be.
                    </p>
                </div>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                    }}
                >
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={props.onSetup}
                    >
                        Set up a game
                    </Button>
                    <Button
                        variant="subtle"
                        size="lg"
                        fullWidth
                        onClick={props.onJoin}
                    >
                        Join a game
                    </Button>
                </div>
                <p
                    style={{
                        margin: 0,
                        textAlign: "center",
                        fontSize: "var(--text-meta)",
                        color: "var(--text-secondary)",
                    }}
                >
                    …or just explore the map.
                </p>
            </div>
        );
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div>
                    <Eyebrow>Current game</Eyebrow>
                    <div
                        style={{
                            fontSize: "var(--text-title)",
                            fontWeight: 800,
                            marginTop: 2,
                            color: "var(--text-primary)",
                        }}
                    >
                        {area}
                    </div>
                </div>
                <Chip tone="mode" leadingDot onClick={props.onToggleMode}>
                    {hider ? "Hider" : "Seeker"}
                </Chip>
            </div>
            <Card
                style={{
                    display: "flex",
                    justifyContent: "space-around",
                    textAlign: "center",
                    padding: "14px 12px",
                }}
            >
                {[
                    ["Questions", questions],
                    ["Stations left", stations],
                    ["Operators", 2],
                ].map(([k, v]) => (
                    <div key={k}>
                        <div
                            style={{
                                fontSize: 26,
                                fontWeight: 900,
                                fontVariantNumeric: "tabular-nums",
                                color: "var(--text-primary)",
                            }}
                        >
                            {v}
                        </div>
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 800,
                                letterSpacing: ".4px",
                                textTransform: "uppercase",
                                color: "var(--text-secondary)",
                                marginTop: 2,
                            }}
                        >
                            {k}
                        </div>
                    </div>
                ))}
            </Card>
            <div style={{ display: "flex", gap: 10 }}>
                <Button
                    variant="primary"
                    fullWidth
                    onClick={props.onAddQuestion}
                >
                    + Add Question
                </Button>
                <Button variant="subtle" onClick={props.onShare}>
                    Re-share
                </Button>
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 2,
                }}
            >
                <ListRow
                    title="Questions"
                    description={`${questions} asked · tap to review`}
                    onClick={props.onQuestions}
                />
                <ListRow
                    title="Settings"
                    description="Play area, hiding zones, sharing"
                    onClick={props.onOpenSettings}
                />
            </div>
        </div>
    );
}

/* ── SETTINGS (setup hub) ── */
function SettingsSheet(props) {
    return (
        <div>
            <BackRow
                title="Settings"
                onBack={props.onBack}
                accessory={
                    <Button variant="primary" size="sm" onClick={props.onShare}>
                        Share
                    </Button>
                }
            />
            <SectionHeading style={{ marginTop: 14, marginBottom: 8 }}>
                Set up your game
            </SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ListRow
                    title="Play Area"
                    description={`${props.area} · bundled`}
                    trailing={<Badge tone="success">✓</Badge>}
                    onClick={props.onPlayArea}
                />
                <ListRow
                    title="Hiding Zones"
                    description={
                        props.zonesSet
                            ? "2 operators · 286 stations"
                            : "Pick eligible transit stations"
                    }
                    trailing={
                        props.zonesSet ? (
                            <Badge tone="success">✓</Badge>
                        ) : undefined
                    }
                    onClick={props.onHidingZone}
                />
                <ListRow
                    title="Offline Data"
                    description="Download offline POI packs for matching."
                    onClick={() => {}}
                />
            </div>
            <SectionHeading style={{ marginTop: 22, marginBottom: 8 }}>
                Mode
            </SectionHeading>
            <ListRow
                title="Hider Mode"
                description="Opening a shared question link answers it from your current location"
                trailing={
                    <Switch
                        checked={props.hider}
                        onChange={props.onToggleMode}
                    />
                }
            />
            <SectionHeading style={{ marginTop: 22, marginBottom: 8 }}>
                Display
            </SectionHeading>
            <ListRow
                title="English Labels"
                description="Show POI names in English when available"
                trailing={
                    <Switch
                        checked={props.english}
                        onChange={props.onToggleEnglish}
                    />
                }
            />
            <SectionHeading style={{ marginTop: 22, marginBottom: 8 }}>
                Maintenance
            </SectionHeading>
            <ListRow
                title="Reset Game"
                description="Clears all questions and resets your play area and hiding zones."
                destructive
                onClick={() => {}}
            />
            <div
                style={{
                    borderTop: "1px solid var(--border-default)",
                    marginTop: 22,
                    paddingTop: 16,
                }}
            >
                <SectionHeading>Data &amp; Attribution</SectionHeading>
                <p
                    style={{
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: "var(--text-secondary)",
                        marginTop: 8,
                    }}
                >
                    Map &amp; POI data © OpenStreetMap contributors, licensed
                    under ODbL. Transit presets from ODPT.
                </p>
            </div>
        </div>
    );
}

/* ── PLAY AREA ── */
function PlayAreaSheet(props) {
    return (
        <div>
            <BackRow title="Play Area" onBack={props.onBack} />
            <p
                style={{
                    fontSize: "var(--text-meta)",
                    color: "var(--text-secondary)",
                    margin: "12px 0 12px",
                }}
            >
                Where are you playing? Search a city or pick a bundled area.
            </p>
            <TextField
                leading="⌕"
                placeholder="Search a city or region"
                value={props.q}
                onChange={props.setQ}
            />
            <SectionHeading style={{ marginTop: 20, marginBottom: 8 }}>
                Bundled areas
            </SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ListRow
                    title="Tokyo 23 Wards"
                    description="Default · offline POIs available"
                    active
                    trailing={<Badge tone="accent">In use</Badge>}
                    onClick={props.onBack}
                />
                <ListRow
                    title="Osaka"
                    description="Offline POIs available"
                    onClick={props.onBack}
                />
            </div>
            <details style={{ marginTop: 18 }}>
                <summary
                    style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--text-link)",
                        cursor: "pointer",
                    }}
                >
                    Advanced
                </summary>
                <div style={{ marginTop: 10 }}>
                    <TextField
                        inputMode="numeric"
                        placeholder="OSM relation ID"
                        trailing={<Badge>OSM</Badge>}
                    />
                </div>
            </details>
        </div>
    );
}

/* ── HIDING ZONES ── */
function HidingZoneSheet(props) {
    return (
        <div>
            <BackRow title="Hiding Zones" onBack={props.onBack} />
            <p
                style={{
                    fontSize: "var(--text-meta)",
                    color: "var(--text-secondary)",
                    margin: "12px 0 14px",
                }}
            >
                Pick which transit stations the hider can be near.
            </p>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 16,
                }}
            >
                <span
                    style={{
                        fontSize: "var(--text-row)",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                    }}
                >
                    Radius
                </span>
                <SegmentedControl
                    options={["300m", "600m", "1km", "2km"]}
                    value={props.radius}
                    onChange={props.setRadius}
                />
            </div>
            <SectionHeading style={{ marginBottom: 8 }}>
                Suggested operators
            </SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {OPERATORS.filter((o) => o.suggested).map((o) => {
                    const on = props.selected.includes(o.id);
                    return (
                        <ListRow
                            key={o.id}
                            title={o.name}
                            description={o.meta}
                            active={on}
                            leading={<Dot c={o.color} />}
                            trailing={
                                <Chip
                                    tone={on ? "accent" : "default"}
                                    selected={on}
                                >
                                    {on ? "Added ✓" : "Add"}
                                </Chip>
                            }
                            onClick={() => props.toggle(o.id)}
                        />
                    );
                })}
            </div>
            <SectionHeading style={{ marginTop: 22, marginBottom: 8 }}>
                Browse all regions
            </SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {OPERATORS.filter((o) => !o.suggested).map((o) => {
                    const on = props.selected.includes(o.id);
                    return (
                        <ListRow
                            key={o.id}
                            title={o.name}
                            description={o.meta}
                            active={on}
                            leading={<Dot c={o.color} />}
                            trailing={
                                <Chip
                                    tone={on ? "accent" : "default"}
                                    selected={on}
                                >
                                    {on ? "Added ✓" : "Add"}
                                </Chip>
                            }
                            onClick={() => props.toggle(o.id)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

Object.assign(window, {
    MainSheet,
    SettingsSheet,
    PlayAreaSheet,
    HidingZoneSheet,
    BackRow,
});
