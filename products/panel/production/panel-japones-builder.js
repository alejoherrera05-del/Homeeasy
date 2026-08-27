const PAD4 = (value) => (value + 3) & ~3;
const UTF8 = new TextEncoder();
const DIRECTIONS = new Set(["left", "right", "center", "ends"]);
const POSITIONS = new Set(["closed", "partial", "collected"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Se esperaba un ArrayBuffer o Uint8Array.");
}

async function fetchBytes(input, label) {
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return asBytes(input);
  const response = await fetch(input);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchJson(input, label) {
  if (typeof input === "object" && input !== null && !(input instanceof URL)) return clone(input);
  const response = await fetch(input);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

export function parsePanelGlb(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 28) throw new Error("GLB incompleto.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Firma GLB inválida.");
  if (view.getUint32(4, true) !== 2) throw new Error("El master debe ser glTF 2.0.");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
  const binHeader = 20 + jsonLength;
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942) throw new Error("Chunk BIN ausente.");
  const binLength = view.getUint32(binHeader, true);
  return {bytes, json, bin: bytes.slice(binHeader + 8, binHeader + 8 + binLength)};
}

function packGlb(json, bin) {
  const jsonBytes = UTF8.encode(JSON.stringify(json));
  const jsonLength = PAD4(jsonBytes.byteLength);
  const binLength = PAD4(bin.byteLength);
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(jsonBytes, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  output.set(bin, binHeader + 8);
  return output;
}

function appendBufferView(json, parts, bytes, mimeType) {
  let offset = parts.reduce((sum, item) => PAD4(sum) + item.byteLength, 0);
  offset = PAD4(offset);
  parts.push(asBytes(bytes));
  const index = json.bufferViews.length;
  json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: bytes.byteLength});
  const imageIndex = json.images.length;
  json.images.push({bufferView: index, mimeType});
  return imageIndex;
}

function combineParts(parts) {
  let total = 0;
  for (const part of parts) total = PAD4(total) + part.byteLength;
  const output = new Uint8Array(PAD4(total));
  let offset = 0;
  for (const part of parts) {
    offset = PAD4(offset);
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  if (typeof document !== "undefined") {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("No fue posible decodificar una textura."));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error("El navegador no ofrece un decodificador de imágenes compatible.");
}

async function canvasToPng(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return new Uint8Array(await (await canvas.convertToBlob({type: "image/png"})).arrayBuffer());
  }
  return new Uint8Array(await new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("No fue posible codificar el PNG RGBA."));
      resolve(await blob.arrayBuffer());
    }, "image/png");
  }));
}

async function combineBaseColorAndAlpha(baseBytes, alphaBytes) {
  const [base, alpha] = await Promise.all([
    decodeImage(new Blob([baseBytes], {type: "image/png"})),
    decodeImage(new Blob([alphaBytes], {type: "image/png"})),
  ]);
  if (base.width !== alpha.width || base.height !== alpha.height) {
    throw new Error("Base Color y Alpha deben tener las mismas dimensiones.");
  }
  const canvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(base.width, base.height)
    : Object.assign(document.createElement("canvas"), {width: base.width, height: base.height});
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.clearRect(0, 0, base.width, base.height);
  context.drawImage(base, 0, 0);
  const rgba = context.getImageData(0, 0, base.width, base.height);
  context.clearRect(0, 0, base.width, base.height);
  context.drawImage(alpha, 0, 0);
  const mask = context.getImageData(0, 0, base.width, base.height);
  let transparent = 0;
  let opaque = 0;
  for (let index = 0; index < rgba.data.length; index += 4) {
    const value = Math.round((mask.data[index] + mask.data[index + 1] + mask.data[index + 2]) / 3);
    rgba.data[index + 3] = value;
    if (value < 128) transparent += 1;
    else opaque += 1;
  }
  context.putImageData(rgba, 0, 0);
  const pixels = transparent + opaque;
  return {
    bytes: await canvasToPng(canvas),
    metrics: {
      width: base.width,
      height: base.height,
      transparentPixels: transparent,
      opaquePixels: opaque,
      measuredOpenAreaPercent: (transparent / pixels) * 100,
    },
  };
}

export function normalizePanelConfiguration(input = {}) {
  const direction = DIRECTIONS.has(input.direction) ? input.direction : "left";
  const position = POSITIONS.has(input.position) ? input.position : "closed";
  return {
    widthM: Number(input.widthM),
    heightM: Number(input.heightM),
    direction,
    position,
    color: String(input.color || "white"),
    layout: input.layout ? String(input.layout) : null,
    controlSide: input.controlSide === "left" ? "left" : "right",
    qaScene: input.qaScene === "singleTelo" ? "singleTelo" : "product",
  };
}

export function availablePanelLayouts(direction, rules) {
  const entry = rules.directions[direction];
  if (!entry) return [];
  return entry.layouts.map(([ways, telos]) => ({
    layout: `${ways}:${telos}`,
    ways,
    telos,
    label: `${ways} vías · ${telos} telos`,
  }));
}

export function calculatePanelMetrics(configuration, layout, rules) {
  const config = normalizePanelConfiguration(configuration);
  const [ways, telos] = typeof layout === "string"
    ? layout.split(":").map(Number)
    : [Number(layout.ways), Number(layout.telos)];
  const {overlapM, standardDeductionM} = rules.manufacturing;
  const fabricCoverageM = config.widthM - standardDeductionM;
  const teloWidthM = (fabricCoverageM + (telos - 1) * overlapM) / telos;
  const coveredFabricWidthM = telos * teloWidthM - (telos - 1) * overlapM;
  const revealM = rules.components.collectedRevealM;
  const stacks = config.direction === "ends" ? 2 : 1;
  const telosPerStack = config.direction === "ends" ? telos / 2 : telos;
  const stackWidthM = teloWidthM + Math.max(0, telosPerStack - 1) * revealM;
  return {
    ways,
    telos,
    overlapM,
    standardDeductionM,
    teloWidthM,
    fabricCoverageM,
    coveredFabricWidthM,
    systemWidthM: coveredFabricWidthM + standardDeductionM,
    stacks,
    stackWidthM,
    collectedObstructionM: stackWidthM * stacks,
  };
}

export function recommendPanelLayout(configuration, rules) {
  const config = normalizePanelConfiguration(configuration);
  const range = rules.manufacturing.teloWidthM;
  const target = rules.recommendation.targetTeloWidthM;
  const candidates = availablePanelLayouts(config.direction, rules).map((layout) => {
    const metrics = calculatePanelMetrics(config, layout, rules);
    const withinRecommended = metrics.teloWidthM >= range.minRecommended && metrics.teloWidthM <= range.maxRecommended + (range.calculationToleranceM || 0);
    const screenOnlyException = !withinRecommended
      && rules.recommendation.screenOnlyBelowRecommendedRangeAllowed
      && metrics.teloWidthM >= rules.recommendation.screenOnlyMinimumM
      && metrics.teloWidthM < range.minRecommended;
    const valid = withinRecommended || screenOnlyException;
    const score = (screenOnlyException ? 10 : 0)
      + Math.abs(metrics.teloWidthM - target)
      + layout.ways * 0.0001
      + layout.telos * 0.00001;
    return {...layout, ...metrics, withinRecommended, screenOnlyException, valid, score};
  }).filter((candidate) => candidate.valid).sort((a, b) => a.score - b.score);
  const selected = candidates[0] || null;
  return {
    recommendationSource: rules.recommendation.recommendationSource,
    disclosure: rules.recommendation.displayDisclosure,
    direction: config.direction,
    explanation: selected ? `${selected.ways} vías y ${selected.telos} telos equilibran el ancho de telo calculado con las configuraciones válidas para ${config.direction}.` : "No existe una combinación válida para las medidas ingresadas.",
    selected,
    alternatives: candidates.slice(1),
    evaluated: availablePanelLayouts(config.direction, rules).length,
  };
}

export function validatePanelConfiguration(configuration, rules) {
  const config = normalizePanelConfiguration(configuration);
  const errors = [];
  const width = rules.manufacturing.widthM;
  const height = rules.manufacturing.heightM;
  if (!(config.widthM >= width.min && config.widthM <= width.maxSingleRailManual)) {
    errors.push(`El ancho debe estar entre ${width.min.toFixed(2)} y ${width.maxSingleRailManual.toFixed(2)} m para esta entrega de riel único manual.`);
  }
  if (!(config.heightM >= height.min && config.heightM <= height.max)) {
    errors.push(`El alto debe estar entre ${height.min.toFixed(2)} y ${height.max.toFixed(2)} m.`);
  }
  if (!rules.fabric.allowedColors.some((color) => color.id === config.color)) {
    errors.push("El color no pertenece al alcance Screen Tretto 3% aprobado.");
  }
  const recommendation = recommendPanelLayout(config, rules);
  const chosenLayout = config.layout || recommendation.selected?.layout;
  const allowed = availablePanelLayouts(config.direction, rules).find((item) => item.layout === chosenLayout);
  if (!allowed) errors.push("La combinación de vías, telos y recogida no está documentada por Pentagrama.");
  const metrics = allowed ? calculatePanelMetrics(config, allowed, rules) : null;
  if (metrics) {
    const range = rules.manufacturing.teloWidthM;
    const withinRecommended = metrics.teloWidthM >= range.minRecommended && metrics.teloWidthM <= range.maxRecommended + (range.calculationToleranceM || 0);
    const screenOnlyException = metrics.teloWidthM >= rules.recommendation.screenOnlyMinimumM
      && metrics.teloWidthM < range.minRecommended;
    if (!withinRecommended && !screenOnlyException) errors.push("El ancho calculado del telo queda fuera de las configuraciones válidas para Screen.");
  }
  return {ok: errors.length === 0, errors, config: {...config, layout: chosenLayout}, metrics, recommendation};
}

function trackIndex(index, ways, telos, direction) {
  if (direction === "right") return ways - 1 - (index % ways);
  if (direction === "center") return Math.min(ways - 1, Math.abs(index - Math.floor(telos / 2)));
  if (direction === "ends") {
    if (ways === telos) return index;
    const half = telos / 2;
    return index < half ? index : ways - 1 - (index - half);
  }
  return index % ways;
}

export function computePanelTransforms(configuration, metrics, rules) {
  const config = normalizePanelConfiguration(configuration);
  const {telos, ways, teloWidthM, overlapM, fabricCoverageM} = metrics;
  const closed = Array.from({length: telos}, (_, index) => (
    -fabricCoverageM / 2 + teloWidthM / 2 + index * (teloWidthM - overlapM)
  ));
  const reveal = rules.components.collectedRevealM;
  let collected;
  if (config.direction === "right") {
    collected = Array.from({length: telos}, (_, index) => (
      fabricCoverageM / 2 - teloWidthM / 2 - (telos - 1 - index) * reveal
    ));
  } else if (config.direction === "center") {
    const middle = (telos - 1) / 2;
    collected = Array.from({length: telos}, (_, index) => (index - middle) * reveal);
  } else if (config.direction === "ends") {
    const half = telos / 2;
    collected = Array.from({length: telos}, (_, index) => index < half
      ? -fabricCoverageM / 2 + teloWidthM / 2 + index * reveal
      : fabricCoverageM / 2 - teloWidthM / 2 - (telos - 1 - index) * reveal);
  } else {
    collected = Array.from({length: telos}, (_, index) => (
      -fabricCoverageM / 2 + teloWidthM / 2 + index * reveal
    ));
  }
  const projection = rules.positions[config.position].projection;
  const depth = rules.rail.depthM[String(ways)];
  const trackPitch = (depth - rules.components.trackClearanceM * 2) / Math.max(1, ways - 1);
  return closed.map((closedX, index) => {
    const track = trackIndex(index, ways, telos, config.direction);
    return {
      index,
      closedX,
      collectedX: collected[index],
      x: closedX + (collected[index] - closedX) * projection,
      z: -depth / 2 + rules.components.trackClearanceM + track * trackPitch,
      track,
      projection,
    };
  });
}

function materialIndex(json, name) {
  const index = (json.materials || []).findIndex((material) => material.name === name);
  if (index < 0) throw new Error(`Material master ausente: ${name}`);
  return index;
}

function componentMeshes(json) {
  const required = [
    "PANEL_RAIL_PROFILE",
    "PANEL_END_CAP_LEFT",
    "PANEL_END_CAP_RIGHT",
    "PANEL_CARRIER",
    "PANEL_HANGER",
    "PANEL_BOTTOM_WEIGHT",
    "PANEL_TELO_MASTER",
  ];
  const result = {};
  for (const name of required) {
    const node = (json.nodes || []).find((item) => item.name === name);
    if (!node || !Number.isInteger(node.mesh)) throw new Error(`Componente master ausente: ${name}`);
    result[name] = node.mesh;
  }
  const cord = (json.nodes || []).find((item) => item.name === "PANEL_MANUAL_CORD");
  const logo = (json.nodes || []).find((item) => item.name === "PANEL_HOMEEASY_DECAL");
  if (cord?.mesh !== undefined) result.PANEL_MANUAL_CORD = cord.mesh;
  if (logo?.mesh !== undefined) result.PANEL_HOMEEASY_DECAL = logo.mesh;
  return result;
}

function makeNode(name, mesh, translation, scale = [1, 1, 1], extras = undefined) {
  return {name, mesh, translation, scale, ...(extras ? {extras} : {})};
}

function buildRuntimeNodes(json, mesh, config, metrics, transforms, rules) {
  const nodes = [];
  const sceneNodes = [];
  const add = (node) => {
    const index = nodes.length;
    nodes.push(node);
    sceneNodes.push(index);
    return index;
  };
  if (config.qaScene !== "singleTelo") {
    const railDepth = rules.rail.depthM[String(metrics.ways)];
    const railY = config.heightM - rules.rail.heightM / 2;
    const pitch = (railDepth - 0.012) / Math.max(1, metrics.ways - 1);
    for (let way = 0; way < metrics.ways; way += 1) {
      const z = -railDepth / 2 + 0.006 + way * pitch;
      add(makeNode(`PANEL_RAIL_PROFILE_WAY_${way + 1}`, mesh.PANEL_RAIL_PROFILE, [0, railY, z], [config.widthM, 1, 1], {way: way + 1, ways: metrics.ways}));
    }
    add(makeNode("PANEL_END_CAP_LEFT", mesh.PANEL_END_CAP_LEFT, [-config.widthM / 2 - 0.004, railY, 0], [1, 1, railDepth / 0.1]));
    add(makeNode("PANEL_END_CAP_RIGHT", mesh.PANEL_END_CAP_RIGHT, [config.widthM / 2 + 0.004, railY, 0], [1, 1, railDepth / 0.1]));
    if (mesh.PANEL_HOMEEASY_DECAL !== undefined) {
      add(makeNode("PANEL_HOMEEASY_DECAL", mesh.PANEL_HOMEEASY_DECAL, [0, railY, railDepth / 2 + 0.007], [0.032, 0.032, 0.032], {branding: "HomeEasy", treatment: "official image decal"}));
    }
    if (mesh.PANEL_MANUAL_CORD !== undefined) {
      const side = config.controlSide === "left" ? -1 : 1;
      const cordX = side * (config.widthM / 2 - 0.025);
      const length = Math.max(0.45, Math.min(1.25, config.heightM * 0.52));
      add(makeNode("PANEL_MANUAL_CORD_FRONT", mesh.PANEL_MANUAL_CORD, [cordX, railY - length / 2 - 0.025, -railDepth / 2 - 0.012], [1, length, 1], {controlSide: config.controlSide}));
      add(makeNode("PANEL_MANUAL_CORD_REAR", mesh.PANEL_MANUAL_CORD, [cordX + side * 0.014, railY - length / 2 - 0.025, -railDepth / 2 - 0.012], [1, length, 1], {controlSide: config.controlSide}));
    }
  }
  const fabricTop = config.heightM - rules.rail.heightM - rules.components.carrierHeightM - rules.components.hangerDropM;
  const fabricBottom = rules.components.bottomWeightHeightM;
  const fabricHeight = fabricTop - fabricBottom;
  const selectedTransforms = config.qaScene === "singleTelo"
    ? [{index: 0, x: 0, z: 0, track: 0, projection: 0}]
    : transforms;
  for (const transform of selectedTransforms) {
    const number = transform.index + 1;
    const x = transform.x;
    const z = transform.z;
    const panelWidth = config.qaScene === "singleTelo" ? Math.min(0.8, metrics.teloWidthM) : metrics.teloWidthM;
    add(makeNode(`PANEL_CARRIER_${number}`, mesh.PANEL_CARRIER, [x, fabricTop + rules.components.hangerDropM + 0.004, z], [1, 1, 1], {track: transform.track}));
    add(makeNode(`PANEL_HANGER_${number}`, mesh.PANEL_HANGER, [x, fabricTop + 0.006, z], [Math.max(0.08, panelWidth - 0.014), 1, 1], {presentation: "VELCRO_STANDARD"}));
    add(makeNode(`PANEL_TELO_${number}`, mesh.PANEL_TELO_MASTER, [x, fabricBottom + fabricHeight / 2, z], [panelWidth, fabricHeight, 1], {panelIndex: number, track: transform.track, physicalWidthM: panelWidth, physicalHeightM: fabricHeight}));
    add(makeNode(`PANEL_BOTTOM_WEIGHT_${number}`, mesh.PANEL_BOTTOM_WEIGHT, [x, rules.components.bottomWeightHeightM / 2, z], [Math.max(0.08, panelWidth - 0.012), 1, 1], {profile: "Standard Out", dimensionsExact: false}));
  }
  json.nodes = nodes;
  json.scenes = [{name: "Panel Japonés · Screen Tretto 3% · HomeEasy", nodes: sceneNodes, extras: {config, metrics}}];
  json.scene = 0;
  return {fabricHeightM: fabricHeight, textileWidthM: config.qaScene === "singleTelo" ? Math.min(0.8, metrics.teloWidthM) : metrics.teloWidthM};
}

async function geometryHash(parsed) {
  const digest = await crypto.subtle.digest("SHA-256", parsed.bin);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function loadPanelLayoutRules(url = new URL("./data/panel-layout-rules.json", import.meta.url)) {
  return fetchJson(url, "Reglas Panel Japonés");
}

export async function buildPanelJaponesGlb(masterGlb, fabricPackBase, configuration, rulesInput = undefined) {
  const rules = rulesInput || await loadPanelLayoutRules();
  const validation = validatePanelConfiguration(configuration, rules);
  if (!validation.ok) throw new Error(validation.errors.join(" "));
  const config = validation.config;
  const color = rules.fabric.allowedColors.find((item) => item.id === config.color);
  const pack = fabricPackBase instanceof URL ? fabricPackBase : new URL(String(fabricPackBase), location.href);
  const shared = new URL("../../shared/", pack);
  const [masterBytes, baseColor, alpha, normal, roughness, pattern, evidence] = await Promise.all([
    fetchBytes(masterGlb, "Master Panel Japonés"),
    fetchBytes(new URL("base-color.png", pack), "Base Color Tretto"),
    fetchBytes(new URL("alpha.png", shared), "Alpha Tretto"),
    fetchBytes(new URL("normal.png", shared), "Normal Tretto"),
    fetchBytes(new URL("roughness.png", shared), "Roughness Tretto"),
    fetchJson(new URL("physical-pattern.json", shared), "Patrón físico Tretto"),
    fetchJson(new URL("source-evidence.json", pack), "Evidencia Tretto"),
  ]);
  if (evidence.colorId !== config.color || evidence.productCode !== color.productCode) {
    throw new Error("El fabric pack no coincide con el color comercial seleccionado.");
  }
  const rgba = await combineBaseColorAndAlpha(baseColor, alpha);
  if (Math.abs(rgba.metrics.measuredOpenAreaPercent - pattern.officialOpennessPercent) > 0.5) {
    throw new Error("La apertura medida excede la tolerancia de ±0,5 puntos porcentuales.");
  }
  const parsed = parsePanelGlb(masterBytes);
  const json = clone(parsed.json);
  json.bufferViews ||= [];
  json.images ||= [];
  json.textures ||= [];
  json.samplers ||= [];
  const mesh = componentMeshes(json);
  const textileMaterial = materialIndex(json, "PANEL_FABRIC");
  const parts = [parsed.bin];
  const rgbaImage = appendBufferView(json, parts, rgba.bytes, "image/png");
  const normalImage = appendBufferView(json, parts, normal, "image/png");
  const roughnessImage = appendBufferView(json, parts, roughness, "image/png");
  const sampler = json.samplers.length;
  json.samplers.push({magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497});
  const baseTexture = json.textures.length;
  json.textures.push({name: `TRETTO_3_${config.color}_RGBA`, sampler, source: rgbaImage});
  const normalTexture = json.textures.length;
  json.textures.push({name: "TRETTO_3_SHARED_NORMAL", sampler, source: normalImage});
  const roughnessTexture = json.textures.length;
  json.textures.push({name: "TRETTO_3_SHARED_ROUGHNESS", sampler, source: roughnessImage});
  const transforms = computePanelTransforms(config, validation.metrics, rules);
  const geometry = buildRuntimeNodes(json, mesh, config, validation.metrics, transforms, rules);
  const textureScale = [geometry.textileWidthM / pattern.repeatWidthM, geometry.fabricHeightM / pattern.repeatHeightM];
  const transformExtension = {KHR_texture_transform: {scale: textureScale}};
  json.materials[textileMaterial] = {
    name: "PANEL_FABRIC",
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: {index: baseTexture, extensions: transformExtension},
      metallicFactor: 0,
      roughnessFactor: 1,
      metallicRoughnessTexture: {index: roughnessTexture, extensions: transformExtension},
    },
    normalTexture: {index: normalTexture, scale: 0.45, extensions: transformExtension},
    alphaMode: "MASK",
    alphaCutoff: 0.5,
    doubleSided: true,
    extras: {
      product: rules.product,
      reference: rules.fabric.reference,
      colorId: config.color,
      colorName: color.name,
      productCode: color.productCode,
      officialOpennessPercent: pattern.officialOpennessPercent,
      measuredOpenAreaPercent: rgba.metrics.measuredOpenAreaPercent,
      physicalRepeatM: [pattern.repeatWidthM, pattern.repeatHeightM],
      sourceEvidenceId: evidence.id,
    },
  };
  for (const primitive of json.meshes[mesh.PANEL_TELO_MASTER].primitives) primitive.material = textileMaterial;
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), "KHR_texture_transform"] )];
  json.asset.generator = "HomeEasy Panel Japonés Phase 1 · parametric component-kit runtime";
  json.asset.extras = {
    ...(json.asset.extras || {}),
    product: rules.product,
    system: rules.system,
    actuation: rules.actuation,
    fabricReference: rules.fabric.reference,
    configuration: config,
    layout: validation.metrics,
    recommendation: validation.recommendation,
    positionProjection: rules.positions[config.position],
    panelCountConstantAcrossStates: true,
    panelWidthConstantAcrossStates: true,
    texturePhysicalScalePreserved: true,
    runtimeUsesSingleMaster: true,
    masterGeometrySha256: await geometryHash(parsed),
  };
  const bin = combineParts(parts);
  json.buffers = [{byteLength: bin.byteLength}];
  const bytes = packGlb(json, bin);
  const blob = new Blob([bytes], {type: "model/gltf-binary"});
  const filename = `panel-japones-tretto3-${config.color}-${Math.round(config.widthM * 100)}x${Math.round(config.heightM * 100)}-${config.direction}-${config.position}.glb`;
  return {
    bytes,
    blob,
    filename,
    url: URL.createObjectURL(blob),
    config,
    metrics: validation.metrics,
    transforms,
    recommendation: validation.recommendation,
    pattern,
    evidence,
    alphaMetrics: rgba.metrics,
    revoke() { URL.revokeObjectURL(this.url); },
  };
}

export const PANEL_DIRECTIONS = Object.freeze([...DIRECTIONS]);
export const PANEL_POSITIONS = Object.freeze([...POSITIONS]);
