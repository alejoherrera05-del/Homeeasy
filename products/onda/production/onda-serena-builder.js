import {buildOndaGlb} from "./onda-serena-geometry.js";
import {embedOndaFabricPack,inspectOndaMaster} from "./apply-onda-fabric-pack.js";

const DATA_URL=new URL("./data/onda-phase1-rules.json",import.meta.url);
let dataPromise;
const loadData=()=>dataPromise||(dataPromise=fetch(DATA_URL).then(response=>{if(!response.ok)throw new Error(`Reglas Onda HTTP ${response.status}`);return response.json()}));
const fetchBytes=async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`${url} HTTP ${response.status}`);return new Uint8Array(await response.arrayBuffer())};
const normalize=config=>({fabricId:String(config.fabricId||"velo-coral-white"),widthM:Number(config.widthM||3),heightM:Number(config.heightM||2.4),fullness:"2.8",direction:["left","right"].includes(config.direction)?config.direction:"left",position:["closed","partial","collected"].includes(config.position)?config.position:"closed",bottom:"hem-15"});

export async function buildOndaSerenaGlb(masterUrl,fabricPackUrl,configuration={}){
  const started=performance.now(),[masterBytes,data,profile]=await Promise.all([fetchBytes(masterUrl),loadData(),fetch(new URL("material-profile.json",fabricPackUrl)).then(response=>{if(!response.ok)throw new Error(`Perfil de tela HTTP ${response.status}`);return response.json()})]),masterContract=inspectOndaMaster(masterBytes),config=normalize({...configuration,fabricId:profile.id}),fabric=data.fabrics.find(item=>item.id===profile.id);
  if(!fabric)throw new Error(`Tela fuera del alcance Phase 1: ${profile.id}`);
  const base=buildOndaGlb(config,data),mapBase=new URL("./",new URL("material-profile.json",fabricPackUrl)),[baseColor,normal,metallicRoughness]=await Promise.all([fetchBytes(new URL(profile.maps.baseColor,mapBase)),fetchBytes(new URL(profile.maps.normal,mapBase)),fetchBytes(new URL(profile.maps.metallicRoughness,mapBase))]),bytes=embedOndaFabricPack(base.bytes,{baseColor,normal,metallicRoughness},profile),blob=new Blob([bytes],{type:"model/gltf-binary"}),url=URL.createObjectURL(blob);
  return{bytes,url,filename:`homeeasy-onda-serena-al-2-8-${profile.collection.toLowerCase()}-${profile.color.toLowerCase()}-${config.position}.glb`,config,profile,masterContract,metrics:{bytes:bytes.byteLength,triangles:base.stats.triangles,nodes:base.gltf.nodes.length,continuousFabric:true,fullness:2.8,frontDepthM:.06,backDepthM:.06,stackFactor:data.rules.positionProjection[config.position].factor,generationMs:Math.round(performance.now()-started)},revoke(){URL.revokeObjectURL(url)}};
}

export async function getOndaPhase1Catalog(){const data=await loadData();return data.fabrics.map(item=>({...item,packUrl:new URL(item.packPath,DATA_URL).href}))}
