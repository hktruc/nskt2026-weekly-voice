import { classifyByWeek } from './core.mjs';
import { records, topics } from './fixtures.mjs';

const result = classifyByWeek(records, '2026-11-03T12:00:00+07:00');
const byAnswer = new Map(records.map(r => [r.sourceAnswerKey, r]));
const fmt = d => new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(d);
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };

const systemState=el('section','system-state');
systemState.setAttribute('role','status');
document.querySelector('#state').before(systemState);
const demoState=new URLSearchParams(location.search).get('state');
if(demoState==='loading') systemState.textContent='Đang đồng bộ dữ liệu và phân tích chủ đề…';
else if(demoState==='error') { systemState.classList.add('error'); systemState.textContent='Không thể đồng bộ dữ liệu mới. Đang giữ bản hợp lệ gần nhất; vui lòng thử lại sau.'; }
else if(demoState==='unclassified') { systemState.classList.add('warning'); systemState.textContent='Có phản hồi chưa đủ rõ để phân loại. Ban Phụng sự cần rà soát thủ công.'; }
else if(result.invalid.length) { systemState.classList.add('warning'); systemState.textContent=`${result.invalid.length} bản ghi có thời gian không hợp lệ, đã tách để rà soát.`; }
else systemState.hidden=true;
const sourceDialog=el('dialog','source-dialog');
const dialogBody=el('div','dialog-body');
const dialogClose=el('button','dialog-close','Đóng'); dialogClose.type='button'; dialogClose.addEventListener('click',()=>sourceDialog.close());
sourceDialog.append(dialogClose,dialogBody); document.body.append(sourceDialog);
function openSource(r){dialogBody.replaceChildren(el('p','eyebrow','Dữ liệu gốc liên quan'),el('h2','',r.author.displayName),el('p','meta',`${r.author.group} · ${fmt(new Date(r.submittedAt))}`),el('p','question',r.questionText),el('blockquote','',r.answerText),el('code','',`${r.submissionId} / ${r.sourceAnswerKey}`));sourceDialog.showModal()}

document.querySelector('#range').textContent = `${fmt(result.start)} → ${fmt(result.end)}`;
document.querySelector('#denominator').textContent = `${result.included.length} phản hồi hợp lệ • ${result.excludedGap.length} ngoài khung giờ`;

const grid=document.querySelector('#topics');
let kind='all';
function render(){
  const query=document.querySelector('#search').value.trim().toLocaleLowerCase('vi');
  const visible=topics.filter(t=>kind==='all'||t.kind===kind).filter(t=>!query||`${t.label} ${t.summary} ${t.evidence.map(id=>byAnswer.get(id)?.answerText).join(' ')}`.toLocaleLowerCase('vi').includes(query));
  grid.replaceChildren();
  document.querySelector('#result-count').textContent=`${visible.length} chủ đề`;
  const state=document.querySelector('#state'); state.hidden=visible.length>0;
  if(!visible.length) state.textContent='Không tìm thấy chủ đề phù hợp. Thử từ khóa hoặc bộ lọc khác.';
for (const topic of visible) {
  const card=el('article',`topic ${topic.tone}`);
  const head=el('div','topic-head'); head.append(el('span','pill',topic.label),el('span','count',`${topic.evidence.length}/${result.included.length}`));
  card.append(head,el('h2','',topic.summary));
  const ai=el('p','ai'); ai.append(el('strong','', 'AI diễn giải · '),document.createTextNode(`độ tin cậy ${Math.round(topic.confidence*100)}%`)); card.append(ai);
  const people=el('div','contributors'); people.append(el('span','', 'Học viên: '));
  for(const id of topic.evidence){const r=byAnswer.get(id);const b=el('button','person-link',r.author.displayName);b.type='button';b.addEventListener('click',()=>openSource(r));people.append(b)} card.append(people);
  const details=el('details'); details.append(el('summary','',`Xem ${topic.evidence.length} nguồn đối chiếu`));
  for (const id of topic.evidence) { const r=byAnswer.get(id); const box=el('div','evidence'); box.append(el('p','quote',`“${r.answerText}”`),el('p','meta',`${r.author.displayName} · ${r.author.group} · ${fmt(new Date(r.submittedAt))}`),el('code','',`${r.submissionId} / khóa dẫn xuất: ${r.sourceAnswerKey}`)); details.append(box); }
  card.append(details); grid.append(card);
}}
render();
document.querySelector('#search').addEventListener('input',render);
document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));btn.classList.add('active');kind=btn.dataset.kind;render()}));
document.querySelector('#previous').addEventListener('click',()=>alert('Prototype: dữ liệu tuần trước chưa được nạp.'));

const gap=document.querySelector('#gap-list');
for(const r of result.excludedGap){const li=el('li');li.append(el('strong','',fmt(new Date(r.submittedAt))),document.createTextNode(` — ${r.answerText}`));gap.append(li)}
document.querySelector('#gap-count').textContent=result.excludedGap.length;

