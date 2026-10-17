'use strict';
// Parche mínimo sobre una exportación autorizada; conserva todos los demás archivos.
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Uso: node scripts/integrar-recibos.cjs export.json salida.json');
const project = JSON.parse(fs.readFileSync(input,'utf8'));
const main = project.files.find(f => f.name === 'CEREBRO_HOMEASY_v1_ESTABLE');
if (!main) throw new Error('No se encontró el Cerebro esperado');
function replaceOnce(oldText,newText) {
  if (main.source.includes(newText)) return;
  if (main.source.split(oldText).length !== 2) throw new Error('El Cerebro cambió: integración manual requerida: '+oldText.slice(0,75));
  main.source=main.source.replace(oldText,newText);
}
replaceOnce('    if (data.tipo === "movimiento_caja" && data.accionCaja)',
  '    const respuestaReciboSeguro = recibosProcesar_(ss, data);\n    if (respuestaReciboSeguro) return json_(respuestaReciboSeguro);\n    if (data.tipo === "movimiento_caja" && data.accionCaja)');
if(main.source.includes('fecha: String(row[4]), valor: Number(row[5])'))
  replaceOnce('fecha: String(row[4]), valor: Number(row[5])', 'fecha: row[4] ? Utilities.formatDate(new Date(row[4]), Session.getScriptTimeZone(), "dd/MM/yyyy") : "", valor: Number(row[5])');
replaceOnce('        abonos: abonos ',
  '        abonos: abonos,\n        recibosSeguros: true,\n        recibosAnulados: dataAb.slice(1).filter(function(row) { return String(row[1]).trim() === numOP && estadoAbonoFila_(row) === "ANULADO"; }).map(function(row) { return { recibo: row[0], fecha: row[4] ? Utilities.formatDate(new Date(row[4]), Session.getScriptTimeZone(), "dd/MM/yyyy") : "", valor: Number(row[5]), estado: "ANULADO", motivo: row[23] || row[14] || "", pdfUrl: row[7] || "" }; })');
const moduleSource=fs.readFileSync('apps-script/RECIBOS_SEGUROS.gs','utf8');
const moduleFile=project.files.find(f=>f.name==='RECIBOS_SEGUROS');
if(moduleFile) moduleFile.source=moduleSource;
else project.files.push({name:'RECIBOS_SEGUROS',type:'server_js',source:moduleSource});
const manifestFile=project.files.find(f=>f.name==='appsscript');
const manifest=JSON.parse(manifestFile.source);
manifest.dependencies??={};
manifest.dependencies.enabledAdvancedServices??=[];
if(!manifest.dependencies.enabledAdvancedServices.some(x=>x.serviceId==='sheets'))
  manifest.dependencies.enabledAdvancedServices.push({userSymbol:'Sheets',serviceId:'sheets',version:'v4'});
manifestFile.source=JSON.stringify(manifest,null,2);
fs.writeFileSync(output,JSON.stringify(project,null,2));
console.log('Integración preparada; NO escrita ni desplegada en Apps Script.');
