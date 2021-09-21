import chalk from 'chalk'

const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }

const time = () => {
  return new Date().toLocaleDateString('en-US', options)
}

export const warn = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgYellow.bold.black('WARN')} [${time()}]: ${message}`, chalk.bgBlack.white(JSON.stringify(object)))
    : console.log(`${chalk.bgYellow.bold.black('WARN')} [${time()}]: ${message}`)
}
export const info = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgCyanBright.black('INFO')} [${time()}]: ${message}`, chalk.bgBlack.white(JSON.stringify(object)))
    : console.log(`${chalk.bgCyanBright.black('INFO')} [${time()}]: ${message}`)

}
export const error = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgRed.bold.white('ERR')}  [${time()}]: ${message}`, chalk.bgBlack.white(JSON.stringify(object)))
    : console.log(`${chalk.bgRed.bold.white('ERR')}  [${time()}]: ${message}`)
}
export const log = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgWhite.black('INFO')} [${time()}]: ${message}`, chalk.bgBlack.white(JSON.stringify(object)))
    : console.log(`${chalk.bgWhite.black('INFO')} [${time()}]: ${message}`)
}
export const debug = (message: string, object: any = undefined) => {
  if (process.env.DEBUG) {
    log(message, object);
  }
}

