(function ClientesV2Preview(){
  'use strict';

  document.body.classList.add('clientes-v2-preview');
  const state={OP:[],COT:[]};
  let toastTimer=null;

  const $=id=>document.getElementById(id);
  const clean=value=>String(value??'').trim();
  const numeric=value=>{
    const parsed=Number(String(value??'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(parsed)?parsed:0;
  };
  const money=value=>'$'+Math.round(numeric(value)).toLocaleString('es-CO');
  const initials=name=>clean(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'C';

  function phoneDigits(raw){
    let digits=clean(raw).replace(/\D/g,'');
    if(digits.length===10&&digits.startsWith('3')) digits='57'+digits;
    return digits;
  }

  function contactText(){
    const email=clean($('c_email')?.textContent);
    return [
      clean($('c_nombre')?.textContent),
      'Cédula: '+clean($('c_cedula')?.textContent),
      'Teléfono: '+clean($('c_tel')?.textContent),
      'Correo: '+(email||'Sin correo registrado'),
      'Dirección: '+clean($('c_dir')?.textContent)
    ].join('\n');
  }

  function toast(message){
    let node=document.querySelector('.v2-toast');
    if(!node){node=document.createElement('div');node.className='v2-toast';document.body.appendChild(node)}
    node.textContent=message;
    requestAnimationFrame(()=>node.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>node.classList.remove('is-visible'),1500);
  }

  async function copy(value){
    try{
      if(navigator.clipboard&&window.isSecureContext) await navigator.clipboard.writeText(value);
      else{
        const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
      }
      toast('Datos copiados');
    }catch(error){toast('No se pudo copiar')}
  }

  function el(tag,className,text){
    const node=document.createElement(tag);
    if(className) node.className=className;
    if(text!==undefined) node.textContent=text;
    return node;
  }

  function iconButton(icon,label,handler){
    const button=el('button','v2-action');button.type='button';button.setAttribute('aria-label',label);
    const i=el('i',icon);i.setAttribute('aria-hidden','true');
    button.append(i,el('span','',label));button.addEventListener('click',handler);return button;
  }

  function contactRow(icon,label,value){
    const row=el('div','v2-contact-row');
    const ico=el('div','v2-contact-icon');ico.append(el('i',icon));
    row.append(ico,el('div','v2-contact-label',label),el('div','v2-contact-value',value||'No registrado'));
    return row;
  }

  function metric(label,value,extra){
    const box=el('div','v2-metric'+(extra?' '+extra:''));
    box.append(el('div','v2-metric-label',label),el('div','v2-metric-value',value));
    return box;
  }

  function financeCell(label,value,extra){
    const box=el('div','v2-finance-cell'+(extra?' '+extra:''));
    box.append(el('div','v2-finance-label',label),el('div','v2-finance-value',value));
    return box;
  }

  function normalizeEmail(value){
    return /sincorreo|no registrado/i.test(clean(value))?'Sin correo registrado':clean(value)||'Sin correo registrado';
  }

  function prepareHeader(){
    const brand=document.querySelector('.header-mini .mini-brand');
    if(brand){brand.textContent='Clientes';brand.setAttribute('aria-label','Volver a HomeEasy')}
    const button=document.querySelector('.header-mini > button');
    if(button) button.textContent='Buscar otro';
  }

  function updateTab(tabId,label,count){
    const tab=$(tabId);if(!tab)return;
    tab.replaceChildren();
    tab.append(el('span','',label),el('span','v2-tab-count',String(count||0)));
  }

  function buildProfile(){
    const result=$('resultado_cliente');
    const source=result?.querySelector('.client-card');
    const tabContent=result?.querySelector('.tab-content');
    const tabs=source?.querySelector('.nav-tabs-custom')||result?.querySelector('.v2-history-shell .nav-tabs-custom');
    if(!result||!source||!tabContent||!tabs)return;

    source.classList.add('v2-source-card');
    result.querySelectorAll('.v2-profile-card,.v2-summary-card').forEach(node=>node.remove());

    const name=clean($('c_nombre')?.textContent);
    const id=clean($('c_cedula')?.textContent);
    const phone=clean($('c_tel')?.textContent);
    const email=normalizeEmail($('c_email')?.textContent);
    const address=clean($('c_dir')?.textContent)||'Sin dirección registrada';

    if($('c_email')) $('c_email').textContent=email;

    const profile=el('section','v2-profile-card');
    profile.append(el('div','v2-eyebrow','Cliente HomeEasy'));
    const head=el('div','v2-profile-head');
    head.append(el('div','v2-avatar',initials(name)));
    const identity=el('div','');identity.append(el('h2','v2-profile-name',name||'Cliente'),el('div','v2-profile-id','C.C. '+(id||'Sin identificación')));
    const edit=el('button','v2-edit-button');edit.type='button';edit.setAttribute('aria-label','Editar cliente');edit.append(el('i','fas fa-pen'));edit.addEventListener('click',()=>typeof abrirModalEditar==='function'&&abrirModalEditar());
    head.append(identity,edit);profile.append(head);

    const contacts=el('div','v2-contact-list');
    contacts.append(
      contactRow('fas fa-phone','Teléfono',phone||'No registrado'),
      contactRow('fas fa-envelope','Correo',email),
      contactRow('fas fa-location-dot','Dirección',address)
    );
    profile.append(contacts);

    const actions=el('div','v2-actions');
    actions.append(
      iconButton('fab fa-whatsapp','WhatsApp',()=>{const digits=phoneDigits(phone);if(digits)window.open('https://wa.me/'+digits,'_blank','noopener,noreferrer');else toast('Sin teléfono válido')}),
      iconButton('fas fa-phone','Llamar',()=>{const digits=phoneDigits(phone);if(digits)window.location.href='tel:+'+digits;else toast('Sin teléfono válido')}),
      iconButton('fas fa-copy','Copiar',()=>copy(contactText())),
      iconButton('fas fa-share-nodes','Compartir',async()=>{const value=contactText();if(navigator.share){try{await navigator.share({title:'Cliente HomeEasy',text:value});return}catch(error){if(error?.name==='AbortError')return}}await copy(value)})
    );
    profile.append(actions);

    const validOps=state.OP.filter(item=>!clean(item?.estado).toUpperCase().includes('ANUL'));
    const validQuotes=state.COT.filter(item=>!clean(item?.estado).toUpperCase().includes('ANUL'));
    const total=validOps.reduce((sum,item)=>sum+numeric(item?.total),0);
    const saldo=validOps.reduce((sum,item)=>sum+Math.max(0,numeric(item?.saldo)),0);

    const summary=el('section','v2-summary-card');
    const sectionHead=el('div','v2-section-head');
    const titles=el('div','');titles.append(el('div','v2-section-title','Resumen comercial'),el('div','v2-section-subtitle','Lectura rápida del historial del cliente'));
    sectionHead.append(titles,el('div','v2-live-pill','Datos actuales'));summary.append(sectionHead);
    const metrics=el('div','v2-metrics');
    metrics.append(metric('Compras',money(total)),metric('Saldo',money(saldo),'is-balance'),metric('Órdenes',String(validOps.length)));
    summary.append(metrics);

    result.insertBefore(profile,source);
    result.insertBefore(summary,source);

    let history=result.querySelector('.v2-history-shell');
    if(!history){
      history=el('section','v2-history-shell');
      const historyHead=el('div','v2-history-head');historyHead.append(el('div','v2-history-title','Actividad'),el('div','v2-history-subtitle','Órdenes, pagos y cotizaciones del cliente'));
      history.append(historyHead,tabs);
      result.insertBefore(history,tabContent);
    }
    updateTab('ordenes-tab','Órdenes',validOps.length);
    updateTab('cotizaciones-tab','Cotizaciones',validQuotes.length);
    prepareHeader();
  }

  function decorateCards(prefix){
    const container=$(prefix==='OP'?'lista_ordenes':'lista_cotizaciones');
    const items=state[prefix]||[];
    if(!container)return;
    container.querySelectorAll('.item-card').forEach((card,index)=>{
      card.querySelectorAll('.v2-finance,.v2-payments-toggle').forEach(node=>node.remove());
      const item=items[index]||{};
      const total=Math.max(0,numeric(item.total));
      const saldo=Math.max(0,numeric(item.saldo));
      const annulled=clean(item.estado).toUpperCase().includes('ANUL');
      const footer=card.querySelector('.item-footer');
      if(!footer)return;

      const finance=el('div','v2-finance');
      if(prefix==='OP'){
        const paid=annulled?0:Math.max(0,total-saldo);
        finance.append(financeCell('Total',money(total)),financeCell('Abonado',money(paid)),financeCell('Saldo',annulled?'Anulada':money(saldo),'is-balance'));
      }else{
        finance.style.gridTemplateColumns='1fr 1fr';
        finance.append(financeCell('Valor',money(total)),financeCell('Estado',clean(item.estado)||'Registrada'));
      }
      footer.before(finance);

      if(prefix==='OP'){
        const history=card.querySelector('.payment-history');
        if(history){
          const count=history.querySelectorAll('.payment-item').length;
          const toggle=el('button','v2-payments-toggle');toggle.type='button';
          toggle.append(el('span','',count?`Ver pagos · ${count}`:'Ver pagos'),el('i','fas fa-chevron-down'));
          toggle.addEventListener('click',event=>{
            event.stopPropagation();
            if(typeof togglePagos==='function') togglePagos(history.id);
            const icon=toggle.querySelector('i');if(icon)icon.className=history.style.display==='block'?'fas fa-chevron-up':'fas fa-chevron-down';
          });
          finance.after(toggle);
        }
      }
    });
  }

  function refresh(){
    buildProfile();decorateCards('OP');decorateCards('COT');
  }

  if(typeof renderLista==='function'){
    const original=renderLista;
    window.renderLista=function(items,containerId,prefix){
      state[prefix]=Array.isArray(items)?items:[];
      const value=original.apply(this,arguments);
      queueMicrotask(refresh);
      return value;
    };
  }

  if(typeof buscarHistorial==='function'){
    const originalSearch=buscarHistorial;
    window.buscarHistorial=async function(){
      const value=await originalSearch.apply(this,arguments);
      requestAnimationFrame(refresh);
      return value;
    };
  }

  window.addEventListener('DOMContentLoaded',()=>{
    document.body.classList.add('clientes-v2-preview');
    prepareHeader();
  },{once:true});
})();
