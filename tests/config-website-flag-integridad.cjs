'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const page=fs.readFileSync('configuracion.html','utf8');
const docs=fs.readFileSync('homeeasy-docs.js','utf8');
const abono=fs.readFileSync('abono.html','utf8');
const quote=fs.readFileSync('cotizacion.html','utf8');
const order=fs.readFileSync('pedido.html','utf8');
const expression=/function configBoolean\(value\) \{([\s\S]*?)\n        \}/.exec(page);
assert(expression,'Missing normalized boolean parser for settings');
const parse=new Function('value',expression[1]);
for(const [raw,expected] of [[true,true],[false,false],['true',true],['false',false],['0',false],['1',true],[0,false],[1,true],['sí',true],['no',false],['',false],[null,false]]){
 assert.equal(parse(raw),expected,'Config toggle '+JSON.stringify(raw));
}
assert(page.includes('element.checked = configBoolean(value)'),'Configuration does not apply normalized flags');
for(const field of ['empresa.web','documentos.mostrar_web']){
 assert(page.includes('data-config-key="'+field+'"'),'Settings field '+field+' missing');
 assert(docs.includes('"'+field+'"'),'Document header '+field+' missing');
}
assert(docs.includes('if (showWeb && web) html += line("fas fa-globe", web);'),'Header does not honor toggle and URL');
for(const [name,text] of [['abono',abono],['cotizacion',quote],['pedido',order]]){
 assert(text.includes('id="empresa-info-header"'),name+': shared header unavailable');
 assert(text.includes('homeeasy-docs.js'),name+': central config connection missing');
}
assert(abono.includes("documentType: 'recibo'"),'Receipt not linked to central settings');
console.log('Contact channels: settings true/false normalization, saved website ON/OFF, shared header for three PDFs PASS');
