import { Logger, FileLogger } from './logger';
const md5File = require('md5-file/promise')
var endOfLine = require('os').EOL;
const readline = require('readline');
var readlineSync = require('readline-sync');

const chalk = require('chalk');

const { resolve } = require('path');
import fs, { WriteStream } from 'fs';
import { reject } from 'async';
const { readdir } = require('fs').promises;

// hashes are calculated for each file in the file list. If the file list is huge it may produce a lot of
// unecessary overhead of calculating a lot of stuff at once. Hash calculation is offloaded to web worker
// however even that should be limited
const MAX_CONCURRENT_HASHES = 10; // todo: choose best for my machine

type Hashtable = Map<string, string>;

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

const FILE_LIST = 'deduplicate-list';
const LOCK_FILE = 'deduplicate.lock';

export class Deduplicator {
    private resultLogger: Logger;
    private verbose: boolean;

    constructor(private path: string, resultPath: string) {
        this.resultLogger = new FileLogger(resultPath);
        // todo: must accept ConsoleLogger and be tested
    }

    public setVerbose(enable: boolean): void {
        this.verbose = enable;
    }

    public async process(): Promise<boolean> {
        this.resultLogger.open();

        try {
            if (fs.existsSync(FILE_LIST)) {
                console.log("File list was found");
                const exists = fs.existsSync(LOCK_FILE);
                console.assert(exists, "Lock file must also exist alongside file list");
                if (!exists) {
                    process.exit(2);
                }

                const resume = await readlineSync.keyInYN("Resume operation or start fresh?");

                if (resume) {
                    await this._continue();
                } else {
                    await this._process();
                }

                throw new Error("Something went wrong while proessing input");
            } else {
                await this._generateFileList();
                await this._process();
            }
        } catch(e) {
            console.log('TODO::: error: ', e);
            return false;
        }

        return true;
    }

    private async _generateFileList(): Promise<void> {
        console.log("Generating file list... for ", this.path);

        const fileListStream = fs.createWriteStream(FILE_LIST, { flags: 'a'});

        for await (const filename of getFiles(this.path)) {
            fileListStream.write(filename + endOfLine);
        }

        fileListStream.end();

        console.log("Done");
    }

    private async _continue(): Promise<void> {
        console.log('continue...')
        try {
            const lastIndex = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
            console.log(`Resuming from ${lastIndex}`);
            // todo: remove previous entries
            return this._process(lastIndex);
        } catch(e) {
            console.log("======================", e);
        }
    }

    /**
     * this method is where real processing happens
     * in case 0 is passed as starting index it's assumed that the whole operation is ran from scratch
     * otherwise it's a line number inside the file list
     *
     * hash list is made from all the files in filelist in both cases and must be done all at once to ensure proper deduplication
     * and in case it's a resuming operation last entries in result must be deleted with the same hash as provided index becasue
     * it may have been canceled midway through multiple identical files
     *
     * @param index - starting index from the file list
     */
    private async _process(index = 0): Promise<void> {
        console.log(":::_Process from ", index);

        const hashmap: Hashtable = new Map();
        let resolver: Function = null;
        let rejector: Function = null;

        const promise = new Promise<Hashtable>((resolve, reject) => {
            resolver = resolve;
            rejector = reject;
        });

        let currentlyRunningProcs = 0;

        try {
            var lineReader = require('readline').createInterface({
                input: require('fs').createReadStream(FILE_LIST)
            });

            lineReader.on('close', () => {
                // todo: check if last file is actually read correclty
            });

            lineReader.on('line', async (filename: string) => {
                currentlyRunningProcs++;
                if (currentlyRunningProcs >= MAX_CONCURRENT_HASHES) {
                    console.log('Cap reached, pausing...')
                    lineReader.pause    ();
                }

                const hash: string = await md5File(filename);

                // we are gonna check if such a has already exists and if so - it's a duplicate. we're judgding that the first
                // file is the original and all others are duplicates
                if (this.verbose) {
                    process.stdout.write(`Identifying ${shortenPath(filename)} `)
                }

                if (hashmap.has(hash)) {
                    // todo: write the pair to write stream
                    if (this.verbose) {
                        process.stdout.write(`[${chalk.red('Duplicate')}] ${endOfLine}`);
                    }

                    this.resultLogger.log(filename);
                } else {
                    if (this.verbose) {
                        process.stdout.write(`[${chalk.blue('Original')}] ${endOfLine}`);
                    }

                    hashmap.set(hash, filename);
                }

                currentlyRunningProcs--;

                if (currentlyRunningProcs == 0) {
                    resolver(hashmap);
                } else if (currentlyRunningProcs < MAX_CONCURRENT_HASHES) {
                    lineReader.resume();
                } else {
                    // do nothing. it's not the end of filelist and we reached the limit of concurrent calculations
                }
            });
        } catch(e) {
            rejector(e);
        }
    }
}
