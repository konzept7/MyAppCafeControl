import {
  mqtt,
  io,
  iot
} from 'aws-iot-device-sdk-v2';
import {
  exec,
  ExecOptions
} from 'child_process';

async function awaitableExec(command: string, options: ExecOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdOut, stdErr) => {
      if (error) {
        console.error('error executing child process', error)
        if (stdErr) console.error(stdErr)
        console.info(stdOut)
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
      resolve(code || 0);
    })
  })
}
// helper function to delay execution
function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export { Tunnel, awaitableExec, sleep }