const BASE = Object.freeze({
  fabricWidth: 1.80,
  fabricHeight: 2.20,
  fabricBottom: 0.060,
  headrailHeight: 0.100,
  headrailDepth: 0.100,
  headrailOverhang: 0.048,
  lowerProfileOverhang: 0.018,
  period: 0.12,
  horizontalMapM: 0.16,
  layerSeparation: 0.019,
  beadDiameter: 0.0054,
  beadPitch: 0.010,
  upperTubeDiameter: 0.040,
});

const RULES_URL = new URL('../../data/pentagrama-sheer-rules.json', import.meta.url);
const VISUAL_TRACE_URL = new URL('../../data/visual-sample-traceability-v2-2-1.json', import.meta.url);
let rulesPromise;
let visualTracePromise;

export const SHEER_STATES = Object.freeze({
  abierta: Object.freeze({phase: 0, displacementM: 0, extra: 'open'}),
  media: Object.freeze({phase: 2.5 / 12, displacementM: 0.025, extra: 'half'}),
  cerrada: Object.freeze({phase: 5 / 12, displacementM: 0.050, extra: 'closed'}),
});

export async function loadPentagramaRules() {
  if (!rulesPromise) {
    rulesPromise = fetch(RULES_URL, {cache: 'no-cache'}).then(response => {
      if (!response.ok) throw new Error(`No se pudieron cargar las reglas Pentagrama (${response.status}).`);
      return response.json();
    }).then(rules => {
      if (rules.snapshotId !== 'Pentagrama-2026-03') throw new Error('Snapshot Pentagrama inesperado.');
      return rules;
    });
  }
  return rulesPromise;
}

export async function loadVisualSampleTraceability() {
  if (!visualTracePromise) {
    visualTracePromise = fetch(VISUAL_TRACE_URL, {cache: 'no-cache'}).then(response => {
      if (!response.ok) throw new Error(`No se pudo cargar la trazabilidad visual V2.2.1 (${response.status}).`);
      return response.json();
    }).then(traceability => {
      if (traceability.version !== 'HomeEasy-V2.2.1' || !Array.isArray(traceability.samples)) throw new Error('Trazabilidad visual V2.2.1 inesperada.');
      return traceability;
    });
  }
  return visualTracePromise;
}

function asNumber(value) { return Number(value); }
function inLimit(value, maximum) { return maximum == null || value <= Number(maximum) + 1e-9; }
function sourceLabel(source) { return `${source.file} · ${source.sheet || `p.${source.page}`}${source.row ? ` · fila ${source.row}` : ''}`; }

export function validatePentagramaConfiguration(input, rules) {
  if (!rules || rules.snapshotId !== 'Pentagrama-2026-03') throw new Error('Las reglas Pentagrama V2.2 son obligatorias.');
  const config = {
    fabricId: String(input.fabricId || 'serenade-screen-clark'),
    visualVariant: String(input.visualVariant || 'screen-white-sand'),
    fabricWidthM: asNumber(input.fabricWidthM),
    fabricHeightM: asNumber(input.fabricHeightM),
    headrailSystem: String(input.headrailSystem || 'binovo'),
    actuation: String(input.actuation || 'manual'),
    controlSide: input.actuation === 'motorized' ? 'not-applicable' : String(input.controlSide || 'right'),
    bandState: String(input.bandState || 'abierta'),
    liftPercent: asNumber(input.liftPercent ?? 0),
  };
  const errors = [], warnings = [], evidence = [];
  const fabric = rules.fabrics.find(item => item.id === config.fabricId);
  const system = rules.systems.find(item => item.id === config.headrailSystem);
  if (!fabric) errors.push('Tela no documentada por el snapshot Pentagrama.');
  if (!system) errors.push('Sistema no documentado por el snapshot Pentagrama.');
  if (!Number.isFinite(config.fabricWidthM) || config.fabricWidthM <= 0 || !Number.isFinite(config.fabricHeightM) || config.fabricHeightM <= 0) errors.push('Ancho y alto deben ser números positivos.');
  if (!SHEER_STATES[config.bandState]) errors.push('Estado de franjas no válido.');
  if (!['manual', 'motorized'].includes(config.actuation)) errors.push('Accionamiento no válido.');
  if (config.actuation === 'manual' && !['left', 'right'].includes(config.controlSide)) errors.push('El mando manual debe estar a la izquierda o a la derecha.');
  if (!Number.isFinite(config.liftPercent) || config.liftPercent < 0 || config.liftPercent > 100) errors.push('La elevación debe estar entre 0% y 100%.');
  if (config.actuation === 'manual' && Math.abs(config.liftPercent) > 1e-9) errors.push('La elevación motorizada no aplica al accionamiento manual.');

  let availability = 'available';
  if (system?.pilotStatus === 'requiresPentagramaConfirmation') {
    availability = 'requiresPentagramaConfirmation';
    errors.push(system.pilotReason);
  } else if (system?.pilotStatus === 'disabled') {
    availability = 'unavailable';
    errors.push(system.pilotReason);
  }

  if (fabric && Number.isFinite(config.fabricWidthM) && config.fabricWidthM > fabric.fabricRollWidthM + 1e-9) {
    errors.push(`El ancho supera el rollo oficial de ${fabric.fabricRollWidthM.toFixed(2)} m para ${fabric.officialName}.`);
    evidence.push(sourceLabel(fabric.source));
  }
  const ratioRule = rules.globalRules.maxHeightToWidthRatio;
  if (Number.isFinite(config.fabricWidthM) && Number.isFinite(config.fabricHeightM) && config.fabricHeightM > config.fabricWidthM * ratioRule.value + 1e-9) {
    errors.push(ratioRule.message);
    evidence.push(sourceLabel(ratioRule.source));
  }
  const risk = rules.globalRules.narrowHighRisk;
  if (config.fabricWidthM < risk.when.widthBelowM && config.fabricHeightM > risk.when.heightAboveM) warnings.push(risk.message);

  let matchedConfiguration = null;
  let compatibleMotorOptions = [];
  if (fabric && system?.pilotStatus === 'enabled' && ['manual', 'motorized'].includes(config.actuation)) {
    const minimums = system.minimums?.[config.actuation] || {};
    if (minimums.widthM != null && config.fabricWidthM < minimums.widthM - 1e-9) errors.push(`Ancho menor al mínimo oficial de ${minimums.widthM.toFixed(2)} m para ${system.label} ${config.actuation}.`);
    if (minimums.heightM != null && config.fabricHeightM < minimums.heightM - 1e-9) errors.push(`Alto menor al mínimo oficial de ${minimums.heightM.toFixed(2)} m para ${system.label} ${config.actuation}.`);
    const systemMaxWidth = Math.min(system.maximumProductWidthM ?? Infinity, fabric.fabricRollWidthM);
    if (config.fabricWidthM > systemMaxWidth + 1e-9) errors.push(`Ancho mayor al máximo oficial de ${systemMaxWidth.toFixed(2)} m para ${system.label} y ${fabric.officialName}.`);
    const actuation = system.actuation?.[config.actuation];
    if (!actuation?.available) {
      errors.push(`${system.label} no admite accionamiento ${config.actuation} en las reglas oficiales.`);
    } else {
      const fitting = actuation.configurations.filter(option =>
        inLimit(config.fabricWidthM, option.maxWidthM) &&
        inLimit(config.fabricHeightM, option.maxHeightM) &&
        inLimit(config.fabricWidthM * config.fabricHeightM, option.maxAreaM2)
      );
      if (config.actuation === 'motorized') compatibleMotorOptions = fitting;
      if (!fitting.length) {
        errors.push(`Ninguna configuración oficial de ${system.label} ${config.actuation} admite ${config.fabricWidthM.toFixed(2)} × ${config.fabricHeightM.toFixed(2)} m para grupo ${fabric.thicknessGroup}.`);
      } else {
        matchedConfiguration = fitting[0];
        evidence.push(sourceLabel(matchedConfiguration.source));
      }
    }
  }
  if (errors.length && availability === 'available') availability = 'unavailable';
  return {ok: availability === 'available' && errors.length === 0, availability, config, fabric, system, errors, warnings, evidence: [...new Set(evidence)], matchedConfiguration, compatibleMotorOptions};
}

export function listSystemAvailability(input, rules) {
  return rules.systems.map(system => {
    const result = validatePentagramaConfiguration({...input, headrailSystem: system.id}, rules);
    return {id: system.id, label: system.label, pilotStatus: system.pilotStatus, available: result.ok, availability: result.availability, reason: result.errors[0] || '', warnings: result.warnings};
  });
}

export function getMotorAvailability(input, rules) {
  const validation = validatePentagramaConfiguration({...input, actuation: 'motorized', controlSide: 'not-applicable', liftPercent: 0}, rules);
  const available = validation.ok && validation.compatibleMotorOptions.length > 0;
  return {
    available,
    compatibleMotorOptions: validation.compatibleMotorOptions,
    reason: available ? '' : (validation.errors[0] || 'Motorización no disponible para esta configuración.'),
    validation,
  };
}

export function guardLiftRequest(input, rules, targetLiftPercent) {
  const currentLiftPercent = Number(input.liftPercent ?? 0);
  const motor = getMotorAvailability(input, rules);
  const target = Math.max(0, Math.min(100, Number(targetLiftPercent)));
  if (!motor.available || !Number.isFinite(target)) {
    return {
      allowed: false,
      liftPercent: currentLiftPercent,
      targetLiftPercent: currentLiftPercent,
      compatibleMotorOptions: motor.compatibleMotorOptions,
      reason: motor.reason || 'Motorización no disponible para esta configuración.',
    };
  }
  return {allowed: true, liftPercent: currentLiftPercent, targetLiftPercent: target, compatibleMotorOptions: motor.compatibleMotorOptions, reason: ''};
}

function parseGLB(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('El archivo no es un GLB glTF 2.0 válido.');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('El GLB no contiene JSON válido.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLength)).trim());
  const binHeader = 20 + jsonLength;
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942) throw new Error('El GLB no contiene BIN.');
  return {arrayBuffer, json, view, binOffset: binHeader + 8, binLength: view.getUint32(binHeader, true)};
}

const componentWidth = type => ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4})[type];
function accessorInfo(parsed, accessorIndex) {
  const accessor = parsed.json.accessors[accessorIndex], bufferView = parsed.json.bufferViews[accessor.bufferView];
  const componentBytes = ({5121: 1, 5123: 2, 5125: 4, 5126: 4})[accessor.componentType];
  if (!componentBytes) throw new Error(`componentType no soportado: ${accessor.componentType}`);
  return {accessor, byteOffset: parsed.binOffset + (bufferView.byteOffset || 0) + (accessor.byteOffset || 0), stride: bufferView.byteStride || componentWidth(accessor.type) * componentBytes};
}

function primitiveForNode(parsed, nodeName) {
  const node = parsed.json.nodes.find(item => item.name === nodeName);
  if (!node || node.mesh === undefined) throw new Error(`No se encontró el nodo ${nodeName}.`);
  const mesh = parsed.json.meshes[node.mesh];
  if (!mesh?.primitives?.length) throw new Error(`El nodo ${nodeName} no tiene primitive.`);
  return {node, primitive: mesh.primitives[0]};
}

function mutateVec3(parsed, nodeName, callback) {
  const {primitive} = primitiveForNode(parsed, nodeName), info = accessorInfo(parsed, primitive.attributes.POSITION);
  if (info.accessor.componentType !== 5126 || info.accessor.type !== 'VEC3') throw new Error(`POSITION incompatible en ${nodeName}.`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < info.accessor.count; i++) {
    const at = info.byteOffset + i * info.stride;
    const q = callback([parsed.view.getFloat32(at, true), parsed.view.getFloat32(at + 4, true), parsed.view.getFloat32(at + 8, true)], i);
    for (let axis = 0; axis < 3; axis++) { parsed.view.setFloat32(at + axis * 4, q[axis], true); min[axis] = Math.min(min[axis], q[axis]); max[axis] = Math.max(max[axis], q[axis]); }
  }
  info.accessor.min = min; info.accessor.max = max;
}

function mutateUV(parsed, nodeName, callback) {
  const {primitive} = primitiveForNode(parsed, nodeName), info = accessorInfo(parsed, primitive.attributes.TEXCOORD_0);
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let i = 0; i < info.accessor.count; i++) {
    const at = info.byteOffset + i * info.stride;
    const q = callback([parsed.view.getFloat32(at, true), parsed.view.getFloat32(at + 4, true)], i);
    parsed.view.setFloat32(at, q[0], true); parsed.view.setFloat32(at + 4, q[1], true);
    for (let axis = 0; axis < 2; axis++) { min[axis] = Math.min(min[axis], q[axis]); max[axis] = Math.max(max[axis], q[axis]); }
  }
  info.accessor.min = min; info.accessor.max = max;
}

function mutateIfPresent(parsed, names, callback) { for (const name of names) if (parsed.json.nodes.some(node => node.name === name)) mutateVec3(parsed, name, callback); }
function signOffset(x, delta) { return Math.abs(x) < 1e-7 ? x : x + Math.sign(x) * delta / 2; }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function standardProfile(normalizedHeight, normalizedDepth) {
  const u = clamp01(normalizedHeight), v = clamp01(normalizedDepth);
  const compactHeight = clamp01(u + 0.12 * (1 - u) * v);
  const taperedDepth = 0.58 + 0.42 * Math.pow(u, 0.72);
  return [compactHeight, v * taperedDepth];
}
function readFloatVector(parsed, info, index, width) {
  const at = info.byteOffset + index * info.stride;
  return Array.from({length: width}, (_, axis) => parsed.view.getFloat32(at + axis * 4, true));
}
function writeFloatVector(parsed, info, index, values) {
  const at = info.byteOffset + index * info.stride;
  for (let axis = 0; axis < values.length; axis++) parsed.view.setFloat32(at + axis * 4, values[axis], true);
}
function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > 1e-12 ? vector.map(value => value / length) : [0, 1, 0];
}
function readIndex(parsed, info, index) {
  const at = info.byteOffset + index * info.stride;
  if (info.accessor.componentType === 5121) return parsed.view.getUint8(at);
  if (info.accessor.componentType === 5123) return parsed.view.getUint16(at, true);
  if (info.accessor.componentType === 5125) return parsed.view.getUint32(at, true);
  throw new Error('Índices de cadena incompatibles.');
}
function writeIndex(parsed, info, index, value) {
  const at = info.byteOffset + index * info.stride;
  if (info.accessor.componentType === 5121) parsed.view.setUint8(at, value);
  else if (info.accessor.componentType === 5123) parsed.view.setUint16(at, value, true);
  else if (info.accessor.componentType === 5125) parsed.view.setUint32(at, value, true);
  else throw new Error('Índices de triángulo incompatibles.');
}

function correctLinearMeshFrame(parsed, nodeName, scale) {
  const {primitive} = primitiveForNode(parsed, nodeName);
  const determinant = scale[0] * scale[1] * scale[2];
  if (primitive.attributes.NORMAL !== undefined) {
    const normal = accessorInfo(parsed, primitive.attributes.NORMAL);
    for (let i = 0; i < normal.accessor.count; i++) {
      const value = readFloatVector(parsed, normal, i, 3);
      writeFloatVector(parsed, normal, i, normalize3([value[0] / scale[0], value[1] / scale[1], value[2] / scale[2]]));
    }
  }
  if (primitive.attributes.TANGENT !== undefined) {
    const tangent = accessorInfo(parsed, primitive.attributes.TANGENT);
    for (let i = 0; i < tangent.accessor.count; i++) {
      const value = readFloatVector(parsed, tangent, i, 4), xyz = normalize3([value[0] * scale[0], value[1] * scale[1], value[2] * scale[2]]);
      writeFloatVector(parsed, tangent, i, [...xyz, determinant < 0 ? -value[3] : value[3]]);
    }
  }
  if (determinant < 0) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error(`No se puede corregir winding no triangular en ${nodeName}.`);
    if (primitive.indices === undefined) throw new Error(`La malla espejada ${nodeName} debe tener índices.`);
    const indices = accessorInfo(parsed, primitive.indices);
    for (let i = 0; i < indices.accessor.count; i += 3) {
      const second = readIndex(parsed, indices, i + 1), third = readIndex(parsed, indices, i + 2);
      writeIndex(parsed, indices, i + 1, third);
      writeIndex(parsed, indices, i + 2, second);
    }
  }
}

function recomputeMeshFrame(parsed, nodeName) {
  const {primitive} = primitiveForNode(parsed, nodeName);
  if (primitive.indices === undefined || primitive.attributes.NORMAL === undefined) return;
  const position = accessorInfo(parsed, primitive.attributes.POSITION), normal = accessorInfo(parsed, primitive.attributes.NORMAL), indices = accessorInfo(parsed, primitive.indices);
  const uv = primitive.attributes.TEXCOORD_0 === undefined ? null : accessorInfo(parsed, primitive.attributes.TEXCOORD_0);
  const tangent = primitive.attributes.TANGENT === undefined ? null : accessorInfo(parsed, primitive.attributes.TANGENT);
  const normals = Array.from({length: position.accessor.count}, () => [0, 0, 0]);
  const tangents = tangent ? Array.from({length: position.accessor.count}, () => [0, 0, 0]) : null;
  const bitangents = tangent ? Array.from({length: position.accessor.count}, () => [0, 0, 0]) : null;
  const add = (target, value) => { for (let axis = 0; axis < 3; axis++) target[axis] += value[axis]; };
  for (let at = 0; at < indices.accessor.count; at += 3) {
    const ids = [readIndex(parsed, indices, at), readIndex(parsed, indices, at + 1), readIndex(parsed, indices, at + 2)];
    const p = ids.map(index => readFloatVector(parsed, position, index, 3));
    const edge1 = p[1].map((value, axis) => value - p[0][axis]), edge2 = p[2].map((value, axis) => value - p[0][axis]);
    const face = [edge1[1] * edge2[2] - edge1[2] * edge2[1], edge1[2] * edge2[0] - edge1[0] * edge2[2], edge1[0] * edge2[1] - edge1[1] * edge2[0]];
    for (const id of ids) add(normals[id], face);
    if (tangent && uv) {
      const tex = ids.map(index => readFloatVector(parsed, uv, index, 2));
      const duv1 = [tex[1][0] - tex[0][0], tex[1][1] - tex[0][1]], duv2 = [tex[2][0] - tex[0][0], tex[2][1] - tex[0][1]];
      const divisor = duv1[0] * duv2[1] - duv1[1] * duv2[0];
      if (Math.abs(divisor) > 1e-12) {
        const r = 1 / divisor;
        const t = edge1.map((value, axis) => (value * duv2[1] - edge2[axis] * duv1[1]) * r);
        const b = edge2.map((value, axis) => (value * duv1[0] - edge1[axis] * duv2[0]) * r);
        for (const id of ids) { add(tangents[id], t); add(bitangents[id], b); }
      }
    }
  }
  for (let i = 0; i < normal.accessor.count; i++) {
    const n = normalize3(normals[i]);
    writeFloatVector(parsed, normal, i, n);
    if (tangent) {
      const raw = tangents[i], projection = raw[0] * n[0] + raw[1] * n[1] + raw[2] * n[2];
      let t = normalize3(raw.map((value, axis) => value - n[axis] * projection));
      if (Math.abs(t[0] * n[0] + t[1] * n[1] + t[2] * n[2]) > 1e-4) t = normalize3([n[1], -n[0], 0]);
      const cross = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      const b = bitangents[i], handedness = cross[0] * b[0] + cross[1] * b[1] + cross[2] * b[2] < 0 ? -1 : 1;
      writeFloatVector(parsed, tangent, i, [...t, handedness]);
    }
  }
}

function chainLimits(fabricHeight, systemHeight) {
  const fabricTop = BASE.fabricBottom + fabricHeight;
  return {top: fabricTop + systemHeight * 0.28, bottom: Math.max(0.32, fabricHeight * 0.32)};
}

function activeChainCenters(fabricWidth, fabricHeight, systemDepth, systemHeight, side) {
  const sign = side === 'left' ? -1 : 1, inner = sign * (fabricWidth / 2 + 0.035), outer = inner + sign * 0.013, z = systemDepth - 0.013;
  const {top, bottom} = chainLimits(fabricHeight, systemHeight), centers = [];
  for (let y = bottom; y <= top + 1e-9; y += BASE.beadPitch) centers.push([inner, y, z], [outer, y, z]);
  for (let i = 0; i < 8; i++) {
    const theta = Math.PI * i / 7;
    centers.push([(inner + outer) / 2 + (outer - inner) / 2 * Math.cos(theta), bottom - Math.abs(outer - inner) / 2 * Math.sin(theta), z]);
  }
  return centers;
}

function hiddenChainCenter(fabricWidth, fabricHeight, systemDepth, systemHeight, side, index) {
  const sign = side === 'left' ? -1 : 1;
  return [sign * (fabricWidth / 2 + ((index % 17) - 8) * 0.00011), BASE.fabricBottom + fabricHeight + systemHeight / 2 + (Math.floor(index / 187) - 1) * 0.00011, systemDepth / 2 - ((Math.floor(index / 17) % 11) - 5) * 0.00011];
}

function repositionChainBeads(parsed, width, height, systemDepth, systemHeight, side) {
  const {node, primitive} = primitiveForNode(parsed, 'Cadena_Accionamiento');
  const position = accessorInfo(parsed, primitive.attributes.POSITION), indices = accessorInfo(parsed, primitive.indices);
  const parent = Array.from({length: position.accessor.count}, (_, i) => i);
  const find = value => { let root = value; while (parent[root] !== root) root = parent[root]; while (parent[value] !== value) { const next = parent[value]; parent[value] = root; value = next; } return root; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < indices.accessor.count; i += 3) { const a = readIndex(parsed, indices, i), b = readIndex(parsed, indices, i + 1), c = readIndex(parsed, indices, i + 2); union(a, b); union(b, c); }
  const groups = new Map();
  for (let i = 0; i < position.accessor.count; i++) { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); }
  const components = [...groups.values()].sort((a, b) => a[0] - b[0]), target = activeChainCenters(width, height, systemDepth, systemHeight, side);
  if (target.length > components.length) throw new Error(`Capacidad de cadena insuficiente: ${target.length}/${components.length}.`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let groupIndex = 0; groupIndex < components.length; groupIndex++) {
    const group = components[groupIndex], centroid = [0, 0, 0];
    for (const vertexIndex of group) { const at = position.byteOffset + vertexIndex * position.stride; for (let axis = 0; axis < 3; axis++) centroid[axis] += parsed.view.getFloat32(at + axis * 4, true); }
    for (let axis = 0; axis < 3; axis++) centroid[axis] /= group.length;
    const center = groupIndex < target.length ? target[groupIndex] : hiddenChainCenter(width, height, systemDepth, systemHeight, side, groupIndex - target.length);
    for (const vertexIndex of group) {
      const at = position.byteOffset + vertexIndex * position.stride;
      for (let axis = 0; axis < 3; axis++) { const value = center[axis] + parsed.view.getFloat32(at + axis * 4, true) - centroid[axis]; parsed.view.setFloat32(at + axis * 4, value, true); min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); }
    }
  }
  position.accessor.min = min; position.accessor.max = max;
  node.extras = {...node.extras, controlSide: side, bead_diameter_m: BASE.beadDiameter, bead_pitch_m: BASE.beadPitch, active_bead_count: target.length, bead_capacity: components.length};
}

function removeSceneNodes(parsed, names) {
  const scene = parsed.json.scenes[parsed.json.scene || 0], excluded = new Set(names);
  scene.nodes = (scene.nodes || []).filter(index => !excluded.has(parsed.json.nodes[index]?.name));
}

function renameNode(parsed, oldName, newName, extras = {}) {
  const node = parsed.json.nodes.find(item => item.name === oldName);
  if (node) { node.name = newName; node.extras = {...node.extras, ...extras}; }
}

function packGLB(parsed) {
  const jsonRaw = new TextEncoder().encode(JSON.stringify(parsed.json)), jsonLength = Math.ceil(jsonRaw.length / 4) * 4, binLength = Math.ceil(parsed.binLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength, output = new ArrayBuffer(total), view = new DataView(output), bytes = new Uint8Array(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true); view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(jsonRaw, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true); view.setUint32(binHeader + 4, 0x004e4942, true); bytes.set(new Uint8Array(parsed.arrayBuffer, parsed.binOffset, parsed.binLength), binHeader + 8);
  return output;
}

export async function createParametricSheerGLB(templateUrl, input) {
  const [rules, visualTraceability] = await Promise.all([loadPentagramaRules(), loadVisualSampleTraceability()]);
  const validation = validatePentagramaConfiguration(input, rules);
  if (!validation.ok) throw new Error(`Pentagrama bloquea esta configuración: ${validation.errors.join(' ')}`);
  const visualSample = visualTraceability.samples.find(item => item.id === validation.config.visualVariant);
  if (!visualSample) throw new Error('La muestra visual no pertenece a la trazabilidad V2.2.1.');
  const {config, fabric, system, matchedConfiguration, compatibleMotorOptions} = validation;
  const response = await fetch(templateUrl, {cache: 'force-cache'});
  if (!response.ok) throw new Error(`No se pudo cargar la plantilla (${response.status}).`);
  const parsed = parseGLB(await response.arrayBuffer());
  const width = config.fabricWidthM, height = config.fabricHeightM, state = SHEER_STATES[config.bandState];
  const lift = config.liftPercent / 100, liftDelta = height * lift, visibleHeight = Math.max(height * (1 - lift), 0.001);
  const dw = width - BASE.fabricWidth, systemHeight = system.geometry.sectionM[0], systemDepth = system.geometry.sectionM[1];
  const fabricTop = BASE.fabricBottom + height, railWidth = width + BASE.headrailOverhang;
  const baseHeadrailBottom = BASE.fabricBottom + BASE.fabricHeight;
  const profilePoint = (y, z) => {
    const normalized = [(y - baseHeadrailBottom) / BASE.headrailHeight, z / BASE.headrailDepth];
    const shaped = system.id === 'standard' ? standardProfile(normalized[0], normalized[1]) : normalized.map(clamp01);
    return [fabricTop + shaped[0] * systemHeight, shaped[1] * systemDepth];
  };
  const headrailNames = ['Cabezal_Binovo_Plano', 'Fascia_Frontal', 'Junta_Inferior_Cabezal'];
  const endPieceNames = ['Tapa_Lateral_Izq', 'Tapa_Lateral_Der'];
  const railScaleX = railWidth / (BASE.fabricWidth + BASE.headrailOverhang);
  mutateIfPresent(parsed, headrailNames, ([x, y, z]) => { const yz = profilePoint(y, z); return [x * railScaleX, yz[0], yz[1]]; });
  mutateIfPresent(parsed, endPieceNames, ([x, y, z]) => { const yz = profilePoint(y, z); return [signOffset(x, dw), yz[0], yz[1]]; });
  if (system.id === 'standard') {
    const railPrimitive = primitiveForNode(parsed, 'Cabezal_Binovo_Plano').primitive;
    const railPosition = accessorInfo(parsed, railPrimitive.attributes.POSITION).accessor;
    const mappedYMin = railPosition.min[1], mappedYSize = railPosition.max[1] - railPosition.min[1], mappedZMin = railPosition.min[2], mappedZSize = railPosition.max[2] - railPosition.min[2];
    mutateIfPresent(parsed, [...headrailNames, ...endPieceNames], ([x, y, z]) => [x, fabricTop + (y - mappedYMin) * (systemHeight / mappedYSize), (z - mappedZMin) * (systemDepth / mappedZSize)]);
  }
  mutateIfPresent(parsed, ['Soporte_Pared_Izq', 'Soporte_Pared_Der'], ([x, y, z]) => [signOffset(x, dw), fabricTop + (y - (BASE.fabricBottom + BASE.fabricHeight)) * (systemHeight / BASE.headrailHeight), z * (systemDepth / BASE.headrailDepth)]);
  if (system.id === 'standard') {
    for (const name of [...headrailNames, ...endPieceNames]) if (parsed.json.nodes.some(node => node.name === name)) recomputeMeshFrame(parsed, name);
  } else {
    for (const name of headrailNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, [railScaleX, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth]);
    for (const name of endPieceNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, [1, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth]);
  }
  renameNode(parsed, 'Cabezal_Binovo_Plano', `Cabezal_${system.label.replace(/\s+/g, '_')}_Plano`, {
    system: system.label,
    sectionM: system.geometry.sectionM,
    sectionDimensionsExact: true,
    profileShapeExact: false,
    profileShapeSource: '581_FichaSheerElegance.pdf p.2',
    profileReconstruction: system.id === 'standard' ? 'independent-compact-d-profile-v2-2-1' : 'visual-binovo-profile-v2-2',
  });

  const tubeDiameter = matchedConfiguration.tubeDiameterMm / 1000, tubeScale = tubeDiameter / BASE.upperTubeDiameter;
  const baseTubeCenterY = BASE.fabricBottom + BASE.fabricHeight + BASE.headrailHeight - 0.069, baseTubeCenterZ = 0.057;
  const tubeCenterY = fabricTop + systemHeight * 0.31, tubeCenterZ = systemDepth * 0.57;
  mutateIfPresent(parsed, ['Tubo_Enrollador'], ([x, y, z]) => [x * ((width - 0.052) / (BASE.fabricWidth - 0.052)), tubeCenterY + (y - baseTubeCenterY) * tubeScale, tubeCenterZ + (z - baseTubeCenterZ) * tubeScale]);

  const rearZ = systemDepth - 0.046, frontZ = rearZ + BASE.layerSeparation;
  const textileY = y => BASE.fabricBottom + liftDelta + ((y - BASE.fabricBottom) / BASE.fabricHeight) * visibleHeight;
  mutateIfPresent(parsed, ['Tela_Posterior'], ([x, y]) => [x * (width / BASE.fabricWidth), textileY(y), rearZ]);
  mutateIfPresent(parsed, ['Tela_Frontal'], ([x, y]) => [x * (width / BASE.fabricWidth), textileY(y), frontZ]);
  mutateIfPresent(parsed, ['Canto_Textil_Izq', 'Canto_Textil_Der'], ([x, y]) => [signOffset(x, dw), textileY(y), (rearZ + frontZ) / 2]);
  const lowerZShift = (rearZ + frontZ) / 2 - 0.0635;
  mutateIfPresent(parsed, ['Tela_Retorno_Inferior'], ([x, y, z]) => [x * (width / BASE.fabricWidth), y + liftDelta, z + lowerZShift]);
  mutateIfPresent(parsed, ['Rodillo_Retorno_Inferior'], ([x, y, z]) => [x * ((width - 0.030) / (BASE.fabricWidth - 0.030)), y + liftDelta, z + lowerZShift]);
  mutateIfPresent(parsed, ['Perfil_Inferior'], ([x, y, z]) => [x * ((width + BASE.lowerProfileOverhang) / (BASE.fabricWidth + BASE.lowerProfileOverhang)), y + liftDelta, z + lowerZShift]);
  mutateIfPresent(parsed, ['Inserto_Perfil_Inferior'], ([x, y, z]) => [x * ((width - 0.012) / (BASE.fabricWidth - 0.012)), y + liftDelta, z + lowerZShift]);

  const oldU = BASE.fabricWidth / BASE.horizontalMapM, newU = width / BASE.horizontalMapM;
  const oldV = BASE.fabricHeight / BASE.period, newBottomV = height * lift / BASE.period, newVisibleV = visibleHeight / BASE.period;
  mutateUV(parsed, 'Tela_Frontal', ([u, v]) => [u / oldU * newU, newBottomV + (v / oldV) * newVisibleV]);
  mutateUV(parsed, 'Tela_Posterior', ([u, v]) => [u / oldU * newU, newBottomV + (v / oldV) * newVisibleV - state.phase]);

  const controlSign = config.controlSide === 'left' ? -1 : 1;
  const baseLimits = chainLimits(BASE.fabricHeight, BASE.headrailHeight), nextLimits = chainLimits(height, systemHeight);
  const manualX = x => controlSign * (Math.abs(x) + dw / 2);
  const mapManual = ([x, y, z]) => [manualX(x), fabricTop + (y - (BASE.fabricBottom + BASE.fabricHeight)) * (systemHeight / BASE.headrailHeight), z * (systemDepth / BASE.headrailDepth)];
  const mechanismNames = ['Mecanismo_Nylon_Anillo_1', 'Mecanismo_Nylon_Anillo_2', 'Mecanismo_Nylon_Anillo_3', 'Mecanismo_Nylon_Cuerpo', 'Salida_Cadena'];
  const threadNames = ['Hilo_Cadena_Izq', 'Hilo_Cadena_Der', 'Hilo_Cadena_Curva_Inferior'];
  const manualLinearScale = [controlSign, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth];
  mutateIfPresent(parsed, mechanismNames, mapManual);
  for (const name of mechanismNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, manualLinearScale);

  if (config.actuation === 'manual') {
    mutateIfPresent(parsed, ['Hilo_Cadena_Izq', 'Hilo_Cadena_Der'], ([x, y]) => [manualX(x), nextLimits.bottom + ((y - baseLimits.bottom) / (baseLimits.top - baseLimits.bottom)) * (nextLimits.top - nextLimits.bottom), systemDepth - 0.013]);
    mutateIfPresent(parsed, ['Hilo_Cadena_Curva_Inferior'], ([x, y]) => [manualX(x), y + nextLimits.bottom - baseLimits.bottom, systemDepth - 0.013]);
    for (const name of threadNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, manualLinearScale);
    repositionChainBeads(parsed, width, height, systemDepth, systemHeight, config.controlSide);
    for (const name of ['Mecanismo_Nylon_Anillo_1', 'Mecanismo_Nylon_Anillo_2', 'Mecanismo_Nylon_Anillo_3', 'Mecanismo_Nylon_Cuerpo', 'Salida_Cadena']) {
      const node = parsed.json.nodes.find(item => item.name === name); if (node) node.extras = {...node.extras, controlSide: config.controlSide, mechanism: matchedConfiguration.mechanism, tubeDiameterMm: matchedConfiguration.tubeDiameterMm};
    }
  } else {
    removeSceneNodes(parsed, ['Cadena_Accionamiento', 'Hilo_Cadena_Izq', 'Hilo_Cadena_Der', 'Hilo_Cadena_Curva_Inferior', 'Salida_Cadena']);
    renameNode(parsed, 'Mecanismo_Nylon_Anillo_1', 'Motor_Tubular_Adaptador', {motorCodes: matchedConfiguration.motorCodes, insideTube: true});
    renameNode(parsed, 'Mecanismo_Nylon_Anillo_2', 'Motor_Tubular_Cabeza', {motorCodes: matchedConfiguration.motorCodes});
    renameNode(parsed, 'Mecanismo_Nylon_Anillo_3', 'Motor_Tubular_FinCarrera', {motorCodes: matchedConfiguration.motorCodes});
    renameNode(parsed, 'Mecanismo_Nylon_Cuerpo', 'Soporte_Motor', {motorCodes: matchedConfiguration.motorCodes, tubeDiameterMm: matchedConfiguration.tubeDiameterMm});
  }

  const sceneIndex = parsed.json.scene || 0, sceneExtras = parsed.json.scenes?.[sceneIndex]?.extras || {};
  Object.assign(sceneExtras, {
    homeeasyAsset: 'AR Sheer Elegance V2.2.1', product: 'Sheer Elegance', manufacturer: 'Pentagrama',
    collection: fabric.collection, fabric: fabric.officialName, visualVariant: config.visualVariant, visualSample: visualSample.displayName, legacyVisualAssetId: visualSample.legacyAssetId,
    commercialColorName: visualSample.commercialColorName, officialClarkColorConfirmed: visualSample.officialClarkColorConfirmed, fabricThicknessGroup: fabric.thicknessGroup,
    fabricWidthM: width, fabricHeightM: height, physicalVisibleFabricHeightM: height * (1 - lift), physicalTotalFabricLengthM: 2 * height + 0.20,
    headrailSystem: system.label, actuation: config.actuation, controlSide: config.controlSide, bandState: config.bandState,
    liftPercent: config.liftPercent, isMoving: Boolean(input.isMoving), direction: input.direction || 'stopped',
    rulesSnapshot: rules.snapshotId, matchedConfigurationId: matchedConfiguration.id,
    compatibleMotorOptions: config.actuation === 'motorized' ? compatibleMotorOptions.map(option => ({id: option.id, motorCodes: option.motorCodes, tubeDiameterMm: option.tubeDiameterMm, maxAreaM2: option.maxAreaM2, maxWidthM: option.maxWidthM, maxHeightM: option.maxHeightM})) : [],
    state: state.extra, stateUi: config.bandState, rear_phase_cycles: state.phase, rear_material_displacement_m: state.displacementM,
    physical_repeat_m: BASE.period, opaque_band_m: 0.07, transparent_band_m: 0.05, layer_separation_m: BASE.layerSeparation,
    headrail: {system: system.label, sectionM: system.geometry.sectionM, sectionDimensionsExact: true, profileShapeExact: false, profileShapeSource: '581_FichaSheerElegance.pdf p.2', architecture: system.geometry.architecture, longitudinalOverhang: {valueM: BASE.headrailOverhang, approximate: true}},
    manufacturability: {available: true, warnings: validation.warnings, evidence: validation.evidence, authority: rules.authority.policy},
    rulesSnapshotDetails: {id: rules.snapshotId, fabricSource: fabric.source, configurationSource: matchedConfiguration.source},
    approximateDimensions: {
      lowerProfile: {sectionM: [0.043, 0.046], overhangM: BASE.lowerProfileOverhang, approximate: true},
      chain: config.actuation === 'manual' ? {beadDiameterM: BASE.beadDiameter, pitchM: BASE.beadPitch, cordDiameterM: 0.0017, approximate: true} : {notApplicable: true, approximate: true},
      headrailLongitudinalOverhang: {valueM: BASE.headrailOverhang, approximate: true}, mechanismHousing: {approximate: true}, motorBody: config.actuation === 'motorized' ? {insideTube: true, approximate: true} : {notApplicable: true, approximate: true},
    },
    parametric_runtime: 'HomeEasy sheer-configurator-v2-2-1.js',
  });
  parsed.json.scenes[sceneIndex].extras = sceneExtras;
  const rearNode = parsed.json.nodes.find(node => node.name === 'Tela_Posterior'); if (rearNode) rearNode.extras = {...rearNode.extras, phase_cycles: state.phase, liftPercent: config.liftPercent, patternScalePhysical: true};
  const frontNode = parsed.json.nodes.find(node => node.name === 'Tela_Frontal'); if (frontNode) frontNode.extras = {...frontNode.extras, phase_cycles: 0, liftPercent: config.liftPercent, patternScalePhysical: true};
  return new Blob([packGLB(parsed)], {type: 'model/gltf-binary'});
}
