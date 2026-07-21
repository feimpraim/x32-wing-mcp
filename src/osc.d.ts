declare module "osc" {
  export interface OscArgument {
    type: string;
    value: any;
  }

  export interface OscMessage {
    address: string;
    args?: OscArgument[];
  }

  export interface UDPPortOptions {
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    metadata?: boolean;
  }

  export class UDPPort {
    constructor(options: UDPPortOptions);
    on(event: "ready" | "message" | "error", listener: (...args: any[]) => void): void;
    open(): void;
    close(): void;
    send(message: OscMessage): void;
  }
}
