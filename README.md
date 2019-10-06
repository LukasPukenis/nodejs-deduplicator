
## node.js based tool for finding file duplicates


## Usage
Before using you must compile it as compiled source is not provided. Some example commands:

`node dist/js/index.js`

`node dist/js/index.js --dir=./node_modules --result=dedup-result1.txt --types=json,md --verbose`

### Installation
simply run ```yarn install``` and then
```node dist/js/index.js --dir=source_directory --result=resultfile```
you may pass ```--verbose``` flag in case you want to see more information.

you may also run tests via ```npx jest```

## How it works
This tool works in asynchronous manner to by first making file list and saving it. Building file list is crucial in enabling the tool to resume operations if canceled.
Tool supports canceling and will write a current file index for later. MD5 hashes are calculated asynchronously and limited in how many concurrent calculations can be ran.

Output can be listed on the screen or in the resulting file. It does not provide functionality to remove the files as it must only find duplicates and removal is very sensitive thing so it's up to the user. However after having the result file, removal may be as simple as
```
while read p; do
  rm "$p"
done <results.txt
```
## Limitations
This tool does not offer a perfect solution if the files are gonna be changed while processing or if before resuming some of the files are deleted or altered. Reading a file and calculating it's hash are the most expensive parts so if when resuming the deduplication processes would rehash all the files to see if anything has changed - it would render the resuming useless as it would spend almost same amount of time as just starting from scratch.
