// ********************************************
// *** SECURE TUNNEL
// ********************************************

import { exec, spawn } from 'child_process';
import { access } from 'fs';

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
  "ORDER-TERMINAL": 5006,
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
    const command = `nohup ./aws-iot-localproxy/localproxy -r ${this._region} -d ${this._services.map(s => s + '=' + TunnelServices[s]).join(',')} -t ${this._token} &> tunnel.log`
    console.log('opening tunnel now with command', command)
    try {
      spawn(command, { cwd: process.env.LOCALPROXY_PATH })
    } catch (error) {
      console.error('error spawning tunnel command', command, error)
      this.isOpen = false;
    }
    this.isOpen = true;
  }
  stop() {
    exec('sudo pkill localproxy');
    this.isOpen = false;
  }
}

export { Tunnel, tunnelTopic }