var endOfLine = require('os').EOL;
import fs, { WriteStream } from 'fs';

export interface Logger {
    open(): void;
    close(): void;
    log(message: string): void;
}

export class FileLogger implements Logger {
    private stream: WriteStream;

    constructor(private path: string) {
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

export class ScreenLogger implements Logger {
    constructor() {}
    log(message: string): void {
        console.log(message);
    }

    close(): void {}
    open(): void {}
}
