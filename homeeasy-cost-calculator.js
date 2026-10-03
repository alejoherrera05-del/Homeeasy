(function(){
'use strict';

const $=id=>document.getElementById(id);
const API_URL=String(window.HomeEasyCore&&window.HomeEasyCore.API_URL||'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');
const familyLabels={onda:'Onda Serena',panel:'Panel Japonés',sheer:'Sheer Elegance',vertesse:'Sheer Vertesse',vertical:'Verticales',enrollable:'Enrollable'};
const FORMAL_QUOTE_TRANSFER_KEY='homeeasy.cost-to-formal.v1';
const familyOrder=['onda','sheer','vertesse','panel','vertical','enrollable'];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cop=cents=>'COP $'+new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Math.round((Number(cents)||0)/100));
const formatPesos=raw=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(Number(String(raw||'0').replace(/\D/g,''))||0);
const rawPesos=value=>String(value??'').replace(/\D/g,'').replace(/^0+(?=\d)/,'')||'0';
const clampGain=value=>{
  const n=Number(value);
  if(!Number.isFinite(n))return 90;
  return Math.max(10,Math.min(100,Math.round(n/10)*10));
};
const fresh=()=>({version:2,project:'',items:[],transport:'0',installationTotal:'0',gain:'90',roundSale:false,promotions:true});

let state=fresh(),catalog=null,lastEngineQuote=null,lastEngineSignature='',lastQuote=null,key='',engineCacheKey='',ready=false,loading=false;
let saveTimer,toastTimer,undoItem,quoteTimer,requestSeq=0;
let installationEditingId='',installationDraft=null;
let pendingTransferPreview=null,lastSharedTransfer=null,transferBusy=false;

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
      configuration:item.configuration||'standard',
      coverlight:item.coverlight||'',
      addons:Array.isArray(item.addons)?item.addons:[],
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

function normalizeRoomIds(){
  const legacyRooms=new Map();
  state.items.forEach(item=>{
    if(item.roomId)return;
    const location=String(item.location||'').trim().toLocaleLowerCase('es');
    if(location){
      if(!legacyRooms.has(location))legacyRooms.set(location,crypto.randomUUID());
      item.roomId=legacyRooms.get(location);
    }else{
      item.roomId=crypto.randomUUID();
    }
  });
}

function roomIdOf(item){
  return item?.roomId||item?.id||'';
}

function roomGroups(){
  const groups=[];
  const byId=new Map();
  state.items.forEach(item=>{
    const id=roomIdOf(item);
    if(!byId.has(id)){
      const group={id,items:[]};
      byId.set(id,group);
      groups.push(group);
    }
    byId.get(id).items.push(item);
  });
  return groups;
}

function setRoomLocation(roomId,value){
  state.items.forEach(item=>{
    if(roomIdOf(item)===roomId)item.location=value;
  });
}

const installationLabels={
  mount:{techo:'Techo',pared:'Pared'},
  control:{izquierda:'Mando a la izquierda',derecha:'Mando a la derecha'},
  opening:{extremos:'Apertura a los extremos',centro:'Apertura al centro',izquierda:'Apertura a la izquierda',derecha:'Apertura a la derecha'}
};

function installationData(item){
  return {
    mount:String(item?.installation?.mount||''),
    control:String(item?.installation?.control||''),
    opening:String(item?.installation?.opening||''),
    note:String(item?.installation?.note||'')
  };
}

function familyInstallationFields(family){
  return {
    mount:true,
    control:['enrollable','sheer','vertesse','panel','vertical'].includes(family),
    opening:['onda','vertesse','panel','vertical'].includes(family)
  };
}

function installationSummary(item){
  const data=installationData(item);
  const fields=familyInstallationFields(item.family);
  const parts=[];
  if(fields.mount&&data.mount)parts.push(installationLabels.mount[data.mount]||data.mount);
  if(fields.opening&&data.opening)parts.push((installationLabels.opening[data.opening]||data.opening).replace(/^Apertura /,''));
  if(fields.control&&data.control)parts.push((installationLabels.control[data.control]||data.control).replace(/^Mando /,'mando '));
  if(data.note)parts.push('nota');
  return parts.length?parts.join(' · '):'Sin definir';
}

function installationButton(item){
  const summary=installationSummary(item);
  return '<button class="installation-trigger" data-action="installation" type="button">'+
    '<span class="installation-trigger-main"><i class="fa-solid fa-screwdriver-wrench"></i><span><strong>Detalles de instalación</strong><small>'+escape(summary)+'</small></span></span>'+
    '<i class="fa-solid fa-chevron-right installation-chevron"></i>'+
  '</button>';
}

function renderInstallChoice(field,options,current){
  return '<div class="install-choice" data-install-group="'+field+'">'+options.map(([value,label])=>
    '<button type="button" data-install-field="'+field+'" data-install-value="'+value+'" class="'+(current===value?'selected':'')+'">'+escape(label)+'</button>'
  ).join('')+'</div>';
}

function openInstallationDialog(item){
  installationEditingId=item.id;
  installationDraft=installationData(item);
  const fields=familyInstallationFields(item.family);
  $('install-product').textContent=(familyLabels[item.family]||'Persiana')+(chosen(item)?.name?' · '+chosen(item).name:'');
  $('install-mount-block').hidden=!fields.mount;
  $('install-control-block').hidden=!fields.control;
  $('install-opening-block').hidden=!fields.opening;
  $('install-mount-options').innerHTML=renderInstallChoice('mount',[['techo','Techo'],['pared','Pared']],installationDraft.mount);
  $('install-control-options').innerHTML=renderInstallChoice('control',[['izquierda','Izquierda'],['derecha','Derecha']],installationDraft.control);
  $('install-opening-options').innerHTML=renderInstallChoice('opening',[['extremos','A los extremos'],['centro','Al centro'],['izquierda','A la izquierda'],['derecha','A la derecha']],installationDraft.opening);
  $('install-note').value=installationDraft.note;
  $('install-dialog').showModal();
}

function refreshInstallChoice(field){
  const group=$('install-dialog').querySelector('[data-install-group="'+field+'"]');
  if(!group)return;
  group.querySelectorAll('[data-install-value]').forEach(button=>{
    button.classList.toggle('selected',button.dataset.installValue===installationDraft?.[field]);
  });
}

function cleanCommercialComplementName(name){
  return String(name||'')
    .replace(/\s*[·\-–]\s*(?:blanco\s*(?:o|\/)\s*negro|costo confirmado|precio confirmado)\s*$/i,'')
    .replace(/\s*\((?:blanco\s*(?:o|\/)\s*negro)\)\s*$/i,'')
    .trim();
}

function installationObservationLines(q){
  return state.items.map((item,index)=>{
    const data=installationData(item);
    const fields=familyInstallationFields(item.family);
    const details=[];
    if(fields.mount&&data.mount)details.push(data.mount==='techo'?'instalación al techo':data.mount==='pared'?'instalación a pared':'instalación '+data.mount);
    if(fields.opening&&data.opening)details.push((installationLabels.opening[data.opening]||data.opening).toLowerCase());
    if(fields.control&&data.control)details.push((installationLabels.control[data.control]||data.control).toLowerCase());
    if(data.note)details.push(data.note.trim());
    if(!details.length)return '';
    const product=q.items?.[index]?.product;
    const location=String(item.location||'').trim();
    const name=[location,familyLabels[item.family]||'Persiana',product?.name||''].filter(Boolean).join(' — ');
    return '• '+name+': '+details.join('; ')+'.';
  }).filter(Boolean);
}

function availableFamilies(){
  const present=new Set((catalog?.products||[]).map(p=>p.family));
  return familyOrder.filter(f=>present.has(f));
}
function familyOptions(value){
  return availableFamilies().map(id=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+escape(familyLabels[id]||id)+'</option>').join('');
}
function groupedProductOptions(products,item,groups,groupOf,includeUngrouped=true){
  const option=p=>'<option value="'+escape(p.id)+'" '+(p.id===item.product?'selected':'')+'>'+escape(p.name)+'</option>';
  const sorted=entries=>entries.slice().sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
  const keys=new Set(groups.map(([key])=>key));
  return groups.map(([key,label])=>{
    const entries=sorted(products.filter(p=>groupOf(p)===key));
    return entries.length?'<optgroup label="'+escape(label)+'">'+entries.map(option).join('')+'</optgroup>':'';
  }).join('')+(includeUngrouped?sorted(products.filter(p=>!keys.has(groupOf(p)))).map(option).join(''):'');
}
function referenceGroup(product){
  if(product.collection||product.category||product.type)return product.collection||product.category||product.type;
  return product.name.match(/^(Black\s?Out|Screen(?: Ultimate Jacquard| Jacquard| Splendour| Tretto)?|Serenade Screen|Romantic|Night|Regular traslucente|Soft \/ Bisou)(?=\s|$)/i)?.[0]||'';
}
function productOptions(item){
  const products=(catalog?.products||[]).filter(p=>p.family===item.family);
  if(item.family!=='enrollable'){
    const keys=[...new Set(products.map(referenceGroup).filter(Boolean))];
    const missing=!products.some(p=>p.id===item.product)?'<option value="" selected disabled>Revisa la referencia compartida</option>':'';
    return missing+groupedProductOptions(products,item,keys.map(key=>[key,key]),referenceGroup);
  }

  // Enrollables: no ocultar telas por las medidas actuales.
  // El vendedor debe poder registrar la referencia durante una visita incluso si
  // esa medida exige confirmación especial. El backend conserva la validación
  // autoritativa y evita calcular un precio automático fuera de los límites.
  const groups=[['Blackout','Blackout'],['Screen','Screen'],['Traslúcida','Traslúcidas'],['Dim Out','Dim Out'],['Lona transparente','Lona'],['Membrana bioclimática','Soltis'],['Serenade','Serenade']];
  const missing=!products.some(p=>p.id===item.product)?'<option value="" selected disabled>Selecciona una tela / referencia</option>':'';
  return missing+groupedProductOptions(products,item,groups,p=>p.type,false);
}
function firstProduct(family){return (catalog?.products||[]).find(p=>p.family===family);}
function chosen(item){return (catalog?.products||[]).find(p=>p.id===item.product);}
function chosenConfiguration(item){return chosen(item)?.configurations?.find(c=>c.id===(item.configuration||'standard'));}
function requiresManual(item){return item.family!=='enrollable'&&(chosen(item)?.method==='manual'||chosenConfiguration(item)?.manual);}
function resetComplements(item){item.coverlight='';item.addons=[];}

function calculatedCovers(item){
  const result=lastEngineQuote?.items?.[state.items.indexOf(item)];
  const mm=value=>Math.round(Number(String(value).replace(',','.'))*1000);
  return result?.ok&&result.product.id===item.product&&result.widthMm===mm(item.width)&&result.heightMm===mm(item.height)?result.coverlightOptions||[]:[];
}
function coverlightControls(item){
  const covers=calculatedCovers(item);
  return covers.length?'<label class="coverlight-toggle" for="coverlight-'+item.id+'"><input id="coverlight-'+item.id+'" type="checkbox" data-action="coverlight-toggle" '+(item.coverlight?'checked':'')+'> Agregar Coverlight</label>'+
    (item.coverlight?'<div class="field"><label for="coverlight-version-'+item.id+'">Coverlight</label><select id="coverlight-version-'+item.id+'" data-field="coverlight">'+covers.map(c=>'<option value="'+escape(c.id)+'" '+(c.id===item.coverlight?'selected':'')+'>'+escape(c.name)+' · +'+escape(cop(c.costCents))+'</option>').join('')+'</select></div>':''):'';
}
function specialAlternativeLabel(item){
  return String(item?.specialAlternative?.label||item?.specialAlternative?.id||'configuración especial');
}

function enrollableControls(item){
  if(item.family!=='enrollable')return '';
  if(item.mode==='manual'){
    return '<div class="enrollable-options">'+
      '<div class="special-cost-entry">'+
        '<div class="special-cost-head"><span><i class="fa-solid fa-file-invoice-dollar"></i></span><div><strong>Costo confirmado · '+escape(specialAlternativeLabel(item))+'</strong><small>Ingresa el costo proveedor con IVA confirmado para esta medida.</small></div></div>'+
        moneyField(item,'manualCost','Costo confirmado por persiana')+
        '<button type="button" class="special-cost-cancel" data-action="cancel-special-cost">Volver a cálculo Standard</button>'+
      '</div>'+
    '</div>';
  }
  return '<div class="enrollable-options">'+coverlightControls(item)+'</div>';
}

function fabricationOrientationLabel(value){
  if(value==='atravesada_y_anadida')return 'Atravesada y añadida';
  if(value==='atravesada')return 'Atravesada';
  return 'Normal';
}

function renderFabricationNotice(item,result){
  if(item?.family!=='enrollable'||!result)return '';

  if(result.ok&&item.mode==='manual'&&item.specialAlternative){
    return '<div class="fabrication-notice fabrication-notice--manual">'+
      '<i class="fa-solid fa-circle-check"></i><div><strong>Costo especial registrado</strong><span>'+escape(specialAlternativeLabel(item))+' · se usará el valor confirmado por Pentagrama.</span></div>'+
    '</div>';
  }

  const fabrication=result.fabrication;
  if(result.ok&&fabrication?.supported){
    if(fabrication.requiresAuthorization||fabrication.warranty===false){
      const detail=[fabrication.mechanism,fabrication.tube].filter(Boolean).join(' · ');
      return '<div class="fabrication-notice fabrication-notice--warning">'+
        '<i class="fa-solid fa-triangle-exclamation"></i><div><strong>Fabricación especial · '+escape(fabricationOrientationLabel(fabrication.orientation))+'</strong>'+
        '<span>Esta fabricación requiere autorización y queda sin garantía.'+(detail?' '+escape(detail)+'.':'')+'</span></div>'+
      '</div>';
    }
    if(fabrication.orientation==='atravesada'){
      return '<div class="fabrication-notice fabrication-notice--info">'+
        '<i class="fa-solid fa-rotate"></i><div><strong>Fabricación atravesada</strong><span>La medida está respaldada por la tabla de fabricación registrada.</span></div>'+
      '</div>';
    }
    return '';
  }

  if(result.requiresAlternative&&Array.isArray(result.alternatives)&&result.alternatives.length){
    const options=result.alternatives.map(alt=>{
      const detail=[alt.mechanism,alt.tube].filter(Boolean).join(' · ');
      return '<div class="fabrication-alternative">'+
        '<div><strong>'+escape(alt.label||alt.id||'Alternativa')+'</strong><span>'+(detail?escape(detail)+' · ':'')+(alt.requiresConfirmedCost!==false?'requiere costo confirmado':'costo automático disponible')+'</span></div>'+
        (alt.requiresConfirmedCost!==false?'<button type="button" data-action="special-cost" data-alt-id="'+escape(alt.id||'')+'" data-alt-label="'+escape(alt.label||alt.id||'Configuración especial')+'">Registrar costo</button>':'')+
      '</div>';
    }).join('');
    return '<div class="fabrication-notice fabrication-notice--alternative">'+
      '<i class="fa-solid fa-shuffle"></i><div class="fabrication-notice-body"><strong>Standard no aplica para esta medida</strong><span>'+escape(result.reason||result.error||'Hay otra configuración de fabricación disponible.')+'</span>'+options+'</div>'+
    '</div>';
  }

  if(result.notManufacturable){
    return '<div class="fabrication-notice fabrication-notice--danger">'+
      '<i class="fa-solid fa-ban"></i><div><strong>Medida no fabricable con las reglas registradas</strong><span>'+escape(result.reason||result.error||'Prueba otra medida o referencia.')+'</span></div>'+
    '</div>';
  }

  return '';
}

function newItem(previous,roomId=''){
  const fallbackFamily=availableFamilies()[0]||'onda';
  const family=previous?.family&&firstProduct(previous.family)?previous.family:fallbackFamily;
  const previousProduct=previous?.product?(catalog?.products||[]).find(p=>p.id===previous.product):null;
  const product=previousProduct&&previousProduct.family===family?previousProduct.id:(firstProduct(family)?.id||'');
  return {
    id:crypto.randomUUID(),
    roomId:roomId||crypto.randomUUID(),
    family,
    product,
    location:'',
    width:'',
    height:'',
    quantity:'1',
    mode:'auto',
    manualCost:'',
    extras:'0',
    configuration:'standard',
    coverlight:'',
    addons:[],
    installation:{mount:'',control:'',opening:'',note:''}
  };
}

function newRoomLayer(previous){
  const item=newItem(previous,roomIdOf(previous));
  item.location=previous?.location||'';
  item.width=previous?.width||'';
  item.height=previous?.height||'';
  item.quantity=previous?.quantity||'1';
  return item;
}

function field(item,name,label,extra=''){
  const id=name+'-'+item.id;
  return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" data-field="'+name+'" value="'+escape(item[name])+'" '+extra+'></div>';
}

function moneyField(item,name,label,placeholder='0'){
  const id=name+'-'+item.id;
  return '<div class="field"><label for="'+id+'">'+label+'</label><div class="money-input"><span>COP $</span><input id="'+id+'" data-field="'+name+'" data-money="true" inputmode="numeric" value="'+escape(formatPesos(item[name]))+'" placeholder="'+placeholder+'" autocomplete="off"></div></div>';
}

function renderItem(item,index,layerIndex=0,layerCount=1){
  const p=chosen(item);
  const forcedManual=requiresManual(item);
  const manual=forcedManual||item.mode==='manual';
  const unitLabel=Number(item.quantity)>1?'Costo por persiana':'Costo de la persiana';
  const layerLabel=layerCount>1?'Persiana '+(layerIndex+1)+' de '+layerCount:'Persiana '+(layerIndex+1);

  return '<article class="item-card" data-id="'+escape(item.id)+'">'+
    '<div class="item-head">'+
      '<div><span class="item-number">'+layerLabel+'</span><h3>'+escape(familyLabels[item.family]||'Persiana')+'</h3></div>'+
      '<div class="item-actions"><button data-action="duplicate" title="Duplicar">Duplicar</button><button data-action="remove" title="Quitar">Quitar</button></div>'+
    '</div>'+

    '<div class="product-grid">'+
      '<div class="field"><label for="family-'+item.id+'">Producto</label><select id="family-'+item.id+'" data-field="family">'+familyOptions(item.family)+'</select></div>'+
      '<div class="field"><label for="product-'+item.id+'">Tela / referencia</label><select id="product-'+item.id+'" data-field="product">'+productOptions(item)+'</select></div>'+
    '</div>'+

    (item.family!=='enrollable'&&p?.configuration?'<div class="product-meta">'+escape(p.configuration)+'</div>':'')+

    '<div class="measure-grid">'+
      field(item,'width','Ancho (m)','inputmode="decimal" placeholder="1,80" autocomplete="off"')+
      field(item,'height','Alto (m)','inputmode="decimal" placeholder="2,30" autocomplete="off"')+
      field(item,'quantity','Cantidad','inputmode="numeric" autocomplete="off"')+
    '</div>'+

    enrollableControls(item,p,manual)+

    installationButton(item)+

    (item.family!=='enrollable'?'<details class="optional-settings" '+(forcedManual?'open':'')+'>'+
      '<summary>Ajustes opcionales</summary>'+
      '<p>Solo si Pentagrama te dio otro costo o necesitas sumar accesorios.</p>'+
      '<label class="manual-toggle"><input type="checkbox" data-action="manual-toggle" '+(manual?'checked':'')+' '+(forcedManual?'disabled':'')+'> Usar costo confirmado por Pentagrama</label>'+
      '<div class="manual-cost" '+(!manual?'hidden':'')+'>'+moneyField(item,'manualCost','Costo confirmado por persiana')+'</div>'+
      moneyField(item,'extras','Accesorios adicionales por persiana')+
    '</details>':'')+

    '<div class="item-price">'+
      '<div><span>'+unitLabel+'</span><strong data-output="unit">—</strong></div>'+
      (Number(item.quantity)>1?'<div class="item-total"><span>Total del ítem</span><strong data-output="total">—</strong></div>':'<strong data-output="total" hidden>—</strong>')+
    '</div>'+
    '<div data-output="fabrication"></div>'+
    '<p class="item-error" data-output="error" role="status"></p>'+
  '</article>';
}

function renderRoom(group,roomIndex){
  const first=group.items[0];
  const location=first?.location||'';
  const count=group.items.length;
  return '<section class="room-card" data-room-id="'+escape(group.id)+'">'+
    '<div class="room-head">'+
      '<div><span class="room-number">Ambiente '+(roomIndex+1)+'</span><h3 data-room-title>'+escape(location||'Sin ambiente')+'</h3></div>'+
      '<span class="room-count">'+count+' '+(count===1?'persiana':'persianas')+'</span>'+
    '</div>'+
    '<div class="room-location field">'+
      '<label for="room-location-'+escape(group.id)+'">Ambiente <span>(opcional)</span></label>'+
      '<input id="room-location-'+escape(group.id)+'" data-room-field="location" value="'+escape(location)+'" placeholder="Ej. Habitación principal" maxlength="80">'+
    '</div>'+
    '<div class="room-layers">'+group.items.map((item,layerIndex)=>renderItem(item,state.items.indexOf(item),layerIndex,count)).join('')+'</div>'+
    '<button class="add-room-item" data-action="add-room-item" type="button"><i class="fa-solid fa-plus"></i> Agregar otra persiana en este ambiente</button>'+
  '</section>';
}

function render(options={}){
  const groups=roomGroups();
  $('items').innerHTML=groups.map(renderRoom).join('');
  $('item-count').textContent='('+state.items.length+')';
  if(options.recalculate===false)renderCommercial();
  else scheduleQuote(0);
  save();
}

function setCalculating(){
  $('result-message').textContent='Calculando…';
  $('result-message').classList.add('calculating');
}

function normalizeTransferCode(value){
  return String(value||'').toUpperCase().replace(/[\s-]+/g,'').replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g,'').slice(0,6);
}

function technicalTransferPayload(){
  return {
    project:String(state.project||'').trim(),
    items:(state.items||[]).map(item=>({
      roomId:String(roomIdOf(item)||'').trim(),
      family:String(item.family||'').trim(),
      product:String(item.product||'').trim(),
      location:String(item.location||'').trim(),
      width:String(item.width||'').trim(),
      height:String(item.height||'').trim(),
      quantity:String(item.quantity||'1').trim(),
      configuration:String(item.configuration||'standard').trim(),
      coverlight:String(item.coverlight||'').trim(),
      addons:Array.isArray(item.addons)?item.addons.slice():[],
      installation:installationData(item)
    }))
  };
}

function validateTechnicalTransferPayload(payload){
  if(!payload?.items?.length)return 'Agrega al menos una persiana antes de compartir.';
  for(let index=0;index<payload.items.length;index++){
    const item=payload.items[index];
    const label=item.location||('Persiana '+(index+1));
    if(!item.roomId||!item.family)return 'Revisa '+label+'.';
    if(!item.product)return 'Selecciona la referencia de '+label+' antes de compartir.';
    const width=Number(String(item.width).replace(',','.'));
    const height=Number(String(item.height).replace(',','.'));
    const quantity=Number(item.quantity);
    if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0){
      return 'Completa ancho y alto de '+label+' antes de compartir.';
    }
    if(!Number.isInteger(quantity)||quantity<1){
      return 'Revisa la cantidad de '+label+'.';
    }
  }
  return '';
}

function transferSignature(payload){
  return JSON.stringify(payload);
}

function transferShareText(code){
  return [
    'Te compartí una visita de HomeEasy.',
    'Código Hommy: *'+code+'*',
    'Entra a HomeEasy → Cotizador → Recibir visita.'
  ].join('\n');
}

function formatTransferExpiry(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '7 días';
  return date.toLocaleString('es-CO',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
}

function setTransferBusy(button,busy,label){
  if(!button)return;
  button.disabled=Boolean(busy);
  if(label)button.dataset.idleLabel=label;
  const idle=button.dataset.idleLabel||button.textContent.trim();
  if(busy)button.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i> Espera…';
  else button.textContent=idle;
}

function resetShareVisitDialog(){
  $('share-visit-error').textContent='';
  $('share-visit-loading').hidden=true;
  $('share-visit-ready').hidden=true;
  $('share-visit-code').textContent='—';
  $('share-visit-expiry').textContent='';
}

function showSharedTransfer(result,signature){
  lastSharedTransfer={
    signature,
    code:result.code,
    expiresAt:result.expiresAt
  };
  $('share-visit-loading').hidden=true;
  $('share-visit-ready').hidden=false;
  $('share-visit-code').textContent=result.code;
  $('share-visit-expiry').textContent='Válido hasta '+formatTransferExpiry(result.expiresAt);
}

async function createSharedVisit(){
  if(transferBusy)return;
  const payload=technicalTransferPayload();
  const validation=validateTechnicalTransferPayload(payload);
  if(validation){toast(validation);return;}

  const signature=transferSignature(payload);
  resetShareVisitDialog();
  $('share-visit-dialog').showModal();

  if(lastSharedTransfer&&lastSharedTransfer.signature===signature&&new Date(lastSharedTransfer.expiresAt).getTime()>Date.now()){
    showSharedTransfer(lastSharedTransfer,signature);
    return;
  }

  transferBusy=true;
  $('share-visit-loading').hidden=false;
  try{
    const result=await post('COTIZADOR_TRANSFERENCIA_CREAR',{payload});
    if(result?.status!=='ok'||!result.code)throw Error(result?.msg||'No se pudo generar el código.');
    showSharedTransfer(result,signature);
  }catch(error){
    $('share-visit-loading').hidden=true;
    $('share-visit-error').textContent=error?.message||'No se pudo compartir la visita.';
  }finally{
    transferBusy=false;
  }
}

function hasMeaningfulDraft(){
  if(String(state.project||'').trim()||state.items.length>1)return true;
  return state.items.some(item=>{
    const install=installationData(item);
    return Boolean(
      String(item.location||'').trim()||
      String(item.width||'').trim()||
      String(item.height||'').trim()||
      String(item.quantity||'1')!=='1'||
      item.coverlight||
      (item.addons||[]).length||
      rawPesos(item.manualCost||'0')!=='0'||
      rawPesos(item.extras||'0')!=='0'||
      install.mount||install.control||install.opening||install.note
    );
  });
}

function resetReceiveVisitDialog(){
  pendingTransferPreview=null;
  $('receive-visit-code').value='';
  $('receive-visit-error').textContent='';
  $('receive-visit-preview').hidden=true;
  $('receive-visit-entry').hidden=false;
  $('receive-draft-warning').hidden=true;
  $('receive-preview-project').textContent='';
  $('receive-preview-meta').textContent='';
  $('receive-preview-by').textContent='';
}

async function previewSharedVisit(){
  if(transferBusy)return;
  const code=normalizeTransferCode($('receive-visit-code').value);
  $('receive-visit-code').value=code;
  $('receive-visit-error').textContent='';
  if(code.length!==6){
    $('receive-visit-error').textContent='Escribe los 6 caracteres del código.';
    return;
  }

  transferBusy=true;
  setTransferBusy($('preview-transfer'),true,'Buscar visita');
  try{
    const result=await post('COTIZADOR_TRANSFERENCIA_PREVIEW',{code});
    if(result?.status!=='ok'||!result.payload)throw Error(result?.msg||'No se encontró la visita.');
    pendingTransferPreview=result;
    $('receive-visit-entry').hidden=true;
    $('receive-visit-preview').hidden=false;
    $('receive-preview-project').textContent=result.summary?.project||'Visita sin nombre';
    $('receive-preview-meta').textContent=(result.summary?.rooms||0)+' ambientes · '+(result.summary?.items||0)+' persianas';
    $('receive-preview-by').textContent='Compartida por '+(result.createdBy||'HomeEasy')+' · '+formatTransferExpiry(result.createdAt);
    $('receive-draft-warning').hidden=!hasMeaningfulDraft();
  }catch(error){
    $('receive-visit-error').textContent=error?.message||'No se pudo abrir ese código.';
  }finally{
    transferBusy=false;
    setTransferBusy($('preview-transfer'),false,'Buscar visita');
  }
}

function hydrateTransferredItem(raw){
  const originalFamily=String(raw?.family||'').trim();
  const family=availableFamilies().includes(originalFamily)?originalFamily:(availableFamilies()[0]||'onda');
  const existing=(catalog?.products||[]).find(p=>p.id===raw?.product&&p.family===family);
  const item={
    id:crypto.randomUUID(),
    roomId:String(raw?.roomId||crypto.randomUUID()),
    family,
    product:existing?String(raw.product):'',
    location:String(raw?.location||''),
    width:String(raw?.width||''),
    height:String(raw?.height||''),
    quantity:String(raw?.quantity||'1'),
    mode:'auto',
    manualCost:'',
    extras:'0',
    configuration:String(raw?.configuration||'standard'),
    coverlight:String(raw?.coverlight||''),
    addons:Array.isArray(raw?.addons)?raw.addons.slice():[],
    installation:installationData({installation:raw?.installation||{}})
  };

  if(!existing){
    item.configuration='standard';
    item.coverlight='';
    item.addons=[];
    item.needsReview=true;
    return item;
  }

  if(item.family==='enrollable'){
    item.configuration='standard';
    item.addons=[];
  }else{
    const validConfig=(existing.configurations||[]).some(c=>c.id===item.configuration);
    if(item.configuration!=='standard'&&!validConfig)item.configuration='standard';
    item.addons=item.addons.filter(id=>(existing.addons||[]).some(addon=>addon.id===id));
  }

  if(item.coverlight&&!(existing.coverlight||[]).some(cover=>cover.id===item.coverlight))item.coverlight='';
  item.mode=requiresManual(item)?'manual':'auto';
  return item;
}

function applyTransferredVisit(payload){
  const received=fresh();
  received.project=String(payload?.project||'');
  received.items=(payload?.items||[]).map(hydrateTransferredItem);
  if(!received.items.length)received.items=[newItem()];
  state=received;
  normalizeRoomIds();
  clearEngineCache();
  fillGlobals();
  render();
  saveNow();
  const needsReview=state.items.filter(item=>item.needsReview).length;
  if(needsReview){
    toast('Visita cargada. '+needsReview+' referencia'+(needsReview===1?' necesita':'s necesitan')+' revisión.');
  }else{
    toast('Visita recibida. Ya puedes continuar la cotización.');
  }
}

async function consumeSharedVisit(){
  if(transferBusy||!pendingTransferPreview)return;
  transferBusy=true;
  $('receive-visit-error').textContent='';
  setTransferBusy($('consume-transfer'),true,'Continuar con esta visita');
  try{
    const result=await post('COTIZADOR_TRANSFERENCIA_CONSUMIR',{code:pendingTransferPreview.code});
    if(result?.status!=='ok')throw Error(result?.msg||'No se pudo importar la visita.');
    const payload=pendingTransferPreview.payload;
    $('receive-visit-dialog').close();
    applyTransferredVisit(payload);
    pendingTransferPreview=null;
  }catch(error){
    $('receive-visit-error').textContent=error?.message||'No se pudo importar la visita.';
  }finally{
    transferBusy=false;
    setTransferBusy($('consume-transfer'),false,'Continuar con esta visita');
  }
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
  const baseProfit=Math.round(cost*gain/100);
  const baseSale=cost+baseProfit;
  const sale=state.roundSale?Math.ceil(baseSale/100000)*100000:baseSale;
  const profit=sale-cost;
  return {...q,installation,transport,cost,profit,sale,baseSale,gain,rounded:Boolean(state.roundSale)};
}

function renderCommercial(message=''){
  const quoteMatches=lastEngineSignature&&lastEngineSignature===engineSignature();
  const q=commercialQuote(quoteMatches?lastEngineQuote:null);
  lastQuote=q||null;

  document.querySelectorAll('.item-card').forEach(el=>{
    const stateIndex=state.items.findIndex(item=>item.id===el.dataset.id);
    const itemResult=stateIndex>=0?q?.items?.[stateIndex]:null;
    const unit=el.querySelector('[data-output=unit]');
    const total=el.querySelector('[data-output=total]');
    if(unit)unit.textContent=itemResult?.ok?cop(itemResult.unit):'—';
    if(total)total.textContent=itemResult?.ok?cop(itemResult.total):'—';
    const currentItem=stateIndex>=0?state.items[stateIndex]:null;
    const coverControls=el.querySelector('.enrollable-options');
    if(coverControls&&currentItem&&currentItem.mode!=='manual')coverControls.innerHTML=coverlightControls(currentItem);
    const fabricationOutput=el.querySelector('[data-output=fabrication]');
    if(fabricationOutput)fabricationOutput.innerHTML=renderFabricationNotice(currentItem,itemResult);
    const structuredFabricationError=Boolean(itemResult?.requiresAlternative||itemResult?.notManufacturable);
    el.querySelector('[data-output=error]').textContent=itemResult?.ok||structuredFabricationError?'':itemResult?.error||'';
  });

  const ok=Boolean(q?.ok);
  $('sum-products').textContent=ok?cop(q.products):'—';
  $('sum-installation').textContent=ok?cop(q.installation):'—';
  $('sum-transport').textContent=ok?cop(q.transport):'—';
  $('sum-cost').textContent=ok?cop(q.cost):'—';
  $('sum-gain').textContent=ok?cop(q.profit):'—';
  $('sum-sale').textContent=ok?cop(q.sale):'—';
  $('mobile-sale').textContent=ok?cop(q.sale):'Completar';

  const roundButton=$('round-sale');
  if(roundButton){
    roundButton.disabled=!ok;
    roundButton.classList.toggle('is-active',Boolean(state.roundSale));
    roundButton.setAttribute('aria-pressed',state.roundSale?'true':'false');
    const roundLabel=state.roundSale?'Quitar redondeo':'Redondear al siguiente $1.000';
    roundButton.title=roundLabel;
    roundButton.setAttribute('aria-label',roundLabel);
  }

  const gain=clampGain(state.gain);
  $('gain-label').textContent='Ganancia +'+gain+'%';
  $('gain-minus').disabled=gain<=10;
  $('gain-plus').disabled=gain>=100;

  $('result-message').classList.remove('calculating');
  $('result-message').textContent=ok?'':(message||q?.error||'Completa las medidas para calcular.');
  $('copy-sale').disabled=!ok;
  if($('formal-quote'))$('formal-quote').disabled=!ok;
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
  if(target.dataset.roomField==='location'){
    const room=target.closest('.room-card');
    if(!room)return;
    setRoomLocation(room.dataset.roomId,target.value);
    const title=room.querySelector('[data-room-title]');
    if(title)title.textContent=target.value||'Sin ambiente';
    save();
    return;
  }

  const field=target.dataset.field;
  if(!field||target.tagName==='SELECT'||target.type==='checkbox')return;
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
  if(item.family==='enrollable'&&(field==='width'||field==='height')){
    if(item.mode==='manual'&&item.specialAlternative){
      item.mode='auto';
      item.manualCost='';
      item.specialAlternative=null;
    }
    card.querySelector('[data-field=product]').innerHTML=productOptions(item);
    card.querySelector('.enrollable-options').innerHTML=coverlightControls(item);
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
      item.configuration='standard';
      resetComplements(item);
      item.manualCost='';
      item.specialAlternative=null;
      item.extras='0';
      item.mode=requiresManual(item)?'manual':'auto';
      if(field==='family'){
        const existing=installationData(item);
        const allowed=familyInstallationFields(item.family);
        item.installation={
          mount:existing.mount,
          control:allowed.control?existing.control:'',
          opening:allowed.opening?existing.opening:'',
          note:existing.note
        };
      }
    }
    if(field==='configuration'){
      resetComplements(item);
      item.manualCost='';
      item.extras='0';
      item.mode=requiresManual(item)?'manual':'auto';
    }
    render();
    return;
  }

  if(target.dataset.action==='coverlight-toggle'){
    item.coverlight=target.checked?(calculatedCovers(item)[0]?.id||''):'';
    render();
    return;
  }
  if(target.dataset.action==='addon-toggle'){
    const ids=new Set(item.addons||[]);
    if(target.checked)ids.add(target.dataset.addon);
    else ids.delete(target.dataset.addon);
    item.addons=Array.from(ids);
    scheduleQuote(0);
    return;
  }
  if(target.dataset.action==='manual-toggle'){
    resetComplements(item);
    if(requiresManual(item)){
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
  if(!button||['manual-toggle','coverlight-toggle','addon-toggle'].includes(button.dataset.action))return;

  if(button.dataset.action==='add-room-item'){
    if(state.items.length>=100){toast('Máximo 100 persianas.');return;}
    const room=button.closest('.room-card');
    if(!room)return;
    const group=roomGroups().find(g=>g.id===room.dataset.roomId);
    const previous=group?.items?.at(-1);
    if(!previous)return;
    const item=newRoomLayer(previous);
    const lastIndex=Math.max(...group.items.map(i=>state.items.indexOf(i)));
    state.items.splice(lastIndex+1,0,item);
    render();
    document.querySelector('[data-id="'+item.id+'"] [data-field=family]')?.focus();
    toast('Persiana agregada al mismo ambiente.');
    return;
  }

  const card=button.closest('.item-card');
  if(!card)return;
  const index=state.items.findIndex(i=>i.id===card.dataset.id);
  if(index<0)return;

  if(button.dataset.action==='installation'){
    openInstallationDialog(state.items[index]);
    return;
  }

  if(button.dataset.action==='special-cost'){
    const item=state.items[index];
    resetComplements(item);
    item.mode='manual';
    item.manualCost='';
    item.specialAlternative={id:button.dataset.altId||'',label:button.dataset.altLabel||'Configuración especial'};
    render();
    document.querySelector('[data-id="'+item.id+'"] [data-field=manualCost]')?.focus();
    toast('Ingresa el costo confirmado por Pentagrama.');
    return;
  }

  if(button.dataset.action==='cancel-special-cost'){
    const item=state.items[index];
    item.mode='auto';
    item.manualCost='';
    item.specialAlternative=null;
    render();
    return;
  }

  if(button.dataset.action==='duplicate'){
    if(state.items.length>=100){toast('Máximo 100 persianas.');return;}
    const source=state.items[index];
    const item={...source,id:crypto.randomUUID(),roomId:roomIdOf(source),addons:[...(source.addons||[])],installation:{...installationData(source)}};
    state.items.splice(index+1,0,item);
    render();
    document.querySelector('[data-id="'+item.id+'"] [data-field=product]')?.focus();
    toast('Persiana duplicada en este ambiente.');
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
  document.querySelector('[data-room-id="'+item.roomId+'"] [data-room-field=location]')?.focus();
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
$('round-sale').onclick=()=>{
  state.roundSale=!state.roundSale;
  save();
  renderCommercial();
};

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

$('share-visit').onclick=createSharedVisit;
$('close-share-visit').onclick=()=>$('share-visit-dialog').close();
$('copy-transfer-code').onclick=async()=>{
  const code=$('share-visit-code').textContent.trim();
  if(!code||code==='—')return;
  try{
    await navigator.clipboard.writeText(code);
    toast('Código copiado.');
  }catch(error){
    toast('No se pudo copiar. Mantén presionado el código.');
  }
};
$('share-transfer-code').onclick=async()=>{
  const code=$('share-visit-code').textContent.trim();
  if(!code||code==='—')return;
  const text=transferShareText(code);
  try{
    if(navigator.share){
      await navigator.share({text});
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Mensaje copiado. Ya puedes pegarlo en WhatsApp.');
  }catch(error){
    if(error?.name!=='AbortError')toast('No se pudo compartir el código.');
  }
};

$('receive-visit').onclick=()=>{
  resetReceiveVisitDialog();
  $('receive-visit-dialog').showModal();
  setTimeout(()=>$('receive-visit-code').focus(),60);
};
$('close-receive-visit').onclick=()=>$('receive-visit-dialog').close();
$('receive-visit-code').addEventListener('input',event=>{
  event.target.value=normalizeTransferCode(event.target.value);
  $('receive-visit-error').textContent='';
});
$('receive-visit-code').addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();previewSharedVisit();}
});
$('preview-transfer').onclick=previewSharedVisit;
$('receive-use-another').onclick=()=>{
  pendingTransferPreview=null;
  $('receive-visit-preview').hidden=true;
  $('receive-visit-entry').hidden=false;
  $('receive-visit-error').textContent='';
  $('receive-visit-code').focus();
};
$('consume-transfer').onclick=consumeSharedVisit;

$('close-copy').onclick=()=>$('copy-dialog').close();

function formalDescription(item,index,q){
  const product=q.items?.[index]?.product;
  const parts=[];
  const location=String(item.location||'').trim();
  if(location)parts.push(location);
  parts.push(familyLabels[item.family]||item.family||'Persiana');
  if(product?.name)parts.push(product.name);
  if(item.coverlight){
    const cover=calculatedCovers(item).find(c=>c.id===item.coverlight);
    const coverName=cleanCommercialComplementName(cover?.name||'Coverlight');
    parts.push('+ '+coverName);
  }
  if(item.width&&item.height)parts.push(whatsappMeasure(item.width)+' × '+whatsappMeasure(item.height)+' m');
  return parts.filter(Boolean).join(' · ');
}

function allocateFormalItemTotals(q){
  const totalPesos=Math.max(0,Math.round(Number(q.sale||0)/100));
  const weights=state.items.map((item,index)=>{
    const engineTotal=Number(q.items?.[index]?.total||0);
    if(engineTotal>0)return engineTotal;
    return Math.max(1,Number(item.quantity)||1);
  });
  const weightTotal=weights.reduce((sum,value)=>sum+value,0)||1;
  const raw=weights.map(weight=>totalPesos*weight/weightTotal);
  const allocations=raw.map(Math.floor);
  let remaining=totalPesos-allocations.reduce((sum,value)=>sum+value,0);
  raw.map((value,index)=>({index,fraction:value-Math.floor(value)}))
    .sort((a,b)=>b.fraction-a.fraction||a.index-b.index)
    .slice(0,remaining)
    .forEach(({index})=>allocations[index]++);
  return {totalPesos,allocations};
}

function formalRowsFromQuote(q){
  const {totalPesos,allocations}=allocateFormalItemTotals(q);
  const rows=state.items.map((item,index)=>{
    const quantity=Math.max(1,Math.round(Number(item.quantity)||1));
    const allocated=allocations[index]||0;
    return {
      description:formalDescription(item,index,q),
      quantity,
      unitPrice:Math.max(0,Math.round(allocated/quantity)),
      allocated
    };
  });

  let current=rows.reduce((sum,row)=>sum+row.quantity*row.unitPrice,0);
  let difference=totalPesos-current;
  const anchor=rows.find(row=>row.quantity===1&&row.unitPrice+difference>=0);
  if(anchor){
    anchor.unitPrice+=difference;
    difference=0;
  }

  if(difference===0){
    return rows.map(row=>({descripcion:row.description,cantidad:row.quantity,precio:row.unitPrice}));
  }

  // Caso poco común: todas las líneas tienen cantidad > 1 y el total no puede
  // cuadrar con un único valor unitario entero. Se divide solo la línea final necesaria.
  const exactRows=[];
  state.items.forEach((item,index)=>{
    const quantity=Math.max(1,Math.round(Number(item.quantity)||1));
    const allocated=allocations[index]||0;
    const base=Math.floor(allocated/quantity);
    const remainder=allocated-(base*quantity);
    const description=formalDescription(item,index,q);
    if(quantity-remainder>0)exactRows.push({descripcion:description,cantidad:quantity-remainder,precio:base});
    if(remainder>0)exactRows.push({descripcion:description,cantidad:remainder,precio:base+1});
  });
  return exactRows;
}

function createFormalQuoteTransfer(displayMode='individual'){
  const q=lastQuote;
  if(!q?.ok)return null;
  const rows=formalRowsFromQuote(q);
  const totalPesos=rows.reduce((sum,row)=>sum+(Number(row.cantidad)||0)*(Number(row.precio)||0),0);
  const installLines=installationObservationLines(q);
  return {
    version:1,
    createdAt:Date.now(),
    project:String(state.project||'').trim(),
    rounded:Boolean(state.roundSale),
    displayMode:displayMode==='total'?'total':'individual',
    totalPesos,
    observations:installLines.length?'Detalles de instalación:\n'+installLines.join('\n'):'',
    items:rows
  };
}

function whatsappMeasure(value){
  return String(value||'').trim().replace('.',',');
}

function buildWhatsAppProposal(q){
  const intro=state.project
    ? 'Te comparto la propuesta que preparamos para *'+String(state.project).trim()+'* en *HomeEasy*:'
    : 'Te comparto la propuesta que preparamos para ti en *HomeEasy*:';

  const groups=roomGroups();
  const roomBlocks=groups.map((group,roomIndex)=>{
    const location=String(group.items[0]?.location||'').trim();
    const roomTitle=location?'*'+location+'*':(groups.length>1?'*Ambiente '+(roomIndex+1)+'*':'');
    const products=group.items.map((item,layerIndex)=>{
      const index=state.items.indexOf(item);
      const product=q.items[index]?.product;
      const family=familyLabels[item.family]||item.family||'Persiana';
      const reference=(product?.name||'')+(product?.coverlight?' · con Coverlight':'');
      const prefix=group.items.length>1?(layerIndex+1)+'. ':'';
      return [
        '*'+prefix+family+(reference?' · '+reference:'')+'*',
        '• *Medidas:* '+whatsappMeasure(item.width)+' × '+whatsappMeasure(item.height)+' m',
        '• *Cantidad:* '+(item.quantity||1)
      ].join('\n');
    }).join('\n\n');
    return [roomTitle,products].filter(Boolean).join('\n');
  });

  const includes=[];
  if(q.installation)includes.push('instalación');
  if(q.transport)includes.push('transporte');

  let inclusion='';
  if(includes.length===1)inclusion='✅ Este valor incluye *'+includes[0]+'*.';
  if(includes.length===2)inclusion='✅ Este valor incluye *instalación y transporte*.';

  const blocks=[
    intro,
    roomBlocks.join('\n\n'),
    '💰 *Valor total: '+cop(q.sale)+'*'+(inclusion?'\n'+inclusion:''),
    'Si deseas, con gusto te ayudo a continuar con el pedido o resolver cualquier duda.'
  ].filter(Boolean);

  return blocks.join('\n\n');
}

$('install-dialog').addEventListener('click',event=>{
  const option=event.target.closest('[data-install-field][data-install-value]');
  if(!option||!installationDraft)return;
  const field=option.dataset.installField;
  const value=option.dataset.installValue;
  installationDraft[field]=installationDraft[field]===value?'':value;
  refreshInstallChoice(field);
});

$('save-install').onclick=()=>{
  const item=state.items.find(i=>i.id===installationEditingId);
  if(!item){$('install-dialog').close();return;}
  installationDraft.note=$('install-note').value.trim();
  item.installation={...installationDraft};
  saveNow();
  $('install-dialog').close();
  installationEditingId='';
  installationDraft=null;
  render({recalculate:false});
};

$('clear-install').onclick=()=>{
  if(!installationDraft)return;
  installationDraft={mount:'',control:'',opening:'',note:''};
  $('install-note').value='';
  ['mount','control','opening'].forEach(refreshInstallChoice);
};

$('cancel-install').onclick=()=>{
  $('install-dialog').close();
  installationEditingId='';
  installationDraft=null;
};

$('formal-quote').onclick=()=>{
  if(!lastQuote?.ok)return;
  $('formal-mode-dialog').showModal();
};

$('formal-mode-dialog').addEventListener('click',event=>{
  const option=event.target.closest('[data-formal-mode]');
  if(!option)return;
  const transfer=createFormalQuoteTransfer(option.dataset.formalMode);
  if(!transfer)return;
  try{
    sessionStorage.setItem(FORMAL_QUOTE_TRANSFER_KEY,JSON.stringify(transfer));
    $('formal-mode-dialog').close();
    window.location.assign('cotizacion.html?from=cotizador');
  }catch(e){
    toast('No se pudo abrir la cotización formal.');
  }
});

$('cancel-formal-mode').onclick=()=>$('formal-mode-dialog').close();

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
      if(existing){
        if(item.family==='enrollable'){
          item.configuration='standard';item.mode='auto';item.manualCost='';item.specialAlternative=null;item.extras='0';item.addons=[];
          if(item.coverlight&&!(existing.coverlight||[]).some(c=>c.id===item.coverlight))item.coverlight='';
          return item;
        }
        const configuration=(existing.configurations||[]).find(c=>c.id===(item.configuration||'standard'));
        if(item.configuration&&item.configuration!=='standard'&&!configuration){item.configuration='standard';resetComplements(item);}
        if(requiresManual(item)||item.mode==='manual')resetComplements(item);
        if(item.coverlight&&!(existing.coverlight||[]).some(c=>c.id===item.coverlight))item.coverlight='';
        item.addons=(item.addons||[]).filter(id=>(existing.addons||[]).some(a=>a.id===id));
        return item;
      }
      const family=firstProduct(item.family)?item.family:(availableFamilies()[0]||'onda');
      return {...item,family,product:family==='enrollable'?'':firstProduct(family)?.id||'',mode:'auto',configuration:'standard',coverlight:'',addons:[],manualCost:'',extras:''};
    });

    $('add-item').disabled=false;
    $('share-visit').disabled=false;
    $('receive-visit').disabled=false;
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
  engineCacheKey='homeeasy.cost-engine.v2:'+profile.uid;
  ready=true;
  loadDraft();
  normalizeRoomIds();
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
