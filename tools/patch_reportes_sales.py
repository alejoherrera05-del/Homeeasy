from pathlib import Path
import re

report = Path('reportes-diseno-v4.html')
ventas = Path('ventas.html')
r = report.read_text(encoding='utf-8')
v = ventas.read_text(encoding='utf-8')

# ---------------- REPORTES ----------------
marker = ".strip-item.growth.negative .strip-value{color:var(--red)}"
addition = marker + ".strip-item.actionable{cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}.strip-item.actionable:focus-visible,.winner.actionable:focus-visible{outline:3px solid rgba(178,86,108,.20);outline-offset:3px}.winner.actionable{cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}.strip-item.actionable:hover,.winner.actionable:hover{transform:translateY(-2px);box-shadow:0 16px 38px rgba(47,34,39,.08)}"
if marker in r and '.strip-item.actionable{' not in r:
    r = r.replace(marker, addition, 1)

old_strip = '<section class="period-strip"><article class="strip-item"><div class="strip-icon"><i class="fa-solid fa-wallet"></i></div><div class="strip-content"><div class="strip-label">Recaudado en el periodo</div><div class="strip-value" id="collected">$0</div><div class="strip-note">Dinero efectivamente recibido.</div></div></article><article class="strip-item portfolio"><div class="strip-icon"><i class="fa-solid fa-hand-holding-dollar"></i></div><div class="strip-content"><div class="strip-label">Cartera actual</div><div class="strip-value" id="portfolio">$0</div><div class="strip-note">Saldo pendiente global de órdenes activas.</div></div></article><article class="strip-item growth" id="growthCard"><div class="strip-icon"><i class="fa-solid fa-arrow-trend-up"></i></div><div class="strip-content"><div class="strip-label">Variación comercial</div><div class="strip-value" id="growth">0%</div><div class="strip-note">Frente al periodo inmediatamente anterior.</div></div></article></section>'
new_strip = '<section class="period-strip"><article class="strip-item"><div class="strip-icon"><i class="fa-solid fa-wallet"></i></div><div class="strip-content"><div class="strip-label">Recaudado en el periodo</div><div class="strip-value" id="collected">$0</div><div class="strip-note">Dinero efectivamente recibido.</div></div></article><article class="strip-item portfolio actionable" id="portfolioCard" role="button" tabindex="0" aria-label="Ver órdenes activas del periodo"><div class="strip-icon"><i class="fa-solid fa-hand-holding-dollar"></i></div><div class="strip-content"><div class="strip-label">Cartera actual</div><div class="strip-value" id="portfolio">$0</div><div class="strip-note" id="portfolioNote">Saldo pendiente de OP activas del periodo.</div></div></article><article class="strip-item growth" id="growthCard"><div class="strip-icon"><i class="fa-solid fa-arrow-trend-up"></i></div><div class="strip-content"><div class="strip-label">Variación comercial</div><div class="strip-value" id="growth">0%</div><div class="strip-note">Frente al periodo inmediatamente anterior.</div></div></article></section>'
if old_strip not in r:
    raise SystemExit('No se encontró period-strip esperado en reportes')
r = r.replace(old_strip, new_strip, 1)

old_winner = '<section class="winner"><div class="winner-kicker"><span class="crown"><i class="fa-solid fa-crown"></i></span><span>OP ganadora del periodo</span></div><div class="winner-amount" id="winnerAmount">$0</div><div class="winner-detail" id="winnerDetail">Sin ventas registradas en este periodo</div><div class="winner-note">La venta individual más alta del periodo.</div></section>'
new_winner = '<section class="winner actionable" id="winnerCard" role="button" tabindex="0" aria-label="Abrir OP ganadora en historial"><div class="winner-kicker"><span class="crown"><i class="fa-solid fa-crown"></i></span><span>OP ganadora del periodo</span></div><div class="winner-amount" id="winnerAmount">$0</div><div class="winner-detail" id="winnerDetail">Sin ventas registradas en este periodo</div><div class="winner-note" id="winnerNote">La venta individual más alta del periodo.</div></section>'
if old_winner not in r:
    raise SystemExit('No se encontró winner esperado en reportes')
r = r.replace(old_winner, new_winner, 1)

old_globals = "let metaVentas=0,dataFinanzas=null,customStart=null,customEnd=null,previousPeriod='este_mes';const $=id=>document.getElementById(id),money=n=>'$'+Math.round(Number(n)||0).toLocaleString('es-CO'),compact=n=>'$'+((Number(n)||0)/1e6).toLocaleString('es-CO',{maximumFractionDigits:1})+' M',dateText=d=>d.toLocaleDateString('es-CO');"
new_globals = "let metaVentas=0,dataFinanzas=null,ventasHistorial=null,lastMetrics=null,customStart=null,customEnd=null,previousPeriod='este_mes';const $=id=>document.getElementById(id),money=n=>'$'+Math.round(Number(n)||0).toLocaleString('es-CO'),compact=n=>'$'+((Number(n)||0)/1e6).toLocaleString('es-CO',{maximumFractionDigits:1})+' M',dateText=d=>d.toLocaleDateString('es-CO');"
if old_globals not in r:
    raise SystemExit('No se encontró globals esperado en reportes')
r = r.replace(old_globals, new_globals, 1)

helper_code = r'''
async function cargarHistorialVentas(){try{if(!window.HomeEasyCore||!HomeEasyCore.get)throw new Error('HomeEasyCore no disponible');const d=await HomeEasyCore.get({init:'LOAD',t:Date.now()},{timeoutMs:45000});if(!d||d.status!=='ok'||!Array.isArray(d.ordenes)||!Array.isArray(d.ordenes[0]))throw new Error('Ordenes_Pedido no disponible');const headers=d.ordenes[0].map(x=>String(x??'').trim()),index={};headers.forEach((name,i)=>{if(name)index[name]=i});const required=['Fecha','Numero_OP','Nombre_Cliente','Saldo_Pendiente','Estado'];const missing=required.filter(k=>index[k]===undefined);if(missing.length)throw new Error('Faltan columnas: '+missing.join(', '));ventasHistorial={index,rows:d.ordenes.slice(1).filter(row=>String(row[index.Numero_OP]??'').trim()!=='')}}catch(e){console.warn('Historial de ventas para cartera',e);ventasHistorial=null}}
function histGet(row,key){const i=ventasHistorial?.index?.[key];return i===undefined?'':row[i]}function histNumber(v){if(typeof v==='number')return Number.isFinite(v)?v:0;const raw=String(v??'').replace(/[^0-9.-]/g,''),n=Number(raw);return Number.isFinite(n)?n:0}function histStatus(row){return String(histGet(row,'Estado')||'').toUpperCase().trim()}function histOp(row){return String(histGet(row,'Numero_OP')??'').replace(/\.0$/,'')}function findHistoryByOp(n){const key=String(n??'').replace(/\.0$/,'');return ventasHistorial?.rows?.find(row=>histOp(row)===key)||null}function activeHistoryForRange(rg){return ventasHistorial?.rows?.filter(row=>{if(histStatus(row)!=='ACTIVO')return false;const d=parseDate(histGet(row,'Fecha'));return d&&d>=rg.inicio&&d<=rg.fin})||[]}
function ymd(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}function hydrateReportState(){const q=new URLSearchParams(location.search),allowed=new Set(['este_mes','mes_pasado','esta_semana','semana_pasada','este_anio','personalizado']),p=q.get('periodo');if(p&&allowed.has(p)){if(p==='personalizado'){const s=q.get('desde'),e=q.get('hasta'),sd=s?new Date(s+'T00:00:00'):null,ed=e?new Date(e+'T23:59:59'):null;if(sd&&ed&&!Number.isNaN(sd.getTime())&&!Number.isNaN(ed.getTime())&&ed>=sd){customStart=sd;customEnd=ed;$('periodo').value=p;previousPeriod=p;return}}else{$('periodo').value=p;previousPeriod=p}}}function syncReportUrl(){const u=new URL(location.href),p=$('periodo').value;u.searchParams.set('periodo',p);if(p==='personalizado'&&customStart&&customEnd){u.searchParams.set('desde',ymd(customStart));u.searchParams.set('hasta',ymd(customEnd))}else{u.searchParams.delete('desde');u.searchParams.delete('hasta')}history.replaceState({periodo:p},'',u.pathname+u.search+u.hash)}function reportReturnTarget(){syncReportUrl();return location.pathname+location.search+location.hash}function fullMonth(rg){return rg.inicio.getDate()===1&&rg.inicio.getFullYear()===rg.fin.getFullYear()&&rg.inicio.getMonth()===rg.fin.getMonth()&&rg.fin.getDate()===new Date(rg.inicio.getFullYear(),rg.inicio.getMonth()+1,0).getDate()}function ventasUrl(kind,opNumber){const rg=lastMetrics?.rg||ranges($('periodo').value),u=new URL('ventas.html',location.href);u.searchParams.set('from',ymd(rg.inicio));u.searchParams.set('to',ymd(rg.fin));u.searchParams.set('return',reportReturnTarget());u.searchParams.set('context',kind);if(rg.inicio.getFullYear()===rg.fin.getFullYear())u.searchParams.set('year',String(rg.inicio.getFullYear()));if(fullMonth(rg))u.searchParams.set('month',String(rg.inicio.getMonth()));if(kind==='cartera'){u.searchParams.set('status','ACTIVO');u.searchParams.set('sort','BALANCE_DESC')}if(kind==='winner'&&opNumber){u.searchParams.set('search',String(opNumber));u.searchParams.set('op',String(opNumber))}return u.href}function bindAction(id,handler){const el=$(id);el.addEventListener('click',handler);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handler()}})}
'''
if 'async function cargarHistorialVentas()' not in r:
    r = r.replace('function ranges(p){', helper_code + '\nfunction ranges(p){', 1)

new_procesar = r'''function procesar(){
if(!dataFinanzas)return;
const rg=ranges($('periodo').value),vp=Array(12).fill(0),pagos={};let va=0,vprev=0,ra=0,vh=0,rh=0,w=null;const year=new Date().getFullYear();
dataFinanzas.ordenes.forEach(op=>{if(op.estado==='ANULADA')return;const f=parseDate(op.fecha);if(!f)return;const total=parseFloat(op.total)||0,ai=parseFloat(op.abonoInicial)||0;vh+=total;rh+=ai;if(f.getFullYear()===year)vp[f.getMonth()]+=total;if(f>=rg.inicio&&f<=rg.fin){va+=total;ra+=ai;if(ai>0)pagos['PAGO INICIAL (OP)']=(pagos['PAGO INICIAL (OP)']||0)+ai;if(!w||total>(parseFloat(w.total)||0))w=op}if(f>=rg.prevInicio&&f<=rg.prevFin)vprev+=total});
dataFinanzas.abonos.forEach(ab=>{const f=parseDate(ab.fecha);if(!f)return;const v=parseFloat(ab.valor)||0;rh+=v;if(f>=rg.inicio&&f<=rg.fin){ra+=v;const m=ab.medio?String(ab.medio).toUpperCase().trim():'OTRO';pagos[m]=(pagos[m]||0)+v}});
const activeRows=activeHistoryForRange(rg),car=ventasHistorial?activeRows.reduce((s,row)=>s+Math.max(0,histNumber(histGet(row,'Saldo_Pendiente'))),0):Math.max(0,vh-rh),raw=metaVentas>0?va/metaVentas*100:0,pct=Math.min(raw,100),rem=Math.max(metaVentas-va,0),gr=growth(va,vprev),best=Math.max(...vp,0),bi=best>0?vp.indexOf(best):-1;
const winnerHistory=w?findHistoryByOp(w.numero):null,winnerName=String(winnerHistory?histGet(winnerHistory,'Nombre_Cliente'):(w?.nombreCliente||w?.cliente||w?.nombre||'')).trim(),winnerOp=w?String(w.numero??'').replace(/\.0$/,''):'';
$('dateDisplay').textContent=`Mostrando: ${dateText(rg.inicio)} - ${dateText(rg.fin)}`;$('goalKicker').textContent=`Meta de ventas · ${rg.texto}`;$('goalTotal').textContent=money(metaVentas);$('goalAchieved').textContent=money(va);$('goalRemaining').innerHTML=rem===0?'¡Meta cumplida! <strong>Superamos el objetivo del periodo.</strong>':`Nos faltan <strong>${money(rem)}</strong> para cumplir la meta.`;$('goalPct').textContent=pct.toLocaleString('es-CO',{maximumFractionDigits:1})+'%';$('goalIndex').textContent=`${Math.round(pct)} de cada 100`;$('ring').style.background=`conic-gradient(var(--brand) 0 ${pct}%,#E9E6E7 ${pct}% 100%)`;$('hommyBubble').innerHTML=bubble(pct);$('collected').textContent=money(ra);$('portfolio').textContent=money(car);$('portfolioNote').textContent=ventasHistorial?`${activeRows.length} ${activeRows.length===1?'OP activa':'OP activas'} · saldo pendiente del periodo. Haz clic para ver ${activeRows.length===1?'la orden':'las órdenes'}.`:'No se pudo leer el saldo detallado; mostrando estimación histórica.';$('growth').textContent=gr.text;$('growthCard').classList.toggle('negative',gr.value<0);$('winnerAmount').textContent=w?money(parseFloat(w.total)||0):'$0';$('winnerDetail').textContent=w?`${winnerName?winnerName+' · ':''}OP #${winnerOp||'—'} · ${dateText(parseDate(w.fecha))}`:'Sin ventas registradas en este periodo';$('winnerNote').textContent=w?'La venta individual más alta del periodo. Haz clic para abrir la OP.':'No hay una OP ganadora en este periodo.';$('readGrowth').textContent=gr.text;$('readGrowth').className=`reading-value ${gr.cls}`;$('readGoal').textContent=pct.toLocaleString('es-CO',{maximumFractionDigits:1})+'%';$('readGoalText').textContent=rem===0?'La meta del periodo ya fue alcanzada.':`Quedan ${compact(rem)} para llegar a la meta del periodo.`;$('bestMonth').textContent=bi>=0?monthNames[bi]:'—';$('bestMonthText').textContent=bi>=0?`${monthNames[bi]} lidera el año con ${compact(best)} en OP.`:'Todavía no hay ventas registradas en el año.';$('trendYear').textContent=year;bars(vp,rg.activeMonth);payments(pagos,ra);lastMetrics={rg,car,activeCount:activeRows.length,winnerOp};syncReportUrl();
}
'''
r, count = re.subn(r'function procesar\(\)\{.*?\}\nasync function init\(\)', new_procesar + 'async function init()', r, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'No se pudo reemplazar procesar: {count}')

old_init = "async function init(){setLoading(true);banner(false);try{await cargarMeta();const cached=await cargarFinanzas();procesar();if(!cached)banner(false)}catch(e){console.error(e);banner('error','No se pudieron cargar los datos del reporte. Revisa la conexión e inténtalo nuevamente.')}finally{setLoading(false)}}"
new_init = "async function init(){setLoading(true);banner(false);try{await cargarMeta();const cached=await cargarFinanzas();await cargarHistorialVentas();procesar();if(!cached)banner(false)}catch(e){console.error(e);banner('error','No se pudieron cargar los datos del reporte. Revisa la conexión e inténtalo nuevamente.')}finally{setLoading(false)}}"
if old_init not in r:
    raise SystemExit('No se encontró init esperado en reportes')
r = r.replace(old_init, new_init, 1)

old_end = "$('exportBtn').addEventListener('click',exportPDF);$('retryBtn').addEventListener('click',init);init();"
new_end = "$('exportBtn').addEventListener('click',exportPDF);$('retryBtn').addEventListener('click',init);bindAction('portfolioCard',()=>{location.href=ventasUrl('cartera')});bindAction('winnerCard',()=>{if(lastMetrics?.winnerOp)location.href=ventasUrl('winner',lastMetrics.winnerOp)});hydrateReportState();init();"
if old_end not in r:
    raise SystemExit('No se encontró final esperado en reportes')
r = r.replace(old_end, new_end, 1)

# ---------------- VENTAS ----------------
v = v.replace('<a class="back-btn" href="index.html" aria-label="Volver">','<a class="back-btn" id="backBtn" href="index.html" aria-label="Volver">',1)

css_marker = '.filters-card{background:rgba(255,255,255,.94);border:1px solid rgba(255,255,255,.8);border-radius:22px;padding:14px;box-shadow:var(--shadow);margin-bottom:16px}'
css_add = css_marker + '.report-context{display:none;margin:-4px 0 16px;padding:12px 15px;border:1px solid rgba(178,86,108,.12);border-radius:16px;background:#fff;color:#6f686c;align-items:center;justify-content:space-between;gap:14px;box-shadow:0 8px 24px rgba(52,36,42,.035)}.report-context.show{display:flex}.report-context-main{display:flex;align-items:center;gap:10px;min-width:0}.report-context-main i{color:var(--wine)}.report-context-copy{min-width:0}.report-context-copy strong{display:block;color:#51494e;font-size:.78rem}.report-context-copy span{display:block;margin-top:3px;color:#938c90;font-size:.68rem}.report-context-tag{flex:0 0 auto;color:var(--wine);font-size:.68rem;font-weight:700}'
if css_marker in v and '.report-context{' not in v:
    v = v.replace(css_marker, css_add, 1)

hero_marker = '  </section>\n\n  <section class="summary-grid" aria-label="Resumen filtrado">'
context_html = '  </section>\n\n  <div class="report-context" id="reportContext"><div class="report-context-main"><i class="fa-solid fa-chart-pie"></i><div class="report-context-copy"><strong id="reportContextTitle">Vista desde Reportes</strong><span id="reportContextRange"></span></div></div><span class="report-context-tag">Filtros aplicados</span></div>\n\n  <section class="summary-grid" aria-label="Resumen filtrado">'
if hero_marker not in v:
    raise SystemExit('No se encontró hero marker en ventas')
v = v.replace(hero_marker, context_html, 1)

old_state = "const state = { rows: [], filtered: [], page: 1, headerIndex: {}, loaded: false };"
new_state = "const state = { rows: [], filtered: [], page: 1, headerIndex: {}, loaded: false, urlStateApplied:false, rangeStart:null, rangeEnd:null, returnUrl:'' };"
if old_state not in v:
    raise SystemExit('No se encontró state esperado en ventas')
v = v.replace(old_state, new_state, 1)

incoming_helpers = r'''
const incomingParams=new URLSearchParams(location.search);
function safeLocalReturn(raw){if(!raw)return'';try{const u=new URL(raw,location.href);if(u.origin!==location.origin)return'';return u.pathname.split('/').pop()+u.search+u.hash}catch{return''}}function incomingDate(raw,end=false){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw||'')))return null;const d=new Date(raw+(end?'T23:59:59.999':'T00:00:00'));return Number.isNaN(d.getTime())?null:d}function incomingDateLabel(d){return d?d.toLocaleDateString('es-CO',{day:'numeric',month:'short',year:'numeric'}):''}function setupIncomingNavigation(){state.returnUrl=safeLocalReturn(incomingParams.get('return'));if(state.returnUrl){$('backBtn').href=state.returnUrl;$('backBtn').setAttribute('aria-label','Volver al reporte')}const context=incomingParams.get('context');if(context){const from=incomingDate(incomingParams.get('from')),to=incomingDate(incomingParams.get('to'),true),box=$('reportContext');box.classList.add('show');$('reportContextTitle').textContent=context==='cartera'?'Cartera del reporte':context==='winner'?'OP ganadora del reporte':'Vista desde Reportes';$('reportContextRange').textContent=[from&&incomingDateLabel(from),to&&incomingDateLabel(to)].filter(Boolean).join(' – ')+(context==='cartera'?' · Órdenes activas':'')}}function hasOption(id,value){return [...$(id).options].some(o=>o.value===String(value))}function applyIncomingFilters(){if(state.urlStateApplied)return;const search=incomingParams.get('search'),year=incomingParams.get('year'),month=incomingParams.get('month'),statusParam=incomingParams.get('status'),sort=incomingParams.get('sort');if(search!==null)$('searchInput').value=search;if(year&&hasOption('yearFilter',year))$('yearFilter').value=year;if(month!==null&&hasOption('monthFilter',month))$('monthFilter').value=month;if(statusParam&&hasOption('statusFilter',statusParam))$('statusFilter').value=statusParam;if(sort&&hasOption('sortFilter',sort))$('sortFilter').value=sort;state.rangeStart=incomingDate(incomingParams.get('from'));state.rangeEnd=incomingDate(incomingParams.get('to'),true);state.urlStateApplied=true;state.page=1;applyFilters();const openOp=incomingParams.get('op');if(openOp)setTimeout(()=>openDetail(openOp),0)}
'''
if 'const incomingParams=' not in v:
    v = v.replace('function normalize(value){', incoming_helpers + '\nfunction normalize(value){', 1)

old_load = "state.loaded=true;\n    populateYears(); populateMonths();\n    state.page=1; applyFilters();"
new_load = "state.loaded=true;\n    populateYears(); populateMonths();\n    if(!state.urlStateApplied) applyIncomingFilters(); else { state.page=1; applyFilters(); }"
if old_load not in v:
    raise SystemExit('No se encontró loadData esperado en ventas')
v = v.replace(old_load, new_load, 1)

filter_marker = "    const d=parseDate(get(row,'Fecha'));\n    if(year!=='ALL' && (!d || String(d.getFullYear())!==year)) return false;"
filter_replacement = "    const d=parseDate(get(row,'Fecha'));\n    if(state.rangeStart && (!d || d<state.rangeStart)) return false;\n    if(state.rangeEnd && (!d || d>state.rangeEnd)) return false;\n    if(year!=='ALL' && (!d || String(d.getFullYear())!==year)) return false;"
if filter_marker not in v:
    raise SystemExit('No se encontró filtro de fecha esperado en ventas')
v = v.replace(filter_marker, filter_replacement, 1)

old_reset = "function resetFilters(){ $('searchInput').value=''; $('monthFilter').value='ALL'; $('statusFilter').value='ALL'; $('sortFilter').value='DATE_DESC'; const current=String(new Date().getFullYear()); $('yearFilter').value=[...$('yearFilter').options].some(o=>o.value===current)?current:'ALL'; state.page=1; applyFilters(); }"
new_reset = "function resetFilters(){ $('searchInput').value=''; $('monthFilter').value='ALL'; $('statusFilter').value='ALL'; $('sortFilter').value='DATE_DESC'; state.rangeStart=null; state.rangeEnd=null; const current=String(new Date().getFullYear()); $('yearFilter').value=[...$('yearFilter').options].some(o=>o.value===current)?current:'ALL'; state.page=1; applyFilters(); }"
if old_reset not in v:
    raise SystemExit('No se encontró reset esperado en ventas')
v = v.replace(old_reset, new_reset, 1)

if 'setupIncomingNavigation();\nloadData();' not in v:
    v = v.replace("loadData();\n})();", "setupIncomingNavigation();\nloadData();\n})();", 1)

report.write_text(r, encoding='utf-8')
ventas.write_text(v, encoding='utf-8')
print('Patched reportes-diseno-v4.html and ventas.html')
