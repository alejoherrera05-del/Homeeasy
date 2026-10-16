'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('abono.html', 'utf8');
const start = source.indexOf('    var abonoRegistroEnCurso = false;');
const end = source.indexOf('    async function ejecutarRegistroAbono() {', start);
assert(start !== -1 && end > start, 'No se encuentra el bloqueo de doble registro');
const guard = source.slice(start, end);

function entorno(impl) {
  const boton = { disabled: false };
  const dialogs = [];
  const ctx = {
    Swal: { fire: async opts => { dialogs.push(opts); return {isConfirmed:true}; } },
    document: { getElementById: id => id === 'btn-confirmar-abono' ? boton : null },
    ejecutarRegistroAbono: impl
  };
  vm.createContext(ctx);
  vm.runInContext(guard, ctx, {filename:'abono-guard.js'});
  return {ctx, boton, dialogs};
}

async function main() {
  let liberar;
  let ejecuciones = 0;
  const pending = new Promise(resolve => { liberar=resolve; });
  const caso1 = entorno(async()=>{ ejecuciones++; await pending; });
  const p1 = caso1.ctx.finalizarAbono();
  const p2 = caso1.ctx.finalizarAbono();
  assert.equal(ejecuciones,1,'Dos clics simultáneos no deben registrar dos pagos');
  assert.equal(caso1.boton.disabled,true,'Botón debe bloquearse durante la solicitud');
  liberar();
  await Promise.all([p1,p2]);
  assert.equal(caso1.boton.disabled,false,'El bloqueo debe liberar validaciones que no guardaron');

  const caso2 = entorno(async()=>{caso2.ctx.abonoRegistroEstado='registrado';});
  await caso2.ctx.finalizarAbono();
  await caso2.ctx.finalizarAbono();
  assert.equal(caso2.boton.disabled,true,'No se permite registrar otra vez desde el formulario confirmado');
  assert.match(caso2.dialogs[0].title,/registrado/);

  const caso3 = entorno(async()=>{caso3.ctx.abonoRegistroEstado='incierto';});
  await caso3.ctx.finalizarAbono();
  await caso3.ctx.finalizarAbono();
  assert.equal(caso3.boton.disabled,true,'Resultado incierto no permite otro envío');
  assert.match(caso3.dialogs[0].title,/verificar/);

  const caso4 = entorno(async()=>{throw new Error('fallo antes de POST');});
  await assert.rejects(caso4.ctx.finalizarAbono(),/fallo antes de POST/);
  assert.equal(caso4.boton.disabled,false,'Error previo a POST recupera botón');
  assert.equal(caso4.ctx.abonoRegistroEnCurso,false,'Error previo a POST libera el cerrojo');

  assert(source.includes('requestId: requestIdAbono,'),'POST debe llevar requestId explícito');
  assert(source.includes('abonoRegistroEstado = \'incierto\';'),'Debe marcar incertidumbre antes de POST');
  assert(source.includes('abonoRegistroEstado = \'registrado\';'),'Solo respuesta success confirma registro');
  console.log('PASS 4 escenarios de protección y 3 contratos de envío');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
