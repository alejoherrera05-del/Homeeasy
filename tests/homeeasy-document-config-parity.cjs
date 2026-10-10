'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('homeeasy-docs.js','utf8');
const settings=fs.readFileSync('configuracion.html','utf8');
const quote=fs.readFileSync('cotizacion.html','utf8');
const order=fs.readFileSync('pedido.html','utf8');
const receipt=fs.readFileSync('abono.html','utf8');
const values={
 empresa:{nombre_comercial:'HOMEEASY PERSONALIZADO QA',razon_social:'PERSONA QA SAS',
  nit:'900123456-7',nit_formateado:'900.123.456-7',direccion:'AVENIDA QA # 17',ciudad:'Popayán',
  telefono:'3001234567',whatsapp:'3001234567',email:'qa@example.test',instagram:'@qa_homeeasy',web:'https://qa.example.test/'},
 documentos:{
  mostrar_email:true,mostrar_web:true,mostrar_whatsapp:true,mostrar_instagram:true,
  cotizacion:{titulo:'COTIZACIÓN CONFIGURADA',validez_dias:'21',medicion_instalacion:'Instalación según prueba QA.',forma_pago:'40% de anticipo, 60% al final.'},
  pedido:{titulo:'PEDIDO CONFIGURADO',garantia_anios:'7',entrega_dias_habiles:'17',condicion_saldo:'Abonar cuando se entregue.',instalacion:'Instalación incluida en prueba.'},
  recibo:{titulo:'RECIBO PERSONALIZADO'},
  pie_principal:'PIE COMERCIAL PERSONALIZADO QA',pie_sistema:'Sistema Hommy V3.0 · QA'
 }
};
function fixture(config,fail=false){
 let calls=0;
 let unavailable=fail;
 const ids=['empresa-info-header','document-type','footer-creds','footer-system-line','condiciones-comerciales','pedido-condiciones'];
 const elements=Object.fromEntries(ids.map(id=>[id,{
  innerHTML:'',textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}
 }]));
 const document={
  title:'',
  getElementById(id){return elements[id]||null;},
  documentElement:{classList:{add(){},remove(){}}},
  createElement(){return {id:'',style:{},textContent:''}},
  head:{appendChild(){}},
  readyState:'complete'
 };
 const win={document,location:{pathname:'/no-auto-init.html'},
  HomeEasyCore:{getConfiguration:async (options)=>{
   calls++;
   assert.equal(options.force,true,'force network read required');
   assert.equal(options.allowFallback,true,'recover last synced config when network fails');
   if(unavailable)throw new Error('Servicio central inaccesible');
   return {status:'ok',version:93,source:'network',configuracion:config};
  }}
 };
 vm.runInNewContext(source,{window:win,document,console,fetch:async()=>{throw Error('Unexpected direct request')}},{filename:'homeeasy-docs.js'});
 return {win,doc:win.HomeEasyDocs,elements,setUnavailable(value){unavailable=Boolean(value)},get calls(){return calls}};
}
(async()=>{
 const f=fixture(values);
 const flat=f.doc.flattenObject(values);
 assert.equal(f.doc.buildHeaderHtml(flat).includes('qa.example.test'),true);
 assert.equal(f.doc.buildHeaderHtml({...flat,'documentos.mostrar_web':false}).includes('qa.example.test'),false);
 assert.equal(f.doc.buildHeaderHtml({...flat,'documentos.mostrar_web':'false'}).includes('qa.example.test'),false);
 assert.equal(f.doc.buildHeaderHtml({...flat,'documentos.mostrar_web':'true'}).includes('qa.example.test'),true);
 const expectedQuote=f.doc.buildCotizacionConditionsHtml(flat);
 const expectedOrder=f.doc.buildPedidoConditionsHtml(flat);
 assert(expectedQuote.includes('21 días calendario')&&expectedQuote.includes('40% de anticipo'));
 assert(expectedOrder.includes('7 años')&&expectedOrder.includes('17 días hábiles'));
 for(const [kind,target,title,conditions] of [
   ['cotizacion','condiciones-comerciales','COTIZACIÓN CONFIGURADA',expectedQuote],
   ['pedido','pedido-condiciones','PEDIDO CONFIGURADO',expectedOrder],
   ['recibo',null,'RECIBO PERSONALIZADO','']]){
   const result=await f.doc.init({documentType:kind});
   assert.equal(result.source,'network','Network-config must be confirmed');
   await f.doc.assertSynced();
   assert.equal(f.elements['empresa-info-header'].innerHTML,f.doc.buildHeaderHtml(flat),kind+' header should be identical to Configuración');
   assert.equal(f.elements['document-type'].textContent,title,kind+' title mismatch');
   assert.equal(f.elements['footer-creds'].textContent,values.documentos.pie_principal,kind+' footer mismatch');
   assert.equal(f.elements['footer-system-line'].textContent,values.documentos.pie_sistema,kind+' system footer mismatch');
   if(target)assert.equal(f.elements[target].innerHTML,conditions,kind+' commercial text mismatch');
 }
 assert.equal(f.calls,1,'One network request shared for three document render functions');

 // Restore the last operational receipt behavior when GET_CONFIGURACION cannot be read:
 // use the previously verified HomeEasyCore cache, or legacy default company values.
 // No financial data or server POST is modified.
 const broken=fixture(values,true);
 const result=await broken.doc.init({documentType:'recibo'});
 assert.equal(result.source,'fallback','Missing central config must not halt receipt issuance');
 assert.equal(broken.doc.state.source,'fallback');
 assert.equal(broken.doc.state.config['empresa.nombre_comercial'],'HOMEEASY POPAYÁN');
 assert.equal(broken.elements['document-type'].textContent,'RECIBO DE ABONO');
 assert(broken.elements['empresa-info-header'].innerHTML.includes('HOMEEASY POPAYÁN'));
 await broken.doc.assertSynced();
 assert.equal(broken.calls,1,'Legacy fallback must not retry forever or block receipt');
 
 // When the network is available, continue to use the exact saved configuration.
 const recovering=fixture(values,false);
 const live=await recovering.doc.init({documentType:'recibo'});
 assert.equal(live.source,'network');
 const recoveredConfig=await recovering.doc.assertSynced();
 assert.equal(recoveredConfig['empresa.nombre_comercial'],values.empresa.nombre_comercial);
 assert.equal(recovering.elements['document-type'].textContent,'RECIBO PERSONALIZADO');
 assert.equal(recovering.calls,1,'A synced configuration must not be fetched repeatedly');

 // All three entry points must preload the central client before the shared PDF module.
 for(const [kind,code] of [['cotizacion',quote],['pedido',order],['recibo',receipt]]){
  const core=code.indexOf('src="homeeasy-core.js');
  const guard=code.indexOf('src="homeeasy-page-guard.js');
  const docs=code.indexOf('src="homeeasy-docs.js');
  assert(core>=0 && guard>core && docs>guard,
    kind+' must install auth/session fetch bridge BEFORE initial PDF config prefetch');
 }

 // Shared source of truth: Configuración preview must call exactly the renderer used by all PDF forms.
 for(const token of [
  'HomeEasyDocs.buildHeaderHtml(previewConfig)',
  'HomeEasyDocs.buildCotizacionConditionsHtml(cfg)',
  'HomeEasyDocs.buildPedidoConditionsHtml(cfg)',
  "HomeEasyCore.getConfiguration({ force: true, allowFallback: false })",
  "element.checked = configBoolean(value)"
 ])assert(settings.includes(token),'Settings not linked to same source: '+token);
 for(const [kind,code] of [['cotizacion',quote],['pedido',order],['recibo',receipt]]){
  assert(code.includes("await window.HomeEasyDocs.assertSynced()"),kind+' export must wait for prepared config');
  assert(code.includes('id="empresa-info-header"'),kind+' has lost its original company header');
  assert(code.includes('homeeasy-docs.js'),kind+' lost shared header generator');
 }
 // No one should rewrite conditions directly in the preview.
 assert(!settings.includes('function buildConditionLines()'),'Duplicate condition builder persists');
 console.log('PDF parity PASS: company/header, toggles, titles, conditions, footers, network and operational fallback.');
})().catch(e=>{console.error(e);process.exit(1)});
