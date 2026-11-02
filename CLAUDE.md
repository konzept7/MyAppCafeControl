# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MyAppCafeControl is the on-device control agent that runs on the Raspberry Pi inside every MyAppCafé box (Node 14, user `pi`, systemd). It holds a persistent mTLS MQTT connection to AWS IoT Core and lets the backend remotely control the MyAppCaféServer docker-compose stack via **IoT Jobs**, **Device Shadow** and **Secure Tunneling**. It contains no business logic of its own; it drives containers, the server's REST API, Redis and the OS.

Flat layout: all TypeScript sources live at the repo root (no `src/`), compiled to `dist/`. `scripts/` holds the Raspberry install/update/registration shell scripts.

## Commands

```bash
npm run build          # tsc --build  -> dist/   (strict, noUnusedLocals, noImplicitReturns)
npm run clean          # tsc --build --clean
node dist/index.js     # run (needs .env + certs, see below)
```

- `npm test` is **not** a test runner (it runs `nodemon index.ts`, and nodemon is not installed). There are no automated tests and no lint config (`tslint` is a devDependency without a `tslint.json`). Type-checking via `npm run build` is the only automated check.
- VS Code: the `Launch Program` config builds with tsc and launches `index.ts`.
- Full functional testing requires a real MyAppCafé unit with a running MyAppCaféServer.

### Runtime prerequisites (fail-fast checks at the top of `index.ts`)

- Env via `dotenv`: `THINGNAME` (required), `MYAPPCAFESERVER_PATH` (required, cwd for docker-compose), `LOCALPROXY_PATH` (required unless `PLATFORM=x86`), `AWS_REGION` (default `eu-central-1`, the only region with a mapped IoT endpoint), `PLATFORM` (selects `docker-compose.${PLATFORM}.yml` and skips ECR login on `x86`), `COMPOSE_COMMAND` (default `docker-compose`), `PRICELIST_PORT` (default 5008), `VUE_APP_PLU_PORT`, `DEBUG` (enables `debug()` output).
- Cert files in the working directory: `root-CA.crt`, `me.private.key`, `me.cert.pem` (all gitignored).

## Architecture

### `index.ts` — process entry and MQTT session
Env/cert checks → MQTT connection (`clean_session=false`, 30 s keepalive, 10 s ping timeout) → `createSessionHandlers()` subscribes to job / shadow / tunnel topics → `execute_session()` inside a forever retry loop. The resilience layer lives here and is deliberate; keep it intact when editing:
- `unhandledRejection` / `uncaughtException` → `process.exit()` so systemd restarts the unit.
- MQTT activity watchdog: heartbeat publish to the shadow `get` topic every 60 s; exit after 10 min without any MQTT activity.
- Every job handler is wrapped in `withTimeout` (15 min) and every tunnel handler in `withTimeout` (2 min). A timed-out job is `Fail`ed in the cloud so IoT Jobs hands out the next one.
- `jobsInFlight` set dedupes redelivered job executions; `resume` re-subscribes (and re-publishes GETs only when the broker dropped the session).
- Also starts an Express server on port 9000 with no routes (legacy).

### `myappcafeserver.ts` — the controlled program (~2600 lines)
`class Myappcafeserver extends EventEmitter implements ControllableProgram` (interface in `controllableProgram.ts`; this is the only implementation).

- **State machine.** `ServerState` enum (closed, Starting, NeverInitialized, Okay, Maintenance, Updating, Paused, Pausing, Restarting, FatalError). State is pushed over two SignalR hubs on `http://localhost:5002/api/`: `appstate` (`current` and `orders` messages) and `orderhub` (`UpdateOrder`). The `_state` setter emits `change` / `closed` / `readyForUpdate` / `fatalError` / `okay`; `index.ts` forwards `change` to the device shadow. `isNotOperating` = closed | NeverInitialized | FatalError.
- **`handleJob(job)`** is an if-chain on `job.jobDocument.operation`. Operations: `update`, `start`, `init`, `shutdown`, `reboot`, `pause`/`unpause`, `reload-config`, `shell`, `download-env`/`upload-env`, `remove-orders`, `test-beverage`, `robot-test`, `robot-command`, `recover-robot`, `check-device`, `deactivate-device`, `restart-device`, `trash`, `set-start`/`remove-start`, `message`, `set-server-state`, `block-orders`/`unblock-orders`, `disable-notifications`, `reset-redis`, `upload-logs`, `http` (empty stub). Conventions:
  - Each handler catches its own errors and publishes `job.Fail(...)` itself; `handleJob` only fails the job if the handler didn't.
  - The first `Succeed` / `Fail` ends a `Job`. Later `Progress` / `Succeed` / `Fail` calls on it are logged and not published, because the custom topic would otherwise report a failed job as finished. Still never leave a listener behind that completes a job; use the wait helpers below.
  - `job.Progress / Succeed / Fail` build a `JobRequest`; `jobUpdate()` (`job.ts`) publishes it to the AWS topic `$aws/things/<thing>/jobs/<id>/update` **and** the custom topic `mac/jobs/<thing>/update`.
  - `CUSTOM#<payload>` in `currentStep` is how data (stdout, env contents, presigned URLs) is returned to the backend.
  - Error codes are placeholders (`"AXXXX"`); the meaning lives in the reason string (`wrongState`, `notPossible`, `unknownOperation`, ...).
  - `JobOption` (`job.ts`) carries `soft` / `hard` / `forced` etc. `hard` typically means "block new orders, wait for running orders to finish (`waitForOrdersToFinish`), then act".
  - `reboot` is the only operation allowed to arrive already `IN_PROGRESS` (it survives the OS reboot and completes on the next start).
- **Update flow** (`update()` → `executeUpdate()`): PUT `setState/Updating` → STS creds via `SessionCredentials` (IoT role alias `iot-update-role`) → `compose stop` → ECR login + `compose pull` → `compose up -d` for the frontends → 30 s → `compose up -d myappcafeserver` last → 90 s → POST `init/sanitize-soft`. Unless `forced`/`hard`, it first waits for `readyForUpdate`. This updates the **containers only**; the control program updates itself through the cron script described under Deployment.
- **Starting containers** (`startContainers()`, used by `start`, `init`, `reboot` and others) runs `compose up -d`; only if that fails it logs in to ECR (`ecrLogin()`, credentials via env) and runs `compose up` once more. `compose up` pulls missing images, and the ECR login from the last update expires after 12 h. When a service is added to the compose files, boxes get it with the nightly self-update but have no image until the next pull. Boxes installed by `install_myappcafe.sh` use docker-compose v1 (pip `1.26.0`), so v2-only flags such as `config --format json` are not available.
- **AWS credentials** for CLI calls go into the child's `env` (`awsEnv()`), never into the command string: `awaitableExec` rejects with the exec Error, whose message contains the command, and that ends up in the journal that `upload-logs` uploads.
- **Waiting / deadlock hardening.** Every wait must be bounded and must remove its listener. Reuse the existing helpers instead of raw `this.on(...)` / `once(...)`: `withTimeout(promise, ms, label)` and `TimeoutError` (`common.ts`), `waitOnce(event, ms)` and `waitForStateChange(decide, ms, label, abortOn?)` (`myappcafeserver.ts`; pass the companion request as `abortOn` so its failure ends the wait and no rejection goes unhandled), `createRedisClient()` (5 s timeouts, no offline queue; always `disconnect()` in `finally`). Axios has a 60 s global default timeout set in `index.ts`; pass an explicit one for long operations. Long waits inside a job must fit into `JOB_HANDLER_TIMEOUT_MS` (`common.ts`); `jobDeadline()` gives handlers the point in time to bound them by, as `initBoxNow(deadline)` does.
- **Talks to:** server REST `localhost:5002/api/*` (`init/*`, `devices/*`, `robot/*`, `order*`, `setState/*`, `notifications/*`), pricelist `localhost:${PRICELIST_PORT}/api/refresh` (best effort, called from `reload-config`), `localhost:${VUE_APP_PLU_PORT}/reloadConfig`, Redis `localhost:6379`, the Docker socket (dockerode) plus the compose CLI run in `MYAPPCAFESERVER_PATH`, and the AWS CLI at `/home/pi/.local/bin/aws` (ECR, S3 `temp.myapp.cafe` for `upload-logs`).

### Supporting modules
- `job.ts` — IoT Jobs topic constants, `Job`/`JobDocument`/`JobRequest`, `jobUpdate()`.
- `shadow.ts` — `ServerShadow.setCurrentState()` publishes `{state:{reported:{serverState}}}`.
- `tunnel.ts` — spawns `$LOCALPROXY_PATH/localproxy` for AWS Secure Tunneling using the `TunnelServices` name→port map (SSH, VNC, the frontends, gates, robot); `stop()` is `sudo pkill localproxy`.
- `common.ts` — `awaitableExec`, `sleep`, `withTimeout`, `TimeoutError`.
- `log.ts` — `log / info / warn / error / debug`. Pass Error objects as the second argument; they are serialised with name/message/stack (plain `JSON.stringify` of an Error is `{}`).
- `thing.ts`, `sessionCredentials.ts`, `RobotTest.ts` — peripheral helpers (IoT thing lookup, IoT credential-provider STS creds, robot TCP test sequences).

### Known pitfalls in the current code
- The `shadowCondition` check in `handleJob` passes an arrow function to `Array.includes`, so any job carrying a `shadowCondition` fails with `wrongState`.
- `download-env` throws "Method not implemented" after starting an async write, so the job is reported failed even when the file is written.
- `http` is an empty stub; such jobs are never completed.
- `stopContainers()` runs `compose stop` without `cwd: this._serverPath`, so compose runs in the process working directory (the systemd `WorkingDirectory`, the control repo). That only works while `MYAPPCAFESERVER_PATH` is the control repo itself, which is the case on the boxes checked so far (compose project `myappcafecontrol`, compose files in this repo). A box with a separate server directory would stop nothing (affects `shutdown` and `start` hard/forced).
- `scripts/update_myappcafecontrol.sh` runs `git fetch` / `git rev-parse` before `cd $workdir`; from cron (cwd `/home/pi`) the change check probably never sees an update. Verify on a box via `update.log`.

## Deployment model (read before merging)

- **Boxes self-update from `master`.** `scripts/update_myappcafecontrol.sh` runs on every unit from cron (`@reboot` and nightly at 02:00). If `origin/master` moved, it stops the systemd unit, runs `git checkout . && git pull origin master`, `npm install` only when `package.json` changed, `npm run build`, and restarts. Anything merged to `master` therefore ships to every box automatically. `master` is protected and requires review; test thoroughly first.
- systemd unit `myappcafecontrol.service`: `node dist/index.js`, `Restart=on-failure`, `RestartSec=10`. The app relies on `process.exit()` + systemd for recovery rather than trying to heal in-process.
- **One-time device migrations** go in `scripts/once/<N>.sh` with the next higher number. `scripts/once.sh` runs them in numeric order; `scripts/version_flag` holds the highest version that exited 0, and only higher versions run. A non-zero exit stops the run and the script is retried on the next cron run, so a script with nothing to do on a box (wrong OS, already applied) must `exit 0`. A corrupt flag file stops all once scripts. `once.sh` runs **before** `git pull` in the update script, so a new once script executes one update cycle after it was pulled. Fresh installs leave the flag unset and run every once script on the first update run (`4.sh` sets up the fleet crontab).
- **Pending Docker restart.** Once scripts must not restart Docker (that restarts the running server). `scripts/once/10.sh` (libseccomp2 upgrade on Buster, issue #16) writes `scripts/docker-restart-pending` instead; `applyPendingDockerRestart()` in `myappcafeserver.ts` restarts the daemon after the control program stopped the whole stack (`executeUpdate`, `stopContainers`) and only if no stack container is still running. A marker older than the current boot is just removed. The `systemctl restart docker` wait is deliberately unbounded (a timeout cannot cancel the systemd job and would let callers start containers mid-restart); the per-job timeout in `index.ts` still fails the job. The upgrade script writes the marker before installing, so a retry after a successful install cannot lose it.
- **OS upgrade buster → bullseye.** `scripts/upgrade-to-bullseye.sh` upgrades a box in place; an operator runs its subcommands (`check`, `prepare`, `stage1`, `stage2`, `post`, reboot by hand, `finish`) over the secure tunnel in a closed window. It is not a once script and must never run from cron: it restarts Docker and needs a reboot. The apt runs are detached with `systemd-run` so a dropped tunnel cannot leave dpkg half-done. On bullseye `10.sh` / `upgrade-libseccomp-buster.sh` are no-ops (libseccomp2 2.5.1 ships natively) and Chromium is 126, the last bullseye build.
- **docker-compose variants.** `docker-compose.yml` is production (ECR images: terminal, config-provider, status-frontend, display-queue, pricelist :5008, myappcafeserver :5002/:5003, redis). `docker-compose.x86.yml` uses `-x86` images, `.debug.yml` uses `-debug` images against the dev stage, `.mac.yml` / `.local.yml` use locally built images. When adding or changing a service, update all variants.
- Commit messages follow conventional-commit prefixes (`feat(scope):`, `fix(scope):`, `refactor(scope):`).
- `readme.md` doubles as the company project-management document (German/English, TISAX classification, change-history table). Bump its "Änderungshistorie" table when you change the readme.
