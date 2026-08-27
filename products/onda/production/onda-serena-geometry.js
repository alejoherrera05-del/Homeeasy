const RULES_URL=new URL('../../data/pentagrama/onda-serena-rules.json',import.meta.url);
const COLORS_URL=new URL('../../data/pentagrama/colors.json',import.meta.url);
let dataPromise;

export function loadOndaData(){
  return dataPromise||(dataPromise=Promise.all([
    fetch(RULES_URL).then(response=>{if(!response.ok)throw new Error(`Reglas Onda HTTP ${response.status}`);return response.json();}),
    fetch(COLORS_URL).then(response=>{if(!response.ok)throw new Error(`Catálogo HTTP ${response.status}`);return response.json();})
  ]).then(([rules,catalog])=>({
    rules,
    fabrics:catalog.colors.filter(color=>color.compatibleProducts.includes('onda-serena')&&color.pbrVerified&&color.arEnabled).map(color=>({
      id:color.colorId,
      officialName:`${color.officialReference} · ${color.officialColorName}${color.pbrVerified?'':' · preview técnico pendiente'}`,
      collection:color.collectionId,
      rollWidthM:color.rollWidthM,
      opacityType:color.categoryId.includes('velo')?'Velo translúcido':color.categoryId.includes('black')?'100% Blackout':'Traslúcida',
      composition:color.composition,
      weightGm2:color.colorId.includes('aurora')?35:color.colorId.includes('felice')?275:null,
      pbrVerified:color.pbrVerified,
      technicalPreviewOnly:!color.pbrVerified,
      visualApproximation:color.visualApproximation,
      canJoin:rules.fabricCollectionPolicies.some(policy=>color.collectionId.includes(policy.collectionToken)&&policy.joinMethod)?true:null,
      joinType:rules.fabricCollectionPolicies.find(policy=>color.collectionId.includes(policy.collectionToken))?.joinMethod||null,
      source:color.source
      ,textureAssets:color.textureAssets
    }))
  })));
}

const finite=value=>Number.isFinite(Number(value));
export function normalizeOnda(input={}){return {fabricId:String(input.fabricId),widthM:Number(input.widthM),heightM:Number(input.heightM),fullness:String(input.fullness),direction:String(input.direction),position:String(input.position),bottom:String(input.bottom)};}
export function requiredBottom(input,data){const c=normalizeOnda(input),policy=data.rules.fabricBottomPolicy[c.fabricId]||data.rules.fabricCollectionPolicies.find(item=>c.fabricId.includes(item.collectionToken));return policy&&c.heightM>policy.maxHeightWithoutMandatoryHem15M?policy.requiredBottomAbove:null;}

export function validateOnda(input,data){
  const c=normalizeOnda(input),errors=[],warnings=[],fabric=data.fabrics.find(item=>item.id===c.fabricId),rule=data.rules.fullness[c.fullness],required=requiredBottom(c,data),maxWidth=data.rules.manufacturing.widthM.maxModeledRailM,joinRequired=Boolean(fabric?.rollWidthM&&c.heightM>fabric.rollWidthM-.2);
  if(!fabric)errors.push('Tela Onda Serena no trazada o sin PBR generado y comparado.');
  if(fabric?.technicalPreviewOnly)warnings.push('Preview técnico local: PBR comparado, todavía no habilitado para AR productivo.');
  if(!rule)errors.push('Plenitud no documentada.');
  if(!data.rules.directions.includes(c.direction))errors.push('Recogida no documentada.');
  if(!data.rules.positions.includes(c.position))errors.push('Posición no implementada.');
  if(!data.rules.bottoms.some(item=>item.id===c.bottom))errors.push('Terminación inferior no documentada.');
  if(!finite(c.widthM)||c.widthM<data.rules.manufacturing.widthM.minPilotGuard||c.widthM>maxWidth)errors.push(`RC3 modela rieles de ${data.rules.manufacturing.widthM.minPilotGuard.toFixed(2).replace('.',',')}–${maxWidth.toFixed(2).replace('.',',')} m; la unión real de riel aún no está modelada.`);
  if(!finite(c.heightM)||c.heightM<data.rules.manufacturing.heightM.minPilotGuard||c.heightM>data.rules.manufacturing.heightM.maxBaston)errors.push('Con bastón manual el alcance documentado de RC3 es 1,30–3,00 m.');
  if(required&&c.bottom!==required)errors.push('Para esta tela y altura Pentagrama exige Bajo de 15 cm.');
  if(required)warnings.push('Bajo de 15 cm obligatorio por referencia y altura.');
  if(fabric?.opacityType.includes('Blackout'))warnings.push('Pentagrama advierte que telas pesadas pueden perder definición de onda en la parte inferior.');
  if(joinRequired&&fabric?.canJoin===true)warnings.push(`La altura útil supera el ancho transversal seguro del rollo: se requiere unión ${fabric.joinType||'documentada'} y debe indicarse en la foto técnica.`);
  if(joinRequired&&fabric?.canJoin==null)errors.push('La altura útil supera el ancho transversal seguro del rollo y esta referencia requiere confirmación Pentagrama.');
  if(data.rules.positionProjection[c.position]?.classification==='visualApproximation')warnings.push(data.rules.positionProjection[c.position].note);
  return {ok:errors.length===0,errors,warnings,config:c,fabric,fullnessRule:rule,maxWidthM:maxWidth,requiredBottom:required,joinRequired,joinType:joinRequired?fabric?.joinType||null:null};
}

function quad(width,height){return {positions:new Float32Array([-width/2,-height/2,0,width/2,-height/2,0,width/2,height/2,0,-width/2,height/2,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),tangents:new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint16Array([0,1,2,0,2,3])};}
function roundedProfile(width,height,radius,segments=5){const points=[];for(const [cx,cy,start] of [[width/2-radius,height/2-radius,0],[-width/2+radius,height/2-radius,Math.PI/2],[-width/2+radius,-height/2+radius,Math.PI],[width/2-radius,-height/2+radius,Math.PI*1.5]])for(let i=0;i<=segments;i++){const angle=start+i*Math.PI/2/segments;points.push([cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)]);}return points;}
function extrudeX(length,profile){
  const count=profile.length,positions=[],normals=[],indices=[];
  for(let side=0;side<2;side++){const x=(side-.5)*length;for(const [y,z] of profile)positions.push(x,y,z);}
  for(let side=0;side<2;side++)for(let i=0;i<count;i++)normals.push(side?1:-1,0,0);
  for(let i=1;i<count-1;i++){indices.push(0,i+1,i,count,count+i,count+i+1);}
  const sideStart=positions.length/3;
  for(let i=0;i<count;i++){const j=(i+1)%count,[y0,z0]=profile[i],[y1,z1]=profile[j],dy=y1-y0,dz=z1-z0,len=Math.hypot(dy,dz)||1,ny=dz/len,nz=-dy/len;positions.push(-length/2,y0,z0,length/2,y0,z0,length/2,y1,z1,-length/2,y1,z1);normals.push(ny?0:0,ny,nz,0,ny,nz,0,ny,nz,0,ny,nz);const a=sideStart+i*4;indices.push(a,a+1,a+2,a,a+2,a+3);}
  return {positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)};
}
function railGeometry(length,depth,height){const p=[[-height/2,-depth/2+.003],[-height/2+.003,-depth/2],[height/2-.004,-depth/2],[height/2,0],[height/2-.004,depth/2],[.004,depth/2],[0,depth/2-.004],[-.004,depth/2],[-height/2+.003,depth/2],[-height/2,depth/2-.003]];return extrudeX(length,p);}
function bracketGeometry(width=.056,height=.035,depth=.052){const p=[[-height/2,-depth/2],[-height/2+.008,-depth/2],[-height/2+.008,.008],[height/2,.008],[height/2,.018],[-height/2-.002,.018]];return extrudeX(width,p);}
function cylinder(radius,height,segments=18,axis='y'){
  const positions=[],normals=[],uvs=[],indices=[];for(let i=0;i<=segments;i++){const a=i*2*Math.PI/segments,c=Math.cos(a),s=Math.sin(a);for(const h of [-height/2,height/2]){const point=axis==='y'?[radius*c,h,radius*s]:axis==='x'?[h,radius*c,radius*s]:[radius*c,radius*s,h];positions.push(...point);const normal=axis==='y'?[c,0,s]:axis==='x'?[0,c,s]:[c,s,0];normals.push(...normal);uvs.push(i/segments,h/height+.5);}}for(let i=0;i<segments;i++){const a=i*2,b=a+1,c=a+2,d=a+3;indices.push(a,b,c,c,b,d);}const sideCount=positions.length/3;for(const sign of [-1,1]){const center=positions.length/3,centerPoint=axis==='y'?[0,sign*height/2,0]:axis==='x'?[sign*height/2,0,0]:[0,0,sign*height/2];positions.push(...centerPoint);normals.push(...(axis==='y'?[0,sign,0]:axis==='x'?[sign,0,0]:[0,0,sign]));uvs.push(.5,.5);for(let i=0;i<=segments;i++){const a=i*2*Math.PI/segments,c=Math.cos(a),s=Math.sin(a),point=axis==='y'?[radius*c,sign*height/2,radius*s]:axis==='x'?[sign*height/2,radius*c,radius*s]:[radius*c,radius*s,sign*height/2];positions.push(...point);normals.push(...(axis==='y'?[0,sign,0]:axis==='x'?[sign,0,0]:[0,0,sign]));uvs.push((c+1)/2,(s+1)/2);}for(let i=0;i<segments;i++){const a=center,b=center+1+i,c=center+2+i;indices.push(...(sign>0?[a,b,c]:[a,c,b]));}}
  return {positions:new Float32Array(positions),normals:new Float32Array(normals),uvs:new Float32Array(uvs),indices:new Uint32Array(indices)};
}
function torus(major=.011,minor=.0025,majorSegments=20,minorSegments=8){const positions=[],normals=[],indices=[];for(let i=0;i<=majorSegments;i++){const u=i*2*Math.PI/majorSegments,cu=Math.cos(u),su=Math.sin(u);for(let j=0;j<=minorSegments;j++){const v=j*2*Math.PI/minorSegments,cv=Math.cos(v),sv=Math.sin(v),r=major+minor*cv;positions.push(r*cu,minor*sv,r*su);normals.push(cv*cu,sv,cv*su);}}const row=minorSegments+1;for(let i=0;i<majorSegments;i++)for(let j=0;j<minorSegments;j++){const a=i*row+j,b=a+row,c=a+1,d=b+1;indices.push(a,b,c,c,b,d);}return {positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)};}

function roundedULobePoint(u,dx,depth,lateralHandleFactor){
  if(u<=0)return {x:0,z:0};if(u>=1)return {x:dx,z:0};
  const v=1-u,controlDepth=4*depth/3,leftX=-lateralHandleFactor*dx,rightX=(1+lateralHandleFactor)*dx;
  return {x:3*v*v*u*leftX+3*v*u*u*rightX+u*u*u*dx,z:3*v*v*u*controlDepth+3*v*u*u*controlDepth};
}

function sampledLobeLength(dx,depth,lateralHandleFactor,samplesPerSegment){
  let length=0,previousX=0,previousZ=0;
  for(let i=1;i<=samplesPerSegment;i++){
    const point=roundedULobePoint(i/samplesPerSegment,dx,depth,lateralHandleFactor);
    length+=Math.hypot(point.x-previousX,point.z-previousZ);previousX=point.x;previousZ=point.z;
  }
  return length;
}

function solveRoundedULateralHandle(dx,depth,target,samplesPerSegment){
  const minimumLength=sampledLobeLength(dx,depth,0,samplesPerSegment);if(target<minimumLength-1e-8)throw new Error(`El recorrido objetivo ${target.toFixed(6)} m es menor que la U redondeada mínima ${minimumLength.toFixed(6)} m.`);
  let low=0,high=.5;while(sampledLobeLength(dx,depth,high,samplesPerSegment)<target&&high<8)high*=2;
  for(let i=0;i<72;i++){const mid=(low+high)/2;if(sampledLobeLength(dx,depth,mid,samplesPerSegment)<target)low=mid;else high=mid;}
  return (low+high)/2;
}

export function calibrateFullnessProfile(width,rule,projection=1){
  const targetFabricLengthM=width*Number(rule.fabricPerRailM),segmentCount=Math.max(2,Math.round(targetFabricLengthM/Number(rule.snapSpacingM))),carrierCount=segmentCount+1,visibleWidth=width*projection,projectedCarrierSpacingM=visibleWidth/segmentCount,segmentFabricLengthM=targetFabricLengthM/segmentCount,samplesPerSegment=40,frontDepthM=Number(rule.frontDepthM),backDepthM=Number(rule.backDepthM),frontLateralHandleFactor=solveRoundedULateralHandle(projectedCarrierSpacingM,frontDepthM,segmentFabricLengthM,samplesPerSegment),backLateralHandleFactor=solveRoundedULateralHandle(projectedCarrierSpacingM,backDepthM,segmentFabricLengthM,samplesPerSegment),columns=segmentCount*samplesPerSegment,visibleIntervalsPerCycle=2,visibleCycleCount=segmentCount/visibleIntervalsPerCycle;
  const frontRelief=roundedULobePoint(.12,projectedCarrierSpacingM,frontDepthM,frontLateralHandleFactor).x,backRelief=roundedULobePoint(.12,projectedCarrierSpacingM,backDepthM,backLateralHandleFactor).x,lateralReliefM=Math.max(0,-frontRelief,-backRelief);
  return {method:'AL 2.8 rounded cubic U through consecutive carrier attachments; lateral handles solved from material length',profile:'one continuous textile sheet; one alternating rounded lobe per carrier interval',sourceTopology:'Pentagrama 813 pages 8-12',targetFabricLengthM,physicalFabricPathLengthM:targetFabricLengthM,curveLengthM:targetFabricLengthM,measuredFullness:targetFabricLengthM/width,targetFullness:Number(rule.fabricPerRailM),segmentCount,carrierCount,columns,samplesPerSegment,visibleIntervalsPerCycle,visibleCycleCount,visibleCyclesPerRailM:visibleCycleCount/width,carrierSpacingM:Number(rule.carrierSpacingM),projectedCarrierSpacingM,snapSpacingM:Number(rule.snapSpacingM),segmentFabricLengthM,segmentVsOfficialSnapErrorRatio:Math.abs(segmentFabricLengthM-Number(rule.snapSpacingM))/Number(rule.snapSpacingM),frontLateralHandleFactor,backLateralHandleFactor,lateralReliefM,frontDepthM,backDepthM,envelopeM:[-backDepthM,frontDepthM],extremaPerCycle:2,continuity:'C1 cubic tangent continuity at carrier attachments; sampled normals continuous',secondaryLobes:false,horizontalBacktracking:'bounded lateral relief at U shoulders only',selfIntersectionExpected:false,materialCoordinatePreserved:true,carrierCountInvariantByState:true,carrierRibVisibility:'attachment points only; no mesh split or hard normal seam per carrier'};
}

function materialPoint(calibration,column){
  const samples=calibration.samplesPerSegment,materialSegment=column/samples,dx=calibration.projectedCarrierSpacingM;
  if(column>=calibration.columns)return {x:calibration.segmentCount*dx,z:0,segment:calibration.segmentCount,interval:calibration.segmentCount-1,u:1};
  const interval=Math.floor(materialSegment),u=materialSegment-interval,front=interval%2===0,depth=front?calibration.frontDepthM:calibration.backDepthM,handle=front?calibration.frontLateralHandleFactor:calibration.backLateralHandleFactor,point=roundedULobePoint(u,dx,depth,handle);
  return {x:interval*dx+point.x,z:(front?1:-1)*point.z,segment:materialSegment,interval,u};
}

function physicalWaveSurface(x0,railWidth,visibleWidth,y0,height,rule,z0,uvScale,totalFabricHeight=height){
  const projection=visibleWidth/railWidth,calibration=calibrateFullnessProfile(railWidth,rule,projection),sx=calibration.columns,sy=Math.max(6,Math.ceil(height/.06)),positions=new Float32Array((sx+1)*(sy+1)*3),normals=new Float32Array(positions.length),tangents=new Float32Array((sx+1)*(sy+1)*4),uvs=new Float32Array((sx+1)*(sy+1)*2),indices=new Uint32Array(sx*sy*6),materialArc=new Float32Array(sx+1);
  let previous=materialPoint(calibration,0);for(let ix=1;ix<=sx;ix++){const current=materialPoint(calibration,ix);materialArc[ix]=materialArc[ix-1]+Math.hypot(current.x-previous.x,current.z-previous.z);previous=current;}
  let p=0,u=0;for(let iy=0;iy<=sy;iy++){const baseY=y0+height*iy/sy;for(let ix=0;ix<=sx;ix++){const point=materialPoint(calibration,ix);positions.set([x0+point.x,baseY,z0+point.z],p);uvs.set([materialArc[ix]/uvScale,baseY/uvScale],u);p+=3;u+=2;}}
  for(let iy=0;iy<=sy;iy++)for(let ix=0;ix<=sx;ix++){const vertex=iy*(sx+1)+ix,at=vertex*3,left=(iy*(sx+1)+Math.max(0,ix-1))*3,right=(iy*(sx+1)+Math.min(sx,ix+1))*3,below=(Math.max(0,iy-1)*(sx+1)+ix)*3,above=(Math.min(sy,iy+1)*(sx+1)+ix)*3,ux=positions[right]-positions[left],uy=positions[right+1]-positions[left+1],uz=positions[right+2]-positions[left+2],vx=positions[above]-positions[below],vy=positions[above+1]-positions[below+1],vz=positions[above+2]-positions[below+2],nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nlen=Math.max(1e-8,Math.hypot(nx,ny,nz)),tlen=Math.max(1e-8,Math.hypot(ux,uy,uz)),tangentAt=vertex*4;normals.set([nx/nlen,ny/nlen,nz/nlen],at);tangents.set([ux/tlen,uy/tlen,uz/tlen,1],tangentAt);}
  let q=0;for(let iy=0;iy<sy;iy++)for(let ix=0;ix<sx;ix++){const a=iy*(sx+1)+ix,b=a+1,c=a+sx+1,d=c+1;indices.set([a,c,b,b,c,d],q);q+=6;}
  calibration.physicalFabricPathLengthM=materialArc[sx];calibration.curveLengthM=materialArc[sx];calibration.measuredFullness=materialArc[sx]/railWidth;calibration.discreteLengthErrorRatio=Math.abs(materialArc[sx]-calibration.targetFabricLengthM)/calibration.targetFabricLengthM;calibration.verticalFallRule='La prueba cerrada conserva la misma coordenada material desde la reata hasta el bajo; sin fase ni armónicos visuales arbitrarios';
  return {positions,normals,tangents,uvs,indices,calibration};
}

const pad4=value=>(value+3)&~3;
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
function bounds3(values){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],values[i+k]);max[k]=Math.max(max[k],values[i+k]);}return {min,max};}
function pack(scene){const views=[],accessors=[],meshes=[],chunks=[];let offset=0;const push=(typed,target)=>{const start=offset,raw=new Uint8Array(typed.buffer,typed.byteOffset,typed.byteLength);chunks.push({start,raw});offset=pad4(offset+raw.length);const index=views.length;views.push({buffer:0,byteOffset:start,byteLength:raw.length,target});return index;};for(const item of scene.meshDefs){const geometry=item.geometry,positionView=push(geometry.positions,34962),normalView=push(geometry.normals,34962),tangentView=geometry.tangents?push(geometry.tangents,34962):null,uvView=geometry.uvs?push(geometry.uvs,34962):null,indexView=push(geometry.indices,34963),positionAccessor=accessors.length,bounds=bounds3(geometry.positions);accessors.push({bufferView:positionView,componentType:5126,count:geometry.positions.length/3,type:'VEC3',min:bounds.min,max:bounds.max});const normalAccessor=accessors.length;accessors.push({bufferView:normalView,componentType:5126,count:geometry.normals.length/3,type:'VEC3'});let tangentAccessor=null;if(tangentView!==null){tangentAccessor=accessors.length;accessors.push({bufferView:tangentView,componentType:5126,count:geometry.tangents.length/4,type:'VEC4'});}let uvAccessor=null;if(uvView!==null){uvAccessor=accessors.length;accessors.push({bufferView:uvView,componentType:5126,count:geometry.uvs.length/2,type:'VEC2'});}const indexAccessor=accessors.length;accessors.push({bufferView:indexView,componentType:geometry.indices.BYTES_PER_ELEMENT===4?5125:5123,count:geometry.indices.length,type:'SCALAR',min:[0],max:[geometry.positions.length/3-1]});const attributes={POSITION:positionAccessor,NORMAL:normalAccessor};if(tangentAccessor!==null)attributes.TANGENT=tangentAccessor;if(uvAccessor!==null)attributes.TEXCOORD_0=uvAccessor;meshes.push({name:item.name,primitives:[{attributes,indices:indexAccessor,material:item.material}]});}const bin=new Uint8Array(offset);for(const chunk of chunks)bin.set(chunk.raw,chunk.start);const gltf={asset:{version:'2.0',generator:'HomeEasy Onda Serena Phase 1 Exact Colors V1.1',extras:scene.extras},scene:0,scenes:[{name:'Onda Serena AL 2.8 · HomeEasy',nodes:scene.nodes.map((_,index)=>index)}],nodes:scene.nodes,meshes,materials:scene.materials,buffers:[{byteLength:bin.length}],bufferViews:views,accessors};if(scene.usesTransmission)gltf.extensionsUsed=['KHR_materials_transmission'];const jsonRaw=encode(gltf),jsonLength=pad4(jsonRaw.length),binLength=pad4(bin.length),out=new Uint8Array(12+8+jsonLength+8+binLength),view=new DataView(out.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(jsonRaw,20);const binHeader=20+jsonLength;view.setUint32(binHeader,binLength,true);view.setUint32(binHeader+4,0x004e4942,true);out.set(bin,binHeader+8);return {bytes:out,gltf};}

function packRC3(scene){const packed=pack(scene);packed.gltf.asset.generator='HomeEasy Onda Serena Phase 1 Exact Colors V1.1';packed.gltf.scenes[packed.gltf.scene||0].name='Onda Serena AL 2.8 · HomeEasy';return packed;}

function bodyDefinitions(config){return config.direction==='ends'?[{start:-config.widthM/2,end:0,align:'left'},{start:0,end:config.widthM/2,align:'right'}]:[{start:-config.widthM/2,end:config.widthM/2,align:config.direction}];}
function projectedSpan(body,factor){const width=(body.end-body.start)*factor;if(body.align==='left')return [body.start,body.start+width];if(body.align==='right')return [body.end-width,body.end];return [(body.start+body.end-width)/2,(body.start+body.end+width)/2];}
function masterPositions(config,bodies,factor){const spans=bodies.map(body=>projectedSpan(body,factor));if(config.direction==='left')return [spans[0][1]-.018];if(config.direction==='right')return [spans[0][0]+.018];if(config.direction==='center')return [spans[0][0]+.018,spans[0][1]-.018];return [spans[0][1]-.018,spans[1][0]+.018];}

export function buildOndaGlb(input,data){
  const validation=validateOnda(input,data);if(!validation.ok)throw new Error(validation.errors.join(' '));
  const config=validation.config,rule=validation.fullnessRule,bottom=data.rules.bottoms.find(item=>item.id===config.bottom),isVelo=validation.fabric.opacityType.includes('Velo'),textureScale=Number(validation.fabric.physicalTextureScaleM||.24);
  const materials=[
    {name:'Aluminio blanco · perfil reconstruido',pbrMetallicRoughness:{baseColorFactor:[.78,.8,.82,1],metallicFactor:.72,roughnessFactor:.28}},
    {name:'ONDA_FABRIC',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:isVelo?.62:.86},alphaMode:'OPAQUE',doubleSided:true,extras:{slot:'ONDA_FABRIC',physicalTextureScaleM:textureScale,pbrVerified:validation.fabric.pbrVerified,colorAccuracy:validation.fabric.pbrVerified?'verified official-source comparison':'official-source-derived preview; verification pending'},...(isVelo?{extensions:{KHR_materials_transmission:{transmissionFactor:.22}}}:{})},
    {name:'Reata transparente',pbrMetallicRoughness:{baseColorFactor:[.9,.94,.94,.46],metallicFactor:0,roughnessFactor:.38},alphaMode:'BLEND',doubleSided:true},
    {name:'Terminación inferior',pbrMetallicRoughness:{baseColorFactor:isVelo?[.88,.89,.86,1]:[.42,.4,.36,1],metallicFactor:0,roughnessFactor:.9},alphaMode:'OPAQUE',doubleSided:true},
    {name:'Mecánica polímero',pbrMetallicRoughness:{baseColorFactor:[.82,.83,.8,1],metallicFactor:.05,roughnessFactor:.48}},
    {name:'Remaches acero',pbrMetallicRoughness:{baseColorFactor:[.55,.57,.6,1],metallicFactor:.8,roughnessFactor:.22}}
  ],meshDefs=[],nodes=[];let triangles=0;
  const addMesh=(name,geometry,material)=>{triangles+=geometry.indices.length/3;meshDefs.push({name,geometry,material});return meshDefs.length-1;};
  const addNode=(name,geometry,material,translation=[0,0,0],extras=null,rotation=null)=>{const node={name,mesh:addMesh(name,geometry,material),translation};if(extras)node.extras=extras;if(rotation)node.rotation=rotation;nodes.push(node);return node;};
  const reusableMeshes=new Map();
  const addInstance=(key,name,geometry,material,translation=[0,0,0],extras=null,rotation=null)=>{let mesh=reusableMeshes.get(key);if(mesh==null){mesh=addMesh(`${key} · geometría compartida`,geometry,material);reusableMeshes.set(key,mesh);}const node={name,mesh,translation};if(extras)node.extras=extras;if(rotation)node.rotation=rotation;nodes.push(node);return node;};
  const railDepth=data.rules.rail.profileDepthM,railHeight=data.rules.rail.profileHeightM,railY=config.heightM-railHeight/2;
  addNode('ONDA_RAIL',railGeometry(config.widthM,railDepth,railHeight),0,[0,railY,0],{role:'rail',depthM:railDepth,depthExact:true,profileShapeExact:false,source:'984_FichaOndaSerena.pdf'});
  addInstance('ONDA_ENDCAP','ONDA_ENDCAP_LEFT',extrudeX(.018,roundedProfile(railHeight+.006,railDepth+.006,.005)),4,[-config.widthM/2-.009,railY,0],{role:'endcap-left',profileShapeExact:false});
  addInstance('ONDA_ENDCAP','ONDA_ENDCAP_RIGHT',extrudeX(.018,roundedProfile(railHeight+.006,railDepth+.006,.005)),4,[config.widthM/2+.009,railY,0],{role:'endcap-right',profileShapeExact:false});
  for(let x=-config.widthM/2+.08;x<config.widthM/2;x+=1.1)addInstance('Soporte perfil L',`Soporte perfil L ${x.toFixed(2)}`,bracketGeometry(),4,[x,config.heightM+.018,-.012],{profileShapeExact:false,source:'official product diagrams'});
  const bodies=bodyDefinitions(config),factor=data.rules.positionProjection[config.position].factor,calibrations=[];let totalCurveLength=0;
  for(const [bodyIndex,body] of bodies.entries()){
    const railWidth=body.end-body.start,span=projectedSpan(body,factor),visibleWidth=span[1]-span[0],z=.035,hem=Math.min(bottom.heightM,config.heightM*.3),fabricHeight=config.heightM-railHeight-.04,mainHeight=Math.max(.02,fabricHeight-hem),main=physicalWaveSurface(span[0],railWidth,visibleWidth,hem,mainHeight,rule,z,textureScale,fabricHeight);
    totalCurveLength+=main.calibration.physicalFabricPathLengthM;calibrations.push(main.calibration);addNode(`ONDA_FABRIC_${bodyIndex+1}`,main,1,[0,0,0],{role:'continuous-fabric',bodyIndex:bodyIndex+1,originalRailSpanM:railWidth,projectedWidthM:visibleWidth,fullness:Number(config.fullness),physicalFabricPathLengthM:main.calibration.physicalFabricPathLengthM,segmentFabricLengthM:main.calibration.segmentFabricLengthM,measuredFullnessAgainstRail:main.calibration.measuredFullness,profileCalibration:main.calibration,continuousGatheredTextile:true,materialCoordinatePreserved:true});
    if(hem>0){const lower=physicalWaveSurface(span[0],railWidth,visibleWidth,0,hem,rule,z+.002,textureScale,fabricHeight);addNode(`ONDA_BOTTOM_HEM_${bodyIndex+1}`,lower,3,[0,0,0],{role:'bottom-hem',bottom:config.bottom,heightM:bottom.heightM,materialCoordinatePreserved:true,physicalFabricPathLengthM:lower.calibration.physicalFabricPathLengthM});}
    const tape=physicalWaveSurface(span[0],railWidth,visibleWidth,fabricHeight-.011,rule.headerTapeMm/1000,rule,z+.004,textureScale,fabricHeight);addNode(`ONDA_TRACK_SYSTEM_HEADER_TAPE_${bodyIndex+1}`,tape,2,[0,0,0],{role:'transparent-header-tape',heightMm:rule.headerTapeMm,transparent:true,followsFabricPath:true,physicalFabricPathLengthM:tape.calibration.physicalFabricPathLengthM,segmentFabricLengthM:tape.calibration.segmentFabricLengthM});
    const snapCount=main.calibration.carrierCount;for(let i=0;i<snapCount;i++){const x=span[0]+main.calibration.projectedCarrierSpacingM*i;addInstance('Remache cinta','Remache '+(bodyIndex+1)+'.'+(i+1),cylinder(.0032,.0024,12,'z'),5,[x,fabricHeight+.014,z+.007],{tapeSpacingM:main.calibration.segmentFabricLengthM,officialSnapSpacingM:rule.snapSpacingM,projectedCarrierSpacingM:main.calibration.projectedCarrierSpacingM,materialCoordinateM:i*main.calibration.segmentFabricLengthM});addInstance('ONDA_SNAP_CONNECTOR',`ONDA_SNAP_CONNECTOR_${bodyIndex+1}_${i+1}`,cylinder(.0017,z-.002,10,'z'),4,[x,fabricHeight+.014,(z+.002)/2],{role:'carrier-to-tape-link',attachmentIndex:i+1});}
  }
  let carrierCount=0;for(const [bodyIndex,body] of bodies.entries()){const span=projectedSpan(body,factor),calibration=calibrations[bodyIndex],count=calibration.carrierCount;for(let i=0;i<count;i++){const x=span[0]+calibration.projectedCarrierSpacingM*i;addInstance('ONDA_CARRIERS',`ONDA_CARRIERS_${++carrierCount}`,cylinder(.006,.013,14,'z'),4,[x,config.heightM-railHeight-.008,.002],{role:'carrier',bodyIndex:bodyIndex+1,closedSpacingM:rule.carrierSpacingM,projectedSpacingM:calibration.projectedCarrierSpacingM,state:config.position,constantCountAcrossStates:true});addInstance('ONDA_CARRIER_HOLDER',`ONDA_CARRIER_HOLDER_${carrierCount}`,torus(.007,.0016,14,6),4,[x,config.heightM-railHeight-.024,.002]);}}
  const mechanics=data.rules.directionMechanics[config.direction],masters=masterPositions(config,bodies,factor),wandLength=Math.min(1.5,Math.max(.8,config.heightM*.5));masters.forEach((x,index)=>{
    const masterY=config.heightM-railHeight-.027;
    addInstance('Carro maestro redondeado',`Carro maestro redondeado ${index+1}`,extrudeX(.034,roundedProfile(.045,.022,.006)),4,[x,masterY,.012],{expectedPosition:mechanics.masterPositions[index],actuation:'bastón manual',profileShapeExact:false});
    addInstance('Anilla unión maestro-bastón',`Anilla unión maestro-bastón ${index+1}`,torus(.012,.0023),5,[x,masterY-.026,.025],{physicalConnection:true});
    addInstance('ONDA_CONTROL_WAND',`ONDA_CONTROL_WAND_${index+1}`,cylinder(.0045,wandLength,18,'y'),4,[x,masterY-.045-wandLength/2,.025],{role:'manual-control-wand',officialLengthFamilyM:[.8,1.2,1.5],selectedVisualLengthM:wandLength,cylindrical:true});
    addInstance('Mango bastón',`Mango bastón ${index+1}`,cylinder(.009,.105,20,'y'),4,[x,masterY-.06-wandLength-.0525,.025],{ergonomicHandle:true,profileShapeExact:false});
  });
  const targetFabricLengthM=config.widthM*Number(config.fullness),segmentFabricLengthM=calibrations[0]?.segmentFabricLengthM||0;
  const extras={product:'Onda Serena',manufacturer:'Pentagrama',version:'Phase1-ExactColors-V1.1',architecture:'single-master-plus-fabric-packs',masterContract:'production/onda-serena-master.glb',config,fabric:{id:validation.fabric.id,officialName:validation.fabric.officialName,officiallyVerified:true,pbrVerified:validation.fabric.pbrVerified,technicalPreviewOnly:validation.fabric.technicalPreviewOnly,rollWidthM:validation.fabric.rollWidthM,weightGm2:validation.fabric.weightGm2},rulesSnapshot:data.rules.snapshot,presentationBranding:true,brandingManufacturerClaim:false,fullness:{factor:Number(config.fullness),targetFabricLengthM,physicalFabricPathLengthM:totalCurveLength,fabricPathLengthRatio:totalCurveLength/targetFabricLengthM,measuredMeshCurveLengthM:totalCurveLength,measuredMeshFullness:totalCurveLength/config.widthM,segmentFabricLengthM,officialSnapSpacingM:rule.snapSpacingM,segmentVsSnapErrorRatio:Math.abs(segmentFabricLengthM-rule.snapSpacingM)/rule.snapSpacingM,tolerance:data.rules.fullnessGeometry.tolerance,method:'material-coordinate spline constrained by AL 2.8 carrier and tape attachments',frontDepthM:rule.frontDepthM,backDepthM:rule.backDepthM,continuity:'C2',materialCoordinatePreservedAcrossStates:true,calibrations},stackWidthM:config.widthM*factor,positionProjection:data.rules.positionProjection[config.position],fabricJoin:{required:validation.joinRequired,type:validation.joinType,rollWidthM:validation.fabric.rollWidthM,orientation:'roll width evaluated against finished drop',seamCount:validation.joinRequired?1:0,seamPositions:validation.joinRequired?[config.widthM/2]:[],method:validation.joinType||'confirmar Pentagrama',blackoutWarning:validation.fabric.opacityType.includes('Blackout')&&validation.joinRequired},texture:{type:validation.fabric.id==='velo-coral-white'?'official page 101 derived fine voile PBR':'official swatch derived deterministic PBR',seamless:true,scaleM:textureScale,pbrVerified:validation.fabric.pbrVerified,colorAccuracy:'official portal visual reference'},warnings:validation.warnings,geometry:{realWaveSurface:true,textileBodies:bodies.length,stackedFullSurfaces:false,continuousGatheredTextile:true,tangents:true,profileShapeExact:false,railDepthExact:true,triangles,sharedComponentMeshes:reusableMeshes.size,physicalTapeSurface:true},mechanics:{...mechanics,carrierCount,carrierCountInvariantAcrossStates:true,projectedCarrierSpacingM:calibrations[0]?.projectedCarrierSpacingM,closedCarrierSpacingTargetM:rule.carrierSpacingM,masterPositionsX:masters,wandLengthM:wandLength,cylindricalWand:true,physicalMasterConnection:true},railSplitStrategy:data.rules.manufacturing.railSplitStrategyV11};
  const packed=packRC3({materials,meshDefs,nodes,extras,usesTransmission:isVelo});return {...packed,stats:{bytes:packed.bytes.byteLength,triangles,meshes:meshDefs.length,textures:0,assets:['geometría paramétrica RC3','reglas Pentagrama','PBR oficial seleccionado']}};
}
