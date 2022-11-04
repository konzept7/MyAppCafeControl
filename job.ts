// ********************************************
// *** PUBLISH, SUBSCRIBE, JOBS
// ********************************************

import { mqtt } from 'aws-iot-device-sdk-v2';
import { nanoid } from 'nanoid';
import { info } from './log'

function baseJobTopic(thingName: string) {
  return `$aws/things/${thingName}/jobs/`;
}

const JOBTOPICS = {
  GET_ACCEPTED: 'get/accepted',
  GET: 'get',
  NOTIFY: 'notify-next',
  UPDATE: 'update',
  NEXT: '$next/get/accepted',
  QUEUED: '$next/get/queued',
  CANCELED: "canceled",
  COMPLETED: "completed"
}

// the document from s3, containing all the information necessary for the operation
class JobDocument {
  operation!: string;
  isRestartNeeded: boolean | undefined;
  images: Array<string> | undefined;
  isForced: boolean | undefined;
  command: string | undefined;
  option: JobOption | undefined;
  parameters: Record<string, string> | undefined
  url: string | undefined;
  body: string | undefined;
  httpMethod: string | undefined;
  boxId: string | undefined;
  amount: number | undefined;
  shadowCondition: any | undefined;
  includeForTest: string | undefined;
}
// details about the step we are currently in
class StatusDetails {
  progress: number | undefined;
  errorCode: string | undefined;
  currentStep: string | undefined;
}
// the incoming job payload
class Job {
  status!: string;
  jobId!: string;
  queuedAt!: number;
  lastUpdatedAt!: number;
  jobDocument!: JobDocument;
  statusDetails: StatusDetails | undefined;
  public Progress(progress: number, step: string): JobRequest {
    info('progressing job with id ' + this.jobId)
    if (step) info('job is progressed with step', step)
    this.status = 'IN_PROGRESS';
    if (progress) {
      info('progress', progress)
      this.statusDetails = new StatusDetails();
      this.statusDetails.progress = progress;
      this.statusDetails.currentStep = step;
    }
    return new JobRequest(this);
  }
  public Succeed(message: string): JobRequest {
    info('succeeding job with id ' + this.jobId)
    this.status = 'SUCCEEDED';
    this.statusDetails = new StatusDetails();
    this.statusDetails.progress = 1;
    if (message) this.statusDetails.currentStep = message;
    return new JobRequest(this)
  }
  public Fail(reason: string, errorCode: string): JobRequest {
    info('failing job with id ' + this.jobId, reason)
    this.status = 'FAILED';
    this.statusDetails = new StatusDetails();
    this.statusDetails.currentStep = reason;
    this.statusDetails.errorCode = errorCode;
    return new JobRequest(this)
  }

  // listens if any "outside" job events are incoming
  // for example if a job was canceled or aborted
  // if a job was cancelled, the promise will be rejected
  public listenToJobEvents(connection: mqtt.MqttClientConnection) {
    info('subscribing to job updates for job ' + this.jobId)
    const baseTopic = "$aws/events/job/"
    return new Promise((resolve, reject) => {
      // cancelled job
      connection.subscribe(baseTopic + this.jobId + JOBTOPICS.CANCELED, mqtt.QoS.AtLeastOnce).then(reject)

      // completed job
      connection.subscribe(baseTopic + this.jobId + JOBTOPICS.COMPLETED, mqtt.QoS.AtLeastOnce).then(resolve)
    })
  }
}
// the request that will be sent out to aws iot
class JobRequest {
  status!: string;
  statusDetails: StatusDetails | undefined;
  jobId!: string
  operation!: string
  constructor(job: Job) {
    this.status = job.status;
    this.statusDetails = job.statusDetails;
    this.jobId = job.jobId;
    this.operation = job.jobDocument.operation;
  }
}

const customUpdateTopic = (thingName: string) => `mac/jobs/${thingName}/update`
// sends an update for the job to aws iot
function jobUpdate(jobId: string, jobRequest: JobRequest, thingName: string, connection: mqtt.MqttClientConnection): void {
  info('sending job update', jobRequest);
  const stepId = nanoid(12)
  connection.publish(baseJobTopic(thingName) + jobId + '/update', JSON.stringify(jobRequest), mqtt.QoS.AtLeastOnce, false);
  connection.publish(customUpdateTopic(thingName), JSON.stringify({ ...jobRequest, stepId }), mqtt.QoS.AtLeastOnce, false);
}

enum JobOption {
  soft = "soft",
  hard = "hard",
  forced = "forced",
  unpause = "unpause",
  block = "block",
  unblock = "unblock",
  deviceshutdown = "ShutDown",
  devicedisabled = "Disabled",
  on = "on",
  off = "off",
  noAutostart = "no-autostart",
  autostart = "autostart",
  immediateRestart = "immediate-restart",
}

export { baseJobTopic, Job, JobDocument, JobRequest, JOBTOPICS, jobUpdate, StatusDetails, JobOption }