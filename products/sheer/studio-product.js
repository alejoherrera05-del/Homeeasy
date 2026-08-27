import {applySheerFabricPack} from "./production/apply-sheer-fabric-pack.js";

const MASTER=new URL("./production/sheer-master-white.glb",import.meta.url);
const PACK_ROOT=new URL("./production/fabric-packs/serenade-screen-clark/",import.meta.url);
const colors=[
  ["alabaster","Alabaster"],["bronze","Bronze"],["coffe-cream","Coffe Cream"],
  ["cream","Cream"],["dark-grey","Dark Grey"],["light-grey","Light Grey"],
  ["lino","Lino"],["taupe","Taupe"],["white","White"]
];

const systemLimits=Object.freeze({
  standard:Object.freeze([
    Object.freeze({maxWidthM:1.6,maxHeightM:1.8}),
    Object.freeze({maxWidthM:2.6,maxHeightM:1.2})
  ]),
  binovo:Object.freeze([
    Object.freeze({maxWidthM:1.7,maxHeightM:2.6}),
    Object.freeze({maxWidthM:2.6,maxHeightM:3}),
    Object.freeze({maxWidthM:3,maxHeightM:2.2})
  ])
});

const within=(value,maximum)=>value<=maximum+1e-9;
const meters=value=>Number(value).toLocaleString("es-CO",{minimumFractionDigits:2,maximumFractionDigits:2});

export function getConfigurationSupport(state={}){
  const width=Number(state.fabricWidthM),height=Number(state.fabricHeightM),system=state.headrailSystem;
  if(!Number.isFinite(width)||!Number.isFinite(height))return {supported:false,code:"CONFIGURATION_INCOMPLETE",userMessage:"Completa el ancho y el alto para preparar la vista 3D."};
  const limits=systemLimits[system];
  if(!limits)return {supported:false,code:"CONFIGURATION_INCOMPATIBLE",userMessage:"Selecciona un sistema Sheer válido."};
  const selected=limits.find(option=>within(width,option.maxWidthM)&&within(height,option.maxHeightM));
  if(selected)return {supported:true,system,selected};
  const dimensions=`${meters(width)} × ${meters(height)} m`;
  if(system==="standard")return {
    supported:false,
    code:"CONFIGURATION_INCOMPATIBLE",
    userMessage:`Standard no está disponible para ${dimensions}. Usa hasta 1,60 × 1,80 m o, para anchos de hasta 2,60 m, una altura máxima de 1,20 m. Ajusta las medidas o continúa con Binovo.`
  };
  return {supported:false,code:"CONFIGURATION_INCOMPATIBLE",userMessage:`Binovo no está disponible para ${dimensions}. Ajusta las medidas para continuar.`};
}

export const descriptor=Object.freeze({
  id:"sheer",label:"Sheer Elegance",reference:"Serenade Screen Clark",
  defaultState:Object.freeze({variantId:"white",fabricWidthM:1.8,fabricHeightM:2.2,headrailSystem:"binovo",controlSide:"right",bandState:"abierta"})
});

export async function getVariants(){
  return colors.map(([id,label])=>({id,label,collection:"Serenade Screen Clark",thumbnailUrl:new URL(`${id}/thumbnail.webp`,PACK_ROOT).href}));
}

export async function buildProduct(state){
  const variant=colors.find(([id])=>id===state.variantId);if(!variant)throw new Error("Color Sheer fuera del alcance aprobado.");
  const result=await applySheerFabricPack(MASTER,new URL(`${state.variantId}/`,PACK_ROOT),state),url=URL.createObjectURL(result.blob);
  return {...result,url,productId:descriptor.id,variantId:state.variantId,label:`Serenade Screen Clark · ${variant[1]}`,revoke(){URL.revokeObjectURL(url)}};
}

export function commercialSummary(state,result){
  return `${result.profile.label} · ${state.headrailSystem==="binovo"?"Binovo":"Standard"} · mando ${state.controlSide==="left"?"izquierda":"derecha"}`;
}
