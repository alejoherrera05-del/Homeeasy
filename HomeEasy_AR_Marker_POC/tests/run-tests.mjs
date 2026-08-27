import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
const here=path.dirname(fileURLToPath(import.meta.url));
for(const file of ["marker-placement-logic.test.mjs","static-contract.test.mjs"]){const run=spawnSync(process.execPath,[path.join(here,file)],{stdio:"inherit",env:process.env});if(run.status!==0)process.exit(run.status||1)}
console.log("MARKER POC JS SUITE: PASS");
