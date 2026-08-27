import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {spawnSync} from "node:child_process";

const delivery=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),repo=process.env.HOMEEASY_REPO_ROOT?path.resolve(process.env.HOMEEASY_REPO_ROOT):path.resolve(delivery,"..");
const html=await readFile(path.join(delivery,"ar-marker-poc.html"),"utf8"),runtime=await readFile(path.join(delivery,"production","marker-placement-poc.js"),"utf8");
assert.doesNotMatch(html,/https?:\/\//);assert.doesNotMatch(html,/model-viewer|quick\s*look|activateAR|immersive-ar|location-based|nft/i);assert.match(html,/ar-threex-3\.4\.8\.mjs/);assert.match(html,/three-0\.164\.0\.module\.min\.js/);assert.match(html,/\.\.\/products\/onda\/studio-product\.js/);assert.match(html,/homeeasy-ar-card\.patt/);assert.match(html,/smoothCount:10/);assert.match(html,/smoothTolerance:\.01/);assert.match(html,/smoothThreshold:5/);assert.match(html,/size:MARKER_SIZE_M/);
for(const state of ["INITIALIZING","SEARCHING_MARKER","MARKER_FOUND","TRACKING","MARKER_LOST","ERROR"])assert.match(runtime,new RegExp(state));
for(const copy of ["Apunta a la Tarjeta AR HomeEasy","Ubicación encontrada","Vuelve a enfocar la Tarjeta HomeEasy"])assert.ok(html.includes(copy)||runtime.includes(copy));
for(const label of ["Centrar","←","↑","↓","→","1 cm","5 cm","Acercar a pared","Alejar 1 cm","RESTABLECER"])assert.ok(html.includes(label));
assert.match(runtime,/variantId:"velo-coral-white"/);assert.match(runtime,/widthM:1/);assert.match(runtime,/heightM:2\.2/);assert.match(runtime,/position:"closed"/);assert.match(runtime,/markerOffsets\.scale\.setScalar\(1\)/);

const expectedVendor={
  "ar-threex-3.4.8.mjs":"6c9aa037be052f9741defe725bc3d22b01c8ba09500a41796a11f6417eb6fd34",
  "camera_para.dat":"dc0487240de94aafab0f6106c6d9faf79b70f22de0faf3281d341e33edd777ed",
  "three-0.164.0.module.min.js":"6c2bfdf07626404916f34aef8cf57992926d849526bc6eb4556da96a3ba4e78c",
  "BufferGeometryUtils-0.164.0.js":"b0c64fe6f3b9907262921b73fafc4ade874c07ba6b4876e164c87a830c2c2113",
  "GLTFLoader-0.164.0.js":"785497c3b348c5046b2a2a7cd74828969ee115818140cd50309fd4f8dc3ab220"
};
for(const [file,expected] of Object.entries(expectedVendor)){const content=await readFile(path.join(delivery,"vendor",file));assert.equal(createHash("sha256").update(content).digest("hex"),expected,`${file} cambió`);}

const locks={"products/sheer/production":"7ec65db370ecdca6208a90518be89ba4d608bdf1","products/panel/production":"057f7c80fcdedd1c99f3dd6422096fe2bd43b9f5","products/onda/production":"b65f6c1e11b482322fb7a0fa46ef6565914aa5b9","products/onda/studio-product.js":"38fecc9e83f9089267921789c3e59afcfb2f12a4","ar-homeeasy-v3.html":"f169ab2463e3bd7992c9ce4276c8a82445ddf74f","index.html":"4d30605418d310a7f8aa32c6adf71b7d098f9d84"};
for(const [target,expected] of Object.entries(locks)){const git=spawnSync("git",["-c",`safe.directory=${repo.replaceAll("\\","/")}`,"rev-parse",`HEAD:${target}`],{cwd:repo,encoding:"utf8"});assert.equal(git.status,0,git.stderr);assert.equal(git.stdout.trim(),expected,`${target} golden cambió`);}
const top=await readdir(delivery);assert.equal(top.includes("products"),false);assert.equal(top.includes("ar-homeeasy-v3.html"),false);assert.equal(top.includes("index.html"),false);
console.log("static-contract: PASS");
