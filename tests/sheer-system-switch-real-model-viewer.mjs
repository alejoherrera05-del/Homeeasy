import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtimeModules=path.join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
const require=createRequire(import.meta.url),{chromium}=require(path.join(runtimeModules,'playwright'));
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseCommit='a14ddabf292dc1fec8b9ce112371fd9f34c5451c';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const safe=pathname=>{const target=path.resolve(root,'.'+decodeURIComponent(pathname));if(target!==root&&!target.startsWith(root+path.sep))throw new Error('Ruta fuera del repositorio.');return target;};

const server=http.createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,'http://127.0.0.1');
    if(url.pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
    if(url.pathname==='/__direct'){
      const model=url.searchParams.get('model'),blob=url.searchParams.get('blob')==='1',assignment=blob?`const bytes=await fetch(${JSON.stringify(model)}).then(response=>response.blob());document.querySelector('model-viewer').src=URL.createObjectURL(bytes);`:'';
      const source=blob?'':` src=${JSON.stringify(model)}`;
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(`<!doctype html><style>html,body,model-viewer{width:100%;height:100%;margin:0}</style><script type="module" src="/production/vendor/model-viewer-4.3.1.min.js"></script><model-viewer${source} camera-controls></model-viewer><script type="module">${assignment}</script>`);return;
    }
    let file=safe(url.pathname==='/'?'/ar-homeeasy-v3.html':url.pathname),data=await readFile(file);
    response.writeHead(200,{'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','content-length':data.byteLength,'cache-control':'no-store'});response.end(data);
  }catch(error){response.writeHead(404,{'content-type':'text/plain'});response.end(error.message);}
});

await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const consoleErrors=[];
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('pageerror',error=>consoleErrors.push(error.message));

const directLoads={};
for(const [key,model,blob] of [
  ['binovoHttp','/qa/sheer-standard/runtime-models/after-binovo-180x220-right-abierta.glb',false],
  ['standardHttp','/qa/sheer-standard/runtime-models/after-standard-150x150-right-abierta.glb',false],
  ['standardBlob','/qa/sheer-standard/runtime-models/after-standard-150x150-right-abierta.glb',true]
]){
  const direct=await browser.newPage({viewport:{width:800,height:600}}),errors=[];direct.on('console',message=>{if(message.type()==='error')errors.push(message.text());});direct.on('pageerror',error=>errors.push(error.message));
  await direct.goto(`${origin}/__direct?model=${encodeURIComponent(model)}&blob=${blob?'1':'0'}`,{waitUntil:'domcontentloaded',timeout:30000});
  try{await direct.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,null,{timeout:30000});directLoads[key]={loaded:true,errors};}catch{directLoads[key]={loaded:false,errors};}
  await direct.close();
}
{
  const sequence=await browser.newPage({viewport:{width:800,height:600}}),errors=[];sequence.on('console',message=>{if(message.type()==='error')errors.push(message.text());});sequence.on('pageerror',error=>errors.push(error.message));
  await sequence.goto(`${origin}/__direct?model=${encodeURIComponent('/qa/sheer-standard/runtime-models/after-binovo-180x220-right-abierta.glb')}&blob=1`,{waitUntil:'domcontentloaded',timeout:30000});
  await sequence.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,null,{timeout:30000});
  await sequence.evaluate(async()=>{const viewer=document.querySelector('model-viewer'),old=viewer.src;viewer.src='';viewer.removeAttribute('src');URL.revokeObjectURL(old);const bytes=await fetch('/qa/sheer-standard/runtime-models/after-standard-150x150-right-abierta.glb').then(response=>response.blob());viewer.src=URL.createObjectURL(bytes);});
  try{await sequence.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,null,{timeout:30000});directLoads.binovoClearThenStandardBlob={loaded:true,errors};}catch{directLoads.binovoClearThenStandardBlob={loaded:false,errors};}
  await sequence.close();
}
{
  const sequence=await browser.newPage({viewport:{width:800,height:600}}),errors=[];sequence.on('console',message=>{if(message.type()==='error')errors.push(message.text());});sequence.on('pageerror',error=>errors.push(error.message));
  await sequence.goto(`${origin}/__direct?model=${encodeURIComponent('/qa/sheer-standard/runtime-models/after-binovo-180x220-right-abierta.glb')}&blob=1`,{waitUntil:'domcontentloaded',timeout:30000});
  await sequence.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,null,{timeout:30000});
  await sequence.evaluate(async()=>{const viewer=document.querySelector('model-viewer'),old=viewer.src;URL.revokeObjectURL(old);viewer.src='';viewer.removeAttribute('src');const bytes=await fetch('/qa/sheer-standard/runtime-models/after-standard-150x150-right-abierta.glb').then(response=>response.blob());viewer.src=URL.createObjectURL(bytes);});
  try{await sequence.waitForFunction(()=>document.querySelector('model-viewer')?.loaded===true,null,{timeout:30000});directLoads.binovoRevokeThenClearThenStandardBlob={loaded:true,errors};}catch{directLoads.binovoRevokeThenClearThenStandardBlob={loaded:false,errors};}
  await sequence.close();
}
try{
  await page.goto(`${origin}/ar-homeeasy-v3.html?qa=1`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.evaluate(()=>{const viewer=document.querySelector('#viewer');window.__REAL_MODEL_VIEWER_AUDIT__={loads:0,errors:[]};viewer.addEventListener('load',()=>window.__REAL_MODEL_VIEWER_AUDIT__.loads++);viewer.addEventListener('error',event=>window.__REAL_MODEL_VIEWER_AUDIT__.errors.push(event?.detail?.message||'model-viewer error'));});
  const waitReady=async expected=>{try{await page.waitForFunction(expected=>{const app=window.__HOMEEASY_STUDIO__,viewer=document.querySelector('#viewer');if(!app||!viewer?.loaded||!app.ready)return false;return Object.entries(expected).every(([key,value])=>app.state[key]===value);},expected,{timeout:70000});}catch(error){const debug=await page.evaluate(()=>{const app=window.__HOMEEASY_STUDIO__,viewer=document.querySelector('#viewer');return {status:document.querySelector('#status')?.textContent,pill:document.querySelector('#ready-pill')?.textContent,overlay:document.querySelector('#stage-overlay')?.textContent,viewerLoaded:viewer?.loaded,viewerSrc:String(viewer?.src||''),snapshot:app?.snapshot,audit:window.__REAL_MODEL_VIEWER_AUDIT__};});throw new Error(`${error.message}\n${JSON.stringify({directLoads,debug,consoleErrors},null,2)}`);}};

  await waitReady({fabricWidthM:1.8,fabricHeightM:2.2,headrailSystem:'binovo'});
  const initialBinovo=await page.evaluate(()=>({ready:window.__HOMEEASY_STUDIO__.ready,loaded:document.querySelector('#viewer').loaded,arEnabled:!document.querySelector('#ar-button').disabled,state:window.__HOMEEASY_STUDIO__.state}));

  const switchStarted=Date.now();
  await page.locator('[data-group="sheer-system"] button[data-value="standard"]').click();
  await page.waitForFunction(()=>document.querySelector('#status')?.dataset.tone==='error'&&window.__HOMEEASY_STUDIO__?.snapshot?.lastFailure?.code==='CONFIGURATION_INCOMPATIBLE',null,{timeout:5000});
  const incompatibleLatencyMs=Date.now()-switchStarted;
  const incompatible=await page.evaluate(()=>({status:document.querySelector('#status').textContent,overlay:document.querySelector('#stage-overlay').textContent,pill:document.querySelector('#ready-pill').textContent,arDisabled:document.querySelector('#ar-button').disabled,viewerSrc:document.querySelector('#viewer').getAttribute('src'),failure:window.__HOMEEASY_STUDIO__.snapshot.lastFailure,state:window.__HOMEEASY_STUDIO__.state}));

  await page.locator('#sheer-width').fill('1.5');
  await page.locator('#sheer-height').fill('1.5');
  await waitReady({fabricWidthM:1.5,fabricHeightM:1.5,headrailSystem:'standard'});
  const standard=await page.evaluate(()=>{const viewer=document.querySelector('#viewer'),script=document.querySelector('script[src*="model-viewer-4.3.1.min.js"]');return {ready:window.__HOMEEASY_STUDIO__.ready,loaded:viewer.loaded,srcIsBlob:String(viewer.src).startsWith('blob:'),arEnabled:!document.querySelector('#ar-button').disabled,iosSrcAbsent:!viewer.hasAttribute('ios-src'),loading:viewer.getAttribute('loading'),modelViewerDefined:Boolean(customElements.get('model-viewer')),modelViewerScript:script?.getAttribute('src'),state:window.__HOMEEASY_STUDIO__.state};});

  await page.locator('[data-group="sheer-system"] button[data-value="binovo"]').click();
  await page.locator('#sheer-width').fill('1.8');
  await page.locator('#sheer-height').fill('2.2');
  await waitReady({fabricWidthM:1.8,fabricHeightM:2.2,headrailSystem:'binovo'});
  const finalBinovo=await page.evaluate(()=>({ready:window.__HOMEEASY_STUDIO__.ready,loaded:document.querySelector('#viewer').loaded,arEnabled:!document.querySelector('#ar-button').disabled,state:window.__HOMEEASY_STUDIO__.state,audit:window.__REAL_MODEL_VIEWER_AUDIT__}));

  const protectedDiff=execFileSync('git',['diff','--name-only',baseCommit,'--','products/panel','products/onda','HomeEasy_AR_Marker_POC','products/sheer/production/apply-sheer-fabric-pack.js','products/sheer/production/sheer-master-white.glb'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const modelViewerBytes=await readFile(path.join(root,'production','vendor','model-viewer-4.3.1.min.js'));
  const checks={
    realModelViewer431:standard.modelViewerDefined&&standard.modelViewerScript?.includes('model-viewer-4.3.1.min.js')&&modelViewerBytes.byteLength===1068903&&sha(modelViewerBytes)==='283b0672384614b4847636c306fc93fe4b1fcadc76d668b4e47f0ca76bcf033b',
    directModelViewerLoads:Object.values(directLoads).every(item=>item.loaded&&item.errors.length===0),
    initialBinovoReady:initialBinovo.ready&&initialBinovo.loaded&&initialBinovo.arEnabled,
    incompatibleImmediate:incompatibleLatencyMs<2500,
    incompatibleCommercialMessage:incompatible.status.includes('Standard no está disponible para 1,80 × 2,20 m')&&incompatible.status.includes('Ajusta las medidas o continúa con Binovo'),
    incompatibleDeterministicState:incompatible.pill==='Ajustar'&&incompatible.overlay.includes('no son compatibles')&&incompatible.arDisabled&&incompatible.viewerSrc===null&&incompatible.failure.code==='CONFIGURATION_INCOMPATIBLE',
    standardReady:standard.ready&&standard.loaded&&standard.srcIsBlob&&standard.arEnabled&&standard.iosSrcAbsent&&standard.loading==='eager'&&standard.state.headrailSystem==='standard',
    binovoRegressionFree:finalBinovo.ready&&finalBinovo.loaded&&finalBinovo.arEnabled&&finalBinovo.state.headrailSystem==='binovo',
    realLoadEvents:finalBinovo.audit.loads>=3&&finalBinovo.audit.errors.length===0,
    consoleClean:consoleErrors.length===0,
    protectedSurfacesUnchanged:protectedDiff.length===0
  };
  const status=Object.values(checks).every(Boolean)?'PASS':'FAIL';
  const report={schemaVersion:'1.0.0',scope:'Sheer Binovo/Standard system switch with real model-viewer 4.3.1',modelViewer:{source:'production/vendor/model-viewer-4.3.1.min.js',stubbed:false,bytes:modelViewerBytes.byteLength,sha256:sha(modelViewerBytes)},directLoads,initialBinovo,incompatible:{...incompatible,immediateUnder2500Ms:incompatibleLatencyMs<2500},standard,finalBinovo,consoleErrors,protectedDiff,checks,status,physicalQuickLookIphoneTest:'PENDING'};
  await writeFile(path.join(root,'qa','sheer-standard','validation','real-model-viewer-system-switch.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status,checks,initialBinovo,incompatible:report.incompatible,standard,finalBinovo,consoleErrors,protectedDiff},null,2));
  if(status!=='PASS')process.exitCode=1;
}finally{
  await page.close();await browser.close();await new Promise(resolve=>server.close(resolve));
}
