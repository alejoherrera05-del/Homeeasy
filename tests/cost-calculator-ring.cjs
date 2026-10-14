const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../apps-script/ETAPA_10B_COSTOS_PENTAGRAMA.gs'),'utf8');

const Utilities={
  formatDate:()=> '2026-10-14',
  base64Decode:value=>Buffer.from(String(value),'base64'),
  newBlob:bytes=>({bytes:Buffer.from(bytes)}),
  ungzip:blob=>({
    getDataAsString:()=>zlib.gunzipSync(blob.bytes).toString('utf8')
  })
};
const CacheService={getScriptCache:()=>({get:()=>null,put:()=>{}})};
const ctx={console,Utilities,CacheService};
vm.createContext(ctx);
vm.runInContext(source,ctx);

const products=ctx.productosRingCertificados10B_('2026-10-14-ring','2026-10-31');
assert.equal(products.length,238);

const active=products.filter(p=>p.active);
assert.equal(active.length,237);
assert.equal(active.filter(p=>p.type==='Velo').length,82);
assert.equal(active.filter(p=>p.type==='Traslúcido').length,48);
assert.equal(active.filter(p=>p.type==='Blackout').length,107);

assert.ok(products.every(p=>p.family==='ring'));
assert.ok(products.every(p=>p.familyName==='Cortina Ring'));
assert.ok(products.every(p=>p.rules.groupCode==='1346'));
assert.ok(products.every(p=>p.rules.associationGroup==='RIECORIN'));
assert.ok(products.every(p=>!/^Renueva\b/i.test(p.name)));

const calace=products.find(p=>p.rules.productCode==='CORONSERIVECAWH');
assert.ok(calace);
assert.equal(calace.active,false);
assert.equal(calace.rateCents,0);
assert.equal(calace.status,'REVIEW_REQUIRED');

const angolo=products.find(p=>p.rules.productCode==='CORONSERIVEANGGRE');
assert.ok(angolo);
assert.equal(angolo.rateCents,11095560);
assert.equal(angolo.configuration,'Sistema Ring al 2.0 · tubo con anillos. Configuración Pentagrama: color de anillos, recogida, altura de confección, bajo, dirección de tela y correa opcional.');

const catalog={
  version:'2026-10-14-ring',
  validThrough:'2026-10-31',
  currency:'COP',
  pricesIncludeVat:true,
  matrixCount:0,
  products
};

const one=ctx.calcularItemCostos10B_(
  {product:angolo.id,width:'1',height:'1',quantity:'1',extras:'0'},
  catalog,
  {today:'2026-10-14',promotions:true,installMode:'common',installation:'0'}
);
assert.equal(one.ok,true);
assert.equal(one.unit,11095560);

const decimal=ctx.calcularItemCostos10B_(
  {product:angolo.id,width:'1.83',height:'2.2',quantity:'1',extras:'0'},
  catalog,
  {today:'2026-10-14',promotions:true,installMode:'common',installation:'0'}
);
assert.equal(decimal.ok,true);
assert.equal(decimal.unit,44670725);

for(const type of ['Traslúcido','Blackout']){
  const product=active.find(p=>p.type===type);
  assert.ok(product,'Debe existir una referencia activa '+type);
  const result=ctx.calcularItemCostos10B_(
    {product:product.id,width:'1',height:'1',quantity:'1',extras:'0'},
    catalog,
    {today:'2026-10-14',promotions:true,installMode:'common',installation:'0'}
  );
  assert.equal(result.ok,true,type+' debe cotizar localmente');
  assert.equal(result.unit,product.rateCents,type+' debe conservar su tarifa individual certificada');
}

const blocked=ctx.calcularItemCostos10B_(
  {product:calace.id,width:'1',height:'1',quantity:'1',extras:'0'},
  catalog,
  {today:'2026-10-14',promotions:true,installMode:'common',installation:'0'}
);
assert.equal(blocked.ok,false);

const quote=ctx.calcularQuoteCostos10B_(
  {items:[{product:angolo.id,width:'1',height:'1',quantity:'1',extras:'0'}],transport:'0',installation:'0',margin:'30',installMode:'common',promotions:true},
  catalog,
  '2026-10-14'
);
assert.equal(quote.ok,true);
assert.equal(quote.products,11095560);
assert.equal(quote.cost,11095560);
assert.equal(quote.sale,Math.ceil((quote.cost/(1-0.30))/100)*100,'El margen debe aplicarse después del costo proveedor');

console.log('PASS Cortina Ring 10B: 238 catalogadas, 237 activas, Velo/Traslúcido/Blackout cotizan, Renueva excluido, Calace bloqueada y margen posterior al proveedor.');
