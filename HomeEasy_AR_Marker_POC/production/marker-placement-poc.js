export const MARKER_SIZE_M=0.18;
export const DEFAULT_DEPTH_OFFSET_M=0.005;
export const INSTALLATION_EPSILON_M=1e-4;
export const PRODUCT_CONFIGURATION=Object.freeze({
  variantId:"velo-coral-white",
  fabricId:"velo-coral-white",
  widthM:1,
  heightM:2.2,
  direction:"left",
  position:"closed",
  fullness:"2.8",
  bottom:"hem-15"
});

export const STATES=Object.freeze({
  INITIALIZING:"INITIALIZING",
  SEARCHING_MARKER:"SEARCHING_MARKER",
  MARKER_FOUND:"MARKER_FOUND",
  TRACKING:"TRACKING",
  MARKER_LOST:"MARKER_LOST",
  ERROR:"ERROR"
});

export const STATE_COPY=Object.freeze({
  INITIALIZING:"Preparando cámara y modelo",
  SEARCHING_MARKER:"Apunta a la Tarjeta AR HomeEasy",
  MARKER_FOUND:"Ubicación encontrada",
  TRACKING:"Seguimiento estable",
  MARKER_LOST:"Vuelve a enfocar la Tarjeta HomeEasy",
  ERROR:"No fue posible iniciar la experiencia AR"
});

const finite=(value,label)=>{const number=Number(value);if(!Number.isFinite(number))throw new Error(`${label} debe ser finito.`);return number};
const round=(value,places=6)=>{const p=10**places;return Math.round(value*p)/p};

export class MarkerStateMachine{
  constructor({foundHoldMs=650,onChange=()=>{}}={}){this.foundHoldMs=foundHoldMs;this.onChange=onChange;this.state=null;this.cameraReady=false;this.markerVisible=false;this.foundAt=0;this.error=null;this.transition(STATES.INITIALIZING);}
  transition(next,error=null){if(this.state===next&&this.error===error)return;const previous=this.state;this.state=next;this.error=error;this.onChange({previous,state:next,error,copy:error||STATE_COPY[next]});}
  setCameraReady(){this.cameraReady=true;this.transition(STATES.SEARCHING_MARKER);}
  observeMarker(visible,now=performance.now()){
    if(!this.cameraReady||this.state===STATES.ERROR)return this.state;
    if(visible){
      if(!this.markerVisible){this.markerVisible=true;this.foundAt=now;this.transition(STATES.MARKER_FOUND);}
      else if(this.state===STATES.MARKER_FOUND&&now-this.foundAt>=this.foundHoldMs)this.transition(STATES.TRACKING);
    }else if(this.markerVisible){this.markerVisible=false;this.transition(STATES.MARKER_LOST);}
    else if(this.state===STATES.INITIALIZING)this.transition(STATES.SEARCHING_MARKER);
    return this.state;
  }
  fail(error){this.cameraReady=false;this.markerVisible=false;this.transition(STATES.ERROR,error instanceof Error?error.message:String(error));}
}

export class MarkerPlaneOffsets{
  constructor({defaultZ=DEFAULT_DEPTH_OFFSET_M,onChange=()=>{}}={}){this.defaultZ=finite(defaultZ,"defaultZ");this.onChange=onChange;this.stepM=.01;this.reset();}
  setStep(value){const step=finite(value,"step");if(![.01,.05].includes(step))throw new Error("El paso debe ser 1 cm o 5 cm.");this.stepM=step;this.emit();}
  move(dx,dy){this.x=round(this.x+finite(dx,"dx")*this.stepM);this.y=round(this.y+finite(dy,"dy")*this.stepM);this.emit();}
  center(){this.x=0;this.y=0;this.emit();}
  closer(){this.z=round(Math.max(0,this.z-.01));this.emit();}
  farther(){this.z=round(Math.min(.2,this.z+.01));this.emit();}
  reset(){this.x=0;this.y=0;this.z=this.defaultZ;this.rotationOffset=0;this.emit();}
  emit(){this.onChange(this.snapshot());}
  snapshot(){return {offsetX:this.x,offsetY:this.y,offsetZ:this.z,rotationOffset:this.rotationOffset,stepM:this.stepM};}
}

export function computeInstallationMountPoint(productBounds,componentBounds,{epsilon=INSTALLATION_EPSILON_M}={}){
  if(productBounds?.isEmpty?.()||componentBounds?.isEmpty?.())throw new Error("No se pudo calcular el volumen de Onda/riel.");
  const mount={x:(componentBounds.min.x+componentBounds.max.x)/2,y:componentBounds.max.y,z:componentBounds.min.z};
  const wallClearance=productBounds.min.z-mount.z;
  if(wallClearance < -Math.abs(epsilon))throw new Error(`La geometría Onda se extiende ${Math.abs(wallClearance).toFixed(4)} m detrás del plano del riel.`);
  return Object.freeze({
    mountPointM:[round(mount.x),round(mount.y),round(mount.z)],
    wallBackZ:round(mount.z),
    minimumProductZ:round(productBounds.min.z),
    maximumProductZ:round(productBounds.max.z),
    minimumClearanceM:round(wallClearance),
    maximumProjectionM:round(productBounds.max.z-mount.z),
    epsilonM:Math.abs(epsilon),
    wallPlaneTestPassed:true
  });
}

export function analyzeOndaInstallation(THREE,productRoot){
  productRoot.updateWorldMatrix(true,true);
  const productBounds=new THREE.Box3().setFromObject(productRoot),componentBounds=new THREE.Box3();let matched=0;
  productRoot.traverse(node=>{
    if(!node.isMesh||!/ONDA_RAIL|ONDA_ENDCAP|Soporte[_\s]perfil/i.test(node.name||""))return;
    componentBounds.union(new THREE.Box3().setFromObject(node));matched++;
  });
  if(!matched)throw new Error("No se encontró el riel aprobado de Onda Serena.");
  let report;
  try{report=computeInstallationMountPoint(productBounds,componentBounds);}
  catch(error){
    const behind=[];
    productRoot.traverse(node=>{if(!node.isMesh)return;const box=new THREE.Box3().setFromObject(node);if(box.min.z<componentBounds.min.z-INSTALLATION_EPSILON_M)behind.push(`${node.name||"mesh"}:${round(box.min.z)}`);});
    throw new Error(`${error.message} Nodos detrás: ${behind.slice(0,12).join(", ")}.`);
  }
  return Object.freeze({...report,matchedInstallationNodes:matched,coordinateConvention:"producto +Y arriba, +X derecha, +Z habitación; marcador +X derecha, -Z arriba, +Y habitación",productBounds:{min:productBounds.min.toArray().map(value=>round(value)),max:productBounds.max.toArray().map(value=>round(value))},railBounds:{min:componentBounds.min.toArray().map(value=>round(value)),max:componentBounds.max.toArray().map(value=>round(value))}});
}

export function attachOndaToMarker(THREE,markerRoot,productRoot,installationReport,offsets){
  const [mountX,mountY,mountZ]=installationReport.mountPointM;
  productRoot.position.set(-mountX,-mountY,-mountZ);
  const productAxes=new THREE.Group();productAxes.name="HOMEEASY_PRODUCT_AXES";productAxes.rotation.x=-Math.PI/2;productAxes.add(productRoot);
  const markerOffsets=new THREE.Group();markerOffsets.name="HOMEEASY_MARKER_PLANE_OFFSETS";markerOffsets.add(productAxes);markerRoot.add(markerOffsets);
  const apply=snapshot=>{markerOffsets.position.set(snapshot.offsetX,snapshot.offsetZ,-snapshot.offsetY);markerOffsets.rotation.set(0,snapshot.rotationOffset,0);markerOffsets.scale.setScalar(1);markerOffsets.updateMatrixWorld(true);};
  apply(offsets.snapshot());
  return {markerOffsets,productAxes,apply,mapping:Object.freeze({productX:"marker +X",productY:"marker -Z",productZ:"marker +Y (normal hacia usuario)"})};
}

export async function buildApprovedOnda(ondaModule){
  if(!ondaModule?.buildProduct)throw new Error("Motor Onda aprobado no disponible.");
  const result=await ondaModule.buildProduct({...PRODUCT_CONFIGURATION});
  if(!result?.url||!result?.bytes)throw new Error("El motor Onda no devolvió el GLB exacto.");
  return result;
}

export const POC_CONTRACT=Object.freeze({engine:"AR.js",engineVersion:"3.4.8",threeVersion:"0.164.0",tracking:"pattern marker",markerSizeM:MARKER_SIZE_M,autoScale:false,pinchScale:false,quickLook:false,webXR:false,nft:false,locationBased:false,product:"Onda Serena · Velo / Coral · White · 1.00 x 2.20 m · Cerrada"});
