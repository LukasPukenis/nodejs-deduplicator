

## node.js based tool for finding file duplicates

### Installation
_Install:_
```yarn install```

_Build(continuously):_
```yarn run start```

_You may run tests:_
```npx jest```

_Now you can run:_
```node dist/js/index.js --dir=source_directory --result=resultfile```

_Note_:
you may pass ```--verbose``` flag in case you want to see more information.


## Usage
Before using you must compile it as compiled source is not provided. Some example commands:

`node dist/js/index.js`

`node dist/js/index.js --dir=./node_modules --result=dedup-result1.txt --types=json,md --verbose`

_Note_: In case previous operation was canceled then user will be prompted about resuming the previous operation or restarting it.

## Options
* *option*      meaning
* *help*     -  this list
* *verbose*  -  display intermediate information while processing files
* *dir*      -  source directory which will be filtered recursively. If ommited then current directory is gonna be used
* *result*   -  filename of a result file. If not provided _{deduplicate-results-todaysDate.txt}_ is gonna be used
* *types*    -  comma separated list of extensions

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
