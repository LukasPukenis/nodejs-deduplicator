const md5File = require('md5-file/promise')
var endOfLine = require('os').EOL;

const { resolve } = require('path');
import fs, { WriteStream } from 'fs';
const { readdir } = require('fs').promises;

/**
 * read through the directories recursively and if file is met - emit filename, else run recursive generator iterator
 */
async function* getFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    // construct the full path
    const res = resolve(dir, entry.name);

    // recursive part
    if (entry.isDirectory()) {
      yield* getFiles(res);
    } else {
      yield res;
    }
  }
}

function shortenPath(path: string, maxSymbols: number = 40): string {
    const len = path.length;
    return '...' + path.slice(len - maxSymbols);
}

interface Logger {
    open(): void;
    close(): void;
    log(message: string): void;
}

class FileLogger implements Logger {
    private path: string;
    private stream: WriteStream; // todo

    constructor(path?: string) {
        if (!path || path.length == 0) {
            path = `dedup-results-${new Date().getTime()}.txt`;
        }

        this.path = path;
    }

    log(message: string): void {
        console.assert(this.stream, "FileLogger must be opened before logging");
        this.stream.write(message + endOfLine);        
    }

    close(): void {
        this.stream.end();
    }

    open(): void {
        this.stream = fs.createWriteStream(this.path, { flags: 'a'});
    }
}

class ScreenLogger implements Logger {
    constructor() {}
    log(message: string): void {
        console.log(message);
    }

    close(): void {}
    open(): void {}
}

export class Deduplicator {
    private resultLogger: Logger;

    constructor(private path: string, private resultPath: string) {
        this.resultLogger = new FileLogger();
    }

    async process(): Promise<boolean> {        
        this.resultLogger.open();

        try {
            for await (const f of getFiles(this.path)) {
                const hash = await md5File(f);
                
                // todo: if verbose flag
                console.log(`Hashing "${shortenPath(f)}" -> ${hash}`)

            }

            this.resultLogger.close();
            return true;
        } catch(e) {
            console.log("Something went wrong. Exiting");
            this.resultLogger.close();
            process.exit(1);
        }
    }
}
