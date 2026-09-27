import chalk from 'chalk'

const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }

// JSON.stringify(new Error('x')) is '{}', which hides the one thing we need
// in a crash log. Convert Errors (and objects carrying one) to plain data first.
const serialize = (object: any): string => {
  const replacer = (_key: string, value: any) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack, ...(value as any) }
      : value
  try {
    return JSON.stringify(object, replacer)
  } catch {
    return String(object)
  }
}

const time = () => {
  return new Date().toLocaleDateString('en-US', options)
}

export const warn = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgYellow.bold.black('WARN')} [${time()}]: ${message}`, chalk.bgBlack.white(serialize(object)))
    : console.log(`${chalk.bgYellow.bold.black('WARN')} [${time()}]: ${message}`)
}
export const info = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgCyanBright.black('INFO')} [${time()}]: ${message}`, chalk.bgBlack.white(serialize(object)))
    : console.log(`${chalk.bgCyanBright.black('INFO')} [${time()}]: ${message}`)

}
export const error = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgRed.bold.white('ERR')}  [${time()}]: ${message}`, chalk.bgBlack.white(serialize(object)))
    : console.log(`${chalk.bgRed.bold.white('ERR')}  [${time()}]: ${message}`)
}
export const log = (message: string, object: any = undefined) => {
  object
    ? console.log(`${chalk.bgWhite.black('INFO')} [${time()}]: ${message}`, chalk.bgBlack.white(serialize(object)))
    : console.log(`${chalk.bgWhite.black('INFO')} [${time()}]: ${message}`)
}
export const debug = (message: string, object: any = undefined) => {
  if (process.env.DEBUG) {
    log(message, object);
  }
}

