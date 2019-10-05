import { Deduplicator } from './../src/deduplicator';
import fs from 'fs';
const readline = require('readline');

test('Test with real files', async () => {

    let resolver: (data: string[]) => void;
    const promise = new Promise((resolve, reject) => {
        resolver = resolve;
    })

    const deduplicator = new Deduplicator('tests/files', 'result.txt');
    deduplicator.setVerbose(true);
    await deduplicator.process();

    const inputReadStream = fs.createReadStream('result.txt');
    const lineReader = readline.createInterface({
        input: inputReadStream
    });

    let lines: string[] = [];
    lineReader.on('line', (line: string) => {
        lines.push(line);
    });

    lineReader.on('close', () => {
        resolver(lines);
    })

    await promise;


    expect(lines[0].match("level1_2/level2_2/another-empty.dat")).not.toBeNull();
    expect(lines[1].match("level1_2/textfile-2.txt")).not.toBeNull();
});
