'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('apps-script/RECIBOS_SEGUROS.gs','utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name)}
function environment(duplicated=false){
  let ids=0,files=0,locked=false,failure='',allowed=true,uid='admin-qa';
  let state={
    Abonos:[Array(28).fill(''),[57,49,'QA','CLIENTE FICTICIO','2026-10-01T12:00:00Z',2000000,'TRANSFERENCIA','pdf57','ACTIVO','SI','SI','RECIBO']],
    Ordenes_Pedido:[Array(31).fill(''),['2026-10-01',49,'QA','CLIENTE FICTICIO','','',3920000,0,2000000,'','','','','','','','',1920000,'ACTIVO','pdfOP','','SIN_PAGO','NO','NO']],
    Auditoria:[Array.from({length:28},(_,i)=>'audit'+i)],Caja:[Array(16).fill('')],Anulaciones:[Array(42).fill('')]
  };
  let notes=['Recibo #57 - QA','','','','','','','',''];
  if(duplicated){
    [63,64].forEach(n=>state.Abonos.push([n,49,'QA','CLIENTE FICTICIO','2026-10-16T20:46:00Z',1920000,'EFECTIVO','pdf'+n,'ACTIVO','SI','SI','RECIBO']));
    state.Ordenes_Pedido[1][9]=1920000;state.Ordenes_Pedido[1][10]=1920000;
    state.Ordenes_Pedido[1][17]=0;state.Ordenes_Pedido[1][18]='COMPLETADO';
    notes[1]='Recibo #63 - QA';notes[2]='Recibo #64 - QA';
  }
  const properties=new Map(),names=Object.keys(state);
  const sheets=Object.fromEntries(names.map((name,id)=>[name,{
    getSheetId:()=>id,getMaxRows:()=>1000,getDataRange:()=>({getValues:()=>structuredClone(state[name])}),
    getRange:(row,col,n=1,m=1)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>state[name][row-1+i]?.[col-1+j]??'')),getNotes:()=>[notes.slice()]}),
  }]));
  const ss={getSheetByName:n=>sheets[n],getId:()=> 'QA_ONLY'};
  const props={setProperty:(k,v)=>properties.set(k,v),getProperty:k=>properties.get(k),deleteProperty:k=>properties.delete(k)};
  const folder={createFolder:()=>folder,createFile:()=>{files++;if(failure==='pdf')throw Error('Drive falló');return {getUrl:()=> 'pdfNuevo',setSharing(){}}}};
  const ctx={console,Date,Math,JSON,Number,String,Array,Object,RegExp,encodeURIComponent,
    Utilities:{getUuid:()=> 'uuid-'+(++ids),DigestAlgorithm:{SHA_256:'SHA256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],base64Decode:s=>[...Buffer.from(s,'base64')],newBlob:()=>({})},
    PropertiesService:{getScriptProperties:()=>props},ScriptApp:{getOAuthToken:()=> 'TEST_TOKEN'},
    Sheets:{Spreadsheets:{Values:{batchGet:(_,opts)=>({valueRanges:opts.ranges.map(r=>({values:structuredClone(state[/^'([^']+)'/.exec(r)[1]])}))})},get:()=>({sheets:[{data:[{rowData:[{values:notes.map(note=>({note}))}]}]}]})}},
    LockService:{getScriptLock:()=>({waitLock(){if(locked)throw Error('Ocupado');locked=true},releaseLock(){locked=false}})},
    validarPermisoSesionAuth9B_:()=>allowed?{validation:{uid,usuario:{nombre:'USUARIO QA'}}}:{response:{status:'error',code:'PERMISSION_DENIED'}},
    estadoAbonoFila_:r=>String(r[8]||'ACTIVO'),abonoAfectaSaldoFila_:r=>r[10]!=='NO',abonoAfectaCajaFila_:r=>r[9]!=='NO',
    tipoRegistroAbonoFila_:r=>r[11]||'RECIBO',abonoInicialAfectaSaldoFila_:r=>r[23]!=='NO',
    HOMEEASY_AUDIT_HEADERS:state.Auditoria[0], HOMEEASY_SPREADSHEET_ID:'PRODUCCION_NO_USAR',
    DriveApp:{getRootFolder:()=>folder,Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1}},
    getOrCreateFolder_:()=>folder,getMes_:()=> 'Octubre',
    registrarVersionDocumentoDesdeArchivo_:()=>{},calcularSha256Bytes_:()=> 'hash',
    UrlFetchApp:{fetch(url,options){
      assert(locked,'El lote debe ejecutarse bajo LockService');
      assert(url.includes('QA_ONLY'),'Jamás usar una base real');
      const requests=JSON.parse(options.payload).requests;
      const candidate=structuredClone(state),newNotes=notes.slice();
      if(failure==='before')return {getResponseCode:()=>400};
      if(failure==='network-before')throw Error('Red antes del lote');
      for(const req of requests){
        if(req.updateCells){const x=req.updateCells,n=names[x.start.sheetId];
          const row=x.start.rowIndex,col=x.start.columnIndex;
          candidate[n][row]??=[];
          x.rows[0].values.forEach((v,i)=>{
            if(x.fields==='note'){newNotes[col+i-8]=v.note;return}
            candidate[n][row][col+i]=v.userEnteredValue.numberValue??v.userEnteredValue.stringValue;
          });
        }else if(req.appendCells){const x=req.appendCells,n=names[x.sheetId];candidate[n].push(x.rows[0].values.map(v=>v.userEnteredValue.numberValue??v.userEnteredValue.stringValue));}
        else throw Error('Solicitud no soportada');
      }
      state=candidate;notes=newNotes;
      if(failure==='after')throw Error('Respuesta perdida tras commit');
      return {getResponseCode:()=>200};
    }}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,ss,call:d=>ctx.recibosProcesar_(ss,d),state:()=>state,files:()=>files,
    setFailure:v=>failure=v,setPermission:v=>allowed=v,setUid:v=>uid=v,lock:v=>locked=v,props,notes:()=>notes};
}
function payment(extra={}){return {tipo:'abono',requestId:'request-pago-0001',numeroOP:49,cedula:'QA',valorAbono:1920000,medioPago:'EFECTIVO',numeroReciboEsperado:58,pdfBase64:Buffer.from('%PDF ficticio').toString('base64'),nombreArchivo:'Recibo_N_58_OP_49.pdf',...extra}}
function preview(e){return e.call({tipo:'PREVISUALIZAR_ANULACION_RECIBO',requestId:'request-anular-0001',numeroOP:49,cedula:'QA',numeroRecibo:64})}
function cancellation(e,extra={}){const p=preview(e);assert.equal(p.status,'success',p.msg);return {tipo:'ANULAR_RECIBO',requestId:'request-anular-0001',numeroOP:49,cedula:'QA',numeroRecibo:64,expectedRevision:p.expectedRevision,motivo:'Registro duplicado sin segundo pago real',confirmado:true,sinDevolucion:true,...extra}}
test('creación, saldo y numeración bajo lock',()=>{const e=environment();const r=e.call(payment());assert.equal(r.status,'success',r.msg);assert.equal(r.numero_recibo,58);assert.equal(e.state().Ordenes_Pedido[1][17],0);assert.equal(e.state().Auditoria.length,2)});
test('compatibilidad con formulario previo: deriva numeración del PDF existente',()=>{const e=environment();const d=payment();delete d.numeroReciboEsperado;assert.equal(e.call(d).status,'success')});
test('reintento idéntico: una fila, un PDF y una auditoría',()=>{const e=environment();e.call(payment());const r=e.call(payment());assert.equal(r.idempotente,true);assert.equal(e.files(),1);assert.equal(e.state().Abonos.length,3);assert.equal(e.state().Auditoria.length,2)});
test('requestId reutilizado con importe u otro usuario: rechazado',()=>{const e=environment();e.call(payment());assert.equal(e.call(payment({valorAbono:1})).status,'error');e.setUid('otro-usuario');assert.equal(e.call(payment()).status,'error')});
test('dos pestañas con requestId diferentes: rechaza segundo pago sobre saldo',()=>{const e=environment();assert.equal(e.call(payment()).status,'success');assert.equal(e.call(payment({requestId:'otra-pestana-0002'})).status,'error');assert.equal(e.state().Abonos.length,3)});
test('concurrencia: lock ocupado no escribe',()=>{const e=environment();e.lock(true);assert.equal(e.call(payment()).status,'error');assert.equal(e.state().Abonos.length,2)});
test('respuesta perdida después de guardar: retry recupera commit sin duplicar',()=>{const e=environment();e.setFailure('after');assert.equal(e.call(payment()).status,'error');e.setFailure('');assert.equal(e.call(payment()).idempotente,true);assert.equal(e.state().Abonos.length,3);assert.equal(e.files(),1)});
test('fallo antes del commit: orden, recibos y auditoría intactos',()=>{const e=environment(),before=structuredClone(e.state());e.setFailure('before');assert.equal(e.call(payment()).status,'error');assert.deepEqual(e.state(),before)});
test('timeout sin resultado comprobable: bloquea escrituras siguientes',()=>{const e=environment();e.setFailure('network-before');e.call(payment());e.setFailure('');assert.equal(e.call(payment({requestId:'otro-pago-0003'})).status,'error');assert.equal(e.state().Abonos.length,2)});
test('Drive falla: no cambia importes ni crea recibo',()=>{const e=environment(),before=structuredClone(e.state());e.setFailure('pdf');assert.equal(e.call(payment()).status,'error');assert.deepEqual(e.state(),before)});
test('importe, cliente, numeración y saldo se validan antes de Drive',()=>{for(const change of [{valorAbono:-1},{valorAbono:2000000},{cedula:'AJENO'},{numeroReciboEsperado:999}]){const e=environment();assert.equal(e.call(payment(change)).status,'error');assert.equal(e.files(),0)}});
test('anulación individual: 64 anulado, 63 intacto, saldo cero, sin gasto/reembolso',()=>{const e=environment(true),before63=structuredClone(e.state().Abonos[2]);const r=e.call(cancellation(e));assert.equal(r.status,'success',r.msg);assert.equal(r.pagado,3920000);assert.equal(r.saldo,0);assert.deepEqual(e.state().Abonos[2],before63);assert.equal(e.state().Abonos[3][8],'ANULADO');assert.equal(e.state().Abonos[3][7],'pdf64');assert.equal(e.state().Abonos[3][9],'NO');assert.equal(e.state().Abonos[3][10],'NO');assert.equal(e.state().Ordenes_Pedido[1][10],'');assert.equal(e.state().Auditoria.length,2)});
test('anulación repetida: replay y rechazo con nuevo requestId',()=>{const e=environment(true),d=cancellation(e);e.call(d);assert.equal(e.call(d).idempotente,true);assert.equal(e.call({...d,requestId:'segunda-anulacion-02'}).status,'error');assert.equal(e.state().Auditoria.length,2)});
test('permisos y motivo/confirmación obligatorios',()=>{let e=environment();e.setPermission(false);assert.equal(e.call(payment()).code,'PERMISSION_DENIED');for(const change of [{motivo:''},{confirmado:false},{sinDevolucion:false},{cedula:'AJENO'}]){e=environment(true);const d=cancellation(e,change);assert.equal(e.call(d).status,'error');assert.equal(e.state().Abonos[3][8],'ACTIVO')}});
test('revisión cambiada y columna ambigua: no escribe',()=>{const e=environment(true),d=cancellation(e);e.state().Ordenes_Pedido[1][5]='Modificada';assert.equal(e.call(d).status,'error');e.notes()[2]='';assert.equal(preview(e).status,'error')});
test('movimiento vinculado y tratamiento financiero: anulación bloqueada',()=>{let e=environment(true);e.state().Caja.push([1,'','INGRESO','','',1920000,'','REC-64']);assert.equal(preview(e).status,'error');e=environment(true);e.state().Anulaciones.push(['ANU','','OP',49]);assert.equal(preview(e).status,'error')});
test('Caja cambia tras la confirmación: revisión vencida, ninguna escritura',()=>{const e=environment(true),d=cancellation(e);e.state().Caja.push([1,'','GASTO','','',100]);assert.equal(e.call(d).status,'error');assert.equal(e.state().Abonos[3][8],'ACTIVO')});
test('conciliación Caja: solo pagos efectivos y exclusión exacta 1.920.000',()=>{const e=environment(true);const sum=()=>e.state().Abonos.slice(1).filter(r=>r[9]!=='NO').reduce((a,r)=>a+Number(r[5]),0);const before=sum();e.call(cancellation(e));assert.equal(before-sum(),1920000);assert.equal(sum(),3920000)});
console.log('PASS '+passed+' escenarios financieros ficticios; sin acceso a producción');
