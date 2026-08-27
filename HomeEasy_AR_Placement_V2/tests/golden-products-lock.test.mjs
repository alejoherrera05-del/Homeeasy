import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const delivery=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),repo=process.env.HOMEEASY_REPO_ROOT?path.resolve(process.env.HOMEEASY_REPO_ROOT):path.resolve(delivery,"..");
const expected={
  sheer:{count:56,bytes:13031201,treeSha256:"f10f450e96a2b318dde39bb29b94ee72436fd0bc5e66a67c909e746b5dae975a"},
  panel:{count:23,bytes:13212245,treeSha256:"702fc5e21fcac96eac85f558c45f4634657e08f6568322aeb30f81e188901a2d"},
  onda:{count:80,bytes:29793724,treeSha256:"c3f4487976153556bd83edbd0cafafe28af3143caae9fd84126730e6e36bb57d"}
};
async function walk(root,current=root){const found=[];for(const entry of await readdir(current,{withFileTypes:true})){const absolute=path.join(current,entry.name);if(entry.isDirectory())found.push(...await walk(root,absolute));else if(entry.isFile())found.push(path.relative(root,absolute).replaceAll("\\","/"));}return found.sort();}
async function inventory(product){const root=path.join(repo,"products",product,"production"),files=await walk(root),tree=createHash("sha256");let bytes=0;for(const relative of files){const content=await readFile(path.join(root,...relative.split("/"))),digest=createHash("sha256").update(content).digest("hex");bytes+=content.length;tree.update(`${relative}\0${digest}\0`)}return {count:files.length,bytes,treeSha256:tree.digest("hex")};}
for(const [product,lock] of Object.entries(expected))assert.deepEqual(await inventory(product),lock,`${product} golden cambió`);
console.log("golden-products-lock: PASS — Sheer 0, Panel 0, Onda 0");
