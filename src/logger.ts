const endOfLine = require('os').EOL;
import fs, { WriteStream } from 'fs';

export interface ILogger {
    open(): void;
    close(): void;
    log(message: string): void;
}

export class FileLogger implements ILogger {
    private stream: WriteStream;

    constructor(private path: string) {
    }

    public log(message: string): void {
        console.assert(this.stream, "FileLogger must be opened before logging");
        this.stream.write(message + endOfLine);
    }

    public close(): void {
        this.stream.end();
    }

    public open(): void {
        this.stream = fs.createWriteStream(this.path, { flags: 'a'});
    }
}

export class ConsoleLogger implements ILogger {
    constructor() {
        // nothing to do with console
    }
    public log(message: string): void {
        console.log(message);
    }

    public close(): void {
        // nothing to do with console
    }
    public open(): void {
        // nothing to do with console
    }
}
