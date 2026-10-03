(function(){
  'use strict';
  const GLOBAL_ID='homeeasy-global-back';
  const HIDDEN_CLASS='he-original-back-hidden';
  const selectors=[
    '#btn-back',
    '#back-button',
    '#back',
    '.v31-back',
    '.btn-back-cover[href="index.html"]',
    '.header-round[href="index.html"]',
    '.back-btn[href="index.html"]',
    '.btn-back[href="index.html"]',
    '.round[href="index.html"]',
    '.back[href="index.html"]'
  ];

  function candidates(){
    const seen=new Set();
    const list=[];
    selectors.forEach(selector=>{
      document.querySelectorAll(selector).forEach(node=>{
        if(!node || node.id===GLOBAL_ID || seen.has(node)) return;
        seen.add(node);
        list.push(node);
      });
    });
    return list;
  }

  function hideSources(){
    candidates().forEach(node=>{
      node.classList.add(HIDDEN_CLASS);
      node.setAttribute('aria-hidden','true');
      node.tabIndex=-1;
    });
  }

  function proxyBack(){
    const list=candidates();
    const source=list.find(node=>node.isConnected);
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

  function mount(){
    if(!document.body) return;
    hideSources();
    let button=document.getElementById(GLOBAL_ID);
    if(button) return;
    button=document.createElement('button');
    button.id=GLOBAL_ID;
    button.type='button';
    button.setAttribute('aria-label','Volver');
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"></path></svg>';
    button.addEventListener('click',proxyBack);
    document.body.appendChild(button);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();

  const observer=new MutationObserver(()=>{
    hideSources();
    if(!document.getElementById(GLOBAL_ID)) mount();
  });
  const startObserver=()=>document.body&&observer.observe(document.body,{childList:true,subtree:true});
  if(document.body) startObserver();
  else document.addEventListener('DOMContentLoaded',startObserver,{once:true});
})();