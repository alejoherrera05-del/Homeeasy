(function(){
'use strict';

const $=id=>document.getElementById(id);
const API_URL=String(window.HomeEasyCore&&window.HomeEasyCore.API_URL||'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');
const familyLabels={onda:'Onda Serena',panel:'Panel Japonés',sheer:'Sheer Elegance',vertesse:'Sheer Vertesse',vertical:'Verticales'};
const familyOrder=['onda','sheer','vertesse','panel','vertical'];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cop=cents=>'COP $'+new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Math.round((Number(cents)||0)/100));
const formatPesos=raw=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Number(String(raw||'0').replace(/\D/g,''))||0);
const rawPesos=value=>String(value??'').replace(/\D/g,'').replace(/^0+(?=\d)/,'')||'0';
const clampGain=value=>{
  const n=Number(value);
  if(!Number.isFinite(n))return 90;
  return Math.max(10,Math.min(100,Math.round(n/10)*10));
};
const fresh=()=>({version:2,project:'',items:[],transport:'0',installationTotal:'0',gain:'90',promotions:true});

let state=fresh(),catalog=null,lastEngineQuote=null,lastEngineSignature='',lastQuote=null,key='',engineCacheKey='',ready=false,loading=false;
let saveTimer,toastTimer,undoItem,quoteTimer,requestSeq=0;

function toast(message){
  $('toast').textContent=message;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').textContent='',3500);
}

function setSaveLabel(text){
  const box=$('save-state');
  if(!box)return;
  const label=box.querySelector('span');
  if(label)label.textContent=text;
  else box.textContent=text;
}

function saveNow(){
  if(!key)return;
  clearTimeout(saveTimer);
  try{
    localStorage.setItem(key,JSON.stringify(state));
    setSaveLabel('Guardado');
  }catch(e){
    setSaveLabel('Sin guardar');
  }
}

function save(){
  if(!key)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveNow,160);
}

function engineSignature(){
  return JSON.stringify({
    promotions:state.promotions!==false,
    items:(state.items||[]).map(item=>({
      family:item.family||'',
      product:item.product||'',
      width:String(item.width||''),
      height:String(item.height||''),
      quantity:String(item.quantity||'1'),
      mode:item.mode||'auto',
      manualCost:rawPesos(item.manualCost||'0'),
      extras:rawPesos(item.extras||'0')
    }))
  });
}

function saveEngineCache(){
  if(!engineCacheKey||!catalog?.version||!lastEngineQuote?.ok||lastEngineSignature!==engineSignature())return;
  try{
    sessionStorage.setItem(engineCacheKey,JSON.stringify({
      version:catalog.version,
      signature:lastEngineSignature,
      quote:lastEngineQuote,
      savedAt:Date.now()
    }));
  }catch(e){}
}

function restoreEngineCache(){
  if(!engineCacheKey||!catalog?.version)return false;
  try{
    const cached=JSON.parse(sessionStorage.getItem(engineCacheKey));
    if(!cached||cached.version!==catalog.version||cached.signature!==engineSignature()||!cached.quote?.ok)return false;
    if(Date.now()-Number(cached.savedAt||0)>12*60*60*1000)return false;
    lastEngineQuote=cached.quote;
    lastEngineSignature=cached.signature;
    return true;
  }catch(e){
    return false;
  }
}

function clearEngineCache(){
  lastEngineQuote=null;
  lastEngineSignature='';
  lastQuote=null;
  if(engineCacheKey){
    try{sessionStorage.removeItem(engineCacheKey);}catch(e){}
  }
}

function loadDraft(){
  try{
    const v=JSON.parse(localStorage.getItem(key));
    if(!v||!Array.isArray(v.items)||v.items.length>100)return;
    if(v.version===2){
      state={...fresh(),...v};
      return;
    }
    if(v.version===1){
      state={
        ...fresh(),
        project:v.project||'',
        items:v.items||[],
        transport:rawPesos(v.transport),
        installationTotal:rawPesos(v.installation),
        gain:String(clampGain(v.margin||90)),
        promotions:v.promotions!==false
      };
    }
  }catch(e){
    toast('No se pudo recuperar el borrador anterior.');
  }
}

function availableFamilies(){
  const present=new Set((catalog?.products||[]).map(p=>p.family));
  return familyOrder.filter(f=>present.has(f));
}
function familyOptions(value){
  return availableFamilies().map(id=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+escape(familyLabels[id]||id)+'</option>').join('');
}
function productOptions(item){
  return (catalog?.products||[]).filter(p=>p.family===item.family).map(p=>'<option value="'+escape(p.id)+'" '+(p.id===item.product?'selected':'')+'>'+escape(p.name)+'</option>').join('');
}
function firstProduct(family){return (catalog?.products||[]).find(p=>p.family===family);}
function chosen(item){return (catalog?.products||[]).find(p=>p.id===item.product);}

function newItem(previous){
  const fallbackFamily=availableFamilies()[0]||'onda';
  const family=previous?.family&&firstProduct(previous.family)?previous.family:fallbackFamily;
  const previousProduct=previous?.product?(catalog?.products||[]).find(p=>p.id===previous.product):null;
  const product=previousProduct&&previousProduct.family===family?previousProduct.id:(firstProduct(family)?.id||'');
  return {
    id:crypto.randomUUID(),
    family,
    product,
    location:'',
    width:'',
    height:'',
    quantity:'1',
    mode:'auto',
    manualCost:'',
    extras:'0'
  };
}

function field(item,name,label,extra=''){
  const id=name+'-'+item.id;
  return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" data-field="'+name+'" value="'+escape(item[name])+'" '+extra+'></div>';
}

function moneyField(item,name,label,placeholder='0'){
  const id=name+'-'+item.id;
  return '<div class="field"><label for="'+id+'">'+label+'</label><div class="money-input"><span>COP $</span><input id="'+id+'" data-field="'+name+'" data-money="true" inputmode="numeric" value="'+escape(formatPesos(item[name]))+'" placeholder="'+placeholder+'" autocomplete="off"></div></div>';
}

function renderItem(item,index){
  const p=chosen(item);
  const forcedManual=p?.method==='manual';
  const manual=forcedManual||item.mode==='manual';
  const unitLabel=Number(item.quantity)>1?'Costo por persiana':'Costo de la persiana';

  return '<article class="item-card" data-id="'+escape(item.id)+'">'+
    '<div class="item-head">'+
      '<div><span class="item-number">Persiana '+(index+1)+'</span><h3>'+escape(item.location||'Sin ambiente')+'</h3></div>'+
      '<div class="item-actions"><button data-action="duplicate" title="Duplicar">Duplicar</button><button data-action="remove" title="Quitar">Quitar</button></div>'+
    '</div>'+

    '<div class="product-grid">'+
      '<div class="field"><label for="family-'+item.id+'">Producto</label><select id="family-'+item.id+'" data-field="family">'+familyOptions(item.family)+'</select></div>'+
      '<div class="field"><label for="product-'+item.id+'">Tela / referencia</label><select id="product-'+item.id+'" data-field="product">'+productOptions(item)+'</select></div>'+
    '</div>'+

    (p?.configuration?'<div class="product-meta">'+escape(p.configuration)+'</div>':'')+

    '<div class="measure-grid">'+
      field(item,'width','Ancho (m)','inputmode="decimal" placeholder="1,80" autocomplete="off"')+
      field(item,'height','Alto (m)','inputmode="decimal" placeholder="2,30" autocomplete="off"')+
      field(item,'quantity','Cantidad','inputmode="numeric" autocomplete="off"')+
    '</div>'+

    '<div class="location-row">'+field(item,'location','Ambiente <span>(opcional)</span>','placeholder="Ej. Sala" maxlength="80"')+'</div>'+

    '<details class="optional-settings" '+(forcedManual?'open':'')+'>'+
      '<summary>Ajustes opcionales</summary>'+
      '<p>Solo si Pentagrama te dio otro costo o necesitas sumar accesorios.</p>'+
      '<label class="manual-toggle"><input type="checkbox" data-action="manual-toggle" '+(manual?'checked':'')+' '+(forcedManual?'disabled':'')+'> Usar costo confirmado por Pentagrama</label>'+
      '<div class="manual-cost" '+(!manual?'hidden':'')+'>'+moneyField(item,'manualCost','Costo confirmado por persiana')+'</div>'+
      moneyField(item,'extras','Accesorios adicionales por persiana')+
    '</details>'+

    '<div class="item-price">'+
      '<div><span>'+unitLabel+'</span><strong data-output="unit">—</strong></div>'+
      (Number(item.quantity)>1?'<div class="item-total"><span>Total del ítem</span><strong data-output="total">—</strong></div>':'<strong data-output="total" hidden>—</strong>')+
    '</div>'+
    '<p class="item-error" data-output="error" role="status"></p>'+
  '</article>';
}

function render(options={}){
  $('items').innerHTML=state.items.map(renderItem).join('');
  $('item-count').textContent='('+state.items.length+')';
  if(options.recalculate===false)renderCommercial();
  else scheduleQuote(0);
  save();
}

function setCalculating(){
  $('result-message').textContent='Calculando…';
  $('result-message').classList.add('calculating');
}

async function post(tipo,payload={}){
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),15000):null;
  try{
    const response=await fetch(API_URL,{
      method:'POST',
      cache:'no-store',
      body:JSON.stringify({tipo,...payload}),
      ...(controller?{signal:controller.signal}:{})
    });
    const data=await response.json().catch(()=>({status:'error',msg:'HomeEasy respondió con datos no válidos.'}));
    if(!response.ok)throw Error(data.msg||data.error||('HTTP '+response.status));
    return data;
  }catch(error){
    if(error&&error.name==='AbortError')throw Error('La conexión tardó demasiado.');
    throw error;
  }finally{
    if(timer)clearTimeout(timer);
  }
}

function commercialQuote(q){
  if(!q?.ok)return q;
  const installation=Number(rawPesos(state.installationTotal))*100;
  const transport=Number(rawPesos(state.transport))*100;
  const gain=clampGain(state.gain);
  const cost=Number(q.products||0)+installation+transport;
  const profit=Math.round(cost*gain/100);
  return {...q,installation,transport,cost,profit,sale:cost+profit,gain};
}

function renderCommercial(message=''){
  const quoteMatches=lastEngineSignature&&lastEngineSignature===engineSignature();
  const q=commercialQuote(quoteMatches?lastEngineQuote:null);
  lastQuote=q||null;

  document.querySelectorAll('.item-card').forEach((el,index)=>{
    const itemResult=q?.items?.[index];
    const unit=el.querySelector('[data-output=unit]');
    const total=el.querySelector('[data-output=total]');
    if(unit)unit.textContent=itemResult?.ok?cop(itemResult.unit):'—';
    if(total)total.textContent=itemResult?.ok?cop(itemResult.total):'—';
    el.querySelector('[data-output=error]').textContent=itemResult?.ok?'':itemResult?.error||'';
  });

  const ok=Boolean(q?.ok);
  $('sum-products').textContent=ok?cop(q.products):'—';
  $('sum-installation').textContent=ok?cop(q.installation):'—';
  $('sum-transport').textContent=ok?cop(q.transport):'—';
  $('sum-cost').textContent=ok?cop(q.cost):'—';
  $('sum-gain').textContent=ok?cop(q.profit):'—';
  $('sum-sale').textContent=ok?cop(q.sale):'—';
  $('mobile-sale').textContent=ok?cop(q.sale):'Completar';

  const gain=clampGain(state.gain);
  $('gain-label').textContent='Ganancia +'+gain+'%';
  $('gain-minus').disabled=gain<=10;
  $('gain-plus').disabled=gain>=100;

  $('result-message').classList.remove('calculating');
  $('result-message').textContent=ok?'':(message||q?.error||'Completa las medidas para calcular.');
  $('copy-sale').disabled=!ok;
}

function applyQuote(rawQuote,message='',signature=engineSignature()){
  lastEngineQuote=rawQuote||null;
  lastEngineSignature=rawQuote?signature:'';
  if(lastEngineQuote?.ok)saveEngineCache();
  renderCommercial(message);
}

function scheduleQuote(delay=180){
  save();
  clearTimeout(quoteTimer);
  if(!catalog)return;
  const signature=engineSignature();
  if(lastEngineQuote?.ok&&lastEngineSignature===signature){
    renderCommercial();
    return;
  }
  const seq=++requestSeq;
  setCalculating();
  quoteTimer=setTimeout(()=>runQuote(seq,signature),delay);
}

async function runQuote(seq,signature){
  try{
    const data=await post('COSTOS_CALCULAR_COTIZACION',{
      items:state.items,
      transport:'0',
      installation:'0',
      margin:'0',
      installMode:'common',
      promotions:state.promotions
    });
    if(seq!==requestSeq||signature!==engineSignature())return;
    applyQuote(data.quote,data.status==='ok'?'':data.msg,signature);
  }catch(e){
    if(seq!==requestSeq)return;
    if(lastEngineQuote?.ok&&lastEngineSignature===engineSignature()){
      renderCommercial('No se pudo actualizar ahora. Conservamos el último cálculo válido.');
    }else{
      applyQuote(null,'No se pudo calcular ahora. Revisa tu conexión e intenta nuevamente.','');
    }
  }
}

function updateMoneyInput(input,stateKey){
  const raw=rawPesos(input.value);
  state[stateKey]=raw;
  input.value=formatPesos(raw);
  save();
  renderCommercial();
}

function setGain(value){
  state.gain=String(clampGain(value));
  $('gain').value=state.gain;
  save();
  renderCommercial();
}

function fillGlobals(){
  $('project').value=state.project;
  $('transport').value=formatPesos(state.transport);
  $('installation').value=formatPesos(state.installationTotal);
  $('gain').value=clampGain(state.gain);
}

$('items').addEventListener('input',event=>{
  const target=event.target;
  const field=target.dataset.field;
  if(!field||target.tagName==='SELECT')return;
  const card=target.closest('.item-card');
  if(!card)return;
  const item=state.items.find(i=>i.id===card.dataset.id);
  if(!item)return;

  if(target.dataset.money==='true'){
    item[field]=rawPesos(target.value);
    target.value=formatPesos(item[field]);
  }else{
    item[field]=target.value;
  }

  if(field==='location'){
    const title=card.querySelector('.item-head h3');
    if(title)title.textContent=item.location||'Sin ambiente';
    save();
    return;
  }

  scheduleQuote();
});

$('items').addEventListener('change',event=>{
  const target=event.target;
  const card=target.closest('.item-card');
  if(!card)return;
  const item=state.items.find(i=>i.id===card.dataset.id);
  if(!item)return;

  if(target.dataset.field&&target.tagName==='SELECT'){
    const field=target.dataset.field;
    item[field]=target.value;
    if(field==='family'){
      item.product=firstProduct(item.family)?.id||'';
      item.mode='auto';
    }
    if(field==='family'||field==='product'){
      item.manualCost='';
      item.extras='0';
      if(chosen(item)?.method==='manual')item.mode='manual';
    }
    render();
    return;
  }

  if(target.dataset.action==='manual-toggle'){
    if(chosen(item)?.method==='manual'){
      item.mode='manual';
    }else{
      item.mode=target.checked?'manual':'auto';
      if(!target.checked)item.manualCost='';
    }
    render();
  }
});

$('items').addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');
  if(!button||button.dataset.action==='manual-toggle')return;
  const card=button.closest('.item-card');
  if(!card)return;
  const index=state.items.findIndex(i=>i.id===card.dataset.id);
  if(index<0)return;

  if(button.dataset.action==='duplicate'){
    if(state.items.length>=100){toast('Máximo 100 persianas.');return;}
    const item={...state.items[index],id:crypto.randomUUID(),location:''};
    state.items.splice(index+1,0,item);
    render();
    document.querySelector('[data-id="'+item.id+'"] [data-field=width]')?.focus();
    toast('Persiana duplicada.');
  }

  if(button.dataset.action==='remove'){
    undoItem={item:state.items[index],index};
    state.items.splice(index,1);
    if(!state.items.length)state.items.push(newItem());
    render();
    $('toast').replaceChildren(document.createTextNode('Persiana eliminada. '));
    const undo=document.createElement('button');
    undo.textContent='Deshacer';
    undo.onclick=()=>{
      if(!undoItem)return;
      const emptyAuto=state.items.length===1&&!state.items[0].width&&!state.items[0].height&&!state.items[0].location;
      if(emptyAuto)state.items=[];
      state.items.splice(undoItem.index,0,undoItem.item);
      undoItem=null;
      render();
      $('toast').textContent='';
    };
    $('toast').append(undo);
    clearTimeout(toastTimer);
  }
});

$('add-item').onclick=()=>{
  if(state.items.length>=100){toast('Máximo 100 persianas.');return;}
  const item=newItem(state.items.at(-1));
  state.items.push(item);
  render();
  document.querySelector('[data-id="'+item.id+'"] [data-field=width]')?.focus();
};

$('project').addEventListener('input',e=>{state.project=e.target.value;save();});
$('transport').addEventListener('input',e=>updateMoneyInput(e.target,'transport'));
$('installation').addEventListener('input',e=>updateMoneyInput(e.target,'installationTotal'));

$('gain').addEventListener('input',e=>{
  const n=Number(e.target.value);
  if(Number.isFinite(n)&&n>=10&&n<=100){
    state.gain=String(n);
    save();
    renderCommercial();
  }
});
$('gain').addEventListener('change',e=>setGain(e.target.value));
$('gain-minus').onclick=()=>setGain(clampGain(state.gain)-10);
$('gain-plus').onclick=()=>setGain(clampGain(state.gain)+10);

$('new-quote').onclick=()=>$('new-dialog').showModal();
$('cancel-new').onclick=()=>$('new-dialog').close();
$('confirm-new').onclick=()=>{
  state=fresh();
  clearEngineCache();
  if(catalog)state.items=[newItem()];
  fillGlobals();
  render();
  $('new-dialog').close();
};

$('close-copy').onclick=()=>$('copy-dialog').close();

function whatsappMeasure(value){
  return String(value||'').trim().replace('.',',');
}

function buildWhatsAppProposal(q){
  const intro=state.project
    ? 'Te comparto la propuesta que preparamos para *'+String(state.project).trim()+'* en *HomeEasy*:'
    : 'Te comparto la propuesta que preparamos para ti en *HomeEasy*:';

  const itemBlocks=state.items.map((item,index)=>{
    const product=q.items[index]?.product;
    const family=familyLabels[item.family]||item.family||'Persiana';
    const reference=product?.name||'';
    const title=item.location
      ? '*'+(index+1)+'. '+item.location+' · '+family+(reference?' · '+reference:'')+'*'
      : '*'+(index+1)+'. '+family+(reference?' · '+reference:'')+'*';

    return [
      title,
      '• *Medidas:* '+whatsappMeasure(item.width)+' × '+whatsappMeasure(item.height)+' m',
      '• *Cantidad:* '+(item.quantity||1)
    ].join('\n');
  });

  const includes=[];
  if(q.installation)includes.push('instalación');
  if(q.transport)includes.push('transporte');

  let inclusion='';
  if(includes.length===1)inclusion='✅ Este valor incluye *'+includes[0]+'*.';
  if(includes.length===2)inclusion='✅ Este valor incluye *instalación y transporte*.';

  const blocks=[
    intro,
    itemBlocks.join('\n\n'),
    '💰 *Valor total: '+cop(q.sale)+'*'+(inclusion?'\n'+inclusion:''),
    'Si deseas, con gusto te ayudo a continuar con el pedido o resolver cualquier duda.'
  ].filter(Boolean);

  return blocks.join('\n\n');
}

$('copy-sale').onclick=async()=>{
  const q=lastQuote;
  if(!q?.ok)return;

  const text=buildWhatsAppProposal(q);
  try{
    await navigator.clipboard.writeText(text);
    toast('Mensaje para WhatsApp copiado.');
  }catch(e){
    $('copy-text').value=text;
    $('copy-dialog').showModal();
    $('copy-text').select();
  }
};

async function connect(){
  if(loading||!ready)return;
  loading=true;
  $('retry').hidden=true;
  try{
    const payload=await post('COSTOS_OPCIONES');
    if(payload.status!=='ok'||!Array.isArray(payload.products))throw Error(payload.msg||'No se pudo cargar el catálogo.');

    catalog={
      products:payload.products,
      validThrough:payload.validThrough,
      version:payload.version,
      currency:payload.currency
    };

    $('connection').hidden=true;
    $('catalog-note').textContent='Precios internos de Pentagrama · HomeEasy.';
    $('tariff-date').textContent='Tarifas '+catalog.version+' · vigentes hasta '+catalog.validThrough+'.';

    if(!state.items.length)state.items.push(newItem());
    state.items=state.items.map(item=>{
      const existing=catalog.products.find(p=>p.id===item.product);
      if(existing)return item;
      const family=firstProduct(item.family)?item.family:(availableFamilies()[0]||'onda');
      return {...item,family,product:firstProduct(family)?.id||'',mode:'auto'};
    });

    $('add-item').disabled=false;
    fillGlobals();
    const restored=restoreEngineCache();
    render({recalculate:!restored});
  }catch(e){
    $('connection').hidden=false;
    $('connection').firstChild.textContent='No se pudieron cargar los precios. Tu borrador sigue guardado. ';
    $('retry').hidden=false;
  }finally{
    loading=false;
  }
}

function start(){
  if(ready||window.HomeEasyPageGuard?.getStatus()!=='authorized')return;
  const profile=window.HomeEasyAuth?.getHomeEasyProfile?.()||window.HomeEasyAuth?.getCurrentUser?.()||window.HomeEasyAuth?.getCurrentProfile?.();
  if(!profile?.uid){
    $('connection').firstChild.textContent='No se pudo identificar tu usuario. Vuelve a ingresar a HomeEasy.';
    return;
  }
  key='homeeasy.cost-draft.v2:'+profile.uid;
  engineCacheKey='homeeasy.cost-engine.v1:'+profile.uid;
  ready=true;
  loadDraft();
  fillGlobals();
  connect();
}

function resumeCalculator(){
  clearTimeout(quoteTimer);
  requestSeq++;
  saveNow();

  if(!catalog){
    connect();
    return;
  }

  if(lastEngineQuote?.ok&&lastEngineSignature===engineSignature()){
    renderCommercial();
    return;
  }

  if(restoreEngineCache()){
    renderCommercial();
    return;
  }

  scheduleQuote(0);
}

$('retry').onclick=connect;
window.addEventListener('homeeasy:page-auth-ready',start);
window.addEventListener('online',()=>{
  if(!catalog)connect();
  else if(!lastEngineQuote?.ok&&document.visibilityState==='visible')scheduleQuote(0);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    saveNow();
    saveEngineCache();
    return;
  }
  resumeCalculator();
});
window.addEventListener('pagehide',()=>{
  saveNow();
  saveEngineCache();
});
window.addEventListener('pageshow',event=>{
  if(event.persisted)resumeCalculator();
  else if(catalog&&lastEngineQuote?.ok&&lastEngineSignature===engineSignature())renderCommercial();
});
start();
})();