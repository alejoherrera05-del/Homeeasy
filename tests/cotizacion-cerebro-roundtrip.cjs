'use strict';
// Ejecuta las rutas reales exportadas del Cerebro contra Sheets/Drive ficticios.
// No incluye código privado ni abre conexiones a Google.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sourcePath=process.env.HOMEEASY_CEREBRO_QA_SOURCE;
if(!sourcePath)throw Error('Indica HOMEEASY_CEREBRO_QA_SOURCE con una exportación autorizada del Cerebro.');
const sheets={};
function sheet(name){
 if(sheets[name])return sheets[name];
 const rows=[Array.from({length:27},(_,i)=>'HEADER'+i)];
 return sheets[name]={rows,getLastRow:()=>rows.length,getDataRange:()=>({getValues:()=>structuredClone(rows)}),appendRow:r=>rows.push(structuredClone(r)),getRange(r,c,n=1,m=1){
   if(r==='B:B')return{getValues:()=>[...rows.map(x=>[x[1]||'']),['']]};
   return{getValue:()=>rows[r-1]?.[c-1]||'',getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]||'')),setValue(v){rows[r-1]||=[];rows[r-1][c-1]=v;return this},setValues(v){v.forEach((row,i)=>row.forEach((v,j)=>{rows[r+i-1]||=[];rows[r+i-1][c+j-1]=v}));return this}};
 }};
}
const ss={getSheetByName:sheet},files=[];
const folder={createFile(blob){const file={getUrl:()=>`https://example.test/pdf/${files.length}`,setSharing(){}};files.push({blob,file});return file}};
const context={console,SpreadsheetApp:{openById:()=>ss},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{base64Decode:x=>Buffer.from(x,'base64'),newBlob:(bytes,mime,name)=>({bytes,mime,name}),getUuid:()=>crypto.randomUUID()},DriveApp:{getRootFolder:()=>folder,Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(sourcePath,'utf8'),context);
Object.assign(context,{json_:x=>x,autorizarLecturaAuth9B_:()=>null,recibosProcesar_:()=>null,getOrCreateFolder_:()=>folder,calcularSha256Bytes_:()=> 'QA-HASH',registrarVersionDocumentoDesdeArchivo_:()=>{},asegurarVersionActivaDocumento_:()=>({version:1,maxVersion:1,hash:'QA-HASH',url:'https://example.test/pdf/0'}),asegurarEstructuraFinancieraAnulaciones_:()=>{},inicializarCotizacionSeguimiento10A_:()=>{},cerrarSeguimientoCotizacion10A_:()=>{}});
const full='Sala · Persiana enrollable · Tela QA 123 · 1,60 × 2,20 m';
for(let mask=0;mask<8;mask++){
 const visibility={hideMeasures:Boolean(mask&1),hideUnitPrices:Boolean(mask&2),hideFabrics:Boolean(mask&4)};
 const items=[{descripcion:full,cantidad:2,precio:600000,subtotal:1200000,presentacion:'individual',visibilidadCliente:visibility,notasTecnicasInternas:true,detallePublico:{original:full,sinMedidas:'Sala · Persiana enrollable · Tela QA 123',sinTelas:'Sala · Persiana enrollable · 1,60 × 2,20 m',sinAmbas:'Sala · Persiana enrollable'}}];
 const data={tipo:'cotizacion',cedula:'QA-FICTICIO',nombre:'QA SIN CLIENTE REAL',descripcion:full,observaciones:'Especificación interna: techo, mando derecho, tela QA 123',total:1200000,itemsJSON:JSON.stringify(items),pdfBase64:Buffer.from('%PDF-QA').toString('base64'),nombreArchivo:'QA.pdf'};
 const created=context.doPostOperacion_(null,data);assert.equal(created.status,'success',JSON.stringify(created));
 const numero=sheet('Cotizaciones').rows.at(-1)[0];
 assert.equal(sheet('Cotizaciones').rows.at(-1)[8],data.itemsJSON);
 const recovered=context.doGet({parameter:{tipo:'EDITAR_COT',numero:String(numero)}});assert.equal(recovered.itemsJSON,data.itemsJSON);
 const edited=context.doPostOperacion_(null,{...data,tipo:'edit_cotizacion',numero,observaciones:data.observaciones+' · revisada'});assert.equal(edited.status,'success',JSON.stringify(edited));
 const conversion=context.doGet({parameter:{convertirCot:String(numero)}});assert.equal(conversion.itemsJSON,data.itemsJSON);assert.equal(conversion.descripcion,full);
 const hommy=context.obtenerCotizacionSnapshot_(ss,numero);assert.deepEqual(JSON.parse(JSON.stringify(hommy.items)),items);assert(hommy.observaciones.includes('mando derecho'));
 const order=context.doPostOperacion_(null,{...data,tipo:'pedido',numeroCotizacion:numero,valorTotal:data.total,abonoInicial:0});assert.equal(order.status,'success',JSON.stringify(order));
 const op=sheet('Ordenes_Pedido').rows.at(-1);assert.equal(op[20],data.itemsJSON);assert.equal(op[4],full);assert.equal(op[6],1200000);
 const restored=context.doGet({parameter:{tipo:'EDITAR_OP',numero:String(op[1])}});assert.equal(restored.itemsJSON,data.itemsJSON);
 console.log('PASS combinación '+mask+': crear → recuperar → editar → Hommy → convertir → guardar/reabrir OP; información completa');
}
console.log('PASS 8 ciclos con rutas del Cerebro real; solo almacenamiento ficticio');
