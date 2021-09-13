// ********************************************
// *** IMPORTS AND SHIT
// ********************************************

const express = require('express');
const cors = require('cors');

import { mqtt, io, iot } from 'aws-iot-device-sdk-v2';
import { access } from 'fs/promises';
import { constants, existsSync } from 'fs';

import { baseJobTopic, Job, JOBTOPICS } from './job'
import { shadowTopic, ShadowSubtopic, ServerShadowState } from './shadow'
import { sleep } from './common'
import { ControllableProgram } from './controllableProgram';
import { Tunnel, tunnelTopic } from './tunnel';
import { Myappcafeserver, ServerState } from './myappcafeserver'

import { log, error } from './log'

import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config();


// ********************************************
// *** CHECK SETUP
// ********************************************

// check if we are in a valid region
// this is necessary to configure the endpoint
const region = process.env.AWS_REGION || 'eu-central-1';
const endpoints: {
   [index: string]: string
} = {
   ['eu-central-1']: 'a3uscbqsl8nzvk-ats.iot.eu-central-1.amazonaws.com'
}

if (!region) {
   error('Please set your region as an environment variable to one of the following values: ', Object.keys(endpoints).toString())
   process.exit(-1)
}

const endpoint: string = endpoints[region]
if (!endpoint) {
   error('Could not find a suitable endpoint for your configured region. Please check if region is set to one of the allowed values: ',
      Object.keys(endpoints).toString())
   process.exit(-1)
}

// checking certificates and keys
const certDir = './'
const rootCertPath = certDir + 'root-CA.crt';
const privateKeyPath = certDir + 'me.private.key';
const certPath = certDir + 'me.cert.pem';
(async () => {
   try {
      await access(rootCertPath, constants.R_OK);
   } catch (err) {
      error('could not find root certificate, please provide it under: ' + rootCertPath, err)
      process.exit(-1)
   }
   try {
      await access(privateKeyPath, constants.R_OK);
   } catch (err) {
      error('could not find private key, please provide it under: ' + privateKeyPath, err)
      process.exit(-1)
   }
   try {
      await access(certPath, constants.R_OK);
   } catch (err) {
      error('could not find thing certificate, please provide it under: ' + certPath, err)
      process.exit(-1)
   }
})()
const thingName = process.env.THINGNAME || "";
if (thingName === "") {
   error('Please provide your thing name as environment variable [THINGNAME]')
   process.exit(-1)
}
const clientId = "MyAppCafeControl-" + thingName
const serverPath = process.env.MYAPPCAFESERVER_PATH || "";
if (serverPath === "") {
   error('Please provide your server path as environment variable [MYAPPCAFESERVER_PATH]')
   process.exit(-1)
}
const localproxyPath = process.env.LOCALPROXY_PATH || "";
if (process.env.PLATFORM != "x86" && (localproxyPath === "" || !existsSync(path.join(localproxyPath, 'localproxy')))) {
   error('Either you have not set the local proxy path or there is no local proxy executable in the directory. Please provide your local proxy path as environment variable [LOCALPROXY_PATH]')
   process.exit(-1);
}


// ********************************************
// *** MYAPPCAFE SERVER HANDLING
// ********************************************

// decoder for binary arrays
const decoder = new TextDecoder('utf8');

async function execute_session(connection: mqtt.MqttClientConnection, program: ControllableProgram) {
   return new Promise(async (resolve, reject) => {

      connection.on('error', (err) => {
         error('error on mqtt connection, trying to reconnect', err);
         reject();
      });

      connection.on('disconnect', () => {
         resolve('connection was closed gracefully')
      });

      try {
         const on_job = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            log(`Job received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            const execution = (JSON.parse(json)).execution;
            if (!execution) return;
            const job: Job = Object.assign(new Job(), execution);
            log('received a new job', job);
            try {
               await program.handleJob(job);
            } catch (err) {
               error('program could not handle job', err)
            }
         }

         const on_running_jobs = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            log(`Running jobs received. topic:"${topic}"`);
            const inProgressJobs = (JSON.parse(json)).inProgressJobs;
            const inProgress: Array<Job> = inProgressJobs.map((j: any) => {
               const job: Job = Object.assign(new Job(), j);
               return job
            })
            log('received in progress jobs, handling one by one', inProgress);
            for (let index = 0; index < inProgress.length; index++) {
               const job = inProgress[index];
               log('handling job in progress', job)
               const topic = `$aws/things/${thingName}/jobs/${job.jobId}/`
               await connection.subscribe(topic + JOBTOPICS.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_job)
               await connection.publish(topic + JOBTOPICS.GET, '', mqtt.QoS.AtLeastOnce, false)
            }
            const queuedJobs = (JSON.parse(json)).queuedJobs;
            const queued: Array<Job> = queuedJobs.map((j: any) => {
               const job: Job = Object.assign(new Job(), j);
               return job
            })
            log('received queued jobs', queued);
            for (let index = 0; index < queued.length; index++) {
               const job = queued[index];
               log('handling queued job', job)
               const topic = `$aws/things/${thingName}/jobs/${job.jobId}/`
               await connection.subscribe(topic + JOBTOPICS.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_job)
               await connection.publish(topic + JOBTOPICS.GET, '', mqtt.QoS.AtLeastOnce, false)
            }
         }

         const on_shadow = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            log(`Shadow received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            log(json);
         }

         const on_tunnel = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const tunnelAttributes = decoder.decode(payload);
            const json = JSON.parse(tunnelAttributes);
            log(`Tunnel notification received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            log('received tunnel ');
            const tunnel = new Tunnel(region, json.services, json.clientAccessToken)
            program.handleTunnel(tunnel);
         }

         const jobTopic = baseJobTopic(thingName);
         await connection.subscribe(jobTopic + JOBTOPICS.NOTIFY, mqtt.QoS.AtLeastOnce, on_job)
         await connection.subscribe(jobTopic + JOBTOPICS.NEXT, mqtt.QoS.AtLeastOnce, on_job)
         await connection.subscribe(jobTopic + JOBTOPICS.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_running_jobs)
         connection.publish(jobTopic + JOBTOPICS.GET, '', mqtt.QoS.AtLeastOnce, false)

         const myShadowTopic = shadowTopic(thingName);
         await connection.subscribe(myShadowTopic + ShadowSubtopic.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_shadow)
         await connection.subscribe(myShadowTopic + ShadowSubtopic.GET_REJECTED, mqtt.QoS.AtLeastOnce, on_shadow)
         await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_DELTA, mqtt.QoS.AtLeastOnce, on_shadow)
         await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_ACCEPTED, mqtt.QoS.AtLeastOnce, on_shadow)
         await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_REJECTED, mqtt.QoS.AtLeastOnce, on_shadow)
         // publish an empty shadow to get the current shadow
         connection.publish(myShadowTopic + 'get', '', mqtt.QoS.AtLeastOnce, false);
         const myTunnelTopic = tunnelTopic(thingName);
         await connection.subscribe(myTunnelTopic, mqtt.QoS.AtLeastOnce, on_tunnel)

      } catch (err) {
         error('error while executing session', err)
         reject(err);
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
log(endpoint)
config_builder.with_endpoint(endpoint)

// force node to wait 60 seconds before killing itself, promises do not keep node alive
setTimeout(() => { }, 60 * 1000);

const config = config_builder.build();
const client = new mqtt.MqttClient(client_bootstrap);
const connection = client.new_connection(config);

// function publish(topic: string, message: any): void {
//    debug('sending message to topic ' + topic, message)
//    const msg = {
//       message: message
//    };
//    const json = JSON.stringify(msg);
//    connection.publish(topic, json, mqtt.QoS.AtLeastOnce, false);
// }

// connects to aws iot and retries after 10 seconds on error
(async () => {
   await connection.connect()

   // let program: ControllableProgram;

   // create server instance

   const serverUrl = "http://localhost:5002/api/"
   const myappcafeserver = new Myappcafeserver(serverUrl, serverUrl + 'appstate', serverUrl + 'orderhub', serverPath, thingName, connection);
   try {
      await myappcafeserver.prepare();
   } catch (err) {
      error('error while preparing myappcafeserver', err)
   }
   myappcafeserver.connect();
   myappcafeserver.on('change', (newState: ServerState) => {
      log('received state change from server, reporting shadow change')
      const state = new ServerShadowState();
      state.reported = newState;
      myappcafeserver.shadow.setCurrentState(state);
   })

   while (true) {
      try {
         await execute_session(connection, myappcafeserver);
         log('session terminated gracefully, exiting application');
         process.exit(0);
      } catch (err) {
         error('error while session execution, retrying connection after 10 seconds', err)
         await sleep(10 * 1000)
      }
   }
})()

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
   log('node.js static server listening on port: ' + port + ", with websockets listener")
})