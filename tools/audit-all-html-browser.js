const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function walk(dir){
  let out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='.git' || ent.name==='node_modules') continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) out=out.concat(walk(p));
    else if(ent.isFile() && ent.name.endsWith('.html')) out.push(p.replace(/\\/g,'/').replace(/^\.\//,''));
  }
  return out.sort();
}
function htmlRefs(file){
  if(!fs.existsSync(file)) return [];
  const s=fs.readFileSync(file,'utf8');
  const refs=[];
  const re=/["'`](?!https?:|\/\/|data:|mailto:|tel:)([^"'`?#]*\.html)(?:[?#][^"'`]*)?["'`]/gi;
  let m; while((m=re.exec(s))) refs.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));
  return refs.filter(x=>!x.startsWith('../'));
}
function productionClosure(){
  const seen=new Set(['index.html','login.html','activar-cuenta.html']);
  const queue=[...seen];
  while(queue.length){
    const f=queue.shift();
    for(const r of htmlRefs(f)) if(fs.existsSync(r) && !seen.has(r)){seen.add(r);queue.push(r);}
  }
  return seen;
}
const genericApi={status:'ok',success:true,eventos:[],cotizaciones:[],ordenes:[],abonos:[],clientes:[],resultados:[],referencias:[],reportes:[],data:[],meta:0,total:0};
const rawIconRe=/\b(?:calendar_month|event_upcoming|chevron_left|chevron_right|arrow_back|material_symbols|upcoming)\b/i;

(async()=>{
  const all=walk('.');
  const production=productionClosure();
  console.log('BROWSER_HTML_COUNT='+all.length);
  console.log('PRODUCTION_HTML_COUNT='+production.size);
  console.log('PRODUCTION_HTML='+[...production].sort().join(','));
  const browser=await chromium.launch({headless:true});
  const results=[];

  async function runOne(file, viewport, kind){
    const context=await browser.newContext({viewport, locale:'es-CO', deviceScaleFactor:1});
    const page=await context.newPage();
    const pageErrors=[]; const failedLocal=[]; const httpLocal=[];
    page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
    page.on('requestfailed',req=>{try{const u=new URL(req.url());if(u.hostname==='127.0.0.1') failedLocal.push(u.pathname+': '+(req.failure()?.errorText||'failed'));}catch{}});
    page.on('response',res=>{try{const u=new URL(res.url());if(u.hostname==='127.0.0.1' && res.status()>=400) httpLocal.push(u.pathname+': '+res.status());}catch{}});
    await page.route('**/homeeasy-page-guard.js*', r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.__HE_QA_GUARD__=true;'}));
    await page.route('**/script.google.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(genericApi)}));
    await page.route('**/script.googleusercontent.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(genericApi)}));
    let navError=null;
    try{
      await page.goto('http://127.0.0.1:4173/'+file+'?__qa=1',{waitUntil:'domcontentloaded',timeout:15000});
      await page.waitForTimeout(450);
    }catch(e){navError=String(e.message||e).split('\n')[0];}
    let state={};
    if(!navError){
      state=await page.evaluate(()=>{
        const bodyText=(document.body?.innerText||'').trim();
        const imgs=[...document.images].filter(i=>{const s=i.getAttribute('src')||'';return s && !/^(https?:|\/\/|data:|blob:)/i.test(s)});
        const brokenImgs=imgs.filter(i=>i.complete && i.naturalWidth===0).map(i=>i.getAttribute('src'));
        return {
          title:document.title,
          bodyLen:bodyText.length,
          rawIconText:bodyText,
          overflow:document.documentElement.scrollWidth > innerWidth + 2,
          brokenImgs,
          finalPath:location.pathname.split('/').pop(),
          finalSearch:location.search
        };
      });
    }
    const rawIcon=state.rawIconText ? rawIconRe.test(state.rawIconText) : false;
    const r={file,kind,viewport,pageErrors:[...new Set(pageErrors)],failedLocal:[...new Set(failedLocal)],httpLocal:[...new Set(httpLocal)],navError,title:state.title||'',bodyLen:state.bodyLen||0,rawIcon,overflow:!!state.overflow,brokenImgs:state.brokenImgs||[],finalPath:state.finalPath||''};
    results.push(r);
    await context.close();
    return r;
  }

  for(const file of all){
    const r=await runOne(file,{width:430,height:932},'mobile-all');
    const flags=[];
    if(r.navError) flags.push('NAV '+r.navError);
    if(r.pageErrors.length) flags.push('PAGEERROR '+r.pageErrors.join(' | '));
    if(r.failedLocal.length) flags.push('LOCAL_FAIL '+r.failedLocal.join(' | '));
    if(r.httpLocal.length) flags.push('LOCAL_HTTP '+r.httpLocal.join(' | '));
    if(r.rawIcon) flags.push('RAW_ICON_TEXT');
    if(r.overflow) flags.push('H_OVERFLOW');
    if(r.brokenImgs.length) flags.push('BROKEN_IMG '+r.brokenImgs.join(','));
    console.log((flags.length?'BROWSER_ISSUE ':'BROWSER_OK ')+file+(flags.length?' | '+flags.join(' ; '):''));
  }
  for(const file of [...production].sort()){
    if(!fs.existsSync(file)) continue;
    await runOne(file,{width:1440,height:1000},'desktop-production');
  }

  fs.writeFileSync('audit-html-browser.json',JSON.stringify({all,production:[...production].sort(),results},null,2));
  const prodResults=results.filter(r=>production.has(r.file));
  const prodBlockers=prodResults.filter(r=>r.navError||r.pageErrors.length||r.failedLocal.length||r.httpLocal.length||r.rawIcon||r.brokenImgs.length||(r.kind==='mobile-all'&&r.overflow));
  console.log('PRODUCTION_BLOCKERS='+prodBlockers.length);
  for(const r of prodBlockers) console.log('PROD_BLOCKER',r.file,r.kind,JSON.stringify(r));
  await browser.close();
  if(prodBlockers.length) process.exitCode=2;
})().catch(e=>{console.error(e);process.exit(1)});
