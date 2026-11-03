import {normalizeApiResponse,buildPublicProjection,validateAiResult,prepareAiInput} from './core.mjs';

const SNAPSHOT_KEY='last-good-public-v1';
const ANALYSIS_VERSION='seven-categories-v6-common-ideas';
export const CLASSIFICATION_QUALITY_RULES='First atomize each answer into distinct meaning units; never bundle unrelated actions or concerns. Cluster semantically equivalent units ACROSS learners inside the same category even when wording differs. If two learners share an idea, output one common synthesized statement with both evidence items, not two personal paraphrases. Allow a one-source statement only for a genuinely unique meaningful idea or serious support need. Write an analytical Vietnamese synthesis; never copy a full answer or support quote as the summary. The answer meaning controls category and intent; the question is context only. Never turn a request into praise or appreciation of others into learner contribution. Transformation requires actual change; learner_contributions requires the learner own concrete action. Ambiguous request or praise wording must set needsHumanReview=true and confidence below 0.9.';
const CATEGORY_IDEA_TARGET='Aim for 5 to 10 concise common ideas per non-empty question category when evidence supports that many; use fewer only when there are genuinely fewer meaningful ideas. Ignore vague placeholders unless they contain a critical constructive need.';
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
  const prompt=`Return JSON only. Examine joint question+answer context for EVERY row regardless of question index, order, exact wording, or weekly structure. Use these seven semantic question categories as the ONLY top-level themes: journal_peer_feedback (emotion/mind-state journal from peer praise/critique), transformation (changes in awareness/thinking/behavior/speech from practice), self_kaizen (self-improvement points from peer grading/review), class_strengths (good points to preserve in teacher/BTC/operations/team/lesson/exercise/web/offline/grading), class_improvements (concrete class/course improvements), learner_contributions (the learner's own concrete action to help class), btc_teacher_questions (difficulties, questions, concerns, support requests to BTC/teacher). Match paraphrases semantically; never use question number. Within each non-empty category synthesize common ideas across learners into numbered statements, grouping by shared meaning; retain a unique serious support need even if only one learner states it. Do not output empty categories. The first three categories may summarize genuine reflection/learning content because the owner explicitly wants this framework, but never manufacture a BTC complaint from reflection or self-kaizen. Preserve valence and agency: praise stays praise, learner commitment stays their contribution, improvement stays improvement, difficulty stays support need. Mixed answers may support multiple categories only with separate exact evidence segments. Every statement needs intent=praise|improvement|contribution|difficulty; use improvement for self-kaizen, praise for positive reflection/strength, contribution for learner action, difficulty for support questions. Every evidence must cite exact sourceAnswerKey and supportQuote copied verbatim as one contiguous substring of answerText. Do not invent, force-fill, or suppress disagreement; mark ambiguous but source-supported statements needsHumanReview=true. Also return exactly one disposition for every DATA sourceAnswerKey: relevant if it supports at least one evidence item, irrelevant if it contains no content for these seven categories, uncertain if classification needs human review. No missing or extra keys.\nDATA:${JSON.stringify(prepared.rows)}`;
  const response_format={type:'json_schema',json_schema:{type:'object',properties:{themes:{type:'array',items:{type:'object',properties:{id:{type:'string',enum:['journal_peer_feedback','transformation','self_kaizen','class_strengths','class_improvements','learner_contributions','btc_teacher_questions']},label:{type:'string'},statements:{type:'array',items:{type:'object',properties:{summary:{type:'string'},intent:{type:'string',enum:['praise','improvement','contribution','difficulty']},confidence:{type:'number'},needsHumanReview:{type:'boolean'},evidence:{type:'array',items:{type:'object',properties:{sourceAnswerKey:{type:'string'},supportQuote:{type:'string'}},required:['sourceAnswerKey','supportQuote']}}},required:['summary','intent','confidence','needsHumanReview','evidence']}}},required:['id','label','statements']}},dispositions:{type:'array',items:{type:'object',properties:{sourceAnswerKey:{type:'string'},status:{type:'string',enum:['relevant','irrelevant','uncertain']}},required:['sourceAnswerKey','status']}}},required:['themes','dispositions']}};
  const result=await env.AI.run(env.AI_MODEL,{messages:[{role:'system',content:`You are a careful Vietnamese education feedback analyst. ${CLASSIFICATION_QUALITY_RULES} ${CATEGORY_IDEA_TARGET}`},{role:'user',content:prompt}],response_format,max_tokens:4000,temperature:0});
  const text=typeof result==='string'?result:(result.response ?? result.result ?? '');
  return typeof text==='string'?JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')):text;
}
async function storeGet(env,weekKey,{legacy=false}={}){const path=legacy?'legacy':`week/${weekKey}`;const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/${path}`);return r.status===200?r.text():null}
async function storePut(env,weekKey,value){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/week/${weekKey}`,{method:'PUT',body:value});if(!r.ok)throw new Error(`snapshot store ${r.status}`)}
async function progressGet(env,weekKey){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`);return r.status===200?JSON.parse(await r.text()):null}
async function progressPut(env,weekKey,value){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`,{method:'PUT',body:JSON.stringify(value)});if(!r.ok)throw new Error(`progress store ${r.status}`)}
export function isAiQuotaError(error){return /(?:429|4006|quota|neurons|daily limit)/i.test(String(error?.message||error||''))}
async function markProgressError(env,weekKey,error){const progress=await progressGet(env,weekKey);if(progress){progress.blockedReason=isAiQuotaError(error)?'ai-free-quota-exhausted':'processing-error';progress.lastErrorAt=new Date().toISOString();await progressPut(env,weekKey,progress)}}
async function progressDelete(env,weekKey){await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}`,{method:'DELETE'})}
async function frozenChunkPut(env,weekKey,index,chunk){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}/chunk/${index}`,{method:'PUT',body:JSON.stringify(chunk)});if(!r.ok)throw new Error(`frozen chunk store ${r.status}`)}
async function frozenChunkGet(env,weekKey,index){const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}/chunk/${index}`);if(!r.ok)throw new Error(`frozen chunk missing: ${weekKey}/${index}`);return r.json()}
async function frozenChunksDelete(env,weekKey,total){for(let i=0;i<total;i++)await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/progress/${weekKey}/chunk/${i}`,{method:'DELETE'})}
export function createRunBudget(limit=6){return {remaining:Math.max(0,Number(limit)||0),attempts:0}}
export function reserveRunAttempt(budget){if(!budget||budget.remaining<=0||(Number.isFinite(budget.localLimit)&&budget.attempts>=budget.localLimit))return false;budget.remaining--;budget.attempts++;return true}
export function shouldResumeFrozenProgress(progress,{model,maxChars}){return Boolean(progress&&progress.analysisVersion===ANALYSIS_VERSION&&progress.model===model&&progress.maxChars===maxChars)}
export function evidenceInvariant(before,after){const collect=themes=>new Set(themes.flatMap(t=>t.statements.flatMap(s=>(s.evidence||[]).map(e=>JSON.stringify([t.id,s.intent,e.sourceAnswerKey,e.supportQuote]))))),expected=collect(before),actual=collect(after);return expected.size===actual.size&&[...expected].every(x=>actual.has(x))}
export function needsHistoricalRefresh(snapshot,now=Date.now(),minimumAgeMs=24*3600000){const generated=Date.parse(snapshot?.generatedAt||'');return Number.isFinite(generated)&&now-generated>=minimumAgeMs}
export function frozenCoverageState(progress,liveCount){const pendingRefresh=Boolean(progress.queuedRefreshFingerprint),pendingDelta=Math.max(0,Number(liveCount||0)-Number(progress.inputAnswers||0));return {status:pendingRefresh?'completed-frozen-refresh-pending':'completed',scannedAnswers:Number(progress.inputAnswers||0),pendingAnswers:pendingDelta,pendingRefresh}}
export function selectPendingRefreshOffset(snapshots){const index=snapshots.findIndex(snapshot=>snapshot?.coverage?.pendingRefresh===true);return index<0?null:index+1}
function safeConsolidationThemes(themes){return cleanThemes(themes).map(t=>({id:t.id,label:t.label,statements:t.statements.map(s=>({summary:s.summary,intent:s.intent,confidence:s.confidence,needsHumanReview:s.needsHumanReview,evidence:(s.evidence||[]).map(e=>({sourceAnswerKey:e.sourceAnswerKey,supportQuote:e.supportQuote}))}))}))}
export function splitThemesForConsolidation(themes,maxChars){const atomic=[];for(const theme of cleanThemes(themes))for(const statement of theme.statements||[]){let evidence=[];for(const item of statement.evidence||[]){const candidate=[...evidence,item],piece={id:theme.id,label:theme.label,statements:[{...statement,evidence:candidate}]};if(evidence.length&&JSON.stringify(safeConsolidationThemes([piece])).length>maxChars){atomic.push({id:theme.id,label:theme.label,statements:[{...statement,evidence}]});evidence=[item]}else evidence=candidate}if(evidence.length)atomic.push({id:theme.id,label:theme.label,statements:[{...statement,evidence}]})}const batches=[];let batch=[];for(const item of atomic){if(JSON.stringify(safeConsolidationThemes([item])).length>maxChars)throw new Error(`single evidence quote exceeds consolidation limit: ${item.id}`);const candidate=batch.map(t=>({...t,statements:[...t.statements]})),existing=candidate.find(t=>t.id===item.id);if(existing)existing.statements.push(...item.statements);else candidate.push(item);if(batch.length&&JSON.stringify(safeConsolidationThemes(candidate)).length>maxChars){batches.push(batch);batch=[item]}else batch=candidate}if(batch.length)batches.push(batch);return batches}
async function reserveDailyAiAttempt(env){const day=new Date().toISOString().slice(0,10),limit=Math.max(1,Number(env.AI_DAILY_CALL_CAP||48));const r=await env.SNAPSHOT_STORE.getByName('global').fetch(`https://store/quota/${day}/reserve`,{method:'POST',body:String(limit)});if(r.status===429)throw new Error('AI daily free-only call cap reached');if(!r.ok)throw new Error(`AI quota reservation failed: ${r.status}`)}
export function minimizeStoredProjection(value){
  if(!value) return null;
  const snapshot=JSON.parse(value);
  if(snapshot.processing?.analysisVersion!==ANALYSIS_VERSION)return null;
  snapshot.excludedGap=(snapshot.excludedGap || []).map(row=>({sourceAnswerKey:row.sourceAnswerKey,assignmentId:row.assignmentId,submittedAt:row.submittedAt,reason:'outside-reporting-window'}));
  return JSON.stringify(snapshot);
}
export function expandOversizedAnswers(answers,maxChars){
  const expanded=[];
  for(const answer of [...answers].sort((a,b)=>a.sourceAnswerKey.localeCompare(b.sourceAnswerKey))){
    const base={sourceAnswerKey:answer.sourceAnswerKey,questionText:answer.questionText,answerText:answer.answerText,submittedAt:answer.submittedAt};
    if(JSON.stringify(base).length<=maxChars){expanded.push(answer);continue}
    let offset=0,index=0;
    while(offset<answer.answerText.length){const key=`${answer.sourceAnswerKey}#segment:${index}`;let low=1,high=answer.answerText.length-offset,best=0;while(low<=high){const length=Math.floor((low+high)/2),segment=answer.answerText.slice(offset,offset+length),size=JSON.stringify({sourceAnswerKey:key,questionText:answer.questionText,answerText:segment,submittedAt:answer.submittedAt}).length;if(size<=maxChars){best=length;low=length+1}else high=length-1}if(best===0)throw new Error(`answer metadata exceeds AI input limit: ${answer.sourceAnswerKey}`);let end=offset+best;if(end<answer.answerText.length){const boundary=Math.max(answer.answerText.lastIndexOf('\n',end),answer.answerText.lastIndexOf(' ',end));if(boundary>offset+best/2)end=boundary}const segment=answer.answerText.slice(offset,end);expanded.push({...answer,sourceAnswerKey:key,answerText:segment,originalSourceAnswerKey:answer.sourceAnswerKey,originalAnswerText:answer.answerText,segmentOffset:offset});offset=end;index++}
  }
  return expanded;
}
export function splitAnswers(answers,maxChars){
  answers=expandOversizedAnswers(answers,maxChars>=4000?Math.floor(maxChars/2):maxChars);
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
async function consolidateThemesWithApprovedAi(env,themes){
  const safeThemes=safeConsolidationThemes(themes);
  const consolidationRules='Merge shared parent ideas across learners while retaining meaningful differences in the summary or needsHumanReview. Do not leave one card per person when evidence expresses the same idea. Keep genuinely unique ideas as single-source statements. Never copy a full support quote as the summary. Do not merge doing assigned exercises with asking BTC to assign more work. Appreciation of others is not the learner own contribution unless an explicit personal action is present.';
  const prompt=`Return JSON only. Semantically consolidate paraphrased statements WITHIN the same category and intent. Preserve unique serious support needs and disagreements. Never move evidence between categories/intents, invent a claim, source key, or quote, or remove evidence merely because it is uncommon. Every output statement must have nonempty evidence drawn exactly from INPUT. Use the clearest faithful Vietnamese summary.\nINPUT:${JSON.stringify(safeThemes)}`;
  const response_format={type:'json_schema',json_schema:{type:'object',properties:{themes:{type:'array',items:{type:'object',properties:{id:{type:'string',enum:['journal_peer_feedback','transformation','self_kaizen','class_strengths','class_improvements','learner_contributions','btc_teacher_questions']},label:{type:'string'},statements:{type:'array',items:{type:'object',properties:{summary:{type:'string'},intent:{type:'string',enum:['praise','improvement','contribution','difficulty']},confidence:{type:'number'},needsHumanReview:{type:'boolean'},evidence:{type:'array',items:{type:'object',properties:{sourceAnswerKey:{type:'string'},supportQuote:{type:'string'}},required:['sourceAnswerKey','supportQuote']}}},required:['summary','intent','confidence','needsHumanReview','evidence']}}},required:['id','label','statements']}}},required:['themes']}};
  const result=await env.AI.run(env.AI_MODEL,{messages:[{role:'system',content:`You consolidate evidence-backed Vietnamese education feedback without changing meaning. ${consolidationRules}`},{role:'user',content:prompt}],response_format,max_tokens:4000,temperature:0});const text=typeof result==='string'?result:(result.response??result.result??'');return typeof text==='string'?JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')):text
}
async function reduceCategoryWithApprovedAi(env,theme){
  const input=theme.statements.map((statement,index)=>({id:`s${index}`,summary:statement.summary,intent:statement.intent,sourceKeys:[...new Set((statement.evidence||[]).map(e=>e.sourceAnswerKey))]})),prompt=`Return JSON only. Cluster these statements into 5 to 10 concise common ideas for the SAME question category. Group semantic paraphrases across learners, preserve rare useful needs, and do not mix different intents. Every input statement id must appear exactly once across groups. Do not invent ids. INPUT:${JSON.stringify(input)}`;
  const response_format={type:'json_schema',json_schema:{type:'object',properties:{groups:{type:'array',maxItems:10,items:{type:'object',properties:{summary:{type:'string'},intent:{type:'string',enum:['praise','improvement','contribution','difficulty']},inputStatementIds:{type:'array',items:{type:'string'}}},required:['summary','intent','inputStatementIds']}}},required:['groups']}};
  const result=await env.AI.run(env.AI_MODEL,{messages:[{role:'system',content:'You cluster evidence-backed Vietnamese learner feedback into common ideas without losing any input statement.'},{role:'user',content:prompt}],response_format,max_tokens:2500,temperature:0}),text=typeof result==='string'?result:(result.response??result.result??''),parsed=typeof text==='string'?JSON.parse(text.replace(/^```json\s*|\s*```$/g,'')):text,idMap=new Map(input.map((x,i)=>[x.id,theme.statements[i]])),seen=new Set(),statements=[];
  for(const group of parsed.groups||[]){if(!group.inputStatementIds?.length)throw new Error('category reduction group has no inputs');const members=group.inputStatementIds.map(id=>{if(!idMap.has(id)||seen.has(id))throw new Error(`category reduction invalid or duplicate id: ${id}`);seen.add(id);return idMap.get(id)});if(members.some(x=>x.intent!==group.intent))throw new Error('category reduction mixed different intents');const evidence=[];for(const member of members)for(const item of member.evidence||[])if(!evidence.some(e=>e.sourceAnswerKey===item.sourceAnswerKey&&e.supportQuote===item.supportQuote))evidence.push(item);statements.push({summary:group.summary,intent:group.intent,confidence:Math.min(...members.map(x=>Number(x.confidence??1))),needsHumanReview:members.some(x=>x.needsHumanReview),evidence})}
  if(seen.size!==input.length)throw new Error(`category reduction omitted inputs: ${seen.size}/${input.length}`);return {id:theme.id,label:theme.label,statements}
}
async function loadWeekData(env,targetNow){
  const window=windowFor(targetNow), weekKey=weekKeyFor(window);
  // API filters assignment due date, so query a bounded buffer and classify by submittedAt afterward.
  const from=new Date(window.start.getTime()-14*86400000).toISOString().slice(0,10);
  const to=new Date(window.end.getTime()+21*86400000).toISOString().slice(0,10);
  const raw=await fetchDh3g(env,from,to), normalized=normalizeApiResponse(raw);
  const included=[],excludedGap=[];
  const previousEnd=new Date(window.start.getTime()-26*3600000),nextStart=new Date(window.end.getTime()+26*3600000);
  for(const a of normalized.answers){const t=new Date(a.submittedAt);if(t>=window.start&&t<=window.end)included.push(a);else if((t>previousEnd&&t<window.start)||(t>window.end&&t<nextStart))excludedGap.push(a)}
  const quarantineCount=normalized.quarantine.filter(a=>{const t=new Date(a.submittedAt);return t>=window.start&&t<=window.end}).length;
  return {window,weekKey,included,excludedGap,quarantineCount};
}
async function advanceWeek(env,targetNow,maxChunks=2,runBudget=createRunBudget(maxChunks)){
  const attemptsAtStart=runBudget.attempts;
  runBudget.localLimit=attemptsAtStart+maxChunks;
  const data=await loadWeekData(env,targetNow),maxChars=Number(env.AI_MAX_INPUT_CHARS||50000);let chunks=splitAnswers(data.included,maxChars);
  const fingerprint=await fingerprintAnswers(data.included,{model:env.AI_MODEL,maxChars});let chunkManifest=chunks.map(chunk=>chunk.map(a=>a.sourceAnswerKey));
  let progress=await progressGet(env,data.weekKey);
  if(shouldResumeFrozenProgress(progress,{model:env.AI_MODEL,maxChars})){chunks=[];for(let i=0;i<progress.totalChunks;i++)chunks.push(await frozenChunkGet(env,data.weekKey,i));chunkManifest=progress.chunkManifest;progress.queuedRefreshFingerprint=progress.fingerprint===fingerprint?null:fingerprint;progress.queuedSourceDelta=Math.max(0,data.included.length-progress.inputAnswers)}else{if(progress)await frozenChunksDelete(env,data.weekKey,progress.totalChunks||0);const segmentTotals={};for(const row of chunks.flat()){const key=row.originalSourceAnswerKey||row.sourceAnswerKey;segmentTotals[key]=(segmentTotals[key]||0)+1}progress={fingerprint,analysisVersion:ANALYSIS_VERSION,model:env.AI_MODEL,maxChars,chunkManifest,nextChunk:0,totalChunks:chunks.length,themes:[],processedAnswers:0,processedSourceKeys:[],dispositionBySource:{},segmentTotals,inputAnswers:data.included.length,frozenExcludedGap:data.excludedGap,frozenQuarantineCount:data.quarantineCount,consolidated:false,startedAt:new Date().toISOString()};for(let i=0;i<chunks.length;i++)await frozenChunkPut(env,data.weekKey,i,chunks[i]);await progressPut(env,data.weekKey,progress)}
  let usedChunks=0;
  for(let count=0;count<maxChunks&&progress.nextChunk<chunks.length&&runBudget.remaining>0;count++){
    if(!reserveRunAttempt(runBudget))break;
    await reserveDailyAiAttempt(env);
    const chunk=chunks[progress.nextChunk],aiRaw=await classifyWithApprovedAi(env,chunk),chunkAnswerByKey=new Map(chunk.map(a=>[a.sourceAnswerKey,a])),checked=validateAiResult(aiRaw,chunkAnswerByKey);
    mergeThemes(progress.themes,checked.themes);for(const disposition of checked.dispositions){const source=chunkAnswerByKey.get(disposition.sourceAnswerKey),key=source.originalSourceAnswerKey||source.sourceAnswerKey,state=progress.dispositionBySource[key]||{relevant:false,irrelevant:false,uncertain:false,segmentsProcessed:0};state[disposition.status]=true;state.segmentsProcessed++;progress.dispositionBySource[key]=state}progress.nextChunk++;progress.processedAnswers+=chunk.length;progress.processedSourceKeys=Object.entries(progress.dispositionBySource).filter(([key,state])=>state.segmentsProcessed>=(progress.segmentTotals[key]||1)).map(([key])=>key);usedChunks++;progress.updatedAt=new Date().toISOString();await progressPut(env,data.weekKey,progress);
  }
  if(progress.nextChunk<chunks.length)return {completed:false,usedChunks,weekKey:data.weekKey,processedAnswers:progress.processedAnswers,inputAnswers:progress.inputAnswers,totalChunks:chunks.length,nextChunk:progress.nextChunk,stage:'classification'};
  const frozenOriginalByKey=new Map();for(const row of chunks.flat()){const key=row.originalSourceAnswerKey||row.sourceAnswerKey;if(!frozenOriginalByKey.has(key))frozenOriginalByKey.set(key,{...row,sourceAnswerKey:key,answerText:row.originalAnswerText||row.answerText})}
  if(!progress.consolidated&&progress.themes.length){const consolidationBatches=splitThemesForConsolidation(progress.themes,maxChars);if(progress.nextConsolidationBatch==null){progress.nextConsolidationBatch=0;progress.consolidatedThemes=[];await progressPut(env,data.weekKey,progress)}while(progress.nextConsolidationBatch<consolidationBatches.length&&runBudget.remaining>0){if(!reserveRunAttempt(runBudget))break;await reserveDailyAiAttempt(env);const batch=consolidationBatches[progress.nextConsolidationBatch],consolidated=await consolidateThemesWithApprovedAi(env,batch),checked=validateAiResult(consolidated,frozenOriginalByKey);if(!evidenceInvariant(batch,checked.themes))throw new Error('semantic consolidation changed or dropped source evidence');mergeThemes(progress.consolidatedThemes,checked.themes);progress.nextConsolidationBatch++;usedChunks++;await progressPut(env,data.weekKey,progress)}if(progress.nextConsolidationBatch<consolidationBatches.length)return {completed:false,usedChunks,weekKey:data.weekKey,processedAnswers:progress.processedAnswers,inputAnswers:progress.inputAnswers,totalChunks:chunks.length,nextChunk:progress.nextChunk,stage:'consolidation',completedConsolidationBatches:progress.nextConsolidationBatch,totalConsolidationBatches:consolidationBatches.length};progress.themes=cleanThemes(progress.consolidatedThemes);progress.consolidated=true;delete progress.consolidatedThemes;await progressPut(env,data.weekKey,progress)}else if(!progress.themes.length)progress.consolidated=true;
  const oversizedCategories=progress.themes.filter(t=>(t.statements||[]).length>10);
  if(oversizedCategories.length){if(progress.nextCategoryReduction==null){progress.nextCategoryReduction=0;progress.reducedThemes=progress.themes.filter(t=>(t.statements||[]).length<=10);await progressPut(env,data.weekKey,progress)}while(progress.nextCategoryReduction<oversizedCategories.length&&runBudget.remaining>0&&runBudget.attempts<runBudget.localLimit){if(!reserveRunAttempt(runBudget))break;await reserveDailyAiAttempt(env);const reduced=await reduceCategoryWithApprovedAi(env,oversizedCategories[progress.nextCategoryReduction]);if(reduced.statements.length>10)throw new Error(`category reduction still exceeds 10 ideas: ${reduced.id}`);progress.reducedThemes.push(reduced);progress.nextCategoryReduction++;usedChunks++;await progressPut(env,data.weekKey,progress)}if(progress.nextCategoryReduction<oversizedCategories.length)return {completed:false,usedChunks,weekKey:data.weekKey,stage:'category-reduction',completedCategories:progress.nextCategoryReduction,totalCategories:oversizedCategories.length};progress.themes=progress.reducedThemes;delete progress.reducedThemes;await progressPut(env,data.weekKey,progress)}
  const now=new Date(),themes=cleanThemes(progress.themes),reflected=new Set(themes.flatMap(t=>t.statements).flatMap(s=>s.evidence.map(e=>e.sourceAnswerKey)));
  const dispositions=Object.values(progress.dispositionBySource||{}),frozenCoverage=frozenCoverageState(progress,data.included.length),snapshot={week:{start:data.window.start.toISOString(),end:data.window.end.toISOString()},themes,excludedGap:progress.frozenExcludedGap||[],quarantineCount:Number(progress.frozenQuarantineCount||0),coverage:{...frozenCoverage,asOf:progress.startedAt,sourceFingerprint:progress.fingerprint,modelProcessedAnswers:new Set(progress.processedSourceKeys||[]).size,reflectedSourceAnswers:reflected.size,irrelevantAnswers:dispositions.filter(x=>x.irrelevant&&!x.relevant&&!x.uncertain).length,uncertainAnswers:dispositions.filter(x=>x.uncertain).length,notReflectedAnswers:Math.max(0,progress.inputAnswers-reflected.size)},generatedAt:now.toISOString(),lastSuccessfulSyncAt:now.toISOString(),processing:{provider:'Cloudflare Workers AI',model:env.AI_MODEL,analysisVersion:ANALYSIS_VERSION,status:'completed',processedAt:now.toISOString()}};
  const projection=buildPublicProjection(snapshot);await storePut(env,data.weekKey,JSON.stringify(projection));await progressDelete(env,data.weekKey);await frozenChunksDelete(env,data.weekKey,chunks.length);return {completed:true,usedChunks,weekKey:data.weekKey,projection};
}
async function syncCurrentAndBackfill(env){
  const currentWindow=windowFor(new Date());
  const currentKey=weekKeyFor(currentWindow),currentRaw=await storeGet(env,currentKey),currentSnapshot=currentRaw?JSON.parse(currentRaw):null,currentNeeds=!currentSnapshot||currentSnapshot.coverage?.pendingRefresh===true||Date.now()-new Date(currentSnapshot.generatedAt).getTime()>6*3600000;
  const runBudget=createRunBudget(6);
  let missingOrPending=false;
  for(let offset=1;offset<=8;offset++){
    const target=new Date(currentWindow.start.getTime()-offset*7*86400000+12*3600000);
    const key=weekKeyFor(windowFor(target));
    if(!await storeGet(env,key)){missingOrPending=true;const historyAllowance=Math.max(0,runBudget.remaining-(currentNeeds?1:0));if(historyAllowance<=0)break;try{const result=await advanceWeek(env,target,historyAllowance,runBudget);if(!result.completed||runBudget.remaining<=(currentNeeds?1:0))break}catch(error){await markProgressError(env,key,error);console.error('history_week_failed',key,error?.message);if(isAiQuotaError(error))throw error;continue}}
  }
  let refreshedQueuedHistory=false;
  if(!missingOrPending&&runBudget.remaining>(currentNeeds?1:0)){for(let offset=1;offset<=8;offset++){const target=new Date(currentWindow.start.getTime()-offset*7*86400000+12*3600000),key=weekKeyFor(windowFor(target)),stored=await storeGet(env,key),snapshot=stored?JSON.parse(stored):null;if(snapshot?.coverage?.pendingRefresh===true){const allowance=Math.max(0,runBudget.remaining-(currentNeeds?1:0));if(!allowance)break;try{await advanceWeek(env,target,allowance,runBudget)}catch(error){console.error('history_pending_refresh_failed',key,error?.message)}refreshedQueuedHistory=true;break}}}
  if(!missingOrPending&&!refreshedQueuedHistory&&runBudget.remaining>(currentNeeds?1:0)){for(let offset=1;offset<=2;offset++){const target=new Date(currentWindow.start.getTime()-offset*7*86400000+12*3600000),key=weekKeyFor(windowFor(target)),stored=await storeGet(env,key);if(stored&&needsHistoricalRefresh(JSON.parse(stored))){const allowance=Math.max(0,runBudget.remaining-(currentNeeds?1:0));if(!allowance)break;try{await advanceWeek(env,target,allowance,runBudget)}catch(error){console.error('history_refresh_failed',key,error?.message)}break}}}
  if(currentNeeds&&runBudget.remaining>0)try{await advanceWeek(env,new Date(),1,runBudget)}catch(error){await markProgressError(env,currentKey,error);console.error('current_week_failed',currentKey,error?.message);if(isAiQuotaError(error))throw error}
}
export class SnapshotStore {
  constructor(ctx){this.ctx=ctx}
  async fetch(request){
    const url=new URL(request.url), week=url.pathname.match(/^\/week\/(\d{4}-\d{2}-\d{2})$/)?.[1],progressWeek=url.pathname.match(/^\/progress\/(\d{4}-\d{2}-\d{2})$/)?.[1],chunkPath=url.pathname.match(/^\/progress\/(\d{4}-\d{2}-\d{2})\/chunk\/(\d+)$/),quotaDay=url.pathname.match(/^\/quota\/(\d{4}-\d{2}-\d{2})\/reserve$/)?.[1];
    if(request.method==='GET'){const key=url.pathname==='/legacy'?SNAPSHOT_KEY:(week?`snapshot:${week}`:(chunkPath?`progress:${chunkPath[1]}:chunk:${chunkPath[2]}`:(progressWeek?`progress:${progressWeek}`:null)));if(!key)return new Response('',{status:400});const value=await this.ctx.storage.get(key);return value?new Response(value):new Response('',{status:404})}
    if(request.method==='PUT'&&week){await this.ctx.storage.put(`snapshot:${week}`,await request.text());return new Response('ok')}
    if(request.method==='PUT'&&progressWeek){await this.ctx.storage.put(`progress:${progressWeek}`,await request.text());return new Response('ok')}
    if(request.method==='PUT'&&chunkPath){await this.ctx.storage.put(`progress:${chunkPath[1]}:chunk:${chunkPath[2]}`,await request.text());return new Response('ok')}
    if(request.method==='DELETE'&&progressWeek){await this.ctx.storage.delete(`progress:${progressWeek}`);return new Response('ok')}
    if(request.method==='DELETE'&&chunkPath){await this.ctx.storage.delete(`progress:${chunkPath[1]}:chunk:${chunkPath[2]}`);return new Response('ok')}
    if(request.method==='POST'&&quotaDay){const limit=Math.max(1,Number(await request.text())||1),key=`quota:${quotaDay}`,count=Number(await this.ctx.storage.get(key)||0);if(count>=limit)return new Response('daily cap reached',{status:429});await this.ctx.storage.put(key,count+1);return Response.json({reserved:true,count:count+1,limit})}
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
      if(!value){const progress=await progressGet(env,key),processed=progress?new Set(progress.processedSourceKeys||[]).size:0;return Response.json({status:'pending-backfill',week:{key,start:requestedWindow.start.toISOString(),end:requestedWindow.end.toISOString()},coverage:progress?{status:progress.blockedReason?'blocked':'processing',blockedReason:progress.blockedReason||null,lastErrorAt:progress.lastErrorAt||null,modelProcessedAnswers:processed,inputAnswers:progress.inputAnswers,pendingAnswers:Math.max(0,progress.inputAnswers-processed),completedChunks:progress.nextChunk,totalChunks:progress.totalChunks}:{status:'queued'}},{status:404,headers:{'cache-control':'no-store'}})}
      return new Response(value,{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'public,max-age=300'}});
    }
    if(url.pathname==='/api/health') return Response.json({ok:true,connected:Boolean(env.DH3G_API_KEY&&env.AI&&env.AI_MODEL&&env.SNAPSHOT_STORE),freeOnly:env.AI_FREE_ONLY_CONFIRMED==='true'});
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(syncCurrentAndBackfill(env).catch(error=>console.error('sync_failed',error?.message)))}
};

