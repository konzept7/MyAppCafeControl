// ********************************************
// *** IMPORTS AND SHIT
// ********************************************

const express = require('express');
const cors = require('cors');
import {
   mqtt,
   io,
   iot
   // greengrass
} from 'aws-iot-device-sdk-v2';
import {
   access
} from 'fs/promises';
import {
   constants,
   // existsSync,
   // createReadStream,
   // createWriteStream
} from 'fs';
import {
   exec,
   ExecOptions
} from 'child_process';
import EventEmitter from 'events';
import axios from 'axios';
const signalR = require('@microsoft/signalr')

// const crypto = require('crypto');
// const {
//    exec
// } = require('child_process');
// const path = require('path');

// const https = require('https');
// const url = require('url');

// ********************************************
// *** CHECK SETUP
// ********************************************

// check if we are in a valid region
// this is necessary to configure the endpoint
const region = process.env.REGION || 'de';
const endpoints: {
   [index: string]: string
} = {
   de: 'a3uscbqsl8nzvk-ats.iot.eu-central-1.amazonaws.com'
}

if (!region) {
   console.error('Please set your region as an environment variable to one of the following values: ', Object.keys(endpoints).toString())
   process.exit(-1)
}

const endpoint: string = endpoints[region]
if (!endpoint) {
   console.error('Could not find a suitable endpoint for your configured region. Please check if region is set to one of the allowed values: ',
      Object.keys(endpoints).toString())
   process.exit(-1)
}

// checking certificates and keys
const certDir = './' // 'C:\\Users\\fbieleck\\source\\repos\\MyAppCafeControl\\' //'/etc/ssl/certs/'
const rootCertPath = certDir + 'root-CA.crt';
const privateKeyPath = certDir + 'me.private.key';
const certPath = certDir + 'me.cert.pem';
(async () => {
   try {
      await access(rootCertPath, constants.R_OK);
   } catch (error) {
      console.error('could not find root certificate, please provide it under: ' + rootCertPath, error)
      process.exit(-1)
   }
   try {
      await access(privateKeyPath, constants.R_OK);
   } catch (error) {
      console.error('could not find private key, please provide it under: ' + privateKeyPath, error)
      process.exit(-1)
   }
   try {
      await access(certPath, constants.R_OK);
   } catch (error) {
      console.error('could not find thing certificate, please provide it under: ' + certPath, error)
      process.exit(-1)
   }
})()
const clientId = process.env.CLIENT_ID || 'sdk-nodejs-e936c632-78a6-4dde-819a-56fdc764ab67';
if (!clientId) {
   console.error('Please provide your client id as environment variable [CLIENT_ID]')
   process.exit(-1)
}
const thingName = process.env.THING_NAME || 'TutorialThing';
if (!clientId) {
   console.error('Please provide your thing name as environment variable [THING_NAME]')
   process.exit(-1)
}


// ********************************************
// *** PUBLISH, SUBSCRIBE, JOBS
// ********************************************

const topic = 'topic_1'
const baseJobTopic = `$aws/things/${thingName}/jobs/`
const JOBTOPICS = {
   NOTIFY: baseJobTopic + 'notify-next',
   UPDATE: baseJobTopic + 'update',
   NEXT: baseJobTopic + '$next/get/accepted'
}

// the document from s3, containing all the information necessary for the operation
class JobDocument {
   operation!: string;
   isRestartNeeded: boolean | undefined;
   images: Array<string> | undefined;
   isForced: boolean | undefined;
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

// ********************************************
// *** MYAPPCAFE SERVER HANDLING
// ********************************************

//    Starting = 0,
//    NeverInitialized,
//    Okay,
//    Maintenance,
//    Updating,
//    Paused,
//    Pausing,
//    Restarting,
//    FatalError


// let serverStatus: string = 'closed';

async function awaitableExec(command: string, options: ExecOptions) {
   return new Promise((resolve, reject) => {
      const child = exec(command, options, (error, stdOut, stdErr) => {
         if (error) {
            console.error('error executing child process', error)
            reject(error)
            return;
         }
      })
      child.on('error', (error) => {
         if (error) {
            console.error('error executing child process', error)
            reject(error)
            return
         }
      })
      child.on('message', (message) => {
         console.log(message);
      })
      child.on('exit', (code) => {
         console.log('child process exited with code ' + code)
         resolve(code);
      })
   })
}

const serverUrl = "http://localhost:5002/api/"
class Myappcafeserver extends EventEmitter {
   private _retryTime = 24 * 60 * 60 * 1000;
   private _stateConnection!: any;
   private _hub!: string;
   private _state!: string;

   private _serverPath = process.env.SERVERPATH || "C:\\Users\\fbieleck\\source\\repos\\MyAppCafeServer" // "/home/pi/srv/MyAppCafeServer";

   get state() {
      return this._state;
   }
   set state(value) {
      if (this._state === value) return;

      this._state = value;

      if (this.isReadyForUpdate()) {
         this.emit('readyForUpdate');
      }

      this.emit('change', value);
   }

   constructor(hub: string) {
      super();
      this.state = 'closed'
      this._hub = hub;
      this._stateConnection = new signalR.HubConnectionBuilder()
         .withUrl(this._hub)
         .withAutomaticReconnect({
            nextRetryDelayInMilliseconds: (retryContext: any) => {
               this.state = "closed";
               if (retryContext.elapsedMilliseconds < 60 * 1000) {
                  // If we've been reconnecting for less than 60 seconds so far,
                  // wait 5 seconds before the next reconnect attempt.
                  return 5 * 1000;
               } else if (retryContext.elapsedMilliseconds < this._retryTime) {
                  // If we've been reconnecting for less than 30 minutes so far,
                  // wait 5 seconds before the next reconnect attempt.
                  return 30 * 1000;
               } else {
                  // If we've been reconnecting for more than 60 seconds so far, stop reconnecting.
                  this.state = "reload";
                  return null;
               }
            },
         })
         .configureLogging("information")
         .build();

      this._stateConnection.onclose((error: any) => {
         console.error("server disconnected", error);
         this.state = "closed";
      });

      this._stateConnection.onreconnected((connectionId: string) => {
         console.log("reconnected with connectionId " + connectionId);
      });

      this._stateConnection.on("current", (args: any) => {
         this.state = args
      });
   }

   isReadyForUpdate(): boolean {
      return this.state === 'closed' || this.state === 'NeverInitialized' || this.state === 'FatalError';
   }

   async connect() {
      return new Promise(async (resolve) => {
         while (!this._stateConnection || this.state === 'closed') {
            this._stateConnection
               .start({
                  withCredentials: false
               })
               .then(() => {
                  console.log("connected to signalR");
                  resolve('connected to state hub');
                  return;
               })
               .catch((error: any) => {
                  myappcafeserver.state = "closed";
                  console.error('error starting connection to server', error);
               });
            // wait for 15 seconds before trying to connect again
            await sleep(15 * 1000)
         }
      })
   }

   async shutdown(inSeconds: number) {
      if (!inSeconds) inSeconds = 10;
      console.log('stopping server if not already closed')
      return new Promise(async (resolve, reject) => {
         if (this.state !== 'closed') {
            try {
               await axios.post(serverUrl + "init/shutdown/" + Math.floor(inSeconds));
            } catch (error) {
               console.error('error shutting down application', error);
               reject(error);
            }
            console.log('scheduled server shutdown in ' + inSeconds + " seconds")
         }
         this.on('change', newValue => {
            if (newValue === 'closed')
               resolve('server is shut down');
         })
      })
   }

   async executeUpdate(job: Job) {
      return new Promise(async (resolve, reject) => {
         console.log('starting update now');

         let progress = 0.1
         await this.shutdown(10);
         let progressRequest = job.Progress(progress, 'shutting down application');
         jobUpdate(job.jobId, progressRequest);

         const images = (!job.jobDocument.images || job.jobDocument.images === []) ? containers : job.jobDocument.images;
         console.log('handling update request', images);
         progress += 0.1
         progressRequest = job.Progress(progress, 'downloading');
         jobUpdate(job.jobId, progressRequest);

         const step = (0.95 - progress) / (images.length * 2);

         // TODO: maybe close chromium on server and display update message
         // await awaitableExec("pkill chromium", {cwd: process.cwd()})
         // await awaitableExec("chromium-browser --noerrdialogs /home/pi/srv/MyAppCafeControl/update.html --incognito --kiosk --start-fullscreen --disable-translate --disable-features=TranslateUI --window-size=1024,768 --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0", {cwd: process.cwd()})

         for (let index = 0; index < images.length; index++) {
            const image = images[index];
            try {

               // await awaitableExec('docker-compose pull ' + image, {
               //    cwd: this._serverPath
               // })
               progress += step;
               progressRequest = job.Progress(progress, 'pulled ' + image);
               jobUpdate(job.jobId, progressRequest)
            } catch (error) {
               console.error('error while pulling image ' + image, error)
               reject(error)
            }

            try {
               await awaitableExec('docker-compose stop ' + image, {
                  cwd: this._serverPath
               })
               await awaitableExec('docker-compose up -d ' + image, {
                  cwd: this._serverPath
               })
               progress += step;
               progressRequest = job.Progress(progress, 'restarted ' + image);
               jobUpdate(job.jobId, progressRequest)

            } catch (error) {
               console.error('error while restarting image ' + image, error)
               reject(error)
            }
         }
         const succeeded = job.Succeed();
         jobUpdate(job.jobId, succeeded);

         // await awaitableExec("chromium-browser --noerrdialogs http://192.168.0.17:5005/ --incognito --kiosk --start-fullscreen --disable-translate --disable-features=TranslateUI --window-size=1024,768 --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0", {cwd: process.cwd()})

         resolve('all images updated successfully');
      })
   }
   async update(job: Job) {
      if (this.isReadyForUpdate() || job.jobDocument.isForced) {
         return this.executeUpdate(job);
      }
      this.once('readyForUpdate', () => {
         return this.executeUpdate(job);
      })

   }
}

const myappcafeserver = new Myappcafeserver(serverUrl + "appstate");
myappcafeserver.connect();


// decoder for binary arrays
const decoder = new TextDecoder('utf8');

// handles the mqtt connection
async function execute_session(connection: mqtt.MqttClientConnection) {
   return new Promise(async (resolve, reject) => {

      connection.on('error', (error) => {
         console.error('error on mqtt connection, trying to reconnect', error);
         reject();
      });

      connection.on('disconnect', () => {
         resolve('connection was closed gracefully')
      });

      try {
         const on_publish = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            console.log(`Publish received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            console.log(json);
            const message = JSON.parse(json);
            if (message.command && message.command === "end") {
               console.log('application exit requested, disconnecting')
               connection.disconnect()
            }
         }

         const on_job = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            console.log(`Job received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            const execution = (JSON.parse(json)).execution;
            if (!execution) return;
            const job: Job = Object.assign(new Job(), execution);
            console.log('received a new job', job);

            if (job.jobDocument.operation === 'update') {
               updateHandler(job);
               return;
            }

            if (job.status === 'QUEUED') {
               console.log('job is queued, work on job starts now')
               var request = job.Progress(0.5, 'asdf');
               jobUpdate(job.jobId, request);
               console.log('updated job')
            }
         }

         await connection.subscribe(topic, mqtt.QoS.AtLeastOnce, on_publish);
         await connection.subscribe(JOBTOPICS.NOTIFY, mqtt.QoS.AtLeastOnce, on_job)
         await connection.subscribe(JOBTOPICS.NEXT, mqtt.QoS.AtLeastOnce, on_job)
      } catch (error) {
         console.error(error, 'error while executing session')
         reject();
      }
   });
}
// ********************************************
// *** CLIENT CONFIGURATION
// ********************************************

const client_bootstrap = new io.ClientBootstrap();
const config_builder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(certPath, privateKeyPath);
config_builder.with_certificate_authority_from_path(undefined, 'root-CA.crt');
config_builder.with_clean_session(false);

config_builder.with_client_id(clientId)
console.log(endpoint)
config_builder.with_endpoint(endpoint)

// force node to wait 60 seconds before killing itself, promises do not keep node alive
setTimeout(() => { }, 60 * 1000);

const config = config_builder.build();
const client = new mqtt.MqttClient(client_bootstrap);
const connection = client.new_connection(config);

const debugTopic = thingName + '/debug'

function publish(topic: string, message: any): void {
   console.debug('sending message to topic ' + topic, message)
   const msg = {
      message: message
   };
   const json = JSON.stringify(msg);
   connection.publish(topic, json, mqtt.QoS.AtLeastOnce, false);
}

// sends an update for the job to aws iot
function jobUpdate(jobId: string, jobRequest: JobRequest): void {
   console.log('sending job update', jobRequest);
   connection.publish(baseJobTopic + jobId + '/update', JSON.stringify(jobRequest), mqtt.QoS.AtLeastOnce, false);
}

// helper function to delay execution
function sleep(milliseconds: number) {
   return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// connects to aws iot and retries after 10 seconds on error
(async () => {
   await connection.connect()
   publish(debugTopic, 'starting connection')
   while (true) {
      try {
         await execute_session(connection);
         console.log('session terminated gracefully, exiting application');
         process.exit(0);
      } catch (error) {
         console.error('error while session execution, retrying connection after 10 seconds', error)
         await sleep(10 * 1000)
      }
   }
})()


// ********************************************
// *** JOBS HANDLING
// ********************************************


// handles operation "update"
// in most cases, this will handle docker updates for myappcafe containers
// if this program shall be updated, use the reboot command, this will
// automatically trigger a pull of the repository
// you can specify containers to update in the jobdocument (prop 'images' -> container names that
// should be updated), if none are provided, a full update will be executed

// if possible, please use images in that order
// all frontend applications reload when myappcafeserver is restarted,
// that way we ensure that the browser reloads (and gets the updated version of our frontends)
const containers = ['redis', 'config-provider', 'status-frontend', 'display-queue', 'order-terminal', 'myappcafeserver']
async function updateHandler(job: Job) {

   // if no details are provided or the current step is requested, we did not do any work on the job yet
   if (job.status === 'QUEUED' || !job.statusDetails || !job.statusDetails.currentStep || job.statusDetails.currentStep === 'requested') {
      const scheduledJobRequest = job.Progress(0.01, 'scheduled');
      scheduledJobRequest.statusDetails = scheduledJobRequest.statusDetails || new StatusDetails();
      scheduledJobRequest.statusDetails.message = 'update scheduled for next maintenance';
      jobUpdate(job.jobId, scheduledJobRequest);
   }
   if (job.statusDetails?.currentStep === 'scheduled') {
      try {
         await myappcafeserver.update(job);
         console.log('successfully registered update for myappcafeserver')
      } catch (error) {
         console.error('error on updating myappcafeserver', error);
         const failed = job.Fail(JSON.stringify(error), "AXXXX");
         jobUpdate(job.jobId, failed);
      }
   }
}



// ********************************************
// *** EXPRESS AND SERVER SETUP
// ********************************************

//init Express
var app = express();
app.use(express.json());
app.use(cors());
// start the server
const port = 9000
app.listen(port, function () {
   console.log('node.js static server listening on port: ' + port + ", with websockets listener")
})