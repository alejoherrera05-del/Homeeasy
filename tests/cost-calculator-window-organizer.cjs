const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'cotizador-persianas.html'),'utf8').replace(/<script\\b[\\s\\S]*?<\\/script>/gi,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const catalog=[
 {id:'sheer-test',family:'sheer',name:'Screen Prueba',method:'area'},
 {id:'onda-test',family:'onda',name:'Coral Prueba',method:'area'}
];
async function mount(saved){
 const dom=new JSDOM(html,{url:'https://hommy.homeeasy.com.co/cotizador-persianas.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.HomeEasyPageGuard={getStatus:()=> 'authorized'};
 w.HomeEasyAuth={getHomeEasyProfile:()=>({uid:'window-qa'})};
 if(saved)w.localStorage.setItem('homeeasy.cost-draft.v2:window-qa',saved);
 w.fetch=async(_url,opt)=>{
  const payload=JSON.parse(opt.body);
  if(payload.tipo==='COSTOS_OPCIONES')return {ok:true,json:async()=>({status:'ok',products:catalog,version:'test',currency:'COP',validThrough:'2026-12-31'})};
  const items=payload.items.map(i=>({
   ok:Boolean(i.width&&i.height),unit:100000,total:100000*Number(i.quantity||1),
   product:catalog.find(p=>p.id===i.product),coverlightOptions:[]}));
  return {ok:true,json:async()=>({status:'ok',quote:{ok:items.every(i=>i.ok),items,products:items.reduce((s,i)=>s+i.total,0)}})};
 };
 w.eval(fs.readFileSync(path.join(root,'homeeasy-cost-calculator.js'),'utf8'));
 await sleep(60);
 return {dom,w,d:w.document};
}
function input(w,element,value){assert.ok(element);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));}
(async()=>{
 const {dom,w,d}=await mount();
 assert.equal(d.querySelectorAll('.item-card').length,1);
 assert.equal(d.querySelectorAll('.item-card.is-expanded').length,1);
 const first=d.querySelector('.item-card');
 const originalId=first.dataset.id;
 input(w,first.querySelector('[data-field=width]'),'1,30');
 input(w,first.querySelector('[data-field=height]'),'1,70');
 await sleep(220);
 assert.match(d.querySelector('#review-count').textContent,/1 de 1/);
 first.querySelector('[data-action=duplicate]').click();
 await sleep(30);
 const cards=[...d.querySelectorAll('.item-card')];
 assert.equal(cards.length,2);
 assert.equal(cards[0].dataset.id,originalId);
 assert.ok(cards[0].classList.contains('is-collapsed'));
 assert.ok(cards[1].classList.contains('is-expanded'));
 assert.notEqual(cards[0].dataset.id,cards[1].dataset.id);
 assert.equal(cards[1].querySelector('[data-field=width]').value,'1,30');
 assert.equal(cards[1].querySelector('[data-field=height]').value,'1,70');
 assert.match(cards[1].textContent,/Copia de otra ventana/);
 input(w,cards[1].querySelector('[data-field=label]'),'Ventana balcón');
 input(w,cards[1].querySelector('[data-field=width]'),'1,50');
 assert.match(cards[1].querySelector('[data-window-name]').textContent,/Ventana balcón/);
 assert.match(cards[1].querySelector('[data-window-summary]').textContent,/1,50/);
 assert.equal(cards[0].querySelector('[data-field=width]').value,'1,30');
 d.querySelector('#review-toggle').click();
 assert.equal(d.querySelector('#review-toggle').getAttribute('aria-expanded'),'true');
 assert.equal(d.querySelectorAll('[data-review-id]').length,2);
 d.querySelector('[data-review-id="'+originalId+'"]').click();
 assert.equal(d.querySelectorAll('.item-card.is-expanded').length,1);
 assert.equal(d.querySelector('.item-card.is-expanded').dataset.id,originalId);
 w.dispatchEvent(new w.Event('pagehide'));
 const saved=w.localStorage.getItem('homeeasy.cost-draft.v2:window-qa');
 const stored=JSON.parse(saved);
 assert.equal(stored.items.length,2);
 assert.equal(stored.items[0].width,'1,30');
 assert.equal(stored.items[1].width,'1,50');
 assert.equal(stored.items[1].label,'Ventana balcón');
 dom.window.close();
 const again=await mount(saved);
 assert.equal(again.d.querySelectorAll('.item-card').length,2);
 assert.match(again.d.querySelectorAll('[data-window-name]')[1].textContent,/Ventana balcón/);
 again.dom.window.close();
 console.log('PASS: ventanas plegables, copia identificada, edición aislada, nombres, revisión y borrador');
})().catch(e=>{console.error(e);process.exitCode=1;});
