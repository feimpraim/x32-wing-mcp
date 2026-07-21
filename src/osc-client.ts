import osc from "osc";

/**
 * Thin wrapper around a UDP OSC socket for talking to a Behringer
 * X32 / M32 / WING console.
 *
 * All three consoles speak OSC over UDP with no authentication.
 * The console will only push state/meter updates to a subscriber
 * that periodically re-sends `/xremote` (X32/M32) or the WING
 * equivalent — see keepAlive().
 */
export class ConsoleOSC {
  private port: osc.UDPPort;
  private pending = new Map<string, { resolve: (args: any[]) => void; timer: NodeJS.Timeout }>();
  private ready: Promise<void>;

  constructor(
    private host: string,
    private remotePort: number,
    private localPort: number,
    private label: string = "console"
  ) {
    this.port = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: this.localPort,
      remoteAddress: this.host,
      remotePort: this.remotePort,
      metadata: true,
    });

    this.port.on("message", (msg: any) => {
      const pending = this.pending.get(msg.address);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(msg.args ?? []);
        this.pending.delete(msg.address);
      }
    });

    this.port.on("error", (err: Error) => {
      console.error(`[${this.label}] OSC socket error:`, err.message);
    });

    this.ready = new Promise((resolve) => {
      this.port.on("ready", () => resolve());
      this.port.open();
    });
  }

  async waitUntilReady() {
    await this.ready;
  }

  /** Fire-and-forget send. Use for set operations (fader, mute, EQ, etc). */
  send(address: string, args: Array<{ type: string; value: any }> = []) {
    this.port.send({ address, args });
  }

  /**
   * Send a "get" request (an OSC message with no args means "reply with
   * the current value") and await the console's reply on the same address.
   * Throws if the console doesn't reply within timeoutMs.
   */
  query(address: string, timeoutMs = 800): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(address);
        reject(new Error(`[${this.label}] Timeout waiting for reply from ${address}`));
      }, timeoutMs);

      this.pending.set(address, { resolve, timer });
      this.send(address);
    });
  }

  /**
   * Like query(), but resolves to `undefined` instead of rejecting when the
   * console doesn't answer within timeoutMs. Used by the scene reader so a
   * single missing/unsupported parameter never aborts a full-console dump.
   */
  async querySafe(address: string, timeoutMs = 600): Promise<any[] | undefined> {
    try {
      return await this.query(address, timeoutMs);
    } catch {
      return undefined;
    }
  }

  /**
   * Keeps a live subscription alive so the console streams back state
   * changes. Required by the X32/M32; harmless to call for WING too.
   * Renews every 8s (consoles typically time out subscriptions at 10s).
   */
  keepAlive(intervalMs = 8000) {
    this.send("/xremote");
    return setInterval(() => this.send("/xremote"), intervalMs);
  }

  close() {
    this.port.close();
  }
}

/** Zero-pad a channel/bus/DCA number to the console's 2-digit address format. */
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
