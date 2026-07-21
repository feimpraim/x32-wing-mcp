# Contributing to x32-wing-mcp

Thanks for your interest in improving this project! It controls **live audio hardware**, so contributions are held to a slightly higher bar than a typical library — please read the [Safety expectations](#safety-expectations) section carefully.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Verify WING OSC addresses** against real hardware — this is the single most valuable contribution right now (see [WING status](README.md#wing-status)).
- **Report bugs** — especially incorrect OSC addresses or fader-taper inaccuracies.
- **Add tools** — EQ bands, compressor parameters, meter streaming, etc. (see the [Roadmap](README.md#roadmap--ideas)).
- **Improve docs** — clearer setup steps, more console models tested, troubleshooting notes.

## Development setup

```bash
git clone https://github.com/feimpraim/x32-wing-mcp.git
cd x32-wing-mcp
npm install
npm run build      # compile TypeScript in src/ -> dist/
npm run dev        # watch mode
```

Test your changes standalone with the MCP Inspector before wiring into a client:

```bash
CONSOLE_TYPE=x32 CONSOLE_IP=192.168.0.10 npm run inspector
```

### Project layout

| Path | Purpose |
|---|---|
| `src/index.ts` | MCP server entry point and tool registration |
| `src/osc-client.ts` | Shared UDP OSC transport + `/xremote` keep-alive |
| `src/x32-tools.ts` | X32 / M32 tool definitions |
| `src/wing-tools.ts` | WING tool definitions (addresses centralized in `ADDRESS_TEMPLATES`) |
| `src/fader-taper.ts` | dB ↔ float fader-taper conversion |

## Safety expectations

Because faders move the instant an OSC message arrives:

- **Test every new or changed `set_*` tool against a non-critical channel** (a spare input or an offline/idle console) before opening a PR. Never validate against a live vocal or main bus.
- If you change `src/fader-taper.ts`, include before/after dB values and the console model you measured against.
- If you implement a currently read-only tool as a write (e.g. `x32_set_bus_to_main_lr`), explain exactly which OSC field you're setting and how you confirmed it doesn't break routing.
- Clearly mark any tool you could not verify against hardware as `[UNVERIFIED]` in its description, matching the existing convention.

## Pull request process

1. Fork the repo and create a topic branch from `main` (e.g. `wing-verify-faders`).
2. Keep the diff focused — one logical change per PR.
3. Run `npm run build` and make sure it compiles cleanly with no new TypeScript errors.
4. Fill out the PR template, including **which console model you tested against** (or state that you could not test on hardware).
5. Reference any related issue (e.g. `Closes #12`).

Maintainers review for correctness, safety, and whether hardware verification is documented. Unverified changes may still be merged if clearly labeled, but verified ones are strongly preferred.

## Commit messages

Use clear, imperative summaries (e.g. `Add EQ band get/set tools for X32`). Conventional-commit prefixes (`fix:`, `feat:`, `docs:`) are welcome but not required.

## Reporting security issues

Please do **not** open a public issue for security problems. See [SECURITY.md](SECURITY.md).
