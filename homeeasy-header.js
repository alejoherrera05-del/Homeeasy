(function(){
  'use strict';

  document.documentElement.setAttribute('data-he-app-header','1');

  const file=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const configs={
    'calendario.html':{module:'Agenda',hide:['body > header'],move:['body > header .header-icons']},
    'ventas.html':{module:'Control comercial',hide:['body > .app-header'],move:['#refreshBtn']},
    'configuracion.html':{module:'Configuración',hideRows:['#settingsApp > .app-header > .header-inner'],move:['#settingsApp > .app-header .lock-wrap']},
    'documentos.html':{module:'Centro documental',hide:['body > .topbar'],move:['#refreshBtn']},
    'seguimiento.html':{module:'Seguimiento comercial',hide:['body > .app-header'],move:['body > .app-header .btn-refresh']},
    'reportes.html':{module:'Reportes',hideRows:['.report-header .header-main']},
    'cotizador-persianas.html':{module:'Cotizador',hide:['body > .app-header'],move:['#save-state']},
    'perfil.html':{module:'Mi perfil',hide:['body > .header']},
    'caja.html':{module:'Caja',hideRows:['.caja-header .header-top'],move:['.caja-header .btn-lock-caja']},
    'hommychat.html':{module:'Hommy',hide:['.hommy-app > .app-header'],move:['.hommy-app > .app-header .header-actions']},
    'ar-homeeasy-v3.html':{module:'Visualizador AR',hide:['body > .topbar'],move:['body > .topbar .top-link']},
    'clientes.html':{module:'Clientes',hide:['.v31-header','.header-mini'],move:['.v31-new-search']},
    'cotizacion.html':{module:'Cotización'},
    'pedido.html':{module:'Orden de pedido'},
    'abono.html':{module:'Recibos y abonos'}
  };
  const cfg=configs[file];
  if(!cfg) return;

  const backSelectors=[
    '#btn-back','#back-button','#back','.v31-back',
    '.btn-back-cover[href="index.html"]','.header-round[href="index.html"]',
    '.back-btn[href="index.html"]','.btn-back[href="index.html"]',
    '.round[href="index.html"]','.back[href="index.html"]'
  ];

  function findBack(){
    for(const selector of backSelectors){
      const el=document.querySelector(selector);
      if(el && !el.closest('#homeeasy-app-header')) return el;
    }
    return null;
  }

  function goBack(){
    const source=findBack();
    if(source){
      try{
        source.click();
        return;
      }catch(error){}
      const href=source.getAttribute && source.getAttribute('href');
      if(href){
        location.href=href;
        return;
      }
    }
    if(window.HomeEasyCore && typeof window.HomeEasyCore.goHome==='function'){
      window.HomeEasyCore.goHome();
      return;
    }
    location.href='index.html';
  }

  function createHeader(){
    if(document.getElementById('homeeasy-app-header') || !document.body) return;
    document.body.classList.add('he-app-header-active');
    if(['cotizacion.html','pedido.html','abono.html'].includes(file)) document.body.classList.add('he-document-page');

    const oldGlobal=document.getElementById('homeeasy-global-back');
    if(oldGlobal) oldGlobal.remove();

    const header=document.createElement('header');
    header.id='homeeasy-app-header';
    header.innerHTML=`
      <div class="he-app-header-inner">
        <div class="he-app-header-left">
          <button class="he-app-header-back" type="button" aria-label="Volver">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"></path></svg>
          </button>
        </div>
        <div class="he-app-header-brand" aria-label="HomeEasy · ${cfg.module}">
          <span class="he-app-header-mark" aria-hidden="true">
            <img class="he-app-header-logo" src="triangulogold.png" alt="">
          </span>
          <span class="he-app-header-wordmark">HomeEasy</span>
          <span class="he-app-header-divider" aria-hidden="true"></span>
          <span class="he-app-header-module">${cfg.module}</span>
        </div>
        <div class="he-app-header-actions" aria-label="Acciones"></div>
      </div>`;
    header.querySelector('.he-app-header-back').addEventListener('click',goBack);
    document.body.insertBefore(header,document.body.firstChild);
  }

  function moveActions(){
    const target=document.querySelector('#homeeasy-app-header .he-app-header-actions');
    if(!target) return;
    (cfg.move||[]).forEach(selector=>{
      const source=document.querySelector(selector);
      if(!source || source.closest('#homeeasy-app-header')) return;
      source.removeAttribute('style');
      target.appendChild(source);
    });
  }

  function hideLegacy(){
    (cfg.hide||[]).forEach(selector=>{
      document.querySelectorAll(selector).forEach(el=>{
        if(!el.closest('#homeeasy-app-header')) el.classList.add('he-legacy-header-hidden');
      });
    });
    (cfg.hideRows||[]).forEach(selector=>{
      document.querySelectorAll(selector).forEach(el=>{
        if(!el.closest('#homeeasy-app-header')) el.classList.add('he-legacy-header-row-hidden');
      });
    });
  }

  function sync(){
    createHeader();
    moveActions();
    hideLegacy();
    const oldGlobal=document.getElementById('homeeasy-global-back');
    if(oldGlobal) oldGlobal.remove();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',sync,{once:true});
  else sync();

  const observer=new MutationObserver(sync);
  const watch=()=>document.body&&observer.observe(document.body,{childList:true,subtree:true});
  if(document.body) watch();
  else document.addEventListener('DOMContentLoaded',watch,{once:true});
})();