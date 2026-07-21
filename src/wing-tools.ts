import { z } from "zod";
import { ConsoleOSC, pad2 } from "./osc-client.js";
import { dbToFloat, floatToDb } from "./fader-taper.js";
import { readScene, WING_ADDRESS_MAP } from "./scene.js";
import { analyzeScene, formatReport } from "./scene-analysis.js";

/**
 * MCP tool definitions for the Behringer WING.
 *
 * IMPORTANT: The WING shares OSC's general design with the X32/M32 but
 * is NOT guaranteed to use identical addresses — it has more buses,
 * different matrix counts, and its snapshot format is JSON-based rather
 * than plain-text OSC. The addresses below follow the X32-style pattern
 * as a starting point but have NOT been verified against a live WING
 * or Behringer's official WING OSC protocol document.
 *
 * Before using these against a live console:
 *   1. Get Behringer's "WING OSC Protocol" reference PDF
 *   2. Diff the addresses below against it
 *   3. Update ADDRESS_TEMPLATES below to match confirmed addresses
 *
 * Treat every tool here as "unverified" until confirmed — this file
 * exists as a scaffold to build against, not a finished implementation.
 */

// Centralized address templates so corrections only need to happen here.
const ADDRESS_TEMPLATES = {
  channelFader: (ch: number) => `/ch/${pad2(ch)}/mix/fader`,
  channelMute: (ch: number) => `/ch/${pad2(ch)}/mix/on`,
  busSendLevel: (ch: number, bus: number) => `/ch/${pad2(ch)}/mix/${pad2(bus)}/level`,
  mainSendLevel: (ch: number, main: number) => `/ch/${pad2(ch)}/mix/main/${main}/level`,
  snapshotLoad: (index: number) => `/-action/gosnap`,
};

export function registerWingTools(server: any, osc: ConsoleOSC) {
  server.tool(
    "wing_set_channel_fader",
    "[UNVERIFIED ADDRESS] Set a WING input channel's fader level in dB. Confirm address against WING OSC protocol doc before production use.",
    { channel: z.number().int().min(1).max(48), db: z.number().min(-90).max(10) },
    async ({ channel, db }: { channel: number; db: number }) => {
      osc.send(ADDRESS_TEMPLATES.channelFader(channel), [{ type: "f", value: dbToFloat(db) }]);
      return {
        content: [
          {
            type: "text",
            text: `[unverified] Sent fader ~${db}dB to ch${pad2(channel)}. Confirm this matches WING behavior before relying on it live.`,
          },
        ],
      };
    }
  );

  server.tool(
    "wing_query_channel_fader",
    "[UNVERIFIED ADDRESS] Read a WING input channel's current fader level.",
    { channel: z.number().int().min(1).max(48) },
    async ({ channel }: { channel: number }) => {
      const args = await osc.query(ADDRESS_TEMPLATES.channelFader(channel));
      const db = floatToDb(args[0]);
      return { content: [{ type: "text", text: `[unverified] Ch${pad2(channel)} fader ~${db.toFixed(1)}dB` }] };
    }
  );

  server.tool(
    "wing_set_channel_mute",
    "[UNVERIFIED ADDRESS] Mute or unmute a WING input channel.",
    { channel: z.number().int().min(1).max(48), mute: z.boolean() },
    async ({ channel, mute }: { channel: number; mute: boolean }) => {
      osc.send(ADDRESS_TEMPLATES.channelMute(channel), [{ type: "i", value: mute ? 0 : 1 }]);
      return { content: [{ type: "text", text: `[unverified] Ch${pad2(channel)} ${mute ? "muted" : "unmuted"}` }] };
    }
  );

  server.tool(
    "wing_set_bus_send",
    "[UNVERIFIED ADDRESS] Set a WING input channel's send level to a bus, in dB.",
    {
      channel: z.number().int().min(1).max(48),
      bus: z.number().int().min(1).max(16),
      db: z.number().min(-90).max(10),
    },
    async ({ channel, bus, db }: { channel: number; bus: number; db: number }) => {
      osc.send(ADDRESS_TEMPLATES.busSendLevel(channel, bus), [{ type: "f", value: dbToFloat(db) }]);
      return { content: [{ type: "text", text: `[unverified] Ch${pad2(channel)} send to Bus${pad2(bus)} ~${db}dB` }] };
    }
  );

  server.tool(
    "wing_load_snapshot",
    "[UNVERIFIED ADDRESS] Load a WING snapshot by index. WING snapshots are JSON-based (.snap) so the recall trigger address especially needs verification.",
    { snapshotNumber: z.number().int().min(0).max(500) },
    async ({ snapshotNumber }: { snapshotNumber: number }) => {
      osc.send(ADDRESS_TEMPLATES.snapshotLoad(snapshotNumber), [{ type: "i", value: snapshotNumber }]);
      return { content: [{ type: "text", text: `[unverified] Attempted snapshot load: ${snapshotNumber}` }] };
    }
  );

  // ---- Scene read + analysis (read-only, UNVERIFIED addresses) --------

  server.tool(
    "wing_read_scene",
    "[UNVERIFIED ADDRESSES] Read the current WING state (channels, buses, DCAs, main) into structured JSON. Read-only. The WING OSC namespace and fader taper differ from the X32; this reuses X32-shaped addresses as a scaffold, so values (especially fader dB) may be wrong until verified against a real WING. Expect a partial read.",
    {
      channels: z.number().int().min(1).max(48).optional(),
      buses: z.number().int().min(0).max(16).optional(),
      dcas: z.number().int().min(0).max(8).optional(),
    },
    async (args: { channels?: number; buses?: number; dcas?: number }) => {
      const scene = await readScene(osc, WING_ADDRESS_MAP, "WING [UNVERIFIED]", args);
      return { content: [{ type: "text", text: JSON.stringify(scene, null, 2) }] };
    }
  );

  server.tool(
    "wing_analyze_scene",
    "[UNVERIFIED ADDRESSES] Read the WING state and evaluate it against live-sound best practices, returning prioritized findings and recommended per-channel starting points. Read-only and advisory. The underlying read uses unverified WING addresses, so treat findings as indicative until the WING namespace is confirmed.",
    {},
    async () => {
      const scene = await readScene(osc, WING_ADDRESS_MAP, "WING [UNVERIFIED]");
      const report = analyzeScene(scene);
      return { content: [{ type: "text", text: formatReport(report) }] };
    }
  );
}
