import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright';
const html=fs.readFileSync('clientes.html','utf8');
const script=html.match(/<script id="clientes-connected-v31-script">([\s\S]*?)<\/script>/)[1];
new Function(script);
const browser=await chromium.launch({headless:true});
const fixture={status:'found',cliente:{cedula:'QA-CLIENTE',nombre:'Cliente ficticio',telefono:'3000000000'},ordenes:[{numero_op:49,total:3920000,saldo:0,estado:'COMPLETADO',detalle:'Orden ficticia',abonos_detalle:[
  {recibo:'INICIAL',valor:2000000,tipoRegistro:'ABONO_INICIAL',estado:'ACTIVO'},
  {recibo:63,valor:1920000,fecha:'16/10/2026',url:'https://example.test/63.pdf',tipoRegistro:'RECIBO',estado:'ACTIVO',afectaCaja:true,afectaSaldo:true},
  {recibo:64,valor:1920000,fecha:'16/10/2026',url:'https://example.test/64.pdf',tipoRegistro:'RECIBO',estado:'ANULADO',afectaCaja:false,afectaSaldo:false}
]}],cotizaciones:[]};
let count=0;
function pass(label){console.log('PASS '+(++count)+' '+label)}
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    let file='';
    if(url.pathname.endsWith('/bootstrap.min.css'))file='node_modules/bootstrap/dist/css/bootstrap.min.css';
    else if(url.pathname.endsWith('/all.min.css'))file='node_modules/@fortawesome/fontawesome-free/css/all.min.css';
    else if(url.pathname.includes('/webfonts/'))file='node_modules/@fortawesome/fontawesome-free/webfonts/'+path.basename(url.pathname);
    else if(/\.(png|jpg)$/.test(url.pathname))file=path.basename(url.pathname);
    return file&&fs.existsSync(file)?r.fulfill({status:200,body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'image/png'}):r.fulfill({status:200,body:'',contentType:'text/plain'});
  });
  await page.goto('http://127.0.0.1/qa-clientes');
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await page.evaluate(()=>{
    document.getElementById('pantalla-inicio').style.display='none';
    document.getElementById('pantalla-resultados').style.display='block';
    window.QA={allowed:true,calls:[],dialogs:[],confirm:false,fail:false,previewFail:false,opens:0};
    window.HomeEasyAuth={hasPermission:()=>QA.allowed};
    window.Swal={fire:async opts=>{QA.dialogs.push({title:opts.title,text:opts.text});if(opts.input){QA.validator=[opts.inputValidator(''),opts.inputValidator('abc'),opts.inputValidator('Pago duplicado')];return{isConfirmed:QA.confirm,value:'Pago duplicado'}}return{isConfirmed:QA.confirm}}};
    window.fetch=async(url,init)=>{const body=JSON.parse(init.body);QA.calls.push(body);if(QA.fail&&body.tipo==='ANULAR_RECIBO')throw Error('Red interrumpida');return{json:async()=>body.tipo==='PREVISUALIZAR_ANULACION_RECIBO'?(QA.previewFail?{status:'error',msg:'Datos cambiaron'}:{status:'success',pagado:2000000,saldo:1920000,expectedRevision:'revision-qa'}):{status:'success'}}};
    window.abrirVisorPDF=()=>QA.opens++;
    window.buscarHistorial=async()=>{QA.refreshed=true};
  });
  await page.addScriptTag({content:"const URL_G='https://example.test/api';\n"+script});
  const render=async(data=fixture)=>{await page.evaluate(data=>window.__HomeEasyClientes31.render(data),data);await page.locator('.v31-history-toggle').click()};
  const menu=()=>page.getByRole('button',{name:'Opciones del recibo 63',exact:true});
  const action=()=>page.getByRole('button',{name:'Anular recibo',exact:true});
  await render();
  assert.equal(await page.locator('.v31-receipt-more').count(),1);pass('Solo recibo ACTIVO real; excluye inicial y anulado');
  await menu().click();assert(await action().isVisible());assert.equal(await page.evaluate(()=>QA.opens),0);pass('Menú discreto sin abrir el PDF');
  await page.keyboard.press('Escape');assert.equal(await menu().getAttribute('aria-expanded'),'false');assert(await menu().evaluate(e=>e===document.activeElement));pass('Escape cierra y devuelve foco');
  await menu().click();await action().click();
  assert.deepEqual(await page.evaluate(()=>QA.calls.map(c=>c.tipo)),['PREVISUALIZAR_ANULACION_RECIBO']);
  assert(await page.evaluate(()=>QA.validator[0]&&QA.validator[1]&&!QA.validator[2]));pass('Motivo obligatorio y cancelar no escribe');
  await page.evaluate(()=>{QA.confirm=true;QA.calls=[]});await menu().click();await action().click();await page.waitForFunction(()=>QA.refreshed);
  const calls=await page.evaluate(()=>QA.calls);assert.equal(calls[1].expectedRevision,'revision-qa');assert.equal(calls[1].cedula,'QA-CLIENTE');assert.equal(calls[1].numeroOP,'49');assert.equal(calls[1].numeroRecibo,63);assert(calls[1].confirmado&&calls[1].sinDevolucion);assert.equal(calls[0].requestId,calls[1].requestId);pass('Anulación autorizada con revisión, cliente/orden/recibo y refresco');
  await page.evaluate(()=>{QA.fail=true;QA.calls=[]});await menu().click();await action().click();await page.waitForFunction(()=>sessionStorage.getItem('homeeasy.recibo.anulacionPendiente'));
  await page.waitForFunction(()=>!document.querySelector('.v31-receipt-more').disabled);
  const pending=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('homeeasy.recibo.anulacionPendiente')));await page.evaluate(()=>QA.fail=false);await menu().click();await action().click();await page.waitForFunction(()=>!sessionStorage.getItem('homeeasy.recibo.anulacionPendiente'));
  const after=await page.evaluate(()=>QA.calls);assert.deepEqual(after.at(-1),pending);assert.equal(after.filter(c=>c.tipo==='PREVISUALIZAR_ANULACION_RECIBO').length,1);pass('Fallo de red: reintento conserva solicitud exacta e idempotencia');
  await page.evaluate(()=>{QA.previewFail=true;QA.calls=[]});await menu().click();await action().click();await page.waitForFunction(()=>!document.querySelector('.v31-receipt-more').disabled);assert.equal(await page.evaluate(()=>QA.calls.length),1);pass('Rechazo del servidor no envía anulación');
  await page.evaluate(()=>QA.allowed=false);await render();assert.equal(await page.locator('.v31-receipt-more').count(),0);pass('Sin permiso no se muestra acción');
  await page.evaluate(()=>{QA.allowed=true;QA.previewFail=false});await render();
  await page.screenshot({path:'../clientes-recibo-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await menu().click();assert(await action().isVisible());const bounds=await action().boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await page.screenshot({path:'../clientes-recibo-mobile.png',fullPage:true});pass('Menú móvil dentro del viewport y accesible');
  await page.keyboard.press('Escape');await page.locator('.v31-payment-left').nth(1).click();assert.equal(await page.evaluate(()=>QA.opens),1);pass('Apertura original del PDF conservada');
  console.log(count+' casos PASS; solo datos ficticios y red interceptada');
}finally{await browser.close()}
