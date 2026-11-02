import {normalizeApiResponse,buildPublicProjection,validateAiResult,prepareAiInput} from './core.mjs';

const SNAPSHOT_KEY='last-good-public-v1';
const ANALYSIS_VERSION='seven-categories-v2';
const VN_OFFSET=7*3600*1000;
function windowFor(now=new Date()){
  const local=new Date(now.getTime()+VN_OFFSET), day=local.getUTCDay();
  let delta=(day-6+7)%7; if(day===6&&local.getUTCHours()<1)delta=7;
  const start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-delta,1)-VN_OFFSET);
  return {start,end:new Date(start.getTime()+5*86400000+22*3600000)};
}
function weekKeyFor(window){return new Date(window.start.getTime()+VN_OFFSET).toISOString().slice(0,10)}
function windowForWeekKey(key){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const localNoon=new Date(`${key}T12:00:00+07:00`);
  if(Number.isNaN(localNoon.getTime()) || new Date(localNoon.getTime()+VN_OFFSET).getUTCDay()!==6) return null;
  const window=windowFor(localNoon); return weekKeyFor(window)===key?window:null;
}
async function fetchDh3g(env,fromDate,toDate){
  if(!env.DH3G_API_KEY) throw new Error('DH3G_API_KEY is not configured');
  const url=new URL('https://api.dh3g.vn/hkm-api/public/report/cohort-submissions');
  url.search=new URLSearchParams({communityId:'44',includeAnswers:'true',fromDate,toDate}).toString();
  const res=await fetch(url,{headers:{'X-API-KEY':env.DH3G_API_KEY}});
  if(!res.ok) throw new Error(`DH3G HTTP ${res.status}`); return res.json();
}
async function classifyWithApprovedAi(env,answers){
  if(!env.AI||!env.AI_MODEL) throw new Error('Workers AI binding is not configured');
  if(env.AI_FREE_ONLY_CONFIRMED!=='true') throw new Error('AI free-only billing guard is not confirmed');
  const prepared=prepareAiInput(answers,Number(env.AI_MAX_INPUT_CHARS || 50000));
  if(prepared.truncated) throw new Error('AI input exceeds approved per-run limit; refusing partial classification');
  const prompt=`Return JSON only. Examine joint question+answer context for EVERY row regardless of question index, order, exact wording, or weekly structure. Use these seven semantic question categories as the ONLY top-level themes: journal_peer_feedback (emotion/mind-state journal from peer praise/critique), transformation (changes in awareness/thinking/behavior/speech from practice), self_kaizen (self-improvement points from peer grading/review), class_strengths (good points to preserve in teacher/BTC/operations/team/lesson/exercise/web/offline/grading), class_improvements (concrete class/course improvements), learner_contributions (the learner's own concrete action to help class), btc_teacher_questions (difficulties, questions, concerns, support requests to BTC/teacher). Match paraphrases semantically; never use question number. Within each non-empty category synthesize common ideas across learners into numbered statements, grouping by shared meaning; retain a unique serious support need even if only one learner states it. Do not output empty categories. The first three categories may summarize genuine reflection/learning content because the owner explicitly wants this framework, but never manufacture a BTC complaint from reflection or self-kaizen. Preserve valence and agency: praise stays praise, learner commitment stays their contribution, improvement stays improvement, difficulty stays support need. Mixed answers may support multiple categories only with separate exact evidence segments. Every statement needs intent=praise|improvement|contribution|difficulty; use improvement for self-kaizen, praise for positive reflection/strength, contribution for learner action, difficulty for support questions. Every evidence must cite exact sourceAnswerKey and supportQuote copied verbatim as one contiguous substring of answerText. Do not invent, force-fill, or suppress disagreement; mark ambiguous but source-supported statements needsHumanReview=true.\nDATA:${JSON.stringify(prepared.rows)}`;
  const response_format={type:'json_schema',json_schema:{type:'object',properties:{themes:{type:'array',items:{type:'object',properties:{id:{type:'string',enum:['journal_peer_feedback','transformation','self_kaizen','class_strengths','class_improvements','learner_contributions','btc_teacher_questions']},label:{type:'string'},statements:{type:'array',items:{type:'object',properties:{summary:{type:'string'},intent:{type:'string',enum:['praise','improvement','contribution','difficulty']},confidence:{type:'number'},needsHumanReview:{type:'boolean'},evidence:{type:'array',items:{type:'object',properties:{sourceAnswerKey:{type:'string'},supportQuote:{type:'string'}},required:['sourceAnswerKey','supportQuote']}}},required:['summary','intent','confidence','needsHumanReview','evidence']}}},required:['id','label','statements']}}},required:['themes']}};
  const result=await env.AI.run(env.AI_MODEL,{messages:[{role:'system',content:'You are a careful Vietnamese education feedback analyst.'},{role:'user',content:prompt}],response_format,max_tokens:4000,temperature:0});
  const text=typeof result==='string'?result:(result.response ?? result.result ?? '');
  return typeof text==='string'?JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')):text;
}
async function storeGet(env,weekKey,{legacy=false}={}){const path=legacy?'legacy':`week/${weekKey}`;const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/${path}`);return r.status===200?r.text():null}
async function storePut(env,weekKey,value){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/week/${weekKey}`,{method:'PUT',body:value});if(!r.ok)throw new Error(`snapshot store ${r.status}`)}
async function progressGet(env,weekKey){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`);return r.status===200?JSON.parse(await r.text()):null}
async function progressPut(env,weekKey,value){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`,{method:'PUT',body:JSON.stringify(value)});if(!r.ok)throw new Error(`progress store ${r.status}`)}
async function progressDelete(env,weekKey){await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`,{method:'DELETE'})}
function minimizeStoredProjection(value){
  if(!value) return null;
  const snapshot=JSON.parse(value);
  snapshot.excludedGap=(snapshot.excludedGap || []).map(row=>({sourceAnswerKey:row.sourceAnswerKey,assignmentId:row.assignmentId,submittedAt:row.submittedAt,reason:'outside-reporting-window'}));
  return JSON.stringify(snapshot);
}
export function expandOversizedAnswers(answers,maxChars){
  const expanded=[];
  for(const answer of [...answers].sort((a,b)=>a.sourceAnswerKey.localeCompare(b.sourceAnswerKey))){
    const base={sourceAnswerKey:answer.sourceAnswerKey,questionText:answer.questionText,answerText:answer.answerText,submittedAt:answer.submittedAt};
    if(JSON.stringify(base).length<=maxChars){expanded.push(answer);continue}
    const safe=Math.max(16,maxChars-JSON.stringify({...base,sourceAnswerKey:`${answer.sourceAnswerKey}#segment:9999`,answerText:''}).length-32);let offset=0,index=0;
    while(offset<answer.answerText.length){let end=Math.min(answer.answerText.length,offset+safe);if(end<answer.answerText.length){const boundary=Math.max(answer.answerText.lastIndexOf('\n',end),answer.answerText.lastIndexOf(' ',end));if(boundary>offset+safe/2)end=boundary}const segment=answer.answerText.slice(offset,end);expanded.push({...answer,sourceAnswerKey:`${answer.sourceAnswerKey}#segment:${index}`,answerText:segment,originalSourceAnswerKey:answer.sourceAnswerKey,originalAnswerText:answer.answerText,segmentOffset:offset});offset=end;while(answer.answerText[offset]===' ')offset++;index++}
  }
  return expanded;
}
export function splitAnswers(answers,maxChars){
  answers=expandOversizedAnswers(answers,maxChars);
  const chunks=[];let chunk=[],used=0;
  for(const answer of answers){const size=JSON.stringify({sourceAnswerKey:answer.sourceAnswerKey,questionText:answer.questionText,answerText:answer.answerText,submittedAt:answer.submittedAt}).length;if(size>maxChars)throw new Error(`segmentation failed for answer: ${answer.sourceAnswerKey}`);if(chunk.length&&used+size>maxChars){chunks.push(chunk);chunk=[];used=0}chunk.push(answer);used+=size}
  if(chunk.length)chunks.push(chunk);return chunks;
}
export async function fingerprintAnswers(answers,{model,maxChars,analysisVersion=ANALYSIS_VERSION}){const canonical=[...answers].sort((a,b)=>a.sourceAnswerKey.localeCompare(b.sourceAnswerKey)).map(a=>[a.sourceAnswerKey,a.questionText,a.answerText,a.submittedAt,a.author?.id,a.author?.displayName,a.author?.group]);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({analysisVersion,model,maxChars,canonical})));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function mergeThemes(target,incoming){
  for(const theme of incoming){let dest=target.find(t=>t.id===theme.id);if(!dest){dest={id:theme.id,label:theme.label,statements:[]};target.push(dest)}for(const statement of theme.statements||[]){const key=`${statement.intent}:${String(statement.summary).trim().toLowerCase()}`;let existing=dest.statements.find(s=>s._mergeKey===key);if(!existing){existing={...statement,_mergeKey:key,evidence:[]};dest.statements.push(existing)}else{existing.needsHumanReview=Boolean(existing.needsHumanReview||statement.needsHumanReview);existing.confidence=Math.min(Number(existing.confidence??1),Number(statement.confidence??1))}for(const evidence of statement.evidence||[]){if(!existing.evidence.some(e=>e.sourceAnswerKey===evidence.sourceAnswerKey&&e.supportQuote===evidence.supportQuote))existing.evidence.push(evidence)}}}
  return target;
}
export function cleanThemes(themes){return themes.map(t=>({...t,statements:t.statements.map(({_mergeKey,...s})=>s)}))}
async function loadWeekData(env,targetNow){
  const window=windowFor(targetNow), weekKey=weekKeyFor(window);
  // API filters assignment due date, so query a bounded buffer and classify by submittedAt afterward.
  const from=new Date(window.start.getTime()-14*86400000).toISOString().slice(0,10);
  const to=new Date(window.end.getTime()+21*86400000).toISOString().slice(0,10);
  const raw=await fetchDh3g(env,from,to), normalized=normalizeApiResponse(raw);
  const included=[],excludedGap=[];
  for(const a of normalized.answers){const t=new Date(a.submittedAt);if(t>=window.start&&t<=window.end)included.push(a);else{const local=new Date(t.getTime()+VN_OFFSET),day=local.getUTCDay(),hour=local.getUTCHours();if(day===5||(day===4&&hour>=23)||(day===6&&hour<1))excludedGap.push(a)}}
  const quarantineCount=normalized.quarantine.filter(a=>{const t=new Date(a.submittedAt);return t>=window.start&&t<=window.end}).length;
  return {window,weekKey,included,excludedGap,quarantineCount};
}
async function advanceWeek(env,targetNow,maxChunks=2){
  const data=await loadWeekData(env,targetNow),maxChars=Number(env.AI_MAX_INPUT_CHARS||50000),chunks=splitAnswers(data.included,maxChars);
  const fingerprint=await fingerprintAnswers(data.included,{model:env.AI_MODEL,maxChars}),chunkManifest=chunks.map(chunk=>chunk.map(a=>a.sourceAnswerKey));
  let progress=await progressGet(env,data.weekKey);
  if(!progress||progress.fingerprint!==fingerprint||JSON.stringify(progress.chunkManifest)!==JSON.stringify(chunkManifest))progress={fingerprint,analysisVersion:ANALYSIS_VERSION,model:env.AI_MODEL,maxChars,chunkManifest,nextChunk:0,totalChunks:chunks.length,themes:[],processedAnswers:0,processedSourceKeys:[],inputAnswers:data.included.length,startedAt:new Date().toISOString()};
  let usedChunks=0;
  for(let count=0;count<maxChunks&&progress.nextChunk<chunks.length;count++){
    const chunk=chunks[progress.nextChunk],aiRaw=await classifyWithApprovedAi(env,chunk),chunkAnswerByKey=new Map(chunk.map(a=>[a.sourceAnswerKey,a])),checked=validateAiResult(aiRaw,chunkAnswerByKey);
    mergeThemes(progress.themes,checked.themes);progress.nextChunk++;progress.processedAnswers+=chunk.length;progress.processedSourceKeys=[...new Set([...(progress.processedSourceKeys||[]),...chunk.map(a=>a.originalSourceAnswerKey||a.sourceAnswerKey)])];usedChunks++;progress.updatedAt=new Date().toISOString();await progressPut(env,data.weekKey,progress);
  }
  if(progress.nextChunk<chunks.length)return {completed:false,usedChunks,weekKey:data.weekKey,processedAnswers:progress.processedAnswers,inputAnswers:progress.inputAnswers,totalChunks:chunks.length,nextChunk:progress.nextChunk};
  const now=new Date(),themes=cleanThemes(progress.themes),reflected=new Set(themes.flatMap(t=>t.statements).flatMap(s=>s.evidence.map(e=>e.sourceAnswerKey)));
  const snapshot={week:{start:data.window.start.toISOString(),end:data.window.end.toISOString()},themes,excludedGap:data.excludedGap,quarantineCount:data.quarantineCount,coverage:{status:'completed',scannedAnswers:data.included.length,modelProcessedAnswers:new Set(progress.processedSourceKeys||[]).size,reflectedSourceAnswers:reflected.size,notReflectedAnswers:Math.max(0,data.included.length-reflected.size),pendingAnswers:0},generatedAt:now.toISOString(),lastSuccessfulSyncAt:now.toISOString(),processing:{provider:'Cloudflare Workers AI',model:env.AI_MODEL,status:'completed',processedAt:now.toISOString()}};
  const projection=buildPublicProjection(snapshot);await storePut(env,data.weekKey,JSON.stringify(projection));await progressDelete(env,data.weekKey);return {completed:true,usedChunks,weekKey:data.weekKey,projection};
}
async function syncCurrentAndBackfill(env){
  const currentWindow=windowFor(new Date());
  const currentKey=weekKeyFor(currentWindow),currentRaw=await storeGet(env,currentKey),currentNeeds=!currentRaw||Date.now()-new Date(JSON.parse(currentRaw).generatedAt).getTime()>6*3600000;
  let budget=currentNeeds?5:6;
  for(let offset=1;offset<=8;offset++){
    const target=new Date(currentWindow.start.getTime()-offset*7*86400000+12*3600000);
    const key=weekKeyFor(windowFor(target));
    if(!await storeGet(env,key)){try{const result=await advanceWeek(env,target,budget);budget-=result.usedChunks;if(!result.completed||budget<=0)break}catch(error){console.error('history_week_failed',key,error?.message);continue}}
  }
  if(currentNeeds)try{await advanceWeek(env,new Date(),1)}catch(error){console.error('current_week_failed',currentKey,error?.message)}
}
export class SnapshotStore {
  constructor(ctx){this.ctx=ctx}
  async fetch(request){
    const url=new URL(request.url), week=url.pathname.match(/^\/week\/(\d{4}-\d{2}-\d{2})$/)?.[1],progressWeek=url.pathname.match(/^\/progress\/(\d{4}-\d{2}-\d{2})$/)?.[1];
    if(request.method==='GET'){const key=url.pathname==='/legacy'?SNAPSHOT_KEY:(week?`snapshot:${week}`:(progressWeek?`progress:${progressWeek}`:null));if(!key)return new Response('',{status:400});const value=await this.ctx.storage.get(key);return value?new Response(value):new Response('',{status:404})}
    if(request.method==='PUT'&&week){await this.ctx.storage.put(`snapshot:${week}`,await request.text());return new Response('ok')}
    if(request.method==='PUT'&&progressWeek){await this.ctx.storage.put(`progress:${progressWeek}`,await request.text());return new Response('ok')}
    if(request.method==='DELETE'&&progressWeek){await this.ctx.storage.delete(`progress:${progressWeek}`);return new Response('ok')}
    return new Response('',{status:405})
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/api/public/week'){
      const requested=url.searchParams.get('week'), currentWindow=windowFor(new Date()), currentKey=weekKeyFor(currentWindow);
      const requestedWindow=requested?windowForWeekKey(requested):currentWindow;
      if(!requestedWindow)return Response.json({status:'invalid-week'},{status:400});
      const key=requested || currentKey;
      let stored=env.SNAPSHOT_STORE?await storeGet(env,key):null;
      if(!stored&&key===currentKey)stored=await storeGet(env,key,{legacy:true});
      const value=minimizeStoredProjection(stored);
      if(!value){const progress=await progressGet(env,key),processed=progress?new Set(progress.processedSourceKeys||[]).size:0;return Response.json({status:'pending-backfill',week:{key,start:requestedWindow.start.toISOString(),end:requestedWindow.end.toISOString()},coverage:progress?{status:'processing',modelProcessedAnswers:processed,inputAnswers:progress.inputAnswers,pendingAnswers:Math.max(0,progress.inputAnswers-processed),completedChunks:progress.nextChunk,totalChunks:progress.totalChunks}:{status:'queued'}},{status:404,headers:{'cache-control':'no-store'}})}
      return new Response(value,{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public,max-age=300'}});
    }
    if(url.pathname==='/api/health') return Response.json({ok:true,connected:Boolean(env.DH3G_API_KEY&&env.AI&&env.AI_MODEL&&env.SNAPSHOT_STORE),freeOnly:env.AI_FREE_ONLY_CONFIRMED==='true'});
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(syncCurrentAndBackfill(env).catch(error=>console.error('sync_failed',error?.message)))}
};

