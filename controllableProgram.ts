import { Job } from './job'
import { Shadow } from './shadow'

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

  connect(): Promise<any>;
  disconnect(): Promise<any>;

  start(): Promise<any>;
  stop(isForced: boolean): Promise<any>;
  shutdownGracefully(inSeconds: number): Promise<any>;

  isReadyForUpdate(): boolean;
  update(job: Job): Promise<any>;

  handleJob(job: Job): Promise<any>
  handleShadow(shadow: Shadow): Promise<any>
  handleMessage(topic: string, message: any): Promise<any>
}

export { ProgramEvents, ControllableProgram }