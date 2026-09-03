/*********************************************************
 * HOMEEASY — ETAPA 10A
 * MEMORIA COMERCIAL + TIMELINE DE SEGUIMIENTO INTELIGENTE
 *
 * Alcance:
 * - NO llama IA.
 * - NO envía WhatsApp.
 * - NO instala activadores.
 * - NO modifica las columnas existentes de Cotizaciones.
 * - Crea/usa Seguimiento_IA como snapshot de estado.
 * - Crea/usa Seguimiento_Eventos como timeline append-only.
 * - Todas las rutas 10A exigen sesión HomeEasy válida incluso si
 *   el enforcement general está temporalmente en PREPARACION.
 *********************************************************/

const HOMEEASY_FOLLOWUP_STAGE = "10A";
const HOMEEASY_FOLLOWUP_STATE_SHEET = "Seguimiento_IA";
const HOMEEASY_FOLLOWUP_EVENTS_SHEET = "Seguimiento_Eventos";
const HOMEEASY_FOLLOWUP_SCHEMA_VERSION = 1;
const HOMEEASY_FOLLOWUP_MAX_EVENTS_DETAIL = 120;
const HOMEEASY_FOLLOWUP_MAX_LIST = 250;

const HOMEEASY_FOLLOWUP_STATE_HEADERS = Object.freeze([
  "Cotizacion_Numero", "Cedula_Cliente", "Telefono", "Modo_Automatizacion",
  "Estado_Seguimiento", "Intencion", "Temperatura", "Resumen_Hommy",
  "Objeciones", "Fecha_Prometida_Cliente", "Proxima_Accion_Fecha",
  "Proxima_Accion_Tipo", "Ultimo_Saliente", "Ultimo_Entrante", "Ultimo_Humano",
  "Ultimo_Hommy", "Intentos_Seguimiento", "Motivo_Stop", "Plan_Version",
  "Updated_At", "Updated_By", "Estado_Version"
]);

const HOMEEASY_FOLLOWUP_EVENT_HEADERS = Object.freeze([
  "Evento_ID", "Cotizacion_Numero", "Cedula_Cliente", "Fecha_Hora", "Actor_Tipo",
  "Actor", "Tipo_Evento", "Canal", "Texto", "Message_ID", "Intencion",
  "Temperatura", "Proxima_Accion_Fecha", "Estado_Resultante", "Motivo",
  "Metadata_JSON", "Request_ID", "Estado_Version"
]);

const HOMEEASY_FOLLOWUP_STATE_COL = Object.freeze({
  COT: 0, CEDULA: 1, TELEFONO: 2, MODO: 3, ESTADO: 4, INTENCION: 5,
  TEMPERATURA: 6, RESUMEN: 7, OBJECIONES: 8, FECHA_PROMETIDA: 9,
  PROXIMA_FECHA: 10, PROXIMA_TIPO: 11, ULTIMO_SALIENTE: 12,
  ULTIMO_ENTRANTE: 13, ULTIMO_HUMANO: 14, ULTIMO_HOMMY: 15,
  INTENTOS: 16, MOTIVO_STOP: 17, PLAN_VERSION: 18, UPDATED_AT: 19,
  UPDATED_BY: 20, ESTADO_VERSION: 21
});

const HOMEEASY_FOLLOWUP_EVENT_COL = Object.freeze({
  ID: 0, COT: 1, CEDULA: 2, FECHA: 3, ACTOR_TIPO: 4, ACTOR: 5,
  TIPO: 6, CANAL: 7, TEXTO: 8, MESSAGE_ID: 9, INTENCION: 10,
  TEMPERATURA: 11, PROXIMA_FECHA: 12, ESTADO: 13, MOTIVO: 14,
  METADATA: 15, REQUEST_ID: 16, ESTADO_VERSION: 17
});

const HOMEEASY_FOLLOWUP_MODES = Object.freeze(["OFF", "REVIEW", "AUTO"]);
const HOMEEASY_FOLLOWUP_STATES = Object.freeze([
  "ACTIVE", "WAITING_CUSTOMER", "HUMAN_TAKEOVER", "PAUSED", "STOPPED", "CONVERTED", "ARCHIVED"
]);
const HOMEEASY_FOLLOWUP_INTENTS = Object.freeze([
  "NEW_QUOTE", "NO_RESPONSE", "EVALUATING", "NEEDS_DECISION_PARTNER",
  "PRICE_OBJECTION", "PRODUCT_QUESTION", "CHANGE_REQUESTED", "PAYMENT_QUESTION",
  "DELIVERY_QUESTION", "READY_TO_BUY", "WAITING_UNTIL_DATE", "NOT_INTERESTED",
  "DO_NOT_CONTACT", "HUMAN_REQUIRED"
]);
const HOMEEASY_FOLLOWUP_TEMPERATURES = Object.freeze(["HIGH", "ACTIVE", "WAITING", "RISK", "COLD"]);
const HOMEEASY_FOLLOWUP_ACTOR_TYPES = Object.freeze(["HOMMY", "HUMAN", "CLIENT", "SYSTEM"]);
const HOMEEASY_FOLLOWUP_CHANNELS = Object.freeze(["WHATSAPP", "APP", "SYSTEM"]);
const HOMEEASY_FOLLOWUP_EVENT_TYPES = Object.freeze([
  "QUOTE_CREATED", "FOLLOWUP_IMPORTED", "MANUAL_NOTE", "STATE_UPDATED",
  "AUTOMATION_MODE_CHANGED", "AI_ANALYSIS", "DRAFT_CREATED", "MESSAGE_APPROVED",
  "MESSAGE_EDITED", "MESSAGE_SENT", "MESSAGE_FAILED", "CLIENT_REPLY", "INTENT_CHANGED",
  "NEXT_ACTION_CHANGED", "PAUSED", "RESUMED", "HUMAN_TAKEOVER", "STOPPED",
  "CONVERTED", "ARCHIVED", "SKIPPED"
]);

function instalarEtapa10AHomeEasy() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
    const antes = snapshotFilasComercialesSeguimiento10A_(ss);
    const stateSheet = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_STATE_HEADERS, true);
    const eventSheet = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, true);
    aplicarValidacionesSeguimiento10A_(stateSheet, eventSheet);
    const migracion = inicializarCotizacionesActivasSeguimiento10A_(ss, { emitirEventos: true, actor: "INSTALACION_10A" });

    const props = PropertiesService.getScriptProperties();
    props.setProperty("HOMEEASY_FOLLOWUP_STAGE", HOMEEASY_FOLLOWUP_STAGE);
    props.setProperty("HOMEEASY_FOLLOWUP_SCHEMA_VERSION", String(HOMEEASY_FOLLOWUP_SCHEMA_VERSION));
    props.setProperty("HOMEEASY_FOLLOWUP_INSTALADO", "SI");
    props.setProperty("HOMEEASY_FOLLOWUP_INSTALADO_EN", new Date().toISOString());

    const despues = snapshotFilasComercialesSeguimiento10A_(ss);
    if (JSON.stringify(antes) !== JSON.stringify(despues)) {
      throw new Error("La instalación 10A detectó cambios en la cantidad de filas comerciales. Se detuvo para proteger HomeEasy.");
    }

    try {
      registrarAuditoria_(ss, {
        operador: "SISTEMA", dispositivoId: "SERVER", dispositivo: "Google Apps Script",
        plataforma: "Servidor", navegador: "—", pagina: "Apps Script", modulo: "Cotizaciones",
        accion: "INSTALAR SEGUIMIENTO INTELIGENTE", entidad: "SEGUIMIENTO_IA", entidadId: HOMEEASY_FOLLOWUP_STAGE,
        resumen: "Se instaló la memoria comercial y el timeline append-only de seguimiento inteligente.",
        estado: "EXITOSO", requestId: "INSTALACION_10A",
        datosJson: serializarObjetoAuditoria_({ estadosCreados: migracion.estadosCreados, eventosCreados: migracion.eventosCreados, cotizacionesActivas: migracion.cotizacionesActivas, autoActivado: false, whatsappEnviado: false, iaEjecutada: false }),
        versionApp: "4.0-10A", antesJson: "",
        despuesJson: serializarObjetoAuditoria_({ hojaEstado: HOMEEASY_FOLLOWUP_STATE_SHEET, hojaEventos: HOMEEASY_FOLLOWUP_EVENTS_SHEET, esquema: HOMEEASY_FOLLOWUP_SCHEMA_VERSION }),
        cambiosJson: "[]", error: "", reversible: "NO",
        motivoNoReversible: "La instalación solo crea memoria y timeline; no modifica documentos comerciales.",
        dependenciasJson: serializarObjetoAuditoria_({ hojas: ["Cotizaciones", "Clientes", HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_EVENTS_SHEET] }),
        revertida: "NO"
      });
    } catch (auditError) {
      console.error("10A instalada; no se pudo registrar la auditoría inicial: " + auditError);
    }

    return {
      status: "ok", etapa: HOMEEASY_FOLLOWUP_STAGE, esquema: HOMEEASY_FOLLOWUP_SCHEMA_VERSION,
      hojaEstado: stateSheet.getName(), columnasEstado: HOMEEASY_FOLLOWUP_STATE_HEADERS.length,
      hojaEventos: eventSheet.getName(), columnasEventos: HOMEEASY_FOLLOWUP_EVENT_HEADERS.length,
      cotizacionesActivas: migracion.cotizacionesActivas, estadosCreados: migracion.estadosCreados,
      eventosCreados: migracion.eventosCreados, modoInicial: "REVIEW", autoActivado: false,
      whatsappEnviado: false, iaEjecutada: false, hojasComercialesModificadas: 0
    };
  } finally {
    lock.releaseLock();
  }
}

function probarEtapa10AHomeEasy() {
  const ss = SpreadsheetApp.openById(HOMEEASY_SPREADSHEET_ID);
  const antes = snapshotFilasComercialesSeguimiento10A_(ss);
  const shState = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_STATE_HEADERS, false);
  const shEvents = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, false);
  validarHeadersSeguimiento10A_(shState, HOMEEASY_FOLLOWUP_STATE_HEADERS);
  validarHeadersSeguimiento10A_(shEvents, HOMEEASY_FOLLOWUP_EVENT_HEADERS);

  const rutasEsperadas = {
    GET_SEGUIMIENTO_INTELIGENTE: "cotizaciones.read",
    GET_SEGUIMIENTO_DETALLE: "cotizaciones.read",
    ACTUALIZAR_ESTADO_SEGUIMIENTO_IA: "cotizaciones.write",
    REGISTRAR_EVENTO_SEGUIMIENTO: "cotizaciones.write"
  };
  const faltantes = Object.keys(rutasEsperadas).filter(function(tipo) {
    return typeof resolverPermisoPostAuth9A_ !== "function" || resolverPermisoPostAuth9A_(tipo) !== rutasEsperadas[tipo];
  });
  if (normalizarEnumSeguimiento10A_("review", HOMEEASY_FOLLOWUP_MODES, "") !== "REVIEW") throw new Error("La normalización de modo falló.");
  if (normalizarEnumSeguimiento10A_("price_objection", HOMEEASY_FOLLOWUP_INTENTS, "") !== "PRICE_OBJECTION") throw new Error("La normalización de intención falló.");

  const muestra = obtenerSeguimientoInteligente10A_(ss, { limite: 3 });
  const despues = snapshotFilasComercialesSeguimiento10A_(ss);
  if (JSON.stringify(antes) !== JSON.stringify(despues)) throw new Error("La prueba 10A modificó filas comerciales, lo cual no está permitido.");
  if (faltantes.length) throw new Error("Faltan rutas 10A en HOMEEASY_AUTH_POST_PERMISSIONS: " + faltantes.join(", "));

  return {
    status: "ok", etapa: HOMEEASY_FOLLOWUP_STAGE, esquema: HOMEEASY_FOLLOWUP_SCHEMA_VERSION,
    headersEstado: "ok", headersEventos: "ok", rutasProtegidas: Object.keys(rutasEsperadas),
    muestraRadar: (muestra.cotizaciones || []).length, timelineAppendOnly: true,
    concurrenciaOptimista: true, requestIdIdempotente: true, autoActivado: false,
    whatsappEnviado: false, iaEjecutada: false, hojasComercialesModificadas: 0
  };
}

function procesarRutaSeguimiento10A_(ss, data) {
  const tipo = String(data && data.tipo || "");
  const permisos = {
    GET_SEGUIMIENTO_INTELIGENTE: "cotizaciones.read",
    GET_SEGUIMIENTO_DETALLE: "cotizaciones.read",
    ACTUALIZAR_ESTADO_SEGUIMIENTO_IA: "cotizaciones.write",
    REGISTRAR_EVENTO_SEGUIMIENTO: "cotizaciones.write"
  };
  if (!permisos[tipo]) return null;
  const auth = autorizarRutaSeguimiento10A_(ss, data, permisos[tipo]);
  if (!auth.ok) return auth.response;
  data.__auth9C = auth.validation;
  if (tipo === "GET_SEGUIMIENTO_INTELIGENTE") return obtenerSeguimientoInteligente10A_(ss, data);
  if (tipo === "GET_SEGUIMIENTO_DETALLE") return obtenerSeguimientoDetalle10A_(ss, data);
  if (tipo === "ACTUALIZAR_ESTADO_SEGUIMIENTO_IA") return actualizarEstadoSeguimientoIA10A_(ss, data);
  if (tipo === "REGISTRAR_EVENTO_SEGUIMIENTO") return registrarEventoSeguimientoRuta10A_(ss, data);
  return { status: "error", code: "FOLLOWUP_ROUTE_NOT_FOUND", msg: "La acción de seguimiento no existe." };
}

function autorizarRutaSeguimiento10A_(ss, data, permission) {
  if (typeof validarPermisoSesionAuth9B_ !== "function") {
    return { ok: false, response: { status: "error", code: "FOLLOWUP_AUTH_UNAVAILABLE", msg: "El núcleo de sesión HomeEasy no está disponible." } };
  }
  const token = String(data && data.appSessionToken || "").trim();
  const meta = data && data.meta && typeof data.meta === "object" ? data.meta : {};
  const check = validarPermisoSesionAuth9B_(ss, token, meta, permission);
  if (check.response) return { ok: false, response: check.response };
  return { ok: true, validation: check.validation };
}

function obtenerSeguimientoInteligente10A_(ss, data) {
  const shCot = ss.getSheetByName("Cotizaciones");
  const shCli = ss.getSheetByName("Clientes");
  if (!shCot || !shCli) return { status: "error", msg: "No se encontraron Cotizaciones o Clientes." };
  const cotRows = shCot.getDataRange().getValues();
  const cliRows = shCli.getDataRange().getValues();
  const telefonos = {};
  for (let i = 1; i < cliRows.length; i++) {
    const cedula = String(cliRows[i][0] || "").trim();
    if (cedula) telefonos[cedula] = String(cliRows[i][2] || "").trim();
  }
  const estados = mapaEstadosSeguimiento10A_(ss);
  const desde = parsearFechaSeguimiento10A_(data && data.desde);
  const hasta = parsearFechaSeguimiento10A_(data && data.hasta, true);
  const limite = Math.min(Math.max(Number(data && data.limite || HOMEEASY_FOLLOWUP_MAX_LIST), 1), HOMEEASY_FOLLOWUP_MAX_LIST);
  const lista = [];
  for (let i = 1; i < cotRows.length; i++) {
    const row = cotRows[i];
    const numero = String(row[0] || "").trim();
    if (!numero) continue;
    const estadoDocumento = String(row[9] || "COTIZACION").trim().toUpperCase();
    if (estadoDocumento !== "COTIZACION" && estadoDocumento !== "COTIZACIÓN") continue;
    const fecha = row[1] instanceof Date ? row[1] : new Date(row[1]);
    if (desde && !isNaN(fecha.getTime()) && fecha < desde) continue;
    if (hasta && !isNaN(fecha.getTime()) && fecha > hasta) continue;
    const cedula = String(row[2] || "").trim();
    const state = estados[numero] || estadoDefaultSeguimiento10A_({ numero: numero, cedula: cedula, telefono: telefonos[cedula] || "" });
    lista.push({
      numero: row[0], fecha: normalizarValorSeguimiento10A_(row[1]), cedula: row[2], nombre: row[3],
      descripcion: row[4] || "", total: Number(row[6] || 0), url: row[7] || "",
      estado: row[9] || "COTIZACION", notas_seguimiento: row[10] || "",
      telefono: telefonos[cedula] || state.telefono || "", seguimiento: state
    });
  }
  lista.sort(function(a, b) { return Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0); });
  return { status: "ok", etapa: HOMEEASY_FOLLOWUP_STAGE, modoPiloto: "REVIEW", cotizaciones: lista.slice(0, limite), total: lista.length };
}

function obtenerSeguimientoDetalle10A_(ss, data) {
  const numero = limpiarTexto_(data && data.numero || "", 80);
  if (!numero) return { status: "error", code: "FOLLOWUP_QUOTE_REQUIRED", msg: "Falta el número de cotización." };
  const cot = obtenerCotizacionSnapshot_(ss, numero);
  if (!cot || !cot.existe) return { status: "not_found", msg: "No se encontró la cotización COT-" + numero + "." };
  const cliente = obtenerClienteSeguimiento10A_(ss, cot.cedula);
  const stateRow = buscarEstadoSeguimiento10A_(ss, numero);
  const state = stateRow ? mapearEstadoSeguimiento10A_(stateRow.row, stateRow.fila) : estadoDefaultSeguimiento10A_({ numero: numero, cedula: cot.cedula, telefono: cliente.telefono || "" });
  const limit = Math.min(Math.max(Number(data && data.limiteEventos || HOMEEASY_FOLLOWUP_MAX_EVENTS_DETAIL), 1), HOMEEASY_FOLLOWUP_MAX_EVENTS_DETAIL);
  const timeline = leerEventosSeguimiento10A_(ss, numero, limit);
  return {
    status: "ok", etapa: HOMEEASY_FOLLOWUP_STAGE,
    cotizacion: { numero: cot.numero, fecha: cot.fecha, cedula: cot.cedula, nombre: cot.nombre, descripcion: cot.descripcion, observaciones: cot.observaciones, total: cot.total, pdfUrl: cot.pdfUrl, estado: cot.estado, items: cot.items || [], notaManual: cot.notasSeguimiento || "" },
    cliente: cliente, seguimiento: state, timeline: timeline, timelineTotal: contarEventosSeguimiento10A_(ss, numero)
  };
}

function actualizarEstadoSeguimientoIA10A_(ss, data) {
  const numero = limpiarTexto_(data && data.numero || "", 80);
  if (!numero) return { status: "error", code: "FOLLOWUP_QUOTE_REQUIRED", msg: "Falta el número de cotización." };
  const cot = obtenerCotizacionSnapshot_(ss, numero);
  if (!cot || !cot.existe) return { status: "not_found", msg: "No se encontró la cotización COT-" + numero + "." };
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    lock.waitLock(20000); locked = true;
    const cliente = obtenerClienteSeguimiento10A_(ss, cot.cedula);
    const found = buscarEstadoSeguimiento10A_(ss, numero);
    const before = found ? mapearEstadoSeguimiento10A_(found.row, found.fila) : estadoDefaultSeguimiento10A_({ numero: numero, cedula: cot.cedula, telefono: cliente.telefono || "" });
    const currentVersion = Number(before.estadoVersion || 0);
    if (data.expectedVersion !== undefined && data.expectedVersion !== null && data.expectedVersion !== "") {
      const expected = Number(data.expectedVersion);
      if (!isFinite(expected) || expected !== currentVersion) {
        return { status: "error", code: "FOLLOWUP_STATE_CHANGED", msg: "El seguimiento cambió después de abrirlo. Actualiza la información antes de guardar.", expectedVersion: expected, currentVersion: currentVersion, seguimiento: before };
      }
    }
    const actor = obtenerActorSesionSeguimiento10A_(data);
    const now = new Date();
    const next = Object.assign({}, before);
    if (data.modo !== undefined) next.modo = normalizarEnumSeguimiento10A_(data.modo, HOMEEASY_FOLLOWUP_MODES, before.modo);
    if (data.estado !== undefined) next.estado = normalizarEnumSeguimiento10A_(data.estado, HOMEEASY_FOLLOWUP_STATES, before.estado);
    if (data.intencion !== undefined) next.intencion = normalizarEnumSeguimiento10A_(data.intencion, HOMEEASY_FOLLOWUP_INTENTS, before.intencion);
    if (data.temperatura !== undefined) next.temperatura = normalizarEnumSeguimiento10A_(data.temperatura, HOMEEASY_FOLLOWUP_TEMPERATURES, before.temperatura);
    if (data.resumen !== undefined) next.resumen = limpiarTexto_(data.resumen, 1800);
    if (data.objeciones !== undefined) next.objeciones = normalizarObjecionesSeguimiento10A_(data.objeciones);
    if (data.fechaPrometida !== undefined) next.fechaPrometida = parsearFechaValorSeguimiento10A_(data.fechaPrometida);
    if (data.proximaAccionFecha !== undefined) next.proximaAccionFecha = parsearFechaValorSeguimiento10A_(data.proximaAccionFecha);
    if (data.proximaAccionTipo !== undefined) next.proximaAccionTipo = limpiarTexto_(data.proximaAccionTipo, 80).toUpperCase();
    if (data.ultimoSaliente !== undefined) next.ultimoSaliente = parsearFechaValorSeguimiento10A_(data.ultimoSaliente);
    if (data.ultimoEntrante !== undefined) next.ultimoEntrante = parsearFechaValorSeguimiento10A_(data.ultimoEntrante);
    if (data.intentosSeguimiento !== undefined) next.intentosSeguimiento = Math.max(0, Number(data.intentosSeguimiento || 0));
    if (data.motivoStop !== undefined) next.motivoStop = limpiarTexto_(data.motivoStop, 600);
    if (data.planVersion !== undefined) next.planVersion = Math.max(0, Number(data.planVersion || 0));
    next.numero = numero; next.cedula = String(cot.cedula || "");
    next.telefono = limpiarTexto_(data.telefono !== undefined ? data.telefono : (before.telefono || cliente.telefono || ""), 32);
    next.ultimoHumano = now.toISOString(); next.updatedAt = now.toISOString(); next.updatedBy = actor.label; next.estadoVersion = currentVersion + 1;
    if (next.estado === "STOPPED" && !next.motivoStop) next.motivoStop = "Detenido manualmente.";
    if (next.estado === "CONVERTED" && !next.motivoStop) next.motivoStop = "Cotización convertida en orden.";
    if (next.estado === "ARCHIVED" && !next.motivoStop) next.motivoStop = "Cotización archivada.";

    const saved = guardarEstadoSeguimiento10A_(ss, found, next);
    const eventType = resolverTipoEventoCambioEstado10A_(before, saved, data);
    const requestId = limpiarTexto_(data.requestId || Utilities.getUuid(), 180);
    const event = registrarEventoSeguimiento10AInterno_(ss, {
      numero: numero, cedula: cot.cedula, fecha: now, actorType: "HUMAN", actor: actor.label,
      eventType: eventType, channel: "APP", text: limpiarTexto_(data.eventText || describirCambioEstadoSeguimiento10A_(before, saved), 3500),
      messageId: "", intencion: saved.intencion, temperatura: saved.temperatura,
      proximaAccionFecha: saved.proximaAccionFecha, estado: saved.estado,
      motivo: limpiarTexto_(data.motivo || saved.motivoStop || "", 700),
      metadata: { beforeVersion: currentVersion, afterVersion: saved.estadoVersion }, requestId: requestId,
      estadoVersion: saved.estadoVersion
    });
    auditarSeguimiento10A_(ss, data, { accion: "ACTUALIZAR ESTADO", numero: numero, resumen: "Se actualizó la memoria comercial de la cotización COT-" + numero + ".", before: before, after: saved, requestId: requestId });
    return { status: "success", etapa: HOMEEASY_FOLLOWUP_STAGE, seguimiento: saved, evento: event, expectedVersion: saved.estadoVersion };
  } catch (error) {
    return { status: "error", code: "FOLLOWUP_UPDATE_FAILED", msg: error && error.message ? error.message : String(error) };
  } finally {
    if (locked) try { lock.releaseLock(); } catch (e) {}
  }
}

function registrarEventoSeguimientoRuta10A_(ss, data) {
  const numero = limpiarTexto_(data && data.numero || "", 80);
  if (!numero) return { status: "error", code: "FOLLOWUP_QUOTE_REQUIRED", msg: "Falta el número de cotización." };
  const cot = obtenerCotizacionSnapshot_(ss, numero);
  if (!cot || !cot.existe) return { status: "not_found", msg: "No se encontró la cotización COT-" + numero + "." };
  const requestId = limpiarTexto_(data.requestId || "", 180);
  if (!requestId) return { status: "error", code: "FOLLOWUP_REQUEST_ID_REQUIRED", msg: "Falta Request_ID para registrar el evento de forma segura." };
  const existing = buscarEventoPorRequestIdSeguimiento10A_(ss, requestId);
  if (existing) return { status: "success", idempotente: true, evento: existing };
  const actor = obtenerActorSesionSeguimiento10A_(data);
  const stateFound = buscarEstadoSeguimiento10A_(ss, numero);
  const state = stateFound ? mapearEstadoSeguimiento10A_(stateFound.row, stateFound.fila) : null;
  const type = normalizarEnumSeguimiento10A_(data.eventType, HOMEEASY_FOLLOWUP_EVENT_TYPES, "");
  if (!type) return { status: "error", code: "FOLLOWUP_EVENT_TYPE_INVALID", msg: "El tipo de evento no es válido." };
  const event = registrarEventoSeguimiento10AInterno_(ss, {
    numero: numero, cedula: cot.cedula, fecha: new Date(), actorType: "HUMAN", actor: actor.label,
    eventType: type, channel: normalizarEnumSeguimiento10A_(data.channel || "APP", HOMEEASY_FOLLOWUP_CHANNELS, "APP"),
    text: limpiarTexto_(data.text || "", 4000), messageId: limpiarTexto_(data.messageId || "", 240),
    intencion: state ? state.intencion : "", temperatura: state ? state.temperatura : "",
    proximaAccionFecha: state ? state.proximaAccionFecha : "", estado: state ? state.estado : "",
    motivo: limpiarTexto_(data.motivo || "", 700), metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
    requestId: requestId, estadoVersion: state ? state.estadoVersion : 0
  });
  auditarSeguimiento10A_(ss, data, { accion: "REGISTRAR EVENTO", numero: numero, resumen: "Se registró " + type + " en el seguimiento de COT-" + numero + ".", before: null, after: event, requestId: requestId });
  return { status: "success", etapa: HOMEEASY_FOLLOWUP_STAGE, evento: event };
}

function sincronizarSeguimientoLegacy10A_(ss, data) {
  try {
    if (!ss.getSheetByName(HOMEEASY_FOLLOWUP_STATE_SHEET) || !ss.getSheetByName(HOMEEASY_FOLLOWUP_EVENTS_SHEET)) return;
    const numero = limpiarTexto_(data && data.numero || "", 80);
    if (!numero) return;
    const cot = obtenerCotizacionSnapshot_(ss, numero);
    if (!cot || !cot.existe) return;
    const requestBase = limpiarTexto_(data.requestId || Utilities.getUuid(), 160);
    const actor = obtenerActorSesionSeguimiento10A_(data).label;
    if (data.notasSeguimiento !== undefined) {
      const state = obtenerOInicializarEstadoSeguimiento10A_(ss, cot, actor, false);
      registrarEventoSeguimiento10AInterno_(ss, {
        numero: numero, cedula: cot.cedula, fecha: new Date(), actorType: "HUMAN", actor: actor,
        eventType: "MANUAL_NOTE", channel: "APP", text: limpiarTexto_(data.notasSeguimiento || "", 4000),
        messageId: "", intencion: state.intencion, temperatura: state.temperatura,
        proximaAccionFecha: state.proximaAccionFecha, estado: state.estado, motivo: "",
        metadata: { source: "actualizar_seguimiento" }, requestId: requestBase + ":NOTE", estadoVersion: state.estadoVersion
      });
    }
    const nuevoEstado = String(data.nuevoEstado || "").trim().toUpperCase();
    if (nuevoEstado === "ARCHIVADA") {
      cerrarSeguimientoCotizacion10A_(ss, numero, "ARCHIVED", { actor: actor, requestId: requestBase + ":ARCHIVE", motivo: "Cotización archivada desde Seguimiento." });
    }
  } catch (error) {
    console.error("Seguimiento 10A no pudo sincronizar la ruta legacy: " + error);
  }
}

function inicializarCotizacionSeguimiento10A_(ss, info) {
  try {
    if (!ss.getSheetByName(HOMEEASY_FOLLOWUP_STATE_SHEET) || !ss.getSheetByName(HOMEEASY_FOLLOWUP_EVENTS_SHEET)) return null;
    const numero = String(info && info.numero || "").trim();
    if (!numero) return null;
    const cot = obtenerCotizacionSnapshot_(ss, numero);
    if (!cot || !cot.existe) return null;
    return obtenerOInicializarEstadoSeguimiento10A_(ss, cot, info && info.actor || "SISTEMA", true, info && info.requestId);
  } catch (error) {
    console.error("No se pudo inicializar seguimiento 10A para la nueva cotización: " + error);
    return null;
  }
}

function cerrarSeguimientoCotizacion10A_(ss, numero, finalState, options) {
  const cot = obtenerCotizacionSnapshot_(ss, numero);
  if (!cot || !cot.existe) return null;
  const opts = options || {};
  const found = buscarEstadoSeguimiento10A_(ss, numero);
  const before = found ? mapearEstadoSeguimiento10A_(found.row, found.fila) : obtenerOInicializarEstadoSeguimiento10A_(ss, cot, opts.actor || "SISTEMA", false);
  const stateName = normalizarEnumSeguimiento10A_(finalState, HOMEEASY_FOLLOWUP_STATES, "STOPPED");
  const next = Object.assign({}, before, {
    estado: stateName,
    motivoStop: limpiarTexto_(opts.motivo || (stateName === "CONVERTED" ? "Cotización convertida en orden." : "Seguimiento cerrado."), 600),
    proximaAccionFecha: "", proximaAccionTipo: "", updatedAt: new Date().toISOString(),
    updatedBy: limpiarTexto_(opts.actor || "SISTEMA", 160), estadoVersion: Number(before.estadoVersion || 0) + 1
  });
  const saved = guardarEstadoSeguimiento10A_(ss, buscarEstadoSeguimiento10A_(ss, numero), next);
  const eventType = stateName === "CONVERTED" ? "CONVERTED" : (stateName === "ARCHIVED" ? "ARCHIVED" : "STOPPED");
  registrarEventoSeguimiento10AInterno_(ss, {
    numero: numero, cedula: cot.cedula, fecha: new Date(), actorType: "SYSTEM", actor: opts.actor || "SISTEMA",
    eventType: eventType, channel: "SYSTEM", text: next.motivoStop, messageId: "",
    intencion: saved.intencion, temperatura: saved.temperatura, proximaAccionFecha: "", estado: saved.estado,
    motivo: next.motivoStop, metadata: { source: "document_state" },
    requestId: limpiarTexto_(opts.requestId || Utilities.getUuid(), 180), estadoVersion: saved.estadoVersion
  });
  return saved;
}

function obtenerOInicializarEstadoSeguimiento10A_(ss, cot, actor, emitirEvento, requestId) {
  const found = buscarEstadoSeguimiento10A_(ss, cot.numero);
  if (found) return mapearEstadoSeguimiento10A_(found.row, found.fila);
  const cliente = obtenerClienteSeguimiento10A_(ss, cot.cedula);
  const now = new Date();
  const state = estadoDefaultSeguimiento10A_({ numero: cot.numero, cedula: cot.cedula, telefono: cliente.telefono || "" });
  state.updatedAt = now.toISOString(); state.updatedBy = limpiarTexto_(actor || "SISTEMA", 160); state.estadoVersion = 1;
  const saved = guardarEstadoSeguimiento10A_(ss, null, state);
  if (emitirEvento) {
    registrarEventoSeguimiento10AInterno_(ss, {
      numero: cot.numero, cedula: cot.cedula, fecha: cot.fecha || now, actorType: "SYSTEM", actor: actor || "SISTEMA",
      eventType: "QUOTE_CREATED", channel: "SYSTEM", text: "Cotización COT-" + cot.numero + " creada.", messageId: "",
      intencion: saved.intencion, temperatura: saved.temperatura, proximaAccionFecha: "", estado: saved.estado, motivo: "",
      metadata: { source: "homeeasy", importedBy10A: true }, requestId: limpiarTexto_(requestId || ("10A:QUOTE_CREATED:" + cot.numero), 180), estadoVersion: saved.estadoVersion
    });
  }
  return saved;
}

function inicializarCotizacionesActivasSeguimiento10A_(ss, options) {
  const opts = options || {};
  const shCot = ss.getSheetByName("Cotizaciones");
  if (!shCot || shCot.getLastRow() < 2) return { cotizacionesActivas: 0, estadosCreados: 0, eventosCreados: 0 };
  const rows = shCot.getDataRange().getValues();
  let activas = 0, estadosCreados = 0, eventosCreados = 0;
  for (let i = 1; i < rows.length; i++) {
    const numero = String(rows[i][0] || "").trim();
    const estadoDoc = String(rows[i][9] || "COTIZACION").trim().toUpperCase();
    if (!numero || (estadoDoc !== "COTIZACION" && estadoDoc !== "COTIZACIÓN")) continue;
    activas++;
    if (buscarEstadoSeguimiento10A_(ss, numero)) continue;
    const cot = obtenerCotizacionSnapshot_(ss, numero);
    if (!cot || !cot.existe) continue;
    obtenerOInicializarEstadoSeguimiento10A_(ss, cot, opts.actor || "SISTEMA", Boolean(opts.emitirEventos), "10A:MIGRATION:COT:" + numero);
    estadosCreados++;
    if (opts.emitirEventos) eventosCreados++;
  }
  return { cotizacionesActivas: activas, estadosCreados: estadosCreados, eventosCreados: eventosCreados };
}

function buscarEstadoSeguimiento10A_(ss, numero) {
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_STATE_HEADERS, false);
  if (sh.getLastRow() < 2) return null;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_FOLLOWUP_STATE_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][HOMEEASY_FOLLOWUP_STATE_COL.COT] || "").trim() === String(numero || "").trim()) return { fila: i + 2, row: values[i] };
  }
  return null;
}

function mapaEstadosSeguimiento10A_(ss) {
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_STATE_HEADERS, false);
  const out = {};
  if (sh.getLastRow() < 2) return out;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_FOLLOWUP_STATE_HEADERS.length).getValues();
  rows.forEach(function(row, index) {
    const numero = String(row[HOMEEASY_FOLLOWUP_STATE_COL.COT] || "").trim();
    if (numero) out[numero] = mapearEstadoSeguimiento10A_(row, index + 2);
  });
  return out;
}

function guardarEstadoSeguimiento10A_(ss, found, state) {
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_STATE_SHEET, HOMEEASY_FOLLOWUP_STATE_HEADERS, false);
  const row = estadoAArraySeguimiento10A_(state);
  let fila;
  if (found && found.fila) { fila = found.fila; sh.getRange(fila, 1, 1, row.length).setValues([row]); }
  else { sh.appendRow(row); fila = sh.getLastRow(); }
  return mapearEstadoSeguimiento10A_(row, fila);
}

function estadoAArraySeguimiento10A_(state) {
  return [
    state.numero || "", state.cedula || "", state.telefono || "",
    normalizarEnumSeguimiento10A_(state.modo, HOMEEASY_FOLLOWUP_MODES, "REVIEW"),
    normalizarEnumSeguimiento10A_(state.estado, HOMEEASY_FOLLOWUP_STATES, "ACTIVE"),
    normalizarEnumSeguimiento10A_(state.intencion, HOMEEASY_FOLLOWUP_INTENTS, "NEW_QUOTE"),
    normalizarEnumSeguimiento10A_(state.temperatura, HOMEEASY_FOLLOWUP_TEMPERATURES, "ACTIVE"),
    limpiarTexto_(state.resumen || "", 1800), serializarObjecionesSeguimiento10A_(state.objeciones),
    fechaParaHojaSeguimiento10A_(state.fechaPrometida), fechaParaHojaSeguimiento10A_(state.proximaAccionFecha),
    limpiarTexto_(state.proximaAccionTipo || "", 80), fechaParaHojaSeguimiento10A_(state.ultimoSaliente),
    fechaParaHojaSeguimiento10A_(state.ultimoEntrante), fechaParaHojaSeguimiento10A_(state.ultimoHumano),
    fechaParaHojaSeguimiento10A_(state.ultimoHommy), Math.max(0, Number(state.intentosSeguimiento || 0)),
    limpiarTexto_(state.motivoStop || "", 600), Math.max(0, Number(state.planVersion || 0)),
    fechaParaHojaSeguimiento10A_(state.updatedAt || new Date()), limpiarTexto_(state.updatedBy || "SISTEMA", 160),
    Math.max(0, Number(state.estadoVersion || 0))
  ];
}

function mapearEstadoSeguimiento10A_(row, fila) {
  return {
    fila: fila || 0, numero: row[0], cedula: row[1], telefono: String(row[2] || ""), modo: String(row[3] || "REVIEW"),
    estado: String(row[4] || "ACTIVE"), intencion: String(row[5] || "NEW_QUOTE"), temperatura: String(row[6] || "ACTIVE"),
    resumen: String(row[7] || ""), objeciones: parsearObjecionesSeguimiento10A_(row[8]), fechaPrometida: normalizarValorSeguimiento10A_(row[9]),
    proximaAccionFecha: normalizarValorSeguimiento10A_(row[10]), proximaAccionTipo: String(row[11] || ""),
    ultimoSaliente: normalizarValorSeguimiento10A_(row[12]), ultimoEntrante: normalizarValorSeguimiento10A_(row[13]),
    ultimoHumano: normalizarValorSeguimiento10A_(row[14]), ultimoHommy: normalizarValorSeguimiento10A_(row[15]),
    intentosSeguimiento: Number(row[16] || 0), motivoStop: String(row[17] || ""), planVersion: Number(row[18] || 0),
    updatedAt: normalizarValorSeguimiento10A_(row[19]), updatedBy: String(row[20] || ""), estadoVersion: Number(row[21] || 0)
  };
}

function estadoDefaultSeguimiento10A_(info) {
  const data = info || {};
  return { fila: 0, numero: data.numero || "", cedula: data.cedula || "", telefono: data.telefono || "", modo: "REVIEW", estado: "ACTIVE", intencion: "NEW_QUOTE", temperatura: "ACTIVE", resumen: "", objeciones: [], fechaPrometida: "", proximaAccionFecha: "", proximaAccionTipo: "", ultimoSaliente: "", ultimoEntrante: "", ultimoHumano: "", ultimoHommy: "", intentosSeguimiento: 0, motivoStop: "", planVersion: 0, updatedAt: "", updatedBy: "", estadoVersion: 0 };
}

function registrarEventoSeguimiento10AInterno_(ss, info) {
  const requestId = limpiarTexto_(info && info.requestId || "", 180);
  if (requestId) { const existing = buscarEventoPorRequestIdSeguimiento10A_(ss, requestId); if (existing) return existing; }
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, false);
  const fecha = parsearFechaValorSeguimiento10A_(info && info.fecha) || new Date();
  const eventType = normalizarEnumSeguimiento10A_(info && info.eventType, HOMEEASY_FOLLOWUP_EVENT_TYPES, "STATE_UPDATED");
  const actorType = normalizarEnumSeguimiento10A_(info && info.actorType, HOMEEASY_FOLLOWUP_ACTOR_TYPES, "SYSTEM");
  const channel = normalizarEnumSeguimiento10A_(info && info.channel, HOMEEASY_FOLLOWUP_CHANNELS, "SYSTEM");
  const id = generarIdEventoSeguimiento10A_(fecha);
  const metadata = info && info.metadata && typeof info.metadata === "object" ? info.metadata : {};
  const row = [
    id, info && info.numero || "", info && info.cedula || "", fechaParaHojaSeguimiento10A_(fecha), actorType,
    limpiarTexto_(info && info.actor || "SISTEMA", 160), eventType, channel, limpiarTexto_(info && info.text || "", 4000),
    limpiarTexto_(info && info.messageId || "", 240), normalizarEnumSeguimiento10A_(info && info.intencion, HOMEEASY_FOLLOWUP_INTENTS, ""),
    normalizarEnumSeguimiento10A_(info && info.temperatura, HOMEEASY_FOLLOWUP_TEMPERATURES, ""),
    fechaParaHojaSeguimiento10A_(info && info.proximaAccionFecha), normalizarEnumSeguimiento10A_(info && info.estado, HOMEEASY_FOLLOWUP_STATES, ""),
    limpiarTexto_(info && info.motivo || "", 700), serializarMetadataSeguimiento10A_(metadata), requestId,
    Math.max(0, Number(info && info.estadoVersion || 0))
  ];
  sh.appendRow(row);
  return mapearEventoSeguimiento10A_(row, sh.getLastRow());
}

function buscarEventoPorRequestIdSeguimiento10A_(ss, requestId) {
  const id = String(requestId || "").trim();
  if (!id) return null;
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, false);
  if (sh.getLastRow() < 2) return null;
  const values = sh.getRange(2, HOMEEASY_FOLLOWUP_EVENT_COL.REQUEST_ID + 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || "").trim() !== id) continue;
    const row = sh.getRange(i + 2, 1, 1, HOMEEASY_FOLLOWUP_EVENT_HEADERS.length).getValues()[0];
    return mapearEventoSeguimiento10A_(row, i + 2);
  }
  return null;
}

function leerEventosSeguimiento10A_(ss, numero, limit) {
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, false);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HOMEEASY_FOLLOWUP_EVENT_HEADERS.length).getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1] || "").trim() !== String(numero || "").trim()) continue;
    out.push(mapearEventoSeguimiento10A_(rows[i], i + 2));
    if (out.length >= limit) break;
  }
  return out;
}

function contarEventosSeguimiento10A_(ss, numero) {
  const sh = asegurarHojaSeguimiento10A_(ss, HOMEEASY_FOLLOWUP_EVENTS_SHEET, HOMEEASY_FOLLOWUP_EVENT_HEADERS, false);
  if (sh.getLastRow() < 2) return 0;
  const values = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  return values.reduce(function(total, row) { return total + (String(row[0] || "").trim() === String(numero || "").trim() ? 1 : 0); }, 0);
}

function mapearEventoSeguimiento10A_(row, fila) {
  return {
    fila: fila || 0, id: String(row[0] || ""), numero: row[1], cedula: row[2], fecha: normalizarValorSeguimiento10A_(row[3]),
    actorType: String(row[4] || ""), actor: String(row[5] || ""), eventType: String(row[6] || ""), channel: String(row[7] || ""),
    text: String(row[8] || ""), messageId: String(row[9] || ""), intencion: String(row[10] || ""), temperatura: String(row[11] || ""),
    proximaAccionFecha: normalizarValorSeguimiento10A_(row[12]), estado: String(row[13] || ""), motivo: String(row[14] || ""),
    metadata: parsearJsonSeguroSeguimiento10A_(row[15], {}), requestId: String(row[16] || ""), estadoVersion: Number(row[17] || 0)
  };
}

function asegurarHojaSeguimiento10A_(ss, name, headers, aplicarFormato) {
  let sh = ss.getSheetByName(name), created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const minRows = name === HOMEEASY_FOLLOWUP_EVENTS_SHEET ? 3000 : 1000;
  if (sh.getMaxRows() < minRows) sh.insertRowsAfter(sh.getMaxRows(), minRows - sh.getMaxRows());
  const existing = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const empty = existing.every(function(value) { return String(value || "").trim() === ""; });
  if (!empty) {
    for (let i = 0; i < headers.length; i++) {
      const value = String(existing[i] || "").trim();
      if (value && value !== headers[i]) throw new Error("La hoja " + name + " tiene un encabezado incompatible en la columna " + (i + 1) + ": " + value);
    }
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (aplicarFormato || created) {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setBackground("#b2566c").setFontColor("#ffffff").setFontWeight("bold");
    sh.autoResizeColumns(1, headers.length);
    sh.setColumnWidth(name === HOMEEASY_FOLLOWUP_STATE_SHEET ? 8 : 9, 360);
    if (name === HOMEEASY_FOLLOWUP_EVENTS_SHEET) sh.setColumnWidth(16, 360);
  }
  return sh;
}

function validarHeadersSeguimiento10A_(sh, headers) {
  const actual = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const ok = headers.every(function(header, index) { return String(actual[index] || "") === header; });
  if (!ok) throw new Error("Los encabezados de " + sh.getName() + " no coinciden con el esquema 10A.");
  return true;
}

function aplicarValidacionesSeguimiento10A_(stateSheet, eventSheet) {
  const modeRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_MODES.slice(), true).setAllowInvalid(false).build();
  const stateRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_STATES.slice(), true).setAllowInvalid(false).build();
  const intentRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_INTENTS.slice(), true).setAllowInvalid(false).build();
  const tempRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_TEMPERATURES.slice(), true).setAllowInvalid(false).build();
  const actorRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_ACTOR_TYPES.slice(), true).setAllowInvalid(false).build();
  const eventRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_EVENT_TYPES.slice(), true).setAllowInvalid(false).build();
  const channelRule = SpreadsheetApp.newDataValidation().requireValueInList(HOMEEASY_FOLLOWUP_CHANNELS.slice(), true).setAllowInvalid(false).build();
  stateSheet.getRange(2, 4, stateSheet.getMaxRows() - 1, 1).setDataValidation(modeRule);
  stateSheet.getRange(2, 5, stateSheet.getMaxRows() - 1, 1).setDataValidation(stateRule);
  stateSheet.getRange(2, 6, stateSheet.getMaxRows() - 1, 1).setDataValidation(intentRule);
  stateSheet.getRange(2, 7, stateSheet.getMaxRows() - 1, 1).setDataValidation(tempRule);
  eventSheet.getRange(2, 5, eventSheet.getMaxRows() - 1, 1).setDataValidation(actorRule);
  eventSheet.getRange(2, 7, eventSheet.getMaxRows() - 1, 1).setDataValidation(eventRule);
  eventSheet.getRange(2, 8, eventSheet.getMaxRows() - 1, 1).setDataValidation(channelRule);
  eventSheet.getRange(2, 11, eventSheet.getMaxRows() - 1, 1).setDataValidation(intentRule);
  eventSheet.getRange(2, 12, eventSheet.getMaxRows() - 1, 1).setDataValidation(tempRule);
  eventSheet.getRange(2, 14, eventSheet.getMaxRows() - 1, 1).setDataValidation(stateRule);
  stateSheet.getRange(2, 10, stateSheet.getMaxRows() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm");
  stateSheet.getRange(2, 11, stateSheet.getMaxRows() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm");
  stateSheet.getRange(2, 20, stateSheet.getMaxRows() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  eventSheet.getRange(2, 4, eventSheet.getMaxRows() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
}

function obtenerClienteSeguimiento10A_(ss, cedula) {
  const sh = ss.getSheetByName("Clientes");
  if (!sh || sh.getLastRow() < 2) return { cedula: cedula || "", nombre: "", telefono: "", email: "", direccion: "" };
  const rows = sh.getDataRange().getValues(), id = String(cedula || "").trim();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() !== id) continue;
    return { cedula: rows[i][0], nombre: rows[i][1] || "", telefono: String(rows[i][2] || ""), email: rows[i][3] || "", direccion: rows[i][4] || "" };
  }
  return { cedula: cedula || "", nombre: "", telefono: "", email: "", direccion: "" };
}

function obtenerActorSesionSeguimiento10A_(data) {
  const validation = data && data.__auth9C, user = validation && validation.usuario || {}, meta = data && data.meta || {};
  return { uid: String(user.uid || ""), label: limpiarTexto_(user.nombre || user.email || meta.operador || "Usuario HomeEasy", 160), email: String(user.email || "") };
}

function resolverTipoEventoCambioEstado10A_(before, after, data) {
  const explicit = normalizarEnumSeguimiento10A_(data && data.eventType, HOMEEASY_FOLLOWUP_EVENT_TYPES, "");
  if (explicit) return explicit;
  if (before.modo !== after.modo) return "AUTOMATION_MODE_CHANGED";
  if (after.estado === "PAUSED" && before.estado !== "PAUSED") return "PAUSED";
  if (before.estado === "PAUSED" && after.estado === "ACTIVE") return "RESUMED";
  if (after.estado === "HUMAN_TAKEOVER" && before.estado !== "HUMAN_TAKEOVER") return "HUMAN_TAKEOVER";
  if (after.estado === "STOPPED" && before.estado !== "STOPPED") return "STOPPED";
  if (after.estado === "CONVERTED" && before.estado !== "CONVERTED") return "CONVERTED";
  if (after.estado === "ARCHIVED" && before.estado !== "ARCHIVED") return "ARCHIVED";
  if (before.intencion !== after.intencion) return "INTENT_CHANGED";
  if (before.proximaAccionFecha !== after.proximaAccionFecha || before.proximaAccionTipo !== after.proximaAccionTipo) return "NEXT_ACTION_CHANGED";
  return "STATE_UPDATED";
}

function describirCambioEstadoSeguimiento10A_(before, after) {
  const cambios = [];
  if (before.modo !== after.modo) cambios.push("modo " + before.modo + " → " + after.modo);
  if (before.estado !== after.estado) cambios.push("estado " + before.estado + " → " + after.estado);
  if (before.intencion !== after.intencion) cambios.push("intención " + before.intencion + " → " + after.intencion);
  if (before.temperatura !== after.temperatura) cambios.push("temperatura " + before.temperatura + " → " + after.temperatura);
  if (before.proximaAccionFecha !== after.proximaAccionFecha || before.proximaAccionTipo !== after.proximaAccionTipo) cambios.push("próxima acción actualizada");
  return cambios.length ? cambios.join(" · ") : "Memoria comercial actualizada.";
}

function auditarSeguimiento10A_(ss, data, info) {
  try {
    const actor = obtenerActorSesionSeguimiento10A_(data), meta = data && data.meta || {};
    registrarAuditoria_(ss, {
      operador: actor.label, dispositivoId: meta.dispositivoId || "SIN_ID", dispositivo: meta.dispositivoNombre || "Dispositivo sin identificar",
      plataforma: meta.plataforma || "—", navegador: meta.navegador || "—", pagina: meta.pagina || "seguimiento.html",
      modulo: "Cotizaciones", accion: info.accion || "SEGUIMIENTO IA", entidad: "COT", entidadId: String(info.numero || ""),
      resumen: info.resumen || "Se actualizó el seguimiento inteligente.", estado: "EXITOSO", requestId: info.requestId || data.requestId || "",
      datosJson: serializarObjetoAuditoria_({ etapa: HOMEEASY_FOLLOWUP_STAGE }), versionApp: meta.versionApp || "4.0-10A",
      antesJson: serializarObjetoAuditoria_(info.before || null), despuesJson: serializarObjetoAuditoria_(info.after || null),
      cambiosJson: serializarObjetoAuditoria_(typeof calcularCambiosAuditoria_ === "function" ? calcularCambiosAuditoria_(info.before || null, info.after || null) : []),
      error: "", reversible: "NO", motivoNoReversible: "El timeline es append-only; una corrección se registra como un nuevo evento.",
      dependenciasJson: serializarObjetoAuditoria_({ hojaEstado: HOMEEASY_FOLLOWUP_STATE_SHEET, hojaEventos: HOMEEASY_FOLLOWUP_EVENTS_SHEET }), revertida: "NO"
    });
  } catch (error) { console.error("No se pudo registrar auditoría 10A: " + error); }
}

function snapshotFilasComercialesSeguimiento10A_(ss) {
  const names = ["Clientes", "Cotizaciones", "Ordenes_Pedido", "Abonos", "Caja", "Agenda"], out = {};
  names.forEach(function(name) { const sh = ss.getSheetByName(name); out[name] = sh ? sh.getLastRow() : 0; });
  return out;
}

function normalizarEnumSeguimiento10A_(value, allowed, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim().toUpperCase().replace(/\s+/g, "_");
  return allowed.indexOf(text) >= 0 ? text : fallback;
}

function normalizarObjecionesSeguimiento10A_(value) {
  if (Array.isArray(value)) return value.map(function(item) { return limpiarTexto_(item, 220); }).filter(Boolean).slice(0, 12);
  if (value && typeof value === "object") return Object.keys(value).slice(0, 12).map(function(key) { return limpiarTexto_(key + ": " + value[key], 220); }).filter(Boolean);
  const text = limpiarTexto_(value || "", 1800);
  if (!text) return [];
  const parsed = parsearJsonSeguroSeguimiento10A_(text, null);
  if (Array.isArray(parsed)) return parsed.map(function(item) { return limpiarTexto_(item, 220); }).filter(Boolean).slice(0, 12);
  return text.split(/\n|;/).map(function(item) { return limpiarTexto_(item, 220); }).filter(Boolean).slice(0, 12);
}
function serializarObjecionesSeguimiento10A_(value) { return JSON.stringify(normalizarObjecionesSeguimiento10A_(value)); }
function parsearObjecionesSeguimiento10A_(value) { if (Array.isArray(value)) return value; const parsed = parsearJsonSeguroSeguimiento10A_(value, null); return Array.isArray(parsed) ? parsed : normalizarObjecionesSeguimiento10A_(value); }
function serializarMetadataSeguimiento10A_(value) { let json = "{}"; try { json = JSON.stringify(value && typeof value === "object" ? value : {}); } catch (e) {} if (json.length > 12000) json = JSON.stringify({ truncado: true, preview: json.slice(0, 11000) }); return json; }
function parsearJsonSeguroSeguimiento10A_(value, fallback) { if (value === undefined || value === null || value === "") return fallback; if (typeof value === "object") return value; try { return JSON.parse(String(value)); } catch (e) { return fallback; } }
function parsearFechaSeguimiento10A_(value, finDia) { if (!value) return null; const raw = String(value).trim(); let date = new Date(raw); if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = new Date(raw + (finDia ? "T23:59:59" : "T00:00:00")); return isNaN(date.getTime()) ? null : date; }
function parsearFechaValorSeguimiento10A_(value) { if (value === "" || value === null || value === undefined) return ""; if (value instanceof Date) return isNaN(value.getTime()) ? "" : value; const date = new Date(value); return isNaN(date.getTime()) ? "" : date; }
function fechaParaHojaSeguimiento10A_(value) { const parsed = parsearFechaValorSeguimiento10A_(value); return parsed || ""; }
function normalizarValorSeguimiento10A_(value) { if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString(); if (value === undefined || value === null || value === "") return ""; const date = new Date(value); if (!isNaN(date.getTime()) && (String(value).indexOf("-") >= 0 || String(value).indexOf("/") >= 0 || String(value).indexOf("T") >= 0)) return date.toISOString(); return value; }
function generarIdEventoSeguimiento10A_(date) { const fecha = date instanceof Date && !isNaN(date.getTime()) ? date : new Date(); return "SEG-" + Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().slice(0, 8).toUpperCase(); }
