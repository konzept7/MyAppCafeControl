import { ControllableProgram } from './controllableProgram'
import EventEmitter from 'events';
import axios from 'axios';
import { mqtt } from 'aws-iot-device-sdk-v2';
import { awaitableExec, sleep } from './common'
import { Job, jobUpdate, StatusDetails, JobOption } from './job'
import { ServerShadow, ServerShadowState, IShadowState } from './shadow'
import { SessionCredentials } from './sessionCredentials';
import { Tunnel } from './tunnel'
import { log, warn, info, error } from './log'

// control docker with dockerode
import Dockerode from 'dockerode';
import { existsSync, readFile, writeFile } from 'fs';
import path from 'path';

var docker = new Dockerode();

const signalR = require('@microsoft/signalr')

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
  get composeFile(): string { return "PLATFORM" in process.env && process.env.PLATFORM === "x86" ? " --file docker-compose.x86.yml" : "" }
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
          // warn('not all images found! current images:', this.customMyappcafeImages, this.images);
          // warn('we\'ll try to build all images with docker-compose')
          // try {
          //   await this.executeUpdate(undefined);
          // } catch (err) {
          //   error('error executing update', err);
          //   reject('error executing update\n' + err?.message);
          // }
          // this.images = response.filter(image => (image.RepoTags?.some(tag => tag.endsWith("latest")) ?? false));
          // const allCustomTags: Array<string> = this.images.reduce(imageInfoAccumulator, [] as Array<string>)
          // if (this.customMyappcafeImages.every(name => allCustomTags.some(tag => tag.includes(name)))) {
          //   log('images for every custom container found!')
          // } else {
          //   reject("even after trying to build new, not every image was found")
          // }
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
    const infos = await docker.listContainers();
    for await (const info of infos) {
      if (!info.Names.some(n => this._containers.some(i => i.includes(n)))) continue;
      const container = docker.getContainer(info.Id);
      await container.stop();
    }
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


  async startBoxNow(): Promise<boolean> {
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
        log('sanitized the shutdown, just in case')
        log('waiting 5 seconds until init command')
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
        const fail = job.Fail('received a job in progress that should not survive agent restart, so it must have failed before. explicitly failing now', "AXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
        return Promise.reject();
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

      if (operation === 'pause') {
        return await this.pauseHandler(job)
      }

      if (operation === 'test-beverage') {
        return await this.testBeverageHandler(job)
      }

      if (operation === 'download-env') {
        return await this.downloadEnvHandler(job)
      }

      if (operation === 'upload-env') {
        return await this.uploadEnvHandler(job)
      }

      warn("unknown command sent to handler", job.jobDocument);
      const fail = job.Fail("unknown operation " + operation, "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);

    } catch (err) {
      error('job failed', { job, err })
      if (job.status !== 'FAILED') {
        const fail = job.Fail(err, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
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
      scheduledJobRequest.statusDetails = scheduledJobRequest.statusDetails || new StatusDetails();
      scheduledJobRequest.statusDetails.message = 'update scheduled for next maintenance';
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

  // async cleanStartHandler(job: Job) {
  //   if (job.status !== 'QUEUED') {
  //     return;
  //   }
  //   try {
  //     jobUpdate(job.jobId, job.Progress(0.2, "registered"), this._thingName, this._connection);
  //     await this.stop();
  //     jobUpdate(job.jobId, job.Progress(0.4, "stopped containers"), this._thingName, this._connection);
  //     await this.start();
  //     jobUpdate(job.jobId, job.Progress(0.6, "started containers"), this._thingName, this._connection);
  //     await sleep(15 * 1000);
  //     jobUpdate(job.jobId, job.Progress(0.8, "waited for startup"), this._thingName, this._connection);
  //     await this.startBoxNow();
  //     if (this.state === ServerState.Okay) {
  //       jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
  //     } else {
  //       const startTimer = setTimeout(() => {
  //         error('server was not started after 15 minutes')
  //         jobUpdate(job.jobId, job.Fail('not started after 15 minutes', "AXXXX"), this._thingName, this._connection);
  //       }, 15 * 60 * 1000);
  //       this.once('okay', () => {
  //         clearTimeout(startTimer);
  //         jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
  //       })
  //     }
  //   } catch (err) {
  //     error('error while starting box')
  //     jobUpdate(job.jobId, job.Fail(JSON.stringify(err), "AXXXX"), this._thingName, this._connection);
  //   }
  // }

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

  async testBeverageHandler(job: Job) {
    const amount = job.jobDocument.amount ?? 1;
    info('test beverage requested');
    for (let index = 0; index < amount; index++) {
      try {
        await axios.post(this._url + "order/test");
      } catch (err) {
        error('error while ordering test beverage', err);
        const fail = job.Fail('ordering test beverage returned non OK status', 'AXXXX');
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
        return;
      }
    }
    jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection);
  }

  async initHandler(job: Job) {
    const option = job.jobDocument.option || JobOption.soft;
    log('got job to init box, starting now')
    return new Promise(async (resolve, reject) => {
      if ((this.isOperatingNormally || this.isStarting) && option === JobOption.soft) {
        log('server is in state ' + this._state + ' and blocking orders: ' + this._isBlockingOrders)
        log('job will succeed because server is already in the correct state')
        if (this._isBlockingOrders && this._state !== ServerState.closed && this._state !== ServerState.NeverInitialized) await this.toggleBlockOrders(false);
        const success = job.Succeed();
        jobUpdate(job.jobId, success, this._thingName, this._connection);
        resolve(true)
        return;
      }
      if (option === JobOption.hard) {
        await this.waitForOrdersToFinish(10);
        let progress = job.Progress(0.3, "all orders finished");
        jobUpdate(job.jobId, progress, this._thingName, this._connection);
      }
      if (option !== JobOption.soft) {
        await this.shutdownGracefully(10);
        log('waiting 20 seconds')
        await this.sleep(20 * 1000);
      }
      try {
        // const timeout = setTimeout(() => {
        //   warn('could not start box after 20 minutes, box in state: ' + this.state)
        //   reject();
        // }, 20 * 60 * 1000);
        this.once(ServerEvents.okay, () => {
          // clearTimeout(timeout);
          const success = job.Succeed();
          jobUpdate(job.jobId, success, this._thingName, this._connection);
          resolve(true);
        });
        // this.once(ServerEvents.fatalError, () => {
        //   clearTimeout(timeout);
        //   const fail = job.Fail('server init resulted in fatal failure', "AXXXX");
        //   jobUpdate(job.jobId, fail, this._thingName, this._connection);
        //   reject;
        // });
        log('sending start command now')
        await this.startBoxNow();
      } catch (err) {
        error('error when initializing box', err)
        reject(err);
      }
      let progress = job.Progress(0.5, "start command sent");
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
    })
  }

  async pauseHandler(job: Job): Promise<boolean> {
    return new Promise(async (resolve, reject) => {

      if (job.jobDocument.option === JobOption.soft || job.jobDocument.option === JobOption.hard) {

        log('got request to pause execution', job)

        if (this.state !== ServerState.Okay && this.state !== ServerState.Paused && this.state !== ServerState.Pausing) {
          const fail = job.Fail('application is not in a state where pause is allowed, current state: ' + this.state, "AXXXX");
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
          reject('application is not in a state where pause is allowed, current state: ' + this.state);
        }
        if (this.state === ServerState.Paused) {
          let success = job.Succeed();
          jobUpdate(job.jobId, success, this._thingName, this._connection);
          resolve(true);
          return
        }

        this.on(ServerEvents.change, (newValue) => {
          if (newValue === ServerState.Paused) {
            let success = job.Succeed();
            jobUpdate(job.jobId, success, this._thingName, this._connection);
            resolve(true);
            return
          }

          if (newValue !== ServerState.Pausing && this.state !== newValue) {
            warn('pause was requested, but server is going to state ' + newValue);
            const fail = job.Fail('pause was requested, but server is going to state ' + newValue, "AXXXX");
            jobUpdate(job.jobId, fail, this._thingName, this._connection);
            reject('pause was requested, but server is going to state ' + newValue)
            return
          }
        })

        if (this.state === ServerState.Okay) {
          try {
            if (job.jobDocument.option === JobOption.soft) {
              await this.waitForOrdersToFinish(5);
              let progress = job.Progress(0.5, "all orders are finished")
              jobUpdate(job.jobId, progress, this._thingName, this._connection);
            }
            await axios.post(this._url + 'devices/pause', null, { timeout: 30 * 1000 });
          } catch (err) {
            error('error while waiting for application to be paused', err)
            const fail = job.Fail('error while waiting for application to be paused\n' + err, "AXXXX");
            jobUpdate(job.jobId, fail, this._thingName, this._connection);
            reject()
            return
          }
        }

      } else if (job.jobDocument.option === JobOption.unpause) {
        log('got request to unpause application', job)

        if (this.state !== 'Paused') {
          const fail = job.Fail('unpause was requested, but server is in state ' + this.state, "AXXXX");
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
          reject('unpause was requested, but server is in state ' + this.state)
          return
        }
        try {
          await axios.post(this._url + 'devices/unpause', null, { timeout: 30 * 1000 });
          await this.toggleBlockOrders(false);
          let success = job.Succeed();
          jobUpdate(job.jobId, success, this._thingName, this._connection);
          resolve(true);
        } catch (err) {
          error('error while waiting for application to be unpaused', err)
          const fail = job.Fail('error while waiting for application to be unpaused\n' + err, "AXXXX");
          jobUpdate(job.jobId, fail, this._thingName, this._connection);
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
      try {
        if (this.isNotOperating || job.jobDocument.isForced) {
          log('server is in state ' + this.state + ' -> update can be executed now')
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

      if (!job.jobDocument.command) {
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
        await awaitableExec(job.jobDocument.command, { cwd: this._serverPath })
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

  private async toggleBlockOrders(block: boolean): Promise<boolean> {
    log('trying to ' + (block ? 'block' : 'unblock') + ' orders');
    const url = this._url + "block"
    try {
      if (block) {
        await axios.post(url);
        return true;
      } else {
        await axios.delete(url);
        return true;
      }
    } catch (err) {
      error('error blocking/unblocking orders', err);
      return false;
    }
  }

  async startHandler(job: Job) {
    if (job.status === 'QUEUED') {

      const option = job.jobDocument.option || JobOption.soft;
      let progress = job.Progress(0.01, 'command registered, spinning up containers')
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      try {


        if (option === JobOption.soft) {
          progress = job.Progress(0.2, 'waiting for orders to be finished')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
          await this.waitForOrdersToFinish(10);
          progress = job.Progress(0.6, 'orders are finished')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
        }
        if (option !== JobOption.soft) {
          await this.stop();
          progress = job.Progress(0.8, 'stopped application')
          jobUpdate(job.jobId, progress, this._thingName, this._connection);
        }

        const images = job.jobDocument.images ?? this._containers;
        await this.startContainers(images)
        const success = job.Succeed();
        jobUpdate(job.jobId, success, this._thingName, this._connection)
      } catch (err) {
        error('error starting containers', err);
        const fail = job.Fail('error starting containers:\n' + err, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
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

  async executeUpdate(job: Job | undefined) {
    return new Promise(async (resolve, reject) => {
      log('starting update now');

      let progress = 0.1

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
        let progressRequest = job.Progress(progress, 'shutting down application');
        jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);
      }

      const images = (!job || !job.jobDocument.images || job.jobDocument.images === []) ? this._containers : job.jobDocument.images;
      log('handling update request', images);
      progress += 0.1
      if (job) {
        let progressRequest = job.Progress(progress, 'downloading');
        jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);
      }

      let credentials: SessionCredentials | undefined
      try {
        credentials = await SessionCredentials.createCredentials(this._serverPath, this._thingName, "iot-update-role");
        if (!credentials) throw new Error("error getting credentials, job will fail");

      } catch (err) {
        error('unable to get credentials for update', err)
        reject('unable to get credentials for update\n' + err);
        return
      }

      try {

        log('downloading updates')
        const setCredentials = "PLATFORM" in process.env && process.env.PLATFORM === "x86" ? "" : "export AWS_ACCESS_KEY_ID=" + credentials.accessKeyId + "; export AWS_SECRET_ACCESS_KEY=" + credentials.secretAccessKey + ";export AWS_SESSION_TOKEN=" + credentials.sessionToken + "; "
        await awaitableExec(setCredentials + "aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com; docker-compose" + this.composeFile + " pull", {
          cwd: this._serverPath
        })
        progress = 0.5;
        if (job) {
          let progressRequest = job.Progress(progress, 'downloaded updates');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }

        await this.stopContainers(undefined);
        progress = 0.7;
        if (job) {
          let progressRequest = job.Progress(progress, 'stopped applications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }

        log('starting applications after update')
        await awaitableExec('docker-compose' + this.composeFile + ' up -d ' + this._containers.filter(container => !container.includes("myappcafeserver")).join(' '), {
          cwd: this._serverPath
        })
        log('restarted all containers, except myappcafeserver. waiting 30 seconds for config-provider to have downloaded all files.')
        await sleep(30 * 1000)
        await awaitableExec('docker-compose' + this.composeFile + ' up -d myappcafeserver', {
          cwd: this._serverPath
        })
        progress = 0.9;
        log('all applications restarted, waiting 2 minutes for all to settle')
        await sleep(2 * 60 * 1000);
        log('sanitized the shutdown')
        await axios.post(this._url + 'init/sanitize-soft');
        if (job) {
          let progressRequest = job.Progress(progress, 'restarted applications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }
      } catch (err) {
        error('error while exeuting update', err)
        reject('unable to execute update\n' + err);
        return
      }
      if (job) {
        const succeeded = job.Succeed();
        jobUpdate(job.jobId, succeeded, this._thingName, this._connection);
      }
      log('update successful')
      resolve('all images updated successfully');
    })
  }
}

export { Myappcafeserver }