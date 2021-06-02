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


class ShadowState {
  desired: ServerState | undefined;
  reported: ServerState | undefined;
}
class Shadow extends EventEmitter {
  private _state: ShadowState = new ShadowState();

  public get state(): ShadowState {
    return this._state;
  }

  setCurrentState(newState: ServerState) {
    if (this._state.reported === newState) return;
    this._state.reported = newState;
    this.emit('reportedShadowChange');
    if (connection) {
      const newShadow = new ShadowState();
      newShadow.reported = this._state.reported;
      const json = JSON.stringify({ state: { reported: { serverState: newState } } });
      console.log('reporting new shadow change', json)
      connection.publish(shadowTopic + ShadowSubtopic.UPDATE, json, mqtt.QoS.AtLeastOnce, false)
    }
  }

  metadata: any | undefined;
  version!: number;
  timestamp!: number;
}

export { ShadowSubtopic, shadowTopic, ShadowState, Shadow }