console.clear();
import { Deduplicator } from './deduplicator';

var argv = require('minimist')(process.argv.slice(2));

console.log("Deduplicator - an experiment of deduplicating files");

if (argv.help) {
    console.log(`
option      meaning
help     -  this list
verbose  -  display intermediate information while processing files
dir      -  source directory which will be filtered recursively. If ommited then current directory is gonna be used
result   -  filename of a result file. If not provided {deduplicate-results-todaysDate.txt} is gonna be used
`);
    process.exit(0);
}

const dir = argv.dir || argv._[0] || ".";

const resultFile = argv.result || `dedup-results-${new Date().getTime()}.txt`;
console.log(`Processing directory: ${dir}`);

const runner = new Deduplicator(dir, resultFile);
runner.setVerbose(argv.verbose);

(async () => {
    await runner.process();
})();