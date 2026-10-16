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

const wanted = ['Screen Clark', 'Romantic', 'Fener', 'Night'];
const targets = wanted.map(name => pool.find(item => item.reference === name)).filter(Boolean);

const WIDTHS = [0.8,1.0,1.2,1.4,1.6,1.8,2.0,2.2,2.4];
const HEIGHTS = [1.3,1.5,1.7,1.9,2.1,2.3,2.5];

async function livePrice(target, width, height) {
  const response = await fetch(API + '/api/pentagrama-sync/price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HomeEasy-Token': TOKEN },
    body: JSON.stringify({
      params: {
        ProductCode: String(target.productCode),
        Quantity: 1,
        Width: String(width),
        Height: String(height),
        GroupCode: String(target.groupCode || ''),
        calculationType: 'NormalProduct',
        Degrees: '',
        Panels: 0,
        Cabezal: '',
        ItemCodeFather: '',
        AssociationGroup: 'SHEERSTD',
        Group: 'SHEERSTD',
        Discount: 0
      },
      options: { productDiscount: 0, pricingMode: 'account-discount' }
    })
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload || !payload.ok) {
    return { ok:false, code:String(payload && (payload.code || payload.error) || 'PRICE_FAILED') };
  }
  const r = payload.result || {};
  return { ok:true, total:Number(r.total || 0) };
}

function solve(A,b) {
  const n=A.length, m=A[0].length;
  const M=Array.from({length:m},(_,i)=>Array.from({length:m+1},(_,j)=>{
    if (j===m) return A.reduce((s,row,k)=>s+row[i]*b[k],0);
    return A.reduce((s,row)=>s+row[i]*row[j],0);
  }));
  for(let col=0;col<m;col++){
    let pivot=col;
    for(let r=col+1;r<m;r++) if(Math.abs(M[r][col])>Math.abs(M[pivot][col])) pivot=r;
    [M[col],M[pivot]]=[M[pivot],M[col]];
    const d=M[col][col];
    if(Math.abs(d)<1e-12) return null;
    for(let j=col;j<=m;j++) M[col][j]/=d;
    for(let r=0;r<m;r++){
      if(r===col) continue;
      const f=M[r][col];
      for(let j=col;j<=m;j++) M[r][j]-=f*M[col][j];
    }
  }
  return M.map(row=>row[m]);
}

function fit(points, featureFn) {
  const A=points.map(p=>featureFn(p.width,p.height));
  const b=points.map(p=>p.total);
  const coef=solve(A,b);
  if(!coef) return null;
  const errors=points.map((p,i)=>{
    const pred=A[i].reduce((s,v,j)=>s+v*coef[j],0);
    return {abs:Math.abs(pred-p.total), rel:p.total?Math.abs(pred-p.total)/p.total:0};
  });
  return {
    coef:coef.map(x=>Math.round(x*1000000)/1000000),
    maxAbs:Math.round(Math.max(...errors.map(e=>e.abs))*100)/100,
    meanAbs:Math.round((errors.reduce((s,e)=>s+e.abs,0)/errors.length)*100)/100,
    maxRelPct:Math.round(Math.max(...errors.map(e=>e.rel))*10000)/100
  };
}

(async()=>{
  const rows=[];
  let reads=0;
  for(const target of targets){
    const points=[];
    for(const height of HEIGHTS){
      for(const width of WIDTHS){
        const p=await livePrice(target,width,height);
        reads++;
        if(p.ok && p.total>0) points.push({width,height,total:p.total});
      }
    }

    const models={
      area: fit(points,(w,h)=>[w*h,1]),
      affineWH: fit(points,(w,h)=>[w,h,1]),
      bilinear: fit(points,(w,h)=>[w*h,w,h,1]),
      heightByWidth: fit(points,(w,h)=>[w*h,w,1]),
      widthByHeight: fit(points,(w,h)=>[w*h,h,1])
    };

    rows.push({
      reference:target.reference,
      positivePoints:points.length,
      models
    });
  }

  console.log(JSON.stringify({summary:{references:rows.length,reads},rows}));
})().catch(error=>{
  console.error(JSON.stringify({ok:false,code:String(error.code||error.message||'SHEER_FORMULA_FIT_FAILED')}));
  process.exitCode=1;
});
