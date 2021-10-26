import Net from 'net';
import { EventEmitter } from 'stream';
import { error, info } from './log';

export enum Rp {
  NotFound = "not found",
  CupTrayLeft200_1 = "11",
  CupTrayLeft300_1 = "12",
  CupTrayLeft300_2 = "13",
  CupTrayLeft400_1 = "14",
  CupTrayLeft400_2 = "15",
  CupTrayLeft500_1 = "16",
  CupTrayLeft500_2 = "17",
  CupTrayRight200_1 = "21",
  CupTrayRight300_1 = "22",
  CupTrayRight300_2 = "23",
  CupTrayRight400_1 = "24",
  CupTrayRight400_2 = "25",
  CupTrayRight500_1 = "26",
  CupTrayRight500_2 = "27",
  CoffeeLeftIn = "32",
  CoffeeLeftOut = "33",
  CoffeeRightIn = "42",
  CoffeeRightOut = "43",
  PrinterLeftIn = "37",
  PrinterLeftOut = "38",
  PrinterRightIn = "47",
  PrinterRightOut = "48",
  Gate1 = "51",
  Gate2 = "52",
  Gate3 = "61",
  Gate4 = "62",
  IceMachine = "71",
  GripperChange = "95",
  GripperTest = "96",
  RobotMaintenance = "97",
  GripperClose = "98",
  TrashCan = "99",
  SafetyCheck = "90",
  DrumFrontLeftToBack = "01",
  DrumFrontLeftToBackSecond = "02",
  WaveLeftGates = "03",
  WaveRightGates = "04",
  DrawRectangleLeft = "05",
  DrawRectangleRight = "06"
}

const sleep = (ms: number) => {
  return new Promise(res => setTimeout(res, ms))
}

const createSequences = () => {
  const cupTrays = [
    Rp.CupTrayLeft200_1,
    Rp.CupTrayLeft300_1,
    Rp.CupTrayLeft300_2,
    Rp.CupTrayLeft400_1,
    Rp.CupTrayLeft400_2,
    Rp.CupTrayLeft500_1,
    Rp.CupTrayLeft500_2,
    Rp.CupTrayRight200_1,
    Rp.CupTrayRight300_1,
    Rp.CupTrayRight300_2,
    Rp.CupTrayRight400_1,
    Rp.CupTrayRight400_2,
    Rp.CupTrayRight500_1,
    Rp.CupTrayRight500_2
  ]
  const gates = [Rp.Gate1, Rp.Gate2, Rp.Gate3, Rp.Gate4]
  const show = [Rp.WaveLeftGates, Rp.WaveRightGates, Rp.DrawRectangleLeft, Rp.DrawRectangleRight, Rp.DrumFrontLeftToBack, Rp.DrumFrontLeftToBackSecond]

  const ctToClToTrash = cupTrays.map(ct => [new Rm(ct, Rp.CoffeeLeftIn), new Rm(Rp.CoffeeLeftOut, Rp.TrashCan, undefined, false, false)])
  const ctToCrToTrash = cupTrays.map(ct => [new Rm(ct, Rp.CoffeeRightIn), new Rm(Rp.CoffeeRightOut, Rp.TrashCan, undefined, false, false)])
  const ctToIceToClToTrash = cupTrays.map(ct => [new Rm(ct, Rp.IceMachine, Rp.CoffeeLeftIn), new Rm(Rp.CoffeeLeftOut, Rp.TrashCan, undefined, false, false)])
  const ctToIceToCrToTrash = cupTrays.map(ct => [new Rm(ct, Rp.IceMachine, Rp.CoffeeRightIn), new Rm(Rp.CoffeeRightOut, Rp.TrashCan, undefined, false, false)])

  const numberOfCupTrays = cupTrays.length;
  const randomCupTray = () => cupTrays[Math.floor(Math.random() * numberOfCupTrays)]

  const ctToClToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeLeftIn), new Rm(Rp.CoffeeLeftOut, g)])
  const ctToCrToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeRightIn), new Rm(Rp.CoffeeRightOut, g)])
  const ctToClToPrToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeLeftIn), new Rm(Rp.CoffeeLeftOut, Rp.PrinterLeftIn), new Rm(Rp.PrinterLeftOut, g)])
  const ctToClToPlToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeRightIn), new Rm(Rp.CoffeeRightOut, Rp.PrinterRightIn), new Rm(Rp.PrinterRightOut, g)])
  const ctToCrToPrToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeLeftIn), new Rm(Rp.CoffeeLeftOut, Rp.PrinterLeftIn), new Rm(Rp.PrinterLeftOut, g)])
  const ctToCrToPlToGx = gates.map(g => [new Rm(randomCupTray(), Rp.CoffeeRightIn), new Rm(Rp.CoffeeRightOut, Rp.PrinterRightIn), new Rm(Rp.PrinterRightOut, g)])
  const shows = show.map(s => [new Rm(Rp.TrashCan, s)])

  const sequences = [{ name: "Becherhalter -> WMF links -> Mülleimer", sequences: ctToClToTrash },
  { name: "Becherhalter -> WMF rechts -> Mülleimer", sequences: ctToCrToTrash },
  { name: "Becherhalter -> WMF rechts -> Mülleimer", sequences: ctToCrToTrash },
  { name: "Becherhalter -> Eis -> WMF links -> Mülleimer", sequences: ctToIceToClToTrash },
  { name: "Becherhalter -> Eis -> WMF rechts -> Mülleimer", sequences: ctToIceToCrToTrash },
  { name: "Becherhalter -> WMF links -> Ausgabe", sequences: ctToClToGx },
  { name: "Becherhalter -> WMF rechts -> Ausgabe", sequences: ctToCrToGx },
  { name: "Becherhalter -> WMF links -> Drucker links -> Ausgabe", sequences: ctToClToPlToGx },
  { name: "Becherhalter -> WMF links -> Drucker rechts -> Ausgabe", sequences: ctToClToPrToGx },
  { name: "Becherhalter -> WMF rechts -> Drucker links -> Ausgabe", sequences: ctToCrToPlToGx },
  { name: "Becherhalter -> WMF rechts -> Drucker rechts -> Ausgabe", sequences: ctToCrToPrToGx },
  { name: "Showprogramme", sequences: shows }
  ]

  return sequences;
}

export class Rm {

  private getName = (m: string) => {
    const names = Object.entries(Rp);
    const r = names.find(n => n[1] === m);
    return r ? r[0] : "not found"
  }

  toString = () => {
    const move = this.Command;
    let description = ""
    switch (move.length) {
      case 2:
        description += this.getName(move)
        break;
      case 4:
        description += this.getName(move.substring(0, 2)) + " -> " + this.getName(move.substring(2, 4))
        break;
      case 6:
        description += this.getName(move.substring(0, 2)) + " -> " + this.getName(move.substring(2, 4)) + " -> " + this.getName(move.substring(4, 6))
        break;
      default:
        description = ""
        break;
    }
    return `${move.padEnd(7, " ")} | ${this.Result} | ${(this.Response ?? "").padEnd(8, " ")} | ${description}`
  }

  print = () => {
    if (!this.IsCounted) return;
    if (this.IsSuccess) {
      info(this.toString())
    } else {
      error(this.toString())
    }
  }

  get Command(): string { return this.Start + (this.Via ? this.Via : "") + this.End; }
  get IsSuccess() { return this.Result == RmResult.Success }
  Response?: string
  ExecutionTime?: Number
  IsCounted!: boolean
  IsSuccessNeeded!: boolean
  Start!: Rp
  End!: Rp
  Via?: Rp
  Retries = 0
  Result = RmResult.Unknown

  constructor(start: Rp, end: Rp, via: Rp | undefined = undefined, isCounted = true, isSuccessNeeded = true) {
    this.Start = start;
    this.End = end;
    this.Via = via;
    this.IsCounted = isCounted;
    this.IsSuccessNeeded = isSuccessNeeded;
  }
}

export enum RmResult {
  Success = "SUCCESS",
  Failure = "FAILURE",
  Timeout = "TIMEOUT",
  Skipped = "SKIPPED",
  Unknown = "UNKNOWN"
}

export class RobotTest extends EventEmitter {
  public Port!: number
  public NumberOfRetries!: number
  public NumberOfLoops!: number
  public Timeout!: number
  public Exclude?: Array<Rp>

  Results: Array<Rm> = []


  private IsConnected = false
  public IsCancelled = false;

  public AllSequences?: { name: string, sequences: Rm[][] }[]

  _socket?: Net.Socket

  constructor(port = 49000, timeout = 90000, numberOfRetries = 2, numberOfLoops = 0) {
    super();
    this.Port = port
    this.Timeout = timeout
    this.NumberOfRetries = numberOfRetries
    this.NumberOfLoops = numberOfLoops
  }

  cancel() {
    this.IsCancelled = true;
  }

  async prepare() {

    const connector = await new Promise((resolve, reject) => {
      // Use net.createServer() in your code. This is just for illustration purpose.
      // Create a new TCP server.
      const server = new Net.Server();
      // The server listens to a socket for a client to make a connection request.
      // Think of a socket as an end point.

      server.listen(this.Port, () => {
        console.log(`Preparing robot test. Listening for incoming connections on ${this.Port}`);
      });


      // When a client requests a connection with the server, the server creates a new
      // socket dedicated to that client.
      server.on('connection', (socket) => {
        info('robot client connected');
        this._socket = socket;
        this.IsConnected = true;
        resolve(true)
        // Now that a TCP connection has been established, the server can send data to
        // the client by writing to its socket.
        // socket.write('Hello, client.');

        // The server can also receive data from the client by reading from its socket.
        socket.on('data', (chunk) => {
          this.emit('data', chunk.toString())
          // console.log(`Data received from client: ${chunk.toString()}`);
        });

        // When the client requests to end the TCP connection with the server, the server
        // ends the connection.
        socket.on('end', () => {
          info('robot client disconnected');
          this.IsConnected = false;
        });

        // Don't forget to catch error, for your own sake.
        socket.on('error', (err) => {
          error(`robot client received error: ${err}`);
          this.IsConnected = false;
          reject()
        });
      })
    });

    try {
      await Promise.race([connector, sleep(300000)])
      if (!this.IsConnected) {
        throw new Error('could not connect to robot in 30 seconds')
      }
    } catch (err) {
      error("error waiting on robot connection", err)
      return false;
    }

    this.AllSequences = createSequences();

    return true;
  }

  async execute() {

    this.emit('start', "Roboter Test")

    for (let x = 0; x < (this.AllSequences!.length); x++) {
      const sequences = this.AllSequences![x];
      this.emit('start', sequences.name)

      for (let y = 0; y < sequences.sequences.length; y++) {
        const sequence = sequences.sequences[y];
        const results: Array<Rm> = []
        for (let z = 0; z < sequence.length; z++) {

          const move = sequence[z];
          while (!move.IsSuccess && move.Retries <= this.NumberOfRetries) {
            const startTime = new Date()

            if (this.IsCancelled || !this.IsConnected) {
              move.Result = RmResult.Skipped
              continue
            };

            this._socket?.write(move.Command);
            const wait = new Promise((resolve) => {
              this.once('data', (r) => {
                move.Response = r;
                move.Result = r.trim() === move.Command + "0" || (r.trim() === "990" && move.Command.endsWith("99")) ? RmResult.Success : RmResult.Failure
                move.ExecutionTime = startTime.getMilliseconds() - new Date().getMilliseconds()
                resolve(r)
              })
            });

            await Promise.race([wait, sleep(this.Timeout)])
            if (!move.Response) {
              RmResult.Timeout
            }
            this.Results.push(move);
            results.push(move);
            this.emit('move', move)
            if (!move.IsSuccess) move.Retries++
            await sleep(1500);
            if (!move.IsSuccessNeeded) break;
          }
        }
        this._socket?.write("97");
        await new Promise((resolve) => {
          this.once('data', () => {
            resolve(true)
          })
        })
        this.emit('sequence', sequences);
        await sleep(90 * 1000);
        this._socket?.write("97");
        await new Promise((resolve) => {
          this.once('data', () => {
            resolve(true)
          })
        })
      }
    }
    this.emit('finish')

  }

}