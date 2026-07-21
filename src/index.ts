#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConsoleOSC } from "./osc-client.js";
import { registerX32Tools } from "./x32-tools.js";
import { registerWingTools } from "./wing-tools.js";

/**
 * Environment variables:
 *   CONSOLE_TYPE   "x32" | "wing"           (default: "x32")
 *   CONSOLE_IP     IP address of the console (default: 192.168.0.10)
 *   CONSOLE_PORT   OSC remote port           (default: 10023 for x32, 2223 for wing)
 *   LOCAL_PORT     Local UDP port to bind    (default: 10024)
 */
const consoleType = (process.env.CONSOLE_TYPE || "x32").toLowerCase();
const consoleIp = process.env.CONSOLE_IP || "192.168.0.10";
const defaultPort = consoleType === "wing" ? 2223 : 10023;
const remotePort = Number(process.env.CONSOLE_PORT || defaultPort);
const localPort = Number(process.env.LOCAL_PORT || 10024);

async function main() {
  const osc = new ConsoleOSC(consoleIp, remotePort, localPort, consoleType);
  await osc.waitUntilReady();
  osc.keepAlive();

  const server = new McpServer({
    name: "x32-wing-mcp",
    version: "0.1.0",
  });

  if (consoleType === "wing") {
    registerWingTools(server, osc);
  } else {
    registerX32Tools(server, osc);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`x32-wing-mcp running: console=${consoleType} ip=${consoleIp}:${remotePort}`);
}

main().catch((err) => {
  console.error("Fatal error starting x32-wing-mcp:", err);
  process.exit(1);
});
