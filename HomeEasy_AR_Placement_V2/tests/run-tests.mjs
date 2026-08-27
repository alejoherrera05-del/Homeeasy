import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
const here=path.dirname(fileURLToPath(import.meta.url));
for(const file of ["placement-v2-static.test.mjs","golden-products-lock.test.mjs"]){const run=spawnSync(process.execPath,[path.join(here,file)],{stdio:"inherit"});if(run.status!==0)process.exit(run.status||1)}
console.log("PLACEMENT V2 STATIC SUITE: PASS");
