/** Recuperación puntual autorizada del incidente del 16/10/2026.
 * Solo ejecutable por el propietario desde el editor. No existe ruta HTTP.
 * Requiere RECIBO64_RESPALDO_ID en propiedades del proyecto.
 */
function corregirRecibo64HomeEasy() {
  var owner=DriveApp.getFileById(ScriptApp.getScriptId()).getOwner().getEmail();
  var actor=Session.getEffectiveUser().getEmail();
  recibosExigir_(actor && owner && actor===owner,'La recuperación exige al propietario del Cerebro.');
  recibosExigir_(HOMEEASY_SPREADSHEET_ID==='1hnHAeKhyd9MVCn1bCm8XExl4hdV2ijqdIjCXoJba1iY','La base configurada no corresponde al incidente.');
  var backupId=PropertiesService.getScriptProperties().getProperty('RECIBO64_RESPALDO_ID');
  if(!backupId) {
    var backups=DriveApp.getFilesByName('HomeEasy — respaldo previo corrección REC-64 — 2026-10-16');
    recibosExigir_(backups.hasNext(),'No se encontró el respaldo verificado del incidente.');
    backupId=backups.next().getId();
    recibosExigir_(!backups.hasNext(),'Hay respaldos con nombres repetidos; se requiere seleccionar explícitamente el ID.');
  }
  recibosExigir_(backupId && backupId!==HOMEEASY_SPREADSHEET_ID,'Falta una copia de respaldo independiente.');
  var ss=SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID),backup=SpreadsheetApp.openById(backupId);
  var ab=ss.getSheetByName('Abonos'),op=ss.getSheetByName('Ordenes_Pedido');
  var live=recibosLeer_(ss,ab,op),saved=recibosLeer_(backup,backup.getSheetByName('Abonos'),backup.getSheetByName('Ordenes_Pedido'));
  var r64=live[0][recibosFila_(live[0],0,64)],r63=live[0][recibosFila_(live[0],0,63)];
  if(r64[8]==='ANULADO' && r64[18]==='CORRECCION-REC64-OP49-20261016') {
    console.log(JSON.stringify({status:'success',idempotente:true,recibo64:'ANULADO',caja:recibosCajaSinCache_(ss).saldo}));return;
  }
  [r63,r64].forEach(function(r) {
    recibosExigir_(Number(r[1])===49 && Number(r[5])===1920000 && r[6]==='EFECTIVO' && r[8]==='ACTIVO' && r[9]==='SI' && r[10]==='SI','Los datos reales ya no coinciden con el incidente autorizado.');
    var b=saved[0][recibosFila_(saved[0],0,r[0])];
    recibosExigir_(JSON.stringify(r.slice(0,15))===JSON.stringify(b.slice(0,15)),'El respaldo no conserva el estado previo del recibo.');
  });
  recibosExigir_(String(r63[2])===String(r64[2]),'Los recibos no pertenecen al mismo cliente.');
  recibosExigir_(!live[0].slice(1).some(function(r) {return Number(r[1])===49 && Number(r[0])>64;}),'Existen recibos posteriores de esta orden: requiere revisión.');
  var orden=live[1][recibosFila_(live[1],1,49)];
  var conciliacion=recibosConciliar_(orden,live[0].slice(1));
  recibosExigir_(conciliacion.total===3920000 && conciliacion.pagado===5840000,'Los importes no coinciden con la corrección autorizada.');
  var hash63=calcularSha256Bytes_(DriveApp.getFileById(extraerIdDriveInventario_(r63[7])).getBlob().getBytes());
  var hash64=calcularSha256Bytes_(DriveApp.getFileById(extraerIdDriveInventario_(r64[7])).getBlob().getBytes());
  recibosExigir_(hash63 && hash63===hash64,'Los PDF no son idénticos: no se puede certificar la retransmisión del mismo recibo.');
  var caja=ss.getSheetByName('Caja');
  var cajaAntesRows=Sheets.Spreadsheets.Values.get(ss.getId(),"'Caja'!A1:Z"+caja.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE'}).values || [];
  recibosExigir_(!cajaAntesRows.slice(1).some(function(r) {return /(?:REC(?:IBO)?[- #]*64|OP[- #]*49)(?:\D|$)/i.test(String(r[7] || ''));}),'Hay movimientos financieros vinculados: requiere revisión.');
  var anulaciones=ss.getSheetByName('Anulaciones');
  var ann=Sheets.Spreadsheets.Values.get(ss.getId(),"'Anulaciones'!A1:AP"+anulaciones.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE'}).values || [];
  recibosExigir_(!ann.slice(1).some(function(r) {return ['OP','REC'].indexOf(String(r[2]))>=0 && Number(r[3])===(r[2]==='OP'?49:64);}), 'Existen anulaciones o tratamientos relacionados.');
  var audit=ss.getSheetByName('Auditoria');
  var auditRows=Sheets.Spreadsheets.Values.get(ss.getId(),"'Auditoria'!A1:AB"+audit.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'}).values || [];
  recibosExigir_(!auditRows.slice(1).some(function(r) {return Number(r[1])>Number(r64[4]) && String(r[10])==='OP' && Number(r[11])===49 && /EDIT|ANUL|RESTAUR|AJUST|TRASL|RECONCIL/i.test(String(r[9]));}), 'La orden tiene modificaciones posteriores dependientes.');
  var cajaAntes=recibosCajaSinCache_(ss).saldo;
  var identity={usuario:{uid:'GOOGLE_EDITOR:'+actor,nombre:actor}};
  var data={tipo:'PREVISUALIZAR_ANULACION_RECIBO',requestId:'CORRECCION-REC64-OP49-20261016',numeroOP:49,cedula:r64[2],numeroRecibo:64,
    meta:{pagina:'Apps Script · recuperación autorizada',dispositivoId:'GOOGLE_EDITOR'}};
  var preview=recibosEjecutarAutorizado_(ss,data,identity);
  recibosExigir_(preview.status==='success' && preview.pagado===3920000 && preview.saldo===0,'La previsualización no concilia: '+JSON.stringify(preview));
  data.tipo='ANULAR_RECIBO';data.expectedRevision=preview.expectedRevision;data.confirmado=true;data.sinDevolucion=true;
  data.motivo='Corrección autorizada por el propietario: REC-64 duplica el mismo pago de REC-63; el usuario confirmó que no existió segundo pago ni devolución. PDF idéntico SHA-256 '+hash63+'. Respaldo '+backupId;
  var result=recibosEjecutarAutorizado_(ss,data,identity);
  recibosExigir_(result.status==='success','No se confirmó la corrección: '+JSON.stringify(result));
  var after=recibosLeer_(ss,ab,op),kept=after[0][recibosFila_(after[0],0,63)],voided=after[0][recibosFila_(after[0],0,64)];
  var afterOrder=after[1][recibosFila_(after[1],1,49)];
  var cajaDespues=recibosCajaSinCache_(ss).saldo;
  var cajaDespuesRows=Sheets.Spreadsheets.Values.get(ss.getId(),"'Caja'!A1:Z"+caja.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE'}).values || [];
  recibosExigir_(JSON.stringify(kept)===JSON.stringify(r63),'El recibo 63 cambió inesperadamente.');
  recibosExigir_(voided[8]==='ANULADO' && voided[9]==='NO' && voided[10]==='NO' && voided[7]===r64[7],'No se verificó la exclusión del recibo 64 o la conservación del PDF.');
  recibosExigir_(Number(afterOrder[17])===0 && afterOrder[18]==='COMPLETADO' && recibosConciliar_(afterOrder,after[0].slice(1)).pagado===3920000,'OP-49 no quedó conciliada.');
  recibosExigir_(JSON.stringify(cajaAntesRows)===JSON.stringify(cajaDespuesRows) && cajaAntes-cajaDespues===1920000,'Caja requiere revisión posterior; no repetir la corrección.');
  var report={status:'success',recibo64:'ANULADO',recibo63:'ACTIVO',pagado:3920000,saldo:0,cajaAntes:cajaAntes,cajaDespues:cajaDespues,
    diferenciaCaja:1920000,auditoriaId:result.auditoriaId,backupId:backupId,pdfConservados:true,hashPdfDuplicado:hash63};
  console.log(JSON.stringify(report));return report;
}

function recibosCajaSinCache_(ss) {
  return obtenerDatosCaja_({getSheetByName:function(name) {
    var sh=ss.getSheetByName(name);if(!sh)return null;
    return {getDataRange:function() {return {getValues:function() {
      var lastCol=name==='Ordenes_Pedido'?'AE':name==='Abonos'?'AB':'Z';
      var values=Sheets.Spreadsheets.Values.get(ss.getId(),"'"+name+"'!A1:"+lastCol+sh.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'}).values || [];
      var dateCol=name==='Abonos'?4:name==='Caja'?1:0;
      values.forEach(function(row,i) {if(i && typeof row[dateCol]==='number')row[dateCol]=new Date(Math.round((row[dateCol]-25569)*86400000)+18000000);});
      return values;
    }}}};
  }});
}
