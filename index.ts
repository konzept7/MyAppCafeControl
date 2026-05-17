// ********************************************
// *** IMPORTS AND SHIT
// ********************************************

const express = require('express');
const cors = require('cors');

import { mqtt, io, iot } from 'aws-iot-device-sdk-v2';
import { access } from 'fs/promises';
import { constants, existsSync } from 'fs';
import axios from 'axios';

// Global axios default. Per-call configs override this, so existing calls that
// explicitly request 1s/10s/30s/60s/120s timeouts keep their values. The only
// effect of this line is to give every *un-configured* axios call (~20 of them
// across myappcafeserver.ts, e.g. axios.post(url) with no options) a finite
// timeout instead of axios's no-timeout-by-default behavior. Without this, a
// wedged local container hangs the calling job handler forever.
axios.defaults.timeout = 60 * 1000;

import { baseJobTopic, Job, JOBTOPICS } from './job'
import { shadowTopic, ShadowSubtopic, ServerShadowState } from './shadow'
import { sleep, withTimeout } from './common'
import { ControllableProgram } from './controllableProgram';
import { Tunnel, tunnelTopic } from './tunnel';
import { Myappcafeserver, ServerState } from './myappcafeserver'

import { log, error } from './log'

import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config();

// Fail fast on unhandled errors. Anything that escapes here would otherwise leave
// the process running in an undefined state, which on these boxes manifests as
// "still up, but no longer processes MQTT jobs". Better to exit and let systemd
// restart the unit than to silently degrade.
process.on('unhandledRejection', (reason) => {
   error('unhandledRejection - exiting so systemd can restart', reason);
   process.exit(2);
});
process.on('uncaughtException', (err) => {
   error('uncaughtException - exiting so systemd can restart', err);
   process.exit(3);
});


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

// MQTT activity watchdog. Refreshed by every incoming message handler and by the
// periodic heartbeat publish below. If nothing touches it for WATCHDOG_MS, we
// assume the message loop is wedged (SDK thinks it is connected but no traffic
// flows, or our handlers stopped running) and exit so systemd restarts us.
let lastMqttActivityAt = Date.now();
const noteMqttActivity = () => { lastMqttActivityAt = Date.now(); };

// Per-message timeouts. Even though handleJob can legitimately do slow things
// (waiting for orders to finish, container restarts), nothing should be allowed
// to block the MQTT callback indefinitely - if one job wedges, no later job
// gets processed. 15min is generous enough for the slow operations and short
// enough that an operator notices.
const JOB_HANDLER_TIMEOUT_MS = 15 * 60 * 1000;
const TUNNEL_HANDLER_TIMEOUT_MS = 2 * 60 * 1000;

async function execute_session(connection: mqtt.MqttClientConnection, program: ControllableProgram) {
   return new Promise(async (resolve, reject) => {

      connection.on('error', (err) => {
         error('error on mqtt connection, trying to reconnect', err);
         reject(err);
      });

      connection.on('disconnect', () => {
         resolve('connection was closed gracefully')
      });

      try {
         const on_job = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            noteMqttActivity();
            const json = decoder.decode(payload);
            log(`Job received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            const execution = (JSON.parse(json)).execution;
            if (!execution) return;
            const job: Job = Object.assign(new Job(), execution);
            log('received a new job', job);
            try {
               await withTimeout(
                  program.handleJob(job),
                  JOB_HANDLER_TIMEOUT_MS,
                  `handleJob(${job.jobId ?? 'unknown'})`
               );
            } catch (err) {
               error('program could not handle job', err)
            }
         }

         const on_running_jobs = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            noteMqttActivity();
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
            noteMqttActivity();
            const json = decoder.decode(payload);
            log(`Shadow received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            log(json);
         }

         const on_tunnel = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            noteMqttActivity();
            const tunnelAttributes = decoder.decode(payload);
            const json = JSON.parse(tunnelAttributes);
            log(`Tunnel notification received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            log('received tunnel ');
            const tunnel = new Tunnel(region, json.services, json.clientAccessToken)
            try {
               await withTimeout(
                  program.handleTunnel(tunnel),
                  TUNNEL_HANDLER_TIMEOUT_MS,
                  'handleTunnel'
               );
            } catch (err) {
               error('program could not handle tunnel', err);
            }
         }

         const subscribe_all = async () => {
            const jobTopic = baseJobTopic(thingName);
            await connection.subscribe(jobTopic + JOBTOPICS.NOTIFY, mqtt.QoS.AtLeastOnce, on_job)
            await connection.subscribe(jobTopic + JOBTOPICS.NEXT, mqtt.QoS.AtLeastOnce, on_job)
            await connection.subscribe(jobTopic + JOBTOPICS.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_running_jobs)
            await connection.publish(jobTopic + JOBTOPICS.GET, '', mqtt.QoS.AtLeastOnce, false)

            const myShadowTopic = shadowTopic(thingName);
            await connection.subscribe(myShadowTopic + ShadowSubtopic.GET_ACCEPTED, mqtt.QoS.AtLeastOnce, on_shadow)
            await connection.subscribe(myShadowTopic + ShadowSubtopic.GET_REJECTED, mqtt.QoS.AtLeastOnce, on_shadow)
            await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_DELTA, mqtt.QoS.AtLeastOnce, on_shadow)
            await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_ACCEPTED, mqtt.QoS.AtLeastOnce, on_shadow)
            await connection.subscribe(myShadowTopic + ShadowSubtopic.UPDATE_REJECTED, mqtt.QoS.AtLeastOnce, on_shadow)
            await connection.publish(myShadowTopic + ShadowSubtopic.GET, '', mqtt.QoS.AtLeastOnce, false);

            const myTunnelTopic = tunnelTopic(thingName);
            await connection.subscribe(myTunnelTopic, mqtt.QoS.AtLeastOnce, on_tunnel)
         };

         // On a transient SDK-level reconnect, the broker may or may not have
         // retained subscriptions. Re-subscribing on every resume is idempotent
         // and cheap; not re-subscribing means a silently-dead session.
         connection.on('interrupt', (err) => {
            log('mqtt connection interrupted, awaiting resume', err)
         });
         connection.on('resume', (returnCode, sessionPresent) => {
            log(`mqtt connection resumed (rc=${returnCode}, sessionPresent=${sessionPresent}), re-subscribing`)
            noteMqttActivity();
            subscribe_all().catch((err) => error('failed to re-subscribe after resume', err));
         });

         await subscribe_all();

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
// Without an MQTT keepalive, idle TCP connections sitting behind consumer routers
// /CGNAT get silently dropped after a few minutes and the SDK never emits a
// disconnect. The session then waits forever for messages that will never arrive.
// 30s keepalive + 10s ping timeout means we detect a dead socket within ~40s,
// the SDK emits disconnect/error, and the outer reconnect loop runs.
config_builder.with_keep_alive_seconds(30)
config_builder.with_ping_timeout_ms(10 * 1000)

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

// MQTT activity watchdog parameters.
//
// Heartbeat: every HEARTBEAT_INTERVAL_MS we publish to our own shadow/get topic
// (which the device's IoT policy already permits, and which generates an
// inbound response on shadow/get/accepted). This exercises both publish and
// receive paths, so the watchdog sees activity even on completely idle boxes.
//
// Watchdog: every WATCHDOG_CHECK_INTERVAL_MS we check whether anything has
// touched lastMqttActivityAt within WATCHDOG_THRESHOLD_MS. If not, we
// process.exit() so systemd restarts the unit. This is the single most
// important defense against "box is up but no longer processes jobs" - even
// if every other recovery mechanism fails, the box will recover on its own.
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const WATCHDOG_CHECK_INTERVAL_MS = 30 * 1000;
const WATCHDOG_THRESHOLD_MS = 10 * 60 * 1000;

// connects to aws iot and retries after 10 seconds on error
(async () => {
   await connection.connect()
   noteMqttActivity();

   const heartbeatTopic = shadowTopic(thingName) + ShadowSubtopic.GET;
   setInterval(async () => {
      try {
         await connection.publish(heartbeatTopic, '', mqtt.QoS.AtLeastOnce, false);
         noteMqttActivity();
      } catch (err) {
         error('heartbeat publish failed', err);
      }
   }, HEARTBEAT_INTERVAL_MS);

   setInterval(() => {
      const idleMs = Date.now() - lastMqttActivityAt;
      if (idleMs > WATCHDOG_THRESHOLD_MS) {
         error(`mqtt watchdog: no activity for ${Math.round(idleMs / 1000)}s (>${WATCHDOG_THRESHOLD_MS / 1000}s), exiting so systemd can restart`);
         process.exit(4);
      }
   }, WATCHDOG_CHECK_INTERVAL_MS);

   // let program: ControllableProgram;

   // create server instance

   const serverUrl = "http://localhost:5002/api/"
   const myappcafeserver = new Myappcafeserver(serverUrl, serverUrl + 'appstate', serverUrl + 'orderhub', serverPath, thingName, connection);
   try {
      await myappcafeserver.prepare();
   } catch (err) {
      error('error while preparing myappcafeserver', err)
   }
   try {
      await myappcafeserver.connect();
   } catch (err) {
      error('error while connecting to myappcafeserver signalR hubs', err)
   }
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