'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const pool = registry.products.filter(item =>
  item.family === 'Sheer Elegance' &&
  item.status === 'REVIEW_REQUIRED' &&
  item.productCode
);
const wanted = ['Screen Clark','Romantic','Fener','Night'];
const targets = wanted.map(name=>pool.find(x=>x.reference===name)).filter(Boolean);
const dims = [
  {width:1.0,height:1.3},
  {width:1.4,height:1.8},
  {width:1.8,height:2.1}
];

async function post(route, body) {
  const res = await fetch(API + route, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-HomeEasy-Token':TOKEN},
    body:JSON.stringify(body)
  });
  let data=null;
  try { data=await res.json(); } catch {}
  return {ok:res.ok && data && data.ok, status:res.status, data};
}

async function fixedPrice(target,d) {
  const r=await post('/api/pentagrama-sync/catalog',{
    operation:'fixedPrice',
    params:{Code:String(target.productCode),cantidad:1,ancho:d.width,alto:d.height}
  });
  if(!r.ok) return {ok:false,code:String(r.data && (r.data.code||r.data.error)||'FIXED_FAILED')};
  const value=typeof r.data.result==='number'
    ? r.data.result
    : Number(r.data.result && (r.data.result.Price??r.data.result.price??r.data.result.Value??r.data.result.value));
  return {ok:true,value:Number.isFinite(value)?value:null,raw:r.data.result};
}

async function standardPrice(target,d) {
  const r=await post('/api/pentagrama-sync/price',{
    params:{
      ProductCode:String(target.productCode),Quantity:1,Width:String(d.width),Height:String(d.height),
      GroupCode:String(target.groupCode||''),calculationType:'NormalProduct',Degrees:'',Panels:0,Cabezal:'',
      ItemCodeFather:'',AssociationGroup:'SHEERSTD',Group:'SHEERSTD',Discount:0
    },
    options:{productDiscount:0,pricingMode:'account-discount'}
  });
  if(!r.ok) return {ok:false,code:String(r.data && (r.data.code||r.data.error)||'PRICE_FAILED')};
  return {ok:true,basePrice:Number(r.data.result?.basePrice||0),total:Number(r.data.result?.total||0)};
}

(async()=>{
  const rows=[];
  for(const target of targets){
    const samples=[];
    for(const d of dims){
      const fixed=await fixedPrice(target,d);
      const standard=await standardPrice(target,d);
      samples.push({...d,fixed,standard});
    }
    rows.push({reference:target.reference,productCode:target.productCode,groupCode:target.groupCode,samples});
  }
  console.log(JSON.stringify({summary:{references:rows.length,reads:rows.length*dims.length*2},rows}));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_FIXED_PRICE_DIAG_FAILED')}));
  process.exitCode=1;
});
