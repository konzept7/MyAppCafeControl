import { ControllableProgram } from './controllableProgram'
import EventEmitter from 'events';
import axios from 'axios';
import { mqtt } from 'aws-iot-device-sdk-v2';
import { awaitableExec, sleep } from './common'
import { Job, jobUpdate, StatusDetails } from './job'
import { ServerShadow, ServerShadowState, IShadowState } from './shadow'
import { SessionCredentials } from './sessionCredentials';

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
  private _hub!: string;
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

  get state() {
    return this._state;
  }
  set state(value) {
    console.info('current state will be set', value)
    if (this._state === value) return;

    this._state = value;

    if (this.isReadyForUpdate()) {
      this.emit('readyForUpdate');
    }

    if (value === ServerState.Okay) {
      this.emit('okay');
    }

    this.emit('change', value);
  }

  constructor(url: string, hub: string, path: string, thingName: string, connection: mqtt.MqttClientConnection) {
    super();
    this.state = ServerState.closed
    this._url = url;
    this._serverPath = path;
    this._hub = hub;
    this._thingName = thingName;
    this._connection = connection;
    const initialState = new ServerShadowState();
    initialState.desired = ServerState.NeverInitialized;
    initialState.reported = ServerState.closed;
    this.containers = []
    this.images = []
    this.shadow = new ServerShadow(connection, initialState)
    this._stateConnection = new signalR.HubConnectionBuilder()
      .withUrl(this._hub)
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
      .configureLogging("information")
      .build();

    this._stateConnection.onclose((error: any) => {
      console.error("server disconnected", error);
      this.state = ServerState.closed;
    });

    this._stateConnection.onreconnected((connectionId: string) => {
      console.log("reconnected with connectionId " + connectionId);
    });

    this._stateConnection.on("current", (args: ServerState) => {
      this.state = args
    });
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

        let imageInfoAccumulator = (array: Array<string>, entry: Dockerode.ImageInfo): Array<string> => {
          return [...array, ...entry.RepoTags];
        };

        const allTags: Array<string> = response.reduce(imageInfoAccumulator, [] as Array<string>)
        if (this.myappcafeImages.every(name => allTags.some(tag => tag.includes(name)))) {
          console.log('images for every needed container found!', this.myappcafeImages)
        } else {
          console.warn('it was not possible to find every container needed for myappcafe');
        }

        this.images = response.filter(image => image.RepoTags.some(tag => tag.startsWith("myappcafeserver_") && tag.endsWith("latest")));
        const allCustomTags: Array<string> = this.images.reduce(imageInfoAccumulator, [] as Array<string>)
        if (this.customMyappcafeImages.every(name => allCustomTags.some(tag => tag.includes(name)))) {
          console.log('images for every custom container found!')
        }
        else {
          console.warn('not all images found! current images:', this.images);
          console.warn('we\'ll try to build all images with docker-compose')
          await awaitableExec('docker-compose build ' + this.myappcafeImages.join(' '), { cwd: this._serverPath })
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

  isReadyForUpdate(): boolean {
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

  async startBoxNow() {
    await axios.post(this._url + 'init/sanitize');
    await axios.post(this._url + 'init/initnow');
  }

  async handleJob(job: Job) {
    console.log('trying to handle a job', job)
    const operation = job.jobDocument.operation;
    if (operation === 'update') {
      return await this.updateHandler(job);
    }
    if (operation === 'http') {
      return await this.httpHandler(job);
    }
    if (operation === 'shell') {
      return await this.shellCommandHandler(job);
    }
    if (operation === 'start-containers') {
      return await this.startContainersHandler(job);
    }
    if (operation === 'clean-start') {
      return await this.cleanStartHandler(job)
    }
    if (operation === 'open-tunnel') {
      return await this.openTunnelHandler(job)
    }
    if (operation === 'shutdown') {
      return await this.shutdownHandler(job)
    }

    console.warn("unknown command sent to handler", job.jobDocument);
    var fail = job.Fail("unknown operation " + operation, "AXXXX");
    jobUpdate(job.jobId, fail, this._thingName, this._connection);
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
  private _containers = ['redis', 'config-provider', 'status-frontend', 'display-queue', 'order-terminal', 'myappcafeserver'];
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


  // pulls the current version of itself
  // async function pullEnvHandler(job: Job) {

  // }

  // 
  async cleanStartHandler(job: Job) {
    if (job.status !== 'QUEUED') {
      return;
    }
    try {
      jobUpdate(job.jobId, job.Progress(0.2, "registered"), this._thingName, this._connection);
      await this.stop();
      jobUpdate(job.jobId, job.Progress(0.4, "stopped containers"), this._thingName, this._connection);
      await this.start();
      jobUpdate(job.jobId, job.Progress(0.6, "started containers"), this._thingName, this._connection);
      await sleep(15 * 1000);
      jobUpdate(job.jobId, job.Progress(0.8, "waited for startup"), this._thingName, this._connection);
      await this.startBoxNow();
      if (this.state === ServerState.Okay) {
        jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
      } else {
        const startTimer = setTimeout(() => {
          console.error('server was not started after 15 minutes')
          jobUpdate(job.jobId, job.Fail('not started after 15 minutes', "AXXXX"), this._thingName, this._connection);
        }, 15 * 60 * 1000);
        this.once('okay', () => {
          clearTimeout(startTimer);
          jobUpdate(job.jobId, job.Succeed(), this._thingName, this._connection)
        })
      }
    } catch (error) {
      console.error('error while starting box')
      jobUpdate(job.jobId, job.Fail(JSON.stringify(error), "AXXXX"), this._thingName, this._connection);
    }
  }

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

  async update(job: Job): Promise<Job> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.isReadyForUpdate() || job.jobDocument.isForced) {
          await this.executeUpdate(job);
        }
        this.once('readyForUpdate', async () => {
          await this.executeUpdate(job);
        })
        resolve(job)
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
        await awaitableExec(job.jobDocument.command, job.jobDocument.options)
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

  async startContainersHandler(job: Job) {
    if (job.status === 'QUEUED') {

      const progress = job.Progress(0.01, 'command registered, spinning up containers')
      jobUpdate(job.jobId, progress, this._thingName, this._connection);
      try {
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


  async openTunnelHandler(job: Job) {

  }

  async executeUpdate(job: Job) {
    return new Promise(async (resolve, reject) => {
      console.log('starting update now');

      let progress = 0.1
      await this.shutdownGracefully(10);
      let progressRequest = job.Progress(progress, 'shutting down application');
      jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);

      const images = (!job.jobDocument.images || job.jobDocument.images === []) ? this._containers : job.jobDocument.images;
      console.log('handling update request', images);
      progress += 0.1
      progressRequest = job.Progress(progress, 'downloading');
      jobUpdate(job.jobId, progressRequest, this._thingName, this._connection);

      const step = (0.8 - progress) / (images.length * 2);

      // TODO: maybe close chromium on server and display update message
      // await awaitableExec("pkill chromium", {cwd: process.cwd()})
      // await awaitableExec("chromium-browser --noerrdialogs /home/pi/srv/MyAppCafeControl/update.html --incognito --kiosk --start-fullscreen --disable-translate --disable-features=TranslateUI --window-size=1024,768 --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0", {cwd: process.cwd()})

      // TODO: docker login
      let credentials: SessionCredentials | undefined
      try {
        credentials = await SessionCredentials.createCredentials(this._serverPath, this._thingName, "iot-update-role");
        if (!credentials) throw new Error("error getting credentials, job will fail");

      } catch (error) {
        console.error('unable to get credentials for update', error)
        reject('unable to get credentials for update\n' + error);
        return
      }

      // https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_GetAuthorizationToken.html - look here if below command doesn't work, or the next command doesn't work!
      await awaitableExec("aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com", {
        cwd: this._serverPath, env: credentials.createEnv()
      })
      // await awaitableExec("pkill chromium", {cwd: process.cwd()})

      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        try {

          // await awaitableExec('docker-compose pull ' + image, {
          //    cwd: this._serverPath
          // })
          progress += step;
          progressRequest = job.Progress(progress, 'pulled ' + image);
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)
        } catch (error) {
          console.error('error while pulling container ' + image, error)
          reject('unable to pull software update\n' + error);
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
          jobUpdate(job.jobId, progressRequest, this._thingName, this._connection)

        } catch (error) {
          console.error('error while restarting container ' + image, error)
          reject(error)
        }
      }
      const succeeded = job.Succeed();
      jobUpdate(job.jobId, succeeded, this._thingName, this._connection);

      // await awaitableExec("chromium-browser --noerrdialogs http://192.168.0.17:5005/ --incognito --kiosk --start-fullscreen --disable-translate --disable-features=TranslateUI --window-size=1024,768 --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0", {cwd: process.cwd()})

      resolve('all images updated successfully');
    })
  }

}

export { Myappcafeserver }