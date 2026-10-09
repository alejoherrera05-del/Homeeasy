import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const root=process.cwd();
const output=path.join(root,'qa','cotizacion-pdf');
fs.mkdirSync(output,{recursive:true});

const config={
 empresa:{
  nombre_comercial:'HOMEEASY POPAYÁN',nit:'1061760852-1',nit_formateado:'1.061.760.852-1',
  direccion:'Trav. 9 # 6N-26',ciudad:'Popayán',telefono:'3334319374',
  instagram:'@homeeasypopayan',web:'www.homeeasy.com.co'
 },
 documentos:{
  mostrar_email:false,mostrar_web:false,mostrar_instagram:true,
  cotizacion:{titulo:'COTIZACIÓN',validez_dias:'22',
   medicion_instalacion:'Medición e instalación según visita de HomeEasy.',
   forma_pago:'40% anticipo y saldo contra entrega.'},
  pie_principal:'HOMEEASY - VISTE TU HOGAR CON ESTILO',
  pie_sistema:'Documento generado automáticamente - Sistema Hommy V3.0'
 }
};
const descriptions=[
 'Sala · Onda Serena · Traslucente Kilim · 2,15 × 2,36 m',
 'Sala · Onda Serena · Traslucente Kilim · 1,14 × 2,36 m',
 'Habitación Guido · Onda Serena · Velo Knot White · 2,55 × 2,37 m',
 'Habitación Guido · Onda Serena · Black Out Felice (100% Blackout) · 2,55 × 2,37 m',
 'Habitación huésped · Onda Serena · Velo Knot White · 0,73 × 2,37 m',
 'Habitación huésped · Enrollable · Blackout Matte Básico 1.83 · 0,73 × 1,87 m',
 'Habitación principal · Onda Serena · Velo Knot White · 3,77 × 2,37 m',
 'Habitación principal · Onda Serena · Black Out Felice (100% Blackout) · 3,77 × 2,37 m',
 'Habitación Sofia · Onda Serena · Black Out Felice (100% Blackout) · 2,15 × 2,46 m',
 'Habitación Sofia · Onda Serena · Velo Knot White · 2,15 × 2,46 m',
 'Habitación Sofia · Onda Serena · Velo Knot White · 1,15 × 2,46 m',
 'Habitación Sofia · Onda Serena · Black Out Felice (100% Blackout) · 1,15 × 2,46 m',
 'Habitación Juan · Onda Serena · Velo Knot White · 3,78 × 2,44 m',
 'Habitación Juan · Onda Serena · Black Out Felice (100% Blackout) · 3,78 × 2,29 m'
];
const scenarios=[
 {label:'single',count:4,mode:'individual',notes:false,total:1570000},
 {label:'long-total',count:14,mode:'total',notes:true,total:19864000},
 {label:'long-individual',count:14,mode:'individual',notes:true,total:19864000}
];
function makeTransfer(s){
 const unit=Math.floor(s.total/s.count);
 const values=Array.from({length:s.count},(_,i)=>i===0?unit+s.total-unit*s.count:unit);
 return {
  version:1,createdAt:Date.now(),displayMode:s.mode,project:'QA no cliente real',
  totalPesos:s.total,items:values.map((price,i)=>({descripcion:descriptions[i],cantidad:1,precio:price})),
  observations:s.notes?'Detalles de instalación:\n'+descriptions.map((d,i)=>'- '+d+': instalación al techo, apertura '+(i%3===0?'a la derecha':i%3===1?'a los extremos':'a la izquierda')+'.').join('\n'):''
 };
}
const browser=await chromium.launch({headless:true});
const report=[];
try{
 for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,acceptDownloads:true});
  page.setDefaultTimeout(25000);
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e.message)));
  page.on('console',msg=>{if(msg.type()==='error')errors.push('Console: '+msg.text());});
  await page.addInitScript(({data,settings})=>{
   window.__QA_CONFIG=settings;
   window.sessionStorage.setItem('homeeasy.cost-to-formal.v1',JSON.stringify(data));
   const upstream=window.fetch.bind(window);
   window.fetch=async(input,init={})=>{
     const url=new URL(String(input),window.location.href);
     if(url.hostname==='script.google.com'){
       if(String(init.method||'GET').toUpperCase()==='POST'){
         window.__QA_POST=JSON.parse(init.body);
         window.__QA_PDF_BASE64=window.__QA_POST.pdfBase64;
         return new Response(JSON.stringify({status:'success'}),{status:200,headers:{'Content-Type':'application/json'}});
       }
       if(url.searchParams.has('nextCotizacion'))return new Response(JSON.stringify({status:'ok',nextCotizacion:46}));
       if(url.searchParams.has('init'))return new Response(JSON.stringify({status:'ok',clientes:[]}));
       return new Response(JSON.stringify({status:'ok',configuracion:window.__QA_CONFIG}));
     }
     return upstream(input,init);
   };
  },{data:makeTransfer(scenario),settings:config});
  await page.route('**/homeeasy-core.js*',r=>r.fulfill({
   status:200,contentType:'application/javascript',
   body:'window.HomeEasyCore={getConfiguration:async()=>({status:"ok",source:"network",version:4,configuracion:window.__QA_CONFIG})};'
  }));
  for(const stub of ['homeeasy-page-guard.js','homeeasy-runtime.js','homeeasy-runtime-cache.js','homeeasy-back.js','homeeasy-header.js']){
   await page.route('**/'+stub+'*',r=>r.fulfill({status:200,contentType:'application/javascript',body:'// inert only in isolated QA browser'}));
  }
  await page.route('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',r=>r.fulfill({
   status:200,contentType:'text/css',body:fs.readFileSync(require.resolve('bootstrap/dist/css/bootstrap.min.css'))
  }));
  await page.route('**/cdnjs.cloudflare.com/ajax/libs/html2canvas/**',r=>r.fulfill({
   status:200,contentType:'application/javascript',body:fs.readFileSync(require.resolve('html2canvas/dist/html2canvas.min.js'))
  }));
  await page.route('**/cdnjs.cloudflare.com/ajax/libs/jspdf/**',r=>r.fulfill({
   status:200,contentType:'application/javascript',body:fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'))
  }));
  await page.route('**/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',r=>r.fulfill({
   status:200,contentType:'text/css',body:fs.readFileSync(require.resolve('@fortawesome/fontawesome-free/css/all.min.css'))
  }));
  await page.route('**/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/*',r=>{
   const name=decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
   const file=path.join(root,'node_modules','@fortawesome','fontawesome-free','webfonts',name);
   if(fs.existsSync(file))return r.fulfill({status:200,body:fs.readFileSync(file)});
   return r.abort();
  });
  await page.route('**/fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:
   [300,400,500,600,700,800].map(weight=>'@font-face{font-family:Montserrat;src:url("http://127.0.0.1:4173/node_modules/@fontsource/montserrat/files/montserrat-latin-'+weight+'-normal.woff2") format("woff2");font-weight:'+weight+';}').join('\n')
  }));
  await page.goto('http://127.0.0.1:4173/cotizacion.html?from=cotizador',{waitUntil:'load',timeout:45000});
  await page.waitForTimeout(1800);
  const snapshot=await page.evaluate(()=>({
    readyState:document.readyState,
    rows:document.querySelectorAll('#tabla-body tr').length,
    hasDocs:Boolean(window.HomeEasyDocs),
    configLoaded:Boolean(window.HomeEasyDocs?.state?.config),
    documentType:window.HomeEasyDocs?.state?.documentType,
    loadingGuard:document.documentElement.classList.contains('homeeasy-docs-loading'),
    hasCore:Boolean(window.HomeEasyCore),
    hasFinalize:typeof finalizar==='function',
    bodySnippet:document.body.innerText.slice(0,180)
  }));
  console.log('Browser startup '+scenario.label+': '+JSON.stringify(snapshot)+'; JS errors='+JSON.stringify(errors));
  await page.waitForFunction(()=>document.querySelectorAll('#tabla-body tr').length>0 && !document.documentElement.classList.contains('homeeasy-docs-loading'));
  const initial=await page.evaluate(()=>({
   rows:document.querySelectorAll('#tabla-body tr').length,
   total:document.getElementById('total_val').innerText,
   mode:document.getElementById('area-pdf').classList.contains('quote-total-only')?'total':'individual',
   company:document.getElementById('empresa-info-header').innerText,
   commercial:document.getElementById('condiciones-comerciales').innerText,
   logo:document.querySelector('.logo-only').complete && document.querySelector('.logo-only').naturalWidth>0
  }));
  assert.equal(initial.rows,scenario.count,scenario.label+': all imported products');
  assert.equal(initial.mode,scenario.mode,scenario.label+': presentation mode');
  assert.equal(Number(initial.total.replace(/\D/g,'')),scenario.total,scenario.label+': totals');
  assert(initial.company.includes('1.061.760.852-1'),scenario.label+': company config');
  assert(initial.commercial.includes('22 días')&&initial.commercial.includes('40%'),scenario.label+': commercial config');
  assert(initial.logo,scenario.label+': official HomeEasy logo');
  await page.locator('#area-pdf').screenshot({path:path.join(output,scenario.label+'-preview.png')});
  await page.evaluate(()=>finalizar());
  await page.waitForFunction(()=>Boolean(window.__QA_PDF_BASE64),{timeout:60000});
  const submitted=await page.evaluate(()=>{
   const payload=window.__QA_POST;
   return {tipo:payload.tipo,rows:JSON.parse(payload.itemsJSON).length, total:Number(payload.total),base64:window.__QA_PDF_BASE64};
  });
  assert.equal(submitted.tipo,'cotizacion');
  assert.equal(submitted.rows,scenario.count);
  assert.equal(submitted.total,scenario.total);
  const file=path.join(output,scenario.label+'.pdf');
  fs.writeFileSync(file,Buffer.from(submitted.base64,'base64'));
  assert(fs.statSync(file).size>15000,'PDF must be nonempty');
  report.push({scenario:scenario.label,form:initial,pdfBytes:fs.statSync(file).size,pdf:file,errors});
  if(errors.length)console.log('Diagnostics '+scenario.label+': '+errors.join(' | ').slice(0,350));
  await page.close();
 }
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log('PDF regression report: '+JSON.stringify(report.map(r=>({scenario:r.scenario,bytes:r.pdfBytes,rows:r.form.rows,mode:r.form.mode,companyConfig:r.form.company.includes('1.061')})),null,2));
}finally{
 await browser.close();
}
