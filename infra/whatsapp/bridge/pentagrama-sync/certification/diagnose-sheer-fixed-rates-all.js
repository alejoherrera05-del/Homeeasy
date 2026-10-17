'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HomeEasySyncClient } = require(path.join(__dirname, '..', 'homeeasy-sync'));

const API = process.env.PENTAGRAMA_BRIDGE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.BRIDGE_TOKEN || '';
if (!TOKEN) throw new Error('BRIDGE_TOKEN is required');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog-certifications.json'), 'utf8'));
const targets = registry.products
  .filter(item =>
    item.family === 'Sheer Elegance' &&
    item.status === 'REVIEW_REQUIRED' &&
    item.productCode
  )
  .map(item => ({
    homeeasyId: item.homeeasyId,
    reference: item.reference,
    productCode: String(item.productCode),
    groupCode: String(item.groupCode || '')
  }));

const samples = [
  { id:'a', width:1.0, height:1.3 },
  { id:'b', width:1.4, height:1.8 },
  { id:'c', width:1.8, height:2.1 }
];

function round(n,p=2){
  const f=10**p;
  return Math.round(Number(n||0)*f)/f;
}

async function post(route, body) {
  const res = await fetch(API + route, {
    method:'POST',
    headers:{'Content-Type':'application/json','X-HomeEasy-Token':TOKEN},
    body:JSON.stringify(body)
  });
  let data=null;
  try { data=await res.json(); } catch {}
  return {ok:res.ok && data && data.ok, data};
}

async function fixedPrice(target, sample) {
  const r=await post('/api/pentagrama-sync/catalog',{
    operation:'fixedPrice',
    params:{Code:target.productCode,cantidad:1,ancho:sample.width,alto:sample.height}
  });
  if(!r.ok) return {ok:false,code:String(r.data && (r.data.code||r.data.error)||'FIXED_FAILED')};
  const raw=r.data.result;
  const value=typeof raw==='number'
    ? raw
    : Number(raw && (raw.Price??raw.price??raw.Value??raw.value));
  return {ok:true,value:Number.isFinite(value)?value:null,raw};
}

(async()=>{
  const homeeasy = new HomeEasySyncClient();
  const catalog = await homeeasy.catalog({
    serviceKey: process.env.HOMEEASY_PENTAGRAMA_SYNC_KEY,
    deviceId: 'sheer-fixed-rate-diagnostic',
    deviceName: 'Sheer Fixed Rate Diagnostic',
    platform: 'VPS',
    browser: 'Node'
  });
  const sourceById = new Map((catalog.products || []).map(p => [String(p.id),p]));

  const rows=[];
  for(const target of targets){
    const source=sourceById.get(String(target.homeeasyId)) || null;
    const reads=[];
    for(const sample of samples){
      const p=await fixedPrice(target,sample);
      const area=sample.width*sample.height;
      reads.push({
        ...sample,
        area:round(area,4),
        ok:p.ok,
        code:p.code||null,
        fixed:p.value,
        rateM2:p.ok && Number(p.value)>0 ? round(Number(p.value)/area,2) : null
      });
    }

    const rates=reads.filter(x=>x.ok && x.rateM2>0).map(x=>x.rateM2);
    const unique=[...new Set(rates.map(x=>x.toFixed(2)))];
    const consistent=reads.length===samples.length && rates.length===samples.length && unique.length===1;
    const pentagramaRate=consistent ? rates[0] : null;
    const currentRate=source ? Number(source.rate||0) : null;
    const difference=currentRate!=null && pentagramaRate!=null ? round(pentagramaRate-currentRate,2) : null;
    const differencePct=currentRate && pentagramaRate!=null ? round((difference/currentRate)*100,2) : null;

    rows.push({
      reference:target.reference,
      homeeasyId:target.homeeasyId,
      productCode:target.productCode,
      groupCode:target.groupCode,
      consistent,
      pentagramaRate,
      currentRate,
      difference,
      differencePct,
      reads
    });
  }

  console.log(JSON.stringify({
    summary:{
      targets:rows.length,
      consistent:rows.filter(r=>r.consistent).length,
      inconsistent:rows.filter(r=>!r.consistent).length,
      exactCurrentMatches:rows.filter(r=>r.consistent && Math.abs((r.currentRate||0)-r.pentagramaRate)<=0.02).length
    },
    rows
  }));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_FIXED_RATE_ALL_FAILED')}));
  process.exitCode=1;
});
