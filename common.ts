import {
  exec,
  ExecOptions
} from 'child_process';
import { log, error } from './log'


async function awaitableExec(command: string, options: ExecOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (err, stdOut, stdErr) => {
      log(stdOut)
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
      log(message.toString());
    })
    child.on('exit', (code) => {
      log('child process exited with code ' + code)
      resolve(code || 0);
    })
  })
}
// helper function to delay execution
function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export { awaitableExec, sleep }