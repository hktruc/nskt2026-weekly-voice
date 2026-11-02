import {normalizeApiResponse,buildPublicProjection,validateAiResult} from './core.mjs';

const SNAPSHOT_KEY='last-good-public-v1';
const VN_OFFSET=7*3600*1000;
function windowFor(now=new Date()){
  const local=new Date(now.getTime()+VN_OFFSET), day=local.getUTCDay();
  let delta=(day-6+7)%7; if(day===6&&local.getUTCHours()<1)delta=7;
  const start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-delta,1)-VN_OFFSET);
  return {start,end:new Date(start.getTime()+5*86400000+22*3600000)};
}
async function fetchDh3g(env,fromDate,toDate){
  if(!env.DH3G_API_KEY) throw new Error('DH3G_API_KEY is not configured');
  const url=new URL('https://api.dh3g.vn/hkm-api/public/report/cohort-submissions');
  url.search=new URLSearchParams({communityId:'44',includeAnswers:'true',fromDate,toDate}).toString();
  const res=await fetch(url,{headers:{'X-API-KEY':env.DH3G_API_KEY}});
  if(!res.ok) throw new Error(`DH3G HTTP ${res.status}`); return res.json();
}
async function classifyWithApprovedAi(env,answers){
  if(!env.AI_ENDPOINT||!env.AI_API_KEY||!env.AI_MODEL) throw new Error('Approved AI service is not configured');
  const res=await fetch(env.AI_ENDPOINT,{method:'POST',headers:{authorization:`Bearer ${env.AI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:env.AI_MODEL,input:{instruction:'Group every learner answer semantically into 5–10 evidence-derived themes. Produce synthesized numbered statements. Do not invent, force-fill, or suppress disagreement. Every statement must cite exact sourceAnswerKey.',answers}})});
  if(!res.ok) throw new Error(`AI HTTP ${res.status}`); return res.json();
}
async function sync(env){
  const now=new Date(), window=windowFor(now);
  // API filters assignment due date, so query a bounded buffer and classify by submittedAt afterward.
  const from=new Date(window.start.getTime()-14*86400000).toISOString().slice(0,10);
  const to=new Date(window.end.getTime()+21*86400000).toISOString().slice(0,10);
  const raw=await fetchDh3g(env,from,to), normalized=normalizeApiResponse(raw);
  const included=[],excludedGap=[];
  for(const a of normalized.answers){const t=new Date(a.submittedAt);(t>=window.start&&t<=window.end?included:excludedGap).push(a)}
  const aiRaw=await classifyWithApprovedAi(env,included);
  const checked=validateAiResult(aiRaw,new Map(included.map(a=>[a.sourceAnswerKey,a])));
  const snapshot={week:{start:window.start.toISOString(),end:window.end.toISOString()},themes:checked.themes,excludedGap,quarantineCount:normalized.quarantine.length,generatedAt:now.toISOString(),lastSuccessfulSyncAt:now.toISOString(),processing:{provider:new URL(env.AI_ENDPOINT).host,model:env.AI_MODEL,status:'completed',processedAt:now.toISOString()}};
  const projection=buildPublicProjection(snapshot); await env.SNAPSHOTS.put(SNAPSHOT_KEY,JSON.stringify(projection)); return projection;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/api/public/week'){
      const value=await env.SNAPSHOTS?.get(SNAPSHOT_KEY);
      return new Response(value || JSON.stringify({status:'not-connected'}),{status:value?200:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public,max-age=300'}});
    }
    if(url.pathname==='/api/health') return Response.json({ok:true,connected:Boolean(env.DH3G_API_KEY&&env.AI_ENDPOINT&&env.AI_MODEL&&env.SNAPSHOTS)});
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(sync(env).catch(error=>console.error('sync_failed',error?.message)))}
};

