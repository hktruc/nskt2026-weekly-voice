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
        number:i+1,summary:statement.summary,intent:statement.intent,confidence:statement.confidence,needsHumanReview:Boolean(statement.needsHumanReview),
        contributors:(statement.evidence || []).map(e=>({displayName:e.displayName,group:e.group,sourceAnswerKey:e.sourceAnswerKey,submittedAt:e.submittedAt,originalAnswer:e.originalAnswer,questionText:e.questionText}))
      }))
    })),
    excludedGap:(snapshot.excludedGap || []).map(row=>({sourceAnswerKey:row.sourceAnswerKey,assignmentId:row.assignmentId,submittedAt:row.submittedAt,reason:'outside-reporting-window'})),
    quarantineCount:Number(snapshot.quarantineCount || 0),
    coverage:snapshot.coverage || null,
    source:{endpoint:'cohort-submissions',communityId:44,lastSuccessfulSyncAt:snapshot.lastSuccessfulSyncAt}
  };
}

export function validateAiResult(result, answerByKey) {
  const categoryLabels={journal_peer_feedback:'Nhật ký trải nghiệm khen chê',transformation:'Chuyển hóa sau thực hành',self_kaizen:'Điểm tự Kaizen',class_strengths:'Điểm tốt cần phát huy',class_improvements:'Điểm cần cải thiện trong lớp',learner_contributions:'Hành động đóng góp của học viên',btc_teacher_questions:'Khó khăn và câu hỏi đến BTC/Thầy'};
  const used=new Set(),evidencedInputs=new Set();
  let statementCount=0,reviewCount=0,perfectConfidenceCount=0;
  for(const theme of result?.themes || []) {
    if(theme.id&&!categoryLabels[theme.id]) throw new Error(`AI category is invalid: ${theme.id}`);
    if(theme.id)theme.label=categoryLabels[theme.id];
    for(const statement of theme.statements || []) {
    statementCount++;if(statement.needsHumanReview)reviewCount++;if(Number(statement.confidence)>=0.99)perfectConfidenceCount++;
    if(!Array.isArray(statement.evidence)||statement.evidence.length===0) throw new Error('AI statement evidence is required');
    if(statement.intent && !['praise','improvement','contribution','difficulty'].includes(statement.intent)) throw new Error(`AI intent is invalid: ${statement.intent}`);
    for(const evidence of statement.evidence || []) {
    const source=answerByKey.get(evidence.sourceAnswerKey);
    if(!source) throw new Error(`AI evidence key not found: ${evidence.sourceAnswerKey}`);
    evidencedInputs.add(evidence.sourceAnswerKey);
    if(String(statement.summary ?? '').trim()&&!String(evidence.supportQuote ?? '').trim()) throw new Error(`AI support quote is required: ${evidence.sourceAnswerKey}`);
    if(evidence.supportQuote&&!source.answerText.includes(evidence.supportQuote)) throw new Error(`AI support quote not found in source: ${evidence.sourceAnswerKey}`);
    const normalizedSummary=String(statement.summary||'').trim().toLocaleLowerCase('vi').replace(/\s+/g,' '),normalizedSource=String(source.answerText||'').toLocaleLowerCase('vi').replace(/\s+/g,' ');
    if(normalizedSummary.length>=12&&normalizedSource.includes(normalizedSummary))throw new Error(`AI summary copies source text instead of synthesizing: ${evidence.sourceAnswerKey}`);
    const normalizedQuote=String(evidence.supportQuote||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/đ/gi,'d');
    if(theme.id==='class_strengths'&&/(?:\bcan\b|\bmong\b|\bnen\b|\bthem\b|nhieu hon)/i.test(normalizedQuote)&&!statement.needsHumanReview&&Number(statement.confidence)>=0.9)throw new Error(`Ambiguous request is mislabeled as confident praise: ${evidence.sourceAnswerKey}`);
    if(theme.id==='class_strengths'&&/(?:c?n|mong|n�n|th�m|nhi?u hon|nhi?u hon n?a)/i.test(String(evidence.supportQuote||''))&&!statement.needsHumanReview&&Number(statement.confidence)>=0.9)throw new Error(`Ambiguous request is mislabeled as confident praise: ${evidence.sourceAnswerKey}`);
    evidence.displayName=source.author.displayName; evidence.group=source.author.group;
    evidence.submittedAt=source.submittedAt; evidence.originalAnswer=source.originalAnswerText||source.answerText; evidence.questionText=source.questionText;evidence.sourceAnswerKey=source.originalSourceAnswerKey||source.sourceAnswerKey;
    used.add(evidence.sourceAnswerKey);
    }
    }
  }
  if(statementCount>=3&&perfectConfidenceCount===statementCount&&reviewCount===0)throw new Error('AI quality calibration is implausibly uniform');
  const dispositions=result?.dispositions;
  if(!Array.isArray(dispositions)) return {...result,usedEvidenceKeys:[...used]};
  const dispositionKeys=new Set();
  for(const disposition of dispositions){if(!answerByKey.has(disposition.sourceAnswerKey))throw new Error(`AI disposition key not found: ${disposition.sourceAnswerKey}`);if(dispositionKeys.has(disposition.sourceAnswerKey))throw new Error(`AI disposition key duplicated: ${disposition.sourceAnswerKey}`);if(!['relevant','irrelevant','uncertain'].includes(disposition.status))throw new Error(`AI disposition invalid: ${disposition.status}`);dispositionKeys.add(disposition.sourceAnswerKey)}
  if(dispositionKeys.size!==answerByKey.size)throw new Error(`AI dispositions incomplete: ${dispositionKeys.size}/${answerByKey.size}`);
  for(const key of evidencedInputs)if(!dispositions.some(d=>d.sourceAnswerKey===key&&d.status==='relevant'))throw new Error(`AI evidenced answer is not marked relevant: ${key}`);
  for(const disposition of dispositions)if(disposition.status==='relevant'&&!evidencedInputs.has(disposition.sourceAnswerKey))throw new Error(`AI relevant answer has no published evidence: ${disposition.sourceAnswerKey}`);
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

