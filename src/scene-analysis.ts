import type { SceneSnapshot, ChannelState } from "./scene.js";

/**
 * Deterministic, hardware-free analysis of a SceneSnapshot against common
 * live-sound best practices. This module is a pure function of its input, so it
 * is unit-testable without a console (see scene-analysis.test.ts).
 *
 * The goal is NOT to "auto-mix" — it is to surface the checks an experienced
 * engineer runs when they inherit a console: is anything under-gained, is a
 * live channel silently doing nothing, are vocals high-passed and compressed,
 * are drums gated, is the show labeled and grouped for fast control. Every
 * finding is advisory; nothing here is applied to the console.
 */

export type SourceType =
  | "vocal"
  | "speech"
  | "kick"
  | "snare"
  | "tom"
  | "hat"
  | "overhead"
  | "bass"
  | "egtr"
  | "agtr"
  | "keys"
  | "piano"
  | "unknown";

export type Severity = "warning" | "suggestion" | "info";

export interface Finding {
  severity: Severity;
  /** e.g. "Ch03", "DCA", "Main", "Buses" */
  scope: string;
  /** the best-practice area this relates to */
  standard: string;
  message: string;
  recommendation: string;
}

export interface RecommendedChannel {
  index: number;
  name: string;
  sourceType: SourceType;
  hpfHz: number | "off";
  compression: string;
  gate: string;
  notes?: string;
}

export interface AnalysisReport {
  console: string;
  summary: {
    channelsTotal: number;
    channelsActive: number;
    channelsMuted: number;
    warnings: number;
    suggestions: number;
  };
  findings: Finding[];
  recommendedTemplate: RecommendedChannel[];
  partial: boolean;
}

// A channel counts as "active" if it is unmuted and its fader is up enough to
// pass meaningful signal to whatever it feeds.
const ACTIVE_FADER_DB = -40;
// Above this the fader is doing the job the preamp should — a gain-staging smell.
const UNDERGAINED_FADER_DB = 6;
// At/below this an unmuted channel is effectively silent.
const SILENT_FADER_DB = -60;

// Distinctive stems (kick, snare, guitar…) match anywhere so run-together labels
// like "KickOut", "SnareT", "KeysLeft" are caught; short/ambiguous abbreviations
// (bd, sn, hh, oh, bv, mc) keep word boundaries to avoid false positives.
const NAME_PATTERNS: [SourceType, RegExp][] = [
  ["kick", /kick|kik|bass\s?drum|\bbd\b/i],
  ["snare", /snare|\bsnr\b|\bsn\b/i],
  ["tom", /\btom|rack\s?tom|floor\s?tom/i],
  ["hat", /hi.?hat|\bhats?\b|\bhh\b/i],
  ["overhead", /overhead|\boh\b|\bo\.?h\.?\b|cymbal|\bcym\b/i],
  ["bass", /\bbass\b|bass\s?gtr|bass\s?di/i],
  ["agtr", /acoustic|\baco\b|\bacou\b|a\.?gtr/i],
  ["egtr", /guitar|\bgtr\b|elec\s?gtr|e\.?gtr/i],
  ["piano", /piano|\bpno\b|grand/i],
  ["keys", /keys?|synth|\bpad\b|organ|rhodes|nord/i],
  ["speech", /speech|\bspk\b|speak|\blav\b|lectern|pulpit|pastor|\bmc\b|announce|podium|preach|\bhost\b/i],
  ["vocal", /\bvox\b|vocal|\bvoc\b|\blead\b|\bbgv\b|\bbv\b|choir|\bsing\b|\bharm\b/i],
];

export function inferSourceType(name: string): SourceType {
  const n = name.trim();
  if (!n) return "unknown";
  for (const [type, re] of NAME_PATTERNS) {
    if (re.test(n)) return type;
  }
  return "unknown";
}

interface TemplateSpec {
  hpfHz: number | "off";
  comp: string;
  gate: string;
  wantHpf: boolean;
  wantComp: boolean;
  wantGate: boolean;
}

// Industry-standard starting points, not absolutes. Frequencies are safe,
// conservative defaults an engineer can dial in from.
const TEMPLATES: Record<SourceType, TemplateSpec> = {
  vocal: { hpfHz: 100, comp: "3:1 @ ~-18 dB, 2-4 dB GR", gate: "off", wantHpf: true, wantComp: true, wantGate: false },
  speech: { hpfHz: 120, comp: "2.5:1 @ ~-20 dB, 3-5 dB GR", gate: "optional (noisy rooms)", wantHpf: true, wantComp: true, wantGate: false },
  kick: { hpfHz: "off", comp: "4:1 @ ~-12 dB", gate: "on (tighten bleed)", wantHpf: false, wantComp: true, wantGate: true },
  snare: { hpfHz: 100, comp: "3:1 @ ~-14 dB", gate: "on (tighten bleed)", wantHpf: true, wantComp: true, wantGate: true },
  tom: { hpfHz: 80, comp: "2:1 light", gate: "on (reduce ring)", wantHpf: true, wantComp: false, wantGate: true },
  hat: { hpfHz: 200, comp: "off", gate: "optional", wantHpf: true, wantComp: false, wantGate: false },
  overhead: { hpfHz: 120, comp: "off/light", gate: "off", wantHpf: true, wantComp: false, wantGate: false },
  bass: { hpfHz: 40, comp: "3:1 @ ~-16 dB", gate: "off", wantHpf: false, wantComp: true, wantGate: false },
  egtr: { hpfHz: 100, comp: "light", gate: "off", wantHpf: true, wantComp: false, wantGate: false },
  agtr: { hpfHz: 100, comp: "3:1 @ ~-16 dB", gate: "off", wantHpf: true, wantComp: true, wantGate: false },
  keys: { hpfHz: 60, comp: "off/light", gate: "off", wantHpf: true, wantComp: false, wantGate: false },
  piano: { hpfHz: 60, comp: "light", gate: "off", wantHpf: true, wantComp: false, wantGate: false },
  unknown: { hpfHz: "off", comp: "as needed", gate: "as needed", wantHpf: false, wantComp: false, wantGate: false },
};

function isActive(ch: ChannelState): boolean {
  return !ch.muted && ch.faderDb > ACTIVE_FADER_DB;
}

export function analyzeScene(scene: SceneSnapshot): AnalysisReport {
  const findings: Finding[] = [];
  const active = scene.channels.filter(isActive);
  const muted = scene.channels.filter((c) => c.muted);

  // ---- Per-channel checks -------------------------------------------------
  for (const ch of scene.channels) {
    const scope = `Ch${String(ch.index).padStart(2, "0")}`;
    const label = ch.name ? `"${ch.name}"` : "(unnamed)";
    const type = inferSourceType(ch.name);
    const tpl = TEMPLATES[type];

    // Gain staging: fader riding high on an active channel.
    if (isActive(ch) && ch.faderDb > UNDERGAINED_FADER_DB) {
      findings.push({
        severity: "warning",
        scope,
        standard: "Gain staging",
        message: `${label} is running at ${ch.faderDb.toFixed(1)} dB, well above unity.`,
        recommendation:
          "Raise the input/preamp gain so the fader can sit near 0 dB (unity). Faders parked near the top leave no headroom to push and usually mean the channel is under-gained at the head amp.",
      });
    }

    // Unmuted but effectively silent.
    if (!ch.muted && ch.faderDb <= SILENT_FADER_DB) {
      findings.push({
        severity: "suggestion",
        scope,
        standard: "Housekeeping",
        message: `${label} is unmuted but its fader is effectively off (${ch.faderDb <= -90 ? "-inf" : ch.faderDb.toFixed(1) + " dB"}).`,
        recommendation: "If the channel is unused, mute it (or add it to a muted DCA) to keep noise and accidental signal out of the mix.",
      });
    }

    // Unnamed active channel.
    if (isActive(ch) && !ch.name) {
      findings.push({
        severity: "suggestion",
        scope,
        standard: "Labeling",
        message: `${scope} is active but has no name.`,
        recommendation: "Label the channel. Named channels make DCA/mute-group assignment, troubleshooting, and handoff to another engineer far faster.",
      });
    }

    // Only run tone/dynamics checks when we can identify the source and the
    // console actually reported the relevant on/off state.
    if (type !== "unknown" && isActive(ch)) {
      if (tpl.wantHpf && ch.hpfOn === false) {
        findings.push({
          severity: "suggestion",
          scope,
          standard: "High-pass filter",
          message: `${label} looks like a ${type} source but its low-cut is off.`,
          recommendation: `Engage the HPF around ${tpl.hpfHz} Hz to clear stage rumble, handling noise, and low-end mud before it stacks up across open mics.`,
        });
      }
      if (tpl.wantComp && ch.compOn === false) {
        findings.push({
          severity: "suggestion",
          scope,
          standard: "Dynamics",
          message: `${label} (${type}) has no compression engaged.`,
          recommendation: `Add gentle compression (${tpl.comp}) to even out level and keep it sitting consistently in the mix.`,
        });
      }
      if (tpl.wantGate && ch.gateOn === false) {
        findings.push({
          severity: "suggestion",
          scope,
          standard: "Gating",
          message: `${label} (${type}) is not gated.`,
          recommendation: "Consider a gate/expander to control bleed from the rest of the kit and tighten the source.",
        });
      }
      if (type === "bass" && ch.hpfOn === true) {
        findings.push({
          severity: "info",
          scope,
          standard: "High-pass filter",
          message: `${label} (bass) has its low-cut engaged.`,
          recommendation: `Confirm the low-cut is low enough (~40 Hz or below). A high-set HPF on bass/kick thins the low end that the source exists to provide.`,
        });
      }
    }
  }

  // ---- Duplicate names ----------------------------------------------------
  const byName = new Map<string, number[]>();
  for (const ch of scene.channels) {
    if (!ch.name) continue;
    const key = ch.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), ch.index]);
  }
  for (const [name, idxs] of byName) {
    if (idxs.length > 1) {
      findings.push({
        severity: "warning",
        scope: `Ch ${idxs.join(", ")}`,
        standard: "Labeling",
        message: `${idxs.length} channels share the name "${name}".`,
        recommendation: "Give duplicated channels distinct names (e.g. append L/R or a number) so mutes and recalls target the right input under pressure.",
      });
    }
  }

  // ---- DCA usage ----------------------------------------------------------
  const namedDcas = scene.dcas.filter((d) => d.name);
  if (active.length >= 6 && namedDcas.length === 0) {
    findings.push({
      severity: "suggestion",
      scope: "DCA",
      standard: "Control grouping",
      message: `${active.length} channels are active but no DCA groups are set up.`,
      recommendation: "Assign DCAs (e.g. Vocals, Drums, Band, FX) so you can ride and mute whole sections with one fader instead of chasing individual channels.",
    });
  }

  // ---- Main output --------------------------------------------------------
  if (active.length > 0) {
    if (scene.main.muted) {
      findings.push({
        severity: "warning",
        scope: "Main",
        standard: "Output",
        message: "The Main LR output is muted while channels are active.",
        recommendation: "Confirm this is intentional — with Main muted, nothing reaches the PA regardless of channel levels.",
      });
    } else if (scene.main.faderDb <= SILENT_FADER_DB) {
      findings.push({
        severity: "warning",
        scope: "Main",
        standard: "Output",
        message: `The Main LR fader is very low (${scene.main.faderDb <= -90 ? "-inf" : scene.main.faderDb.toFixed(1) + " dB"}).`,
        recommendation: "Bring the Main fader up toward unity as your primary output reference, and set overall level from there.",
      });
    }
  }

  // ---- Recommended per-channel template (active, identifiable channels) ----
  const recommendedTemplate: RecommendedChannel[] = active
    .map((ch) => {
      const type = inferSourceType(ch.name);
      const tpl = TEMPLATES[type];
      return {
        index: ch.index,
        name: ch.name || "(unnamed)",
        sourceType: type,
        hpfHz: tpl.hpfHz,
        compression: tpl.comp,
        gate: tpl.gate,
        notes: type === "unknown" ? "Name the channel to get source-specific guidance." : undefined,
      };
    });

  const warnings = findings.filter((f) => f.severity === "warning").length;
  const suggestions = findings.filter((f) => f.severity === "suggestion").length;

  // Stable ordering: warnings first, then suggestions, then info; within a
  // severity, by scope.
  const rank: Record<Severity, number> = { warning: 0, suggestion: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.scope.localeCompare(b.scope));

  return {
    console: scene.console,
    summary: {
      channelsTotal: scene.channels.length,
      channelsActive: active.length,
      channelsMuted: muted.length,
      warnings,
      suggestions,
    },
    findings,
    recommendedTemplate,
    partial: scene.partial,
  };
}

/** Render an AnalysisReport as readable text for an MCP tool result. */
export function formatReport(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push(`Scene analysis — ${report.console}`);
  lines.push(
    `${report.summary.channelsActive} active / ${report.summary.channelsMuted} muted of ${report.summary.channelsTotal} channels · ` +
      `${report.summary.warnings} warning(s), ${report.summary.suggestions} suggestion(s)`
  );
  if (report.partial) {
    lines.push("⚠ Partial read: some parameters did not answer; findings may be incomplete.");
  }
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No best-practice issues detected. 👍");
  } else {
    const icon: Record<Severity, string> = { warning: "⚠", suggestion: "→", info: "·" };
    for (const f of report.findings) {
      lines.push(`${icon[f.severity]} [${f.scope}] ${f.standard}: ${f.message}`);
      lines.push(`   ${f.recommendation}`);
    }
  }

  if (report.recommendedTemplate.length > 0) {
    lines.push("");
    lines.push("Recommended per-channel starting points (active channels):");
    for (const r of report.recommendedTemplate) {
      const hpf = r.hpfHz === "off" ? "HPF off" : `HPF ~${r.hpfHz} Hz`;
      lines.push(
        `   Ch${String(r.index).padStart(2, "0")} ${r.name} [${r.sourceType}]: ${hpf}, comp ${r.compression}, gate ${r.gate}` +
          (r.notes ? ` — ${r.notes}` : "")
      );
    }
  }

  lines.push("");
  lines.push(
    "These are advisory best-practice checks, not applied changes. Verify against the room, source, and program before adjusting a live console."
  );
  return lines.join("\n");
}
