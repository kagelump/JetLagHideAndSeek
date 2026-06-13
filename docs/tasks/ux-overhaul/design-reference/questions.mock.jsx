/* questions.jsx — the heart of the app: the question sheets, rebuilt as
   compact, teal-accented, 42%-resting screens. Primary control + answer stay
   above the fold; the map behind reacts live. Composes DS primitives. */
const {
  SheetHeader, AnswerSelector, ChipGroup, QuestionMeta, ListRow,
  Button, Badge, Chip, Card, SegmentedControl, SectionHeading, Eyebrow,
} = window.HideSeekMapperDesignSystem_ee69a9;

const QTYPES = [
  { id: "radar", title: "Radar", detail: "Preview a distance from a movable map pin.", cost: "Draw 2, pick 1", time: "5 min" },
  { id: "matching", title: "Matching", detail: "Compare nearest candidates from a movable map pin.", cost: "Draw 2, pick 1", time: "5 min" },
  { id: "thermometer", title: "Thermometer", detail: "Compare whether movement is hotter or colder.", cost: "Draw 2, pick 1", time: "5 min" },
  { id: "measuring", title: "Measuring", detail: "Compare distance to a selected place or boundary.", cost: "Draw 3, pick 1", time: "5 min" },
  { id: "tentacles", title: "Tentacles", detail: "Find the closest qualifying place within range.", cost: "Draw 4, pick 2", time: "5 min" },
];

const LockBtn = ({ locked, onClick }) => (
  <Button variant="subtle" size="sm" onClick={onClick} aria-label={locked ? "Unlock question" : "Lock question"}
    style={{ minWidth: 44, padding: "0 10px" }}>{locked ? "🔒" : "🔓"}</Button>
);
const FieldLabel = ({ children }) => (
  <div style={{ fontSize: "var(--text-row)", fontWeight: 800, color: "var(--text-primary)", margin: "0 0 10px" }}>{children}</div>
);

/* ── Questions list ── */
function QuestionsListSheet(p) {
  const items = [
    { t: "2 km Radar", s: "Miss", tone: "danger" },
    { t: "Thermometer 2", s: "Hotter", tone: "success" },
    { t: "Tentacles · Museum", s: "Mori Art Museum", tone: "count" },
  ];
  return (
    <div>
      <SheetHeader title="Questions" onBack={p.onBack} />
      <p style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)", margin: "10px 0 12px" }}>
        Each answer shades the map. Swipe a row to delete.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it, i) => (
          <ListRow key={i} title={it.t}
            trailing={<Badge tone={it.tone}>{it.s}</Badge>}
            onClick={() => p.onOpen(i === 0 ? "radar" : i === 1 ? "thermometer" : "tentacles")} />
        ))}
      </div>
    </div>
  );
}

/* ── Add question (5 types, each with cost·time) ── */
function AddQuestionSheet(p) {
  return (
    <div>
      <SheetHeader title="Add Question" onBack={p.onBack} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {QTYPES.map((q) => (
          <ListRow key={q.id} title={q.title} onClick={() => p.onPick(q.id)}
            description={
              <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span>{q.detail}</span>
                <QuestionMeta cost={q.cost} time={q.time} />
              </span>
            } />
        ))}
      </div>
    </div>
  );
}

/* ── RADAR ── distance chips + Hit/Miss, drives the red ring ── */
function RadarDetail(p) {
  return (
    <div>
      <SheetHeader title="" onBack={p.onBack} accessory={<LockBtn locked={p.locked} onClick={p.onToggleLock} />} />
      <Eyebrow style={{ marginTop: 6 }}>Radar question</Eyebrow>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 0 16px" }}>
        <h2 style={{ fontSize: "var(--text-title)", fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>{p.distance} radar</h2>
        <QuestionMeta cost="Draw 2, pick 1" time="5 min" />
      </div>
      <FieldLabel>Distance</FieldLabel>
      <ChipGroup options={["500m", "1km", "2km", "5km", "10km", "Other"]} value={p.distance} onChange={p.setDistance} />
      <p style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)", margin: "8px 0 18px" }}>
        Ask whether the hider is within {p.distance} of you.
      </p>
      <FieldLabel>Answer</FieldLabel>
      <AnswerSelector type="radar" value={p.answer} onChange={p.setAnswer} />
      <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)", marginTop: 16 }}>📍 35.6878, 139.7239 · long-press the map to move the pin</p>
    </div>
  );
}

/* ── THERMOMETER ── Start/End pin + Hotter/Colder ── */
function ThermometerDetail(p) {
  return (
    <div>
      <SheetHeader title="Thermometer" onBack={p.onBack} accessory={<LockBtn locked={p.locked} onClick={p.onToggleLock} />} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 16px" }}>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)" }}>Move, then compare hotter or colder.</span>
        <QuestionMeta cost="Draw 2, pick 1" time="5 min" />
      </div>
      <FieldLabel>Editing pin</FieldLabel>
      <SegmentedControl options={["Start", "End"]} value={p.activePin === "start" ? "Start" : "End"}
        onChange={(v) => p.setActivePin(v.toLowerCase())} fullWidth />
      <p style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)", margin: "8px 0 18px" }}>Pins are 320 m apart.</p>
      <FieldLabel>Answer</FieldLabel>
      <AnswerSelector type="thermometer" value={p.answer} onChange={p.setAnswer} />
    </div>
  );
}

/* ── TENTACLES ── range + pick the closest qualifying place (POI model) ── */
function TentaclesDetail(p) {
  return (
    <div>
      <SheetHeader title="Tentacles" onBack={p.onBack} accessory={<LockBtn locked={p.locked} onClick={p.onToggleLock} />} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 16px" }}>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)" }}>Closest qualifying place wins.</span>
        <QuestionMeta cost="Draw 4, pick 2" time="5 min" />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Category</FieldLabel>
          <ListRow title="Museum" trailing={<span style={{ color: "var(--text-secondary)", fontSize: 22 }}>›</span>} onClick={() => {}} style={{ minHeight: 44 }} />
        </div>
      </div>
      <FieldLabel>Range</FieldLabel>
      <ChipGroup options={["1km", "2km", "3km"]} value={p.range} onChange={p.setRange} />
      <FieldLabel>Closest place <span style={{ fontWeight: 600, color: "var(--text-secondary)", fontSize: 13 }}>· tap the winner</span></FieldLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {window.MAP_POIS.map((poi, i) => {
          const on = poi.id === p.selectedId;
          return (
            <ListRow key={poi.id} title={poi.name} description={`${[0.4, 0.9, 1.1, 1.6][i]} km away`} active={on}
              leading={<span style={{ width: 12, height: 12, borderRadius: 999, border: `2px solid ${on ? "var(--teal)" : "var(--border-default)"}`, background: on ? "var(--teal)" : "transparent", display: "inline-block" }} />}
              trailing={on ? <Badge tone="accent">Selected</Badge> : null}
              onClick={() => p.setSelected(poi.id)} />
          );
        })}
      </div>
    </div>
  );
}

/* ── MEASURING ── compared-to + Closer/Farther ── */
function MeasuringDetail(p) {
  return (
    <div>
      <SheetHeader title="Measuring" onBack={p.onBack} accessory={<LockBtn locked={p.locked} onClick={p.onToggleLock} />} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 16px" }}>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)" }}>Compare distance to a place or boundary.</span>
        <QuestionMeta cost="Draw 3, pick 1" time="5 min" />
      </div>
      <FieldLabel>Compared to</FieldLabel>
      <ListRow title="Nearest rail station" description="Shinjuku Station · 1.4 km" trailing={<span style={{ color: "var(--text-secondary)", fontSize: 22 }}>›</span>} onClick={() => {}} />
      <div style={{ height: 16 }} />
      <FieldLabel>Answer</FieldLabel>
      <AnswerSelector type="measuring" value={p.answer} onChange={p.setAnswer} />
    </div>
  );
}

/* ── MATCHING ── candidate compare + Hit/Miss ── */
function MatchingDetail(p) {
  return (
    <div>
      <SheetHeader title="Matching" onBack={p.onBack} accessory={<LockBtn locked={p.locked} onClick={p.onToggleLock} />} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 16px" }}>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)" }}>Same ward as the hider?</span>
        <QuestionMeta cost="Draw 2, pick 1" time="5 min" />
      </div>
      <FieldLabel>Category</FieldLabel>
      <ListRow title="Same ward (admin division)" trailing={<span style={{ color: "var(--text-secondary)", fontSize: 22 }}>›</span>} onClick={() => {}} />
      <div style={{ height: 16 }} />
      <FieldLabel>Answer</FieldLabel>
      <AnswerSelector type="matching" value={p.answer} onChange={p.setAnswer} />
    </div>
  );
}

Object.assign(window, {
  QuestionsListSheet, AddQuestionSheet, RadarDetail, ThermometerDetail,
  TentaclesDetail, MeasuringDetail, MatchingDetail,
});
