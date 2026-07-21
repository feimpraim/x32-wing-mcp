import type {
  SceneSnapshot,
  ChannelState,
  BusState,
  DcaState,
  MainState,
} from "./scene.js";

/**
 * Parses a saved X32/M32 scene file (`.scn`) into the same SceneSnapshot shape
 * the live OSC reader produces, so the exact same analysis engine can run on a
 * file with no console attached. This is pure text parsing — no hardware, no
 * network — which also makes it trivially testable.
 *
 * Scene-file format (verified against a real X32 4.0 .scn):
 *   #4.0# "SceneName" ...
 *   /ch/01/config "Lead Mic" 51 CY 1
 *   /ch/01/preamp +0.5 OFF ON 24 128      (trim invert hpon hpslope hpf)
 *   /ch/01/gate ON GATE -53.0 ...          (on mode thr ...)
 *   /ch/01/dyn ON COMP PEAK LOG -24.0 3.0  (on mode det env thr ratio ...)
 *   /ch/01/eq ON
 *   /ch/01/mix ON  +2.0 OFF +0 OFF   -oo   (on faderDB lrassign pan mono monoLvl)
 *   /bus/01/config "Drum+KeysIEM" 71 GNi
 *   /bus/01/mix ON   0.0 ...
 *   /dca/1 ON   0.0
 *   /dca/1/config "VoxMics" 70 CY
 *   /main/st/mix ON   -oo +0
 *
 * NOTE: unlike live OSC (where fader is a 0..1 float), scene files store fader
 * levels directly in dB, including the literal "-oo" for -infinity. We parse dB
 * straight from the file rather than going through the taper approximation, so
 * these values are exact.
 */

const OFF_INF_DB = -90;

/** Parse a scene-file dB token ("+2.0", "-14.5", "0.0", "-oo") to a number. */
export function parseDb(token: string | undefined): number {
  if (!token) return OFF_INF_DB;
  const t = token.trim();
  if (t === "-oo" || t === "-∞") return OFF_INF_DB;
  const n = Number(t);
  return Number.isFinite(n) ? n : OFF_INF_DB;
}

/** Split a scene-file line into address + argument tokens, respecting quotes. */
function splitLine(line: string): { address: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("/")) return null;
  const tokens = trimmed.match(/"(?:[^"\\]|\\.)*"|\S+/g);
  if (!tokens || tokens.length === 0) return null;
  const [address, ...args] = tokens;
  return { address, args };
}

function unquote(token: string | undefined): string {
  if (!token) return "";
  return token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
}

const isOn = (t: string | undefined): boolean => t === "ON";

export function parseX32SceneFile(text: string): SceneSnapshot {
  // Index every line by its OSC address for direct lookup.
  const byAddress = new Map<string, string[]>();
  let sceneName = "";

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) {
      // Header: #4.0# "SceneName" "" %... n
      const m = line.match(/"([^"]*)"/);
      if (m) sceneName = m[1];
      continue;
    }
    const parsed = splitLine(line);
    if (parsed) byAddress.set(parsed.address, parsed.args);
  }

  const notes: string[] = [];
  const pad2 = (n: number) => String(n).padStart(2, "0");

  const channels: ChannelState[] = [];
  for (let i = 1; i <= 32; i++) {
    const cfg = byAddress.get(`/ch/${pad2(i)}/config`);
    if (!cfg) continue; // channel not present in file
    const mix = byAddress.get(`/ch/${pad2(i)}/mix`) ?? [];
    const preamp = byAddress.get(`/ch/${pad2(i)}/preamp`) ?? [];
    const gate = byAddress.get(`/ch/${pad2(i)}/gate`) ?? [];
    const dyn = byAddress.get(`/ch/${pad2(i)}/dyn`) ?? [];
    const eq = byAddress.get(`/ch/${pad2(i)}/eq`) ?? [];

    channels.push({
      index: i,
      name: unquote(cfg[0]).trim(),
      faderDb: parseDb(mix[1]),
      muted: mix[0] === "OFF",
      hpfOn: preamp.length >= 3 ? isOn(preamp[2]) : undefined,
      hpfRaw: preamp.length >= 5 ? Number(preamp[4]) : undefined,
      gateOn: gate.length >= 1 ? isOn(gate[0]) : undefined,
      compOn: dyn.length >= 1 ? isOn(dyn[0]) : undefined,
      compThrRaw: dyn.length >= 5 ? Number(dyn[4]) : undefined,
      compRatioRaw: dyn.length >= 6 ? Number(dyn[5]) : undefined,
      eqOn: eq.length >= 1 ? isOn(eq[0]) : undefined,
    });
  }

  const buses: BusState[] = [];
  for (let i = 1; i <= 16; i++) {
    const cfg = byAddress.get(`/bus/${pad2(i)}/config`);
    const mix = byAddress.get(`/bus/${pad2(i)}/mix`);
    if (!cfg && !mix) continue;
    buses.push({
      index: i,
      name: unquote(cfg?.[0]).trim(),
      faderDb: parseDb(mix?.[1]),
      muted: mix?.[0] === "OFF",
    });
  }

  const dcas: DcaState[] = [];
  for (let i = 1; i <= 8; i++) {
    const dca = byAddress.get(`/dca/${i}`);
    const cfg = byAddress.get(`/dca/${i}/config`);
    if (!dca && !cfg) continue;
    dcas.push({
      index: i,
      name: unquote(cfg?.[0]).trim(),
      faderDb: parseDb(dca?.[1]),
      muted: dca?.[0] === "OFF",
    });
  }

  const mainMix = byAddress.get("/main/st/mix") ?? [];
  const main: MainState = {
    faderDb: parseDb(mainMix[1]),
    muted: mainMix[0] === "OFF",
  };

  if (channels.length === 0) {
    notes.push("No /ch/NN/config lines found — is this a valid X32 .scn file?");
  }

  return {
    console: sceneName ? `X32 scene file "${sceneName}"` : "X32 scene file",
    readAt: new Date().toISOString(),
    channels,
    buses,
    dcas,
    main,
    partial: false,
    notes,
  };
}
