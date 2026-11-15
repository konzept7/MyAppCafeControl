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
    let settled = false;
    let drainTimer: NodeJS.Timeout | undefined;
    let stdOutSoFar = '';
    let stdErrSoFar = '';
    const settle = (err: Error | null, stdOut: string, stdErr: string) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      log(stdOut)
      onOut(stdOut)
      if (stdErr) {
        onErr(stdErr)
        error(stdErr)
      }
      if (err) {
        error('error executing child process', err)
        reject(err)
        return
      }
      log('child process exited with code 0')
      resolve(0)
    }

    // The exec callback has the complete output and the spawn errors, but it
    // runs only once stdout and stderr are closed. 'exit' can fire before the
    // streams are drained, so it only starts a grace period: a background
    // process started by the command ('foo &') keeps the pipes open and would
    // otherwise hold the caller until that process dies.
    const child = exec(command, options, (err, stdOut, stdErr) =>
      settle(err, String(stdOut), String(stdErr))
    )
    child.stdout?.on('data', (chunk) => { stdOutSoFar += chunk })
    child.stderr?.on('data', (chunk) => { stdErrSoFar += chunk })
    child.on('exit', (code, signal) => {
      drainTimer = setTimeout(() => {
        const err = code === 0
          ? null
          : new Error(`Command failed (${signal ?? 'exit code ' + code}): ${command}`)
        settle(err, stdOutSoFar, stdErrSoFar)
      }, 2000)
    })
  })
}
// helper function to delay execution
function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Per-job budget enforced in index.ts. Exported so handlers with long waits
// can stay inside it and fail the job themselves with a precise reason.
const JOB_HANDLER_TIMEOUT_MS = 15 * 60 * 1000;

// Error type used by withTimeout so callers can distinguish "the operation
// timed out" from "the operation itself failed".
class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    // restore prototype chain for `instanceof` when targeting ES5-ish outputs
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

// Race a promise against a timeout. If the timeout fires first, the returned
// promise rejects with a TimeoutError that includes `label` for debugging. The
// original promise is NOT cancelled (JS has no general way to do that) - it
// keeps running in the background. The point is to unblock the caller so a
// single wedged operation can't deadlock the rest of the system.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`timed out after ${timeoutMs}ms: ${label}`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

// axios errors carry the answer of the server, which names the cause, while their message only names the status
function describeHttpError(err: any): string {
  if (!err?.response) return err?.message ?? String(err);
  const { status, data } = err.response;
  return `${status} ${typeof data === 'string' ? data : JSON.stringify(data)}`;
}

export { awaitableExec, sleep, withTimeout, TimeoutError, describeHttpError, JOB_HANDLER_TIMEOUT_MS }