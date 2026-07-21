# Security Policy

## Supported versions

This project is pre-1.0 and under active development. Security fixes are applied
to the latest `main` and the most recent release.

## Reporting a vulnerability

Please **do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/feimpraim/x32-wing-mcp/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, steps to reproduce, and potential impact.

You can expect an initial response within a few days. Please give maintainers a
reasonable window to release a fix before any public disclosure.

## Scope and threat model

This is an MCP server that sends OSC commands to Behringer X32 / M32 / WING
consoles over a **local network**. Keep the following in mind:

- **OSC is unauthenticated and unencrypted.** Anyone on the same network segment
  as the console can read and write parameters. Run consoles on a trusted,
  isolated network — never expose the OSC port to the public internet.
- This server accepts configuration via environment variables (`CONSOLE_IP`,
  `CONSOLE_PORT`, etc.) and does not store credentials.
- The most impactful "security" issue here is **unintended control of live audio
  hardware** — for example a tool that writes an unexpected OSC address. Reports
  of tools that can silently disrupt a console's routing or output are in scope.

For general safety guidance (testing against live rigs, fader behavior), see the
[Safety section of the README](README.md#safety).
