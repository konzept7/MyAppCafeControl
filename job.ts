// ********************************************
// *** PUBLISH, SUBSCRIBE, JOBS
// ********************************************

import { mqtt } from 'aws-iot-device-sdk-v2';

function baseJobTopic(thingName: string) {
  return `$aws/things/${thingName}/jobs/`;
}

const JOBTOPICS = {
  NOTIFY: 'notify-next',
  UPDATE: 'update',
  NEXT: '$next/get/accepted'
}

// the document from s3, containing all the information necessary for the operation
class JobDocument {
  operation!: string;
  isRestartNeeded: boolean | undefined;
  images: Array<string> | undefined;
  isForced: boolean | undefined;
  command: string | undefined;
  options: any | undefined;
  url: string | undefined;
  body: string | undefined;
  httpMethod: string | undefined;
  boxId: string | undefined;
}
// details about the step we are currently in
class StatusDetails {
  progress: number | undefined;
  errorCode: string | undefined;
  message: string | undefined;
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
  public Progress(progress: number | undefined, step: string | undefined): JobRequest {
    console.log('progressing job with id ' + this.jobId)
    this.status = 'IN_PROGRESS';
    if (progress) {
      this.statusDetails = new StatusDetails();
      this.statusDetails.progress = progress;
      this.statusDetails.currentStep = step;
    }
    return new JobRequest(this);
  }
  public Succeed(): JobRequest {
    console.log('succeeding job with id ' + this.jobId)
    this.status = 'SUCCEEDED';
    this.statusDetails = new StatusDetails();
    this.statusDetails.progress = 1;
    return new JobRequest(this)
  }
  public Fail(reason: string, errorCode: string): JobRequest {
    console.log('failing job with id ' + this.jobId)
    this.status = 'FAILED';
    this.statusDetails = new StatusDetails();
    this.statusDetails.message = reason;
    this.statusDetails.errorCode = errorCode;
    return new JobRequest(this)
  }
}
// the request that will be sent out to aws iot
class JobRequest {
  status!: string;
  statusDetails: StatusDetails | undefined;
  constructor(job: Job) {
    this.status = job.status;
    this.statusDetails = job.statusDetails;
  }
}

// sends an update for the job to aws iot
function jobUpdate(jobId: string, jobRequest: JobRequest, thingName: string, connection: mqtt.MqttClientConnection): void {
  console.log('sending job update', jobRequest);
  connection.publish(baseJobTopic(thingName) + jobId + '/update', JSON.stringify(jobRequest), mqtt.QoS.AtLeastOnce, false);
}

export { baseJobTopic, Job, JobDocument, JobRequest, JOBTOPICS, jobUpdate, StatusDetails }