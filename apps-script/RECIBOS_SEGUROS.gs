/** Recibos: una única escritura atómica de orden, recibo, requestId y auditoría.
 * Integración: ver scripts/integrar-recibos.cjs. No ejecutar contra producción en QA.
 */
var RECIBOS_HEADERS = ['Request_ID','Huella_Solicitud','Resultado_JSON','Anulacion_Request_ID',
  'Anulacion_Huella','Anulacion_Resultado','Anulado_En','Anulado_Por','Motivo_Anulacion',
  'Snapshot_Anulacion','Creado_Por','Creado_En','Revision_Financiera'];

function recibosTexto_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function recibosHash_(v) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(v))
    .map(function(b) { return (b & 255).toString(16).padStart(2,'0'); }).join('');
}
function recibosExigir_(ok, msg) { if (!ok) throw new Error(msg); }
function recibosMonto_(v) {
  var n = Number(v); recibosExigir_(Number.isSafeInteger(n) && n >= 0, 'Importe inválido.'); return n;
}
function recibosActivo_(r) { return estadoAbonoFila_(r) === 'ACTIVO' && abonoAfectaSaldoFila_(r); }
function recibosFila_(rows, col, id) {
  var found = [];
  rows.forEach(function(r,i) { if (i && recibosTexto_(r[col]) === recibosTexto_(id)) found.push(i); });
  recibosExigir_(found.length === 1, 'Identificador inexistente o duplicado.'); return found[0];
}
function recibosConciliar_(op, abonos) {
  var total = recibosMonto_(op[6]);
  var inicial = abonoInicialAfectaSaldoFila_(op) ? recibosMonto_(op[7] || 0) : 0;
  var efectivos = abonos.filter(function(r) { return recibosTexto_(r[1]) === recibosTexto_(op[1]) && recibosActivo_(r); });
  var pagado = inicial + efectivos.reduce(function(a,r) { return a + recibosMonto_(r[5]); },0);
  var columnas = op.slice(8,17).reduce(function(a,v) { return a + recibosMonto_(v || 0); }, inicial);
  recibosExigir_(pagado === columnas, 'La orden y los recibos requieren conciliación antes de continuar.');
  return {total:total, pagado:pagado, saldo:total-pagado, efectivos:efectivos};
}
function recibosCelda_(v) {
  return {userEnteredValue: typeof v === 'number' ? {numberValue:v} : {stringValue:String(v === undefined || v === null ? '' : v)}};
}
function recibosActualizar_(sh, row, col, vals) {
  return {updateCells:{start:{sheetId:sh.getSheetId(),rowIndex:row,columnIndex:col},
    rows:[{values:vals.map(recibosCelda_)}],fields:'userEnteredValue'}};
}
function recibosRevision_(op, abonos, notes) { return recibosHash_([op,abonos,notes]); }
function recibosLeer_(ss, sh, orders) {
  // No mezclar lecturas cacheadas de SpreadsheetApp con escrituras de Sheets API.
  // La API devuelve el estado persistido incluso en un retry dentro de la misma ejecución.
  var result = Sheets.Spreadsheets.Values.batchGet(ss.getId(),{
    ranges:["'Abonos'!A1:AB"+sh.getMaxRows(),"'Ordenes_Pedido'!A1:AE"+orders.getMaxRows()],
    valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'
  });
  return result.valueRanges.map(function(range) { return range.values || []; });
}
function recibosNotas_(ss, row) {
  var result = Sheets.Spreadsheets.get(ss.getId(),{
    ranges:["'Ordenes_Pedido'!I"+row+':Q'+row],fields:'sheets(data(rowData(values(note))))'
  });
  var values = (((result.sheets || [])[0] || {}).data || []).map(function(d) { return ((d.rowData || [])[0] || {}).values || []; })[0] || [];
  return Array.from({length:9},function(_,i) { return (values[i] || {}).note || ''; });
}
function recibosDependencias_(ss, receipt, op) {
  var snapshots=[];
  ['Caja','Anulaciones'].forEach(function(name) {
    var sh=ss.getSheetByName(name);if(!sh)return;
    var result=Sheets.Spreadsheets.Values.batchGet(ss.getId(),{ranges:["'"+name+"'!A1:"+(name==='Caja'?'P':'AP')+sh.getMaxRows()],valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'});
    var values=result.valueRanges[0].values || [];
    values.slice(1).forEach(function(row) {
      if(name==='Caja') {
        var link=String(row[7] || '').toUpperCase().replace(/[\s#_-]/g,'');
        recibosExigir_(['REC'+receipt[0],'RECIBO'+receipt[0],'OP'+op[1]].indexOf(link)<0,'Hay movimientos de Caja vinculados. Requiere revisión financiera.');
      } else {
        recibosExigir_(!(String(row[2])==='REC' && Number(row[3])===Number(receipt[0])) && !(String(row[2])==='OP' && Number(row[3])===Number(op[1])), 'Existen anulaciones o tratamientos financieros relacionados.');
      }
    });
    snapshots.push([name,values]);
  });
  return recibosHash_(snapshots);
}

function recibosAuditoria_(audit, data, actor, before, after, accion, id) {
  recibosExigir_(audit && audit.getRange(1,1,1,HOMEEASY_AUDIT_HEADERS.length).getValues()[0].join('|') === HOMEEASY_AUDIT_HEADERS.join('|'), 'Auditoría no disponible.');
  var meta = data.meta || {};
  var row = [id,new Date().toISOString(),actor,meta.dispositivoId || '',meta.dispositivoNombre || '',
    meta.plataforma || '',meta.navegador || '',meta.pagina || 'abono.html','Abonos',accion,'REC',
    after.recibo,accion+' recibo '+after.recibo,'EXITOSO',data.requestId,
    JSON.stringify({motivo:data.motivo || '',numeroOP:data.numeroOP}), 'recibos-seguros-1',
    JSON.stringify(before),JSON.stringify(after),'[]','','NO','Conserva PDF e historial.',
    JSON.stringify({afectaCaja:true,sinDevolucion:true}),'NO','','',''];
  return {appendCells:{sheetId:audit.getSheetId(),rows:[{values:row.map(recibosCelda_)}],fields:'userEnteredValue'}};
}

function recibosLote_(ss, requests, data) {
  // Si la respuesta de Google se pierde, el diario bloquea nuevas escrituras.
  // Nunca se interpreta un timeout como prueba de que el pago no se guardó.
  var props = PropertiesService.getScriptProperties();
  var key = 'RECIBOS_LOTE_PENDIENTE';
  props.setProperty(key,JSON.stringify({spreadsheet:ss.getId(),requestId:data.requestId,tipo:data.tipo,fecha:new Date().toISOString()}));
  var resp = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(ss.getId())+':batchUpdate',{
    method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    payload:JSON.stringify({requests:requests}),muteHttpExceptions:true
  });
  var code = resp.getResponseCode();
  if (code >= 400 && code < 500 && code !== 408 && code !== 429) {
    var detail = '';
    try { detail = JSON.parse(resp.getContentText()).error.message || ''; } catch (ignored) {}
    props.deleteProperty(key);
    var rejected = new Error('Google rechazó el lote; no se aplicó ningún cambio ('+code+'). '+detail);
    rejected.definitive = true; throw rejected;
  }
  recibosExigir_(code >= 200 && code < 300,'Resultado pendiente de verificar. No vuelvas a registrar este pago.');
  props.deleteProperty(key);
}

function recibosProcesar_(ss, data) {
  var tipo = recibosTexto_(data.tipo);
  if (['abono','PREVISUALIZAR_ANULACION_RECIBO','ANULAR_RECIBO'].indexOf(tipo) < 0) return null;
  var permiso = validarPermisoSesionAuth9B_(ss,data.appSessionToken,data.meta || {},tipo === 'abono' ? 'abonos.write' : 'anulaciones.execute');
  if (permiso.response) return permiso.response;
  return recibosEjecutarAutorizado_(ss,data,permiso.validation);
}

// Función privada: solo el router anterior valida sesiones HTTP. El QA del editor
// usa una base ficticia separada, sin crear usuarios ni sesiones en producción.
function recibosEjecutarAutorizado_(ss, data, identidad) {
  var tipo = recibosTexto_(data.tipo);
  var actorData = identidad.usuario || identidad.perfil || {};
  var actor = recibosTexto_(actorData.nombre || actorData.email || identidad.uid);
  var uid = recibosTexto_(identidad.uid || actorData.uid || actorData.email);
  var lock = LockService.getScriptLock(), locked = false, writeStarted = false, pending = null;
  try {
    recibosExigir_(uid && actor,'No se pudo verificar la identidad del usuario.');
    recibosExigir_(/^[A-Za-z0-9:_-]{8,120}$/.test(recibosTexto_(data.requestId)),'Falta un requestId válido.');
    lock.waitLock(30000); locked = true;
    var sh = ss.getSheetByName('Abonos'), orders = ss.getSheetByName('Ordenes_Pedido');
    recibosExigir_(sh && orders,'No se encontraron las hojas financieras.');
    var persistedData = recibosLeer_(ss,sh,orders), rows = persistedData[0], ops = persistedData[1];
    var headers = Array.from({length:13},function(_,i) { return (rows[0] || [])[15+i] || ''; });
    recibosExigir_(headers.every(function(v,i) { return !v || v === RECIBOS_HEADERS[i]; }),'Esquema de recibos incompatible.');
    pending = PropertiesService.getScriptProperties().getProperty('RECIBOS_LOTE_PENDIENTE');
    if (pending) {
      var journal = JSON.parse(pending);
      var persisted = rows.some(function(r,i) { return i && (r[15] === journal.requestId || r[18] === journal.requestId); });
      recibosExigir_(journal.spreadsheet === ss.getId() && persisted,'Hay una operación de recibos con resultado incierto. Requiere conciliación antes de escribir.');
      PropertiesService.getScriptProperties().deleteProperty('RECIBOS_LOTE_PENDIENTE');
      pending = null;
    }
    var hash = recibosHash_([uid,tipo,data.numeroOP,data.cedula,data.numeroRecibo || '',Number(data.valorAbono || 0),data.medioPago || '',data.concepto || '',data.motivo || '']);
    var reqCol = tipo === 'abono' ? 15 : 18;
    var previous = rows.filter(function(r,i) { return i && r[reqCol] === data.requestId; });
    if (previous.length) {
      recibosExigir_(previous.length === 1 && previous[0][reqCol+1] === hash,'requestId ya utilizado para otra operación o usuario.');
      var replay = JSON.parse(previous[0][reqCol+2]); replay.idempotente = true; return replay;
    }
    recibosExigir_(!rows.some(function(r,i) { return i && (r[15] === data.requestId || r[18] === data.requestId); }),'requestId pertenece a otra operación.');
    var oi = recibosFila_(ops,1,data.numeroOP), op = ops[oi].slice();
    recibosExigir_(recibosTexto_(op[2]) === recibosTexto_(data.cedula),'El recibo no pertenece al cliente de esta orden.');
    recibosExigir_(['ACTIVO','COMPLETADO'].indexOf(recibosTexto_(op[18]).toUpperCase()) >= 0,'La orden no admite cambios de recibos.');
    recibosExigir_(!op[24] && !op[25] && !op[26],'La orden tiene un tratamiento financiero dependiente.');
    var plan = recibosConciliar_(op,rows.slice(1));
    var notes = recibosNotas_(ss,oi+1);
    var audit = ss.getSheetByName('Auditoria');
    var changes = [recibosActualizar_(sh,0,15,RECIBOS_HEADERS)];
    var now = new Date(), response, ri, after, before, auditId = 'AUD-REC-'+Utilities.getUuid();
    if (tipo === 'abono') {
      var amount = recibosMonto_(data.valorAbono);
      recibosExigir_(amount > 0 && amount <= plan.saldo,'El abono supera el saldo real o la orden ya está pagada.');
      recibosExigir_(['EFECTIVO','TRANSFERENCIA','TARJETA','OTRO'].indexOf(recibosTexto_(data.medioPago).toUpperCase()) >= 0,'Medio de pago inválido.');
      var slot = -1;
      for (var c=8;c<17;c++) if (!Number(op[c] || 0)) { slot=c; break; }
      recibosExigir_(slot >= 0,'Máximo de abonos alcanzado.');
      var number = rows.slice(1).reduce(function(n,r) { return Math.max(n,Number(r[0]) || 0); },0)+1;
      var legacyNumber = /^Recibo_N_(\d+)_OP_\d+\.pdf$/.exec(recibosTexto_(data.nombreArchivo));
      var expectedNumber = data.numeroReciboEsperado || (legacyNumber && legacyNumber[1]);
      recibosExigir_(Number(expectedNumber) === number,'La numeración cambió. Actualiza el formulario antes de emitir el PDF.');
      recibosExigir_(data.pdfBase64 && data.nombreArchivo === 'Recibo_N_'+number+'_OP_'+data.numeroOP+'.pdf','El PDF no corresponde al recibo asignado.');
      // El PDF se prepara antes del lote; ningún fallo de Drive modifica la orden.
      var root = getOrCreateFolder_(DriveApp.getRootFolder(),ss.getId() === HOMEEASY_SPREADSHEET_ID ? 'HomeEasy' : 'Hommy QA recibos ficticios');
      var folder = getOrCreateFolder_(getOrCreateFolder_(getOrCreateFolder_(root,now.getFullYear().toString()),getMes_(now)),op[2]+' - '+op[3]);
      var bytes = Utilities.base64Decode(data.pdfBase64);
      recibosExigir_(bytes.length > 4 && String.fromCharCode.apply(null,bytes.slice(0,4)) === '%PDF','El documento no es un PDF válido.');
      var file = getOrCreateFolder_(folder,'Recibos').createFile(Utilities.newBlob(bytes,'application/pdf',data.nombreArchivo));
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
      response = {status:'success',numero_recibo:number,url:file.getUrl(),version:1,saldo:plan.saldo-amount,auditoriaId:auditId};
      var record = [number,op[1],op[2],op[3],now.toISOString(),amount,data.medioPago,file.getUrl(),'ACTIVO','SI','SI','RECIBO','','','',data.requestId,hash,JSON.stringify(response),'','','','','','','',uid,now.toISOString(),'recibos-seguros-1'];
      before = {orden:ops[oi],recibo:null};
      op[slot]=amount; op[17]=response.saldo; op[18]=response.saldo===0?'COMPLETADO':'ACTIVO';
      after = {orden:op,recibo:number,registro:record};
      changes.push({appendCells:{sheetId:sh.getSheetId(),rows:[{values:record.map(recibosCelda_)}],fields:'userEnteredValue'}});
      changes.push({updateCells:{start:{sheetId:orders.getSheetId(),rowIndex:oi,columnIndex:slot},rows:[{values:[{note:'Recibo #'+number+' - '+now.toISOString()}]}],fields:'note'}});
    } else {
      ri = recibosFila_(rows,0,data.numeroRecibo);
      var receipt = Array.from({length:28},function(_,i) { return rows[ri][i] === undefined ? '' : rows[ri][i]; });
      recibosExigir_(recibosTexto_(receipt[1]) === recibosTexto_(op[1]) && recibosTexto_(receipt[2]) === recibosTexto_(op[2]),'Recibo ajeno a esta orden o cliente.');
      recibosExigir_(recibosActivo_(receipt) && abonoAfectaCajaFila_(receipt) && tipoRegistroAbonoFila_(receipt) === 'RECIBO' && !receipt[12] && !receipt[13],'El recibo ya está anulado o tiene relaciones financieras.');
      var dependencies = recibosDependencias_(ss,receipt,op);
      var match = [];
      notes.forEach(function(note,i) { if (new RegExp('^Recibo #'+Number(receipt[0])+'(?:\\s|$)').test(note)) match.push(i+8); });
      recibosExigir_(match.length===1 && Number(op[match[0]])===Number(receipt[5]),'No se pudo identificar inequívocamente la columna del recibo.');
      var revision = recibosRevision_(ops[oi],rows,[notes,dependencies]);
      response = {status:'success',numeroRecibo:receipt[0],numeroOP:op[1],valor:receipt[5],pagado:plan.pagado-Number(receipt[5]),saldo:plan.total-plan.pagado+Number(receipt[5]),expectedRevision:revision};
      recibosExigir_(response.saldo>=0,'La corrección no concilia la orden; requiere revisión financiera.');
      if (tipo === 'PREVISUALIZAR_ANULACION_RECIBO') return response;
      recibosExigir_(data.confirmado === true && data.sinDevolucion === true,'Confirma la corrección de un registro sin devolución de dinero.');
      var reason = recibosTexto_(data.motivo);
      recibosExigir_(reason.length>=5 && reason.length<=500 && !/^[=+@-]/.test(reason),'Motivo obligatorio de 5 a 500 caracteres.');
      recibosExigir_(data.expectedRevision === revision,'Los datos cambiaron. Vuelve a revisar el recibo.');
      before = {orden:ops[oi],recibo:rows[ri],notasAbonos:notes,dependenciasHash:dependencies};
      op[match[0]]=''; op[17]=response.saldo; op[18]=response.saldo===0?'COMPLETADO':'ACTIVO';
      response.auditoriaId=auditId; delete response.expectedRevision;
      receipt[8]='ANULADO'; receipt[9]='NO'; receipt[10]='NO'; receipt[12]=auditId;
      receipt[18]=data.requestId; receipt[19]=hash; receipt[20]=JSON.stringify(response);
      receipt[21]=now.toISOString(); receipt[22]=uid; receipt[23]=reason;
      receipt[24]=JSON.stringify(before); receipt[27]='recibos-seguros-1';
      after = {orden:op,recibo:receipt[0],registro:receipt};
      changes.push(recibosActualizar_(sh,ri,8,receipt.slice(8,28)));
      changes.push({updateCells:{start:{sheetId:orders.getSheetId(),rowIndex:oi,columnIndex:match[0]},rows:[{values:[{note:'ANULADO recibo #'+receipt[0]+'; '+auditId}]}],fields:'note'}});
    }
    changes.push(recibosActualizar_(orders,oi,8,op.slice(8,19)));
    changes.push(recibosAuditoria_(audit,data,actor,before,after,tipo==='abono'?'REGISTRAR':'ANULAR',auditId));
    writeStarted = true;
    recibosLote_(ss,changes,data);
    if (tipo === 'abono') {
      try {
        registrarVersionDocumentoDesdeArchivo_(ss,{tipo:'REC',numero:number,version:1,file:file,url:file.getUrl(),
          hash:calcularSha256Bytes_(bytes),fechaDocumento:now,cedula:op[2],cliente:op[3],estadoDocumento:'EMITIDO',
          origen:'CREACION',requestId:data.requestId,operador:actor,dispositivoId:(data.meta || {}).dispositivoId || ''});
      } catch (indexError) { console.error('Recibo guardado; índice documental pendiente de sincronización: '+indexError); }
    }
    return response;
  } catch (error) {
    return {status:'error',code:'RECIBO_NO_CONFIRMADO',definitive:error.definitive === true || (!writeStarted && !pending),msg:String(error.message || error)};
  } finally { if (locked) lock.releaseLock(); }
}
