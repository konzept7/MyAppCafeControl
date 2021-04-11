// const ws = require('ws')
// const express = require('express');
// const cors = require('cors');
import {
  mqtt,
  io,
  iot,
  // greengrass
} from 'aws-iot-device-sdk-v2';
import {
  access
} from 'fs/promises';
import {
  constants
} from 'fs';
import * as fs from 'fs/promises';

const region = process.env.REGION  || 'de';

// check if we are in a valid region
// this is necessary to configure the endpoint
const endpoints = {
  de: 'a3uscbqsl8nzvk-ats.iot.eu-central-1.amazonaws.com'
}

if (!region) {
  console.error('Please set your region as an environment variable to one of the following values: ', Object.keys(endpoints).toString())
  process.exit(-1)
}

const endpoint = endpoints[region]
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
    await fs.access(rootCertPath, constants.R_OK);
  } catch (error) {
    console.error('could not find root certificate, please provide it under: ' + rootCertPath, error)
    process.exit(-1)
  }
  try {
    await fs.access(privateKeyPath, constants.R_OK);
  } catch (error) {
    console.error('could not find private key, please provide it under: ' + privateKeyPath, error)
    process.exit(-1)
  }
  try {
    await fs.access(certPath, constants.R_OK);
  } catch (error) {
    console.error('could not find thing certificate, please provide it under: ' + certPath, error)
    process.exit(-1)
  }
})()

const topic = 'topic_1'
const decoder = new TextDecoder('utf8');
async function execute_session(connection) {
  return new Promise(async (resolve, reject) => {
    try {
      const on_publish = async (topic, payload, dup, qos, retain) => {
        const json = decoder.decode(payload);
        console.log(`Publish received. topic:"${topic}" dup:${dup} qos:${qos} retain:${retain}`);
        console.log(json);
        const message = JSON.parse(json);
        if (message.command = "end") {
          console.log('application exit requested')
          // resolve();
        }
      }

      await connection.subscribe(topic, mqtt.QoS.AtLeastOnce, on_publish);

      for (let op_idx = 0; op_idx < 100; ++op_idx) {
        const publish = async () => {
          const msg = {
            message: 'test message',
            sequence: op_idx + 1,
          };
          const json = JSON.stringify(msg);
          connection.publish(topic, json, mqtt.QoS.AtLeastOnce);
        }
        setTimeout(publish, op_idx * 1000);
      }
    } catch (error) {
      console.error(error, 'error while executing session')
      reject();
    }
  });
}

// configure the client
const client_bootstrap = new io.ClientBootstrap();
const config_builder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder_from_path(certPath, privateKeyPath);
config_builder.with_certificate_authority_from_path(undefined, rootCertPath);
config_builder.with_clean_session(false);

const clientId = process.env.CLIENT_ID || 'TutorialThing';
if (!clientId) {
  console.error('Please provide your client id as environment variable [CLIENT_ID]')
  process.exit(-1)
}
config_builder.with_client_id(clientId)
config_builder.with_endpoint(endpoint)

// force node to wait 60 seconds before killing itself, promises do not keep node alive
const timer = setTimeout(() => { }, 60 * 1000);

const config = config_builder.build();
const client = new mqtt.MqttClient(client_bootstrap);
const connection = client.new_connection(config);

(async () => {
  await connection.connect()
  await execute_session(connection)
  await connection.disconnect()
  clearTimeout(timer);
})()