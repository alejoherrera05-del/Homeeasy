import {HomeEasyStudioController} from "./studio-core.js?v=2.1";
    const $=id=>document.getElementById(id),viewer=$("viewer"),arButton=$("ar-button"),status=$("status"),overlay=$("stage-overlay"),pill=$("ready-pill"),qaEnabled=new URLSearchParams(location.search).get("qa")==="1";
    const productNames={sheer:"Sheer Elegance",panel:"Panel Japonés",onda:"Onda Serena"},stateLabels={sheer:{abierta:"Abierta",media:"Media",cerrada:"Cerrada"},panel:{closed:"Cerrado",partial:"Parcial",collected:"Recogido"},onda:{closed:"Cerrada",partial:"Parcial",collected:"Recogida"}};
    let buildTimer=null,activeModule=null,activeVariants=[];
    if(qaEnabled)$("qa").hidden=false;
    $("back").addEventListener("click",()=>history.back());

    function selected(group){return document.querySelector(`[data-group="${group}"] button[aria-pressed="true"]`)?.dataset.value;}
    function press(group,value){for(const button of document.querySelectorAll(`[data-group="${group}"] button`))button.setAttribute("aria-pressed",String(button.dataset.value===value));}
    function showPanel(productId){for(const panel of document.querySelectorAll(".product-panel"))panel.hidden=panel.dataset.product!==productId;}
    function setStatus(message,tone="working"){status.textContent=message;status.dataset.tone=tone;}
    function setBusy(message){overlay.hidden=false;overlay.textContent=message;pill.dataset.state="working";pill.textContent="Preparando";arButton.disabled=true;}
    function escapeText(value){const span=document.createElement("span");span.textContent=value;return span.innerHTML;}

    function parseLocaleDecimal(value){
      const raw=String(value??"").trim().replace(/\s/g,"");
      if(!raw)return {complete:false,value:NaN};
      if(/^\d+[,.]$/.test(raw))return {complete:false,value:NaN};
      if(!/^\d+(?:[,.]\d+)?$/.test(raw))return {complete:false,value:NaN};
      const number=Number(raw.replace(",","."));
      return {complete:Number.isFinite(number),value:number};
    }

    function readMeasure(input){
      const parsed=parseLocaleDecimal(input.value);
      if(!parsed.complete)return {complete:false,valid:false,value:NaN,message:""};
      const min=Number(input.min),max=Number(input.max),valid=parsed.value>=min&&parsed.value<=max;
      const label=document.querySelector(`label[for="${input.id}"]`)?.textContent||"La medida";
      return {complete:true,valid,value:parsed.value,message:valid?"":`${label}: usa un valor entre ${min} y ${max} m.`};
    }

    function domState(productId){
      const ids=productId==="sheer"?["sheer-width","sheer-height"]:productId==="panel"?["panel-width","panel-height"]:["onda-width","onda-height"],measures=ids.map(id=>readMeasure($(id)));
      if(measures.some(measure=>!measure.complete))return null;
      const invalid=measures.find(measure=>!measure.valid);if(invalid)throw new RangeError(invalid.message);
      const [width,height]=measures.map(measure=>measure.value);
      if(productId==="sheer")return {fabricWidthM:width,fabricHeightM:height,headrailSystem:selected("sheer-system"),controlSide:selected("sheer-side"),bandState:selected("sheer-state")};
      if(productId==="panel")return {widthM:width,heightM:height,direction:selected("panel-direction"),position:selected("panel-state"),controlSide:"right",layout:$("panel-layout").value||null};
      return {widthM:width,heightM:height,direction:selected("onda-direction"),position:selected("onda-state"),fullness:"2.8",bottom:"hem-15"};
    }

    function applyState(productId,state){
      if(productId==="sheer"){$("sheer-width").value=state.fabricWidthM;$("sheer-height").value=state.fabricHeightM;press("sheer-system",state.headrailSystem);press("sheer-side",state.controlSide);press("sheer-state",state.bandState);}
      if(productId==="panel"){$("panel-width").value=state.widthM;$("panel-height").value=state.heightM;press("panel-direction",state.direction);press("panel-state",state.position);}
      if(productId==="onda"){$("onda-width").value=state.widthM;$("onda-height").value=state.heightM;press("onda-direction",state.direction);press("onda-state",state.position);const variant=activeVariants.find(item=>item.id===state.variantId);if(variant)$("onda-family").value=variant.family;}
    }

    async function refreshPanelSupport(){
      if(controller.activeProduct!=="panel"||!activeModule?.getConfigurationSupport)return;
      const state={...controller.getState(),...domState("panel")},support=await activeModule.getConfigurationSupport(state),select=$("panel-layout"),current=state.layout||support.recommendation.selected?.layout||"",options=[support.recommendation.selected,...support.recommendation.alternatives].filter(Boolean);
      select.replaceChildren(...options.map(item=>{const option=document.createElement("option");option.value=item.layout;option.textContent=`${item.ways} vías · ${item.telos} telos · telo ${(item.teloWidthM*100).toFixed(1)} cm`;option.selected=item.layout===current;return option;}));
      const chosen=options.find(item=>item.layout===current)||options[0];$("panel-recommendation").innerHTML=chosen?`<strong>${escapeText(support.recommendation.disclosure)}</strong><span>${chosen.ways} vías · ${chosen.telos} telos · ancho de telo ${(chosen.teloWidthM*100).toFixed(1)} cm · solape 8 cm</span>`:"<strong>Sin configuración válida</strong><span>Revisa las medidas seleccionadas.</span>";
    }

    function renderSwatches(productId,state){
      const container=$(`${productId}-swatches`);if(!container)return;
      let variants=activeVariants;
      if(productId==="onda"){
        const family=$("onda-family").value;variants=activeVariants.filter(item=>item.family===family);const selectedVariant=activeVariants.find(item=>item.id===state.variantId),collection=variants[0]?.collection||selectedVariant?.collection||"";$("onda-collection").textContent=collection[0]+collection.slice(1).toLowerCase();$("onda-color-count").textContent=`${variants.length} ${variants.length===1?"color":"colores"}`;
      }
      container.replaceChildren(...variants.map(variant=>{const button=document.createElement("button");button.type="button";button.className="swatch";button.dataset.variant=variant.id;button.setAttribute("aria-pressed",String(variant.id===state.variantId));const image=document.createElement("img");image.src=variant.thumbnailUrl;image.alt=variant.label;image.loading="lazy";const label=document.createElement("span");label.textContent=variant.label;button.append(image,label);button.addEventListener("click",()=>selectVariant(variant.id));return button;}));
    }

    function syncActiveState({resetLayout=false}={}){
      if(!controller.activeProduct)return false;const partial=domState(controller.activeProduct);if(!partial)return false;if(resetLayout&&controller.activeProduct==="panel")partial.layout=null;controller.updateState(partial);if(controller.activeProduct==="panel")refreshPanelSupport().catch(showError);return true;
    }

    function scheduleBuild(options={}){clearTimeout(buildTimer);try{if(!syncActiveState(options))return;}catch(error){showError(error);return;}buildTimer=setTimeout(()=>controller.buildActive().catch(()=>{}),430);}
    function showError(error){setStatus(error?.message||String(error),"error");overlay.hidden=false;overlay.textContent="Revisa la configuración seleccionada.";pill.dataset.state="error";pill.textContent="Revisar";}
    function selectVariant(variantId){controller.selectVariant(variantId,{build:false});renderSwatches(controller.activeProduct,controller.getState());scheduleBuild();}

    const controller=new HomeEasyStudioController({viewer,arButton,
      onProductLoaded:async({productId,module,state,variants})=>{activeModule=module;activeVariants=variants;showPanel(productId);applyState(productId,state);if(productId==="onda"){const selectedVariant=variants.find(item=>item.id===state.variantId);if(selectedVariant)$("onda-family").value=selectedVariant.family;}renderSwatches(productId,state);if(productId==="panel")await refreshPanelSupport();$("preview-title").textContent=productNames[productId];$("preview-subtitle").textContent=module.descriptor.reference;},
      onBuildStarted:({productId})=>{setBusy(`Preparando ${productNames[productId]}…`);setStatus(`Construyendo ${productNames[productId]}…`);},
      onBuildReady:({productId,state,result,module})=>{overlay.hidden=true;pill.dataset.state="ready";pill.textContent="Listo";$("preview-title").textContent=productNames[productId];$("preview-subtitle").textContent=module.commercialSummary(state,result);setStatus("Modelo listo. Puedes revisarlo en 3D o abrirlo en tu espacio.","ready");},
      onError:({error})=>showError(error),
      onDebug:snapshot=>{if(qaEnabled)$("qa-output").textContent=JSON.stringify(snapshot,null,2);}
    });

    $("product").addEventListener("change",()=>{clearTimeout(buildTimer);showPanel($("product").value);setBusy(`Cambiando a ${productNames[$("product").value]}…`);controller.activateProduct($("product").value).catch(showError);});
    for(const group of document.querySelectorAll("[data-group]"))group.addEventListener("click",event=>{const button=event.target.closest("button[data-value]");if(!button)return;press(group.dataset.group,button.dataset.value);scheduleBuild({resetLayout:group.dataset.group==="panel-direction"});});
    for(const id of ["sheer-width","sheer-height","panel-width","panel-height","onda-width","onda-height"])$(id).addEventListener("input",()=>scheduleBuild({resetLayout:controller.activeProduct==="panel"}));
    $("panel-layout").addEventListener("change",()=>scheduleBuild());
    $("onda-family").addEventListener("change",()=>{const variants=activeVariants.filter(item=>item.family===$("onda-family").value),state=controller.getState();if(!variants.some(item=>item.id===state.variantId))controller.selectVariant(variants[0].id,{build:false});renderSwatches("onda",controller.getState());scheduleBuild();});

    function syncDomFromApi(){const productId=controller.activeProduct,state=controller.getState();applyState(productId,state);if(productId==="onda"){const variant=activeVariants.find(item=>item.id===state.variantId);if(variant)$("onda-family").value=variant.family;}renderSwatches(productId,state);if(productId==="panel")return refreshPanelSupport();}
    window.__HOMEEASY_STUDIO__={
      controller,
      async selectProduct(productId){$("product").value=productId;showPanel(productId);const result=await controller.activateProduct(productId);await syncDomFromApi();return result;},
      async selectVariant(variantId){controller.selectVariant(variantId,{build:false});const sync=syncDomFromApi(),build=controller.buildActive();await sync;return build;},
      async setConfig(partial){controller.updateState(partial);const sync=syncDomFromApi(),build=controller.buildActive();await sync;return build;},
      get ready(){return controller.debugSnapshot().ready&&viewer.loaded;},
      get snapshot(){return controller.debugSnapshot();},
      get state(){return controller.getState();},
      get variants(){return controller.getVariants();},
      get activeProduct(){return controller.activeProduct;},
      get viewer(){return viewer;},
      get arButton(){return arButton;}
    };
    window.addEventListener("pagehide",()=>controller.destroy());
    controller.activateProduct("sheer").catch(showError);
