'use strict';

// Read-only production check. It NEVER sends WhatsApp messages and NEVER writes
// customer data or the business notebook. The only network calls are to the
// existing authenticated Hommy team AI interpret endpoint.
const { performance } = require('node:perf_hooks');
const { createHommyDesk } = require('./hommy-desk');
const { createTeamAI } = require('./team-ai');

const DATA_DIR = String(process.env.DATA_DIR || '/app/data');
function response(text) { process.stdout.write(JSON.stringify(text) + '\n'); }
function verifiedAnswer(result) {
  if (!result || result.kind !== 'ANSWER') return '';
  return String(result.text || '').slice(0,480);
}
async function main() {
  response({step:'LOCAL_DESK',description:'Lectura local, no envía mensajes'});
  let desk;
  try {
    desk = createHommyDesk({dataDir:DATA_DIR});
    const status = desk.dashboard();
    response({step:'LOCAL_DESK_RESULT',storageAvailable:status.available,
      catalogInstalled:status.catalog.installed === true,
      catalogBytes:status.catalog.installed ? status.catalog.bytes : null,
      notesSaved:Array.isArray(status.notes)?status.notes.length:0,
      catalogAutoReplyEnabled:status.automation?.customerCatalogEnabled===true});
  } catch (error) {
    response({step:'LOCAL_DESK_ERROR',message:'No fue posible leer el escritorio',
      code:String(error.code || 'UNKNOWN')});
  }

  const teamAi = createTeamAI({
    enabled: process.env.HOMMY_TEAM_AI_ENABLED === 'true',
    provider: process.env.HOMMY_TEAM_AI_PROVIDER || 'RENDER',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.HOMMY_TEAM_OPENAI_MODEL || 'gpt-5.4-mini',
    endpoint: process.env.HOMMY_TEAM_AI_URL || '',
    // Match server.js fallback exactly; .env may omit HOMMY_BACKEND_URL.
    backendUrl: process.env.HOMMY_BACKEND_URL || 'https://homeeasy-hommy-staging.onrender.com',
    serviceToken: process.env.HOMMY_TEAM_AI_SERVICE_TOKEN || '',
    // The isolated smoke test can wait longer than a normal WhatsApp reply.
    // The production Bridge retains its separate, shorter response deadline.
    dataDir:DATA_DIR, timeoutMs: process.env.HOMMY_TEAM_AI_PROVIDER==='DIRECT_OPENAI' ? 18000 : 9500,
    getDeskContext: () => desk ? desk.approvedContext('TEAM') : null
  });
  response({step:'TEAM_AI_CONFIG',provider:teamAi.provider,available:teamAi.available,
    backendFallbackUsed: !Boolean(process.env.HOMMY_BACKEND_URL)});
  if (!teamAi.available) {
    response({step:'FINISHED',result:'TEAM_AI_NOT_CONFIGURED',
      note:'El test no puede consultar la IA; no se enviaron mensajes.'});
    return;
  }

  const questions=[
    'Hommy, ¿qué diferencia hay entre Onda Serena Blackout y Onda Serena Velo?',
    '¿Y cuál convendría si quiero una sala luminosa?'
  ];
  const history=[];
  for(let i=0;i<questions.length;i++){
    const started=performance.now();
    const result=await teamAi.interpret({
      question:questions[i],history,pendingTasks:0
    });
    const ms=Math.round(performance.now()-started);
    const text=verifiedAnswer(result);
    response({step:'AI_CONVERSATION',turn:i+1,question:questions[i],
      kind:result.kind,latencyMs:ms,answer:text||null,
      reason:result.kind==='ANSWER'?null:String(result.reason||'NO_VALIDATED_ANSWER')});
    if(result.kind==='ANSWER')history.push({question:questions[i],answer:text});
    else break;
  }
  response({step:'FINISHED',result:'CHECK_COMPLETE',
    note:'Prueba real del servicio de IA de equipo; no usa WAHA ni envía mensajes.'});
}

if (require.main === module) {
  main().catch(error=>{
    response({step:'FATAL',code:String(error.code||'UNEXPECTED')});
    process.exitCode=1;
  });
}
module.exports={main};
