'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const receipt=fs.readFileSync('abono.html','utf8');
const settings=fs.readFileSync('configuracion.html','utf8');
const docs=fs.readFileSync('homeeasy-docs.js','utf8');
const guard=fs.readFileSync('homeeasy-page-guard.js','utf8');
const actions=fs.readFileSync('homeeasy-whatsapp-doc-actions.js','utf8');
const order=fs.readFileSync('pedido.html','utf8');
const quote=fs.readFileSync('cotizacion.html','utf8');
function must(str,needle){assert(str.includes(needle),'Missing preserved contract: '+needle)}
for(const key of ['src="logohomeeasy.png"','class="header-brand"','class="order-meta"','id="empresa-info-header"',
'id="document-type"','id="seccion_historial"','id="tbody_pagos"','id="abono_destacado"',
'id="saldo_anterior_val"','id="nuevo_saldo_val"','id="paz-salvo-banner"','class="pdf-footer"'])
must(receipt,key);
must(receipt,"window.HomeEasyDocs.init({ url: URL_G, documentType: 'recibo' })");
must(docs,"const title = String(key(cfg, titleKey)).toUpperCase();");
must(settings,'data-config-key="documentos.recibo.titulo"');
must(receipt,"format: [pdfWidth, pdfHeight]");
must(receipt,"scrollX: 0");
must(receipt,"scrollY: 0");
assert(!receipt.includes('scrollY: -window.scrollY'),'Previous scroll offset bug persists');
assert(!receipt.includes('height: realHeight'),'Old pre-clone crop height persists');
must(receipt,'window.scrollTo(exportScrollX, exportScrollY)');
must(receipt,'} finally {');
must(receipt,'var saldoReal = Number(check.saldoReal) || 0;');
must(receipt,'totalPagado += Number(historialAbonos[j].valor) || 0;');
must(receipt,'tipo: "abono"');
for(const key of ['numeroOP: numOP','cedula: ced','nombre: nom','valorAbono: valAbono','medioPago: mPago',
'concepto: concepto','pdfBase64: pdfBase64','nombreArchivo: nombreArchivo','pdf.save(nombreArchivo)'])
must(receipt,key);
must(guard,"['cotizacion.html', 'pedido.html', 'abono.html']");
must(guard,"homeeasy:document-generated");
must(actions,"documentType: type");
must(actions,"const type = DOCUMENT_PAGES[page]");
must(quote,'const payloadType = isEditMode ? "edit_cotizacion" : "cotizacion"');
must(order,'const payloadType = isEditMode ? "edit_pedido" : "pedido"');
console.log('Receipt integration: original voucher branding, docs settings, finance, AppScript save, WhatsApp event, quote/order unchanged PASS');
