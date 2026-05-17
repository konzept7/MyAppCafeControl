// ********************************************
// *** SECURE TUNNEL
// ********************************************

import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { log, warn, error } from "./log";

const execAsync = promisify(exec);

function tunnelTopic(thingName: string) {
  // handles the mqtt connection
  return `$aws/things/${thingName}/tunnels/notify`;
}

const TunnelServices: {
  [index: string]: number;
} = Object.freeze({
  SSH: 22,
  VNC: 48000,
  MYAPPCAFESERVER: 5002,
  "STATUS-FRONTEND": 5005,
  TERMINAL: 5006,
  "VNC-TERMINAL-LEFT": 48025, // will be forwarded by nginx to 192.168.155.25:48000
  "VNC-TERMINAL-RIGHT": 48026, // will be forwarded by nginx to 192.168.155.26:48000
  "DISPLAY-QUEUE": 5007,
  "CONFIG-PROVIDER": 8000,
  GATE1: 49122, // will be forwarded by nginx to 192.168.155.21:22
  GATE2: 49222, // will be forwarded by nginx to 192.168.155.21:22
  GATE3: 49322, // will be forwarded by nginx to 192.168.155.21:22
  ROBOT: 50023, // will be forwarded by nginx to 192.168.155.50:23
});

class Tunnel {
  private _region: string;
  private _services: Array<string>;
  private _token: string;

  constructor(region: string, services: Array<string>, token: string) {
    this._region = region;
    this._services = services;
    this._token = token;
  }

  public isOpen: boolean = false;

  async open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proxyPath = path.join(
        process.env.LOCALPROXY_PATH || "",
        "localproxy"
      );
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      try {
        const localProxyProcess = spawn(proxyPath, [
          "-r",
          this._region,
          "-d",
          this._services.map((s) => s + "=" + TunnelServices[s]).join(","),
          "-t",
          this._token,
        ]);
        localProxyProcess.on("error", (e: Error) => {
          error("error from localproxy execution", e);
          this.isOpen = false;
          settle(() => reject(e));
        });
        localProxyProcess.on("close", (code) => {
          warn("local proxy closed", code);
          this.isOpen = false;
          settle(() => reject(new Error("local proxy exited with code " + code)));
        });
        localProxyProcess.stderr.on("data", (data: any) => {
          warn("tunnel stderr", Buffer.from(data).toString());
        });
        localProxyProcess.stdout.on("data", (data: any) => {
          log("received tunnel data", Buffer.from(data).toString());
        });
        this.isOpen = true;
        settle(() => resolve());
      } catch (err) {
        error("error spawning tunnel command", { proxyPath, err });
        this.isOpen = false;
        settle(() => reject(err));
      }
    });
  }
  async stop(): Promise<void> {
    try {
      await execAsync("sudo pkill localproxy");
    } catch (err) {
      warn("pkill localproxy returned non-zero (may not be running)", err);
    }
    this.isOpen = false;
  }
}

export { Tunnel, tunnelTopic };
