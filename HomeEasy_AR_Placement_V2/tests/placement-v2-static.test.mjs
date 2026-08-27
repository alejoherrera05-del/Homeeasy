import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {buildAnchoredUsdzFromStoredEntries,createAnchoringLayer,inspectInstallationBounds,readStoredZip,writeUsdz,PLACEMENT_V2_CONTRACT} from "../production/quicklook-placement-v2.js";

const here=path.dirname(fileURLToPath(import.meta.url)),delivery=path.resolve(here,".."),repo=process.env.HOMEEASY_REPO_ROOT?path.resolve(process.env.HOMEEASY_REPO_ROOT):path.resolve(delivery,"..");
const html=await readFile(path.join(delivery,"ar-homeeasy-placement-v2.html"),"utf8"),adapter=await readFile(path.join(delivery,"production/quicklook-placement-v2.js"),"utf8");
const browserReport=JSON.parse(await readFile(path.join(delivery,"tests/browser-representative-report.json"),"utf8"));

assert.match(html,/model-viewer-4\.3\.1\.min\.js/);assert.match(html,/ar-placement="wall"/);assert.match(html,/ar-scale="fixed"/);assert.doesNotMatch(html,/ios-src=/);
assert.match(html,/>Quick Look actual</);assert.match(html,/>Ubicación precisa</);assert.match(html,/Apunta al centro superior de la ventana o pared\.\s*\n\+?Mueve el iPhone lentamente hasta reconocer la superficie\./);
assert.match(html,/<a[^>]+rel="ar"[^>]*>[\s\S]*?<img/);assert.match(html,/products\/sheer\/studio-product\.js/);assert.match(html,/products\/panel\/studio-product\.js/);assert.match(html,/products\/onda\/studio-product\.js/);
assert.match(adapter,/prepend apiSchemas = \["Preliminary_AnchoringAPI"\]/);assert.match(adapter,/preliminary:anchoring:type = "plane"/);assert.match(adapter,/preliminary:planeAnchoring:alignment = "vertical"/);
assert.equal(PLACEMENT_V2_CONTRACT.mimeType,"model/vnd.usdz+zip");assert.equal(PLACEMENT_V2_CONTRACT.allowsContentScaling,false);
assert.equal(browserReport.consoleErrors,0);assert.equal(browserReport.physicalQuickLookIphoneTest,"PENDING");assert.deepEqual(browserReport.representatives.map(item=>item.productId),["sheer","panel","onda"]);assert.ok(browserReport.representatives.every(item=>item.wallPlaneTestPassed&&item.minimumClearanceM>=0));

const layer=createAnchoringLayer({sourceLayerName:"model.usda",mountPointM:[0.5,2.2,-0.04],productId:"sheer"});
assert.match(layer,/double3 xformOp:translate = \(-0\.5, -2\.2, 0\.04\)/);
const source=new TextEncoder().encode('#usda 1.0\n(defaultPrim="Root")\ndef Xform "Root" {}\n'),stored=writeUsdz([{name:"model.usda",data:source}]),entries=readStoredZip(stored);assert.equal(entries.length,1);assert.equal(entries[0].aligned,true);
const bounds={wallPlaneTestPassed:true,mountPointM:[0.5,2.2,-0.04]},anchored=buildAnchoredUsdzFromStoredEntries(entries,{bounds,productId:"sheer"}),verified=readStoredZip(anchored.bytes);
assert.equal(verified[0].name,"placement.usda");assert.ok(verified.every(entry=>entry.aligned));assert.equal(new TextDecoder().decode(verified[0].data),anchored.wrapper);

function canonicalGlb(){
  const positions=new Float32Array([-1,0,0,1,0,0,0,2,0]),bin=new Uint8Array(positions.buffer),json={asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{name:"PANEL_RAIL_PROFILE",mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bin.length}],buffers:[{byteLength:bin.length}]},jsonBytes=new TextEncoder().encode(JSON.stringify(json)),jsonLength=(jsonBytes.length+3)&~3,binLength=(bin.length+3)&~3,out=new Uint8Array(12+8+jsonLength+8+binLength),view=new DataView(out.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(jsonBytes,20);const header=20+jsonLength;view.setUint32(header,binLength,true);view.setUint32(header+4,0x004e4942,true);out.set(bin,header+8);return out;
}
const report=inspectInstallationBounds(canonicalGlb(),{productId:"panel"});assert.deepEqual(report.mountPointM,[0,2,0]);assert.equal(report.minimumClearanceM,0);assert.equal(report.wallPlaneTestPassed,true);

for(const forbidden of ["products","ar-homeeasy-v3.html"]){assert.equal((await readdir(delivery)).includes(forbidden),false,`La entrega aislada no debe contener ${forbidden}`);}
assert.ok(await readFile(path.join(repo,"ar-homeeasy-v3.html")));console.log("placement-v2-static: PASS");
