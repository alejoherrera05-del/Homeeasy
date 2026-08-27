const pad4=value=>(value+3)&~3;

function parseGlb(bytes){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw new Error("GLB inválido");
  let offset=12,json,bin;
  while(offset<data.length){const length=view.getUint32(offset,true),type=view.getUint32(offset+4,true),payload=data.slice(offset+8,offset+8+length);if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(payload).replace(/\u0000+$/g,"").trim());if(type===0x004e4942)bin=payload;offset+=8+length;}
  if(!json||!bin)throw new Error("GLB sin JSON/BIN");return{json,bin};
}

function packGlb(json,bin){
  const jsonRaw=new TextEncoder().encode(JSON.stringify(json)),jsonLength=pad4(jsonRaw.length),binLength=pad4(bin.length),out=new Uint8Array(12+8+jsonLength+8+binLength),view=new DataView(out.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(jsonRaw,20);
  const binHeader=20+jsonLength;view.setUint32(binHeader,binLength,true);view.setUint32(binHeader+4,0x004e4942,true);out.set(bin,binHeader+8);return out;
}

function appendImages(json,bin,entries){
  const chunks=[bin],views=[];let offset=bin.length;
  json.bufferViews??=[];json.images??=[];json.textures??=[];json.samplers??=[];
  for(const entry of entries){const aligned=pad4(offset),padding=aligned-offset;if(padding)chunks.push(new Uint8Array(padding));offset=aligned;views.push(json.bufferViews.length);json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:entry.bytes.byteLength});chunks.push(entry.bytes);offset+=entry.bytes.byteLength;}
  const joined=new Uint8Array(offset);let cursor=0;for(const chunk of chunks){joined.set(chunk,cursor);cursor+=chunk.byteLength;}
  const sampler=json.samplers.length;json.samplers.push({name:"ONDA_FABRIC_REPEAT",magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497});
  const firstImage=json.images.length;entries.forEach((entry,index)=>json.images.push({name:entry.name,bufferView:views[index],mimeType:"image/png"}));
  const firstTexture=json.textures.length;entries.forEach((entry,index)=>json.textures.push({name:entry.name,sampler,source:firstImage+index}));
  json.buffers[0].byteLength=joined.byteLength;return{bin:joined,textureIndices:Object.fromEntries(entries.map((entry,index)=>[entry.key,firstTexture+index]))};
}

export function inspectOndaMaster(bytes){
  const {json}=parseGlb(bytes),nodeNames=(json.nodes||[]).map(node=>node.name||""),required=["ONDA_RAIL","ONDA_ENDCAP_LEFT","ONDA_ENDCAP_RIGHT","ONDA_FABRIC_1","ONDA_BOTTOM_HEM_1","ONDA_TRACK_SYSTEM_HEADER_TAPE_1","ONDA_CONTROL_WAND_1"];
  const missing=required.filter(name=>!nodeNames.includes(name));if(missing.length)throw new Error(`Master Onda incompleto: ${missing.join(", ")}`);
  const fabric=json.materials?.find(item=>item.name==="ONDA_FABRIC");if(!fabric)throw new Error("Master sin slot ONDA_FABRIC");
  if(json.asset?.extras?.architecture!=="single-master-plus-fabric-packs")throw new Error("Contrato de master Onda no reconocido");
  return{architecture:json.asset.extras.architecture,nodeNames,masterNeutral:json.asset.extras.masterNeutral===true};
}

export function embedOndaFabricPack(glbBytes,maps,profile){
  const {json,bin}=parseGlb(glbBytes),entries=[{key:"baseColor",name:`${profile.collection} ${profile.color} · Base Color`,bytes:maps.baseColor},{key:"normal",name:`${profile.collection} ${profile.color} · Normal`,bytes:maps.normal},{key:"metallicRoughness",name:`${profile.collection} ${profile.color} · Metallic Roughness`,bytes:maps.metallicRoughness}],appended=appendImages(json,bin,entries),material=json.materials.find(item=>item.name==="ONDA_FABRIC");
  if(!material)throw new Error("GLB runtime sin slot ONDA_FABRIC");
  material.pbrMetallicRoughness.baseColorTexture={index:appended.textureIndices.baseColor,texCoord:0};material.pbrMetallicRoughness.metallicRoughnessTexture={index:appended.textureIndices.metallicRoughness,texCoord:0};material.pbrMetallicRoughness.metallicFactor=0;material.pbrMetallicRoughness.roughnessFactor=Number(profile.roughnessFactor);material.normalTexture={index:appended.textureIndices.normal,texCoord:0,scale:.42};material.alphaMode=profile.alphaMode;material.doubleSided=true;delete material.alphaCutoff;
  if(Number(profile.transmissionFactor)>0){material.extensions={...(material.extensions||{}),KHR_materials_transmission:{transmissionFactor:Number(profile.transmissionFactor)}};json.extensionsUsed=[...new Set([...(json.extensionsUsed||[]),"KHR_materials_transmission"])]}else{delete material.extensions?.KHR_materials_transmission;if(material.extensions&&!Object.keys(material.extensions).length)delete material.extensions;json.extensionsUsed=(json.extensionsUsed||[]).filter(name=>name!=="KHR_materials_transmission");if(!json.extensionsUsed.length)delete json.extensionsUsed;}
  material.extras={...(material.extras||{}),slot:"ONDA_FABRIC",fabricPackId:profile.id,officialHierarchy:["CORTINA ONDA SERENA","AL 2.8",profile.family,profile.collection,profile.color],baseColorContainsAlpha:Boolean(profile.maps.alpha),alphaSource:profile.maps.alpha?"base-color.png RGBA, validated against alpha.png":"opaque base color",physicalTextureScaleM:profile.physicalTextureScaleM,physicalTextureScaleClassification:profile.physicalTextureScaleClassification};
  json.asset.extras={...(json.asset.extras||{}),fabricPack:{id:profile.id,productCode:profile.productCode,materialClass:profile.materialClass,alphaMode:profile.alphaMode,baseColorContainsAlpha:Boolean(profile.maps.alpha),mapsEmbedded:["base-color.png","normal.png","metallic-roughness.png"],alphaEvidenceFile:profile.maps.alpha||null},architecture:"single-master-plus-fabric-packs"};
  return packGlb(json,appended.bin);
}

export function parseOndaGlb(bytes){return parseGlb(bytes);}
