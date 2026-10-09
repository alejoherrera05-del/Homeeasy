'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const root=path.resolve(__dirname,'..');
const markup=fs.readFileSync(path.join(root,'cotizador-persianas.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'');
const source=fs.readFileSync(path.join(root,'homeeasy-cost-calculator.js'),'utf8');
const catalog=[{id:'onda-1',family:'onda',name:'Velo de prueba',method:'area',configurations:[],addons:[]}];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const item=(id,roomId,location,width,height)=>({
  id,roomId,location,width,height,quantity:'1',family:'onda',product:'onda-1',configuration:'standard',
  mode:'auto',manualCost:'',extras:'0',coverlight:'',addons:[],installation:{mount:'',control:'',opening:'',note:''}
});
const initial=JSON.stringify({
  version:2,project:'QA',items:[
    item('original','sala','Sala','1.25','1.75'),
    item('otra','sala','Sala','1.80','2.20'),
    item('tercera','habitacion','Habitación','0.95','1.20')
  ],transport:'0',installationTotal:'0',gain:'90',roundSale:false,promotions:true
});

async function mount(){
  const dom=new JSDOM(markup,{url:'https://hommy.homeeasy.com.co/cotizador-persianas.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window; const d=w.document;
  if(typeof w.crypto.randomUUID!=='function'){
    let sequence=0;
    Object.defineProperty(w.crypto,'randomUUID',{value:()=> 'qa-'+(++sequence)});
  }
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HomeEasyPageGuard={getStatus:()=> 'authorized'};
  w.HomeEasyAuth={getHomeEasyProfile:()=>({uid:'qa-user'})};
  w.localStorage.setItem('homeeasy.cost-draft.v2:qa-user',initial);
  let lastItems=[];
  w.fetch=async (_url,options)=>{
    const payload=JSON.parse(options.body);
    return {ok:true,json:async()=>{
      if(payload.tipo==='COSTOS_OPCIONES')return {status:'ok',products:catalog,version:'test',validThrough:'2026-12-31',currency:'COP'};
      if(payload.tipo!=='COSTOS_CALCULAR_COTIZACION')throw Error('Unexpected service request');
      lastItems=payload.items;
      const items=payload.items.map(entry=>({
        ok:Boolean(entry.width&&entry.height),unit:10000,total:10000*Number(entry.quantity||1),
        product:catalog[0],coverlightOptions:[],widthMm:Number(entry.width)*1000,heightMm:Number(entry.height)*1000
      }));
      return {status:'ok',quote:{ok:items.every(result=>result.ok),items,products:items.reduce((sum,x)=>sum+(x.ok?x.total:0),0),error:'Faltan medidas'}};
    }};
  };
  w.eval(source);
  await delay(80);
  return {dom,w,d,lastItems:()=>lastItems,save:()=>{
    w.dispatchEvent(new w.Event('pagehide'));
    return JSON.parse(w.localStorage.getItem('homeeasy.cost-draft.v2:qa-user'));
  }};
}
function click(d,selector){
  const el=d.querySelector(selector);assert.ok(el,'Missing '+selector);el.click();return el;
}
function active(d){
  const cards=d.querySelectorAll('.item-card.is-active');
  assert.equal(cards.length,1,'Exactly one item should be expanded');
  return cards[0];
}
function input(w,el,value){
  assert.ok(el);
  el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));
}

(async()=>{
  const {dom,w,d,lastItems,save}=await mount();

  assert.equal(d.querySelectorAll('.item-card').length,3);
  assert.equal(active(d).dataset.id,'original');
  assert.equal(d.querySelector('[data-id="otra"] .item-content').hidden,true);
  assert.match(d.querySelector('[data-id="otra"] .item-measure').textContent,/1.80 × 2.20/);
  assert.equal(d.querySelector('[data-id="otra"] [data-action="expand"]').getAttribute('aria-expanded'),'false');

  click(d,'[data-id="otra"] [data-action="expand"]');
  assert.equal(active(d).dataset.id,'otra');
  assert.equal(d.querySelector('[data-id="original"] .item-content').hidden,true);
  assert.equal(d.querySelector('[data-id="otra"] .item-content').hidden,false);
  assert.equal(save().items[0].width,'1.25');

  click(d,'[data-id="otra"] [data-action="duplicate"]');
  const copy=active(d),copyId=copy.dataset.id;
  assert.notEqual(copyId,'otra');
  assert.equal(d.querySelectorAll('.item-card').length,4);
  assert.match(copy.querySelector('.item-number').textContent,/Copia/);
  assert.match(copy.querySelector('.item-duplicate-review').textContent,/Verifica ancho y alto/);
  assert.equal(copy.querySelector('[data-field="width"]').value,'1.80');
  assert.equal(d.querySelector('[data-id="otra"] .item-content').hidden,true);
  await delay(100);
  assert.equal(lastItems().length,4,'Duplicating must immediately recalculate the quote');

  input(w,active(d).querySelector('[data-field="width"]'),'2.15');
  await delay(260);
  let snapshot=save();
  assert.equal(snapshot.items.find(x=>x.id==='otra').width,'1.80','Original dimensions cannot be changed by editing a copy');
  assert.equal(snapshot.items.find(x=>x.id===copyId).width,'2.15');
  assert.equal(snapshot.items.find(x=>x.id===copyId).height,'2.20');
  assert.equal(d.querySelector('[data-id="otra"] .item-measure').textContent,'1.80 × 2.20 m');

  click(d,'[data-id="'+copyId+'"] [data-action="confirm-measures"]');
  assert.equal(active(d).querySelector('.item-duplicate-review'),null);
  assert.equal(save().items.find(x=>x.id===copyId).measureReviewPending,false);

  click(d,'#review-measures');
  assert.equal(d.querySelector('#review-dialog').open,true);
  assert.equal(d.querySelectorAll('.review-row').length,4);
  assert.match(d.querySelector('#review-lines').textContent,/2.15 × 2.20 m/);
  click(d,'[data-review-id="original"]');
  assert.equal(d.querySelector('#review-dialog').open,false);
  assert.equal(active(d).dataset.id,'original');

  click(d,'[data-room-id="habitacion"] [data-action="add-room-item"]');
  const newLayer=active(d);
  assert.equal(newLayer.querySelector('[data-field="width"]').value,'','New layer must start with blank measures');
  assert.equal(newLayer.querySelector('[data-field="height"]').value,'');
  assert.equal(save().items.length,5);
  click(d,'[data-id="'+newLayer.dataset.id+'"] [data-action="remove"]');
  assert.equal(save().items.length,4);
  click(d,'#toast button');
  assert.equal(save().items.length,5);
  assert.equal(active(d).dataset.id,newLayer.dataset.id);

  dom.window.close();
  console.log('Cotizador: foco único, duplicación sin alterar original, recálculo, revisión, borrador y deshacer PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
