# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Community health files: contributing guide, code of conduct, security policy,
  issue templates (bug / feature / WING verification), and PR template.
- CI workflow building against Node 18, 20, and 22.
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
