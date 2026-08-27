const PRODUCT_LOADERS=Object.freeze({
  sheer:()=>import("../products/sheer/studio-product.js"),
  panel:()=>import("../products/panel/studio-product.js"),
  onda:()=>import("../products/onda/studio-product.js")
});

const clone=value=>structuredClone(value);

export class HomeEasyStudioController{
  constructor({viewer,arButton,onProductLoaded=()=>{},onBuildStarted=()=>{},onBuildReady=()=>{},onError=()=>{},onDebug=()=>{}}){
    this.viewer=viewer;this.arButton=arButton;this.callbacks={onProductLoaded,onBuildStarted,onBuildReady,onError,onDebug};
    this.modules=new Map();this.states=new Map();this.variants=new Map();this.activeProduct=null;this.current=null;this.buildToken=0;this.revokedUrlCount=0;this.buildCount=0;this.transitionLog=[];
    this.arButton.disabled=true;this._arHandler=()=>this.openAR();this.arButton.addEventListener("click",this._arHandler);
  }

  async _loadProduct(productId){
    if(!PRODUCT_LOADERS[productId])throw new Error(`Producto no registrado: ${productId}`);
    if(!this.modules.has(productId))this.modules.set(productId,await PRODUCT_LOADERS[productId]());
    const module=this.modules.get(productId);
    if(!this.states.has(productId))this.states.set(productId,clone(module.descriptor.defaultState));
    if(!this.variants.has(productId))this.variants.set(productId,await module.getVariants());
    return module;
  }

  _clearViewer(){
    this.viewer.removeAttribute("src");this.viewer.removeAttribute("ios-src");this.viewer.dataset.product="";this.viewer.dataset.variant="";
  }

  _revoke(result){
    if(!result||result.__studioRevoked)return;
    result.__studioRevoked=true;result.revoke?.();this.revokedUrlCount+=1;
  }

  _invalidate(reason){
    this.buildToken+=1;this.arButton.disabled=true;this.arButton.dataset.ready="false";
    if(this.current){this._revoke(this.current.result);this.current=null;}
    this._clearViewer();this.callbacks.onDebug(this.debugSnapshot(reason));
    return this.buildToken;
  }

  async activateProduct(productId){
    const previous=this.activeProduct;this._invalidate("product-change");this.activeProduct=productId;
    const selectionToken=this.buildToken,module=await this._loadProduct(productId);
    if(selectionToken!==this.buildToken||this.activeProduct!==productId)return null;
    this.transitionLog.push({from:previous,to:productId});
    await this.callbacks.onProductLoaded({productId,module,state:this.getState(productId),variants:this.getVariants(productId)});
    return this.buildActive();
  }

  getState(productId=this.activeProduct){return clone(this.states.get(productId)||{});}
  getVariants(productId=this.activeProduct){return clone(this.variants.get(productId)||[]);}

  updateState(partial,{build=false}={}){
    if(!this.activeProduct)throw new Error("No hay producto activo.");
    this.states.set(this.activeProduct,{...this.states.get(this.activeProduct),...partial});
    this.callbacks.onDebug(this.debugSnapshot("state-update"));
    return build?this.buildActive():this.getState();
  }

  selectVariant(variantId,{build=true}={}){
    if(!this.getVariants().some(item=>item.id===variantId))throw new Error(`Variante fuera del producto activo: ${variantId}`);
    return this.updateState({variantId},{build});
  }

  async _waitForViewer(token,url){
    if(this.viewer.loaded&&this.viewer.src===url)return;
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>finish(new Error("La vista 3D no terminó de cargar.")),45000);
      const onLoad=()=>finish(),onError=()=>finish(new Error("El GLB no pudo mostrarse."));
      const finish=error=>{clearTimeout(timeout);this.viewer.removeEventListener("load",onLoad);this.viewer.removeEventListener("error",onError);if(error)reject(error);else resolve();};
      this.viewer.addEventListener("load",onLoad,{once:true});this.viewer.addEventListener("error",onError,{once:true});
      queueMicrotask(()=>{if(token===this.buildToken&&this.viewer.loaded&&this.viewer.src===url)finish();});
    });
  }

  async buildActive(){
    const productId=this.activeProduct;if(!productId)throw new Error("Selecciona un producto.");
    const token=this._invalidate("build"),module=await this._loadProduct(productId),state=this.getState(productId);
    this.callbacks.onBuildStarted({productId,state,token});
    try{
      const result=await module.buildProduct(state);
      if(token!==this.buildToken||productId!==this.activeProduct){this._revoke(result);return null;}
      if(!result?.url||!result?.bytes)throw new Error("El motor no devolvió un Blob GLB válido.");
      this.viewer.dataset.product=productId;this.viewer.dataset.variant=state.variantId;this.viewer.src=result.url;
      await this._waitForViewer(token,result.url);
      if(token!==this.buildToken||productId!==this.activeProduct){this._revoke(result);return null;}
      this.current={productId,state,result,module,url:result.url};this.buildCount+=1;this.arButton.disabled=false;this.arButton.dataset.ready="true";
      this.callbacks.onBuildReady({productId,state,result,module,token});this.callbacks.onDebug(this.debugSnapshot("ready"));return result;
    }catch(error){
      if(token===this.buildToken){this.arButton.disabled=true;this._clearViewer();this.callbacks.onError({productId,state,error,token});this.callbacks.onDebug(this.debugSnapshot("error"));}
      throw error;
    }
  }

  async openAR(){
    if(!this.current||this.arButton.disabled)throw new Error("Espera a que el modelo exacto esté listo.");
    if(this.viewer.src!==this.current.url||this.viewer.hasAttribute("ios-src"))throw new Error("Quick Look debe generarse desde el GLB exacto del preview y sin ios-src explícito.");
    return this.viewer.activateAR();
  }

  debugSnapshot(reason="snapshot"){
    return {reason,activeProduct:this.activeProduct,states:Object.fromEntries([...this.states].map(([id,state])=>[id,clone(state)])),loadedProducts:[...this.modules.keys()],ready:Boolean(this.current)&&!this.arButton.disabled,currentProduct:this.current?.productId||null,currentVariant:this.current?.state?.variantId||null,currentUrl:this.current?.url||null,quickLookGeneratedFromExactPreviewGlb:Boolean(this.current)&&this.viewer.src===this.current.url&&!this.viewer.hasAttribute("ios-src"),arDisabled:this.arButton.disabled,revokedUrlCount:this.revokedUrlCount,buildCount:this.buildCount,transitionLog:clone(this.transitionLog)};
  }

  destroy(){this._invalidate("destroy");this.arButton.removeEventListener("click",this._arHandler);}
}
