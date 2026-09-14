const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(__dirname + '/../apps-script/CAJA_CORRECCIONES.gs', 'utf8');
const headers = ['ID','Fecha','Tipo','Categoría','Descripción','Valor','Anulacion_ID','Documento_Origen','Tipo_Ajuste','Operador'];
const auditHeaders = ['ID','Fecha','Operador','Dispositivo_ID','Dispositivo','Plataforma','Navegador','Pagina','Modulo','Accion','Entidad','Entidad_ID','Resumen','Estado','Request_ID','Datos_JSON','Version_App','Antes_JSON','Despues_JSON','Cambios_JSON','Error','Reversible','Motivo_No_Reversible','Dependencias_JSON','Revertida','Revertida_Por','Revertida_En','Operacion_Relacionada_ID'];
class Sheet {
  constructor(rows) { this.rows = rows; this.writes = 0; this.failNextWrite = false; }
  getLastRow() { return this.rows.length; }
  getDataRange() { return this.getRange(1,1,this.rows.length,Math.max(...this.rows.map(r=>r.length))); }
  getRange(r,c,n=1,m=1) {
    const self=this;
    return {
      getValues() { return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.rows[r-1+i]?.[c-1+j]??'')); },
      setValues(values) { if(self.failNextWrite) {self.failNextWrite=false;throw Error('write unavailable');} self.writes++; values.forEach((row,i)=>row.forEach((value,j)=>{self.rows[r-1+i]??=[];self.rows[r-1+i][c-1+j]=value;})); },
      setValue(value) {this.setValues([[value]]);}
    };
  }
  appendRow(row) { if(this.failAppend) throw Error('audit unavailable');this.writes++;this.rows.push([...row]); }
}
function setup() {
  const caja=new Sheet([headers.slice(),[1,new Date('2026-09-10T15:00:00Z'),'GASTO','Transporte','Taxi',25000], [2,new Date('2026-09-11T15:00:00Z'),'INGRESO','Ingresos Extra','Sobrantes',100000], [3,new Date('2026-09-12T15:00:00Z'),'GASTO','Reembolso','Reembolso OP',50000,'AN-1','OP-4','REEMBOLSO']]);
  const audit=new Sheet([auditHeaders.slice()]);
  const ss={getSheetByName:name=>({Caja:caja,Auditoria:audit})[name]||null};
  const state={authorized:true,pin:true,locked:false,flushCount:0,failFlush:0};
  const ctx=vm.createContext({ console, Date, Number, JSON, Object, Array, String, isNaN,
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,str)=>[...crypto.createHash('sha256').update(str).digest()],getUuid:()=>crypto.randomUUID()},
    validarPermisoSesionAuth9B_:()=>state.authorized?{response:null,validation:{usuario:{nombre:'Operador real'}}}:{response:{status:'error',code:'PERMISSION_DENIED'}},
    validarSesionCaja_:()=>({valido:state.pin,msg:'PIN vencido'}),
    LockService:{getScriptLock:()=>({waitLock(){assert.equal(state.locked,false);state.locked=true;},releaseLock(){state.locked=false;}})},
    SpreadsheetApp:{flush(){state.flushCount++;if(state.flushCount===state.failFlush)throw Error('flush unavailable');}},
    HOMEEASY_AUDIT_HEADERS:auditHeaders,calcularCambiosAuditoria_:(a,b)=>({antes:a.valor,despues:b.valor})
  });
  vm.runInContext(source,ctx);
  function payload(action='EDITAR',id=1) {const row=caja.rows.find((r,i)=>i&&String(r[0])===String(id));return {tipo:'movimiento_caja',accionCaja:action,id:String(id),requestId:crypto.randomUUID(),expectedRevision:ctx.cajaCorreccionRevision_(row),motivo:'Corregir digitación',movimiento:'GASTO',categoria:'Transporte',descripcion:'Taxi corregido',valor:15000,meta:{operador:'Nombre falso',dispositivoId:'device-1'},appSessionToken:'session',cajaSessionToken:'caja'};}
  const call=p=>ctx.corregirMovimientoCaja_(ss,p);
  const totals=()=>caja.rows.slice(1).reduce((total,row)=>total+(row[2]==='INGRESO'?Number(row[5]):row[2]==='GASTO'?-Number(row[5]):0),0);
  return {caja,audit,ss,state,ctx,payload,call,totals};
}
module.exports = { setup };
test('editar gasto conserva ID/fecha y recalcula contribución al saldo',()=>{const s=setup();const date=s.caja.rows[1][1];assert.equal(s.totals(),25000);const r=s.call(s.payload());assert.equal(r.status,'success');assert.equal(s.totals(),35000);assert.equal(s.caja.rows[1][0],1);assert.equal(s.caja.rows[1][1],date);assert.equal(s.audit.rows[1][13],'EXITOSO');assert.equal(s.audit.rows[1][2],'Operador real');assert.equal(JSON.parse(s.audit.rows[1][17]).valor,25000);assert.equal(JSON.parse(s.audit.rows[1][18]).valor,15000);assert.equal(s.state.locked,false);});
test('eliminar y restaurar son recuperables y no duplican filas',()=>{const s=setup();assert.equal(s.call(s.payload('ELIMINAR')).status,'success');assert.equal(s.caja.rows[1][2],'ELIMINADO_GASTO');assert.equal(s.totals(),50000);assert.equal(s.call(s.payload('RESTAURAR')).status,'success');assert.equal(s.totals(),25000);assert.equal(s.caja.rows.length,4);});
test('ingreso puede corregirse a gasto',()=>{const s=setup();const p=s.payload('EDITAR',2);p.valor=20000;assert.equal(s.call(p).status,'success');assert.equal(s.totals(),-95000);});
test('retry de misma solicitud no agrega auditoría ni altera saldo',()=>{const s=setup();const p=s.payload('ELIMINAR');assert.equal(s.call(p).status,'success');const writes=s.caja.writes;assert.equal(s.call(p).duplicate,true);assert.equal(s.caja.writes,writes);assert.equal(s.audit.rows.length,2);});
test('request reutilizado con otro contenido se rechaza',()=>{const s=setup();const p=s.payload();s.call(p);p.valor=99;assert.equal(s.call(p).code,'CAJA_REQUEST_REUSED');assert.equal(s.caja.rows[1][5],15000);});
test('edición concurrente y cambio directo del Sheet se detectan',()=>{const s=setup();const p=s.payload();s.caja.rows[1][5]=40000;assert.equal(s.call(p).code,'CAJA_CONFLICT');assert.equal(s.caja.writes,0);assert.equal(s.audit.writes,0);});
test('retry antiguo tras otro cambio no sobrescribe el estado actual',()=>{const s=setup();const p=s.payload();s.call(p);const q=s.payload();q.valor=9000;s.call(q);assert.equal(s.call(p).code,'CAJA_CONFLICT');assert.equal(s.caja.rows[1][5],9000);});
test('sesión sin caja.write no muta nada',()=>{const s=setup();s.state.authorized=false;assert.equal(s.call(s.payload()).code,'PERMISSION_DENIED');assert.equal(s.caja.writes,0);});
test('PIN vencido impide editar',()=>{const s=setup();s.state.pin=false;assert.equal(s.call(s.payload()).requiresPin,true);assert.equal(s.caja.writes,0);});
test('reembolsos y movimientos vinculados no son editables',()=>{const s=setup();assert.equal(s.call(s.payload('ELIMINAR',3)).code,'CAJA_DOCUMENT_LINKED');assert.equal(s.caja.writes,0);});
test('enriquecimiento excluye vinculados y conserva feed de OP/recibo',()=>{const s=setup();const feed=[{tipo:'IN_OP',id:'OP-4',valor:100},{tipo:'IN_AB',id:'REC-3',valor:50},{tipo:'OUT_GASTO',id:'GST-1',valor:25000}];const r=s.ctx.enriquecerCajaCorrecciones_(s.ss,{feed});assert.equal(r.movimientosManuales.length,2);assert.equal(r.feed[0].manual,undefined);assert.equal(r.feed[1].manual,undefined);assert.equal(r.feed[2].manual,true);assert.equal(s.caja.writes,0);});
test('IDs duplicados no muestran acciones ni aceptan correcciones',()=>{const s=setup();s.caja.rows.push(s.caja.rows[1].slice());assert.equal(s.call(s.payload()).code,'CAJA_NOT_FOUND');assert.equal(s.ctx.enriquecerCajaCorrecciones_(s.ss,{feed:[]}).movimientosManuales.length,1);});
for(const value of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test('rechaza importe inválido '+value,()=>{const s=setup();const p=s.payload();p.valor=value;assert.equal(s.call(p).code,'CAJA_INVALID_VALUE');assert.equal(s.caja.writes,0);});
test('textos fórmula y motivo vacío no se guardan',()=>{const s=setup();const p=s.payload();p.descripcion='=IMPORTXML("https://example.org")';assert.equal(s.call(p).code,'CAJA_INVALID_TEXT');p.descripcion='Taxi';p.motivo='';assert.equal(s.call(p).code,'CAJA_INVALID_REASON');});
test('esquema inesperado no sobrescribe columnas',()=>{const s=setup();s.caja.rows[0][10]='Campo existente';assert.equal(s.call(s.payload()).code,'CAJA_CORRECTION_FAILED');assert.equal(s.caja.writes,0);});
test('auditoría ausente impide modificación',()=>{const s=setup();s.audit.rows[0][0]='Otra columna';assert.equal(s.call(s.payload()).code,'CAJA_AUDIT_UNAVAILABLE');assert.equal(s.caja.rows[1][5],25000);});
test('fallo al registrar auditoría conserva gasto original',()=>{const s=setup();s.audit.failAppend=true;assert.equal(s.call(s.payload()).code,'CAJA_CORRECTION_FAILED');assert.equal(s.caja.rows[1][5],25000);assert.equal(s.state.locked,false);});
test('fallo posterior a escritura revierte valor y marca auditoría fallida',()=>{const s=setup();s.state.failFlush=1;assert.equal(s.call(s.payload()).code,'CAJA_CORRECTION_FAILED');assert.equal(s.caja.rows[1][5],25000);assert.equal(s.audit.rows[1][13],'FALLIDO');assert.equal(s.state.locked,false);});
test('movimiento eliminado sólo puede restaurarse',()=>{const s=setup();s.call(s.payload('ELIMINAR'));assert.equal(s.call(s.payload()).code,'CAJA_INVALID_STATE');assert.equal(s.call(s.payload('ELIMINAR')).code,'CAJA_INVALID_STATE');});
