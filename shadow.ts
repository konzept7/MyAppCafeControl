import EventEmitter from 'events';
import { ServerState } from './myappcafeserver'
import { mqtt } from 'aws-iot-device-sdk-v2';

// ********************************************
// *** DEVICE SHADOW
// ********************************************

enum ShadowSubtopic {
  GET = "get",
  GET_ACCEPTED = "get/accepted",
  GET_REJECTED = "get/rejected",
  UPDATE = "update",
  UPDATE_DELTA = "update/delta",
  UPDATE_ACCEPTED = "update/accepted",
  UPDATE_REJECTED = "update/rejected",
  DELETE = "delete",
  DELETE_ACCEPTED = "delete/accepted",
  DELETE_REJECTED = "delete/rejected"
}
function shadowTopic(thingName: string) {
  return `$aws/things/${thingName}/shadow/`
}
interface IShadowState {
  desired: any;
  reported: any;
}

class ServerShadowState implements IShadowState {
  desired: ServerState | undefined;
  reported: ServerState | undefined;
}

interface IShadow {
  readonly state: IShadowState;
  metadata: any | undefined;
  version: number;
  timestamp: number;

  setCurrentState(newState: IShadowState): void
}
class ServerShadow extends EventEmitter implements IShadow {
  private _state!: IShadowState;
  private connection!: mqtt.MqttClientConnection;
  private _thingName: string;
  metadata: any | undefined;
  version!: number;
  timestamp!: number;

  constructor(connection: mqtt.MqttClientConnection, thingName: string, initialState: IShadowState) {
    super();
    this.connection = connection;
    this._thingName = thingName;
    this._state = initialState;
  }

  public get state(): IShadowState {
    return this._state;
  }

  setCurrentState(newState: IShadowState) {
    if (this._state.reported === newState) return;
    this._state.reported = newState;
    this.emit('reportedShadowChange');
    if (this.connection) {
      const json = JSON.stringify({ state: { reported: { serverState: newState } } });
      console.log('reporting new shadow change', json)
      this.connection.publish(shadowTopic(this._thingName) + ShadowSubtopic.UPDATE, json, mqtt.QoS.AtLeastOnce, false)
    } else {
      throw new Error('no valid connection to send current shadow state');
    }
  }
}

export { ShadowSubtopic, shadowTopic, IShadowState, IShadow, ServerShadow, ServerShadowState }