# x32-wing-mcp

[![CI](https://github.com/feimpraim/x32-wing-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/feimpraim/x32-wing-mcp/actions/workflows/ci.yml)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot&logoColor=white)](https://github.com/feimpraim/x32-wing-mcp/network/updates)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

An open-source [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets Claude (or any MCP-compatible AI assistant) directly control a **Behringer X32 / M32 / WING** digital mixing console over the network, using the consoles' native OSC protocol.

Instead of only analyzing exported scene files after the fact, this lets an AI assistant read live parameters and make real-time adjustments — fader levels, mutes, gate settings, bus sends, scene recall, and more — directly on the console.

> ⚠️ **This talks to live audio hardware.** Read the [Safety](#safety) section before connecting this to a console that's live in a service or show.

---

## Features

- **X32 / M32**: fader control, mute, bus sends, gate sidechain filter, scene recall, DCA control
- **WING**: scaffolded tool set with the same shape as X32 (addresses flagged `[UNVERIFIED]` — see [WING status](#wing-status) below)
- Shared UDP OSC transport with automatic `/xremote` keep-alive
- Built on the official `@modelcontextprotocol/sdk`

## Requirements

- **Node.js 18 or later** — check with `node -v`
- A Behringer X32, M32, or WING console reachable over the network (same LAN/subnet as the machine running this server)
- The console's IP address (find it under **Setup > Network** on the console's touchscreen)
- Claude Desktop, Claude Code, or another MCP-compatible client

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/feimpraim/x32-wing-mcp.git
cd x32-wing-mcp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build the project

```bash
npm run build
```

This compiles the TypeScript source in `src/` to JavaScript in `dist/`.

### 4. Confirm your console's network settings

On the console:
- **X32/M32**: Setup button → **Network** tab → note the IP address (default OSC port is `10023`)
- **WING**: Setup screen → note the IP address (default OSC port is `2223`)

Make sure the computer running this server is on the same network and can reach that IP (try `ping <console-ip>` first).

### 5. Test it standalone with the MCP Inspector

Before wiring it into Claude, confirm it actually talks to your console:

```bash
CONSOLE_TYPE=x32 CONSOLE_IP=192.168.0.10 npm run inspector
```

This opens a browser-based tool where you can manually invoke tools (e.g. `x32_query_channel_fader` on channel 1) and see the raw response. **Do this against a spare/idle channel first**, not a live vocal or main bus.

### 6. Connect it to Claude Desktop

Open your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "x32-wing": {
      "command": "node",
      "args": ["/absolute/path/to/x32-wing-mcp/dist/index.js"],
      "env": {
        "CONSOLE_TYPE": "x32",
        "CONSOLE_IP": "192.168.0.10"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the `x32-wing` tools available (look for the 🔌 icon in a new conversation).

### 7. Connect it to Claude Code

```bash
claude mcp add x32-wing -- node /absolute/path/to/x32-wing-mcp/dist/index.js
```

Set the environment variables either via your shell profile or by editing the generated config entry to include an `"env"` block as shown above.

---

## Configuration reference

All configuration is via environment variables:

| Variable       | Default        | Description                                  |
|----------------|----------------|-----------------------------------------------|
| `CONSOLE_TYPE` | `x32`          | `x32` (also covers M32) or `wing`             |
| `CONSOLE_IP`   | `192.168.0.10` | IP address of the console                     |
| `CONSOLE_PORT` | `10023` (x32) / `2223` (wing) | OSC remote port          |
| `LOCAL_PORT`   | `10024`        | Local UDP port this server binds to           |

---

## Available tools (X32 / M32)

| Tool | Description |
|---|---|
| `x32_set_channel_fader` | Set a channel fader level in dB |
| `x32_query_channel_fader` | Read a channel's current fader level |
| `x32_set_channel_mute` | Mute/unmute a channel |
| `x32_set_bus_send` | Set a channel's send level to a mix bus |
| `x32_set_bus_send_on` | Enable/disable a channel's send to a bus |
| `x32_set_bus_to_main_lr` | Reports on Main LR routing (see note below — not a direct write) |
| `x32_set_gate_sidechain_filter` | Configure a channel gate's sidechain filter |
| `x32_load_scene` | Recall a scene by number |
| `x32_set_dca_mute` | Mute/unmute a DCA group |
| `x32_set_dca_fader` | Set a DCA group's fader level |

**Note on Main LR routing**: bus-to-Main-LR assignment is controlled by the bus's `/grp` bitmask field, not a simple on/off OSC message, and getting this wrong can silently break the routing path for everything feeding that bus (this project's development history includes exactly that failure mode on a live scene). The `x32_set_bus_to_main_lr` tool currently reports on this rather than writing it — contributions that implement a verified, safe version are welcome.

## WING status

The WING tool set (`wing_*`) is scaffolded with the same shape as the X32 tools but the OSC addresses are **unverified** — the WING's namespace has real differences from X32 (more buses/matrices, JSON-based `.snap` format). Every WING tool is labeled `[UNVERIFIED]` in its description.

To help finish this:
1. Get Behringer's official WING OSC protocol reference document
2. Verify/correct the address templates in `src/wing-tools.ts` (`ADDRESS_TEMPLATES` object — all addresses are centralized there)
3. Remove the `[UNVERIFIED]` labels once confirmed against a real console
4. Open a PR

---

## Safety

This server sends live commands to audio hardware. Please:

- **Never point this at a console that's live in a service/show without testing first** on a spare channel or an offline console
- Faders move instantly on receipt of an OSC message — there's no built-in ramping or confirmation step
- The dB→float fader conversion in `src/fader-taper.ts` is an approximation of the console's actual taper curve (accurate to roughly ±0.5dB) — good enough for mix automation, not for exact scene recall. For exact recall, load a saved scene/snapshot file instead of reconstructing values via this conversion.
- Consider running with a read-only tool subset (comment out the `set_*` tools) when first evaluating this against a live rig
- Keep a fallback plan (manual console access) any time this is running during a live event

## Roadmap / ideas

- [ ] Verified WING OSC address set
- [ ] EQ band get/set tools (currently only gate filter is implemented)
- [ ] Compressor threshold/ratio tools
- [ ] Scene/snapshot diff tool (compare live console state against a saved `.scn`/`.snap` file)
- [ ] Read-only "safe mode" flag
- [ ] Meter/level streaming resource (MCP resources, not just tools)

## Contributing

Issues and PRs welcome — especially from anyone who can verify the WING OSC namespace against real hardware. Please test any new `set_*` tool against a non-critical channel before submitting.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, safety expectations, and the PR process. All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Security or safety concerns should go through [SECURITY.md](SECURITY.md), not public issues.

## License

MIT — see [LICENSE](LICENSE).
