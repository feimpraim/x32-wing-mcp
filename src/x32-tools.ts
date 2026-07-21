import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ConsoleOSC, pad2 } from "./osc-client.js";
import { dbToFloat, floatToDb } from "./fader-taper.js";
import { readScene, X32_ADDRESS_MAP } from "./scene.js";
import { analyzeScene, formatReport } from "./scene-analysis.js";
import { parseX32SceneFile } from "./scene-file.js";

/**
 * Registers X32/M32 tools on an McpServer instance.
 * Address formats below are drawn from the X32/M32 OSC namespace as
 * exercised against real scene files (.scn) — channel indices are
 * 2-digit, bus indices are 2-digit, mix/grp semantics documented inline.
 */
export function registerX32Tools(server: any, osc: ConsoleOSC) {
  // ---- Fader / mute --------------------------------------------------

  server.tool(
    "x32_set_channel_fader",
    "Set an X32/M32 input channel's fader level in dB (approx. -90 to +10).",
    { channel: z.number().int().min(1).max(32), db: z.number().min(-90).max(10) },
    async ({ channel, db }: { channel: number; db: number }) => {
      osc.send(`/ch/${pad2(channel)}/mix/fader`, [{ type: "f", value: dbToFloat(db) }]);
      return { content: [{ type: "text", text: `Ch${pad2(channel)} fader set to ~${db}dB` }] };
    }
  );

  server.tool(
    "x32_query_channel_fader",
    "Read an X32/M32 input channel's current fader level (returns approximate dB).",
    { channel: z.number().int().min(1).max(32) },
    async ({ channel }: { channel: number }) => {
      const args = await osc.query(`/ch/${pad2(channel)}/mix/fader`);
      const db = floatToDb(args[0]);
      return { content: [{ type: "text", text: `Ch${pad2(channel)} fader is ~${db.toFixed(1)}dB` }] };
    }
  );

  server.tool(
    "x32_set_channel_mute",
    "Mute or unmute an X32/M32 input channel. NOTE: the console's /mix/on field is 1=unmuted, 0=muted (inverse of 'mute').",
    { channel: z.number().int().min(1).max(32), mute: z.boolean() },
    async ({ channel, mute }: { channel: number; mute: boolean }) => {
      osc.send(`/ch/${pad2(channel)}/mix/on`, [{ type: "i", value: mute ? 0 : 1 }]);
      return { content: [{ type: "text", text: `Ch${pad2(channel)} ${mute ? "muted" : "unmuted"}` }] };
    }
  );

  // ---- Bus sends -------------------------------------------------------

  server.tool(
    "x32_set_bus_send",
    "Set an input channel's send level to a mix bus, in dB. Uses /ch/XX/mix/YY/level.",
    {
      channel: z.number().int().min(1).max(32),
      bus: z.number().int().min(1).max(16),
      db: z.number().min(-90).max(10),
    },
    async ({ channel, bus, db }: { channel: number; bus: number; db: number }) => {
      osc.send(`/ch/${pad2(channel)}/mix/${pad2(bus)}/level`, [{ type: "f", value: dbToFloat(db) }]);
      return { content: [{ type: "text", text: `Ch${pad2(channel)} send to Bus${pad2(bus)} set to ~${db}dB` }] };
    }
  );

  server.tool(
    "x32_set_bus_send_on",
    "Enable or disable an input channel's send to a mix bus (does not change level).",
    {
      channel: z.number().int().min(1).max(32),
      bus: z.number().int().min(1).max(16),
      on: z.boolean(),
    },
    async ({ channel, bus, on }: { channel: number; bus: number; on: boolean }) => {
      osc.send(`/ch/${pad2(channel)}/mix/${pad2(bus)}/on`, [{ type: "i", value: on ? 1 : 0 }]);
      return { content: [{ type: "text", text: `Ch${pad2(channel)} send to Bus${pad2(bus)} ${on ? "enabled" : "disabled"}` }] };
    }
  );

  // ---- Main LR / bus routing (the /grp field, not the mix line) -------

  server.tool(
    "x32_set_bus_to_main_lr",
    "Route (or un-route) a mix bus into Main LR via the bus's /grp field. This is the correct way to control bus->Main LR — channel /mix lines do NOT control this.",
    { bus: z.number().int().min(1).max(16), toMainLR: z.boolean() },
    async ({ bus, toMainLR }: { bus: number; toMainLR: boolean }) => {
      // /bus/XX/grp expects two bitmask-style int args in the real protocol
      // (%xxxxxxxx %xxxxxx); many firmwares also accept a simple on/off
      // convenience form via /bus/XX/config/mainlr on WING-style consoles.
      // On X32 this is set via scene/grp editing rather than a single OSC
      // toggle — flag this as needing console-side verification before
      // wiring into automated workflows.
      return {
        content: [
          {
            type: "text",
            text:
              `Bus-to-Main-LR routing on X32 is controlled by the /bus/${pad2(
                bus
              )}/grp bitmask field, not a simple OSC toggle. ` +
              `Recommend verifying the exact bitmask via a scene file diff before sending this live — ` +
              `flagged rather than sent to avoid breaking routing (see project history: this exact mistake ` +
              `previously broke vocal routing on a live scene).`,
          },
        ],
      };
    }
  );

  // ---- Gate ------------------------------------------------------------

  server.tool(
    "x32_set_gate_sidechain_filter",
    "Set a channel gate's sidechain filter type and frequency.",
    {
      channel: z.number().int().min(1).max(32),
      on: z.boolean(),
      filterType: z.enum(["LC12", "HC12", "BANDPASS"]),
      freqHz: z.number().min(20).max(20000),
    },
    async ({
      channel,
      on,
      filterType,
      freqHz,
    }: {
      channel: number;
      on: boolean;
      filterType: "LC12" | "HC12" | "BANDPASS";
      freqHz: number;
    }) => {
      const typeArg = filterType === "BANDPASS" ? 3.0 : filterType === "LC12" ? "LC12" : "HC12";
      osc.send(`/ch/${pad2(channel)}/gate/filter`, [
        { type: "i", value: on ? 1 : 0 },
        { type: "s", value: String(typeArg) },
        { type: "f", value: freqHz },
      ]);
      return {
        content: [
          { type: "text", text: `Ch${pad2(channel)} gate sidechain filter set: ${filterType} @ ${freqHz}Hz, ${on ? "on" : "off"}` },
        ],
      };
    }
  );

  // ---- Scenes ------------------------------------------------------------

  server.tool(
    "x32_load_scene",
    "Load a scene by index (0-99).",
    { sceneNumber: z.number().int().min(0).max(99) },
    async ({ sceneNumber }: { sceneNumber: number }) => {
      osc.send("/-action/goscene", [{ type: "i", value: sceneNumber }]);
      return { content: [{ type: "text", text: `Loaded scene ${sceneNumber}` }] };
    }
  );

  // ---- DCA ------------------------------------------------------------

  server.tool(
    "x32_set_dca_mute",
    "Mute or unmute a DCA group (1-8).",
    { dca: z.number().int().min(1).max(8), mute: z.boolean() },
    async ({ dca, mute }: { dca: number; mute: boolean }) => {
      osc.send(`/dca/${dca}/on`, [{ type: "i", value: mute ? 0 : 1 }]);
      return { content: [{ type: "text", text: `DCA${dca} ${mute ? "muted" : "unmuted"}` }] };
    }
  );

  server.tool(
    "x32_set_dca_fader",
    "Set a DCA group's fader level in dB.",
    { dca: z.number().int().min(1).max(8), db: z.number().min(-90).max(10) },
    async ({ dca, db }: { dca: number; db: number }) => {
      osc.send(`/dca/${dca}/fader`, [{ type: "f", value: dbToFloat(db) }]);
      return { content: [{ type: "text", text: `DCA${dca} fader set to ~${db}dB` }] };
    }
  );

  // ---- Scene read + analysis (read-only) ------------------------------

  server.tool(
    "x32_read_scene",
    "Read the entire current console state (channels, buses, DCAs, main: names, fader dB, mutes, HPF/gate/comp/EQ status) and return it as structured JSON. Read-only — sends no changes to the console. Use this to inspect the live scene or as input for analysis.",
    {
      channels: z.number().int().min(1).max(32).optional().describe("How many input channels to read (default 32)."),
      buses: z.number().int().min(0).max(16).optional().describe("How many mix buses to read (default 16)."),
      dcas: z.number().int().min(0).max(8).optional().describe("How many DCA groups to read (default 8)."),
    },
    async (args: { channels?: number; buses?: number; dcas?: number }) => {
      const scene = await readScene(osc, X32_ADDRESS_MAP, "X32/M32", args);
      return { content: [{ type: "text", text: JSON.stringify(scene, null, 2) }] };
    }
  );

  server.tool(
    "x32_analyze_scene",
    "Read the entire console state and evaluate it against live-sound best practices (gain staging, high-pass filtering, dynamics, gating, labeling, DCA grouping, main output), returning prioritized findings plus recommended per-channel starting points. Read-only and advisory — it never changes the console. Best results when channels are named, since source-specific advice is inferred from channel names.",
    {},
    async () => {
      const scene = await readScene(osc, X32_ADDRESS_MAP, "X32/M32");
      const report = analyzeScene(scene);
      return { content: [{ type: "text", text: formatReport(report) }] };
    }
  );

  // ---- Offline scene-file analysis (no console needed) ----------------

  server.tool(
    "x32_read_scene_file",
    "Parse a saved X32/M32 scene file (.scn) into the same structured JSON as x32_read_scene, without needing a console connected. Provide an absolute file path. Useful for reviewing or comparing saved scenes offline.",
    { path: z.string().describe("Absolute path to a .scn scene file.") },
    async ({ path }: { path: string }) => {
      const text = await readFile(path, "utf8");
      const scene = parseX32SceneFile(text);
      return { content: [{ type: "text", text: JSON.stringify(scene, null, 2) }] };
    }
  );

  server.tool(
    "x32_analyze_scene_file",
    "Parse a saved X32/M32 scene file (.scn) and evaluate it against live-sound best practices, returning the same prioritized findings and recommendations as x32_analyze_scene — but offline, from a file, with no console connected. Provide an absolute file path.",
    { path: z.string().describe("Absolute path to a .scn scene file.") },
    async ({ path }: { path: string }) => {
      const text = await readFile(path, "utf8");
      const scene = parseX32SceneFile(text);
      const report = analyzeScene(scene);
      return { content: [{ type: "text", text: formatReport(report) }] };
    }
  );
}
