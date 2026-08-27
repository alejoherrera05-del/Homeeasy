import {applySheerFabricPack} from "./production/apply-sheer-fabric-pack.js";

const MASTER=new URL("./production/sheer-master-white.glb",import.meta.url);
const PACK_ROOT=new URL("./production/fabric-packs/serenade-screen-clark/",import.meta.url);
const colors=[
  ["alabaster","Alabaster"],["bronze","Bronze"],["coffe-cream","Coffe Cream"],
  ["cream","Cream"],["dark-grey","Dark Grey"],["light-grey","Light Grey"],
  ["lino","Lino"],["taupe","Taupe"],["white","White"]
];

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
