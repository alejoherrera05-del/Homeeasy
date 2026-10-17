import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync('abono.html','utf8');
const start=html.indexOf('    var abonoRegistroEnCurso = false;');
const end=html.indexOf('    async function finalizarAbono()',start);
assert(start>=0 && end>start);
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext();
  await context.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>QA ficticio</title>'}));
  const pages=await Promise.all([context.newPage(),context.newPage()]);
  for(const p of pages){await p.goto('http://127.0.0.1:4173/qa-intento');await p.addScriptTag({content:'window.Swal={fire:async()=>({isConfirmed:false})};'+html.slice(start,end)})}
  const get=p=>p.evaluate(()=>obtenerIntentoAbono(['49','QA FICTICIO',100,'EFECTIVO',''],58));
  const [one,two]=await Promise.all(pages.map(get));
  assert.equal(one.requestId,two.requestId,'Dos pestañas deben compartir el mismo intento pendiente');
  await pages[0].reload();await pages[0].addScriptTag({content:html.slice(start,end)});
  assert.equal((await get(pages[0])).requestId,one.requestId,'La recarga conserva requestId');
  await pages[1].evaluate(({key,requestId})=>localStorage.setItem(key,JSON.stringify({requestId,numeroRecibo:58,estado:'registrado'})),one);
  assert.equal(await get(pages[1]),null,'Un pago confirmado no puede repetirse sin autorización explícita');
  await pages[1].evaluate(()=>{window.Swal.fire=async()=>({isConfirmed:true})});
  assert.notEqual((await get(pages[1])).requestId,one.requestId,'Otro pago real confirmado crea un intento distinto');
  console.log('PASS Chromium: dos pestañas simultáneas, recarga, reintento y autorización de otro pago real (4 escenarios)');
} finally {await browser.close()}
