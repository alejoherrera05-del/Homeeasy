// Datos ficticios: las tarifas reales permanecen en Sheets privados.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const store=new Map();
const ctx={console,Utilities:{formatDate:()=> '2026-10-02'},CacheService:{getScriptCache:()=>({get:k=>store.get(k)||null,put:(k,v)=>store.set(k,v)})}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/ETAPA_10B_COSTOS_PENTAGRAMA.gs'),'utf8'),ctx);
const base={family:'enrollable',familyName:'Enrollables',type:'Blackout',method:'area',rateCents:10000,minHeightMm:1000,minAreaMm2:1000000,extraDiscount:0,promotional:true,configuration:'Manual',active:true,status:'VIGENTE',validThrough:'2026-10-31',currency:'COP',pricesIncludeVat:true,matrixCells:[]};
const sizeRuleId='pentagrama-standard-manual-nov2025';
const group5=[
 {maxWidthMm:1300,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},
 {maxWidthMm:1300,maxHeightMm:3500,mechanism:'VTX-15 o Clic M',tube:'T38'},
 {maxWidthMm:1900,maxHeightMm:3200,mechanism:'VTX-20 o Clic M',tube:'T38'},
 {maxWidthMm:2600,maxHeightMm:3200,mechanism:'VTX-20 o Clic M',tube:'T50'},
 {maxWidthMm:3000,maxHeightMm:2800,mechanism:'VTX-20 o Clic M',tube:'T50'}
];
const sizePolicy={id:sizeRuleId,source:'Tabla de cabezales Pentagrama Nov 2025',configurations:{
 standard:{label:'Standard manual sin cabezal',groups:{
  '1':[{maxWidthMm:1600,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},{maxWidthMm:1600,maxHeightMm:3500,mechanism:'VTX-15 o Clic M',tube:'T38'},{maxWidthMm:2600,maxHeightMm:3200,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:3000,maxHeightMm:3100,mechanism:'VTX-20 o Clic M',tube:'T50'},{maxWidthMm:3200,maxHeightMm:2800,mechanism:'VTX-20 o Clic M',tube:'T50'}],
  '2':[{maxWidthMm:1600,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},{maxWidthMm:1600,maxHeightMm:3200,mechanism:'VTX-15 o Clic M',tube:'T38'},{maxWidthMm:2600,maxHeightMm:3200,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:3000,maxHeightMm:3100,mechanism:'VTX-20 o Clic M',tube:'T50'},{maxWidthMm:3200,maxHeightMm:2600,mechanism:'VTX-20 o Clic M',tube:'T50'}],
  '3':[{maxWidthMm:1600,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},{maxWidthMm:1600,maxHeightMm:3200,mechanism:'VTX-15 o Clic M',tube:'T38'},{maxWidthMm:2200,maxHeightMm:3000,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:2600,maxHeightMm:2800,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:3000,maxHeightMm:1800,mechanism:'VTX-20 o Clic M',tube:'T50'},{maxWidthMm:3200,maxHeightMm:1200,mechanism:'VTX-20 o Clic M',tube:'T50'}],
  '4':[{maxWidthMm:1300,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},{maxWidthMm:1300,maxHeightMm:2800,mechanism:'VTX-15 o Clic M',tube:'T38'},{maxWidthMm:1900,maxHeightMm:2700,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:2600,maxHeightMm:2500,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:2800,maxHeightMm:2500,mechanism:'VTX-20 o Clic M',tube:'T50'},{maxWidthMm:3000,maxHeightMm:1800,mechanism:'VTX-20 o Clic M',tube:'T50'}],
  '4A':[{maxWidthMm:1300,maxHeightMm:2200,mechanism:'VTX-10 o Clic S',tube:'T32'},{maxWidthMm:1300,maxHeightMm:2800,mechanism:'VTX-15 o Clic M',tube:'T38'},{maxWidthMm:1900,maxHeightMm:2700,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:2600,maxHeightMm:2500,mechanism:'VTX-20 o Clic M',tube:'T38'},{maxWidthMm:2800,maxHeightMm:2500,mechanism:'VTX-20 o Clic M',tube:'T50'},{maxWidthMm:3000,maxHeightMm:1800,mechanism:'VTX-20 o Clic M',tube:'T50'}],
  '5':group5,'5B':group5
 }},
 penta13:{label:'Cenefa Penta13 manual',requiresConfirmedCost:true,groups:{
  '3':[{maxWidthMm:2600,maxHeightMm:3200,mechanism:'Clic L',tube:'T50'},{maxWidthMm:3200,maxHeightMm:3200,mechanism:'Clic L',tube:'T63'},{maxWidthMm:3400,maxHeightMm:2900,mechanism:'Clic L',tube:'T63'}],
  '5':[{maxWidthMm:2600,maxHeightMm:3500,mechanism:'Clic L',tube:'T63'},{maxWidthMm:3500,maxHeightMm:2800,mechanism:'Clic L',tube:'T63'}],
  '5B':[{maxWidthMm:2600,maxHeightMm:3500,mechanism:'Clic L',tube:'T63'},{maxWidthMm:3500,maxHeightMm:2800,mechanism:'Clic L',tube:'T63'}]
 }}
}};
const rules={minWidthMm:250,minHeightMm:400,sizeRuleId,sizeGroup:'5',rollWidthMm:3000,canRotate:true,coverlightIds:['cover'],addonIds:['out'],configurations:[{id:'motor',label:'Motorizada',method:'manual'}]};
const products=[{...base,id:'blackout-test',name:'Tela ficticia',rules},{...base,id:'screen-test',name:'Screen ficticio',type:'Screen',rules:{...rules,sizeGroup:'3',coverlightIds:[]}},{...base,id:'cover',name:'Coverlight ficticio',family:'complemento-enrollable',method:'linear-height',rateCents:1000,rules:{maxHeightMm:4870}},{...base,id:'out',name:'Perfil ficticio',family:'complemento-enrollable',method:'linear-width',rateCents:2000,rules:{}}];
const catalog={version:'test',validThrough:'2026-10-31',currency:'COP',pricesIncludeVat:true,matrixCount:0,products,enrollableSizeRules:sizePolicy};
const opts={today:'2026-10-02',promotions:true,installMode:'common',installation:'0'};
const item={product:'blackout-test',width:'1.8',height:'2.3',quantity:'2',extras:'0'};
const run=(patch={},options={})=>ctx.calcularItemCostos10B_({...item,...patch},catalog,{...opts,...options});
assert.equal(run().unit,41400);
assert.equal(run({width:'.5'}).ok,false);
assert.equal(run({width:'0.5',height:'0.6'}).unit,10000);
assert.equal(run({width:'1.8',height:'0.6'}).unit,18000);
assert.equal(run({coverlight:'cover'}).unit,46000);
assert.equal(run({coverlight:'cover'}).total,92000);
assert.equal(run().coverlightOptions[0].costCents,4600);
assert.equal(run({height:'2'}).coverlightOptions[0].costCents,4000);
assert.equal(run({quantity:'9'}).unit,41400); // La tarifa institucional permanece sin aplicar.
assert.equal(run({coverlight:'cover',addons:['out']}).unit,49600);
assert.equal(run({product:'screen-test',coverlight:'cover'}).ok,false);
assert.equal(run({product:'cover'}).ok,false);
assert.equal(run({addons:['out','out']}).ok,false);
assert.equal(run({addons:'out'}).ok,false);
assert.equal(run({addons:['unknown']}).ok,false);
assert.equal(run({configuration:'invented'}).ok,false);
assert.equal(run({width:'0.5',height:'2.5'}).ok,true);
assert.equal(run({width:'2.501'}).ok,true);
assert.equal(run({height:'2.501'}).ok,true);
assert.equal(run({width:'0.2'}).ok,false);
assert.equal(run({height:'0.3'}).ok,false);
assert.equal(run({}, {today:'2026-11-01'}).ok,false);
assert.equal(run({}, {promotions:false}).ok,false);
assert.equal(run({configuration:'motor',manualCost:'200'}).unit,20000);
assert.equal(run({mode:'manual',manualCost:'200',coverlight:'cover'}).ok,false);
assert.equal(run({width:'2',height:'3.2'}).fabrication.tube,'T50');
assert.equal(run({width:'2',height:'3.2'}).fabrication.orientation,'normal');
assert.equal(run({width:'2.6',height:'2.8'}).ok,true); // Sobre el antiguo maxWidth de 2,50 m.
const crossed=ctx.calcularItemCostos10B_({...item,product:'blackout-test',width:'3',height:'2.8'},catalog,opts);
assert.equal(crossed.fabrication.orientation,'normal');
const anirak={...base,id:'anirak-real',name:'Anirak',type:'Traslúcida',promotional:false,rateCents:11695320,rules:{...rules,sizeGroup:'2',rollWidthMm:2400}};
const matte3={...base,id:'matte3-real',name:'Matte 3',promotional:false,rateCents:7009100,rules:{...rules,sizeGroup:'5',rollWidthMm:3000}};
const screenEssential={...base,id:'screen-essential-real',name:'Screen Essential 3005 5%',type:'Screen',promotional:false,rateCents:8771490,rules:{...rules,sizeGroup:'3',rollWidthMm:3000,coverlightIds:[]}};
const autum={...base,id:'autum-real',name:'Autum',type:'Dim Out',promotional:false,rateCents:16418430,rules:{...rules,sizeGroup:'5B',rollWidthMm:2800}};
const screenEstuco={...base,id:'screen-estuco-real',name:'Screen Estuco',type:'Screen',promotional:false,rateCents:7128100,rules:{...rules,sizeGroup:'4A',rollWidthMm:3000,canRotate:false,coverlightIds:[]}};
const extendedCatalog={...catalog,products:[...products,anirak,matte3,screenEssential,autum,screenEstuco]};
const parityCases=[
 ['matte3-real',2,2.4,33643680],['matte3-real',2,2.5,35045500],['matte3-real',2,2.6,36447320],
 ['matte3-real',2,2.8,39250960],['matte3-real',2,3,42054600],['matte3-real',2,3.2,44858240],
 ['anirak-real',2,3,70171920],['anirak-real',2.5,3,87714900],
 ['screen-essential-real',2,3,52628940],['autum-real',2,3,98510580],['screen-estuco-real',2,2.5,35640500]
];
for(const [product,width,height,portalTotalCents] of parityCases){
 const quote=ctx.calcularItemCostos10B_({product,width:String(width),height:String(height),quantity:'1',extras:'0'},extendedCatalog,opts);
 assert.equal(quote.unit,portalTotalCents,`${product} ${width}x${height}`);
}
const critical=ctx.calcularItemCostos10B_({product:'matte3-real',width:'2',height:'3.2',quantity:'1',extras:'0'},extendedCatalog,opts);
assert.equal(critical.unit,44858240);
assert.deepEqual(JSON.parse(JSON.stringify(critical.fabrication)),{supported:true,ruleId:sizeRuleId,sizeGroup:'5',configuration:'standard',orientation:'normal',requiresAuthorization:false,warranty:true,mechanism:'VTX-20 o Clic M',tube:'T50',source:'Tabla de cabezales Pentagrama Nov 2025'});
const added=ctx.calcularItemCostos10B_({product:'anirak-real',width:'2.5',height:'3',quantity:'1',extras:'0'},extendedCatalog,opts);
assert.equal(added.unit,87714900);
assert.equal(added.fabrication.orientation,'atravesada_y_anadida');
assert.equal(added.fabrication.requiresAuthorization,true);
assert.equal(added.fabrication.warranty,false);
const differentGroup=ctx.calcularItemCostos10B_({product:'screen-test',width:'2.3',height:'3',quantity:'1',extras:'0'},catalog,opts);
assert.equal(differentGroup.ok,false);
assert.equal(differentGroup.requiresAlternative,true);
assert.equal(differentGroup.alternatives[0].id,'penta13');
const impossible=run({width:'4.1',height:'4.1'});
assert.equal(impossible.ok,false);
assert.equal(impossible.notManufacturable,true);
assert.equal(impossible.requiresAlternative,false);
const coverSpecial=ctx.calcularItemCostos10B_({product:'matte3-real',width:'2',height:'3.2',quantity:'1',extras:'0',coverlight:'cover'},extendedCatalog,opts);
assert.equal(coverSpecial.unit,44864640);
const sh={getSheetByName(){throw Error('No debe leer Sheets con cache íntegra');}};
store.set('HOMEEASY_COST_CATALOG_V4_SIZE_RULES',JSON.stringify({chunks:2,generation:'test'}));
const serialized=JSON.stringify(catalog),mid=Math.floor(serialized.length/2);
store.set('HOMEEASY_COST_CATALOG_V4_SIZE_RULES:test:0',serialized.slice(0,mid));
store.set('HOMEEASY_COST_CATALOG_V4_SIZE_RULES:test:1',serialized.slice(mid));
const options=ctx.obtenerOpcionesCostos10B_(sh);
const originalLoader=ctx.cargarCatalogoCostos10B_;
ctx.cargarCatalogoCostos10B_=()=>({...catalog,products:[...products,{...base,id:'pending',name:'Pendiente',method:'manual'},{...base,id:'institutional',name:'Tela Institucional (Más de 30m2)',rules},{...base,id:'no-price',name:'Sin tarifa',rateCents:0}]});
assert.equal(ctx.obtenerOpcionesCostos10B_(sh).products.length,2);
ctx.cargarCatalogoCostos10B_=originalLoader;
assert.equal(options.products.length,2);
assert.equal(options.products[0].coverlight[0].id,'cover');
assert.equal('configurations' in options.products[0],false);
assert.equal('configuration' in options.products[0],false);
assert.equal('addons' in options.products[0],false);
for(const p of options.products){assert.equal('rateCents' in p,false);assert.equal('rules' in p,false);}
store.delete('HOMEEASY_COST_CATALOG_V4_SIZE_RULES:test:1');
assert.throws(()=>ctx.cargarCatalogoCostos10B_(sh,false),/No debe leer/);
console.log('Enrollables: bandas Pentagrama, orientación, alternativas, mínimos, IVA, complementos, privacidad y cache OK');
