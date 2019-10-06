import { Deduplicator } from './deduplicator';
const argv = require('minimist')(process.argv.slice(2));

console.log("Deduplicator - duplicate files founder");

if (argv.help) {
    console.log(`
option      meaning
help     -  this list
verbose  -  display intermediate information while processing files
dir      -  source directory which will be filtered recursively. If ommited then current directory is gonna be used
result   -  filename of a result file. If not provided {deduplicate-results-todaysDate.txt} is gonna be used
types    -  comma separated list of extensions
`);
    process.exit(0);
}

const dir = argv.dir || argv._[0] || ".";
const types = argv.types || '';

const resultFile = argv.result || `dedup-results-${new Date().getTime()}.txt`;
console.log(`Processing directory: ${dir}`);

const runner = new Deduplicator(dir, resultFile, types);
runner.setVerbose(argv.verbose);

(async () => {
    await runner.process();
})();
