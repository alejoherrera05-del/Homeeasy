const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/ETAPA_10B_COSTOS_PENTAGRAMA.gs'),'utf8');
const ctx={console,Utilities:{formatDate:()=> '2026-10-02'},CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})}};
vm.createContext(ctx);vm.runInContext(source,ctx);

const catalog={version:'2026-10-02.1',validThrough:'2026-10-31',currency:'COP',pricesIncludeVat:true,matrixCount:1,products:[
 {id:'onda-67',family:'onda',familyName:'Onda Serena',name:'Velo Coral White',type:'Velo',method:'area',rateCents:11470410,minHeightMm:1300,minAreaMm2:1600000,extraDiscount:0,promotional:false,configuration:'Al 2,8 · bastón',active:true,status:'VIGENTE',matrixCells:[]},
 {id:'onda-33',family:'onda',familyName:'Onda Serena',name:'Traslucente Reverso',type:'Traslucente',method:'area',rateCents:13644540,minHeightMm:1300,minAreaMm2:1600000,extraDiscount:0,promotional:false,configuration:'Al 2,8 · bastón',active:true,status:'VIGENTE',matrixCells:[]},
 {id:'matrix-1',family:'vertesse',familyName:'Sheer Vertesse',name:'Regular',type:'',method:'matrix',rateCents:0,minHeightMm:0,minAreaMm2:0,extraDiscount:0,promotional:false,configuration:'Manual',active:true,status:'VIGENTE',matrixCells:[{minHeightMm:500,maxHeightMm:1250,minWidthMm:350,maxWidthMm:600,cents:39209310}]}
]};

let r=ctx.calcularItemCostos10B_({product:'onda-67',width:'1',height:'1',quantity:'1',extras:'0'},catalog,{today:'2026-10-02',promotions:true,installMode:'common',installation:'0'});
assert.equal(r.ok,true);assert.equal(r.unit,18352656);

r=ctx.calcularItemCostos10B_({product:'onda-67',width:'2',height:'1',quantity:'1',extras:'0'},catalog,{today:'2026-10-02',promotions:true,installMode:'common',installation:'0'});
assert.equal(r.unit,29823066);

r=ctx.calcularItemCostos10B_({product:'onda-33',width:'1.90',height:'2.46',quantity:'1',extras:'0'},catalog,{today:'2026-10-02',promotions:true,installMode:'common',installation:'0'});
assert.equal(r.unit,63774580);

r=ctx.calcularItemCostos10B_({product:'matrix-1',width:'0.5',height:'1',quantity:'1',extras:'0'},catalog,{today:'2026-10-02',promotions:true,installMode:'common',installation:'0'});
assert.equal(r.unit,39209310);

const q=ctx.calcularQuoteCostos10B_({items:[{product:'onda-67',width:'1',height:'1',quantity:'1',extras:'0'}],transport:'0',installation:'0',margin:'30',installMode:'common',promotions:true},catalog,'2026-10-02');
assert.equal(q.ok,true);assert.equal(q.sale,26218100);
console.log('HomeEasy 10B cost math QA OK');