import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeScene, inferSourceType } from "./scene-analysis.js";
import type { SceneSnapshot, ChannelState } from "./scene.js";

function ch(index: number, over: Partial<ChannelState> = {}): ChannelState {
  return {
    index,
    name: "",
    faderDb: 0,
    muted: false,
    hpfOn: true,
    gateOn: true,
    compOn: true,
    eqOn: true,
    ...over,
  };
}

function scene(channels: ChannelState[], over: Partial<SceneSnapshot> = {}): SceneSnapshot {
  return {
    console: "TEST",
    readAt: "1970-01-01T00:00:00.000Z",
    channels,
    buses: [],
    dcas: [],
    main: { faderDb: 0, muted: false },
    partial: false,
    notes: [],
    ...over,
  };
}

test("inferSourceType maps common names", () => {
  assert.equal(inferSourceType("Lead Vox"), "vocal");
  assert.equal(inferSourceType("Kick In"), "kick");
  assert.equal(inferSourceType("Snare Top"), "snare");
  assert.equal(inferSourceType("Bass DI"), "bass");
  assert.equal(inferSourceType("E.Gtr SR"), "egtr");
  assert.equal(inferSourceType("Acoustic"), "agtr");
  assert.equal(inferSourceType("Pastor Lav"), "speech");
  assert.equal(inferSourceType("Grand Piano"), "piano");
  assert.equal(inferSourceType("Widget"), "unknown");
  assert.equal(inferSourceType(""), "unknown");
});

test("inferSourceType handles run-together labels", () => {
  // Real X32 labels frequently concatenate words with no separator.
  assert.equal(inferSourceType("KickOut"), "kick");
  assert.equal(inferSourceType("KickIn"), "kick");
  assert.equal(inferSourceType("SnareT"), "snare");
  assert.equal(inferSourceType("SnareB"), "snare");
  assert.equal(inferSourceType("HATS"), "hat");
  assert.equal(inferSourceType("KeysLeft"), "keys");
  assert.equal(inferSourceType("KeysRight"), "keys");
  assert.equal(inferSourceType("Floor Tom"), "tom");
  assert.equal(inferSourceType("OH Left"), "overhead");
  assert.equal(inferSourceType("Clean GTR"), "egtr");
  assert.equal(inferSourceType("Bass DI"), "bass");
});

test("flags an under-gained (high fader) active channel", () => {
  const r = analyzeScene(scene([ch(1, { name: "Lead Vox", faderDb: 8 })]));
  const f = r.findings.find((x) => x.standard === "Gain staging");
  assert.ok(f, "expected a gain-staging warning");
  assert.equal(f!.severity, "warning");
});

test("does not flag gain staging when fader is near unity", () => {
  const r = analyzeScene(scene([ch(1, { name: "Lead Vox", faderDb: 0 })]));
  assert.equal(r.findings.some((x) => x.standard === "Gain staging"), false);
});

test("suggests HPF for a vocal with low-cut off", () => {
  const r = analyzeScene(scene([ch(1, { name: "Lead Vox", hpfOn: false })]));
  assert.ok(r.findings.some((x) => x.standard === "High-pass filter" && x.severity === "suggestion"));
});

test("suggests gating for an ungated kick", () => {
  const r = analyzeScene(scene([ch(1, { name: "Kick", gateOn: false, hpfOn: false })]));
  assert.ok(r.findings.some((x) => x.standard === "Gating"));
});

test("flags an unmuted-but-silent channel", () => {
  const r = analyzeScene(scene([ch(1, { name: "Spare", faderDb: -90, muted: false })]));
  assert.ok(r.findings.some((x) => x.standard === "Housekeeping"));
});

test("flags duplicate channel names", () => {
  const r = analyzeScene(scene([ch(1, { name: "Vox" }), ch(2, { name: "vox" })]));
  const f = r.findings.find((x) => x.standard === "Labeling" && x.message.includes("share the name"));
  assert.ok(f);
  assert.equal(f!.severity, "warning");
});

test("warns when main is muted but channels are active", () => {
  const r = analyzeScene(scene([ch(1, { name: "Lead Vox" })], { main: { faderDb: 0, muted: true } }));
  assert.ok(r.findings.some((x) => x.scope === "Main" && x.severity === "warning"));
});

test("suggests DCAs when many active channels and none configured", () => {
  const chans = Array.from({ length: 6 }, (_, i) => ch(i + 1, { name: `Ch${i + 1}` }));
  const r = analyzeScene(scene(chans));
  assert.ok(r.findings.some((x) => x.standard === "Control grouping"));
});

test("clean scene produces no warnings", () => {
  const r = analyzeScene(
    scene([
      ch(1, { name: "Lead Vox", faderDb: 0, hpfOn: true, compOn: true }),
      ch(2, { name: "Kick", faderDb: 0, hpfOn: false, gateOn: true, compOn: true }),
    ], {
      dcas: [{ index: 1, name: "Vocals", faderDb: 0, muted: false }],
    })
  );
  assert.equal(r.summary.warnings, 0);
});

test("recommended template covers active channels with source types", () => {
  const r = analyzeScene(scene([ch(1, { name: "Lead Vox", faderDb: 0 }), ch(2, { name: "Kick", faderDb: 0 })]));
  assert.equal(r.recommendedTemplate.length, 2);
  assert.equal(r.recommendedTemplate[0].sourceType, "vocal");
});

test("findings are ordered warnings-first", () => {
  const r = analyzeScene(
    scene([ch(1, { name: "Lead Vox", faderDb: 8, hpfOn: false })])
  );
  const severities = r.findings.map((f) => f.severity);
  const firstSuggestion = severities.indexOf("suggestion");
  const lastWarning = severities.lastIndexOf("warning");
  if (firstSuggestion !== -1 && lastWarning !== -1) {
    assert.ok(lastWarning < firstSuggestion, "warnings should come before suggestions");
  }
});
