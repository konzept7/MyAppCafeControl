// ********************************************
// *** IMPORTS AND SHIT
// ********************************************

const express = require('express');
const cors = require('cors');

import { mqtt, io, iot } from 'aws-iot-device-sdk-v2';
import { access } from 'fs/promises';
import { constants } from 'fs';

import { baseJobTopic, Job, JOBTOPICS } from './job'
import { shadowTopic, ShadowSubtopic } from './shadow'
import { sleep } from './common'
import { ControllableProgram } from './controllableProgram';
import { Tunnel, tunnelTopic } from './tunnel';
import { Myappcafeserver, ServerState } from './myappcafeserver'
// import { ThingFactory } from './thing'

import * as dotenv from 'dotenv';
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
const certDir = './' // 'file://C:/Users\\fbieleck\\source\\repos\\MyAppCafeControl\\' //'/etc/ssl/certs/'
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
const thingName = process.env.THINGNAME || "";
if (thingName === "") {
   console.error('Please provide your thing name as environment variable [THINGNAME]')
   process.exit(-1)
}
const clientId = process.env.CLIENT_ID || "";
if (clientId === "") {
   console.error('Please provide your client id as environment variable [CLIENT_ID]')
   process.exit(-1)
}
if (!clientId.startsWith("MyAppCafeControl")) {
   console.error('client id must start with MyAppCafeControl', clientId)
   process.exit(-1)
}
const serverPath = process.env.MYAPPCAFESERVER_PATH || "";
if (serverPath === "") {
   console.error('Please provide your server path as environment variable [MYAPPCAFESERVER_PATH]')
   process.exit(-1)
}
const localproxyPath = process.env.LOCALPROXY_PATH || "";
if (localproxyPath === "") {
   console.error('Please provide your local proxy path as environment variable [LOCALPROXY_PATH]')
   process.exit(-1);
}

// let thing = ThingFactory.createThing(thingName, region);

// ********************************************
// *** MYAPPCAFE SERVER HANDLING
// ********************************************

// decoder for binary arrays
const decoder = new TextDecoder('utf8');

async function execute_session(connection: mqtt.MqttClientConnection, program: ControllableProgram) {
   return new Promise(async (resolve, reject) => {

      connection.on('error', (error) => {
         console.error('error on mqtt connection, trying to reconnect', error);
         reject();
      });

      connection.on('disconnect', () => {
         resolve('connection was closed gracefully')
      });

      try {
         const on_job = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            console.log(`Job received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            const execution = (JSON.parse(json)).execution;
            if (!execution) return;
            const job: Job = Object.assign(new Job(), execution);
            console.log('received a new job', job);
            program.handleJob(job);
         }

         const on_shadow = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const json = decoder.decode(payload);
            console.log(`Shadow received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            console.log(json);
         }

         const on_tunnel = async (topic: string, payload: ArrayBuffer, dup: boolean, qos: mqtt.QoS, retain: boolean) => {
            const tunnelAttributes = decoder.decode(payload);
            const json = JSON.parse(tunnelAttributes);
            console.log(`Tunnel notification received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
            console.log('received tunnel ');
            const tunnel = new Tunnel(region, json.services, json.clientAccessToken)
            program.handleTunnel(tunnel);
         }

         await connection.subscribe(baseJobTopic(thingName) + JOBTOPICS.NOTIFY, mqtt.QoS.AtLeastOnce, on_job)
         await connection.subscribe(baseJobTopic(thingName) + JOBTOPICS.NEXT, mqtt.QoS.AtLeastOnce, on_job)


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

// function publish(topic: string, message: any): void {
//    console.debug('sending message to topic ' + topic, message)
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
   const myappcafeserver = new Myappcafeserver(serverUrl, serverUrl + 'appstate', serverPath, thingName, connection);
   try {
      await myappcafeserver.prepare();
   } catch (error) {
      console.error('error while preparing myappcafeserver', error)
   }
   myappcafeserver.connect();
   myappcafeserver.on('change', (newState: ServerState) => {
      // myShadow.setCurrentState(newState);
   })

   while (true) {
      try {
         await execute_session(connection, myappcafeserver);
         console.log('session terminated gracefully, exiting application');
         process.exit(0);
      } catch (error) {
         console.error('error while session execution, retrying connection after 10 seconds', error)
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
   console.log('node.js static server listening on port: ' + port + ", with websockets listener")
})