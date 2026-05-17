import {
  exec,
  ExecOptions
} from 'child_process';
import { log, error } from './log'


async function awaitableExec(
  command: string,
  options: ExecOptions,
  onOut: (m: string) => void = () => { },
  onErr: (e: string) => void = () => { }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (err, stdOut, stdErr) => {
      log(stdOut)
      onOut(stdOut)
      if (stdErr) {
        onErr(stdErr)
        error(stdErr)
      }
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
      log('message from exec: ' + message.toString());
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        error('child process exited with code', code)
        reject(code)
      }
      log('child process exited with code ' + code)
      resolve(code || 0);
    })
  })
}
// helper function to delay execution
function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Race a promise against a timeout. If the timeout fires first, the returned
// promise rejects with an Error that includes `label` for debugging. The
// original promise is NOT cancelled (JS has no general way to do that) - it
// keeps running in the background. The point is to unblock the caller so a
// single wedged operation can't deadlock the rest of the system.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms: ${label}`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export { awaitableExec, sleep, withTimeout }