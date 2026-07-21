# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Full-scene read**: `x32_read_scene` (and `wing_read_scene`, unverified) dump
  the entire console state — channels, buses, DCAs, main, with names, fader dB,
  mutes, and HPF/gate/comp/EQ status — as structured JSON. Read-only.
- **Best-practice analysis**: `x32_analyze_scene` (and `wing_analyze_scene`,
  unverified) evaluate the live scene against live-sound standards (gain staging,
  high-pass filtering, dynamics, gating, labeling, DCA grouping, main output) and
  return prioritized, advisory findings plus per-channel recommended starting
  points. Read-only; never changes the console.
- `ConsoleOSC.querySafe()` — timeout-tolerant query used by the scene reader.
- Test suite (`npm test`, Node's built-in runner) covering the analysis engine.
- Community health files: contributing guide, code of conduct, security policy,
  issue templates (bug / feature / WING verification), and PR template.
- CI workflow building and testing against Node 18, 20, and 22.
- Dependabot configuration for npm and GitHub Actions updates.

## [0.1.0] - 2026-07-20

### Added
- Initial release: MCP server for Behringer X32 / M32 / WING consoles over OSC.
- X32 / M32 tools: fader control, mute, bus sends, gate sidechain filter, scene
  recall, and DCA control.
- WING tools scaffolded with the same shape as X32 (addresses `[UNVERIFIED]`).
- Shared UDP OSC transport with automatic `/xremote` keep-alive.

[Unreleased]: https://github.com/feimpraim/x32-wing-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/feimpraim/x32-wing-mcp/releases/tag/v0.1.0
