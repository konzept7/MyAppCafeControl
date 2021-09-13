import chalk from 'chalk'

const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }

const time = () => {
  return new Date().toLocaleDateString('en-US', options)
}

export const warn = (message: string, object: any = undefined) => {
  console.log(`WARN [${time()}]: ${chalk.bgYellow.bold.black(message)}`, chalk.bgBlack.white(JSON.stringify(object)))
}
export const info = (message: string, object: any = undefined) => {
  console.log(`INFO [${time()}]: ${chalk.bgCyanBright.black(message)}`, chalk.bgBlack.white(JSON.stringify(object)))
}
export const error = (message: string, object: any = undefined) => {
  console.log(`ERR  [${time()}]: ${chalk.bgRed.bold.white(message)}`, chalk.bgBlack.white(JSON.stringify(object)))
}
export const log = (message: string, object: any = undefined) => {
  console.log(`INFO [${time()}]: ${chalk.bgWhite.black(message)}`, chalk.bgBlack.white(JSON.stringify(object)))
}
