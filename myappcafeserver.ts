const REDIS_HOST = 'localhost'
const REDIS_PORT = 6379


import { ControllableProgram } from './controllableProgram'
import EventEmitter from 'events';
import axios from 'axios';
import { mqtt } from 'aws-iot-device-sdk-v2';
import { awaitableExec, sleep } from './common'
import { Job, jobUpdate, StatusDetails, JobOption } from './job'
import { ServerShadow, ServerShadowState, IShadowState } from './shadow'
import { SessionCredentials } from './sessionCredentials';
import { Tunnel } from './tunnel'
import { log, warn, info, error, debug } from './log'
import { Rm, RobotTest } from './RobotTest';

// control docker with dockerode
import Dockerode from 'dockerode';
import { existsSync, readFile, writeFile } from 'fs';
import path from 'path';

var docker = new Dockerode();

const signalR = require('@microsoft/signalr')
const Redis = require('ioredis');

export enum ServerState {
  closed = "closed",
  Starting = "Starting",
  NeverInitialized = "NeverInitialized",
  Okay = "Okay",
  Maintenance = "Maintenance",
  Updating = "Updating",
  Paused = "Paused",
  Pausing = "Pausing",
  Restarting = "Restarting",
  FatalError = "FatalError"
}

export enum ServerEvents {
  closed = "closed",
  okay = "okay",
  change = "change",
  readyForUpdate = "readyForUpdate",
  fatalError = "fatalError",
  allOrdersFinished = "allOrdersFinished"
}


class Myappcafeserver extends EventEmitter implements ControllableProgram {
  private _retryTime = 24 * 60 * 60 * 1000;
  private _stateConnection!: any;
  private _orderConnection!: any;
  private _stateHubUrl!: string;
  private _orderHubUrl!: string;
  private _state!: ServerState;
  private _url!: string;
  private _serverPath!: string; // "/home/pi/srv/MyAppCafeServer";
  private _connection: mqtt.MqttClientConnection;
  private _thingName: string;
  public shadow: ServerShadow;
  public containers: Array<Dockerode.ContainerInfo>;
  public images: Array<Dockerode.ImageInfo>;
  private _isBlockingOrders = false;
  private _currentOrders = new Array<any>();

  get state() {
    return this._state;
  }
  set state(value) {
    info('current state will be set', value)
    if (this._state === value) return;

    this._state = value;

    if (this._state === ServerState.closed) {
      this.emit(ServerEvents.closed);
    }

    if (this.isNotOperating) {
      this.emit(ServerEvents.readyForUpdate);
    }

    if (value === ServerState.FatalError) {
      this.emit(ServerEvents.fatalError)
    }

    if (value === ServerState.Okay) {
      this.emit(ServerEvents.okay);
    }

    this.emit(ServerEvents.change, value);
  }

  constructor(url: string, stateHubUrl: string, orderHubUrl: string, path: string, thingName: string, connection: mqtt.MqttClientConnection) {
    super();
    this.state = ServerState.closed
    this._url = url;
    this._serverPath = path;
    this._stateHubUrl = stateHubUrl;
    this._orderHubUrl = orderHubUrl;
    this._thingName = thingName;
    this._connection = connection;
    const initialState = new ServerShadowState();
    initialState.desired = ServerState.NeverInitialized;
    initialState.reported = ServerState.closed;
    this.containers = []
    this.images = []
    this.shadow = new ServerShadow(connection, initialState)
    this._stateConnection = new signalR.HubConnectionBuilder()
      .withUrl(this._stateHubUrl)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext: any) => {
          this.state = ServerState.closed;
          if (retryContext.elapsedMilliseconds < 60 * 1000) {
            // If we've been reconnecting for less than 60 seconds so far,
            // wait 5 seconds before the next reconnect attempt.
            return 5 * 1000;
          } else if (retryContext.elapsedMilliseconds < this._retryTime) {
            // If we've been reconnecting for less than 24 hours so far,
            // wait 5 seconds before the next reconnect attempt.
            return 30 * 1000;
          } else {
            // If we've been reconnecting for more than 24 hours so far, stop reconnecting.
            this.state = ServerState.closed;
            return null;
          }
        },
      })
      .configureLogging("error")
      .build();

    this._stateConnection.onclose((err: any) => {
      error("server disconnected", err);
      this._isBlockingOrders = false;
      this.state = ServerState.closed;
    });

    this._stateConnection.onreconnected((connectionId: string) => {
      log("reconnected with connectionId " + connectionId);
      if (this._isBlockingOrders) warn('reconnected, but new orders are still blocked');
    });

    this._stateConnection.on("current", (args: ServerState) => {
      // after successful init, we won't be blocking orders
      if (args === ServerState.NeverInitialized || args === ServerState.Okay && (this.state === ServerState.Starting || this.state === ServerState.Restarting || this.state === ServerState.NeverInitialized)) {
        this._isBlockingOrders = false;
        this.emit(ServerEvents.allOrdersFinished);
      }
      this.state = args
    });

    this._stateConnection.on("orders", (args: string) => {
      if (args === 'blocked') {
        this._isBlockingOrders = true;
      }
      if (args === 'unblocked') {
        this._isBlockingOrders = false;
      }
      if (args === 'allFinished') {
        this._currentOrders = new Array<any>();
        this.emit(ServerEvents.allOrdersFinished);
      }
    });

    this._orderConnection = new signalR.HubConnectionBuilder()
      .withUrl(this._orderHubUrl)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext: any) => {
          this.state = ServerState.closed;
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
            this.state = ServerState.closed;
            return null;
          }
        },
      })
      .configureLogging("error")
      .build();

    this._orderConnection.on("UpdateOrder", (args: any) => {
      var order = JSON.parse(args);

      var updatedCurrentOrderIndex = this._currentOrders.findIndex(o => o.OrderId === order.OrderId);
      var updatedQueuedOrderIndex = this._currentOrders.findIndex(o => o.OrderId === order.OrderId);

      // order is not yet in list
      if (updatedCurrentOrderIndex === -1 && updatedQueuedOrderIndex === -1 && order.status !== "Completed" && order.status !== "PickedUp") {
        this._currentOrders.push(order)
        return;
      }

      // order is finished
      if ((order.status === "PickedUp") || order.status === "Completed" && updatedCurrentOrderIndex !== -1 && order.TargetGate.State === "Available") {
        this._currentOrders.splice(updatedCurrentOrderIndex, 1);
        if (this._currentOrders.length === 0) {
          this.emit(ServerEvents.allOrdersFinished);
        }
        return;
      }

      if (updatedCurrentOrderIndex !== -1) {
        this._currentOrders.splice(updatedCurrentOrderIndex, 1, order);
      }
    });

  }

  get isOperatingNormally(): boolean {
    return this.state === ServerState.Okay || this.state === ServerState.Pausing || this.state === ServerState.Paused || this.state === ServerState.Maintenance;
  }
  get isStarting(): boolean {
    return this.state === ServerState.Starting || this.state === ServerState.Restarting;
  }
  get composeFile(): string { return "PLATFORM" in process.env ? ` --file docker-compose.${process.env.PLATFORM}.yml ` : "" }
  get customMyappcafeImages(): Array<string> {
    let arr = ["status", "myappcafeserver", "config", "terminal", "display"]
    arr = arr.map(e => "PLATFORM" in process.env && process.env.PLATFORM === "x86" ? e : e);
    return arr;
  }
  get myappcafeImages(): Array<string> {
    return [...this.customMyappcafeImages, "redis"]
  }


  async prepare(): Promise<boolean> {
    return new Promise((resolve) => {

      // check for local proxy

      // list all running containers
      docker.listContainers((err: any, response: Array<Dockerode.ContainerInfo>) => {
        if (err) {
          error('error listing containers', err)
          return;
        }
        this.containers = response
        log('containers running', this.containers)
      });


      // find out if images are built for all necessary containers
      docker.listImages(async (err: any, response: Array<Dockerode.ImageInfo>) => {
        if (err) {
          error('error listing images', err)
          return;
        }

        log('all images', response)

        let imageInfoAccumulator = (array: Array<string>, entry: Dockerode.ImageInfo): Array<string> => {
          return [...array, ...(entry.RepoTags ?? [])];
        };

        const allTags: Array<string> = response.reduce(imageInfoAccumulator, [] as Array<string>)
        log('all current image tags', allTags)
        if (this.myappcafeImages.every(name => allTags.some(tag => tag.includes(name)))) {
          log('images for every needed container found!', this.myappcafeImages)
        } else {
          warn('it was not possible to find every container needed for myappcafe');
        }

        this.images = response.filter(image => (image.RepoTags?.some(tag => tag.endsWith("latest")) ?? false));
        const allCustomTags: Array<string> = this.images.reduce(imageInfoAccumulator, [] as Array<string>)
        log('all custom image tags', allCustomTags)
        if (this.customMyappcafeImages.every(name => allCustomTags.some(tag => tag.includes(name)))) {
          log('images for every custom container found!')
        }
        else {
          log('figure out how to handle preparation')
        }
        resolve(true);
      })
    });
  }

  async getRunningContainers(): Promise<Array<Dockerode.Container>> {
    const containerInfos = await docker.listContainers();
    const containers: Array<Dockerode.Container> = []
    for (const info of containerInfos) {
      const container = docker.getContainer(info.Id);
      containers.push(container);
    }
    return containers;
  }

  specialTopics: string[] = [];
  disconnect(): Promise<any> {
    throw new Error('Method not implemented.');
  }
  handleMessage(topic: string, message: any): Promise<any> {
    throw new Error('Method not implemented.');
  }

  handleShadow(shadow: IShadowState) {
    return new Promise((resolve, reject) => {
      resolve(true)
    })
  }

  get isOperating(): boolean {
    return this.state === ServerState.Okay || this.state === ServerState.Paused || this.state === ServerState.Pausing || this.state === ServerState.Starting || this.state === ServerState.Restarting
  }

  get isNotOperating(): boolean {
    return this.state === ServerState.closed || this.state === ServerState.NeverInitialized || this.state === ServerState.FatalError;
  }

  async connect() {
    return new Promise(async (resolve) => {
      while (!this._stateConnection || this.state === ServerState.closed) {
        this._stateConnection
          .start({
            withCredentials: false
          })
          .then(() => {
            log("connected to signalR");
            resolve('connected to state hub');
            return;
          })
          .catch((err: any) => {
            this.state = ServerState.closed;
            error('error starting connection to server', err);
          });
        // wait for 15 seconds before trying to connect again
        await sleep(15 * 1000)
      }
    })
  }
  async startContainers(images: Array<string>) {
    log('starting containers as requested', images)
    return awaitableExec('docker-compose' + this.composeFile + ' up -d ' + images.join(' '), {
      cwd: this._serverPath
    })
  }

  async start() {
    log('starting containers')
    await this.startContainers(this._containers);

    let response = await axios.get(this._url + 'connected', { timeout: 10 * 1000 })
    if (response.status === 200) return true;

    // restart the container in case it has been terminated on startup
    await this.startContainers(['myappcafeserver'])
    response = await axios.get(this._url + 'connected', { timeout: 1 * 1000 })
    if (response.status === 200) return true;
    return false;
  }

  async stopContainers(imageNames: Array<string> | undefined) {
    // const infos = await docker.listContainers();
    // for await (const info of infos) {
    //   if (!info.Names.some(n => this._containers.some(i => i.includes(n)))) continue;
    //   const container = docker.getContainer(info.Id);
    //   await container.stop();
    // }
    await awaitableExec('docker-compose ' + this.composeFile + ' stop', {})
    return true;
  }

  stop() {
    return this.stopContainers(this._containers);
  }

  sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms))
  }

  waitOnce(event: string, timeout: number) {
    return new Promise((resolve, reject) => {
      setTimeout(reject, timeout);
      this.once(event, () => resolve)
    })
  }


  async initBoxNow(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      log('got request to start box, current state: ' + this.state)
      if (this.state === ServerState.FatalError) {
        log('server is in fatal error, shutting down')
        await this.shutdownGracefully(10);
        await sleep(10 * 1000);
      }
      try {
        if (this.state === ServerState.closed) {
          log('server is currently shut down, starting containers');
          await this.start();
          log('started server, now waiting 30 seconds');
          await sleep(30 * 1000);
        }
        log('waited for server to be up, now sending init commands');
        await axios.post(this._url + 'init/sanitize');
        log('sanitized the shutdown, just in case');
        log('waiting 5 seconds until init command');
        this.once(ServerEvents.okay, () => {
          log('server seems to be okay after init');
          resolve(true)
        });
        this.once(ServerEvents.fatalError, () => {
          warn('server is error after sending init command')
          reject('server is in fatal error state')
        })
        await this.sleep(5000);
        log('5 seconds over, now sending init command')
        await axios.post(this._url + 'init/initnow');
        log('init commands sent, waiting for server to be in state okay')
      } catch (err) {
        error('error starting box', err)
        reject(err)
      }
    })

  }

  private stepOperations: Array<string> = ["reboot"]
  async handleJob(job: Job) {
    log('trying to handle a job', job)
    try {
      if (!("operation" in job.jobDocument)) {
        throw new Error("job has no operation name, we don't know what to do");
      }
      const operation = job.jobDocument.operation;

      if (job.status === 'IN_PROGRESS' && !(this.stepOperations.includes(operation))) {
        error('received a job in progress that should not survive agent restart, so it must have failed before. explicitly failing now', job)
        const fail = job.Fail('alreadyInProgress', "AXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
        return Promise.reject();
      }

      if ("shadowCondition" in job.jobDocument && "state" in job.jobDocument.shadowCondition) {
        const allowedConditions = job.jobDocument.shadowCondition.state.split('|').map((c: string) => c.trim() as ServerState)
        debug('allowed conditions for current job are: ' + allowedConditions.join(', '))
        if (!(allowedConditions.includes((c: ServerState) => this._state))) {
          error('job will fail because it has a state condition that is not met by the current server state: ' + this._state)
          const fail = job.Fail("wrongState", "AXXX");
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
          return Promise.reject();
        }
      }

      if (operation === 'update') {
        return await this.updateHandler(job);
      }
      if (operation === 'http') {
        return await this.httpHandler(job);
      }
      if (operation === 'shell') {
        return await this.shellCommandHandler(job);
      }
      if (operation === 'start') {
        return await this.startHandler(job);
      }
      if (operation === 'init') {
        return await this.initHandler(job);
      }
      if (operation === 'shutdown') {
        return await this.shutdownHandler(job)
      }
      if (operation === 'remove-orders') {
        return await this.removeOrdersHandler(job);
      }

      if (operation === 'pause') {
        return await this.pauseHandler(job)
      }
      if (operation === 'unpause') {
        job.jobDocument.option = JobOption.unpause;
        return await this.pauseHandler(job)
      }

      if (operation === 'test-beverage') {
        return await this.testBeverageHandler(job)
      }

      if (operation === 'download-env') {
        return await this.downloadEnvHandler(job)
      }

      if (operation === 'robot-test') {
        return await this.robotTestHandler(job)
      }
      if (operation === 'robot-command') {
        return await this.robotCommandHandler(job)
      }
      if (operation === 'recover-robot') {
        return await this.recoverRobotHandler(job)
      }

      if (operation === 'upload-env') {
        return await this.uploadEnvHandler(job)
      }
      if (operation === 'reload-config') {
        return await this.reloadConfigHandler(job)
      }

      if (operation === 'check-device') {
        return await this.checkDeviceHandler(job)
      }
      if (operation === 'deactivate-device') {
        return await this.deactivateDeviceHandler(job)
      }
      if (operation === 'restart-device') {
        return await this.restartDeviceHandler(job)
      }

      if (operation === 'trash') {
        return await this.trashMoveHandler(job)
      }

      if (operation === 'set-start') {
        return await this.setStartupHandler(job);
      }
      if (operation === 'remove-start') {
        return await this.removeStartupHandler(job);
      }

      if (operation === 'message') {
        return await this.messageHandler(job)
      }

      if (operation === 'set-server-state') {
        return await this.serverStateHandler(job)
      }

      if (operation === 'block-orders') {
        return await this.blockHandler(job, true)
      }

      if (operation === 'unblock-orders') {
        return await this.blockHandler(job, false)
      }

      if (operation == 'reboot') {
        return await this.rebootHandler(job);
      }

      if (operation == 'disable-notifications') {
        return await this.disableNotificationsHandler(job);
      }

      if (operation == 'reset-redis') {
        return await this.resetRedisHandler(job);
      }

      if (operation === 'upload-logs') {
        return await this.uploadLogsHandler(job);
      }

      warn("unknown command sent to handler", job.jobDocument);
      const fail = job.Fail("unknownOperation", "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);

    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail("unknown", "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }
  async uploadLogsHandler(job: Job) {
    console.log('upload logs requested');

    let credentials: SessionCredentials | undefined
    try {
      jobUpdate(job.jobId, job.Progress(0.01, "registered"), this._thingName, this._connection);
      credentials = await SessionCredentials.createCredentials(this._serverPath, this._thingName, "iot-config-role");
      if (!credentials) {
        error('could not get credentials for upload logs')
        jobUpdate(job.jobId, job.Fail("noCredentials", "AXXX"), this._thingName, this._connection);
        throw new Error("could not get credentials for upload logs");
      };
      jobUpdate(job.jobId, job.Progress(0.1, "credentials"), this._thingName, this._connection);
      const fileName = `mac-control-journal-${new Date().toISOString()}.txt`;
      const journalCmd = `journalctl -u myappcafecontrol.service -o short > /home/pi/${fileName}`;
      await awaitableExec(journalCmd, { timeout: 10000 });
      jobUpdate(job.jobId, job.Progress(0.6, "filesWritten"), this._thingName, this._connection);

      const envCommand = `export AWS_ACCESS_KEY_ID=${credentials.accessKeyId}; export AWS_SECRET_ACCESS_KEY=${credentials.secretAccessKey};export AWS_SESSION_TOKEN=${credentials.sessionToken}; export AWS_DEFAULT_REGION=eu-central-1; export AWS_REGION=eu-central-1`;
      const uploadCmd = `aws s3 cp /home/pi/logs.txt s3://myappcafecontrol-logs/${this._thingName}/${fileName}`;
      await awaitableExec([envCommand, uploadCmd].join(';'), { timeout: 10000 });
      jobUpdate(job.jobId, job.Progress(0.8, "filesUploaded"), this._thingName, this._connection);

      const presignCommand = `aws s3 presign s3://myappcafecontrol-logs/${this._thingName}/${fileName}`;
      const presignUrl = await awaitableExec([envCommand, presignCommand].join(';'), { timeout: 10000 });
      jobUpdate(job.jobId, job.Succeed('CUSTOM#' + presignUrl), this._thingName, this._connection);
    } catch (err) {
      error('upload logs failed', { err })
      jobUpdate(job.jobId, job.Fail("failed", "AXXXX"), this._thingName, this._connection);
    }
  }

  async checkDeviceHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("device" in job.jobDocument.parameters)) {
        throw new Error('no device defined')
      }
      jobUpdate(job.jobId, job.Progress(.3, "started"), this._thingName, this._connection)
      const response = await axios.post(this._url + 'devices/test/' + job.jobDocument.parameters["device"], null, { timeout: 120 * 1000 });
      if (response.status === 200) {
        jobUpdate(job.jobId, job.Succeed("deviceTestedSuccessfully"), this._thingName, this._connection)
        return
      }
      jobUpdate(job.jobId, job.Fail('deviceTestFailed', "AXXXX"), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('noTestPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }
  async deactivateDeviceHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("device" in job.jobDocument.parameters)) {
        throw new Error('no device defined')
      }
      let deactivationType = job.jobDocument.option || '';
      if (deactivationType === '') {
        jobUpdate(job.jobId, job.Fail('optionNotSet', "AXXXX"), this._thingName, this._connection)
        return
      }
      if (deactivationType === 'deviceshutdown' || deactivationType === 'devicedisabled')
        deactivationType = JobOption[deactivationType]
      jobUpdate(job.jobId, job.Progress(.3, "sentRequest"), this._thingName, this._connection)
      const response = await axios.post(this._url + 'devices/setstate/' + job.jobDocument.parameters["device"] + '/' + deactivationType, null, { timeout: 30 * 1000 });
      if (response.status === 200) {
        jobUpdate(job.jobId, job.Succeed((deactivationType === 'Disabled' ? ' deactivedPermanently' : 'deactivedTemporarily')), this._thingName, this._connection)
        return
      }
      jobUpdate(job.jobId, job.Fail('notPossible', "AXXXX"), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      console.log('deactivation failed: ', err)
      if (job.status !== 'FAILED') {
        const fail = job.Fail('notPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }
  async trashMoveHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("device" in job.jobDocument.parameters)) {
        throw new Error('no device defined')
      }
      jobUpdate(job.jobId, job.Progress(.3, "started"), this._thingName, this._connection)
      const response = await axios.post(this._url + 'robot/trash/' + job.jobDocument.parameters["device"], null, { timeout: 30 * 1000 });
      if (response.status === 200) {
        jobUpdate(job.jobId, job.Succeed('finished'), this._thingName, this._connection)
        return
      }
      jobUpdate(job.jobId, job.Fail('notPossible', "AXXXX"), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('notPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }
  async restartDeviceHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("device" in job.jobDocument.parameters)) {
        throw new Error('no device defined')
      }
      jobUpdate(job.jobId, job.Progress(.3, "started"), this._thingName, this._connection)
      const response = await axios.post(this._url + 'devices/restart/' + job.jobDocument.parameters["device"], null, { timeout: 15 * 60 * 1000 });
      if (response.status === 200) {
        jobUpdate(job.jobId, job.Succeed('restarted'), this._thingName, this._connection)
        return
      }
      jobUpdate(job.jobId, job.Fail('notPossible', "AXXXX"), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('notPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async robotCommandHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("command" in job.jobDocument.parameters)) {
        throw new Error('no command defined')
      }
      jobUpdate(job.jobId, job.Progress(.3, "sentCommand"), this._thingName, this._connection)
      const response = await axios.post(this._url + 'robot/command/' + job.jobDocument.parameters["command"], null, { timeout: 30 * 1000 });
      if (response.status === 200) {
        jobUpdate(job.jobId, job.Succeed('commandFailed'), this._thingName, this._connection)
        return
      }
      jobUpdate(job.jobId, job.Fail('notPossible', "AXXXX"), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('notPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async recoverRobotHandler(job: Job) {
    try {
      jobUpdate(job.jobId, job.Progress(.3, 'connecting'), this._thingName, this._connection)
      jobUpdate(job.jobId, job.Progress(.6, 'removingKeys'), this._thingName, this._connection)
      const client = new Redis(REDIS_PORT, REDIS_HOST);
      await client.del('isMoving')
      await client.del('unrecoverable')
      jobUpdate(job.jobId, job.Progress(.9, 'keysRemoved'), this._thingName, this._connection)
      await client.disconnect()
      jobUpdate(job.jobId, job.Succeed('success'), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      console.log('recover robot failed: ', err)
      if (job.status !== 'FAILED') {
        const fail = job.Fail('failed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }


  async robotTestHandler(job: Job) {
    info('received robot test job', job)

    if (this._state !== ServerState.closed && this._state !== ServerState.NeverInitialized) {
      jobUpdate(job.jobId, job.Fail(`server is in state ${this._state}! we will not execute a robot test during operation`, "AXXXX"), this._thingName, this._connection)
      return;
    }

    jobUpdate(job.jobId, job.Progress(0.01, "registered"), this._thingName, this._connection);

    if (this._state === ServerState.NeverInitialized) {
      await this.shutdownGracefully(3);
      await this.stop()
    }

    jobUpdate(job.jobId, job.Progress(0.02, "stopped containers"), this._thingName, this._connection);

    let include: string[] | undefined = job.jobDocument.includeForTest ? job.jobDocument.includeForTest.split(',') : undefined;
    info('parsed sequences to include', include)
    const test = new RobotTest();
    try {
      if (!await test.prepare(include)) throw new Error("could not connect to robot")
    } catch {
      error('unable to prepare robot job - maybe robot could not connect?')
      jobUpdate(job.jobId, job.Fail('unable to prepare robot test', "AXXXX"), this._thingName, this._connection)
      return;
    }
    let numberOfMoves = test.AllSequences!.map(s => s.sequences).flat(2).length
    jobUpdate(job.jobId, job.Progress(0.03, "stopped containers"), this._thingName, this._connection);
    let currentProgress = 0.03
    const tick = (move: Rm) => {
      if (move.Retries > 0) numberOfMoves++;
      currentProgress = 0.03 + 0.97 * test.Results.length / numberOfMoves;
      move.print()
      jobUpdate(job.jobId, job.Progress(currentProgress, move.toString()), this._thingName, this._connection)
    }

    test.on('move', (d) => tick(d))
    test.on('sequence', (s) => {
      info('*** SEQUENZ ABGESCHLOSSEN')
      info('*** ' + s.name)
      const allMoves = s.sequences.flat()

      const totalMoves = allMoves.filter((rm: Rm) => rm.IsCounted).length + allMoves.filter((rm: Rm) => rm.IsCounted).reduce((rm: Rm, cv: number) => cv + rm.Retries, 0)
      const failed = allMoves.filter((rm: Rm) => !rm.IsSuccess && rm.IsCounted).length
      const timedOut = allMoves.filter((rm: Rm) => !rm.Response && rm.IsCounted).length
      const success = allMoves.filter((rm: Rm) => rm.IsSuccess && rm.Retries === 0 && rm.IsCounted).length

      info('*** GESAMTZAHL:    ' + totalMoves)
      info('*** ERFOLGREICH:   ' + success)
      info('*** FEHLGESCHLAGEN ' + failed)
      info('*** TIMEOUT:       ' + timedOut)

      jobUpdate(job.jobId, job.Progress(currentProgress, `*** SEQUENZ ABGESCHLOSSEN\ntotal: ${totalMoves}, success: ${success}, failed: ${failed}, timedout: ${timedOut}\nUm freizuräumen Notstopp innerhalb der nächsten 90 Sekunden drücken`), this._thingName, this._connection)

      console.log()
    })

    await test.execute()


    if (test.IsCancelled) {
      jobUpdate(job.jobId, job.Fail("job was cancelled", "AXXXX"), this._thingName, this._connection)

      return;
    }

    info('*** TEST ABGESCHLOSSEN')
    info('*** ')
    const allMoves = test.Results;

    const totalMoves = allMoves.length + allMoves.reduce((pv, rm) => pv + rm.Retries, 0)
    const failed = allMoves.filter((rm: Rm) => !rm.IsSuccess).length
    const timedOut = allMoves.filter((rm: Rm) => !rm.Response).length
    const success = allMoves.filter((rm: Rm) => rm.IsSuccess && rm.Retries === 0).length

    info('*** GESAMTZAHL:    ' + totalMoves)
    info('*** ERFOLGREICH:   ' + success)
    info('*** FEHLGESCHLAGEN ' + failed)
    info('*** TIMEOUT:       ' + timedOut)
    console.log()
    jobUpdate(job.jobId, job.Progress(currentProgress, `total: ${totalMoves}, success: ${success}, failed: ${failed}, timedout: ${timedOut}`), this._thingName, this._connection)
    jobUpdate(job.jobId, job.Succeed(`total: ${totalMoves}, success: ${success}, failed: ${failed}, timedout: ${timedOut}`), this._thingName, this._connection)

  }

  async serverStateHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("newstate" in job.jobDocument.parameters)) {
        throw new Error('no new state given')
      }

      try {
        jobUpdate(job.jobId, job.Progress(0.3, "sentRequest"), this._thingName, this._connection)
        await axios.put(this._url + "setState/" + job.jobDocument.parameters["newstate"], undefined, { timeout: 10 * 1000 });
      } catch (err) {
        error('could not set server-state', err);
      }

      jobUpdate(job.jobId, job.Succeed('stateChanged'), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('notPossible', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async messageHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("message" in job.jobDocument.parameters)) {
        throw new Error('no message given')
      }
      try {
        await axios.post(this._url + "notifications/message/" + job.jobDocument.parameters["message"], undefined, { timeout: 10 * 1000 });
      } catch (err) {
        error('could not send message', err);
      }

      jobUpdate(job.jobId, job.Succeed('sentMessage'), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail('messageFailed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async reloadConfigHandler(job: Job) {
    debug('reload config job received', job)
    jobUpdate(job.jobId, job.Progress(0.25, "registered"), this._thingName, this._connection);

    const previousState = this._state;

    const reloadUrl = `http://localhost:${process.env.VUE_APP_PLU_PORT}/reloadConfig`
    log('triggering config reload', reloadUrl);
    try {
      await axios.post(reloadUrl)
    } catch (error) {
      warn('error reloading config', error)
      const fail = job.Fail('notPossible', "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);
      return;
    }
    const option = job.jobDocument.option || "soft"
    if (option === "soft") {
      if (previousState === ServerState.NeverInitialized) {
        await this.shutdownGracefully(10);
        await sleep(20 * 1000);
        await this.start();
      }
      jobUpdate(job.jobId, job.Succeed("reloaded config, will take effect after next startup"), this._thingName, this._connection);
      return;
    }
    let progress = job.Progress(0.3, "waitOrdersFinished");
    jobUpdate(job.jobId, progress, this._thingName, this._connection);
    if (option === "hard") {
      await this.waitForOrdersToFinish(10);
    }
    progress = job.Progress(0.6, "allOrdersFinished");
    jobUpdate(job.jobId, progress, this._thingName, this._connection);
    await this.shutdownGracefully(10);
    progress = job.Progress(0.7, "serverShutdown");
    jobUpdate(job.jobId, progress, this._thingName, this._connection);
    await sleep(20 * 1000);
    await this.start();
    progress = job.Progress(0.8, "serverStarted");
    jobUpdate(job.jobId, progress, this._thingName, this._connection);

    if (previousState === ServerState.Okay) {
      progress = job.Progress(0.8, "initStarted");
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      await this.initBoxNow();
      progress = job.Progress(0.9, "initialized");
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
    }

    jobUpdate(job.jobId, job.Succeed("reloaded config and restarted application"), this._thingName, this._connection);
  }

  private getEnvPath() {
    let envPath = path.join(this._serverPath, '.env');
    const localEnvPath = envPath + ".local"
    return (existsSync(localEnvPath)) ? localEnvPath : envPath;
  }

  downloadEnvHandler(job: Job) {
    warn('downloading new .env file, this might hurt very much', job)

    if (!(job.jobDocument.parameters?.env)) {
      error('there was no env data in job provided', job);
      const fail = job.Fail('error reading .env data, job should have a parameters.env property', 'AXXXX');
      jobUpdate(job.jobId, fail, this._thingName, this._connection);
      return;
    }
    const envData = job.jobDocument.parameters['env'];
    log('writing new .env data to filesystem', envData);
    try {
      const envPath = this.getEnvPath();
      writeFile(envPath, envData, (err) => {
        if (err) {
          error('error writing local .env file to path ' + envPath, err);
          const fail = job.Fail('error writing .env file', 'AXXXX');
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
          return;
        }
        log('successfully written .env file')
        jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection);
      })
    } catch (err) {
      error('error downloading .env file', err)
    }
    throw new Error('Method not implemented.');
  }
  async uploadEnvHandler(job: Job) {
    const envPath = this.getEnvPath();
    readFile(envPath, 'utf-8',
      (err, data) => {
        if (err) {
          error('error reading local .env file from path ' + envPath, err);
          const fail = job.Fail('error reading .env file', 'AXXXX');
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
          return;
        }
        log('successfully read .env file', data)
        jobUpdate(job.jobId, job.Succeed(JSON.stringify({ data })), this._thingName, this._connection);
      }
    )
  }


  private async waitForOrdersToFinish(timeoutInMinutes: number | undefined) {
    if (this.isNotOperating || this._currentOrders.length === 0) return true;
    await this.toggleBlockOrders(true);
    try {
      const timeout = (timeoutInMinutes ?? 10) * 1000 * 60
      log('waiting for orders to be finished')
      await this.waitOnce('allOrdersFinished', timeout)
      log('all orders should be finished')
      return true;
    } catch (err) {
      error('timed out while waiting for orders to be finished', err);
      return false;
    }
  }

  async shutdownGracefully(inSeconds: number) {
    if (!inSeconds) inSeconds = 10;
    log('stopping server if not already closed', this.state)
    return new Promise(async (resolve, reject) => {
      if (this.state !== 'closed') {
        try {
          await axios.post(this._url + "init/shutdown/" + Math.floor(inSeconds), undefined, { timeout: 10 * 1000 });
        } catch (err) {
          error('error shutting down application', err);
          reject(err);
        }
        log('scheduled server shutdown in ' + inSeconds + " seconds")
        this.on(ServerEvents.change, newValue => {
          if (newValue === 'closed')
            resolve('server is shut down');
        })
      }
      else {
        log('server was already shut down');
        resolve('server is shut down');
      }
    })
  }

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

  private _containers = ['redis', 'config-provider', 'status-frontend', 'display-queue', 'terminal', 'myappcafeserver'];
  async updateHandler(job: Job) {

    // if no details are provided or the current step is requested, we did not do any work on the job yet
    if (job.status === 'QUEUED' || !job.statusDetails || !job.statusDetails.currentStep || job.statusDetails.currentStep === 'requested') {
      const scheduledJobRequest = job.Progress(0.01, 'scheduled');
      jobUpdate(job.jobId, scheduledJobRequest, this._thingName, this._connection);
    }
    if (job.statusDetails?.currentStep === 'scheduled') {
      try {
        await this.update(job);
        log('successfully updated for myappcafeserver')
      } catch (err) {
        error('error on updating myappcafeserver', err);
        const failed = job.Fail(JSON.stringify(err), "AXXXX");
        jobUpdate(job.jobId, failed, this._thingName, this._connection);
      }
    }
  }

  async shutdownHandler(job: Job) {
    if (job.status !== 'QUEUED') return;
    try {
      info('shutdown job received', job)
      jobUpdate(job.jobId, job.Progress(0.25, "registered"), this._thingName, this._connection);
      info('current state of server application', this._state)

      const option = job.jobDocument?.option ?? JobOption.soft;
      if (option === JobOption.soft) {
        await this.waitForOrdersToFinish(10);
      }
      jobUpdate(job.jobId, job.Progress(0.5, "all orders finished"), this._thingName, this._connection);

      if (this._state === ServerState.Okay) {
        log('pausing application before shutting it down');
        try {
          let pause = await axios.post(this._url + 'devices/pause', null, { timeout: 30 * 1000 });
          info('paused application', pause.data);
        } catch (err) {
          error('error while waiting for application to be paused', err)
        }
      }
      jobUpdate(job.jobId, job.Progress(0.75, "if application was running, it is now set to pause"), this._thingName, this._connection);

      if (option === JobOption.forced && this.state !== ServerState.closed) {
        log('shutdown is forced, so we will delete open orders');
        try {
          await axios.delete(this._url + "order");
        } catch (err) {
          warn('it was not possible to delete running orders, we will still continue', err)
        }
      }

      await this.shutdownGracefully(20);
      await this.stop();
      jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection);
    } catch (err) {
      error('error shutting down application', err)
    }
  }


  async removeOrdersHandler(job: Job) {
    try {
      jobUpdate(job.jobId, job.Progress(.5, 'connecting'), this._thingName, this._connection)
      const client = new Redis(REDIS_PORT, REDIS_HOST);
      jobUpdate(job.jobId, job.Progress(.9, 'removingKeys'), this._thingName, this._connection)
      await client.del('orders')
      await client.disconnect()
      jobUpdate(job.jobId, job.Succeed('ordersRemoved'), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      console.log('remove orders failed: ', err)
      if (job.status !== 'FAILED') {
        const fail = job.Fail('failed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async testBeverageHandler(job: Job) {
    let amount = 1;
    if (job.jobDocument.parameters && "amount" in job.jobDocument.parameters) {
      amount = parseInt(job.jobDocument.parameters["amount"])
    }

    info('test beverage requested');
    for (let index = 0; index < amount; index++) {
      try {
        await axios.post(this._url + "order/test");
      } catch (err) {
        error('error while ordering test beverage', err);
        jobUpdate(job.jobId, job.Fail('failed', 'AXXXX'), this._thingName, this._connection);
        return;
      }
    }
    jobUpdate(job.jobId, job.Succeed("success"), this._thingName, this._connection);
  }

  async initHandler(job: Job) {
    const option = job.jobDocument.option || JobOption.soft;
    log('got job to init box, starting now')
    return new Promise(async (resolve, reject) => {
      jobUpdate(job.jobId, job.Progress(0.05, "registered"), this._thingName, this._connection);
      if ((this.isOperatingNormally || this.isStarting) && option === JobOption.soft) {
        log('server is in state ' + this._state + ' and blocking orders: ' + this._isBlockingOrders)
        log('job will succeed because server is already in the correct state')
        if (this._isBlockingOrders && this._state !== ServerState.closed && this._state !== ServerState.NeverInitialized) await this.toggleBlockOrders(false);
        const success = job.Succeed('alreadyCorrectState');
        jobUpdate(job.jobId, success, this._thingName, this._connection);
        resolve(true)
        return;
      }
      if (option === JobOption.hard) {
        jobUpdate(job.jobId, job.Progress(0.2, "waitOrdersFinished"), this._thingName, this._connection);
        await this.waitForOrdersToFinish(10);
        jobUpdate(job.jobId, job.Progress(0.3, "allOrdersFinished"), this._thingName, this._connection);
      }
      if (option !== JobOption.soft) {
        await this.shutdownGracefully(10);
        jobUpdate(job.jobId, job.Progress(0.4, "serverShutdown"), this._thingName, this._connection);
        log('waiting 20 seconds')
        await this.sleep(20 * 1000);
      }
      try {
        this.once(ServerEvents.okay, () => {
          const success = job.Succeed("success");
          jobUpdate(job.jobId, success, this._thingName, this._connection);
          resolve(true);
        });

        log('sending start command now')
        jobUpdate(job.jobId, job.Progress(0.6, "initStarted"), this._thingName, this._connection);
        await this.initBoxNow();
      } catch (err) {
        jobUpdate(job.jobId, job.Fail("failed", "AXXXX"), this._thingName, this._connection);
        error('error when initializing box', err)
        reject(err);
      }
    })
  }

  async pauseHandler(job: Job): Promise<boolean> {
    return new Promise(async (resolve, reject) => {

      if (job.jobDocument.option === JobOption.soft || job.jobDocument.option === JobOption.hard) {

        log('got request to pause execution', job)

        if (this.state !== ServerState.Okay && this.state !== ServerState.Paused && this.state !== ServerState.Pausing) {
          jobUpdate(job.jobId, job.Fail("incorrectState", "AXXXX"), this._thingName, this._connection);
          reject('application is not in a state where pause is allowed, current state: ' + this.state);
        }
        if (this.state === ServerState.Paused || this.state === ServerState.Pausing) {
          jobUpdate(job.jobId, job.Succeed("success"), this._thingName, this._connection);
          resolve(true);
          return
        }

        this.on(ServerEvents.change, (newValue) => {
          if (newValue === ServerState.Paused) {
            jobUpdate(job.jobId, job.Succeed("success"), this._thingName, this._connection);
            resolve(true);
            return
          }

          if (newValue !== ServerState.Pausing && this.state !== newValue) {
            warn('pause was requested, but server is going to state ' + newValue);
            jobUpdate(job.jobId, job.Fail('wrongStateResult', "AXXXX"), this._thingName, this._connection);
            reject('pause was requested, but server is going to state ' + newValue)
            return
          }
        })

        if (this.state === ServerState.Okay) {
          try {
            if (job.jobDocument.option === JobOption.soft) {
              jobUpdate(job.jobId, job.Progress(0.5, "waitOrdersFinished"), this._thingName, this._connection);
              await this.waitForOrdersToFinish(5);
              jobUpdate(job.jobId, job.Progress(0.5, "allOrdersFinished"), this._thingName, this._connection);
            }
            await axios.post(this._url + 'devices/pause', null, { timeout: 30 * 1000 });
          } catch (err) {
            error('error while waiting for application to be paused', err)
            jobUpdate(job.jobId, job.Fail("failed", "AXXXX"), this._thingName, this._connection);
            reject()
            return
          }
        }

      } else if (job.jobDocument.option === JobOption.unpause) {
        log('got request to unpause application', job)

        if (this.state !== 'Paused') {
          jobUpdate(job.jobId, job.Fail('incorrectState', "AXXXX"), this._thingName, this._connection);
          reject('unpause was requested, but server is in state ' + this.state)
          return
        }
        try {
          await axios.post(this._url + 'devices/unpause', null, { timeout: 30 * 1000 });
          await this.toggleBlockOrders(false);
          let success = job.Succeed("success");
          jobUpdate(job.jobId, success, this._thingName, this._connection);
          resolve(true);
        } catch (err) {
          error('error while waiting for application to be unpaused', err)
          jobUpdate(job.jobId, job.Fail("failed", "AXXXX"), this._thingName, this._connection);
          reject()
          return
        }

      } else {
        throw new Error('got pause operation job with an unknown option')
      }
    })
  }

  async update(job: Job): Promise<Job> {
    return new Promise(async (resolve, reject) => {
      let progress = job.Progress(0.2, "waitOrdersFinished")
      try {
        if (this.isNotOperating || job.jobDocument.option === JobOption.forced || job.jobDocument.option === JobOption.hard) {
          log('server is in state ' + this.state + ' -> update can be executed now')
          if (job.jobDocument.option === JobOption.hard) {
            jobUpdate(job.jobId, progress, this._thingName, this._connection);
            await this.waitForOrdersToFinish(10);
          }
          progress = job.Progress(0.3, "allOrdersFinished")
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
          await this.executeUpdate(job);
          resolve(job)
        } else {
          log('server is in state ' + this.state + ' -> waiting for the server to be in an updateable state')
          this.once(ServerEvents.readyForUpdate, async () => {
            log('server is now in state ' + this.state + ' -> update can be executed now')
            await this.executeUpdate(job);
            resolve(job)
          })
        }
      } catch (err) {
        error('error while executing update', err)
        reject(err)
      }
    })
  }

  async shellCommandHandler(job: Job) {
    if (job.status === 'QUEUED') {
      const command = job.jobDocument.parameters?.command
      if (!command) {
        const noCommand = 'a shell command was requested, but there was no command string';
        warn(noCommand)
        const fail = job.Fail(noCommand, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
        return;
      }
      const scheduledJobRequest = job.Progress(0.1, 'scheduled');
      scheduledJobRequest.statusDetails = scheduledJobRequest.statusDetails || new StatusDetails();
      scheduledJobRequest.statusDetails.message = 'command will be executed';
      jobUpdate(job.jobId, scheduledJobRequest, this._thingName, this._connection);

      try {
        await awaitableExec(command, { cwd: this._serverPath })
        const success = job.Succeed();
        jobUpdate(job.jobId, success, this._thingName, this._connection);
      } catch (err) {
        error('error while executing shell command', err)
        const fail = job.Fail('error while executing shell command: ' + err, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }

    }
  }

  async httpHandler(job: Job) {

  }

  async blockHandler(job: Job, block: boolean) {
    log('got request to block/unblock upcoming orders', job)
    if (this.state !== ServerState.Okay && this.state !== ServerState.Paused) {
      const fail = job.Fail('application is not in a state where blocking/unblocking orders is allowed, current state: ' + this.state, "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);
      return;
    }

    jobUpdate(job.jobId, job.Progress(0.1, "registered"), this._thingName, this._connection);
    if (block) {
      log('got request to block upcoming orders', job)
      jobUpdate(job.jobId, job.Progress(0.2, "registered"), this._thingName, this._connection);
      if (this.state === ServerState.Okay || this.state === ServerState.Paused) {
        if (await this.toggleBlockOrders(true)) {
          jobUpdate(job.jobId, job.Progress(0.2, "ordersBlocked"), this._thingName, this._connection);
          await this.waitForOrdersToFinish(10);
          jobUpdate(job.jobId, job.Succeed("allOrdersFinished"), this._thingName, this._connection);
          return
        }
        error('error while trying to block orders')
        const fail = job.Fail('error while trying to block orders\n', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
        return
      }
      return;
    }

    // unblock
    if (await this.toggleBlockOrders(false)) {
      jobUpdate(job.jobId, job.Succeed("ordersUnblocked"), this._thingName, this._connection)
      return
    }
    error('error while trying to unblock orders')
    const fail = job.Fail('failed', "AXXXX");
    jobUpdate(job.jobId, fail, this._thingName, this._connection);
  }


  private async toggleBlockOrders(block: boolean): Promise<boolean> {
    console.log('a')
    log('trying to ' + (block ? 'block' : 'unblock') + ' orders');
    console.log('b')
    const url = this._url + "order/block"
    console.log('c ' + url)
    try {
      console.log('d')
      if (block) {
        console.log('e')
        await axios.put(url);
        console.log('f')
        return true;
      } else {
        console.log('g')
        await axios.delete(url);
        console.log('h')
        return true;
      }
    } catch (err) {
      error('error blocking/unblocking orders', err);
      console.log('error blocking/unblocking orders: ', err)
      return false;
    }
  }

  async startHandler(job: Job) {
    if (job.status === 'QUEUED') {

      const option = job.jobDocument.option || JobOption.soft;
      let progress = job.Progress(0.01, 'registered')
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      try {


        if (option === JobOption.hard) {
          progress = job.Progress(0.2, 'waitOrdersFinished')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
          await this.waitForOrdersToFinish(10);
          progress = job.Progress(0.6, 'allOrdersFinished')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
        }
        if (option !== JobOption.soft) {
          await this.stop();
          progress = job.Progress(0.8, 'serverShutdown')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
        }

        const images = job.jobDocument.images ?? this._containers;
        await this.startContainers(images)
        const success = job.Succeed("serverStarted");
        jobUpdate(job.jobId, success, this._thingName, this._connection)
      } catch (err) {
        error('error starting containers', err);
        const fail = job.Fail('failed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async setStartupHandler(job: Job) {
    try {
      if (!job.jobDocument.parameters || !("rebootTime" in job.jobDocument.parameters)) {
        throw new Error('no rebootTime defined')
      }

      const rebootTime: Date = new Date(job.jobDocument.parameters["rebootTime"]);
      const result = await axios.post(this._url + 'init/startup', { rebootTime: rebootTime.toISOString() })

      if (result.status === 200) {
        jobUpdate(job.jobId, job.Succeed("startSet"), this._thingName, this._connection)
        return
      }

      jobUpdate(job.jobId, job.Fail('failed', 'AXXXX'), this._thingName, this._connection)
    }
    catch (err) {
      error('job failed', { job, err })
      console.log('err is ', err);
      if (job.status !== 'FAILED') {
        const fail = job.Fail('failed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  async removeStartupHandler(job: Job) {
    const result = await axios.delete(this._url + 'init/startup')
    if (result.status === 200) {
      jobUpdate(job.jobId, job.Succeed("startRemoved"), this._thingName, this._connection)
      return
    }
    jobUpdate(job.jobId, job.Fail('failed', 'AXXXX'), this._thingName, this._connection)
  }

  async rebootHandler(job: Job) {
    const scheduledJobRequest = job.Progress(0.1, 'scheduled');
    scheduledJobRequest.statusDetails = scheduledJobRequest.statusDetails || new StatusDetails();
    scheduledJobRequest.statusDetails.message = 'reboot will be executed';
    jobUpdate(job.jobId, scheduledJobRequest, this._thingName, this._connection);

    try {
      await awaitableExec("sudo reboot", { cwd: this._serverPath })
      const success = job.Succeed();
      jobUpdate(job.jobId, success, this._thingName, this._connection);
    } catch (err) {
      error('error while executing reboot', err)
      const fail = job.Fail('error while executing reboot: ' + err, "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);
    }
  }

  async handleTunnel(tunnel: Tunnel) {
    log('got request to open a tunnel', tunnel)
    return new Promise(async (resolve, reject) => {
      try {
        if (!tunnel.isOpen) {
          await tunnel.open();
        }
        tunnel.isOpen ? resolve(tunnel) : reject('could not open tunnel')
      } catch (err) {
        error('error opening tunnel', err)
        reject('error opening tunnel\n' + err)
      }
    })
  }

  async resetRedisHandler(job: Job) {
    try {
      jobUpdate(job.jobId, job.Progress(.20, 'connecting'), this._thingName, this._connection)
      const client = new Redis(REDIS_PORT, REDIS_HOST);
      jobUpdate(job.jobId, job.Progress(.4, 'removingKeys'), this._thingName, this._connection)
      await client.del('isMoving')
      await client.del('unrecoverable')
      jobUpdate(job.jobId, job.Progress(.8, 'settingCleanShutdown'), this._thingName, this._connection)
      await client.set('shutdown', '{"At": null,"WasClean": true,"IsShutdownForRestart": false,"RecoverFromError": false,"OpenOrders": [],"DevicesWithOrders": []}');
      await client.disconnect()
      jobUpdate(job.jobId, job.Succeed('success'), this._thingName, this._connection)
    } catch (err) {
      error('job failed', { job, err })
      console.log('redis reset failed: ', err)
      if (job.status !== 'FAILED') {
        const fail = job.Fail('failed', "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }


  async disableNotificationsHandler(job: Job) {
    if (job.jobDocument.option === JobOption.block) {
      log('got request to disable notifications', job)
      const result = await axios.post(this._url + 'notifications/disable')
      if (result.status === 200) {
        jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
        return
      }
      const fail = job.Fail('could not disable notifications', "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);
      return;
    }

    // re-enable notifications
    log('got request to enable notifications', job)
    const result = await axios.post(this._url + 'notifications/enable')
    if (result.status === 200) {
      jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
      return
    }
    const fail = job.Fail('could not enable notifications', "AXXXX");
    jobUpdate(job.jobId, fail, this._thingName, this._connection);
  }


  async executeUpdate(job: Job) {
    return new Promise(async (resolve, reject) => {
      log('starting update now');

      let progress = 0.4

      try {
        if (this.state !== ServerState.closed) {
          log('setting state to updating')
          const updateResponse = await axios.put(this._url + "setState/Updating", {}, { timeout: 20 * 1000 });
          log('updating request returned', updateResponse.status)
        }
      } catch (err) {
        warn('error while trying to send update notification to main server', err)
      }
      if (job) {
        let progressRequest = job.Progress(progress, 'serverShutdown');
        jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);
      }

      const images = (!job || !job.jobDocument.images || job.jobDocument.images.length === 0) ? this._containers : job.jobDocument.images;
      log('handling update request', images);

      let credentials: SessionCredentials | undefined
      try {
        credentials = await SessionCredentials.createCredentials(this._serverPath, this._thingName, "iot-update-role");
        if (!credentials) throw new Error("error getting credentials, job will fail");

      } catch (err) {
        console.log('executeUpdate filaed: ', err)
        error('unable to get credentials for update', err)
        reject('unable to get credentials for update\n' + err);
        return
      }

      try {

        await awaitableExec('docker-compose ' + this.composeFile + ' stop', {
          cwd: this._serverPath
        })
        if (job) {
          let progressRequest = job.Progress(0.5, 'stoppedApplications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }

        if (job) {
          let progressRequest = job.Progress(0.6, 'downloading');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }

        await sleep(10 * 1000);

        log('downloading updates')
        const command = "PLATFORM" in process.env && process.env.PLATFORM === "x86" ? "" : "export AWS_ACCESS_KEY_ID=" + credentials.accessKeyId + "; export AWS_SECRET_ACCESS_KEY=" + credentials.secretAccessKey + ";export AWS_SESSION_TOKEN=" + credentials.sessionToken + "; " + "/home/pi/.local/bin/aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com; docker-compose" + this.composeFile + " pull";
        debug('download command', command)
        await awaitableExec(command, {
          cwd: this._serverPath
        })
        if (job) {
          let progressRequest = job.Progress(0.7, 'downloadedFinished');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }

        await sleep(20 * 1000);
        log('starting applications after update in 20 seconds')
        await awaitableExec('docker-compose' + this.composeFile + ' up -d', {
          cwd: this._serverPath
        })
        log('restarted all containers, except myappcafeserver. waiting 20 seconds for config-provider to have downloaded all files.')
        await sleep(20 * 1000)
        await awaitableExec('docker-compose' + this.composeFile + ' up -d myappcafeserver', {
          cwd: this._serverPath
        })
        if (job) {
          let progressRequest = job.Progress(0.8, 'restartingApplications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }
        progress = 0.9;
        log('all applications restarted, waiting 90 seconds for all to settle')
        await sleep(90 * 1000);
        await axios.post(this._url + 'init/sanitize-soft');
        log('sanitized the shutdown')
        if (job) {
          let progressRequest = job.Progress(progress, 'restartedApplications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }
      } catch (err) {
        console.log('error during update: ', err)
        error('error while exeuting update', err)
        reject('unable to execute update\n' + err);
        return
      }
      if (job) {
        const succeeded = job.Succeed("success");
        jobUpdate(job.jobId, succeeded, this._thingName, this._connection);
      }
      log('update successful')
      resolve('all images updated successfully');
    })
  }
}

export { Myappcafeserver }