const CONTACT_PATTERNS = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,
  /(?:\+?84|0)(?:[ .-]?\d){9,10}\b/g,
  /\b(?:\d[ -]*?){12,19}\b/g
];
const HIGH_RISK = /\b(?:số tài khoản|mật khẩu|password|otp|căn cước|cccd|chẩn đoán|bệnh án)\b/i;

export function sanitizeLearnerText(value) {
  let text=String(value ?? '').trim();
  const flagged=HIGH_RISK.test(text);
  for(const pattern of CONTACT_PATTERNS) text=text.replace(pattern,'[đã ẩn]');
  return {text,flagged};
}

export function normalizeApiResponse(payload) {
  const answers=[]; const quarantine=[];
  const weeklyAssignmentIds=new Set((payload?.assignments || []).filter(a=>String(a.type ?? a.assignmentType ?? '').toUpperCase()==='WEEK').map(a=>String(a.id ?? a.assignmentId)));
  for(const member of payload?.members || []) for(const submission of member.submissions || []) {
    if(!submission?.submittedAt || !submission?.submissionId) continue;
    if(!weeklyAssignmentIds.has(String(submission.assignmentId))) continue;
    (submission.answers || []).forEach((answer,index)=>{
      const raw=answer?.answer;
      if(raw == null || String(raw).trim()==='' || String(raw).trim()==='(Chưa trả lời)') return;
      const clean=sanitizeLearnerText(raw);
      const row={submissionId:String(submission.submissionId),assignmentId:String(submission.assignmentId ?? ''),sourceAnswerKey:`${submission.submissionId}:${index}:v1`,questionIndex:index,questionText:String(answer.question ?? ''),answerText:clean.text,submittedAt:submission.submittedAt,author:{id:String(member.id ?? member.memberId ?? ''),displayName:String(member.name ?? member.fullName ?? 'Chưa rõ tên'),group:String(member.teamName ?? member.groupName ?? '')}};
      (clean.flagged?quarantine:answers).push(row);
    });
  }
  return {answers,quarantine,weeklyAssignmentCount:weeklyAssignmentIds.size};
}

export function buildPublicProjection(snapshot) {
  return {
    schemaVersion:1,
    week:snapshot.week,
    generatedAt:snapshot.generatedAt,
    processing:{provider:snapshot.processing?.provider ?? 'not-configured',model:snapshot.processing?.model ?? null,status:snapshot.processing?.status ?? 'blocked',processedAt:snapshot.processing?.processedAt ?? null},
    themes:(snapshot.themes || []).map(theme=>({
      id:theme.id,label:theme.label,statements:(theme.statements || []).map((statement,i)=>({
        number:i+1,summary:statement.summary,confidence:statement.confidence,needsHumanReview:Boolean(statement.needsHumanReview),
        contributors:(statement.evidence || []).map(e=>({displayName:e.displayName,group:e.group,sourceAnswerKey:e.sourceAnswerKey,submittedAt:e.submittedAt,originalAnswer:e.originalAnswer,questionText:e.questionText}))
      }))
    })),
    excludedGap:snapshot.excludedGap || [],
    quarantineCount:Number(snapshot.quarantineCount || 0),
    source:{endpoint:'cohort-submissions',communityId:44,lastSuccessfulSyncAt:snapshot.lastSuccessfulSyncAt}
  };
}

export function validateAiResult(result, answerByKey) {
  const used=new Set();
  for(const theme of result?.themes || []) for(const statement of theme.statements || []) for(const evidence of statement.evidence || []) {
    const source=answerByKey.get(evidence.sourceAnswerKey);
    if(!source) throw new Error(`AI evidence key not found: ${evidence.sourceAnswerKey}`);
    evidence.displayName=source.author.displayName; evidence.group=source.author.group;
    evidence.submittedAt=source.submittedAt; evidence.originalAnswer=source.answerText; evidence.questionText=source.questionText;
    used.add(evidence.sourceAnswerKey);
  }
  return {...result,usedEvidenceKeys:[...used]};
}

export function prepareAiInput(answers, maxChars=50000) {
  let used=0; const rows=[];
  for(const answer of answers){
    const row={sourceAnswerKey:answer.sourceAnswerKey,questionText:answer.questionText,answerText:answer.answerText,submittedAt:answer.submittedAt};
    const size=JSON.stringify(row).length;
    if(used+size>maxChars) break;
    used+=size; rows.push(row);
  }
  return {rows,inputChars:used,truncated:rows.length<answers.length};
}

