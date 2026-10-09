'use strict';
const assert=require('node:assert/strict');
const builder=require('../homeeasy-quote-pdf.js');

class PDFMock{
  constructor(){
    this.pages=[[]];this.current=0;this.size=9;
    this.internal={pageSize:{getWidth:()=>215.9,getHeight:()=>279.4},getNumberOfPages:()=>this.pages.length};
  }
  addPage(){this.pages.push([]);this.current=this.pages.length-1;}
  setPage(n){assert(n>0&&n<=this.pages.length);this.current=n-1;}
  setTextColor(){} setDrawColor(){} setFillColor(){}
  setFont(){} setFontSize(n){this.size=n;}
  setLineWidth(){} line(){} rect(){} roundedRect(){} addImage(){}
  text(value,x,y){
    assert(Number.isFinite(x)&&Number.isFinite(y),'PDF coordinates must be numeric');
    assert(y<=279.4,'Content outside page '+y);
    this.pages[this.current].push({text:String(value),x,y});
  }
  splitTextToSize(value,width){
    const input=String(value);
    const maxChars=Math.max(10,Math.floor(width/(this.size*.19)));
    if(input.length<=maxChars)return [input];
    const words=input.split(/\s+/),lines=[];let current='';
    for(const word of words){
      if(current&&(current+' '+word).length>maxChars){lines.push(current);current=word;}
      else current+=(current?' ':'')+word;
    }
    if(current)lines.push(current);
    return lines;
  }
}
function element({value,innerText,textContent,classList}={}){
  return {value,innerText,textContent,classList:classList||{contains:()=>false}};
}
function fixture(mode,rows=14,longNotes=14){
  const fields={
    'area-pdf':element({classList:{contains:v=>v==='quote-total-only'&&mode==='total'}}),
    n_cot_display:element({innerText:'46'}),fecha_display:element({innerText:'8/10/2026'}),
    'document-type':element({innerText:'COTIZACIÓN'}),
    'empresa-info-header':element({innerText:'HOMEEASY\nNIT 900000000\nPOPAYÁN\n(+57) 300 000 0000\nhola@homeeasy.com.co'}),
    'footer-creds':element({innerText:'HomeEasy - Viste tu hogar con estilo'}),
    cedula:element({value:'123456789'}),nombre:element({value:'CLIENTE DE PRUEBA'}),
    telefono:element({value:'3000000000'}),email:element({value:'cliente@example.com'}),
    direccion:element({value:'Popayán, Cauca'}),
    notas:element({value:Array.from({length:longNotes},(_,i)=>
      '- Habitación '+(i+1)+' - Instalación al techo; apertura hacia ambos extremos. Confirmar visita y accesorios.').join('\n')}),
    'condiciones-comerciales':element({innerText:'Validez de la oferta: 15 días calendario.\nIncluye toma de medidas e instalación GRATIS.\nForma de pago: 50% anticipo y 50% entrega.'}),
    descuento_input:element({value:'0'}),
    subtotal_val:element({innerText:'$ 19.864.000'}),total_val:element({innerText:'$ 19.864.000'})
  };
  const items=Array.from({length:rows},(_,i)=>({
    querySelector(selector){
      if(selector==='.row-desc')return element({value:'Habitación '+(i+1)+' - Onda Serena - Traslucente Kilim - 2,15 × 2,36 m'});
      if(selector==='.cant')return element({value:'1'});
      if(selector==='.precio')return element({value:'$ 1.418.857'});
      return null;
    }
  }));
  return {
    getElementById:id=>fields[id]||null,
    querySelectorAll:selector=>selector==='#tabla-body tr'?items:[],
    querySelector:()=>null
  };
}
for(const mode of ['total','individual']){
  const doc=fixture(mode,14,14);
  const pdf=builder.build(doc,PDFMock);
  assert(pdf.pages.length>=2,'Long quotations must paginate');
  assert(pdf.pages.length<=4,'No unnecessary blank pages');
  const all=pdf.pages.flat().map(x=>x.text).join('\n');
  assert(all.includes('19.864.000'),'Total amount must remain');
  assert(all.includes('Habitación 14'),'No product may be dropped');
  assert(all.includes('apertura hacia'),'Installation notes must remain');
  assert(all.includes('Validez de la oferta'),'Commercial conditions must remain');
  for(let i=0;i<pdf.pages.length;i++){
    const texts=pdf.pages[i].map(x=>x.text);
    assert(texts.some(t=>t.includes('HomeEasy')),'Each page must include branding');
    assert(texts.some(t=>t==='Página '+(i+1)+' de '+pdf.pages.length),'Each page needs a correct number');
    assert(texts.length>6,'No blank or footer-only page');
    assert(pdf.pages[i].every(t=>t.y<=273),'No text may spill into bottom edge');
  }
  if(mode==='total'){
    assert(!all.includes('V. UNITARIO'),'Total-only mode must not expose unit column');
    assert(!all.includes('V. TOTAL'),'Total-only mode must not expose totals column');
  }else{
    assert(all.includes('V. UNITARIO')&&all.includes('V. TOTAL'),'Detailed mode must retain price columns');
  }
}
const more=builder.build(fixture('total',55,36),PDFMock);
assert(more.pages.length>=3,'Large documents should flow to additional pages');
assert(more.pages.every(page=>page.some(line=>line.text.includes('HomeEasy'))));

const {jsPDF}=require('jspdf');
const realPdf=builder.build(fixture('total',14,14),jsPDF);
assert(realPdf.internal.getNumberOfPages()>=2,'Real jsPDF must paginate long content');
assert(realPdf.internal.getNumberOfPages()<=4,'Real jsPDF must not create a blank extra page');
const bytes=Buffer.from(realPdf.output('arraybuffer'));
assert.equal(bytes.subarray(0,4).toString(),'%PDF','Real output must be a valid PDF file');
assert(bytes.length>4000,'Real PDF should contain all items and observations');
const individualPdf=builder.build(fixture('individual',14,14),jsPDF);
assert(individualPdf.internal.getNumberOfPages()>=2,'Real itemized PDF must paginate');
console.log('Cotización PDF vectorial: 14 productos + notas, dos modos, 55 productos y paginación PASS');
