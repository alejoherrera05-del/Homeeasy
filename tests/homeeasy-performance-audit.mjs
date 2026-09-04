import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlFiles = fs.readdirSync(root).filter(name => name.endsWith('.html')).sort();
const rootJsFiles = fs.readdirSync(root).filter(name => name.endsWith('.js')).sort();

function count(text, regex) {
  return [...text.matchAll(regex)].length;
}

function cleanAssetUrl(src) {
  return String(src || '').split('?')[0].split('#')[0];
}

function assetBytes(src) {
  const clean = cleanAssetUrl(src);
  if (!clean || /^https?:\/\//i.test(clean) || clean.startsWith('data:')) return 0;
  const full = path.join(root, clean);
  try { return fs.statSync(full).isFile() ? fs.statSync(full).size : 0; } catch { return 0; }
}

const rows = htmlFiles.map(file => {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const imageMatches = [...text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  const uniqueImages = new Map();
  for (const match of imageMatches) {
    const src = cleanAssetUrl(match[1]);
    if (!src) continue;
    const eager = !/\bloading=["']lazy["']/i.test(match[0]);
    const current = uniqueImages.get(src) || { src, bytes: assetBytes(src), eager: false, references: 0 };
    current.eager = current.eager || eager;
    current.references += 1;
    uniqueImages.set(src, current);
  }
  const imageEntries = [...uniqueImages.values()];
  const imageBytes = imageEntries.reduce((sum, item) => sum + item.bytes, 0);
  const eagerImageBytes = imageEntries.reduce((sum, item) => item.eager ? sum + item.bytes : sum, 0);
  const inlineScripts = [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  const externalScripts = [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  const blockingRemoteScripts = externalScripts.filter(match => /^https?:\/\//i.test(match[1]) && !/\b(?:defer|async)\b/i.test(match[0]));
  const externalStyles = [...text.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  const longTimers = [...text.matchAll(/setTimeout\s*\([^,]+,\s*(\d{4,})\s*\)/g)].map(m => Number(m[1]));
  return {
    file,
    bytes: Buffer.byteLength(text),
    inlineScriptBytes: inlineScripts.reduce((sum, m) => sum + Buffer.byteLength(m[1]), 0),
    externalScripts: externalScripts.length,
    blockingRemoteScripts: blockingRemoteScripts.length,
    externalStyles: externalStyles.length,
    fetchCalls: count(text, /\bfetch\s*\(/g),
    coreGets: count(text, /\bHomeEasyCore\.get\s*\(/g),
    storageParses: count(text, /JSON\.parse\s*\(\s*localStorage\.getItem/g),
    innerHtmlAppend: count(text, /\.innerHTML\s*\+=/g),
    imageReferences: imageMatches.length,
    uniqueImages: imageEntries.length,
    imageBytes,
    eagerImageBytes,
    html2canvas: /\bhtml2canvas\s*\(/.test(text),
    longTimers
  };
});

console.log('\nHOMEEASY PERFORMANCE BASELINE');
console.log('============================');
for (const row of rows) {
  console.log(`${row.file.padEnd(27)} html=${String(row.bytes).padStart(7)}B inlineJS=${String(row.inlineScriptBytes).padStart(7)}B fetch=${row.fetchCalls + row.coreGets} storageParse=${row.storageParses} innerHTML+=${row.innerHtmlAppend} blockingRemoteJS=${row.blockingRemoteScripts} eagerUniqueImg=${Math.round(row.eagerImageBytes / 1024)}KB`);
}

const totalHtml = rows.reduce((s, r) => s + r.bytes, 0);
const totalInline = rows.reduce((s, r) => s + r.inlineScriptBytes, 0);
const totalEagerAssets = rows.reduce((s, r) => s + r.eagerImageBytes, 0);
console.log('\nTotals:', JSON.stringify({
  htmlFiles: rows.length,
  rootJsFiles: rootJsFiles.length,
  totalHtmlBytes: totalHtml,
  totalInlineScriptBytes: totalInline,
  eagerUniqueReferencedImageBytesAcrossPages: totalEagerAssets,
  blockingRemoteScripts: rows.reduce((s, r) => s + r.blockingRemoteScripts, 0),
  storageParses: rows.reduce((s, r) => s + r.storageParses, 0),
  innerHtmlAppend: rows.reduce((s, r) => s + r.innerHtmlAppend, 0)
}, null, 2));

const hotspots = rows
  .map(r => ({ ...r, score: r.bytes + r.inlineScriptBytes * 1.2 + r.eagerImageBytes * 0.35 + r.blockingRemoteScripts * 100000 + r.storageParses * 25000 + r.innerHtmlAppend * 15000 }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 8)
  .map(r => r.file);
console.log('\nTop static hotspots:', hotspots.join(', '));

const output = { generatedAt: new Date().toISOString(), rows, hotspots };
fs.mkdirSync(path.join(root, 'qa'), { recursive: true });
fs.writeFileSync(path.join(root, 'qa', 'homeeasy-performance-baseline.json'), JSON.stringify(output, null, 2));
