import fs from 'fs';

import { FileLogger, ILogger } from './logger';
import { ReadLine } from 'readline';
import { asyncGetFilesRecursive, shortenPath } from './utils/utils';

const md5File = require('md5-file/promise');
const endOfLine = require('os').EOL;
const readlineSync = require('readline-sync');
const nodeCleanup = require('node-cleanup');
const chalk = require('chalk');
const readline = require('readline');

const FILE_LIST = 'deduplicate-list';
const LOCK_FILE = 'deduplicate.lock';
// to enable resuming we must know the current offset/position of a file cursor
// thus we set our own custom window size so we would have fine granularity for resuming
const HIGH_WATERMARK = 1024;

// hashes are calculated for each file in the file list. If the file list is huge it may produce a lot of
// unecessary overhead of calculating a lot of stuff at once. Hash calculation is offloaded to web worker
// however even that should be limited
const MAX_CONCURRENT_HASHES = 10;

type Hashtable = Map<string, string>;

export class Deduplicator {
    private resultLogger: ILogger;
    private verbose: boolean;
    private bytesRead: [number, number];
    private lineReader: ReadLine;
    private aborted: boolean;

    constructor(private path: string, resultPath: string) {
        this.bytesRead = [0, 0];

        /**
         * cleanup is called even when app exists correctly just with exit code of 0
         * so in case it's normal exit, just cleanup and that's it
         * in case app is killed we write the previous read byte count into a lock file
         * to enable resume in the future
         */
        nodeCleanup((exitCode: number, signal: number) => {
            if (exitCode !== 0 || exitCode == null) {
                if (this.verbose) {
                    console.log(chalk.red('Aborting...'));
                }

                this.aborted = true;
                if (this.lineReader) {
                    this.lineReader.close();
                }

                if (this.verbose) {
                    console.log("Writing lock file", this.bytesRead[0]);
                }
                fs.writeFileSync(LOCK_FILE, this.bytesRead[0]);

                process.kill(process.pid, signal);
                nodeCleanup.uninstall();
                return false;
            } else {

                console.log("Cleaning up");
                if (fs.existsSync(LOCK_FILE)) {
                    if (this.verbose) {
                        console.log("Removing lockfile");
                    }

                    fs.unlinkSync(LOCK_FILE);
                }

                if (fs.existsSync(FILE_LIST)) {
                    if (this.verbose) {
                        console.log("Removing listfile");
                    }

                    fs.unlinkSync(FILE_LIST);
                }
                process.kill(process.pid, signal);
                nodeCleanup.uninstall();

                console.log("Exiting");
                return false;
            }
        });

        console.assert(MAX_CONCURRENT_HASHES > 0, "Max concurrent hash calculations must be greater than zero");

        this.resultLogger = new FileLogger(resultPath);
        // this.resultLogger = new ConsoleLogger();
    }

    public setVerbose(enable: boolean): void {
        this.verbose = enable;
    }

    public async process(): Promise<boolean> {
        this.resultLogger.open();

        try {
            if (fs.existsSync(FILE_LIST)) {
                console.log("File list was found");
                const resume = await readlineSync.keyInYN("Resume operation or start fresh?");

                if (resume) {
                    const exists = fs.existsSync(LOCK_FILE);
                    console.assert(exists, "Lock file must also exist alongside file list");
                    if (!exists) {
                        process.exit(2);
                    }

                    await this._resume();
                } else {
                    await this._process();
                }
            } else {
                await this._generateFileList();
                await this._process();
            }
        } catch(e) {
            console.log(e);
            return false;
        }

        console.log(chalk.yellow("Done"));
        return true;
    }

    private async _generateFileList(): Promise<void> {
        console.log(`Generating file list for: ${this.path}`);

        const fileListStream = fs.createWriteStream(FILE_LIST, { flags: 'a'});

        for await (const filename of asyncGetFilesRecursive(this.path)) {
            fileListStream.write(filename + endOfLine);
        }

        fileListStream.end();

        console.log(`File list written to: ${FILE_LIST}`);
    }

    /**
     * Resuming the operation requires knowing the file we processed last. Lock file is deleted after a successful operation
     * so if it exists it means the operation was canceled prematurely. We could also decide which file is the last one however
     * that may be ambiguous so lock file contains the filename of results file
     *
     * After the results file is read, the last line is read
     */
    private async _resume(): Promise<Hashtable> {
        console.log('Resuming...');
        try {
            const lastIndex = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
            if (this.verbose) {
                console.log(`Resuming from offset: ${lastIndex}`);
            }

            return this._process(lastIndex);
        } catch(e) {
            console.error("Error while resuming:", e);
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
    private async _process(offset = 0): Promise<Hashtable> {
        if (this.verbose) {
            console.log(`Processing from offset: ${offset}`);
        }

        const hashmap: Hashtable = new Map();
        let resolver: (result: Hashtable) => void;
        let rejector: (error: any) => void;

        const promise = new Promise<Hashtable>((resolve, reject) => {
            resolver = resolve;
            rejector = reject;
        });

        let currentlyRunningProcs = 0;

        try {
            // To enable resuming, we must cap the input buffer to some smaller increment than default 16kb
            const inputReadStream = fs.createReadStream(FILE_LIST, {highWaterMark: HIGH_WATERMARK, start: offset});
            this.lineReader = readline.createInterface({
                input: inputReadStream
            });

            this.lineReader.on('line', async (filename: string) => {
                // lineReader doesnt immediately close so use a flag for avoiding unecessary work
                // https://nodejs.org/api/readline.html#readline_rl_close
                if (this.aborted) {
                    return;
                }

                // because we made a file list the file itself may be already gone
                // especially true when resuming
                if (!fs.existsSync(filename)) {
                    return;
                }

                currentlyRunningProcs++;
                const hash: string = await md5File(filename);

                // we need to check if it's aborted after async call as well.
                // https://nodejs.org/api/readline.html#readline_rl_close
                if (this.aborted) {
                    return;
                }

                // update 2 last bytesRead entries as we will use the previous one to seek
                // the streem if resuming the operation
                if (this.bytesRead[1] !== inputReadStream.bytesRead) {
                    this.bytesRead = [this.bytesRead[1], inputReadStream.bytesRead];
                }

                // we are gonna check if such a has already exists and if so - it's a duplicate. we're judgding that the first
                // file is the original and all others are duplicates
                if (this.verbose) {
                    process.stdout.write(`Identifying ${shortenPath(filename)} `);
                }

                if (hashmap.has(hash)) {
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

                if (currentlyRunningProcs >= MAX_CONCURRENT_HASHES) {
                    this.lineReader.pause();
                } else if (currentlyRunningProcs === 0) {
                    resolver(hashmap);
                } else if (currentlyRunningProcs < MAX_CONCURRENT_HASHES) {
                    this.lineReader.resume();
                } else {
                    // do nothing. it's not the end of filelist and we didn't reach the  the limit of concurrent calculations
                }
            });
        } catch(e) {
            rejector(e);
        }

        return promise;
    }
}
