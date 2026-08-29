from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'clientes.html'
GUARD = ROOT / 'homeeasy-page-guard.js'
OUTPUT = ROOT / 'clientes-conectado-v31.html'

html = SOURCE.read_text(encoding='utf-8')
guard = GUARD.read_text(encoding='utf-8')

# Keep the original HomeEasy search screen and all operational logic, but this
# test page must own its auth identity instead of being redirected to clientes.html.
html = html.replace('<script src="homeeasy-page-guard.js?v=3.6"></script>', '')
html = html.replace(
    'content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
    1,
)

# Make the inline guard treat this preview exactly as Clientes for RBAC/meta,
# while keeping the physical preview URL untouched.
guard = re.sub(
    r"const currentPage = \(\(global\.location[\s\S]*?\.trim\(\);",
    "const currentPage = 'clientes.html';",
    guard,
    count=1,
)
if "const currentPage = 'clientes.html';" not in guard:
    raise SystemExit('No se pudo fijar identidad clientes.html en el guard')

inline_guard = '<script id="clientes-v31-inline-guard">\n' + guard + '\n</script>'
html = html.replace('</head>', inline_guard + '\n</head>', 1)

# Keep history/navigation inside this preview.
html = html.replace(
    "window.history.replaceState({}, '', `clientes.html?search=${cedula}`);",
    "window.history.replaceState({}, '', window.location.pathname + '?search=' + encodeURIComponent(cedula));",
)
html = html.replace(
    "window.history.replaceState({}, '', 'clientes.html');",
    "window.history.replaceState({}, '', window.location.pathname);",
)

STYLE = r'''
<style id="clientes-connected-v31-style">
:root{--he-pink:#B2566C;--he-pink-dark:#94485a;--he-pink-soft:#f7edf0;--he-gold:#c2a468;--he-gold-soft:#fbf5e7;--he-ink:#1d1d1f;--he-muted:#7f7f85;--he-line:#e8e6e7;--he-bg:#f6f6f7;--he-card:#fff;--he-green:#23765f;--he-green-soft:#eaf6ef}
body.clientes-connected-v31 #pantalla-resultados{padding:100px 0 calc(36px + env(safe-area-inset-bottom,0px))!important;background:var(--he-bg)!important;min-height:100dvh!important}
body.clientes-connected-v31 #pantalla-resultados>.container{width:min(calc(100% - 24px),720px)!important;max-width:720px!important;padding:0!important}
body.clientes-connected-v31 .header-mini{height:auto!important;min-height:82px!important;padding:calc(env(safe-area-inset-top,0px) + 11px) max(12px,calc((100vw - 720px)/2)) 11px!important;background:rgba(246,246,247,.92)!important;-webkit-backdrop-filter:blur(22px) saturate(160%)!important;backdrop-filter:blur(22px) saturate(160%)!important;border-bottom:1px solid rgba(60,60,67,.07)!important;box-shadow:none!important}
body.clientes-connected-v31 .header-mini .mini-brand{color:var(--he-ink)!important;font-size:20px!important;font-weight:780!important;letter-spacing:-.03em!important;gap:9px!important}
body.clientes-connected-v31 .header-mini .mini-brand img{width:25px!important;height:auto!important}
body.clientes-connected-v31 .header-mini>button{height:42px!important;padding:0 15px!important;border-radius:999px!important;background:#fff!important;border:1px solid rgba(178,86,108,.42)!important;color:var(--he-pink)!important;font-size:13px!important;font-weight:720!important;box-shadow:none!important}
body.clientes-connected-v31 .client-card.v31-source-card{display:none!important}
.v31-contact{background:#fff;border:1px solid rgba(60,60,67,.07);border-radius:26px;padding:21px 18px 17px;box-shadow:0 14px 36px rgba(25,22,23,.05)}
.v31-identity{display:grid;grid-template-columns:70px minmax(0,1fr) 40px;gap:14px;align-items:center}
.v31-avatar{width:70px;height:70px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,#faf6f6,#f4e7ea);color:var(--he-pink);font-size:32px;font-weight:760;position:relative}
.v31-avatar img{max-width:33px;max-height:33px;object-fit:contain}
.v31-name{font-size:25px;line-height:1.08;font-weight:810;letter-spacing:-.045em;color:var(--he-ink);margin:0}
.v31-id{margin-top:6px;font-size:14px;color:var(--he-muted);font-weight:580}
.v31-more{width:39px;height:39px;border-radius:50%;border:1px solid var(--he-line);background:#fafafa;color:var(--he-pink);font-size:17px;font-weight:800}
.v31-contact-list{margin-top:18px;border-top:1px solid var(--he-line)}
.v31-row{display:grid;grid-template-columns:38px 84px minmax(0,1fr);gap:8px;align-items:center;min-height:55px;border-bottom:1px solid var(--he-line)}
.v31-row:last-child{border-bottom:0}.v31-icon{width:34px;height:34px;border-radius:11px;background:var(--he-pink-soft);display:grid;place-items:center;color:var(--he-pink);font-size:14px}.v31-label{font-size:12px;color:var(--he-muted);font-weight:650}.v31-value{font-size:15px;color:var(--he-ink);font-weight:650;line-height:1.3;overflow-wrap:anywhere}
.v31-actions{display:grid;grid-template-columns:1fr 50px;gap:10px;margin-top:16px}.v31-whatsapp{height:50px;border:0;border-radius:17px;background:var(--he-pink);color:#fff;font-size:16px;font-weight:760;display:flex;align-items:center;justify-content:center;gap:9px}.v31-secondary{height:50px;border-radius:50%;border:1px solid var(--he-line);background:#fff;color:var(--he-pink);font-size:18px}
.v31-summary{margin-top:13px;min-height:64px;background:#fff;border:1px solid rgba(60,60,67,.07);border-radius:20px;padding:11px 15px;display:flex;align-items:center;gap:11px;box-shadow:0 9px 24px rgba(25,22,23,.035)}.v31-summary-icon{width:38px;height:38px;border-radius:12px;background:var(--he-gold-soft);color:var(--he-gold);display:grid;place-items:center;flex:0 0 auto}.v31-summary-text{font-size:14px;line-height:1.35;color:var(--he-ink);font-weight:620}.v31-summary-text b{font-weight:800}.v31-summary-text .pending{color:var(--he-pink)}
.v31-history{margin-top:15px}.v31-tabs{display:grid;grid-template-columns:1fr 1fr;background:#eaeaec;border-radius:16px;padding:3px;margin:0 0 12px}.v31-tab{height:44px;border:0;border-radius:13px;background:transparent;color:#77777d;font-size:15px;font-weight:700}.v31-tab.active{background:#fff;color:var(--he-pink);box-shadow:0 2px 8px rgba(0,0,0,.05)}
.v31-list{display:none}.v31-list.active{display:block}.v31-order{background:#fff;border:1px solid rgba(60,60,67,.07);border-radius:24px;margin-bottom:14px;overflow:hidden;box-shadow:0 10px 28px rgba(25,22,23,.04)}.v31-order-main{padding:18px 17px 14px}.v31-order-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.v31-code{font-size:18px;font-weight:820;letter-spacing:-.025em}.v31-status{padding:6px 10px;border-radius:999px;font-size:10px;font-weight:820;letter-spacing:.035em}.v31-status.active{background:var(--he-green-soft);color:var(--he-green)}.v31-status.done{background:#eef0f1;color:#5f6468}.v31-status.cancel{background:#faeeee;color:#a44854}.v31-status.quote{background:var(--he-gold-soft);color:#866b2f}
.v31-desc{margin-top:11px;font-size:14px;line-height:1.45;color:#525257;font-weight:560}.v31-date{margin-top:8px;display:flex;align-items:center;gap:7px;color:var(--he-muted);font-size:12px}.v31-finance{display:grid;grid-template-columns:minmax(120px,.8fr) 1.2fr;gap:15px;margin-top:15px;padding-top:15px;border-top:1px solid var(--he-line)}.v31-total{padding-right:13px;border-right:1px solid var(--he-line)}.v31-flabel{font-size:11px;color:var(--he-muted);font-weight:650}.v31-total-value{font-size:25px;font-weight:830;letter-spacing:-.045em;margin-top:4px;white-space:nowrap}.v31-paid-head{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#555}.v31-progress{height:7px;border-radius:999px;background:#e4e4e6;margin-top:8px;overflow:hidden}.v31-progress span{display:block;height:100%;background:var(--he-pink);border-radius:inherit}.v31-balance-label{margin-top:11px;font-size:11px;color:var(--he-pink);font-weight:680}.v31-balance{font-size:20px;color:var(--he-pink);font-weight:820;letter-spacing:-.035em;margin-top:2px}
.v31-payments{margin-top:14px;border:1px solid var(--he-line);border-radius:17px;overflow:hidden;background:#fff}.v31-payments-toggle{width:100%;height:46px;border:0;background:#fcfaf9;color:var(--he-pink);display:flex;align-items:center;justify-content:space-between;padding:0 13px;font-size:13px;font-weight:760}.v31-payments-body{max-height:360px;overflow:hidden;transition:max-height .28s ease}.v31-payments.collapsed .v31-payments-body{max-height:0}.v31-pay-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center;min-height:62px;padding:9px 12px;border-top:1px solid var(--he-line);background:#fff}.v31-pay-icon{width:32px;height:32px;border-radius:10px;background:var(--he-gold-soft);color:var(--he-gold);display:grid;place-items:center;font-size:13px}.v31-pay-name{font-size:13px;font-weight:650}.v31-pay-meta{font-size:10px;color:var(--he-muted);margin-top:3px}.v31-pay-right{text-align:right}.v31-pay-amount{font-size:13px;font-weight:750}.v31-receipt{font-size:10px;color:var(--he-pink);font-weight:700;margin-top:4px}.v31-pay-total{min-height:46px;padding:0 12px;border-top:1px dashed var(--he-line);display:flex;align-items:center;justify-content:space-between;color:var(--he-muted);font-size:12px}.v31-pay-total b{font-size:14px;color:var(--he-ink)}
.v31-order-footer{min-height:50px;border-top:1px solid var(--he-line);display:flex;align-items:center;justify-content:center}.v31-doc{border:0;background:transparent;color:var(--he-pink);font-size:13px;font-weight:760;display:flex;align-items:center;gap:7px}.v31-empty{background:#fff;border:1px solid var(--he-line);border-radius:20px;padding:30px 18px;text-align:center;color:var(--he-muted);font-size:13px}
.v31-sheet-backdrop{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.2);display:none;align-items:flex-end;padding:12px}.v31-sheet-backdrop.open{display:flex}.v31-sheet{width:min(100%,520px);margin:0 auto;background:#f6f6f7;border-radius:22px;padding:8px}.v31-sheet button{width:100%;height:50px;border:0;background:#fff;border-bottom:1px solid var(--he-line);color:var(--he-ink);font-size:15px;font-weight:650}.v31-sheet button:first-child{border-radius:15px 15px 0 0}.v31-sheet button:nth-child(3){border-radius:0 0 15px 15px;border-bottom:0}.v31-sheet .cancel{margin-top:8px;border-radius:15px!important;border:0;color:var(--he-pink);font-weight:760}
@media(max-width:420px){body.clientes-connected-v31 #pantalla-resultados{padding-top:92px!important}.v31-contact{padding:19px 16px 16px}.v31-identity{grid-template-columns:62px minmax(0,1fr) 38px;gap:11px}.v31-avatar{width:62px;height:62px;font-size:28px}.v31-name{font-size:22px}.v31-row{grid-template-columns:35px 70px minmax(0,1fr)}.v31-summary-text{font-size:13px}.v31-finance{grid-template-columns:1fr 1.1fr;gap:12px}.v31-total-value{font-size:23px}.v31-balance{font-size:19px}}
</style>
'''
html = html.replace('</head>', STYLE + '\n</head>', 1)

SCRIPT = r'''
<script id="clientes-connected-v31-script">
(function(){
'use strict';
document.body.classList.add('clientes-connected-v31');
const state={OP:[],COT:[]};
const $=id=>document.getElementById(id);
const clean=v=>String(v??'').trim();
const num=v=>{const n=Number(String(v??'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
const money=v=>'$'+Math.round(num(v)).toLocaleString('es-CO');
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
function initials(name){return clean(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'C'}
function emailValue(v){return /sincorreo|no registrado/i.test(clean(v))?'Sin correo registrado':clean(v)||'Sin correo registrado'}
function phoneDigits(v){let d=clean(v).replace(/\D/g,'');if(d.length===10&&d.startsWith('3'))d='57'+d;return d}
function row(icon,label,value){const r=el('div','v31-row');const i=el('div','v31-icon');i.innerHTML='<i class="'+icon+'"></i>';r.append(i,el('div','v31-label',label),el('div','v31-value',value||'No registrado'));return r}
function statusClass(s,prefix){s=clean(s).toUpperCase();if(prefix==='COT')return 'quote';if(s.includes('ANUL'))return 'cancel';if(s.includes('COMPLET')||s.includes('PAG'))return 'done';return 'active'}
function statusText(s,prefix){const x=clean(s).toUpperCase();return x|| (prefix==='COT'?'REGISTRADA':'ACTIVO')}
function detailText(item){return clean(item.detalle||item.descripcion)||'Sin detalles'}
function buildPayments(item){const wrap=el('div','v31-payments collapsed');const btn=el('button','v31-payments-toggle');btn.type='button';const details=Array.isArray(item.abonos_detalle)?item.abonos_detalle:[];btn.innerHTML='<span><i class="fa-regular fa-credit-card me-2"></i>'+details.length+' abono'+(details.length===1?'':'s')+'</span><i class="fa-solid fa-chevron-up"></i>';const body=el('div','v31-payments-body');let paid=0;if(!details.length){body.append(el('div','v31-empty','No hay abonos registrados.'))}else{details.forEach(p=>{const val=num(p.valor);paid+=val;const pr=el('div','v31-pay-row');const pi=el('div','v31-pay-icon');pi.innerHTML='<i class="'+(String(p.recibo||'').toUpperCase()==='INICIAL'?'fa-regular fa-file-lines':'fa-solid fa-building-columns')+'"></i>';const mid=el('div');mid.append(el('div','v31-pay-name',String(p.recibo||'').toUpperCase()==='INICIAL'?'Abono inicial':(clean(p.tipoRegistro)||clean(p.recibo)||'Abono')),el('div','v31-pay-meta',clean(p.fecha)||'Sin fecha'));const right=el('div','v31-pay-right');right.append(el('div','v31-pay-amount',money(val)));if(p.url&&String(p.recibo||'').toUpperCase()!=='INICIAL'){const a=el('div','v31-receipt','Ver recibo ›');a.addEventListener('click',e=>{e.stopPropagation();if(typeof abrirVisorPDF==='function')abrirVisorPDF(p.url)});right.append(a)}pr.append(pi,mid,right);body.append(pr)});const tot=el('div','v31-pay-total');tot.append(el('span','', 'Total abonado'),el('b','',money(paid)));body.append(tot)}wrap.append(btn,body);btn.addEventListener('click',()=>wrap.classList.toggle('collapsed'));return wrap}
function orderCard(item,prefix){const card=el('article','v31-order');const main=el('div','v31-order-main');const head=el('div','v31-order-head');const code=item.numero_op||item.numero||item.numero_cotizacion||'S/N';head.append(el('div','v31-code',(prefix==='OP'?'OP ':'COT ')+code),el('div','v31-status '+statusClass(item.estado,prefix),statusText(item.estado,prefix)));main.append(head,el('div','v31-desc',detailText(item)));const date=el('div','v31-date');date.innerHTML='<i class="fa-regular fa-calendar"></i><span>'+(item.fecha?new Date(item.fecha).toLocaleDateString('es-CO'):'Sin fecha')+'</span>';main.append(date);const total=Math.max(0,num(item.total));if(prefix==='OP'){const saldo=Math.max(0,num(item.saldo));const paid=Math.max(0,total-saldo);const pct=total?Math.min(100,Math.round((paid/total)*100)):0;const fin=el('div','v31-finance');const left=el('div','v31-total');left.append(el('div','v31-flabel','Total'),el('div','v31-total-value',money(total)));const right=el('div');const ph=el('div','v31-paid-head');ph.innerHTML='<span>Abonado <b>'+money(paid)+'</b></span><span>'+pct+'%</span>';const prog=el('div','v31-progress');const bar=el('span');bar.style.width=pct+'%';prog.append(bar);right.append(ph,prog,el('div','v31-balance-label','Saldo'),el('div','v31-balance',money(saldo)));fin.append(left,right);main.append(fin,buildPayments(item))}else{const fin=el('div','v31-finance');fin.style.gridTemplateColumns='1fr';const left=el('div','v31-total');left.style.borderRight='0';left.append(el('div','v31-flabel','Valor cotizado'),el('div','v31-total-value',money(total)));fin.append(left);main.append(fin)}card.append(main);const footer=el('div','v31-order-footer');const doc=el('button','v31-doc');doc.type='button';doc.innerHTML='<i class="fa-regular fa-file-pdf"></i><span>'+(prefix==='OP'?'Ver OP':'Ver cotización')+'</span><i class="fa-solid fa-chevron-right"></i>';const url=item.pdf_url||item.url||'';doc.addEventListener('click',()=>{if(url&&typeof abrirVisorPDF==='function')abrirVisorPDF(url)});footer.append(doc);card.append(footer);return card}
function buildWorkspace(){const result=$('resultado_cliente');const source=result?.querySelector('.client-card');if(!result||!source)return;source.classList.add('v31-source-card');result.querySelectorAll('.v31-contact,.v31-summary,.v31-history').forEach(n=>n.remove());const name=clean($('c_nombre')?.textContent);const id=clean($('c_cedula')?.textContent);const phone=clean($('c_tel')?.textContent);const email=emailValue($('c_email')?.textContent);const address=clean($('c_dir')?.textContent)||'Sin dirección registrada';const contact=el('section','v31-contact');const ident=el('div','v31-identity');ident.append(el('div','v31-avatar',initials(name)));const who=el('div');who.append(el('h1','v31-name',name||'Cliente'),el('div','v31-id','C.C. '+(id||'Sin identificación')));const more=el('button','v31-more');more.type='button';more.innerHTML='<i class="fa-solid fa-ellipsis"></i>';ident.append(who,more);const list=el('div','v31-contact-list');list.append(row('fa-solid fa-phone','Teléfono',phone),row('fa-solid fa-location-dot','Dirección',address),row('fa-regular fa-envelope','Correo',email));const actions=el('div','v31-actions');const wa=el('button','v31-whatsapp');wa.type='button';wa.innerHTML='<i class="fa-brands fa-whatsapp"></i><span>WhatsApp</span>';wa.addEventListener('click',()=>{const d=phoneDigits(phone);if(d)window.open('https://wa.me/'+d,'_blank','noopener,noreferrer')});const more2=el('button','v31-secondary');more2.type='button';more2.innerHTML='<i class="fa-solid fa-ellipsis"></i>';actions.append(wa,more2);contact.append(ident,list,actions);const ops=state.OP.filter(x=>!clean(x.estado).toUpperCase().includes('ANUL'));const total=ops.reduce((s,x)=>s+num(x.total),0);const saldo=ops.reduce((s,x)=>s+Math.max(0,num(x.saldo)),0);const sum=el('section','v31-summary');const si=el('div','v31-summary-icon');si.innerHTML='<i class="fa-solid fa-bag-shopping"></i>';const st=el('div','v31-summary-text');st.innerHTML='Comprado <b>'+money(total)+'</b> &nbsp;·&nbsp; Pendiente <b class="pending">'+money(saldo)+'</b>';sum.append(si,st);const hist=el('section','v31-history');const tabs=el('div','v31-tabs');const t1=el('button','v31-tab active','Órdenes '+state.OP.length);const t2=el('button','v31-tab','Cotizaciones '+state.COT.length);tabs.append(t1,t2);const l1=el('div','v31-list active');const l2=el('div','v31-list');if(state.OP.length)state.OP.forEach(x=>l1.append(orderCard(x,'OP')));else l1.append(el('div','v31-empty','Sin órdenes registradas'));if(state.COT.length)state.COT.forEach(x=>l2.append(orderCard(x,'COT')));else l2.append(el('div','v31-empty','Sin cotizaciones registradas'));t1.addEventListener('click',()=>{t1.classList.add('active');t2.classList.remove('active');l1.classList.add('active');l2.classList.remove('active')});t2.addEventListener('click',()=>{t2.classList.add('active');t1.classList.remove('active');l2.classList.add('active');l1.classList.remove('active')});hist.append(tabs,l1,l2);result.insertBefore(contact,source);result.insertBefore(sum,source);result.append(hist);document.querySelector('.header-mini .mini-brand')?.replaceChildren(document.createTextNode('Clientes'));const hb=document.querySelector('.header-mini>button');if(hb)hb.textContent='Nueva búsqueda';function openSheet(){let b=document.querySelector('.v31-sheet-backdrop');if(!b){b=el('div','v31-sheet-backdrop');const s=el('div','v31-sheet');[['Editar',()=>typeof abrirModalEditar==='function'&&abrirModalEditar()],['Copiar datos',()=>navigator.clipboard?.writeText([name,id,phone,email,address].join('\n'))],['Compartir',async()=>{if(navigator.share)await navigator.share({title:name,text:[name,phone,email,address].join('\n')})}]].forEach(([label,fn])=>{const bt=el('button','',label);bt.addEventListener('click',()=>{b.classList.remove('open');fn()});s.append(bt)});const cancel=el('button','cancel','Cancelar');cancel.addEventListener('click',()=>b.classList.remove('open'));s.append(cancel);b.append(s);b.addEventListener('click',e=>{if(e.target===b)b.classList.remove('open')});document.body.append(b)}b.classList.add('open')}more.addEventListener('click',openSheet);more2.addEventListener('click',openSheet)}
if(typeof renderLista==='function'){const original=renderLista;window.renderLista=function(items,containerId,prefix){state[prefix]=Array.isArray(items)?items:[];const out=original.apply(this,arguments);queueMicrotask(buildWorkspace);return out}}
if(typeof buscarHistorial==='function'){const orig=buscarHistorial;window.buscarHistorial=async function(){const out=await orig.apply(this,arguments);requestAnimationFrame(buildWorkspace);return out}}
window.addEventListener('DOMContentLoaded',()=>document.body.classList.add('clientes-connected-v31'),{once:true});
})();
</script>
'''
html = html.replace('</body>', SCRIPT + '\n</body>', 1)

# Contracts: real operational page retained, preview identity isolated, new design present.
checks = {
 'original search retained': 'Hommybuscando.png' in html and 'Buscar Cliente' in html,
 'operational history retained': 'HISTORIAL_CLIENTE' in html,
 'edit retained': 'actualizar_cliente' in html,
 'annul retained': 'ANALIZAR_ANULACION_DOCUMENTO' in html,
 'inline guard': 'clientes-v31-inline-guard' in html and "const currentPage = 'clientes.html';" in html,
 'no shared guard': 'homeeasy-page-guard.js?v=3.6' not in html,
 'connected design': 'clientes-connected-v31-script' in html and 'v31-payments' in html,
 'homeeasy color': '#B2566C' in html,
 'real icons': 'fa-solid fa-phone' in html and 'fa-location-dot' in html,
}
failed=[k for k,v in checks.items() if not v]
if failed: raise SystemExit('Contracts failed: '+', '.join(failed))
OUTPUT.write_text(html,encoding='utf-8',newline='\n')
print('Generated',OUTPUT,OUTPUT.stat().st_size,'bytes')
for k in checks: print('OK',k)
