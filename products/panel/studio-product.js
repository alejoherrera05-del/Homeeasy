import {buildPanelJaponesGlb,loadPanelLayoutRules,recommendPanelLayout,validatePanelConfiguration} from "./production/panel-japones-builder.js";

const MASTER=new URL("./production/panel-japones-master.glb",import.meta.url);
const PACK_ROOT=new URL("./production/fabric-packs/screen-tretto-3/colors/",import.meta.url);
const RULES_URL=new URL("./production/data/panel-layout-rules.json",import.meta.url);
const colors=[["ebony","Ebony"],["white","White"],["white-black","White Black"],["white-grey","White Grey"],["white-sand","White Sand"]];
let rulesPromise;
const rules=()=>rulesPromise||(rulesPromise=loadPanelLayoutRules(RULES_URL));

export const descriptor=Object.freeze({
  id:"panel",label:"Panel Japonés",reference:"Screen Tretto 3%",
  defaultState:Object.freeze({variantId:"white",color:"white",widthM:3,heightM:2.4,direction:"left",position:"closed",controlSide:"right",layout:null})
});

export async function getVariants(){
  return colors.map(([id,label])=>({id,label,reference:"Screen Tretto 3%",thumbnailUrl:new URL(`${id}/thumbnail.webp`,PACK_ROOT).href}));
}

export async function getConfigurationSupport(state){
  const productRules=await rules(),configuration={...state,color:state.variantId},recommendation=recommendPanelLayout(configuration,productRules),validation=validatePanelConfiguration(configuration,productRules);
  return {rules:productRules,recommendation,validation};
}

export async function buildProduct(state){
  const variant=colors.find(([id])=>id===state.variantId);if(!variant)throw new Error("Color Panel fuera del alcance aprobado.");
  return buildPanelJaponesGlb(MASTER,new URL(`${state.variantId}/`,PACK_ROOT),{...state,color:state.variantId},await rules());
}

export function commercialSummary(state,result){
  return `${colors.find(([id])=>id===state.variantId)?.[1]} · ${result.metrics.ways} vías / ${result.metrics.telos} telos`;
}
