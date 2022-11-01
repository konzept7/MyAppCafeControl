import {
  exec,
  ExecOptions
} from 'child_process';
import { log, error } from './log'


async function awaitableExec(command: string, options: ExecOptions): Promise<string> {
  let stringBuilder = '';
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (err, stdOut, stdErr) => {
      log(stdOut)
      stringBuilder += stdOut;
      if (stdErr) error(stdErr)
      if (err) {
        error('error executing child process', err)
        reject(error)
        return;
      }
    })
    child.on('error', (err) => {
      if (err) {
        error('error executing child process', error)
        reject(error)
        return
      }
    })

    child.on('message', (message) => {
      stringBuilder += message.toString();
      log('message from exec: ' + message.toString());
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        error('child process exited with code', code)
        reject(code)
      }
      log('child process exited with code ' + code)
      resolve(stringBuilder);
    })
  })
}
// helper function to delay execution
function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export { awaitableExec, sleep }