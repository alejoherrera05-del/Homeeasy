import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = process.cwd();
const output = path.join(root, 'qa', 'abono-pdf');
fs.mkdirSync(output, { recursive: true });

const config = {
  empresa: { nombre_comercial:'HOMEEASY POPAYÁN', nit:'1061760852-1', nit_formateado:'1.061.760.852-1',
    direccion:'Trav. 9 # 6N-26', ciudad:'Popayán', telefono:'3334319374',
    instagram:'@homeeasypopayan', web:'www.homeeasy.com.co' },
  documentos: { mostrar_email:false, mostrar_web:false, mostrar_instagram:true,
    recibo:{titulo:'RECIBO DE ABONO'},
    pie_principal:'HOMEEASY - VISTE TU HOGAR CON ESTILO',
    pie_sistema:'Documento generado automáticamente - Sistema Hommy V3.0' }
};
const cases = [
  { label:'mobile-first', webEnabled:true, viewport:{width:390,height:844}, history:0, initial:300000, payment:150000, concept:'' },
  { label:'mobile-history', webEnabled:false, viewport:{width:390,height:844}, history:9, initial:300000, payment:700000, concept:'Abono para fabricación e instalación de persianas.' },
  { label:'desktop-long', webEnabled:true, viewport:{width:1280,height:850}, history:23, initial:300000, payment:150000, concept:'Confirmación de abono por transferencia. Información validada en la orden 174.' },
  { label:'mobile-many', webEnabled:false, viewport:{width:390,height:844}, history:40, initial:300000, payment:300000, concept:'Abono aplicado según acuerdo comercial, con historial completo.' },
  { label:'mobile-paid', webEnabled:true, viewport:{width:390,height:844}, history:4, initial:300000, payment:1960000, concept:'Pago final de la orden. Paz y salvo.' },
  { label:'capture-failure', webEnabled:true, viewport:{width:390,height:844}, history:3, initial:300000, payment:100000, concept:'Prueba de error de captura', failure:true }
];
const totalOrder = 2300000;
const browser = await chromium.launch({ headless:true });
const report = [];
try {
 for(const scenario of cases){
   const page = await browser.newPage({ viewport:scenario.viewport, deviceScaleFactor:1, acceptDownloads:true });
   page.setDefaultTimeout(30000);
   const errors=[],dialogs=[];
   page.on('pageerror',e=>errors.push(String(e.message)));
   page.on('console',m=>{if(m.type()==='error')errors.push('Console: '+m.text())});
   page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});
   const historical=Array.from({length:scenario.history},(_,i)=>({recibo:400+i,fecha:'1/10/2026',valor:'10000'}));
   const expectedPending=totalOrder-scenario.initial-scenario.history*10000;
   if(scenario.label==='mobile-paid')scenario.payment=expectedPending;
   await page.addInitScript(({settings,history,initial,totalOrder,pending})=>{
     window.__QA_CONFIG=settings;
     window.__QA_POST=null;
     const native=window.fetch.bind(window);
     window.fetch=async(input,opts={})=>{
       const url=new URL(String(input),window.location.href);
       if(url.hostname==='script.google.com'){
         if(String(opts.method||'GET').toUpperCase()==='POST'){
           window.__QA_POST=JSON.parse(opts.body);
           return new Response(JSON.stringify({status:'success'}),{status:200,headers:{'Content-Type':'application/json'}});
         }
         if(url.searchParams.has('nextRecibo'))return new Response(JSON.stringify({status:'ok',nextRecibo:612}));
         if(url.searchParams.get('tipo')==='HISTORIAL_ABONOS')return new Response(JSON.stringify({
           status:'ok',abonoInicial:String(initial),fechaOrden:'1/10/2026',totalOrden:String(totalOrder),abonos:history
         }));
         if(url.searchParams.get('tipo')==='VERIFICAR_SALDO')return new Response(JSON.stringify({status:'ok',saldoReal:String(pending)}));
         if(url.searchParams.get('init')==='LOAD'){
           const row=[];row[1]=174;row[2]='900123456';row[3]='CLIENTE FICTICIO QA';row[6]=totalOrder;row[17]=pending;
           return new Response(JSON.stringify({status:'ok',ordenes:[[],row]}));
         }
         return new Response(JSON.stringify({status:'ok',configuracion:window.__QA_CONFIG}));
       }
       return native(input,opts);
     };
   },{settings:{...config,documentos:{...config.documentos,mostrar_web:scenario.webEnabled}},history:historical,initial:scenario.initial,totalOrder,pending:expectedPending});
   await page.route('**/homeeasy-core.js*',route=>route.fulfill({
     status:200,contentType:'application/javascript',
     body:'window.HomeEasyCore={getConfiguration:async()=>{if(!window.__QA_GUARD_INSTALLED)throw Error("QA_CONFIG_CALLED_BEFORE_AUTH_GUARD");return {status:"ok",source:"network",version:4,configuracion:window.__QA_CONFIG};}};'
   }));
   await page.route('**/homeeasy-page-guard.js*',route=>route.fulfill({
     status:200,contentType:'application/javascript',body:'window.__QA_GUARD_INSTALLED=true;'
   }));
   for(const stub of ['homeeasy-back.js','homeeasy-header.js'])
     await page.route('**/'+stub+'*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'// disabled in isolated browser QA'}));
   await page.route('**/sweetalert2@11*',route=>route.fulfill({
     status:200,contentType:'application/javascript',
     body:'window.Swal={fire:async()=>({isConfirmed:true}),close:()=>{},showLoading:()=>{}};'
   }));
   await page.route('https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',route=>route.fulfill({
     status:200,contentType:'text/css',body:fs.readFileSync(require.resolve('bootstrap/dist/css/bootstrap.min.css'))
   }));
   await page.route('**/cdnjs.cloudflare.com/ajax/libs/html2canvas/**',route=>route.fulfill({
     status:200,contentType:'application/javascript',body:fs.readFileSync(require.resolve('html2canvas/dist/html2canvas.min.js'))
   }));
   await page.route('**/cdnjs.cloudflare.com/ajax/libs/jspdf/**',route=>route.fulfill({
     status:200,contentType:'application/javascript',body:fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'))
   }));
   await page.route('**/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',route=>route.fulfill({
     status:200,contentType:'text/css',body:fs.readFileSync(require.resolve('@fortawesome/fontawesome-free/css/all.min.css'))
   }));
   await page.route('**/cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/*',route=>{
     const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
     const file=path.join(root,'node_modules','@fortawesome','fontawesome-free','webfonts',name);
     return fs.existsSync(file)?route.fulfill({status:200,body:fs.readFileSync(file)}):route.abort();
   });
   await page.route('**/fonts.googleapis.com/**',route=>route.fulfill({
     status:200,contentType:'text/css',body:[300,400,500,600,700,800].map(weight=>
       '@font-face{font-family:Montserrat;src:url("http://127.0.0.1:4173/node_modules/@fontsource/montserrat/files/montserrat-latin-'+weight+'-normal.woff2") format("woff2");font-weight:'+weight+';}').join('\n')
   }));
   await page.goto('http://127.0.0.1:4173/abono.html',{waitUntil:'load',timeout:45000});
   await page.waitForFunction(()=>Boolean(window.HomeEasyDocs?.state?.config)&&typeof finalizarAbono==='function'&&document.getElementById('n_recibo_display').innerText==='612');
   assert(await page.evaluate(()=>window.__QA_GUARD_INSTALLED===true),
     'Session/auth bridge must load before the configuration request');
   await page.locator('#numeroOP').fill('174');
   await page.evaluate(()=>buscarOrden());
   await page.waitForFunction(count=>document.getElementById('seccion_historial').style.display==='block'&&document.querySelectorAll('#tbody_pagos tr').length===count,
       (scenario.initial?1:0)+scenario.history);
   const loaded=await page.evaluate(()=>({
     company:document.getElementById('empresa-info-header').innerText,
     footer:document.getElementById('footer-creds').innerText,
     pending:Number(saldoBase),
     totalPaid:Number(ordenActual.totalPagadoPrevio),
     name:document.getElementById('nombre').value,
     currentHistory:document.querySelectorAll('#tbody_pagos tr').length
   }));
   assert(loaded.company.includes('1.061.760.852-1'),'Company settings did not load');
   assert.equal(loaded.company.includes('www.homeeasy.com.co'),scenario.webEnabled,
     'Receipt should honor saved Show Website toggle: '+scenario.label);
   assert(loaded.footer.includes('HOMEEASY'),'Footer config not applied');
   assert.equal(loaded.pending,expectedPending,'Outstanding balance wrong when Sheets returns payment strings');
   assert.equal(loaded.totalPaid,scenario.initial+scenario.history*10000,'Payment history total wrong');
   assert.equal(loaded.name,'CLIENTE FICTICIO QA');
   await page.locator('#valorAbono').fill(String(scenario.payment));
   await page.locator('#medioPago').selectOption('TRANSFERENCIA');
   await page.locator('#conceptoAbono').fill(scenario.concept);
   await page.evaluate(()=>calcularSaldo());
   const expectedFinal=expectedPending-scenario.payment;
   assert.equal(await page.evaluate(()=>Number(document.getElementById('nuevo_saldo_val').innerText.replace(/\D/g,''))),expectedFinal);
   if(expectedFinal===0)assert.equal(await page.locator('#paz-salvo-banner').evaluate(el=>getComputedStyle(el).display),'block');
   await page.waitForFunction(()=>Boolean(window.html2canvas));
   await page.evaluate(()=>{
     const fn=window.html2canvas;
     window.html2canvas=(element,options)=>{
       window.__QA_CAPTURE_OPTS={width:options.width,scrollY:options.scrollY,scrollX:options.scrollX,
         x:options.x||0,y:options.y||0,height:options.height||null};
       const originalClone=options.onclone;
       return Promise.resolve(fn(element,{...options,onclone(doc){
         originalClone(doc);
         const area=doc.getElementById('area-pdf');
         window.__QA_CLONE_HEIGHT=area.getBoundingClientRect().height;
         window.__QA_CLONE_ROWS=doc.querySelectorAll('#tbody_pagos tr').length;
         window.__QA_CLONE_VALUE=doc.getElementById('abono_dest_valor').innerText;
         window.__QA_CLONE_HEADER=doc.getElementById('empresa-info-header').innerText;
       }})).then(canvas=>{
         window.__QA_CANVAS={width:canvas.width,height:canvas.height};
         return canvas;
       });
     };
   });
   await page.locator('button[onclick="finalizarAbono()"]').scrollIntoViewIfNeeded();
   const scrollBefore=await page.evaluate(()=>window.scrollY);
   if(scenario.failure)await page.evaluate(()=>{window.html2canvas=async()=>{throw new Error('QA_CAPTURE_FAILURE')}});
   await page.locator('button[onclick="finalizarAbono()"]').click();
   if(scenario.failure){
     await page.waitForFunction(()=>document.getElementById('loading').style.display==='none');
     const recovery=await page.evaluate(()=>({value:document.getElementById('valorAbono').value,
       width:document.getElementById('area-pdf').style.width,
       inputs:document.getElementById('inputs_abono').style.display,
       highlight:document.getElementById('abono_destacado').style.display,
       rows:document.querySelectorAll('#tbody_pagos tr').length,
       posted:Boolean(window.__QA_POST)}));
     assert(!recovery.posted,'A failed screenshot cannot register a payment');
     assert.equal(recovery.width,'','Original receipt layout should be restored after exception');
     assert.notEqual(recovery.inputs,'none','Payment input should be accessible after error');
     assert.equal(recovery.highlight,'none','Staged receipt must be cleared after error');
     assert.equal(recovery.rows,loaded.currentHistory,'Staged payments must be rolled back');
     assert(dialogs.some(m=>m.includes('QA_CAPTURE_FAILURE')),'Expected capture failure warning');
     report.push({label:scenario.label,pass:true,recovery});
     await page.close();continue;
   }
   await page.waitForFunction(()=>Boolean(window.__QA_POST),null,{timeout:25000});
   const capture=await page.evaluate(()=>({payload:window.__QA_POST,canvas:window.__QA_CANVAS,
     opts:window.__QA_CAPTURE_OPTS,cloneHeight:window.__QA_CLONE_HEIGHT,cloneRows:window.__QA_CLONE_ROWS,
     cloneValue:window.__QA_CLONE_VALUE,cloneHeader:window.__QA_CLONE_HEADER,origWidth:document.getElementById('area-pdf').style.width,
     inputVisible:document.getElementById('inputs_abono').style.display,
     bodyPadding:document.body.style.padding,logo:document.querySelector('.logo-only').naturalWidth>0}));
   const p=capture.payload;
   assert.equal(p.tipo,'abono');assert.equal(String(p.numeroOP),'174');
   assert.equal(p.cedula,'900123456');assert.equal(p.valorAbono,scenario.payment);
   assert.equal(p.medioPago,'TRANSFERENCIA');assert.equal(p.concepto,scenario.concept);
   assert.match(p.nombreArchivo,/^Recibo_N_612_OP_174\.pdf$/);
   assert.equal(capture.opts.width,450);assert.equal(capture.opts.scrollY,0);
   assert.equal(capture.opts.scrollX,0);assert.equal(capture.opts.height,null);
   assert.equal(capture.canvas.width,1350,'Voucher width must match 450px x3');
   assert(capture.canvas.height>=capture.cloneHeight*2.9,'Complete receipt height must be captured');
   assert.equal(capture.cloneRows,loaded.currentHistory+3,'Current payment, total and balance rows must be present in PDF');
   assert(capture.cloneValue.includes(scenario.payment.toLocaleString('es-CO')),'Highlighted payment must be in PDF');
   assert.equal(capture.cloneHeader.includes('www.homeeasy.com.co'),scenario.webEnabled,
     'PDF capture must reflect website visibility: '+scenario.label);
   assert.equal(capture.origWidth,'','Receipt UI must return to original width');
   assert.notEqual(capture.inputVisible,'none','Receipt inputs must return after capture');
   assert(capture.logo,'Corporate logo missing');
   assert(errors.length===0,'Browser errors '+errors.join('; '));
   const bytes=Buffer.from(p.pdfBase64,'base64');
   assert(bytes.length>15000,'PDF empty');
   const count=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
   assert.equal(count,1,'Voucher must be a continuous PDF for the tested payment history');
   const pdfPath=path.join(output,scenario.label+'.pdf');
   fs.writeFileSync(pdfPath,bytes);
   report.push({label:scenario.label,pass:true,history:scenario.history,pdfBytes:bytes.length,
      canvas:capture.canvas,cloneHeight:capture.cloneHeight,scrollBefore,expectedFinal,filename:p.nombreArchivo});
   console.log('Receipt QA '+scenario.label+': '+JSON.stringify(report.at(-1)));
   await page.close();
 }
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log('Receipt PDF QA summary: '+JSON.stringify(report.map(x=>({name:x.label,pass:x.pass,height:x.canvas?.height||null}))));
}finally{await browser.close()}
