import fs from 'fs';

import { FileLogger, ILogger } from './logger';
import { ReadLine } from 'readline';
import { asyncGetFilesRecursive, shortenStr, glueStringsWithDelimiter } from './utils/utils';

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
    // closing file stream doesnt immediately stop it from firing events so we must use a flag alongside
    private aborted: boolean;
    private types: string[];

    constructor(private path: string, resultPath: string, types: string) {
        if (types) {
            this.types = types.split(',').map( (type: string) => '.' + type);
        }
        this.bytesRead = [0, 0];

        /**
         * cleanup is called even when app exists correctly just with exit code of 0
         * so in case it's normal exit, just cleanup and that's it
         * in case app is killed/aborted we write the previous read byte count into a lock file
         * to enable resume in the future
         */
        nodeCleanup((exitCode: number, signal: number) => {
            if (exitCode !== 0 || exitCode == null) {
                this._cleanupAbort(signal);
            } else {
                this._cleanupSuccess(signal);
            }

            return false;
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
                const resume = await readlineSync.keyInYN("Resume operation(Y) or start fresh(N)?");

                if (resume) {
                    const exists = fs.existsSync(LOCK_FILE);
                    console.assert(exists, "Lock file must also exist alongside file list");

                    if (exists) {
                        await this._resume();
                    } else {
                        await this._process();
                    }
                } else {
                    await this._process();
                }
            } else {
                await this._generateFileList();
                await this._process();
            }
        } catch(e) {
            console.error(chalk.red('Error: ', e));
            return false;
        }

        console.log(chalk.yellow("Done"));
        return true;
    }

    // in order to properly resume operations file list is made so an index could be saved when canceling
    private async _generateFileList(): Promise<void> {
        console.log(`Generating file list for: ${this.path}`);
        if (this.verbose) {
            console.log(`Filtering only for extensions: ${this.types.join(' ')}`);
        }

        const fileListStream = fs.createWriteStream(FILE_LIST, { flags: 'a'});

        for await (const filename of asyncGetFilesRecursive(this.path)) {
            if (this.types) {
                const pass = this.types.find( (type: string) => filename.match(type) != null);
                if (!pass) {
                    continue;
                }
            }
            fileListStream.write(filename + endOfLine);
        }

        fileListStream.end();

        if (this.verbose) {
            console.log(`File list written to: ${FILE_LIST}`);
        }
    }

    /**
     * Resuming the operation requires knowing the file which we processed last. Lock file is deleted after a successful operation
     * so if it exists it means the operation was canceled prematurely
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
            console.error(chalk.red("Error while resuming:", e));
        }
    }

    /**
     * this method is where real processing happens
     * in case 0 is passed as starting index it's assumed that the whole operation is ran from scratch
     * otherwise it's an offset inside the file list. This might not be ideal as streams may know nothing about new lines
     * so we may end up in between the filename string. Best method would be to get rid of streams and process the list manually
     *
     * @param index - starting index from the file list
     */
    private async _process(offset = 0): Promise<Hashtable> {
        console.log("Processing files...")
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
            const inputReadStream = fs.createReadStream(FILE_LIST, { highWaterMark: HIGH_WATERMARK, start: offset });
            this.lineReader = readline.createInterface({
                input: inputReadStream
            });

            this.lineReader.on('line', async (filename: string) => {
                // lineReader doesnt immediately close so use a flag for avoiding unecessary work
                // https://nodejs.org/api/readline.html#readline_rl_close
                if (this.aborted) {
                    return;
                }

                // because we made a list before it means there's a chance that the file is already gone
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
                    process.stdout.write(`Identifying ${shortenStr(filename)} `);
                }

                if (hashmap.has(hash)) {
                    if (this.verbose) {
                        process.stdout.write(`[${chalk.red('Duplicate')}] ${endOfLine}`);
                    }

                    const originalFilename = hashmap.get(hash);
                    this.resultLogger.log( glueStringsWithDelimiter([originalFilename, filename, '']));
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

    private _cleanupSuccess(signal: number) {
        if (this.verbose) {
            console.log("Cleaning up after success");
        }

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
    }

    private _cleanupAbort(signal: number) {
        console.log(chalk.red('Aborting...'));

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
    }
}
