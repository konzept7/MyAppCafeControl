import { readFileSync } from 'fs';
import https from 'https'
import axios from 'axios';
import path from 'path';
export class SessionCredentials {
  accessKeyId!: string;
  secretAccessKey!: string;
  sessionToken!: string;
  expiration!: Date;

  constructor(accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: string) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.expiration = new Date(expiration);
  }


  createEnv(): NodeJS.ProcessEnv {
    return { 'AWS_ACCESS_KEY_ID': this.accessKeyId, 'AWS_SECRET_ACCESS_KEY': this.secretAccessKey, 'AWS_SESSION_TOKEN': this.sessionToken }
  }

  static async createCredentials(certPath: string, thingName: string, forRole: string): Promise<SessionCredentials | undefined> {
    console.info(`trying to get credentials for ${thingName} and role ${forRole}, using certs from ${certPath}`);
    const httpsAgent = new https.Agent({
      ca: readFileSync(path.join(certPath, "root-CA.crt")),
      cert: readFileSync(path.join(certPath, "me.cert.pem")),
      key: readFileSync(path.join(certPath, "me.private.key")),
    })
    try {
      const iotUpdateCredentialsRequest = await axios.get(`https://c2arg21suyn6cx.credentials.iot.eu-central-1.amazonaws.com/role-aliases/${thingName}-${forRole}-alias/credentials`, {
        headers: {
          "x-amzn-iot-thingname": thingName
        },
        httpsAgent: httpsAgent
      })
      const credentials = iotUpdateCredentialsRequest.data.credentials;
      return new SessionCredentials(credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken, credentials.expiration);
    } catch (error) {
      console.error('error getting session credentials', error)
      return undefined;
    }
  }
}