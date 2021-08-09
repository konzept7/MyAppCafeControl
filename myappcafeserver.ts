import { ControllableProgram } from './controllableProgram'
import EventEmitter from 'events';
import axios from 'axios';
import { mqtt } from 'aws-iot-device-sdk-v2';
import { awaitableExec, sleep } from './common'
import { Job, jobUpdate, StatusDetails, JobOption } from './job'
import { ServerShadow, ServerShadowState, IShadowState } from './shadow'
import { SessionCredentials } from './sessionCredentials';
import { Tunnel } from './tunnel'

// control docker with dockerode
import Dockerode from 'dockerode';
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
  private customMyappcafeImages = ["status-frontend", "myappcafeserver", "config-provider", "terminal", "display-queue"]
  private myappcafeImages = ["status-frontend", "myappcafeserver", "config-provider", "terminal", "display-queue", "redis"];
  private _isBlockingOrders = false;
  private _currentOrders = new Array<any>();

  get state() {
    return this._state;
  }
  set state(value) {
    console.info('current state will be set', value)
    if (this._state === value) return;

    this._state = value;

    if (this.isNotOperating) {
      this.emit('readyForUpdate');
    }

    if (value === ServerState.Okay) {
      this.emit('okay');
    }

    this.emit('change', value);
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

    this._stateConnection.onclose((error: any) => {
      console.error("server disconnected", error);
      this._isBlockingOrders = false;
      this.state = ServerState.closed;
    });

    this._stateConnection.onreconnected((connectionId: string) => {
      console.log("reconnected with connectionId " + connectionId);
      if (this._isBlockingOrders) console.warn('reconnected, but new orders are still blocked');
    });

    this._stateConnection.on("current", (args: ServerState) => {
      // after successful init, we won't be blocking orders
      if (args === ServerState.NeverInitialized || args === ServerState.Okay && (this.state === ServerState.Starting || this.state === ServerState.Restarting || this.state === ServerState.NeverInitialized)) {
        this._isBlockingOrders = false;
        this.emit('allOrdersFinished');
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
        this.emit('allOrdersFinished');
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
          this.emit('allOrdersFinished');
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


  async prepare(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // list all running containers
      docker.listContainers((err: any, response: Array<Dockerode.ContainerInfo>) => {
        if (err) {
          console.error('error listing containers', err)
          return;
        }
        this.containers = response
        console.log('containers running', this.containers)
      });


      // find out if images are built for all necessary containers
      docker.listImages(async (err: any, response: Array<Dockerode.ImageInfo>) => {
        if (err) {
          console.error('error listing images', err)
          return;
        }

        console.log('all images', response)

        let imageInfoAccumulator = (array: Array<string>, entry: Dockerode.ImageInfo): Array<string> => {
          return [...array, ...(entry.RepoTags ?? [])];
        };

        const allTags: Array<string> = response.reduce(imageInfoAccumulator, [] as Array<string>)
        if (this.myappcafeImages.every(name => allTags.some(tag => tag.includes(name)))) {
          console.log('images for every needed container found!', this.myappcafeImages)
        } else {
          console.warn('it was not possible to find every container needed for myappcafe');
        }

        this.images = response.filter(image => (image.RepoTags?.some(tag => tag.startsWith("myappcafeserver_") && tag.endsWith("latest")) ?? false));
        const allCustomTags: Array<string> = this.images.reduce(imageInfoAccumulator, [] as Array<string>)
        if (this.customMyappcafeImages.every(name => allCustomTags.some(tag => tag.includes(name)))) {
          console.log('images for every custom container found!')
        }
        else {
          console.warn('not all images found! current images:', this.images);
          console.warn('we\'ll try to build all images with docker-compose')
          try {
            //await this.executeUpdate(undefined);
          } catch (error) {
            console.error('error executing update', error);
            reject('error executing update\n' + error?.message);
          }
          // await awaitableExec('docker-compose build ' + this.myappcafeImages.join(' '), { cwd: this._serverPath })
          this.images = response.filter(image => image.RepoTags.some(tag => tag.startsWith("myappcafeserver_") && tag.endsWith("latest")));
          const allCustomTags: Array<string> = this.images.reduce(imageInfoAccumulator, [] as Array<string>)
          if (this.customMyappcafeImages.every(name => allCustomTags.some(tag => tag.includes(name)))) {
            console.log('images for every custom container found!')
          } else {
            reject("even after trying to build new, not every image was found")
          }
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
            console.log("connected to signalR");
            resolve('connected to state hub');
            return;
          })
          .catch((error: any) => {
            this.state = ServerState.closed;
            console.error('error starting connection to server', error);
          });
        // wait for 15 seconds before trying to connect again
        await sleep(15 * 1000)
      }
    })
  }
  async startContainers(images: Array<string>) {
    console.log('starting containers as requested', images)
    return awaitableExec('docker-compose up -d ' + images.join(' '), {
      cwd: this._serverPath
    })
  }

  async start() {
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
    if (!imageNames) imageNames = []
    const infos = await docker.listContainers();
    for await (const info of infos) {
      if (!info.Names.some(n => this.myappcafeImages.some(i => i.includes(n)))) continue;
      const container = docker.getContainer(info.Id);
      await container.stop();
    }
    return true;
  }

  stop() {
    return this.stopContainers(this._containers);
  }

  sleep(ms: number) {
    new Promise(res => setTimeout(res, ms))
  }


  async startBoxNow(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      console.log('got request to start box, current state: ' + this.state)
      if (this.state === ServerState.FatalError) {
        console.log('server is in fatal error, shutting down')
        await this.shutdownGracefully(10);
        await sleep(10 * 1000);
      }
      if (this.state === ServerState.closed) {
        console.log('server is currently shut down, starting containers');
        await this.start();
        await sleep(30 * 1000);
      }
      try {
        await axios.post(this._url + 'init/sanitize');
        await axios.post(this._url + 'init/initnow');
        this.once('okay', () => resolve(true));
      } catch (error) {
        console.error('error starting box', error)
        reject(error.message)
      }
    })

  }

  private stepOperations: Array<string> = ["reboot"]
  async handleJob(job: Job) {
    console.log('trying to handle a job', job)
    try {
      if (!("operation" in job.jobDocument)) {
        throw new Error("job has no operation name, we don't know what to do");
      }
      const operation = job.jobDocument.operation;

      if (job.status === 'IN_PROGRESS' && !(this.stepOperations.includes(operation))) {
        console.error('received a job in progress that should not survive agent restart, so it must have failed before. explicitly failing now', job)
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

      console.warn("unknown command sent to handler", job.jobDocument);
      const fail = job.Fail("unknown operation " + operation, "AXXXX");
      jobUpdate(job.jobId, fail, this._thingName, this._connection);

    } catch (error) {
      console.error('job failed', job, error)
      if (job.status !== 'FAILED') {
        const fail = job.Fail(error.message, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  private async waitForOrdersToFinish(timeoutInMinutes: number | undefined): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      if (this.isNotOperating || this._currentOrders.length === 0) return resolve(true);
      await this.toggleBlockOrders(true);
      const timeout = (timeoutInMinutes || 10) * 1000 * 60;
      setTimeout(() => {
        resolve(false);
        return;
      }, timeout);
      this.once('allOrdersFinished', () => resolve(true));
    })
  }

  async shutdownGracefully(inSeconds: number) {
    if (!inSeconds) inSeconds = 10;
    console.log('stopping server if not already closed', this.state)
    return new Promise(async (resolve, reject) => {
      if (this.state !== 'closed') {
        try {
          await axios.post(this._url + "init/shutdown/" + Math.floor(inSeconds), undefined, { timeout: 10 * 1000 });
        } catch (error) {
          console.error('error shutting down application', error);
          reject(error);
        }
        console.log('scheduled server shutdown in ' + inSeconds + " seconds")
        this.on('change', newValue => {
          if (newValue === 'closed')
            resolve('server is shut down');
        })
      }
      else {
        console.log('server was already shut down');
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
        console.log('successfully updated for myappcafeserver')
      } catch (error) {
        console.error('error on updating myappcafeserver', error);
        const failed = job.Fail(JSON.stringify(error), "AXXXX");
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
  //         console.error('server was not started after 15 minutes')
  //         jobUpdate(job.jobId, job.Fail('not started after 15 minutes', "AXXXX"), this._thingName, this._connection);
  //       }, 15 * 60 * 1000);
  //       this.once('okay', () => {
  //         clearTimeout(startTimer);
  //         jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
  //       })
  //     }
  //   } catch (error) {
  //     console.error('error while starting box')
  //     jobUpdate(job.jobId, job.Fail(JSON.stringify(error), "AXXXX"), this._thingName, this._connection);
  //   }
  // }

  async shutdownHandler(job: Job) {
    if (job.status !== 'QUEUED') return;
    try {
      console.info('shutdown job received', job)
      jobUpdate(job.jobId, job.Progress(0.25, "registered"), this._thingName, this._connection);
      console.info('current state of server application', this._state)
      if (this._state === ServerState.Okay) {
        console.log('pausing application before shutting it down');
        try {
          let pause = await axios.post(this._url + 'devices/pause', null, { timeout: 30 * 1000 });
          console.info('paused application', pause.data);
        } catch (error) {
          console.error('error while waiting for application to be paused', error)
        }
      }
      jobUpdate(job.jobId, job.Progress(0.75, "if application was running, it is now set to pause"), this._thingName, this._connection);
      await this.shutdownGracefully(20);
      jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection);
    } catch (error) {
      console.error('error shutting down application')
    }
  }

  async initHandler(job: Job) {
    const option = job.jobDocument.option || JobOption.soft;
    return new Promise(async (resolve, reject) => {
      if ((this.isOperatingNormally || this.isStarting) && option === JobOption.soft) {
        const success = job.Succeed();
        jobUpdate(job.jobId, success, this._thingName, this._connection);
        resolve(true)
        return;
      }
      await this.waitForOrdersToFinish(10);
      let progress = job.Progress(0.3, "all orders finished");
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      try {
        await this.startBoxNow();
      } catch (error) {
        console.error('error when initializing box', error)
        reject(error.message);
      }
      progress = job.Progress(0.5, "start command sent");
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      const timeout = setTimeout(() => {
        console.warn('could not start box after 20 minutes, box in state: ' + this.state)
        reject();
      }, 20 * 1000);
      this.once('okay', () => {
        clearTimeout(timeout);
        const success = job.Succeed();
        jobUpdate(job.jobId, success, this._thingName, this._connection);
        resolve(true);
      })
    })
  }

  async pauseHandler(job: Job): Promise<boolean> {
    return new Promise(async (resolve, reject) => {

      if (job.jobDocument.option === JobOption.soft || job.jobDocument.option === JobOption.hard) {

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

        this.on('change', (newValue) => {
          if (newValue === ServerState.Paused) {
            let success = job.Succeed();
            jobUpdate(job.jobId, success, this._thingName, this._connection);
            resolve(true);
            return
          }

          if (newValue !== ServerState.Pausing && this.state !== newValue) {
            console.warn('pause was requested, but server is going to state ' + newValue);
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
          } catch (error) {
            console.error('error while waiting for application to be paused', error)
            const fail = job.Fail('error while waiting for application to be paused\n' + error.message, "AXXXX");
            jobUpdate(job.jobId, fail, this._thingName, this._connection);
            reject()
            return
          }
        }

      }
    })
  }

  async update(job: Job): Promise<Job> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.isNotOperating || job.jobDocument.isForced) {
          await this.executeUpdate(job);
          resolve(job)
        } else {
          this.once('readyForUpdate', async () => {
            await this.executeUpdate(job);
            resolve(job)
          })
        }
      } catch (error) {
        console.error('error while executing update', error)
        reject(error)
      }
    })
  }

  async shellCommandHandler(job: Job) {
    if (job.status === 'QUEUED') {

      if (!job.jobDocument.command) {
        const noCommand = 'a shell command was requested, but there was no command string';
        console.warn(noCommand)
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
      } catch (error) {
        console.error('error while executing shell command', error)
        const fail = job.Fail('error while executing shell command: ' + error, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }

    }
  }

  async httpHandler(job: Job) {

  }

  private async toggleBlockOrders(block: boolean): Promise<boolean> {
    return new Promise((resolve, reject) => {
      resolve(block);
    })
  }

  async startHandler(job: Job) {
    if (job.status === 'QUEUED') {

      const option = job.jobDocument.option || JobOption.soft;
      let progress = job.Progress(0.01, 'command registered, spinning up containers')
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      try {


        if (option === JobOption.hard) {
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
      } catch (error) {
        console.error('error starting containers', error);
        const fail = job.Fail('error starting containers:\n' + error, "AXXXX");
        jobUpdate(job.jobId, fail, this._thingName, this._connection);
      }
    }
  }

  // async stopContainers(): Promise<number> {
  //   console.log('stopping applications')
  //   return await awaitableExec('docker-compose stop', {
  //     cwd: this._serverPath
  //   })
  // }

  async handleTunnel(tunnel: Tunnel) {
    console.log('got request to open a tunnel', tunnel)
    return new Promise((resolve, reject) => {
      try {
        if (!tunnel.isOpen) tunnel.open();
        resolve(tunnel);
      } catch (error) {
        console.error('error opening tunnel', error)
        reject('error opening tunnel\n' + error)
      }

    })
  }

  async executeUpdate(job: Job | undefined) {
    return new Promise(async (resolve, reject) => {
      console.log('starting update now');

      let progress = 0.1

      try {
        if (this.state !== ServerState.closed) {
          console.log('setting state to updating')
          const updateResponse = await axios.put(this._url + "setState/Updating", {}, { timeout: 20 * 1000 });
          console.log('updating request returned', updateResponse.status)
        }
      } catch (error) {
        console.warn('error while trying to send update notification to main server', error)
      }
      if (job) {
        let progressRequest = job.Progress(progress, 'shutting down application');
        jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);
      }

      const images = (!job || !job.jobDocument.images || job.jobDocument.images === []) ? this._containers : job.jobDocument.images;
      console.log('handling update request', images);
      progress += 0.1
      if (job) {
        let progressRequest = job.Progress(progress, 'downloading');
        jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);
      }

      let credentials: SessionCredentials | undefined
      try {
        credentials = await SessionCredentials.createCredentials(this._serverPath, this._thingName, "iot-update-role");
        if (!credentials) throw new Error("error getting credentials, job will fail");

      } catch (error) {
        console.error('unable to get credentials for update', error)
        reject('unable to get credentials for update\n' + error);
        return
      }

      try {

        console.log('downloading updates')
        await awaitableExec("export AWS_ACCESS_KEY_ID=" + credentials.accessKeyId + "; export AWS_SECRET_ACCESS_KEY=" + credentials.secretAccessKey + ";export AWS_SESSION_TOKEN=" + credentials.sessionToken + "; aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com; docker-compose pull", {
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

        console.log('starting applications after update')
        await awaitableExec('docker-compose up -d', {
          cwd: this._serverPath
        })
        progress = 0.9;
        if (job) {
          let progressRequest = job.Progress(progress, 'restarted applications');
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        }
      } catch (error) {
        console.error('error while exeuting update', error)
        reject('unable to execute update\n' + error);
        return
      }
      if (job) {
        const succeeded = job.Succeed();
        jobUpdate(job.jobId, succeeded, this._thingName, this._connection);
      }
      console.log('update successful')
      resolve('all images updated successfully');
    })
  }
}

export { Myappcafeserver }