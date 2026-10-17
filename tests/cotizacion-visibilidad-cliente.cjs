'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const calc = read('homeeasy-cost-calculator.js');
const quote = read('cotizacion.html');
const order = read('pedido.html');
const calcHtml = read('cotizador-persianas.html');

const start = calc.indexOf('function formalDescription(item,index,q,');
const end = calc.indexOf('function whatsappMeasure(value)');
assert(start >= 0 && end > start, 'Funciones de traslado del cotizador disponibles');
const helperCode = calc.slice(start, end);
const buildHelpers = new Function('state','familyLabels','calculatedCovers','cleanCommercialComplementName','whatsappMeasure','lastQuote','installationObservationLines',
  helperCode + ';return {formalDescription,formalPublicVariants,formalRowsFromQuote,createFormalQuoteTransfer};');

const state = {project:'Alcoba de prueba',roundSale:false,items:[{
  family:'enrollable',location:'Alcoba',width:'1.60',height:'2.20',quantity:2,coverlight:''
}]};
const price = {ok:true,sale:120000000,items:[{total:120000000,product:{name:'Blackout Matte'}}]};
const helpers = buildHelpers(state,{enrollable:'Persiana enrollable'},()=>[],x=>x,
  x=>String(x).replace('.',','),price,()=>['Nota técnica sobre la tela Blackout Matte']);

const transfer = helpers.createFormalQuoteTransfer('individual',{
  hideMeasures:true,hideUnitPrices:true,hideFabrics:false
});
assert.equal(transfer.items.length, 1);
assert(transfer.items[0].descripcion.includes('1,60'));
assert(transfer.items[0].descripcion.includes('Blackout Matte'));
assert(!transfer.items[0].detallePublico.sinMedidas.includes('1,60'));
assert(!transfer.items[0].detallePublico.sinTelas.includes('Blackout Matte'));
assert(!transfer.items[0].detallePublico.sinAmbas.includes('Blackout Matte'));
assert(!transfer.items[0].detallePublico.sinAmbas.includes('1,60'));
assert.equal(transfer.totalPesos, 1200000);
assert.equal(transfer.items[0].cantidad * transfer.items[0].precio, 1200000);
assert.deepEqual(transfer.visibility,{hideMeasures:true,hideUnitPrices:true,hideFabrics:false});

const splitState={...state,items:[{...state.items[0],quantity:3}]};
const splitQuote={...price,sale:1000100,items:[{...price.items[0],total:1000100}]};
const split=buildHelpers(splitState,{enrollable:'Persiana enrollable'},()=>[],x=>x,
  x=>String(x).replace('.',','),splitQuote,()=>[]);
const splitTransfer=split.createFormalQuoteTransfer('total',{
  hideMeasures:true,hideUnitPrices:true,hideFabrics:true
});
assert.equal(splitTransfer.items.reduce((sum,row)=>sum+row.cantidad*row.precio,0),10001);
assert(splitTransfer.items.every(row=>row.detallePublico.sinAmbas==='Alcoba · Persiana enrollable'));
assert.equal(splitTransfer.displayMode,'total');

const qs=quote.indexOf('    function normalizarVisibilidadCliente(value)');
const qe=quote.indexOf('    let homeEasyPdfLibrariesPromise');
assert(qs>=0&&qe>qs,'Rutinas de privacidad en la cotización');
const quoteCode=quote.slice(qs,qe);
const buildQuote=new Function('flags','let quoteClientVisibility=flags;'+quoteCode+
  ';return {normalizarVisibilidadCliente,guardarDetallePublico,descripcionParaCliente};');
const publicQuote=buildQuote(transfer.visibility);
const row={dataset:{},querySelector:()=>({value:transfer.items[0].descripcion})};
publicQuote.guardarDetallePublico(row,transfer.items[0]);
assert(!publicQuote.descripcionParaCliente(row).includes('1,60'));
assert(publicQuote.descripcionParaCliente(row).includes('Blackout Matte'));
assert(row.dataset.detallePublico.includes('1,60'), 'La información interna sigue guardada');

for(const config of [
  {hideMeasures:false,hideUnitPrices:false,hideFabrics:false},
  {hideMeasures:true,hideUnitPrices:false,hideFabrics:false},
  {hideMeasures:false,hideUnitPrices:false,hideFabrics:true},
  {hideMeasures:true,hideUnitPrices:true,hideFabrics:true}
]){
  const vm=buildQuote(config);
  const rendered=vm.descripcionParaCliente(row);
  assert.equal(rendered.includes('1,60'),!config.hideMeasures);
  assert.equal(rendered.includes('Blackout Matte'),!config.hideFabrics);
}
assert.throws(()=>publicQuote.descripcionParaCliente({
  dataset:{},querySelector:()=>({value:'Texto sin estructura 1,60 × 2,20 m'})
}),/vuelve al cotizador/,'No se filtra información cuando falta metadata');

assert(quote.includes('visibilidadCliente: {...quoteClientVisibility}'));
assert(quote.includes('guardarDetallePublico(tr,item)'));
assert(quote.includes('descripcionesParaPdf[index]'));
assert(quote.includes("areaPdf.classList.remove('pdf-export-mode','quote-hide-unit-prices')"));
assert(quote.includes("areaPdf.classList.toggle('quote-total-only', quotePresentationMode === 'total')"));
assert(quote.includes('#area-pdf.pdf-export-mode.quote-total-only'));
assert(quote.includes("notes.closest('.mb-4')?.style.setProperty('display','none')"));
assert(order.includes('tr.querySelector(".row-desc").value = item.descripcion || "";'));
for (const id of ['formal-hide-measures','formal-hide-unit-prices','formal-hide-fabrics']) {
  assert(calcHtml.includes('id="'+id+'"'), id + ' existe en el selector');
}
new Function(calc);
for(const match of quote.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(match[1].trim())new Function(match[1]);
}
console.log('OK: privacidad PDF, precios, datos internos, 3 casillas, compatibilidad y sintaxis');
