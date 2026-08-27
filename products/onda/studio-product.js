import {buildOndaSerenaGlb,getOndaPhase1Catalog} from "./production/onda-serena-builder.js";

const MASTER=new URL("./production/onda-serena-master.glb",import.meta.url);
let catalogPromise;
const catalog=()=>catalogPromise||(catalogPromise=getOndaPhase1Catalog());

export const descriptor=Object.freeze({
  id:"onda",label:"Onda Serena",reference:"AL 2.8",
  viewerOrientation:"0deg 0deg 180deg",
  defaultState:Object.freeze({variantId:"velo-coral-white",fabricId:"velo-coral-white",widthM:3,heightM:2.4,direction:"left",position:"closed",fullness:"2.8",bottom:"hem-15"})
});

export async function getVariants(){
  return (await catalog()).map(item=>({id:item.id,label:item.color[0]+item.color.slice(1).toLowerCase(),officialName:item.officialName,family:item.family,collection:item.collection,thumbnailUrl:new URL("thumbnail.webp",item.packUrl).href,packUrl:item.packUrl}));
}

export async function buildProduct(state){
  const variants=await catalog(),fabric=variants.find(item=>item.id===state.variantId);if(!fabric)throw new Error("Tela Onda fuera del alcance aprobado.");
  return buildOndaSerenaGlb(MASTER,new URL(fabric.packUrl),{...state,fabricId:state.variantId,fullness:"2.8",bottom:"hem-15"});
}

export function commercialSummary(state,result){
  return `${result.profile.collection} · ${result.profile.color[0]+result.profile.color.slice(1).toLowerCase()} · AL 2.8`;
}
