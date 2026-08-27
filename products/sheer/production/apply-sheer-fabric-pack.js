const BASE = Object.freeze({
  fabricWidth: 1.80,
  fabricHeight: 2.20,
  fabricBottom: 0.060,
  headrailHeight: 0.100,
  headrailDepth: 0.100,
  headrailOverhang: 0.048,
  lowerProfileOverhang: 0.018,
  period: 0.12,
  layerSeparation: 0.019,
  beadDiameter: 0.0054,
  beadPitch: 0.010,
  upperTubeDiameter: 0.040,
});

export const SHEER_STATES = Object.freeze({
  abierta: Object.freeze({extra: 'open'}),
  media: Object.freeze({extra: 'half'}),
  cerrada: Object.freeze({extra: 'closed'}),
});

const SYSTEMS = Object.freeze({
  standard: Object.freeze({
    id: 'standard', label: 'Standard', maximumProductWidthM: 2.6,
    geometry: Object.freeze({sectionM: Object.freeze([0.072, 0.072]), architecture: 'compact-headrail'}),
    configurations: Object.freeze([
      Object.freeze({id: 'standard-manual-r8-vtx10-t32', mechanism: 'R8/VTX10', tubeDiameterMm: 32, maxWidthM: 1.6, maxHeightM: 1.8}),
      Object.freeze({id: 'standard-manual-r8-t38', mechanism: 'R8', tubeDiameterMm: 38, maxWidthM: 2.6, maxHeightM: 1.2}),
    ]),
  }),
  binovo: Object.freeze({
    id: 'binovo', label: 'Binovo', maximumProductWidthM: 3,
    geometry: Object.freeze({sectionM: Object.freeze([0.100, 0.100]), architecture: 'medium-headrail'}),
    configurations: Object.freeze([
      Object.freeze({id: 'binovo-manual-vtx10-clic-s-t32', mechanism: 'VTX10 / CLIC S', tubeDiameterMm: 32, maxWidthM: 1.7, maxHeightM: 2.6}),
      Object.freeze({id: 'binovo-manual-vtx15-clic-m-t38', mechanism: 'VTX15 / CLIC M', tubeDiameterMm: 38, maxWidthM: 2.6, maxHeightM: 3}),
      Object.freeze({id: 'binovo-manual-vtx20-clic-m-t50', mechanism: 'VTX20 / CLIC M', tubeDiameterMm: 50, maxWidthM: 3, maxHeightM: 2.2}),
    ]),
  }),
});

const DEFAULT_CONFIG = Object.freeze({fabricWidthM: 1.8, fabricHeightM: 2.2, headrailSystem: 'binovo', controlSide: 'right', bandState: 'abierta'});
function inLimit(value, maximum) { return maximum == null || value <= Number(maximum) + 1e-9; }
function normalizeConfig(input = {}) {
  const config={...DEFAULT_CONFIG,...input,fabricWidthM:Number(input.fabricWidthM ?? DEFAULT_CONFIG.fabricWidthM),fabricHeightM:Number(input.fabricHeightM ?? DEFAULT_CONFIG.fabricHeightM)};
  if(!SYSTEMS[config.headrailSystem])throw new Error('Sheer Master solo admite Standard o Binovo.');
  if(!['left','right'].includes(config.controlSide))throw new Error('El mando debe ser left o right.');
  if(!SHEER_STATES[config.bandState])throw new Error('El estado debe ser abierta, media o cerrada.');
  if(!Number.isFinite(config.fabricWidthM)||!Number.isFinite(config.fabricHeightM)||config.fabricWidthM<0.3||config.fabricHeightM<0.45)throw new Error('Medidas Sheer inválidas.');
  const system=SYSTEMS[config.headrailSystem];
  if(config.fabricWidthM>system.maximumProductWidthM+1e-9)throw new Error(`Ancho mayor al máximo documentado de ${system.label}.`);
  const matchedConfiguration=system.configurations.find(option=>inLimit(config.fabricWidthM,option.maxWidthM)&&inLimit(config.fabricHeightM,option.maxHeightM));
  if(!matchedConfiguration)throw new Error(`Ningún mecanismo manual ${system.label} admite ${config.fabricWidthM.toFixed(2)} × ${config.fabricHeightM.toFixed(2)} m.`);
  return {config,system,matchedConfiguration};
}

async function loadBytes(value,label){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(value instanceof Blob)return new Uint8Array(await value.arrayBuffer());
  const response=await fetch(value);if(!response.ok)throw new Error(`${label} HTTP ${response.status}`);return new Uint8Array(await response.arrayBuffer());
}
async function loadJson(value,label){
  if(value&&typeof value==='object'&&!(value instanceof URL))return value;
  const response=await fetch(value);if(!response.ok)throw new Error(`${label} HTTP ${response.status}`);return response.json();
}
async function resolveFabricPack(input){
  if(typeof input==='string'||input instanceof URL){const base=input instanceof URL?input:new URL(input,location.href);return resolveFabricPack({base});}
  const base=input.base instanceof URL?input.base:(input.base?new URL(input.base,location.href):null);
  const source=(name)=>input[name]||(base?new URL(name,base):null);
  const profile=await loadJson(source('band-profile.json'),'band-profile.json');
  const evidence=await loadJson(source('source-evidence.json'),'source-evidence.json');
  return {profile,evidence,rgba:await loadBytes(source('rgba-repeat.png'),'rgba-repeat.png'),normal:await loadBytes(source('normal.png'),'normal.png'),roughness:await loadBytes(source('roughness.png'),'roughness.png')};
}

function validateBandProfile(profile){
  if(!profile||profile.schemaVersion!=='1.0.0'||!Array.isArray(profile.segments)||!profile.segments.length)throw new Error('band-profile.json inválido.');
  if(!Number.isFinite(Number(profile.repeatWidthM))||!(Number(profile.repeatWidthM)>0))throw new Error('band-profile.json debe declarar repeatWidthM positivo.');
  const total=profile.segments.reduce((sum,segment)=>sum+Number(segment.heightM),0);
  if(Math.abs(total-Number(profile.repeatHeightM))>1e-7)throw new Error('Los segmentos no completan exactamente el repeat físico.');
  if(profile.segments.some(segment=>!['opaque','sheer'].includes(segment.type)||!(Number(segment.heightM)>0)))throw new Error('Segmento Sheer inválido.');
  for(const state of Object.keys(SHEER_STATES))if(!Number.isFinite(Number(profile.rearLayerOffsetsM?.[state])))throw new Error(`Falta offset ${state}.`);
  return profile;
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

// Pentagrama documents the Standard envelope as 72 x 72 mm. The technical
// sheet shows a compact rounded exterior, but it does not publish a CAD
// section, wall thicknesses or slot dimensions. This polygon therefore keeps
// the documented envelope exact while identifying the exterior contour as an
// evidence-based approximation instead of deforming the Binovo mesh.
function standardExteriorProfile(fabricTop, height, depth) {
  const cubic = (start, controlA, controlB, end, step) => {
    const inverse = 1 - step;
    return [0, 1].map(axis => inverse ** 3 * start[axis] + 3 * inverse ** 2 * step * controlA[axis] + 3 * inverse * step ** 2 * controlB[axis] + step ** 3 * end[axis]);
  };
  const points = [[0.000, 0.000], [1.000, 0.000], [1.000, 0.690]];
  for (let step = 1; step <= 10; step++) points.push(cubic([1.000, 0.690], [1.000, 0.900], [0.895, 1.000], [0.680, 1.000], step / 10));
  points.push([0.205, 1.000]);
  for (let step = 1; step <= 10; step++) points.push(cubic([0.205, 1.000], [0.075, 1.000], [0.000, 0.915], [0.000, 0.790], step / 10));
  return points.map(([y, z]) => [fabricTop + y * height, z * depth]);
}

function createExtrudedProfile(profile, xMin, xMax, closedEnd = null) {
  const positions = [], normals = [], indices = [];
  const addVertex = (position, normal) => { positions.push(...position); normals.push(...normal); return positions.length / 3 - 1; };
  for (let index = 0; index < profile.length; index++) {
    const [y0, z0] = profile[index], [y1, z1] = profile[(index + 1) % profile.length];
    const dy = y1 - y0, dz = z1 - z0, length = Math.hypot(dy, dz), normal = [0, dz / length, -dy / length];
    const a = addVertex([xMin, y0, z0], normal), b = addVertex([xMin, y1, z1], normal);
    const c = addVertex([xMax, y1, z1], normal), d = addVertex([xMax, y0, z0], normal);
    indices.push(a, b, c, a, c, d);
  }
  if (closedEnd === 'left' || closedEnd === 'right') {
    const x = closedEnd === 'left' ? xMin : xMax, normal = closedEnd === 'left' ? [-1, 0, 0] : [1, 0, 0];
    const centerY = profile.reduce((sum, point) => sum + point[0], 0) / profile.length;
    const centerZ = profile.reduce((sum, point) => sum + point[1], 0) / profile.length;
    const center = addVertex([x, centerY, centerZ], normal);
    const rim = profile.map(([y, z]) => addVertex([x, y, z], normal));
    for (let index = 0; index < rim.length; index++) {
      const next = rim[(index + 1) % rim.length];
      if (closedEnd === 'right') indices.push(center, rim[index], next);
      else indices.push(center, next, rim[index]);
    }
  }
  return {positions, normals, indices};
}

function appendAccessor(parsed, values, componentType, type, target, bounds = null) {
  const source = parsed.outputBin || new Uint8Array(parsed.arrayBuffer, parsed.binOffset, parsed.binLength);
  const typed = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const aligned = Math.ceil(source.byteLength / 4) * 4, output = new Uint8Array(aligned + typed.byteLength);
  output.set(source); output.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), aligned);
  parsed.outputBin = output; parsed.json.buffers[0].byteLength = output.byteLength;
  const bufferView = parsed.json.bufferViews.length;
  parsed.json.bufferViews.push({buffer: 0, byteOffset: aligned, byteLength: typed.byteLength, target});
  const accessor = parsed.json.accessors.length, definition = {bufferView, componentType, count: values.length / componentWidth(type), type};
  if (bounds) { definition.min = bounds.min; definition.max = bounds.max; }
  parsed.json.accessors.push(definition);
  return accessor;
}

function replaceNodeWithGeometry(parsed, nodeName, geometry, material, meshName) {
  const node = parsed.json.nodes.find(item => item.name === nodeName);
  if (!node || node.mesh === undefined) throw new Error(`No se encontró la malla ${nodeName}.`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < geometry.positions.length; index += 3) for (let axis = 0; axis < 3; axis++) {
    const value = geometry.positions[index + axis]; min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
  }
  const position = appendAccessor(parsed, geometry.positions, 5126, 'VEC3', 34962, {min, max});
  const normal = appendAccessor(parsed, geometry.normals, 5126, 'VEC3', 34962);
  const indices = appendAccessor(parsed, geometry.indices, 5123, 'SCALAR', 34963);
  parsed.json.meshes[node.mesh] = {name: meshName, primitives: [{attributes: {POSITION: position, NORMAL: normal}, indices, material}]};
}

function installIndependentStandardHeadrail(parsed, {railWidth, fabricTop, systemHeight, systemDepth, capThickness, headrailMaterial, capMaterial}) {
  const profile = standardExteriorProfile(fabricTop, systemHeight, systemDepth), outerHalfWidth = railWidth / 2, bodyHalfWidth = outerHalfWidth - capThickness;
  replaceNodeWithGeometry(parsed, 'Cabezal_Standard_Plano', createExtrudedProfile(profile, -bodyHalfWidth, bodyHalfWidth), headrailMaterial, 'HomeEasy_Standard_Independent_Body');
  replaceNodeWithGeometry(parsed, 'Tapa_Lateral_Izq', createExtrudedProfile(profile, -outerHalfWidth, -bodyHalfWidth, 'left'), capMaterial, 'HomeEasy_Standard_Left_EndCap');
  replaceNodeWithGeometry(parsed, 'Tapa_Lateral_Der', createExtrudedProfile(profile, bodyHalfWidth, outerHalfWidth, 'right'), capMaterial, 'HomeEasy_Standard_Right_EndCap');
  return {
    bodyHalfWidth,
    visibleOpenFaces: 0,
    intentionalOpenInterfaces: ['body-left-cap-mating-plane', 'body-right-cap-mating-plane'],
    externalEnvelopeM: [railWidth, systemHeight, systemDepth],
    backPlaneZ: 0,
  };
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

function filterIndexedTriangles(parsed, nodeName, keepTriangle) {
  const {primitive} = primitiveForNode(parsed, nodeName);
  if (primitive.indices === undefined) throw new Error(`La malla ${nodeName} debe tener índices para sanear interfaces.`);
  if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error(`La malla ${nodeName} no usa triángulos.`);
  const position = accessorInfo(parsed, primitive.attributes.POSITION), indices = accessorInfo(parsed, primitive.indices);
  let writeAt = 0;
  for (let readAt = 0; readAt < indices.accessor.count; readAt += 3) {
    const ids = [readIndex(parsed, indices, readAt), readIndex(parsed, indices, readAt + 1), readIndex(parsed, indices, readAt + 2)];
    const points = ids.map(index => readFloatVector(parsed, position, index, 3));
    if (!keepTriangle(points, ids)) continue;
    for (let offset = 0; offset < 3; offset++) writeIndex(parsed, indices, writeAt + offset, ids[offset]);
    writeAt += 3;
  }
  const removed = (indices.accessor.count - writeAt) / 3;
  indices.accessor.count = writeAt;
  return removed;
}

function removePlanarInterface(parsed, nodeName, axis, coordinate, tolerance = 2e-6) {
  return filterIndexedTriangles(parsed, nodeName, points => !points.every(point => Math.abs(point[axis] - coordinate) <= tolerance));
}

function assignRigidMaterial(parsed, nodeNames, definition) {
  const materialIndex = parsed.json.materials.length;
  parsed.json.materials.push({
    name: definition.name,
    pbrMetallicRoughness: {
      baseColorFactor: definition.baseColorFactor,
      metallicFactor: definition.metallicFactor,
      roughnessFactor: definition.roughnessFactor,
    },
    doubleSided: false,
  });
  for (const name of nodeNames) {
    const node = parsed.json.nodes.find(item => item.name === name);
    if (node?.mesh === undefined) continue;
    for (const primitive of parsed.json.meshes[node.mesh].primitives || []) primitive.material = materialIndex;
  }
  return materialIndex;
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

function pngHeader(bytes,label){
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<33||signature.some((value,index)=>bytes[index]!==value))throw new Error(`${label} no es PNG.`);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {width:view.getUint32(16,false),height:view.getUint32(20,false),bitDepth:bytes[24],colorType:bytes[25],interlace:bytes[28]};
}

async function alphaMetrics(bytes,alphaCutoff){
  const header=pngHeader(bytes,'rgba-repeat.png');
  if(header.bitDepth!==8||header.colorType!==6)throw new Error('rgba-repeat.png debe ser PNG RGBA de 8 bits.');
  const blob=new Blob([bytes],{type:'image/png'}),userAgent=typeof navigator!=='undefined'?navigator.userAgent:'',isSafari=/AppleWebKit/i.test(userAgent)&&!/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Android)/i.test(userAgent);let image,release=()=>{};
  if(typeof createImageBitmap==='function'&&!isSafari)image=await createImageBitmap(blob);
  else if(typeof Image!=='undefined'&&typeof URL!=='undefined'){
    const objectUrl=URL.createObjectURL(blob);image=await new Promise((resolve,reject)=>{const candidate=new Image();candidate.onload=()=>resolve(candidate);candidate.onerror=()=>reject(new Error('Safari no pudo decodificar rgba-repeat.png.'));candidate.src=objectUrl;});release=()=>URL.revokeObjectURL(objectUrl);
  }else throw new Error('El runtime debe ofrecer createImageBitmap o Image para comprobar el Alpha del fabric pack.');
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight,canvas=!isSafari&&typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(width,height):(typeof document!=='undefined'?document.createElement('canvas'):null);
  if(!canvas)throw new Error('El runtime debe ofrecer OffscreenCanvas o HTMLCanvasElement.');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('No se pudo crear el contexto 2D para validar Alpha.');
  context.drawImage(image,0,0);if(typeof image.close==='function')image.close();release();const data=context.getImageData(0,0,width,height).data,threshold=Math.round(alphaCutoff*255);
  let transparent=0,opaque=0,minimum=255,maximum=0;
  for(let index=3;index<data.length;index+=4){const value=data[index];minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);if(value<threshold)transparent++;if(value>=230)opaque++;}
  const pixels=data.length/4,metrics={minimum,maximum,transparentPixels:transparent,opaquePixels:opaque,transparentFraction:transparent/pixels,opaqueFraction:opaque/pixels};
  if(!transparent||!opaque)throw new Error('rgba-repeat.png no contiene Alpha útil con zonas transparentes y opacas.');
  return {...metrics,width:header.width,height:header.height,colorType:header.colorType};
}

function textileMaterial(parsed){
  const index=parsed.json.materials.findIndex(material=>material.name==='SHEER_FABRIC');
  if(index<0)throw new Error('El master no contiene el slot textil SHEER_FABRIC.');
  const layerNames=['Tela_Frontal','Tela_Posterior'],layers=layerNames.map(name=>primitiveForNode(parsed,name).primitive);
  if(layers.some(primitive=>primitive.material!==index))throw new Error('Frente y fondo deben compartir exactamente el material SHEER_FABRIC.');
  const textilePrimitives=(parsed.json.meshes||[]).flatMap(mesh=>mesh.primitives||[]).filter(primitive=>primitive.material===index);
  if(!textilePrimitives.length||textilePrimitives.some(primitive=>!Number.isInteger(primitive.attributes?.TANGENT)))throw new Error('Las primitivas textiles deben conservar tangentes válidas.');
  return {index,material:parsed.json.materials[index],textilePrimitives};
}

function appendFabricPack(parsed,pack,alpha){
  pngHeader(pack.normal,'normal.png');pngHeader(pack.roughness,'roughness.png');
  const slot=textileMaterial(parsed),baseBin=parsed.outputBin||new Uint8Array(parsed.arrayBuffer,parsed.binOffset,parsed.binLength),images=[
    {name:`${pack.profile.id} · RGBA fundamental repeat`,bytes:pack.rgba},
    {name:`${pack.profile.id} · Normal`,bytes:pack.normal},
    {name:`${pack.profile.id} · Roughness`,bytes:pack.roughness},
  ],parts=[baseBin],views=[];let offset=baseBin.length;
  parsed.json.bufferViews||=[];
  for(const image of images){const aligned=Math.ceil(offset/4)*4,padding=aligned-offset;if(padding)parts.push(new Uint8Array(padding));offset=aligned;views.push(parsed.json.bufferViews.length);parsed.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:image.bytes.byteLength});parts.push(image.bytes);offset+=image.bytes.byteLength;}
  const joined=new Uint8Array(offset);let cursor=0;for(const part of parts){joined.set(part,cursor);cursor+=part.byteLength;}parsed.outputBin=joined;parsed.json.buffers[0].byteLength=joined.byteLength;
  const sampler=(parsed.json.samplers||=[]).length;parsed.json.samplers.push({magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497});
  const firstImage=(parsed.json.images||=[]).length;parsed.json.images.push(...images.map((image,index)=>({name:image.name,bufferView:views[index],mimeType:'image/png'})));
  const firstTexture=(parsed.json.textures||=[]).length;parsed.json.textures.push(...images.map((_,index)=>({sampler,source:firstImage+index})));
  const material=slot.material,pbr=material.pbrMetallicRoughness||={};pbr.baseColorTexture={index:firstTexture,texCoord:0};pbr.metallicRoughnessTexture={index:firstTexture+2,texCoord:0};pbr.baseColorFactor=[1,1,1,1];material.normalTexture={index:firstTexture+1,texCoord:0,scale:material.normalTexture?.scale??0.38};material.alphaMode='MASK';material.alphaCutoff=Number.isFinite(material.alphaCutoff)?material.alphaCutoff:0.4;material.doubleSided=true;
  material.extras={...(material.extras||{}),slot:'SHEER_FABRIC',fabricPackId:pack.profile.id,materialSharedByFrontAndRear:true,rgbaFundamentalRepeat:true,repeatWidthM:pack.profile.repeatWidthM,repeatHeightM:pack.profile.repeatHeightM,segments:pack.profile.segments,alphaMetrics:alpha,normalBoundOnlyWithTangents:true,geometryModifiedByMaterialPack:false,evidence:pack.evidence.id};
  return slot;
}

function visitTextureInfos(value,callback){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)visitTextureInfos(item,callback);return;}
  for(const [key,item] of Object.entries(value)){
    if(key.endsWith('Texture')&&item&&typeof item==='object'&&Number.isInteger(item.index))callback(item);
    visitTextureInfos(item,callback);
  }
}

function cloneJson(value){return JSON.parse(JSON.stringify(value));}

function remapBufferViewReferences(value,remap){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)remapBufferViewReferences(item,remap);return;}
  for(const [key,item] of Object.entries(value)){
    if(key==='bufferView'&&Number.isInteger(item)){
      if(!remap.has(item))throw new Error(`bufferView ${item} quedó referenciado pero no fue conservado.`);
      value[key]=remap.get(item);
    }else remapBufferViewReferences(item,remap);
  }
}

function compactGLBResources(parsed){
  const before={bytes:(parsed.outputBin||new Uint8Array(parsed.arrayBuffer,parsed.binOffset,parsed.binLength)).byteLength,images:(parsed.json.images||[]).length,textures:(parsed.json.textures||[]).length,samplers:(parsed.json.samplers||[]).length,bufferViews:(parsed.json.bufferViews||[]).length};
  const textureRefs=[];visitTextureInfos(parsed.json.materials||[],info=>textureRefs.push(info));
  const liveTextures=[...new Set(textureRefs.map(info=>info.index))].sort((a,b)=>a-b),textureMap=new Map(liveTextures.map((old,index)=>[old,index]));
  for(const info of textureRefs)info.index=textureMap.get(info.index);
  const oldTextures=parsed.json.textures||[],keptTextures=liveTextures.map(index=>cloneJson(oldTextures[index]));
  const liveImages=[...new Set(keptTextures.map(texture=>texture.source).filter(Number.isInteger))].sort((a,b)=>a-b),imageMap=new Map(liveImages.map((old,index)=>[old,index]));
  const liveSamplers=[...new Set(keptTextures.map(texture=>texture.sampler).filter(Number.isInteger))].sort((a,b)=>a-b),samplerMap=new Map(liveSamplers.map((old,index)=>[old,index]));
  for(const texture of keptTextures){if(Number.isInteger(texture.source))texture.source=imageMap.get(texture.source);if(Number.isInteger(texture.sampler))texture.sampler=samplerMap.get(texture.sampler);}
  parsed.json.textures=keptTextures;parsed.json.images=liveImages.map(index=>cloneJson((parsed.json.images||[])[index]));parsed.json.samplers=liveSamplers.map(index=>cloneJson((parsed.json.samplers||[])[index]));

  const liveViews=new Set();
  const findViews=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)findViews(item);return;}for(const [key,item] of Object.entries(value)){if(key==='bufferView'&&Number.isInteger(item))liveViews.add(item);else if(key!=='bufferViews')findViews(item);}};
  findViews(parsed.json);
  const orderedViews=[...liveViews].sort((a,b)=>a-b),viewMap=new Map(orderedViews.map((old,index)=>[old,index])),source=parsed.outputBin||new Uint8Array(parsed.arrayBuffer,parsed.binOffset,parsed.binLength),parts=[],nextViews=[];let offset=0;
  for(const oldIndex of orderedViews){const original=parsed.json.bufferViews[oldIndex];if(!original||Number(original.buffer||0)!==0)throw new Error(`bufferView ${oldIndex} no pertenece al buffer 0.`);const aligned=Math.ceil(offset/4)*4;if(aligned>offset)parts.push({offset,bytes:new Uint8Array(aligned-offset)});offset=aligned;const bytes=source.slice(Number(original.byteOffset||0),Number(original.byteOffset||0)+Number(original.byteLength));parts.push({offset,bytes});nextViews.push({...cloneJson(original),buffer:0,byteOffset:offset});offset+=bytes.byteLength;}
  const compacted=new Uint8Array(offset);for(const part of parts)compacted.set(part.bytes,part.offset);
  remapBufferViewReferences(parsed.json,viewMap);parsed.json.bufferViews=nextViews;parsed.outputBin=compacted;parsed.json.buffers[0].byteLength=compacted.byteLength;
  const after={bytes:compacted.byteLength,images:parsed.json.images.length,textures:parsed.json.textures.length,samplers:parsed.json.samplers.length,bufferViews:parsed.json.bufferViews.length};
  return {before,after,removed:{bytes:before.bytes-after.bytes,images:before.images-after.images,textures:before.textures-after.textures,samplers:before.samplers-after.samplers,bufferViews:before.bufferViews-after.bufferViews}};
}

function packGLB(parsed) {
  const bin=parsed.outputBin||new Uint8Array(parsed.arrayBuffer,parsed.binOffset,parsed.binLength),jsonRaw = new TextEncoder().encode(JSON.stringify(parsed.json)), jsonLength = Math.ceil(jsonRaw.length / 4) * 4, binLength = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength, output = new ArrayBuffer(total), view = new DataView(output), bytes = new Uint8Array(output);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true); view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(jsonRaw, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true); view.setUint32(binHeader + 4, 0x004e4942, true); bytes.set(bin, binHeader + 8);
  return output;
}

export async function applySheerFabricPack(masterGlb, fabricPack, input = {}) {
  const [{config,system,matchedConfiguration},pack]=await Promise.all([Promise.resolve(normalizeConfig(input)),resolveFabricPack(fabricPack)]);
  const profile=validateBandProfile(pack.profile),masterBytes=await loadBytes(masterGlb,'sheer-master-white.glb'),masterBuffer=masterBytes.buffer.slice(masterBytes.byteOffset,masterBytes.byteOffset+masterBytes.byteLength),parsed=parseGLB(masterBuffer);
  const offsetM=Number(profile.rearLayerOffsetsM[config.bandState]),state={...SHEER_STATES[config.bandState],displacementM:offsetM,phase:offsetM/Number(profile.repeatHeightM)};
  const slot=textileMaterial(parsed),alpha=await alphaMetrics(pack.rgba,slot.material.alphaCutoff??0.4);
  const width = config.fabricWidthM, height = config.fabricHeightM;
  const dw = width - BASE.fabricWidth, systemHeight = system.geometry.sectionM[0], systemDepth = system.geometry.sectionM[1];
  const fabricTop = BASE.fabricBottom + height, railWidth = width + BASE.headrailOverhang;
  const baseHeadrailBottom = BASE.fabricBottom + BASE.fabricHeight;
  const profilePoint = (y, z) => {
    const normalized = [(y - baseHeadrailBottom) / BASE.headrailHeight, z / BASE.headrailDepth];
    const shaped = normalized.map(clamp01);
    return [fabricTop + shaped[0] * systemHeight, shaped[1] * systemDepth];
  };
  const headrailNames = ['Cabezal_Binovo_Plano'];
  const endPieceNames = ['Tapa_Lateral_Izq', 'Tapa_Lateral_Der'];
  const capThickness = 0.008, bodyHalfWidth = railWidth / 2 - capThickness;
  const railScaleX = bodyHalfWidth / ((BASE.fabricWidth + BASE.headrailOverhang) / 2);
  if (system.id !== 'standard') {
    mutateIfPresent(parsed, headrailNames, ([x, y, z]) => { const yz = profilePoint(y, z); return [x * railScaleX, yz[0], yz[1]]; });
    mutateIfPresent(parsed, endPieceNames, ([x, y, z]) => { const yz = profilePoint(y, z); return [signOffset(x, dw), yz[0], yz[1]]; });
  }
  mutateIfPresent(parsed, ['Soporte_Pared_Izq', 'Soporte_Pared_Der'], ([x, y, z]) => [signOffset(x, dw), fabricTop + (y - (BASE.fabricBottom + BASE.fabricHeight)) * (systemHeight / BASE.headrailHeight), z * (systemDepth / BASE.headrailDepth)]);
  if (system.id !== 'standard') {
    for (const name of headrailNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, [railScaleX, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth]);
    for (const name of endPieceNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, [1, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth]);
  }
  removeSceneNodes(parsed, ['Fascia_Frontal', 'Junta_Inferior_Cabezal', 'Soporte_Pared_Izq', 'Soporte_Pared_Der']);
  const removedInterfaces = system.id === 'standard' ? null : {
    railLeft: removePlanarInterface(parsed, 'Cabezal_Binovo_Plano', 0, -bodyHalfWidth),
    railRight: removePlanarInterface(parsed, 'Cabezal_Binovo_Plano', 0, bodyHalfWidth),
    capLeft: removePlanarInterface(parsed, 'Tapa_Lateral_Izq', 0, -bodyHalfWidth),
    capRight: removePlanarInterface(parsed, 'Tapa_Lateral_Der', 0, bodyHalfWidth),
  };
  if (system.id !== 'standard') for (const name of [...headrailNames, ...endPieceNames]) recomputeMeshFrame(parsed, name);
  const headrailMaterial = assignRigidMaterial(parsed, headrailNames, {name: 'HomeEasy_Headrail_Matte_V23', baseColorFactor: [0.84, 0.84, 0.80, 1], metallicFactor: 0.08, roughnessFactor: 0.62});
  const capMaterial = assignRigidMaterial(parsed, endPieceNames, {name: 'HomeEasy_EndCaps_Matte_V23', baseColorFactor: [0.72, 0.69, 0.62, 1], metallicFactor: 0, roughnessFactor: 0.68});
  renameNode(parsed, 'Cabezal_Binovo_Plano', `Cabezal_${system.label.replace(/\s+/g, '_')}_Plano`, {
    system: system.label,
    sectionM: system.geometry.sectionM,
    sectionDimensionsExact: true,
    profileShapeExact: false,
    profileShapeSource: system.id === 'standard' ? '581_FichaSheerElegance.pdf pp.2-3' : '581_FichaSheerElegance.pdf p.2',
    profileReconstruction: system.id === 'standard' ? 'independent-standard-envelope-v1' : 'visual-binovo-profile-v2-3',
    ...(system.id === 'standard' ? {sourceGeometry: 'independent-parametric-standard'} : {}),
    flickerCorrection: {coplanarOverlaysRemoved: ['Fascia_Frontal', 'Junta_Inferior_Cabezal'], hiddenSupportsRemoved: ['Soporte_Pared_Izq', 'Soporte_Pared_Der'], openInterfaces: removedInterfaces, capThicknessM: capThickness},
  });

  const tubeDiameter = matchedConfiguration.tubeDiameterMm / 1000, tubeScale = tubeDiameter / BASE.upperTubeDiameter;
  const baseTubeCenterY = BASE.fabricBottom + BASE.fabricHeight + BASE.headrailHeight - 0.069, baseTubeCenterZ = 0.057;
  const tubeCenterY = fabricTop + systemHeight * 0.31, tubeCenterZ = systemDepth * 0.57;
  mutateIfPresent(parsed, ['Tubo_Enrollador'], ([x, y, z]) => [x * ((width - 0.052) / (BASE.fabricWidth - 0.052)), tubeCenterY + (y - baseTubeCenterY) * tubeScale, tubeCenterZ + (z - baseTubeCenterZ) * tubeScale]);

  const rearZ = systemDepth - 0.046, frontZ = rearZ + BASE.layerSeparation;
  const textileY = y => BASE.fabricBottom + ((y - BASE.fabricBottom) / BASE.fabricHeight) * height;
  mutateIfPresent(parsed, ['Tela_Posterior'], ([x, y]) => [x * (width / BASE.fabricWidth), textileY(y), rearZ]);
  mutateIfPresent(parsed, ['Tela_Frontal'], ([x, y]) => [x * (width / BASE.fabricWidth), textileY(y), frontZ]);
  mutateIfPresent(parsed, ['Canto_Textil_Izq', 'Canto_Textil_Der'], ([x, y]) => [signOffset(x, dw), textileY(y), (rearZ + frontZ) / 2]);
  const lowerZShift = (rearZ + frontZ) / 2 - 0.0635;
  mutateIfPresent(parsed, ['Tela_Retorno_Inferior'], ([x, y, z]) => [x * (width / BASE.fabricWidth), y, z + lowerZShift]);
  mutateIfPresent(parsed, ['Rodillo_Retorno_Inferior'], ([x, y, z]) => [x * ((width - 0.030) / (BASE.fabricWidth - 0.030)), y, z + lowerZShift]);
  mutateIfPresent(parsed, ['Perfil_Inferior'], ([x, y, z]) => [x * ((width + BASE.lowerProfileOverhang) / (BASE.fabricWidth + BASE.lowerProfileOverhang)), y, z + lowerZShift]);
  mutateIfPresent(parsed, ['Inserto_Perfil_Inferior'], ([x, y, z]) => [x * ((width - 0.012) / (BASE.fabricWidth - 0.012)), y, z + lowerZShift]);

  const frontUv=accessorInfo(parsed,primitiveForNode(parsed,'Tela_Frontal').primitive.attributes.TEXCOORD_0),oldU=Math.abs(Number(frontUv.accessor.max?.[0])-Number(frontUv.accessor.min?.[0])),newU=width/Number(profile.repeatWidthM);
  if(!(oldU>0))throw new Error('El master no declara un rango UV horizontal válido.');
  const oldV = BASE.fabricHeight / BASE.period, newV = height / Number(profile.repeatHeightM);
  mutateUV(parsed, 'Tela_Frontal', ([u, v]) => [u / oldU * newU, (v / oldV) * newV]);
  mutateUV(parsed, 'Tela_Posterior', ([u, v]) => [u / oldU * newU, (v / oldV) * newV - state.phase]);

  const controlSign = config.controlSide === 'left' ? -1 : 1;
  const baseLimits = chainLimits(BASE.fabricHeight, BASE.headrailHeight), nextLimits = chainLimits(height, systemHeight);
  const manualX = x => controlSign * (Math.abs(x) + dw / 2);
  const mapManual = ([x, y, z]) => [manualX(x), fabricTop + (y - (BASE.fabricBottom + BASE.fabricHeight)) * (systemHeight / BASE.headrailHeight), z * (systemDepth / BASE.headrailDepth)];
  const mechanismNames = ['Mecanismo_Nylon_Anillo_1', 'Mecanismo_Nylon_Anillo_2', 'Mecanismo_Nylon_Anillo_3', 'Mecanismo_Nylon_Cuerpo', 'Salida_Cadena'];
  const threadNames = ['Hilo_Cadena_Izq', 'Hilo_Cadena_Der', 'Hilo_Cadena_Curva_Inferior'];
  const manualLinearScale = [controlSign, systemHeight / BASE.headrailHeight, systemDepth / BASE.headrailDepth];
  mutateIfPresent(parsed, mechanismNames, mapManual);
  for (const name of mechanismNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, manualLinearScale);

  mutateIfPresent(parsed, ['Hilo_Cadena_Izq', 'Hilo_Cadena_Der'], ([x, y]) => [manualX(x), nextLimits.bottom + ((y - baseLimits.bottom) / (baseLimits.top - baseLimits.bottom)) * (nextLimits.top - nextLimits.bottom), systemDepth - 0.013]);
  mutateIfPresent(parsed, ['Hilo_Cadena_Curva_Inferior'], ([x, y]) => [manualX(x), y + nextLimits.bottom - baseLimits.bottom, systemDepth - 0.013]);
  for (const name of threadNames) if (parsed.json.nodes.some(node => node.name === name)) correctLinearMeshFrame(parsed, name, manualLinearScale);
  repositionChainBeads(parsed, width, height, systemDepth, systemHeight, config.controlSide);
  for (const name of ['Mecanismo_Nylon_Anillo_1', 'Mecanismo_Nylon_Anillo_2', 'Mecanismo_Nylon_Anillo_3', 'Mecanismo_Nylon_Cuerpo', 'Salida_Cadena']) {
    const node = parsed.json.nodes.find(item => item.name === name); if (node) node.extras = {...node.extras, controlSide: config.controlSide, mechanism: matchedConfiguration.mechanism, tubeDiameterMm: matchedConfiguration.tubeDiameterMm};
  }

  let standardGeometry = null;
  if (system.id === 'standard') {
    standardGeometry = installIndependentStandardHeadrail(parsed, {railWidth, fabricTop, systemHeight, systemDepth, capThickness, headrailMaterial, capMaterial});
    const node = parsed.json.nodes.find(item => item.name === 'Cabezal_Standard_Plano');
    if (node) node.extras = {...node.extras, ...standardGeometry, profileShapeExact: false, sectionDimensionsExact: true};
  }

  const sceneIndex = parsed.json.scene || 0, sceneExtras = {},opaqueHeight=profile.segments.filter(segment=>segment.type==='opaque').reduce((sum,segment)=>sum+Number(segment.heightM),0),sheerHeight=profile.segments.filter(segment=>segment.type==='sheer').reduce((sum,segment)=>sum+Number(segment.heightM),0);
  Object.assign(sceneExtras, {
    homeeasyAsset: 'HomeEasy AR Sheer Master V1', sourceGeometry: 'GOLDEN V2.3 White', product: 'Sheer Elegance',
    fabricPackId: profile.id, fabricPackLabel: profile.label, commercialColorName: profile.commercialColorClaim ? profile.label : null, materialSlot: 'SHEER_FABRIC', commercialColorClaim: Boolean(profile.commercialColorClaim),
    fabricWidthM: width, fabricHeightM: height, physicalVisibleFabricHeightM: height, physicalTotalFabricLengthM: 2 * height + 0.20,
    headrailSystem: system.label, controlSide: config.controlSide, bandState: config.bandState,
    matchedConfigurationId: matchedConfiguration.id,
    state: state.extra, stateUi: config.bandState, rear_phase_cycles: state.phase, rear_material_displacement_m: state.displacementM,
    physical_repeat_m: profile.repeatHeightM, physical_repeat_width_m: profile.repeatWidthM, opaque_band_m: opaqueHeight, transparent_band_m: sheerHeight, bandSegments: profile.segments, layer_separation_m: BASE.layerSeparation,
    headrail: {system: system.label, sectionM: system.geometry.sectionM, sectionDimensionsExact: true, profileShapeExact: false, profileShapeSource: system.id === 'standard' ? '581_FichaSheerElegance.pdf pp.2-3' : '581_FichaSheerElegance.pdf p.2', architecture: system.geometry.architecture, ...(system.id === 'standard' ? {geometrySource: 'independent-parametric-standard', standardGeometry} : {}), longitudinalOverhang: {valueM: BASE.headrailOverhang, approximate: true}},
    architectureEvidence: {goldenAssetSha256: '8c283be06029688b5ae7ba9a7afcb667cb285fe429a364ea457ccdab98f37b33', bandProfileEvidence: pack.evidence.id},
    approximateDimensions: {
      lowerProfile: {sectionM: [0.043, 0.046], overhangM: BASE.lowerProfileOverhang, approximate: true},
      chain: {beadDiameterM: BASE.beadDiameter, pitchM: BASE.beadPitch, cordDiameterM: 0.0017, approximate: true},
      headrailLongitudinalOverhang: {valueM: BASE.headrailOverhang, approximate: true}, mechanismHousing: {approximate: true},
    },
    parametric_runtime: 'applySheerFabricPack(masterGlb, fabricPack, config)',
  });
  parsed.json.scenes[sceneIndex].extras = sceneExtras;
  const rearNode = parsed.json.nodes.find(node => node.name === 'Tela_Posterior');
  if (rearNode) rearNode.extras = {homeeasy_role: 'rear_textile_layer', materialSlot: 'SHEER_FABRIC', phase_cycles: state.phase, rearLayerOffsetM: state.displacementM, physical_repeat_m: profile.repeatHeightM, physical_repeat_width_m: profile.repeatWidthM, segments: profile.segments, patternScalePhysical: true};
  const frontNode = parsed.json.nodes.find(node => node.name === 'Tela_Frontal');
  if (frontNode) frontNode.extras = {homeeasy_role: 'front_textile_layer', materialSlot: 'SHEER_FABRIC', phase_cycles: 0, rearLayerOffsetM: 0, physical_repeat_m: profile.repeatHeightM, physical_repeat_width_m: profile.repeatWidthM, segments: profile.segments, patternScalePhysical: true};
  const appliedSlot=appendFabricPack(parsed,pack,alpha),compaction=compactGLBResources(parsed);parsed.json.scenes[sceneIndex].extras.compaction=compaction;const bytes=new Uint8Array(packGLB(parsed));
  return {bytes,blob:new Blob([bytes],{type:'model/gltf-binary'}),filename:`sheer-master-${profile.id}-${config.headrailSystem}-${config.bandState}.glb`,config,profile,alphaMetrics:alpha,compaction,textileMaterialIndex:appliedSlot.index};
}
