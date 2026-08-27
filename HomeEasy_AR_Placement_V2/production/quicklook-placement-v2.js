const MIME_USDZ="model/vnd.usdz+zip";
const EPSILON=1e-5;
const encoder=new TextEncoder(),decoder=new TextDecoder();

const PRODUCT_POLICIES=Object.freeze({
  sheer:{label:"Sheer Elegance",mountLabel:"centro superior/posterior del cabezal",patterns:[/cabezal/i,/fascia/i,/soporte_pared/i,/tapa_lateral/i]},
  panel:{label:"Panel Japonés",mountLabel:"centro superior/posterior del riel",patterns:[/panel_rail_profile/i,/panel_end_cap/i]},
  onda:{label:"Onda Serena",mountLabel:"centro superior/posterior del riel",patterns:[/onda_rail/i,/onda_endcap/i,/soporte perfil/i]}
});

function fail(message){throw new Error(message);}
function bytesOf(value){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  return fail("Se esperaba un ArrayBuffer o Uint8Array.");
}
function finite(value,label){const number=Number(value);if(!Number.isFinite(number))fail(`${label} no es finito.`);return number;}
function round(value,places=6){const power=10**places;return Math.round(value*power)/power;}

function parseGlb(input){
  const bytes=bytesOf(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)fail("GLB 2.0 inválido.");
  if(view.getUint32(8,true)!==bytes.byteLength)fail("Longitud GLB inconsistente.");
  let offset=12,json=null,bin=null;
  while(offset+8<=bytes.length){
    const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true),start=offset+8,end=start+length;
    if(end>bytes.length)fail("Chunk GLB fuera de rango.");
    if(type===0x4e4f534a)json=JSON.parse(decoder.decode(bytes.subarray(start,end)).replace(/[\0 ]+$/g,""));
    if(type===0x004e4942)bin=bytes.subarray(start,end);
    offset=end;
  }
  if(!json||!bin)fail("El GLB debe incluir JSON y BIN.");
  return {bytes,json,bin};
}

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){
  const out=new Array(16).fill(0);
  for(let column=0;column<4;column++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)out[column*4+row]+=a[k*4+row]*b[column*4+k];
  return out;
}
function trs(node){
  if(Array.isArray(node.matrix)&&node.matrix.length===16)return node.matrix.map(Number);
  const [x,y,z,w]=(node.rotation||[0,0,0,1]).map(Number),[sx,sy,sz]=(node.scale||[1,1,1]).map(Number),[tx,ty,tz]=(node.translation||[0,0,0]).map(Number);
  const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  return [(1-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0,(xy-wz)*sy,(1-(xx+zz))*sy,(yz+wx)*sy,0,(xz+wy)*sz,(yz-wx)*sz,(1-(xx+yy))*sz,0,tx,ty,tz,1];
}
function yawMatrix(degrees){const radians=finite(degrees||0,"orientationYawDeg")*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);return [c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1];}
function transform(matrix,x,y,z){return [matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]];}
function emptyBounds(){return {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],vertexCount:0};}
function include(bounds,point){for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],point[axis]);bounds.max[axis]=Math.max(bounds.max[axis],point[axis]);}bounds.vertexCount++;}
function finalBounds(bounds,label){if(!bounds.vertexCount)fail(`No se encontró geometría para ${label}.`);return {min:bounds.min.map(value=>round(value)),max:bounds.max.map(value=>round(value)),size:bounds.max.map((value,index)=>round(value-bounds.min[index])),vertexCount:bounds.vertexCount};}

function readPositionAccessor(parsed,index,visit){
  const accessor=parsed.json.accessors?.[index];
  if(!accessor||accessor.type!=="VEC3"||accessor.componentType!==5126)fail("POSITION debe ser VEC3 Float32.");
  if(accessor.sparse)fail("POSITION sparse no está permitido en este piloto.");
  const bufferView=parsed.json.bufferViews?.[accessor.bufferView];
  if(!bufferView||bufferView.buffer!==0)fail("POSITION debe residir en el BIN del GLB.");
  const stride=bufferView.byteStride||12,start=(bufferView.byteOffset||0)+(accessor.byteOffset||0),view=new DataView(parsed.bin.buffer,parsed.bin.byteOffset,parsed.bin.byteLength);
  for(let i=0;i<accessor.count;i++){const offset=start+i*stride;visit(view.getFloat32(offset,true),view.getFloat32(offset+4,true),view.getFloat32(offset+8,true));}
}

export function inspectInstallationBounds(glbBytes,{productId,orientationYawDeg=0,epsilon=EPSILON}={}){
  const policy=PRODUCT_POLICIES[productId];if(!policy)fail(`Producto no soportado: ${productId}`);
  const parsed=parseGlb(glbBytes),all=emptyBounds(),mountGeometry=emptyBounds(),matchedNodes=new Set(),scene=parsed.json.scenes?.[parsed.json.scene||0];
  if(!scene)fail("El GLB no declara una escena activa.");
  const orientation=yawMatrix(orientationYawDeg),visiting=new Set();
  const walk=(nodeIndex,parentMatrix)=>{
    if(visiting.has(nodeIndex))fail("Ciclo inválido en nodos GLB.");visiting.add(nodeIndex);
    const node=parsed.json.nodes?.[nodeIndex];if(!node)fail(`Nodo GLB inexistente: ${nodeIndex}`);
    const world=multiply(parentMatrix,trs(node)),presented=multiply(orientation,world),mesh=parsed.json.meshes?.[node.mesh],name=`${node.name||""} ${mesh?.name||""}`;
    const isMount=policy.patterns.some(pattern=>pattern.test(name));if(isMount)matchedNodes.add(node.name||mesh?.name||`node-${nodeIndex}`);
    for(const primitive of mesh?.primitives||[]){
      const position=primitive.attributes?.POSITION;if(position===undefined)continue;
      readPositionAccessor(parsed,position,(x,y,z)=>{const point=transform(presented,x,y,z);include(all,point);if(isMount)include(mountGeometry,point);});
    }
    for(const child of node.children||[])walk(child,world);visiting.delete(nodeIndex);
  };
  for(const root of scene.nodes||[])walk(root,identity());
  const productBounds=finalBounds(all,"el producto"),componentBounds=finalBounds(mountGeometry,"el cabezal/riel de instalación");
  const wallBackZ=productBounds.min[2],mountPoint=[(componentBounds.min[0]+componentBounds.max[0])/2,componentBounds.max[1],wallBackZ].map(value=>round(value));
  const minimumClearanceM=round(productBounds.min[2]-wallBackZ),maximumProjectionM=round(productBounds.max[2]-wallBackZ),installationComponentBackOffsetM=round(componentBounds.min[2]-wallBackZ);
  if(minimumClearanceM < -Math.abs(epsilon))fail(`La geometría visible atraviesa el plano de pared ${Math.abs(minimumClearanceM).toFixed(6)} m.`);
  return Object.freeze({productId,productLabel:policy.label,mountLabel:policy.mountLabel,coordinateConvention:"+Y arriba, +X derecha, +Z hacia la habitación, -Z hacia la pared",orientationYawDeg:round(orientationYawDeg),productBounds,installationComponentBounds:componentBounds,matchedNodes:[...matchedNodes],mountPointM:mountPoint,wallBackZ,wallBackZSource:"mínimo Z de toda la geometría visible; X/Y tomados del cabezal o riel",installationComponentBackOffsetM,minimumClearanceM,maximumProjectionM,epsilonM:Math.abs(epsilon),wallPlaneTestPassed:true});
}

function usdaNumber(value){const n=Math.abs(value)<1e-12?0:value;return Number(n.toFixed(9)).toString();}
export function createAnchoringLayer({sourceLayerName,mountPointM,productId}){
  if(!/\.(usda|usdc)$/i.test(sourceLayerName||""))fail("La capa fuente USD debe ser USDA o USDC.");
  if(!Array.isArray(mountPointM)||mountPointM.length!==3)fail("mountPointM inválido.");
  const translation=mountPointM.map(value=>usdaNumber(-finite(value,"mountPointM"))).join(", ");
  return `#usda 1.0\n(\n    defaultPrim = "InstallationAnchor"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n\ndef Xform "InstallationAnchor" (\n    prepend apiSchemas = ["Preliminary_AnchoringAPI"]\n)\n{\n    uniform token preliminary:anchoring:type = "plane"\n    uniform token preliminary:planeAnchoring:alignment = "vertical"\n    custom string homeEasy:placementVersion = "2"\n    custom string homeEasy:product = "${String(productId).replace(/[^a-z0-9_-]/gi,"")}"\n\n    def Xform "Product" (\n        prepend references = @./${sourceLayerName}@\n    )\n    {\n        double3 xformOp:translate = (${translation})\n        uniform token[] xformOpOrder = ["xformOp:translate"]\n    }\n}\n`;
}

let crcTable;
function crc32(bytes){
  crcTable||=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
function findEocd(bytes){for(let index=bytes.length-22;index>=Math.max(0,bytes.length-65557);index--)if(bytes[index]===0x50&&bytes[index+1]===0x4b&&bytes[index+2]===0x05&&bytes[index+3]===0x06)return index;return -1;}
export function readStoredZip(input){
  const bytes=bytesOf(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),eocd=findEocd(bytes);if(eocd<0)fail("ZIP sin EOCD.");
  const count=view.getUint16(eocd+10,true),centralOffset=view.getUint32(eocd+16,true),entries=[];let offset=centralOffset;
  for(let index=0;index<count;index++){
    if(view.getUint32(offset,true)!==0x02014b50)fail("Directorio central ZIP inválido.");
    const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true),compressedSize=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true),name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength));
    if(flags&1)fail(`USDZ cifrado no permitido: ${name}`);if(method!==0||compressedSize!==size)fail(`USDZ debe usar almacenamiento sin compresión: ${name}`);
    if(view.getUint32(localOffset,true)!==0x04034b50)fail(`Cabecera local inválida: ${name}`);
    const localNameLength=view.getUint16(localOffset+26,true),localExtraLength=view.getUint16(localOffset+28,true),dataOffset=localOffset+30+localNameLength+localExtraLength,data=bytes.slice(dataOffset,dataOffset+size);
    if(crc32(data)!==crc)fail(`CRC inválido: ${name}`);entries.push({name,data,dataOffset,aligned:dataOffset%64===0});offset+=46+nameLength+extraLength+commentLength;
  }
  return entries;
}

function concat(parts,total){const output=new Uint8Array(total);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;}
export function writeUsdz(entries){
  if(!entries.length)fail("USDZ sin archivos.");const locals=[],centrals=[],records=[];let offset=0;
  for(const entry of entries){
    const nameBytes=encoder.encode(entry.name),data=bytesOf(entry.data),crc=crc32(data),base=offset+30+nameBytes.length;let extraLength=(64-(base%64))%64;if(extraLength>0&&extraLength<4)extraLength+=64;
    const local=new Uint8Array(30+nameBytes.length+extraLength),view=new DataView(local.buffer);view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x0800,true);view.setUint16(8,0,true);view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,nameBytes.length,true);view.setUint16(28,extraLength,true);local.set(nameBytes,30);if(extraLength){view.setUint16(30+nameBytes.length,0xffff,true);view.setUint16(32+nameBytes.length,extraLength-4,true);}
    locals.push(local,data);records.push({entry,nameBytes,crc,size:data.length,offset});offset+=local.length+data.length;if(offset-data.length<0||((offset-data.length)%64)!==0)fail(`Alineación USDZ falló: ${entry.name}`);
  }
  const centralOffset=offset;
  for(const record of records){const central=new Uint8Array(46+record.nameBytes.length),view=new DataView(central.buffer);view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x0800,true);view.setUint16(10,0,true);view.setUint32(16,record.crc,true);view.setUint32(20,record.size,true);view.setUint32(24,record.size,true);view.setUint16(28,record.nameBytes.length,true);view.setUint32(42,record.offset,true);central.set(record.nameBytes,46);centrals.push(central);offset+=central.length;}
  const centralSize=offset-centralOffset,eocd=new Uint8Array(22),end=new DataView(eocd.buffer);end.setUint32(0,0x06054b50,true);end.setUint16(8,records.length,true);end.setUint16(10,records.length,true);end.setUint32(12,centralSize,true);end.setUint32(16,centralOffset,true);offset+=eocd.length;
  return concat([...locals,...centrals,eocd],offset);
}

export function buildAnchoredUsdzFromStoredEntries(originalEntries,{bounds,productId}){
  if(!bounds?.wallPlaneTestPassed)fail("El test del plano de pared debe aprobar antes de empaquetar.");
  const source=originalEntries.find(entry=>/\.(usda|usdc)$/i.test(entry.name));if(!source)fail("El USDZ generado no contiene una capa USD.");
  const wrapper=createAnchoringLayer({sourceLayerName:source.name,mountPointM:bounds.mountPointM,productId}),entries=[{name:"placement.usda",data:encoder.encode(wrapper)},...originalEntries.map(entry=>({name:entry.name,data:entry.data}))],bytes=writeUsdz(entries),verified=readStoredZip(bytes);
  if(verified.some(entry=>!entry.aligned))fail("El USDZ final contiene archivos no alineados a 64 bytes.");
  return {bytes,blob:new Blob([bytes],{type:MIME_USDZ}),wrapper,sourceLayerName:source.name,entries:verified.map(entry=>({name:entry.name,bytes:entry.data.length,dataOffset:entry.dataOffset,aligned:entry.aligned}))};
}

export async function createAnchoredQuickLookUsdz({viewer,glbBytes,productId,orientationYawDeg=0,expectedViewerSrc}){
  if(!viewer||typeof viewer.prepareUSDZ!=="function")fail("model-viewer 4.3.1 con prepareUSDZ() es obligatorio.");
  if(expectedViewerSrc&&viewer.src!==expectedViewerSrc)fail("El preview no usa el GLB exacto solicitado.");
  if(viewer.hasAttribute("ios-src"))fail("El laboratorio no permite ios-src explícito.");
  const bounds=inspectInstallationBounds(glbBytes,{productId,orientationYawDeg}),autoUrl=await viewer.prepareUSDZ();if(!autoUrl)fail("model-viewer no generó el USDZ fuente.");
  try{
    const response=await fetch(autoUrl);if(!response.ok)fail(`No se pudo leer el USDZ fuente (${response.status}).`);
    const originalBytes=new Uint8Array(await response.arrayBuffer()),originalEntries=readStoredZip(originalBytes),built=buildAnchoredUsdzFromStoredEntries(originalEntries,{bounds,productId}),url=URL.createObjectURL(built.blob);
    return {...built,url,bounds,mimeType:MIME_USDZ,originalBytes:originalBytes.length,allowsContentScaling:false,revoke(){URL.revokeObjectURL(url)}};
  }finally{URL.revokeObjectURL(autoUrl);}
}

export function configureQuickLookAnchor(anchor,anchoredResult){
  if(!(anchor instanceof HTMLAnchorElement))fail("Se requiere un elemento <a> para Quick Look.");
  if(!anchor.querySelector("img"))fail("El enlace rel=ar debe contener un <img>.");
  anchor.setAttribute("rel","ar");anchor.href=`${anchoredResult.url}#allowsContentScaling=0`;anchor.dataset.ready="true";anchor.setAttribute("aria-disabled","false");
  return anchor.href;
}

export const PLACEMENT_V2_CONTRACT=Object.freeze({mimeType:MIME_USDZ,anchoringType:"plane",planeAlignment:"vertical",allowsContentScaling:false,epsilonM:EPSILON,products:Object.keys(PRODUCT_POLICIES)});
