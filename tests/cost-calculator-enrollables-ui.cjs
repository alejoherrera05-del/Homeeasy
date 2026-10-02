const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'cotizador-persianas.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'');
const catalog=[{id:'old',family:'onda',name:'Referencia previa',method:'area'},{id:'black',family:'enrollable',name:'Blackout ficticio',type:'Blackout',method:'area',coverlight:[{id:'cover',name:'Coverlight ficticio'}]},{id:'screen',family:'enrollable',name:'Screen ficticio',type:'Screen',method:'area',coverlight:[]}];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mount(saved){
 const dom=new JSDOM(html,{url:'https://hommy.homeeasy.com.co/cotizador-persianas.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.HomeEasyPageGuard={getStatus:()=> 'authorized'};w.HomeEasyAuth={getHomeEasyProfile:()=>({uid:'qa'})};
 if(saved)w.localStorage.setItem('homeeasy.cost-draft.v2:qa',saved);
 let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
 w.fetch=async(_url,options)=>{const data=JSON.parse(options.body);return {ok:true,json:async()=>{
  if(data.tipo==='COSTOS_OPCIONES')return {status:'ok',products:catalog,version:'test',validThrough:'2026-10-31',currency:'COP'};
  const items=data.items.map(i=>({ok:!!i.width&&!!i.height,widthMm:Number(i.width)*1000,heightMm:Number(i.height)*1000,coverlightOptions:i.product==='black'?[{id:'cover',name:'Coverlight ficticio',costCents:Number(i.height)*2000}]:[],unit:10000+(i.coverlight?Number(i.height)*2000:0),total:(10000+(i.coverlight?Number(i.height)*2000:0))*Number(i.quantity),product:{...catalog.find(p=>p.id===i.product),coverlight:!!i.coverlight}}));
  const products=items.reduce((n,i)=>n+i.total,0);return {status:'ok',quote:{ok:items.every(i=>i.ok),items,products,installation:0,transport:0,cost:products}};
 }};};
 w.eval(fs.readFileSync(path.join(root,'homeeasy-cost-calculator.js'),'utf8'));await sleep(40);
 return {dom,w,getCopied:()=>copied};
}
function change(w,selector,value){const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));}
function input(w,selector,value){const el=w.document.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));}
(async()=>{
 const a=await mount(),w=a.w,d=w.document;
 change(w,'[data-field=family]','enrollable');assert.equal(d.querySelector('[data-field=configuration]'),null);
 assert.equal(d.querySelector('[data-action=manual-toggle]'),null);assert.equal(d.querySelector('.product-meta'),null);
 assert.equal(d.querySelector('[data-action=coverlight-toggle]'),null);
 input(w,'[data-field=width]','1');input(w,'[data-field=height]','1');await sleep(250);
 const toggle=d.querySelector('[data-action=coverlight-toggle]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(250);
 assert.match(d.querySelector('[data-field=coverlight]').textContent,/20/);
 input(w,'#installation','50');input(w,'#transport','25');input(w,'#gain','90');await sleep(30);
 // 120 + 50 + 25 = 195; 90% ganancia = 370.5, moneda muestra 371.
 assert.match(d.querySelector('#sum-cost').textContent,/195/);assert.match(d.querySelector('#sum-sale').textContent,/371/);
 d.querySelector('#copy-sale').click();await sleep(20);assert.match(a.getCopied(),/con Coverlight/);assert.doesNotMatch(a.getCopied(),/195|120|Costo Coverlight/);
 w.dispatchEvent(new w.Event('pagehide'));const saved=w.localStorage.getItem('homeeasy.cost-draft.v2:qa');assert.ok(JSON.parse(saved).items[0].coverlight);
 const b=await mount(saved);assert.equal(b.w.document.querySelector('[data-action=coverlight-toggle]').checked,true);b.dom.window.close();
 input(w,'[data-field=height]','2');assert.equal(d.querySelector('[data-action=coverlight-toggle]'),null);await sleep(250);
 assert.match(d.querySelector('[data-field=coverlight]').textContent,/40/);
 change(w,'[data-field=product]','screen');assert.equal(d.querySelector('[data-action=manual-toggle]'),null);await sleep(250);assert.equal(d.querySelector('[data-action=coverlight-toggle]'),null);
 change(w,'[data-field=family]','onda');assert.equal(d.querySelector('[data-field=product]').value,'old');assert.equal(d.querySelector('[data-field=configuration]'),null);
 a.dom.window.close();console.log('Cotizador UI: Coverlight, borrador, cambio de referencia, instalación, transporte, ganancia y WhatsApp OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
