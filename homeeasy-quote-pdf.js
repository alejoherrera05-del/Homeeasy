/* HomeEasy • Cotizaciones formales: PDF nativo, texto vectorial y paginación por bloques.
   No modifica el cálculo, los datos enviados al backend ni el modo de presentación. */
(function(root){
  'use strict';

  const COLORS={
    brand:[178,86,108],dark:[151,71,90],gold:[194,164,104],
    ink:[41,39,42],secondary:[103,100,104],muted:[135,132,137],
    line:[229,226,229],soft:[250,247,248],white:[255,255,255]
  };
  const WIDTH=215.9, LEFT=17, RIGHT=17, BOTTOM=257, FOOTER_Y=265;

  function clean(value){
    return String(value==null?'':value)
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/[\u2013\u2014]/g,' - ')
      .replace(/\u2022/g,'-')
      .replace(/\s+/g,' ').trim();
  }
  function content(document,id){
    const el=document.getElementById(id);
    if(!el)return '';
    if('value' in el)return String(el.value||'').trim();
    return clean(el.innerText||el.textContent||'');
  }
  function linesFrom(element){
    if(!element)return [];
    const raw=element.innerText||element.textContent||'';
    return String(raw).split(/\r?\n/).map(clean).filter(Boolean);
  }
  function asMoney(value){
    const number=Number(String(value||'').replace(/[^0-9]/g,''))||0;
    return '$ '+number.toLocaleString('es-CO',{maximumFractionDigits:0});
  }
  function palette(pdf,code){pdf.setTextColor.apply(pdf,COLORS[code]);}
  function stroke(pdf,code){pdf.setDrawColor.apply(pdf,COLORS[code]);}
  function fill(pdf,code){pdf.setFillColor.apply(pdf,COLORS[code]);}
  function font(pdf,size,bold){
    pdf.setFont('helvetica',bold?'bold':'normal');
    pdf.setFontSize(size);
  }
  function split(pdf,text,width){
    const parts=pdf.splitTextToSize(clean(text),width);
    return parts&&parts.length?parts:[''];
  }
  function write(pdf,text,x,y,opts){
    pdf.text(String(text),x,y,opts||{});
  }
  function getRows(doc){
    return Array.from(doc.querySelectorAll('#tabla-body tr')).map(tr=>{
      const description=tr.querySelector('.row-desc');
      const quantity=tr.querySelector('.cant');
      const unit=tr.querySelector('.precio');
      if(!description||!quantity||!unit)return null;
      const name=clean(description.value);
      if(!name)return null;
      const qty=Math.max(0,Number(quantity.value)||0);
      const price=Number(String(unit.value||'').replace(/[^0-9]/g,''))||0;
      return {description:name,qty,unit:price,total:Math.round(price*qty)};
    }).filter(Boolean);
  }

  function build(doc,PDF){
    if(!doc||!PDF)throw new Error('Falta el documento o el motor PDF.');
    const entries=getRows(doc);
    if(!entries.length)throw new Error('La cotización no contiene productos para imprimir.');
    const pdf=new PDF('p','mm','letter');
    const pageWidth=pdf.internal.pageSize.getWidth()||WIDTH;
    const pageHeight=pdf.internal.pageSize.getHeight()||279.4;
    const right=pageWidth-RIGHT;
    const available=pageWidth-LEFT-RIGHT;
    const showTotalOnly=!!doc.getElementById('area-pdf')?.classList.contains('quote-total-only');
    const number=clean(content(doc,'n_cot_display'))||'—';
    const date=clean(content(doc,'fecha_display'));
    const docTitle=clean(content(doc,'document-type'))||'COTIZACIÓN';
    const company=linesFrom(doc.getElementById('empresa-info-header'));
    const footer=clean(content(doc,'footer-creds'))||'HomeEasy - Viste tu hogar con estilo';
    const logo=doc.querySelector('#area-pdf .logo-only');
    let y=0;

    function brandName(x,top,small){
      let drawn=false;
      if(logo&&logo.complete&&logo.naturalWidth>0&&logo.naturalHeight>0){
        try{
          const maxW=small?24:35;
          const maxH=small?8:13;
          const ratio=logo.naturalWidth/logo.naturalHeight;
          const w=Math.min(maxW,maxH*ratio),h=w/ratio;
          pdf.addImage(logo,'PNG',x,top,w,h);
          drawn=true;
        }catch(error){ /* El logo no debe impedir emitir una cotización. */ }
      }
      if(!drawn){
        font(pdf,small?12:17,true);palette(pdf,'brand');
        write(pdf,'HomeEasy',x,top+(small?6:10));
      }
    }
    function commonBar(){
      fill(pdf,'brand');
      pdf.rect(0,0,pageWidth,3.2,'F');
    }
    function firstHeader(){
      commonBar();
      brandName(LEFT,12,false);
      const detailLines=company.slice(company.length>1?1:0,5)
        .flatMap(t=>split(pdf,t,83)).slice(0,6);
      font(pdf,7.1,false);palette(pdf,'secondary');
      detailLines.forEach((line,i)=>write(pdf,line,right,13+i*4.4,{align:'right'}));
      stroke(pdf,'line');pdf.setLineWidth(.3);pdf.line(LEFT,43,right,43);
      font(pdf,18,true);palette(pdf,'ink');write(pdf,docTitle,LEFT,54);
      font(pdf,8,true);palette(pdf,'brand');write(pdf,'N.º '+number,right,50,{align:'right'});
      font(pdf,8,false);palette(pdf,'muted');
      if(date)write(pdf,date,right,55,{align:'right'});
      y=64;
    }
    function continuationHeader(){
      commonBar();
      brandName(LEFT,10,true);
      font(pdf,8,true);palette(pdf,'brand');
      write(pdf,'COTIZACIÓN N.º '+number,right,17,{align:'right'});
      stroke(pdf,'line');pdf.setLineWidth(.3);pdf.line(LEFT,25,right,25);
      font(pdf,8,false);palette(pdf,'muted');
      write(pdf,'Continuación',LEFT,33);
      y=42;
    }
    function pageBreak(){
      pdf.addPage();
      continuationHeader();
    }
    function requireRoom(height){
      if(y+height>BOTTOM)pageBreak();
    }
    function heading(title){
      requireRoom(13);
      font(pdf,9.4,true);palette(pdf,'brand');
      write(pdf,title.toUpperCase(),LEFT,y+4);
      stroke(pdf,'line');pdf.setLineWidth(.3);pdf.line(LEFT,y+7,right,y+7);
      y+=12;
    }
    function field(label,value,x,width,top){
      const val=clean(value)||'—';
      font(pdf,7,false);palette(pdf,'muted');write(pdf,label.toUpperCase(),x,top);
      font(pdf,9.2,true);palette(pdf,'ink');
      const valueLines=split(pdf,val,width).slice(0,2);
      valueLines.forEach((line,i)=>write(pdf,line,x,top+5.7+i*4.4));
    }
    function client(){
      heading('Información del cliente');
      const half=(available-10)/2;
      field('Cédula / NIT',content(doc,'cedula'),LEFT,half,y+1);
      field('Nombre completo',content(doc,'nombre'),LEFT+half+10,half,y+1);
      y+=18;
      field('Teléfono',content(doc,'telefono'),LEFT,half,y+1);
      field('Correo electrónico',content(doc,'email'),LEFT+half+10,half,y+1);
      y+=18;
      field('Dirección / ciudad',content(doc,'direccion'),LEFT,available,y+1);
      y+=18;
    }
    function tableHead(){
      requireRoom(11);
      fill(pdf,'soft');
      pdf.rect(LEFT,y,available,9,'F');
      font(pdf,7.5,true);palette(pdf,'secondary');
      write(pdf,'DESCRIPCIÓN DEL ARTÍCULO',LEFT+3,y+5.9);
      if(showTotalOnly){
        write(pdf,'CANT.',right-12,y+5.9,{align:'center'});
      }else{
        write(pdf,'CANT.',LEFT+112,y+5.9,{align:'center'});
        write(pdf,'V. UNITARIO',right-39,y+5.9,{align:'right'});
        write(pdf,'V. TOTAL',right-3,y+5.9,{align:'right'});
      }
      y+=10;
    }
    function productRows(){
      heading('Detalle de productos');
      tableHead();
      const textWidth=showTotalOnly?available-27:105;
      for(const entry of entries){
        font(pdf,9,false);
        const pieces=split(pdf,entry.description,textWidth);
        const rowHeight=Math.max(10,pieces.length*4.45+4.6);
        if(y+rowHeight>BOTTOM){
          pageBreak();
          tableHead();
        }
        font(pdf,9,false);palette(pdf,'ink');
        pieces.forEach((line,i)=>write(pdf,line,LEFT+3,y+5.5+i*4.45));
        font(pdf,8.7,true);palette(pdf,'ink');
        if(showTotalOnly){
          write(pdf,String(entry.qty),right-12,y+5.5,{align:'center'});
        }else{
          write(pdf,String(entry.qty),LEFT+112,y+5.5,{align:'center'});
          write(pdf,asMoney(entry.unit),right-39,y+5.5,{align:'right'});
          write(pdf,asMoney(entry.total),right-3,y+5.5,{align:'right'});
        }
        stroke(pdf,'line');pdf.setLineWidth(.18);
        pdf.line(LEFT,y+rowHeight,right,y+rowHeight);
        y+=rowHeight;
      }
      y+=5;
    }
    function observations(){
      const raw=content(doc,'notas');
      if(!raw)return;
      const noteLines=String(doc.getElementById('notas')?.value||raw).split(/\r?\n/)
        .map(clean).filter(Boolean);
      if(!noteLines.length)return;
      heading('Observaciones especiales');
      font(pdf,8.6,false);
      for(const note of noteLines){
        const fragments=split(pdf,note,available-6);
        for(let i=0;i<fragments.length;i++){
          requireRoom(5.0);
          font(pdf,8.6,false);palette(pdf,'ink');
          write(pdf,fragments[i],LEFT+3,y+3.7);
          y+=4.45;
        }
        y+=1.2;
      }
      y+=5;
    }
    function conditionsAndTotal(){
      const sourceLines=linesFrom(doc.getElementById('condiciones-comerciales'));
      const conditions=sourceLines.length?sourceLines:['Validez de la oferta: 15 días calendario.'];
      const leftWidth=available*.54;
      const conditionLines=[];
      conditions.forEach(t=>split(pdf,t,leftWidth-5).forEach(part=>conditionLines.push(part)));
      const discount=asMoney(content(doc,'descuento_input'));
      const hasDiscount=Number(String(content(doc,'descuento_input')).replace(/[^0-9]/g,''))>0;
      const panelHeight=showTotalOnly?30:(hasDiscount?46:39);
      const blockHeight=Math.max(panelHeight,13+conditionLines.length*4.1)+16;
      requireRoom(blockHeight);
      const top=y;
      font(pdf,9,true);palette(pdf,'brand');
      write(pdf,'CONDICIONES COMERCIALES',LEFT,top+5);
      stroke(pdf,'line');pdf.setLineWidth(.3);pdf.line(LEFT,top+8,LEFT+leftWidth-6,top+8);
      font(pdf,7.65,false);palette(pdf,'secondary');
      conditionLines.forEach((line,i)=>write(pdf,line,LEFT,top+14+i*4.1));
      const panelX=LEFT+leftWidth+5,panelW=available-leftWidth-5;
      fill(pdf,'soft');pdf.roundedRect(panelX,top,panelW,panelHeight,3,3,'F');
      fill(pdf,'gold');pdf.rect(panelX,top,1.4,panelHeight,'F');
      if(!showTotalOnly){
        font(pdf,8,false);palette(pdf,'secondary');
        write(pdf,'Subtotal',panelX+5,top+8);
        write(pdf,asMoney(content(doc,'subtotal_val')),panelX+panelW-4,top+8,{align:'right'});
        if(hasDiscount){
          write(pdf,'Descuento',panelX+5,top+16);
          write(pdf,'-'+discount,panelX+panelW-4,top+16,{align:'right'});
        }
      }
      const totalY=showTotalOnly?top+13:top+(hasDiscount?28:21);
      font(pdf,9.5,true);palette(pdf,'brand');write(pdf,'TOTAL',panelX+5,totalY);
      font(pdf,14,true);palette(pdf,'dark');
      write(pdf,asMoney(content(doc,'total_val')),panelX+panelW-4,totalY+9,{align:'right'});
      y=top+blockHeight;
    }
    function finishFooters(){
      const total=pdf.internal.getNumberOfPages();
      for(let page=1;page<=total;page++){
        pdf.setPage(page);
        stroke(pdf,'line');pdf.setLineWidth(.3);pdf.line(LEFT,FOOTER_Y,right,FOOTER_Y);
        font(pdf,7.2,true);palette(pdf,'secondary');
        write(pdf,footer,LEFT,FOOTER_Y+5.5);
        font(pdf,7.2,false);palette(pdf,'muted');
        write(pdf,'Página '+page+' de '+total,right,FOOTER_Y+5.5,{align:'right'});
      }
      pdf.setPage(total);
    }
    firstHeader();
    client();
    productRows();
    observations();
    conditionsAndTotal();
    finishFooters();
    return pdf;
  }
  const api=Object.freeze({build,getRows});
  root.HomeEasyQuotePDF=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
