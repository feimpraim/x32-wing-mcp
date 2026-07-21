import { ConsoleOSC, pad2 } from "./osc-client.js";
import { floatToDb } from "./fader-taper.js";

/**
 * Reads a full-console "scene snapshot" over OSC and returns it as plain,
 * serializable data. This module is deliberately READ-ONLY — it never sends a
 * set/write message, so it is safe to run against a live console mid-show.
 *
 * The reader issues one small OSC query per parameter (reusing the same
 * addresses the verified per-channel tools already use for fader/mute, plus the
 * standard X32 addresses for name/HPF/gate/comp/EQ). Queries run through a
 * bounded concurrency pool and every one is "safe": a parameter the console
 * doesn't answer for is left `undefined` and the read continues, with the
 * snapshot flagged `partial`.
 *
 * Numeric encodings for the extended fields (HPF frequency, comp threshold, comp
 * ratio) vary by firmware and are NOT relied on for correctness — the analyzer
 * keys off booleans (on/off) and fader dB, which are well understood. Raw values
 * are still surfaced so a human/LLM can interpret them.
 */

export interface ChannelState {
  index: number;
  name: string;
  color?: number;
  faderDb: number; // approximate dB; -90 is treated as -inf / off
  muted: boolean;
  hpfOn?: boolean;
  hpfRaw?: number; // raw low-cut frequency value as reported (encoding varies)
  gateOn?: boolean;
  compOn?: boolean;
  compThrRaw?: number;
  compRatioRaw?: number;
  eqOn?: boolean;
}

export interface BusState {
  index: number;
  name: string;
  faderDb: number;
  muted: boolean;
}

export interface DcaState {
  index: number;
  name: string;
  faderDb: number;
  muted: boolean;
}

export interface MainState {
  faderDb: number;
  muted: boolean;
}

export interface SceneSnapshot {
  console: string;
  readAt: string;
  channels: ChannelState[];
  buses: BusState[];
  dcas: DcaState[];
  main: MainState;
  /** true if one or more parameters did not answer within the timeout */
  partial: boolean;
  notes: string[];
}

/**
 * Console-specific address builders. Everything else in the reader is generic,
 * so adding/fixing a console is just a matter of supplying one of these.
 */
export interface SceneAddressMap {
  channelCount: number;
  busCount: number;
  dcaCount: number;
  chName: (ch: number) => string;
  chColor: (ch: number) => string;
  chFader: (ch: number) => string;
  chOn: (ch: number) => string;
  chHpOn: (ch: number) => string;
  chHpFreq: (ch: number) => string;
  chGateOn: (ch: number) => string;
  chDynOn: (ch: number) => string;
  chDynThr: (ch: number) => string;
  chDynRatio: (ch: number) => string;
  chEqOn: (ch: number) => string;
  busName: (b: number) => string;
  busFader: (b: number) => string;
  busOn: (b: number) => string;
  dcaName: (d: number) => string;
  dcaFader: (d: number) => string;
  dcaOn: (d: number) => string;
  mainFader: string;
  mainOn: string;
}

export const X32_ADDRESS_MAP: SceneAddressMap = {
  channelCount: 32,
  busCount: 16,
  dcaCount: 8,
  chName: (c) => `/ch/${pad2(c)}/config/name`,
  chColor: (c) => `/ch/${pad2(c)}/config/color`,
  chFader: (c) => `/ch/${pad2(c)}/mix/fader`,
  chOn: (c) => `/ch/${pad2(c)}/mix/on`,
  chHpOn: (c) => `/ch/${pad2(c)}/preamp/hpon`,
  chHpFreq: (c) => `/ch/${pad2(c)}/preamp/hpf`,
  chGateOn: (c) => `/ch/${pad2(c)}/gate/on`,
  chDynOn: (c) => `/ch/${pad2(c)}/dyn/on`,
  chDynThr: (c) => `/ch/${pad2(c)}/dyn/thr`,
  chDynRatio: (c) => `/ch/${pad2(c)}/dyn/ratio`,
  chEqOn: (c) => `/ch/${pad2(c)}/eq/on`,
  busName: (b) => `/bus/${pad2(b)}/config/name`,
  busFader: (b) => `/bus/${pad2(b)}/mix/fader`,
  busOn: (b) => `/bus/${pad2(b)}/mix/on`,
  dcaName: (d) => `/dca/${d}/config/name`,
  dcaFader: (d) => `/dca/${d}/fader`,
  dcaOn: (d) => `/dca/${d}/on`,
  mainFader: `/main/st/mix/fader`,
  mainOn: `/main/st/mix/on`,
};

/**
 * Best-guess WING map, kept X32-shaped as a scaffold. The WING OSC namespace
 * differs (channel count, bus/matrix counts, fader taper, snapshot format), so
 * results from this map are UNVERIFIED — see src/wing-tools.ts.
 */
export const WING_ADDRESS_MAP: SceneAddressMap = {
  ...X32_ADDRESS_MAP,
  channelCount: 48,
};

export interface SceneReadOptions {
  channels?: number;
  buses?: number;
  dcas?: number;
  timeoutMs?: number;
  concurrency?: number;
}

/** Unwrap an OSC arg whether the transport delivers raw values or {type,value}. */
function raw(a: unknown): any {
  if (a && typeof a === "object" && "value" in (a as any)) return (a as any).value;
  return a;
}

function asNumber(args: any[] | undefined): number | undefined {
  if (!args || args.length === 0) return undefined;
  const v = raw(args[0]);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asString(args: any[] | undefined): string | undefined {
  if (!args || args.length === 0) return undefined;
  const v = raw(args[0]);
  return v == null ? undefined : String(v);
}

/** Console "on" fields are 1 = on/unmuted, 0 = muted. */
function asMuted(args: any[] | undefined): boolean | undefined {
  const n = asNumber(args);
  if (n === undefined) return undefined;
  return n === 0;
}

async function runPool<T, R>(
  items: T[],
  size: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runner() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(size, items.length || 1) }, () => runner());
  await Promise.all(runners);
  return results;
}

/**
 * Read a full scene snapshot from a console described by `map`.
 * Read-only: issues only OSC queries, never sends a set message.
 */
export async function readScene(
  osc: ConsoleOSC,
  map: SceneAddressMap,
  consoleLabel: string,
  opts: SceneReadOptions = {}
): Promise<SceneSnapshot> {
  const nCh = Math.min(opts.channels ?? map.channelCount, map.channelCount);
  const nBus = Math.min(opts.buses ?? map.busCount, map.busCount);
  const nDca = Math.min(opts.dcas ?? map.dcaCount, map.dcaCount);
  const timeout = opts.timeoutMs ?? 600;
  const concurrency = opts.concurrency ?? 32;

  let missing = 0;
  const q = async (address: string) => {
    const r = await osc.querySafe(address, timeout);
    if (r === undefined) missing++;
    return r;
  };

  const channelIdx = Array.from({ length: nCh }, (_, i) => i + 1);
  const channels = await runPool(channelIdx, concurrency, async (ch): Promise<ChannelState> => {
    const [name, color, fader, on, hpOn, hpFreq, gateOn, dynOn, dynThr, dynRatio, eqOn] =
      await Promise.all([
        q(map.chName(ch)),
        q(map.chColor(ch)),
        q(map.chFader(ch)),
        q(map.chOn(ch)),
        q(map.chHpOn(ch)),
        q(map.chHpFreq(ch)),
        q(map.chGateOn(ch)),
        q(map.chDynOn(ch)),
        q(map.chDynThr(ch)),
        q(map.chDynRatio(ch)),
        q(map.chEqOn(ch)),
      ]);
    const faderRaw = asNumber(fader);
    return {
      index: ch,
      name: (asString(name) ?? "").trim(),
      color: asNumber(color),
      faderDb: faderRaw === undefined ? -90 : floatToDb(faderRaw),
      muted: asMuted(on) ?? false,
      hpfOn: boolOrUndef(hpOn),
      hpfRaw: asNumber(hpFreq),
      gateOn: boolOrUndef(gateOn),
      compOn: boolOrUndef(dynOn),
      compThrRaw: asNumber(dynThr),
      compRatioRaw: asNumber(dynRatio),
      eqOn: boolOrUndef(eqOn),
    };
  });

  const busIdx = Array.from({ length: nBus }, (_, i) => i + 1);
  const buses = await runPool(busIdx, concurrency, async (b): Promise<BusState> => {
    const [name, fader, on] = await Promise.all([q(map.busName(b)), q(map.busFader(b)), q(map.busOn(b))]);
    const faderRaw = asNumber(fader);
    return {
      index: b,
      name: (asString(name) ?? "").trim(),
      faderDb: faderRaw === undefined ? -90 : floatToDb(faderRaw),
      muted: asMuted(on) ?? false,
    };
  });

  const dcaIdx = Array.from({ length: nDca }, (_, i) => i + 1);
  const dcas = await runPool(dcaIdx, concurrency, async (d): Promise<DcaState> => {
    const [name, fader, on] = await Promise.all([q(map.dcaName(d)), q(map.dcaFader(d)), q(map.dcaOn(d))]);
    const faderRaw = asNumber(fader);
    return {
      index: d,
      name: (asString(name) ?? "").trim(),
      faderDb: faderRaw === undefined ? -90 : floatToDb(faderRaw),
      muted: asMuted(on) ?? false,
    };
  });

  const [mainFader, mainOn] = await Promise.all([q(map.mainFader), q(map.mainOn)]);
  const mainFaderRaw = asNumber(mainFader);
  const main: MainState = {
    faderDb: mainFaderRaw === undefined ? -90 : floatToDb(mainFaderRaw),
    muted: asMuted(mainOn) ?? false,
  };

  const notes: string[] = [];
  if (missing > 0) {
    notes.push(
      `${missing} parameter(s) did not answer within ${timeout}ms and were left blank. ` +
        `The console may not support them, or the network dropped packets — re-run or raise timeoutMs.`
    );
  }

  return {
    console: consoleLabel,
    readAt: new Date().toISOString(),
    channels,
    buses,
    dcas,
    main,
    partial: missing > 0,
    notes,
  };
}

function boolOrUndef(args: any[] | undefined): boolean | undefined {
  const n = asNumber(args);
  if (n === undefined) return undefined;
  return n === 1;
}
