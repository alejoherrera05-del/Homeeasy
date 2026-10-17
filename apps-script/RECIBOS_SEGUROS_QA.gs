/** Ejecutar desde el editor. Solo crea y modifica una base nueva con datos ficticios. */
function certificarRecibosSegurosQA() {
  var ss=SpreadsheetApp.create('Hommy QA — recibos FICTICIOS — '+new Date().toISOString());
  ss.setSpreadsheetTimeZone('America/Bogota');
  recibosExigir_(ss.getId() !== HOMEEASY_SPREADSHEET_ID,'QA nunca utiliza la base productiva.');
  var ab=ss.getSheets()[0]; ab.setName('Abonos'); ab.insertColumnsAfter(26,2);
  var op=ss.insertSheet('Ordenes_Pedido');op.insertColumnsAfter(26,5);
  var audit=ss.insertSheet('Auditoria');audit.insertColumnsAfter(26,2);
  audit.getRange(1,1,1,HOMEEASY_AUDIT_HEADERS.length).setValues([HOMEEASY_AUDIT_HEADERS]);
  var headers=['Numero_Recibo','Numero_OP','Cedula','Nombre_Cliente','Fecha_Pago','Valor_Abono','Medio_Pago','URL_PDF_Recibo','Estado_Registro','Afecta_Caja','Afecta_Saldo','Tipo_Registro','Anulacion_ID','OP_Origen','Notas_Ajuste'];
  ab.getRange(1,1,1,15).setValues([headers]);
  ab.getRange(2,1,1,15).setValues([[57,49,'QA-FICTICIO','CLIENTE QA',new Date(),2000000,'TRANSFERENCIA','PDF-FICTICIO','ACTIVO','SI','SI','RECIBO','','','']]);
  var order=Array(31).fill('');
  order[0]=new Date();order[1]=49;order[2]='QA-FICTICIO';order[3]='CLIENTE QA';order[6]=3920000;order[7]=0;order[8]=2000000;order[17]=1920000;order[18]='ACTIVO';order[21]='SIN_PAGO';order[22]='NO';order[23]='NO';
  op.getRange(2,1,1,31).setValues([order]);op.getRange(2,9).setNote('Recibo #57 - QA');
  SpreadsheetApp.flush();
  var actor={usuario:{uid:'QA-EDITOR',nombre:'PRUEBA FICTICIA'}};
  var pdf=Utilities.newBlob('<html><body>RECIBO FICTICIO — NO VÁLIDO</body></html>','text/html').getAs('application/pdf');
  var data={tipo:'abono',requestId:'QA-PAGO-'+Utilities.getUuid(),numeroOP:49,cedula:'QA-FICTICIO',valorAbono:1920000,medioPago:'EFECTIVO',numeroReciboEsperado:58,
    pdfBase64:Utilities.base64Encode(pdf.getBytes()),nombreArchivo:'Recibo_N_58_OP_49.pdf',meta:{pagina:'QA_EDITOR'}};
  var first=recibosEjecutarAutorizado_(ss,data,actor);
  recibosExigir_(first.status==='success','Creación real en base QA: '+JSON.stringify(first));
  var retry=recibosEjecutarAutorizado_(ss,data,actor);
  recibosExigir_(retry.idempotente===true && ab.getLastRow()===3,'El retry duplicó el pago ficticio.');
  var second=Object.assign({},data,{requestId:'QA-OTRA-'+Utilities.getUuid()});
  recibosExigir_(recibosEjecutarAutorizado_(ss,second,actor).status==='error','Se aceptó sobrepago en QA.');
  var p={tipo:'PREVISUALIZAR_ANULACION_RECIBO',requestId:'QA-ANULAR-'+Utilities.getUuid(),numeroOP:49,cedula:'QA-FICTICIO',numeroRecibo:58};
  var preview=recibosEjecutarAutorizado_(ss,p,actor);
  recibosExigir_(preview.status==='success','No se pudo previsualizar la anulación QA: '+JSON.stringify(preview));
  var cancel=Object.assign({},p,{tipo:'ANULAR_RECIBO',expectedRevision:preview.expectedRevision,motivo:'Prueba ficticia de anulación, sin devolución',confirmado:true,sinDevolucion:true});
  var cancelled=recibosEjecutarAutorizado_(ss,cancel,actor);
  recibosExigir_(cancelled.status==='success' && cancelled.saldo===1920000,'No concilió la anulación QA: '+JSON.stringify(cancelled));
  recibosExigir_(recibosEjecutarAutorizado_(ss,cancel,actor).idempotente===true,'La anulación QA no fue idempotente.');
  var afterCancel = recibosLeer_(ss,ab,op)[0][2];
  recibosExigir_(afterCancel[8]==='ANULADO' && afterCancel[9]==='NO' && afterCancel[10]==='NO','Flags incorrectos tras anular.');
  recibosExigir_(audit.getLastRow()===3,'La auditoría no contiene exactamente creación y anulación.');
  // Recrear exclusivamente con datos ficticios el incidente 63/64 y usar el
  // cálculo real de Caja del Cerebro, sin modificar su implementación.
  [63,64].forEach(function(n) { ab.appendRow([n,49,'QA-FICTICIO','CLIENTE QA',new Date(),1920000,'EFECTIVO','PDF-FICTICIO-'+n,'ACTIVO','SI','SI','RECIBO','','','']); });
  op.getRange(2,10,1,2).setValues([[1920000,1920000]]);
  op.getRange(2,10).setNote('Recibo #63 - QA');op.getRange(2,11).setNote('Recibo #64 - QA');
  op.getRange(2,18,1,2).setValues([[0,'COMPLETADO']]);SpreadsheetApp.flush();
  var cajaAntes=recibosCajaQA_(ss).saldo;
  var p64={tipo:'PREVISUALIZAR_ANULACION_RECIBO',requestId:'QA-DUPLICADO-'+Utilities.getUuid(),numeroOP:49,cedula:'QA-FICTICIO',numeroRecibo:64};
  var previa64=recibosEjecutarAutorizado_(ss,p64,actor);
  recibosExigir_(previa64.status==='success','No se pudo analizar el duplicado ficticio: '+JSON.stringify(previa64));
  var anulacion64=recibosEjecutarAutorizado_(ss,Object.assign({},p64,{tipo:'ANULAR_RECIBO',expectedRevision:previa64.expectedRevision,motivo:'Duplicado ficticio, sin segundo pago ni devolución',confirmado:true,sinDevolucion:true}),actor);
  recibosExigir_(anulacion64.status==='success' && anulacion64.pagado===3920000 && anulacion64.saldo===0,'No concilió el duplicado ficticio.');
  var cajaDespues=recibosCajaQA_(ss).saldo;
  recibosExigir_(cajaAntes-cajaDespues===1920000 && cajaDespues===3920000,'El cálculo real de Caja no excluyó exactamente el duplicado.');
  var after64=recibosLeer_(ss,ab,op)[0];
  recibosExigir_(after64[3][8]==='ACTIVO' && after64[4][8]==='ANULADO','No se conservó el recibo ficticio 63.');
  var report={status:'PASS',spreadsheetId:ss.getId(),url:ss.getUrl(),pruebas:9,cajaAntes:cajaAntes,cajaDespues:cajaDespues,produccionModificada:false};
  console.log(JSON.stringify(report)); return report;
}

function recibosCajaQA_(ss) {
  // Ejecuta el cálculo original contra lecturas reales de Sheets sin reutilizar
  // la caché de SpreadsheetApp entre las dos fases de esta misma ejecución QA.
  var adapter={getSheetByName:function(name) {
    var sh=ss.getSheetByName(name);
    if(!sh)return null;
    return {getDataRange:function() {return {getValues:function() {
      var values=Sheets.Spreadsheets.Values.get(ss.getId(),"'"+name+"'!A1:AE"+sh.getMaxRows(),{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'}).values || [];
      var col=name==='Abonos'?4:0;
      values.forEach(function(row,i) {if(i && typeof row[col]==='number')row[col]=new Date(Math.round((row[col]-25569)*86400000)+18000000);});
      return values;
    }}}};
  }};
  return obtenerDatosCaja_(adapter);
}
