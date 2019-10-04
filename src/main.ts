// console.clear();

import { Deduplicator } from './deduplicator';

var argv = require('minimist')(process.argv.slice(2));

console.log("Deduplicator - an experiment of deduplicating files");

const dir = argv.dir || ".";
console.log(`Processing directory: ${dir}`);

const runner = new Deduplicator(dir, 'results.txt');

(async () => {
    const result = await runner.process();
    console.log("Deduplication was", result);    
})();