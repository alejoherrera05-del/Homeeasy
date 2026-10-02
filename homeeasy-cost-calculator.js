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

let state=fresh(),catalog=null,lastQuote=null,key='',ready=false,loading=false;
let saveTimer,toastTimer,undoItem,quoteTimer,requestSeq=0;

function toast(message){
  $('toast').textContent=message;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').textContent='',3500);
}

function save(){
  if(!key)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    try{
      localStorage.setItem(key,JSON.stringify(state));
      $('save-state').textContent='Borrador guardado';
    }catch(e){
      $('save-state').textContent='No se pudo guardar';
    }
  },160);
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

function render(){
  $('items').innerHTML=state.items.map(renderItem).join('');
  $('item-count').textContent='('+state.items.length+')';
  scheduleQuote(0);
  save();
}

function setCalculating(){
  $('result-message').textContent='Calculando…';
  $('result-message').classList.add('calculating');
}

async function post(tipo,payload={}){
  const response=await fetch(API_URL,{method:'POST',cache:'no-store',body:JSON.stringify({tipo,...payload})});
  const data=await response.json().catch(()=>({status:'error',msg:'HomeEasy respondió con datos no válidos.'}));
  if(!response.ok)throw Error(data.msg||data.error||('HTTP '+response.status));
  return data;
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

function applyQuote(rawQuote,message=''){
  const q=commercialQuote(rawQuote);
  lastQuote=q||null;

  document.querySelectorAll('.item-card').forEach((el,index)=>{
    const r=q?.items?.[index];
    const unit=el.querySelector('[data-output=unit]');
    const total=el.querySelector('[data-output=total]');
    if(unit)unit.textContent=r?.ok?cop(r.unit):'—';
    if(total)total.textContent=r?.ok?cop(r.total):'—';
    el.querySelector('[data-output=error]').textContent=r?.ok?'':r?.error||'';
  });

  const ok=Boolean(q?.ok);
  $('sum-products').textContent=ok?cop(q.products):'—';
  $('sum-installation').textContent=ok?cop(q.installation):'—';
  $('sum-transport').textContent=ok?cop(q.transport):'—';
  $('sum-cost').textContent=ok?cop(q.cost):'—';
  $('sum-gain').textContent=ok?cop(q.profit):'—';
  $('sum-sale').textContent=ok?cop(q.sale):'—';
  $('mobile-sale').textContent=ok?cop(q.sale):'Completar';
  $('gain-label').textContent='Ganancia +'+clampGain(state.gain)+'%';
  $('result-message').classList.remove('calculating');
  $('result-message').textContent=ok?'Precio actualizado.':(message||q?.error||'Completa las medidas para calcular.');
  $('copy-sale').disabled=!ok;
}

function scheduleQuote(delay=220){
  save();
  clearTimeout(quoteTimer);
  if(!catalog)return;
  setCalculating();
  quoteTimer=setTimeout(runQuote,delay);
}

async function runQuote(){
  const seq=++requestSeq;
  try{
    const data=await post('COSTOS_CALCULAR_COTIZACION',{
      items:state.items,
      transport:'0',
      installation:'0',
      margin:'0',
      installMode:'common',
      promotions:state.promotions
    });
    if(seq!==requestSeq)return;
    applyQuote(data.quote,data.status==='ok'?'':data.msg);
  }catch(e){
    if(seq!==requestSeq)return;
    applyQuote(null,'No se pudo calcular. Revisa tu conexión e intenta nuevamente.');
  }
}

function updateMoneyInput(input,stateKey){
  const raw=rawPesos(input.value);
  state[stateKey]=raw;
  input.value=formatPesos(raw);
  scheduleQuote();
}

function setGain(value){
  state.gain=String(clampGain(value));
  $('gain').value=state.gain;
  scheduleQuote(0);
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
    scheduleQuote();
  }
});
$('gain').addEventListener('change',e=>setGain(e.target.value));
$('gain-minus').onclick=()=>setGain(clampGain(state.gain)-10);
$('gain-plus').onclick=()=>setGain(clampGain(state.gain)+10);

$('new-quote').onclick=()=>$('new-dialog').showModal();
$('cancel-new').onclick=()=>$('new-dialog').close();
$('confirm-new').onclick=()=>{
  state=fresh();
  if(catalog)state.items=[newItem()];
  fillGlobals();
  render();
  $('new-dialog').close();
};

$('close-copy').onclick=()=>$('copy-dialog').close();

$('copy-sale').onclick=async()=>{
  const q=lastQuote;
  if(!q?.ok)return;

  const lines=[
    'Propuesta HomeEasy',
    state.project,
    ...state.items.map((item,index)=>{
      const product=q.items[index]?.product;
      return (index+1)+'. '+(familyLabels[item.family]||item.family)+' · '+(product?.name||'')+(item.location?' · '+item.location:'')+'\n'+item.width+' × '+item.height+' m · Cantidad: '+item.quantity;
    }),
    'Precio total: '+cop(q.sale)+' · IVA incluido.',
    q.installation?'Incluye instalación.':'',
    q.transport?'Incluye transporte.':'',
    'Sujeto a disponibilidad y confirmación de fabricación.'
  ].filter(Boolean);

  const text=lines.join('\n\n');
  try{
    await navigator.clipboard.writeText(text);
    toast('Propuesta copiada.');
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
    render();
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
  ready=true;
  loadDraft();
  fillGlobals();
  connect();
}

$('retry').onclick=connect;
window.addEventListener('homeeasy:page-auth-ready',start);
window.addEventListener('online',()=>{if(!catalog)connect();});
window.addEventListener('pagehide',()=>{
  if(!key)return;
  clearTimeout(saveTimer);
  try{localStorage.setItem(key,JSON.stringify(state));}catch(e){}
});
window.addEventListener('pageshow',()=>{if(catalog)scheduleQuote(0);});
start();
})();