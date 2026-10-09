import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const root=process.cwd();
const output=path.join(root,'qa','pedido-pdf');
fs.mkdirSync(output,{recursive:true});

const config={
 empresa:{
  nombre_comercial:'HOMEEASY POPAYÁN',nit:'1061760852-1',nit_formateado:'1.061.760.852-1',
  direccion:'Trav. 9 # 6N-26',ciudad:'Popayán',telefono:'3334319374',
  instagram:'@homeeasypopayan',web:'www.homeeasy.com.co'
 },
 documentos:{
  mostrar_email:false,mostrar_web:false,mostrar_instagram:true,
  pedido:{titulo:'ORDEN DE PEDIDO', garantia_anios:'3', entrega_dias_habiles:'12', condicion_saldo:'Se cancela contra entrega e instalación.', instalacion:'Incluida en el valor total pactado.'},
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
 {label:'mobile-short',count:4,total:1570000,discount:70000,deposit:600000,notes:false,viewport:{width:390,height:844}},
 {label:'mobile-long',count:14,total:19864000,discount:164000,deposit:4864000,notes:true,viewport:{width:390,height:844}},
 {label:'desktop-long',count:14,total:19864000,discount:164000,deposit:4864000,notes:true,viewport:{width:1280,height:850}},
 {label:'mobile-extended',count:28,total:27280000,discount:280000,deposit:7280000,notes:true,viewport:{width:390,height:844}}
];
const browser=await chromium.launch({headless:true});
const report=[];
try{
 for(const scenario of scenarios){
  const page=await browser.newPage({viewport:scenario.viewport,deviceScaleFactor:1,acceptDownloads:true});
  page.setDefaultTimeout(25000);
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e.message)));
  page.on('console',msg=>{if(msg.type()==='error')errors.push('Console: '+msg.text());});
  await page.addInitScript(({settings})=>{
   window.__QA_CONFIG=settings;
   const upstream=window.fetch.bind(window);
   window.fetch=async(input,init={})=>{
     const url=new URL(String(input),window.location.href);
     if(url.hostname==='script.google.com'){
       if(String(init.method||'GET').toUpperCase()==='POST'){
         window.__QA_POST=JSON.parse(init.body);
         window.__QA_PDF_BASE64=window.__QA_POST.pdfBase64;
         return new Response(JSON.stringify({status:'success'}),{status:200,headers:{'Content-Type':'application/json'}});
       }
       if(url.searchParams.has('nextPedido'))return new Response(JSON.stringify({status:'ok',nextPedido:174}));
       if(url.searchParams.has('init'))return new Response(JSON.stringify({status:'ok',clientes:[]}));
       return new Response(JSON.stringify({status:'ok',configuracion:window.__QA_CONFIG}));
     }
     return upstream(input,init);
   };
  },{settings:config});
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
  await page.goto('http://127.0.0.1:4173/pedido.html',{waitUntil:'load',timeout:45000});
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
  console.log('Order browser startup '+scenario.label+': '+JSON.stringify(snapshot)+'; JS errors='+JSON.stringify(errors));
  await page.waitForFunction(()=>document.querySelectorAll('#tabla-body tr').length>0 && !document.documentElement.classList.contains('homeeasy-docs-loading'));
  await page.evaluate(({scenario,descriptions})=>{
    for(let i=1;i<scenario.count;i++)agregarFila();
    const rows=[...document.querySelectorAll('#tabla-body tr')];
    const gross=scenario.total+scenario.discount;
    const unit=Math.floor(gross/scenario.count);
    rows.forEach((row,i)=>{
      row.querySelector('.row-desc').value=descriptions[i%descriptions.length];
      row.querySelector('.cant').value='1';
      row.querySelector('.precio').value=String(i===0?unit+gross-unit*scenario.count:unit);
    });
    document.getElementById('descuento_input').value=String(scenario.discount);
    document.getElementById('abono').value=String(scenario.deposit);
    document.getElementById('notas').value=scenario.notes
      ? 'Observaciones de fabricación:\n'+rows.map((_,i)=>'- '+descriptions[i%descriptions.length]+': verificar apertura, accionamiento, soporte y montaje al techo en ambiente '+(i+1)+'.').join('\n')
      : 'Entrega según condiciones acordadas.';
    document.getElementById('cedula').value='900123456';
    document.getElementById('nombre').value='CLIENTE FICTICIO QA';
    document.getElementById('telefono').value='3000000000';
    document.getElementById('email').value='prueba@example.test';
    document.getElementById('direccion').value='DIRECCIÓN SIMULADA';
    calcular();
  },{scenario,descriptions});
  const initial=await page.evaluate(()=>({
   rows:document.querySelectorAll('#tabla-body tr').length,
   subtotal:Number(document.getElementById('subtotal_val').innerText.replace(/\D/g,'')),
   total:Number(document.getElementById('total_pedido_val').innerText.replace(/\D/g,'')),
   balance:Number(document.getElementById('saldo_pendiente_val').innerText.replace(/\D/g,'')),
   company:document.getElementById('empresa-info-header').innerText,
   commercial:document.getElementById('pedido-condiciones').innerText,
   logo:document.querySelector('.logo-only').complete && document.querySelector('.logo-only').naturalWidth>0
  }));
  assert.equal(initial.rows,scenario.count,scenario.label+': products not lost');
  assert.equal(initial.subtotal,scenario.total+scenario.discount,scenario.label+': subtotal');
  assert.equal(initial.total,scenario.total,scenario.label+': total');
  assert.equal(initial.balance,scenario.total-scenario.deposit,scenario.label+': balance');
  assert(initial.company.includes('1.061.760.852-1'),scenario.label+': dynamic company settings');
  assert(initial.commercial.includes('12 días')&&initial.commercial.includes('3 años'),scenario.label+': dynamic sales conditions');
  assert(initial.logo,scenario.label+': original HomeEasy logo');
  await page.locator('#area-pdf').screenshot({path:path.join(output,scenario.label+'-preview.png')});
  page.on('dialog',async dialog=>{errors.push('Dialog: '+dialog.message());await dialog.dismiss();});
  await page.waitForFunction(()=>Boolean(window.html2canvas));
  // Diagnóstico solo en la prueba: mide el DOM clonado; NO modifica pedido.html.
  await page.evaluate(()=>{
    const original=window.html2canvas;
    window.html2canvas=(element,opts)=>{
      const oldClone=opts.onclone;
      function measure(doc) {
        const area=doc.getElementById('area-pdf');
        if(!area)return null;
        const origin=area.getBoundingClientRect().top;
        const box=(sel)=>{
          const el=area.querySelector(sel);
          if(!el)return null;
          const r=el.getBoundingClientRect();
          return {top:Math.round(r.top-origin),bottom:Math.round(r.bottom-origin),height:Math.round(r.height),scrollHeight:el.scrollHeight};
        };
        return {area:box('#area-pdf'),areaHeight:Math.round(area.getBoundingClientRect().height),body:box('.card-body'),header:box('.header-brand'),title:box('.document-type'),finance:box('.finance-box'),footer:box('.pdf-footer'),summary:box('.row.g-4.mt-auto'),notes:box('#notas'),pages:area.dataset.pdfSmartPages,spacers:area.querySelectorAll('.pdf-smart-page-spacer').length,tail:area.querySelectorAll('.pdf-smart-page-tail').length};
      }
      return Promise.resolve(original(element,{...opts,onclone(doc){
        const before=measure(doc);
        oldClone(doc);
        window.__HEOrderTrace={before,after:measure(doc)};
      }})).then(canvas=>{
        const heightPerPage=canvas.width*279.4/215.9;
        const count=Math.ceil((canvas.height-1)/heightPerPage);
        const sample=document.createElement('canvas');sample.width=95;sample.height=125;
        const ctx=sample.getContext('2d',{willReadFrequently:true});
        const density=[];
        for(let i=0;i<count;i++){
          const top=i*heightPerPage;
          const region=Math.min(heightPerPage,canvas.height-top);
          if(region<=0)break;
          ctx.fillStyle='#fff';ctx.fillRect(0,0,95,125);
          ctx.drawImage(canvas,0,top,canvas.width,region,0,0,95,125*(region/heightPerPage));
          const bytes=ctx.getImageData(0,0,95,125).data;
          let nonwhite=0;
          for(let p=0;p<bytes.length;p+=4){
            if(bytes[p]<230||bytes[p+1]<230||bytes[p+2]<230)nonwhite++;
          }
          density.push(Number((nonwhite/(95*125)).toFixed(4)));
        }
        window.__HEPageOccupancy=density;
        return canvas;
      });
    };
  });
  await page.locator('#btnProcesar').scrollIntoViewIfNeeded();
  const scrollBefore=await page.evaluate(()=>window.scrollY);
  console.log('Click export at scrollY='+scrollBefore+' for '+scenario.label);
  await page.locator('#btnProcesar').click();
  await page.waitForTimeout(2200);
  console.log('Order PDF completion '+scenario.label+': '+JSON.stringify(await page.evaluate(()=>({
    pdfWritten:Boolean(window.__QA_PDF_BASE64),
    hasCanvas:Boolean(window.html2canvas),
    hasJsPdf:Boolean(window.jspdf),
    loading:document.getElementById('loading')?.style.display,
    exportMode:document.getElementById('area-pdf')?.classList.contains('pdf-export-mode'),
    printLayout:window.__HEOrderTrace||null
  })))+'; errors='+JSON.stringify(errors));
  await page.waitForFunction(()=>Boolean(window.__QA_PDF_BASE64),null,{timeout:12000});
  const submitted=await page.evaluate(()=>{
   const payload=window.__QA_POST;
   return {tipo:payload.tipo,rows:JSON.parse(payload.itemsJSON).length,total:Number(payload.valorTotal),deposit:Number(payload.abonoInicial),filename:payload.nombreArchivo,base64:window.__QA_PDF_BASE64};
  });
  assert.equal(submitted.tipo,'pedido');
  assert.equal(submitted.rows,scenario.count);
  assert.equal(submitted.total,scenario.total);
  assert.equal(submitted.deposit,scenario.deposit);
  assert.match(submitted.filename,/^Orden_N_\d+_900123456\.pdf$/);
  const file=path.join(output,scenario.label+'.pdf');
  const pdfBytes=Buffer.from(submitted.base64,'base64');
  fs.writeFileSync(file,pdfBytes);
  assert(pdfBytes.length>15000,'PDF must be nonempty');
  const pageCount=(pdfBytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
  assert(pageCount>0,'Valid jsPDF page count required');
  if(scenario.count===4)assert.equal(pageCount,1,'Short orders must fit a single branded page');
  if(scenario.count===14)assert(pageCount>=2&&pageCount<=3,'Fourteen-item orders should have no orphan extra page');
  if(scenario.count===28)assert(pageCount>=3&&pageCount<=4,'Extended order pagination must stay within four pages');
  const density=await page.evaluate(()=>window.__HEPageOccupancy||[]);
  console.log('Order PDF page occupancy '+scenario.label+': '+JSON.stringify(density));
  // Tolerancia del muestreo reducido: el pie aislado tiene menos del 4 % de tinta.
  if(pageCount>1)assert((density[pageCount-1]||0)>0.04,'Last page cannot contain only the footer');
  const after=await page.evaluate(()=>({
   exportMode:document.getElementById('area-pdf').classList.contains('pdf-export-mode'),
   width:document.getElementById('area-pdf').style.width,
   margin:document.getElementById('area-pdf').style.margin,
   pdfLogo:document.querySelector('.logo-only').naturalWidth>0
  }));
  assert.equal(after.exportMode,false,'Original on-screen appearance must be restored');
  assert.notEqual(after.width,'800px','Mobile/desktop order cannot remain stretched after export');
  assert(after.pdfLogo,'Original logo must remain');
  assert.equal(errors.length,0,'Browser errors during export');
  report.push({scenario:scenario.label,form:initial,pdfBytes:pdfBytes.length,pdfPages:pageCount,pdf:file,errors});
  if(errors.length)console.log('Diagnostics '+scenario.label+': '+errors.join(' | ').slice(0,350));
  await page.close();
 }
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 console.log('Order PDF regression report: '+JSON.stringify(report.map(r=>({scenario:r.scenario,bytes:r.pdfBytes,rows:r.form.rows,balance:r.form.balance,companyConfig:r.form.company.includes('1.061')})),null,2));
}finally{
 await browser.close();
}
