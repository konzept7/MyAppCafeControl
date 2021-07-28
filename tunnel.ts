// ********************************************
// *** SECURE TUNNEL
// ********************************************

import { exec, spawn } from 'child_process';
import { access } from 'fs';
import path from 'path';


function tunnelTopic(thingName: string) {
  // handles the mqtt connection
  return `$aws/things/${thingName}/tunnels/notify`
}

const TunnelServices: {
  [index: string]: number
} = Object.freeze({
  "SSH": 22,
  "VNC": 48000,
  "MYAPPCAFESERVER": 5002,
  "STATUS-FRONTEND": 5005,
  "TERMINAL": 5006,
  "DISPLAY-QUEUE": 5007,
  "CONFIG-PROVIDER": 8000,
  "GATE": 49000,
  "ROBOT": 50000
})

class Tunnel {

  private _region: string;
  private _services: Array<string>
  private _token: string;

  constructor(region: string, services: Array<string>, token: string) {
    this._region = region;
    this._services = services;
    this._token = token;
  }

  public isOpen: boolean = false

  isInstalled() {
    access("./aws-iot-localproxy", (err) => {
      console.error(err, "localproxy not installed")
      return false;
    })
    return true;
  }

  open() {
    const proxyPath = path.join(process.env.LOCALPROXY_PATH || '', 'localproxy')
    try {
      const iotagent = spawn(proxyPath, [
        '-r', this._region,
        '-d', this._services.map(s => s + '=' + TunnelServices[s]).join(','),
        '-t', this._token,
      ]);
      iotagent.on('error', (e: Error) => console.error(e));
      iotagent.on('close', (e: Error) => console.info(e));
      iotagent.stderr.on('data', (data: any) => {
        console.error('stderr');
        console.error(Buffer.from(data).toString());
      });

      iotagent.stdout.on('data', (data: any) => {
        console.error('stdout');
        console.error(Buffer.from(data).toString());
      });
    } catch (error) {
      console.error('error spawning tunnel command', proxyPath, error)
      this.isOpen = false;
      return;
    }
    this.isOpen = true;
  }
  stop() {
    exec('sudo pkill localproxy');
    this.isOpen = false;
  }
}

export { Tunnel, tunnelTopic }