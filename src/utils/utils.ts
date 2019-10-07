const endOfLine = require('os').EOL;
const { resolve } = require('path');
const { readdir } = require('fs').promises;

// read through the directories recursively and if file is met - emit filename, else run recursive generator iterator
export async function* asyncGetFilesRecursive(dir: string): AsyncGenerator<string> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        // construct the full path
        const res = resolve(dir, entry.name);

        // recursive part
        if (entry.isDirectory()) {
            yield* asyncGetFilesRecursive(res);
        } else {
            yield res;
        }
    }
}

// Emit shortened string with preceding "..."
export function shortenStr(path: string, maxSymbols: number = 40): string {
    const len = path.length;
    return '...' + path.slice(len - maxSymbols);
}

export function glueStringsWithDelimiter(strings: string[], delimiter: string = endOfLine): string {
    return strings.join(delimiter);
}