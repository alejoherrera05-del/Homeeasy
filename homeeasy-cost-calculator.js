(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const API_URL=String(window.HomeEasyCore&&window.HomeEasyCore.API_URL||'https://script.google.com/macros/s/AKfycbyZHaIe7hb28KKtaPBORASy_maSZ2co8dZFce44GQRiZGYg_6WoU7qn4qC-lYCQO6ZL/exec');
 const familyLabels={onda:'Onda Serena',panel:'Panel Japonés',sheer:'Sheer Elegance',vertesse:'Sheer Vertesse',vertical:'Verticales'};
 const familyOrder=['onda','sheer','vertesse','panel','vertical'];
 const money=cents=>new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',minimumFractionDigits:0,maximumFractionDigits:2}).format((Number(cents)||0)/100);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fresh=()=>({version:1,project:'',items:[],transport:'0',installation:'0',margin:'30',installMode:'common',promotions:true});
 let state=fresh(),catalog=null,lastQuote=null,key='',ready=false,loading=false,saveTimer,toastTimer,undoItem=null,quoteTimer=null,requestSeq=0;

 function toast(message){$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',4000);}
 function save(){
   if(!key)return;clearTimeout(saveTimer);
   saveTimer=setTimeout(()=>{try{localStorage.setItem(key,JSON.stringify(state));$('save-state').textContent='Borrador guardado';}catch(e){$('save-state').textContent='No se pudo guardar';}},180);
 }
 function loadDraft(){try{const v=JSON.parse(localStorage.getItem(key));if(v?.version===1&&Array.isArray(v.items)&&v.items.length<=100)state={...fresh(),...v};}catch(e){toast('No se pudo recuperar el borrador anterior.');}}
 function availableFamilies(){const present=new Set((catalog?.products||[]).map(p=>p.family));return familyOrder.filter(f=>present.has(f));}
 function familyOptions(value){return availableFamilies().map(id=>'<option value="'+id+'" '+(id===value?'selected':'')+'>'+escape(familyLabels[id]||id)+'</option>').join('');}
 function productOptions(item){return (catalog?.products||[]).filter(p=>p.family===item.family).map(p=>'<option value="'+escape(p.id)+'" '+(p.id===item.product?'selected':'')+'>'+escape(p.name)+'</option>').join('');}
 function firstProduct(family){return (catalog?.products||[]).find(p=>p.family===family);}
 function chosen(item){return (catalog?.products||[]).find(p=>p.id===item.product);}
 function newItem(previous){
   const fallbackFamily=availableFamilies()[0]||'onda';
   const family=previous?.family&&firstProduct(previous.family)?previous.family:fallbackFamily;
   const previousProduct=previous?.product?(catalog?.products||[]).find(p=>p.id===previous.product):null;
   const product=previousProduct&&previousProduct.family===family?previousProduct.id:(firstProduct(family)?.id||'');
   return {id:crypto.randomUUID(),family,product,location:'',width:'',height:'',quantity:'1',mode:previous?.mode||'auto',manualCost:'',extras:'0',installation:state.installation};
 }
 function field(item,name,label,extra=''){
   const id=name+'-'+item.id;
   return '<div><label for="'+id+'">'+label+'</label><input id="'+id+'" data-field="'+name+'" value="'+escape(item[name])+'" '+extra+'></div>';
 }
 function renderItem(item,index){
   const p=chosen(item),manual=item.mode==='manual'||p?.method==='manual';
   const status=p?.method==='manual'?'<span class="status-pill warn">Confirmar costo</span>':(p?.status==='VIGENTE'?'<span class="status-pill ok">Tarifa automática</span>':'');
   return '<article class="item" data-id="'+escape(item.id)+'" aria-label="Persiana '+(index+1)+'">'+
     '<div class="item-top"><div><div class="item-kicker">Ventana '+(index+1)+'</div><h3>'+escape(item.location||'Nueva persiana')+'</h3></div><div class="item-actions"><button data-action="duplicate">Duplicar</button><button data-action="remove">Quitar</button></div></div>'+
     '<div class="item-grid">'+
       '<div class="family-field"><label for="family-'+item.id+'"><span class="step-dot">1</span> Producto</label><select id="family-'+item.id+'" data-field="family">'+familyOptions(item.family)+'</select></div>'+
       '<div class="fabric-field"><label for="product-'+item.id+'"><span class="step-dot">2</span> Tela / referencia</label><select id="product-'+item.id+'" data-field="product">'+productOptions(item)+'</select></div>'+
       '<div class="span-all config-line">'+status+'<span>'+escape(p?.configuration||'Selecciona una referencia')+'</span></div>'+
       '<div class="dimensions span-all">'+field(item,'width','<span class="step-dot">3</span> Ancho (m)','inputmode="decimal" placeholder="Ej. 1,80" autocomplete="off"')+field(item,'height','Alto (m)','inputmode="decimal" placeholder="Ej. 2,40" autocomplete="off"')+field(item,'quantity','Cantidad','inputmode="numeric" autocomplete="off"')+'</div>'+
       '<div class="span-all">'+field(item,'location','Ambiente <span>(opcional)</span>','placeholder="Ej. Sala" maxlength="80"')+'</div>'+
       '<div class="span-all" '+(state.installMode!=='individual'?'hidden':'')+'>'+field(item,'installation','Instalación por persiana · $','inputmode="decimal"')+'</div>'+
     '</div>'+
     '<div class="manual-field" '+(!manual?'hidden':'')+'>'+field(item,'manualCost','Costo confirmado por persiana · IVA incluido · $','inputmode="decimal" placeholder="Valor informado por Pentagrama"')+'<small>Úsalo cuando la medida o configuración requiera confirmación.</small></div>'+
     '<details '+(manual&&p?.method!=='manual'?'open':'')+'><summary>Opciones especiales</summary><div class="extras-grid">'+
       '<div><label for="mode-'+item.id+'">Origen del costo</label><select id="mode-'+item.id+'" data-field="mode"><option value="auto" '+(item.mode!=='manual'?'selected':'')+'>Tarifa automática</option><option value="manual" '+(item.mode==='manual'?'selected':'')+'>Costo confirmado</option></select></div>'+
       '<div '+(manual?'hidden':'')+'>'+field(item,'extras','Accesorios por persiana · IVA incluido · $','inputmode="decimal"')+'</div></div><small>Motores, confecciones especiales u otros accesorios pueden requerir costo confirmado.</small></details>'+
     '<div class="item-result"><div><small>Costo HomeEasy por persiana</small><strong data-output="unit">—</strong></div><div><small>Total de este ítem</small><strong data-output="total">—</strong></div></div>'+
     '<p class="item-error" data-output="error" role="status"></p></article>';
 }
 function render(){
   $('items').innerHTML=state.items.map(renderItem).join('');
   $('item-count').textContent='('+state.items.length+')';
   $('common-install').hidden=state.installMode==='individual';$('individual-hint').hidden=state.installMode!=='individual';
   scheduleQuote(0);save();
 }
 function setCalculating(){$('result-message').textContent='Calculando con las tarifas privadas de HomeEasy…';$('result-message').classList.add('calculating');}
 async function post(tipo,payload={}){
   const response=await fetch(API_URL,{method:'POST',cache:'no-store',body:JSON.stringify({tipo,...payload})});
   const data=await response.json().catch(()=>({status:'error',msg:'HomeEasy respondió con datos no válidos.'}));
   if(!response.ok)throw Error(data.msg||data.error||('HTTP '+response.status));
   return data;
 }
 function applyQuote(q,message=''){
   lastQuote=q||null;
   document.querySelectorAll('.item').forEach((el,index)=>{
     const r=q?.items?.[index];
     el.querySelector('[data-output=unit]').textContent=r?.ok?money(r.unit):'—';
     el.querySelector('[data-output=total]').textContent=r?.ok?money(r.total):'—';
     el.querySelector('[data-output=error]').textContent=r?.ok?'':r?.error||'';
   });
   const ok=Boolean(q?.ok);
   for(const name of ['products','installation','transport','cost','sale','profit'])$('sum-'+name).textContent=ok?money(q[name]):'—';
   $('mobile-sale').textContent=ok?money(q.sale):'Completar';
   $('result-message').classList.remove('calculating');
   $('result-message').textContent=ok?'Precio actualizado. IVA incluido.':(message||q?.error||'Completa las medidas para calcular.');
   $('copy-sale').disabled=!ok;
   document.querySelectorAll('[data-margin]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.margin)===Number(String(state.margin).replace(',','.'))));
 }
 function scheduleQuote(delay=220){
   save();clearTimeout(quoteTimer);
   if(!catalog)return;
   setCalculating();
   quoteTimer=setTimeout(runQuote,delay);
 }
 async function runQuote(){
   const seq=++requestSeq;
   try{
     const data=await post('COSTOS_CALCULAR_COTIZACION',{items:state.items,transport:state.transport,installation:state.installation,margin:state.margin,installMode:state.installMode,promotions:state.promotions});
     if(seq!==requestSeq)return;
     applyQuote(data.quote,data.status==='ok'?'':data.msg);
   }catch(e){
     if(seq!==requestSeq)return;
     applyQuote(null,'No se pudo calcular ahora. Revisa tu conexión e intenta de nuevo.');
   }
 }
 function fillGlobals(){
   for(const name of ['project','transport','installation','margin'])$(name).value=state[name];
   $('promotions').checked=state.promotions;
   document.querySelectorAll('[name=install-mode]').forEach(input=>input.checked=input.value===state.installMode);
 }
 $('items').addEventListener('input',event=>{
   const field=event.target.dataset.field;if(!field||event.target.tagName==='SELECT')return;
   const item=state.items.find(i=>i.id===event.target.closest('.item').dataset.id);if(!item)return;
   item[field]=event.target.value;scheduleQuote();
 });
 $('items').addEventListener('change',event=>{
   const field=event.target.dataset.field;if(!field||event.target.tagName!=='SELECT')return;
   const item=state.items.find(i=>i.id===event.target.closest('.item').dataset.id);if(!item)return;
   item[field]=event.target.value;
   if(field==='family'){item.product=firstProduct(item.family)?.id||'';item.mode='auto';}
   if(field==='family'||field==='product'){item.manualCost='';item.extras='0';}
   render();document.querySelector('[data-id="'+item.id+'"] [data-field="'+field+'"]')?.focus();
 });
 $('items').addEventListener('click',event=>{
   const button=event.target.closest('[data-action]');if(!button)return;
   const index=state.items.findIndex(i=>i.id===button.closest('.item').dataset.id);if(index<0)return;
   if(button.dataset.action==='duplicate'){
     if(state.items.length>=100){toast('Máximo 100 ítems por cotización.');return;}
     const item={...state.items[index],id:crypto.randomUUID(),location:''};state.items.splice(index+1,0,item);render();
     document.querySelector('[data-id="'+item.id+'"] [data-field=width]')?.focus();toast('Persiana duplicada. Cambia solo lo necesario.');
   }else{
     undoItem={item:state.items[index],index};state.items.splice(index,1);render();
     $('toast').replaceChildren(document.createTextNode('Persiana eliminada. '));
     const undo=document.createElement('button');undo.textContent='Deshacer';undo.onclick=()=>{if(undoItem){state.items.splice(undoItem.index,0,undoItem.item);undoItem=null;render();$('toast').textContent='';}};
     $('toast').append(undo);clearTimeout(toastTimer);
   }
 });
 $('add-item').onclick=()=>{if(state.items.length>=100){toast('Máximo 100 ítems.');return;}const item=newItem(state.items.at(-1));state.items.push(item);render();document.querySelector('[data-id="'+item.id+'"] [data-field=width]')?.focus();};
 for(const name of ['project','transport','installation','margin'])$(name).addEventListener('input',e=>{state[name]=e.target.value;scheduleQuote();});
 $('promotions').onchange=e=>{state.promotions=e.target.checked;scheduleQuote(0);};
 document.querySelectorAll('[name=install-mode]').forEach(input=>input.onchange=()=>{
   if(input.value==='individual'&&state.installMode==='common')state.items.forEach(i=>i.installation=state.installation);
   state.installMode=input.value;render();
 });
 document.querySelectorAll('[data-margin]').forEach(b=>b.onclick=()=>{state.margin=b.dataset.margin;$('margin').value=state.margin;scheduleQuote(0);});
 $('new-quote').onclick=()=>$('new-dialog').showModal();$('cancel-new').onclick=()=>$('new-dialog').close();
 $('confirm-new').onclick=()=>{state=fresh();if(catalog)state.items=[newItem()];fillGlobals();render();$('new-dialog').close();};
 $('close-copy').onclick=()=>$('copy-dialog').close();
 $('copy-sale').onclick=async()=>{
   const q=lastQuote;if(!q?.ok)return;
   const lines=['Propuesta HomeEasy',state.project,...state.items.map((item,index)=>(index+1)+'. '+(familyLabels[item.family]||item.family)+' · '+q.items[index].product.name+(item.location?' · '+item.location:'')+'\n'+item.width+' × '+item.height+' m · Cantidad: '+item.quantity),
    'Precio total: '+money(q.sale)+' · IVA incluido.',q.installation?'Incluye instalación.':'',q.transport?'Incluye transporte.':'','Sujeto a disponibilidad y confirmación de fabricación.'].filter(Boolean);
   const text=lines.join('\n\n');
   try{await navigator.clipboard.writeText(text);toast('Propuesta copiada. Tus costos y utilidad no se comparten.');}catch(e){$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').select();}
 };
 async function connect(){
   if(loading||!ready)return;loading=true;$('retry').hidden=true;
   try{
     const payload=await post('COSTOS_OPCIONES');
     if(payload.status!=='ok'||!Array.isArray(payload.products))throw Error(payload.msg||'No se pudo cargar el catálogo.');
     catalog={products:payload.products,validThrough:payload.validThrough,version:payload.version,currency:payload.currency};
     $('connection').hidden=true;
     $('catalog-note').textContent='Tarifas privadas de Pentagrama. HomeEasy consulta el costo necesario sin descargar el catálogo completo al dispositivo.';
     $('tariff-date').textContent='Catálogo '+catalog.version+' · vigente hasta '+catalog.validThrough+'.';
     if(!state.items.length)state.items.push(newItem());
     else state.items=state.items.map(i=>{
       const existing=(catalog.products||[]).find(p=>p.id===i.product);
       if(existing)return i;
       const fam=firstProduct(i.family)?i.family:(availableFamilies()[0]||'onda');
       return {...i,family:fam,product:firstProduct(fam)?.id||''};
     });
     $('add-item').disabled=false;fillGlobals();render();
   }catch(e){$('connection').hidden=false;$('connection').firstChild.textContent='No se pudo abrir el catálogo de costos. Tu borrador sigue guardado. ';$('retry').hidden=false;}
   finally{loading=false;}
 }
 function start(){
   if(ready||window.HomeEasyPageGuard?.getStatus()!=='authorized')return;
   const profile=window.HomeEasyAuth?.getHomeEasyProfile?.()||window.HomeEasyAuth?.getCurrentUser?.()||window.HomeEasyAuth?.getCurrentProfile?.();
   if(!profile?.uid){$('connection').firstChild.textContent='No se pudo identificar tu usuario. Vuelve a ingresar a HomeEasy.';return;}
   key='homeeasy.cost-draft.v2:'+profile.uid;ready=true;loadDraft();fillGlobals();connect();
 }
 $('retry').onclick=connect;window.addEventListener('homeeasy:page-auth-ready',start);window.addEventListener('online',()=>{if(!catalog)connect();});
 window.addEventListener('pagehide',()=>{if(key){clearTimeout(saveTimer);try{localStorage.setItem(key,JSON.stringify(state));}catch(e){}}});
 window.addEventListener('pageshow',()=>{if(catalog)scheduleQuote(0);});start();
})();