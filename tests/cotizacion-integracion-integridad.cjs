'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const load=path=>fs.readFileSync(path,'utf8');
const quote=load('cotizacion.html');
const price=load('homeeasy-cost-calculator.js');
const calc=load('cotizador-persianas.html');
const settings=load('configuracion.html');
const docs=load('homeeasy-docs.js');
const core=load('homeeasy-core.js');
const guard=load('homeeasy-page-guard.js');
const whatsapp=load('homeeasy-whatsapp-doc-actions.js');
const order=load('pedido.html');
function must(source,fragment,reason){assert(source.includes(fragment),reason+': '+fragment);}
assert(quote.length>50000&&settings.length>150000&&core.length>30000,'Unexpected truncation in a central app file');
const fields=[
 'empresa.nombre_comercial','empresa.nit','empresa.direccion',
 'empresa.ciudad','empresa.telefono','empresa.web','empresa.instagram',
 'documentos.cotizacion.titulo','documentos.cotizacion.validez_dias',
 'documentos.cotizacion.medicion_instalacion','documentos.cotizacion.forma_pago',
 'documentos.pie_principal','documentos.pie_sistema'
];
for(const key of fields){
 must(settings,'data-config-key="'+key+'"','Configuration editor key missing');
 must(docs,'"'+key+'"','Document config reader missing');
}
must(core,"tipo: 'GET_CONFIGURACION'","App central settings endpoint disconnected");
must(settings,"tipo: 'GUARDAR_CONFIGURACION'","Settings editor write endpoint disconnected");
must(docs,'window.HomeEasyCore.getConfiguration({ force: true, allowFallback: true })','Document config uses HomeEasy core and previously validated cache');
must(quote,'window.__homeeasyDocsReady','Formal quote must await settings initialization');
must(quote,"documentType: 'cotizacion'","Formal quote dynamic document config");
must(docs,'applyCotizacion(cfg)','Quote applies dynamic commercial conditions');
must(docs,'applyCommon(cfg, kind)','Company header and footer must be config-driven');
must(quote,'id="empresa-info-header"','Company header node missing');
must(quote,'id="condiciones-comerciales"','Commercial conditions node missing');
must(quote,'id="footer-creds"','Footer node missing');
must(quote,'src="logohomeeasy.png"','Original company logo missing');
must(quote,'class="header-brand"','Original corporate header missing');
must(quote,'class="order-meta"','Quote number/date pill missing');
must(quote,'class="document-type"','Original document title missing');
must(quote,'class="pdf-footer"','Original footer missing');
must(quote,'#area-pdf.quote-total-only','Total-only presentation missing');
must(quote,'#tabla-body .pdf-repeat-table-header th:nth-child(3)','Repeated header should hide unit price');
must(quote,'#tabla-body .pdf-repeat-table-header th:nth-child(4)','Repeated header should hide row total');
must(calc,'id="formal-quote"','Formal quote entrypoint missing');
must(price,"const FORMAL_QUOTE_TRANSFER_KEY='homeeasy.cost-to-formal.v1'","Calculator transfer key");
must(quote,"const COST_CALCULATOR_TRANSFER_KEY = 'homeeasy.cost-to-formal.v1'","Transfer key mismatch");
must(price,'sessionStorage.setItem(FORMAL_QUOTE_TRANSFER_KEY,JSON.stringify(transfer))','Transfer payload missing');
must(price,"window.location.assign('cotizacion.html?from=cotizador')",'Formal quote link missing');
must(price,"displayMode:displayMode==='total'?'total':'individual'","Presentation mode transfer disconnected");
must(price,"observations:installLines.length?'Detalles de instalación:",'Installation observations missing');
must(quote,'if (fromCalculator) cargarTransferenciaCotizador();','Formal quote import disconnected');
must(quote,'if (totalCargado !== Number(transfer.totalPesos || 0))','Money integrity check missing');
must(quote,'aplicarModoPresentacion(transfer.displayMode)','Presentation mode not applied');
must(quote,'pdfBase64: pdfBase64','PDF not forwarded to backend');
must(quote,'itemsJSON: JSON.stringify(itemsJSON)','Product lines not saved');
must(quote,'const payloadType = isEditMode ? "edit_cotizacion" : "cotizacion"','Create/edit operation missing');
must(quote,'pdf.save(nombreArchivo)','Download missing');
must(guard,"['cotizacion.html', 'pedido.html', 'abono.html']",'Global save interceptor disconnected');
must(guard,'body.pdfBase64 && (body.nombreArchivo || body.filename)','Document event payload missing');
must(whatsapp,'generatedContext(payload)','WhatsApp handoff missing');
must(order,'canvas = await html2canvas(areaPdf,','Order original HTML capture must remain');
must(order,'window.scrollTo(exportScrollX, exportScrollY);','Mobile scroll must restore after order export');
must(order,"printFooter.classList.add('pdf-pinned-footer')",'Order footer must anchor after pagination');
must(order,'pdfBase64: pdfBase64','Order PDF must reach backend');
must(order,'itemsJSON: JSON.stringify(itemsJSON)','Order products must reach backend');
must(order,'abonoInicial: abonoInicial','Order deposit must reach backend');
must(order,'valorTotal: totalFinal','Order total must reach backend');
must(order,'const payloadType = isEditMode ? "edit_pedido" : "pedido"','Order edit/create contract missing');
must(order,'src="logohomeeasy.png"','Original order logo missing');
assert(!quote.includes('HomeEasyQuotePDF.build'),'Replacement PDF template returned');
assert(!fs.existsSync('homeeasy-quote-pdf.js'),'Unapproved vector quote renderer present');
assert(!order.includes('HomeEasyOrderPDF.build'),'Order PDF modification accidentally promoted');
console.log('HomeEasy quote integration: editor/reader, calculator transfer, create/edit/save, WhatsApp interception, original branding and unchanged OP PASS');
