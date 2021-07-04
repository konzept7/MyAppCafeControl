import { Job } from './job'
import { IShadow, IShadowState } from './shadow'

enum ProgramEvents {
  readyForUpdate = "readyForUpdate",
  stateChange = "stateChange",
  okay = "okay",
  shutdown = "shutdown"
}
interface ControllableProgram {

  // topics other than standard jobs, tunnels etc. that we should subscribe to
  // program will forward the message to handlemessage
  specialTopics: Array<string>;
  state: string;
  shadow: IShadow;

  connect(): Promise<any>;
  disconnect(): Promise<any>;
  prepare(): Promise<any>;

  start(): Promise<any>;
  stop(isForced: boolean): Promise<any>;
  shutdownGracefully(inSeconds: number): Promise<any>;

  isReadyForUpdate(): boolean;
  update(job: Job): Promise<any>;

  handleJob(job: Job): Promise<any>
  handleShadow(shadow: IShadowState): Promise<any>
  handleMessage(topic: string, message: any): Promise<any>
}

export { ProgramEvents, ControllableProgram }