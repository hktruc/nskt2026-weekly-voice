const fmt = value => new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const state=document.querySelector('#state'), grid=document.querySelector('#topics');
let selectedKey=null, currentKey=null, paintCurrent=()=>{};
const keyFromStart=value=>new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,10);
const intentLabel={praise:'Điểm mạnh',improvement:'Cần cải thiện',contribution:'Đóng góp',difficulty:'Khó khăn / hỗ trợ'};
const shiftKey=(key,days)=>{const d=new Date(`${key}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
function updateNavigation(){const previous=document.querySelector('#previous'),next=document.querySelector('#next');previous.disabled=!selectedKey||selectedKey<=shiftKey(currentKey,-56);next.disabled=!selectedKey||selectedKey>=currentKey}
function rememberWeek(key){const url=new URL(location.href);if(key&&key!==currentKey)url.searchParams.set('week',key);else url.searchParams.delete('week');history.replaceState(null,'',url)}
const sourceDialog=el('dialog','source-dialog'), dialogBody=el('div','dialog-body'), dialogClose=el('button','dialog-close','Đóng');
dialogClose.type='button'; dialogClose.addEventListener('click',()=>sourceDialog.close()); sourceDialog.append(dialogClose,dialogBody); document.body.append(sourceDialog);
function openSource(source){dialogBody.replaceChildren(el('p','eyebrow','Dữ liệu gốc liên quan'),el('h2','',source.displayName),el('p','meta',`${source.group || 'Chưa rõ nhóm'} · ${fmt(source.submittedAt)}`),el('p','question',source.questionText || 'Câu hỏi không có tiêu đề'),el('blockquote','',source.originalAnswer),el('code','',`Khóa nguồn: ${source.sourceAnswerKey}`));sourceDialog.showModal()}
function render(data){
  selectedKey=keyFromStart(data.week.start); if(!currentKey)currentKey=keyFromStart(data.week.start);
  const statements=(data.themes || []).flatMap(theme=>(theme.statements || []).map(statement=>({...statement,label:theme.label})));
  document.querySelector('#range').textContent=`${fmt(data.week.start)} → ${fmt(data.week.end)}`;
  const sourceCount=new Set(statements.flatMap(x=>x.contributors.map(c=>c.sourceAnswerKey))).size;
  document.querySelector('#denominator').textContent=`${sourceCount} phản hồi có bằng chứng · ${data.excludedGap?.length || 0} ngoài khung giờ`;
  document.querySelector('#gap-count').textContent=data.excludedGap?.length || 0;
  document.querySelector('.badge').textContent='DỮ LIỆU DH3G · BÀI TẬP TUẦN';
  document.querySelector('.footer span:last-child').textContent=`Đồng bộ: ${fmt(data.source.lastSuccessfulSyncAt)} · ${data.processing.provider}`;
  const paint=()=>{
    const query=document.querySelector('#search').value.trim().toLocaleLowerCase('vi');
    const visible=statements.filter(x=>!query||`${x.label} ${x.summary} ${x.contributors.map(c=>c.originalAnswer).join(' ')}`.toLocaleLowerCase('vi').includes(query));
    grid.replaceChildren();document.querySelector('#result-count').textContent=`${visible.length} ý tổng hợp`;state.hidden=visible.length>0;if(!visible.length)state.textContent='Không tìm thấy nội dung phù hợp.';
    for(const item of visible){const card=el('article',`topic ${item.intent==='praise'?'blue':item.intent==='contribution'?'violet':'amber'}`),head=el('div','topic-head');head.append(el('span','pill',`${item.label} · ${intentLabel[item.intent] || 'Cần rà soát'}`),el('span','count',`${item.contributors.length} nguồn`));card.append(head,el('h2','',`${item.number}. ${item.summary}`),el('p','ai',`AI diễn giải · độ tin cậy ${Math.round(Number(item.confidence || 0)*100)}%${item.needsHumanReview?' · cần rà soát':''}`));const people=el('div','contributors');people.append(el('span','', 'Học viên: '));for(const source of item.contributors){const b=el('button','person-link',source.displayName);b.type='button';b.addEventListener('click',()=>openSource(source));people.append(b)}card.append(people);const details=el('details');details.append(el('summary','',`Xem ${item.contributors.length} nguồn đối chiếu`));for(const source of item.contributors){const box=el('div','evidence');box.append(el('p','quote',`“${source.originalAnswer}”`),el('p','meta',`${source.displayName} · ${source.group || 'Chưa rõ nhóm'} · ${fmt(source.submittedAt)}`),el('code','',source.sourceAnswerKey));details.append(box)}card.append(details);grid.append(card)}
  };
  paintCurrent=paint;document.querySelectorAll('.filter').forEach(button=>button.hidden=true);paint();updateNavigation();
}
let requestId=0,controller=null;
async function loadWeek(key=null){
  const id=++requestId;controller?.abort();controller=new AbortController();state.hidden=false;state.classList.remove('error');state.textContent='Đang tải tuần đã chọn…';grid.replaceChildren();
  try{
    const response=await fetch(`/api/public/week${key?`?week=${encodeURIComponent(key)}`:''}`,{cache:'no-store',signal:controller.signal});
    const payload=await response.json();if(id!==requestId)return;
    if(response.status===404&&payload.status==='pending-backfill'){
      selectedKey=payload.week.key;if(!currentKey)currentKey=keyFromStart(windowForClient(new Date()).start);rememberWeek(selectedKey);
      const coverage=payload.coverage||{status:'queued'},progress=coverage.status==='processing'?`Đã đọc ${coverage.modelProcessedAnswers}/${coverage.inputAnswers} câu trả lời · lô ${coverage.completedChunks}/${coverage.totalChunks}`:'Đang xếp hàng tổng hợp';document.querySelector('#range').textContent=`${fmt(payload.week.start)} → ${fmt(payload.week.end)}`;document.querySelector('#denominator').textContent=progress;document.querySelector('#result-count').textContent='Chưa có bản tổng hợp hoàn chỉnh';document.querySelector('#gap-count').textContent='0';document.querySelector('.footer span:last-child').textContent='Tuần đã chọn đang được xử lý theo từng lô';state.classList.add('warning');state.textContent='Chưa tổng hợp xong dữ liệu tuần này. Hệ thống chỉ công bố sau khi đã đọc đủ các lô; đây không có nghĩa là tuần này không có phản hồi.';updateNavigation();return;
    }
    if(!response.ok)throw new Error('Không thể tải dữ liệu tuần đã chọn.');render(payload);rememberWeek(selectedKey);state.hidden=true;
  }catch(error){if(error.name==='AbortError')return;state.classList.add('error');state.textContent=`${error.message} Bản đang xem không bị thay bằng dữ liệu của tuần khác.`}
}
function windowForClient(now){const local=new Date(now.getTime()+7*3600000),day=local.getUTCDay();let delta=(day-6+7)%7;if(day===6&&local.getUTCHours()<1)delta=7;const start=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-delta,1)-7*3600000);return{start,end:new Date(start.getTime()+5*86400000+22*3600000)}}
document.querySelector('#search').addEventListener('input',()=>paintCurrent());
document.querySelector('#previous').addEventListener('click',()=>loadWeek(shiftKey(selectedKey,-7)));
document.querySelector('#next').addEventListener('click',()=>loadWeek(shiftKey(selectedKey,7)));
currentKey=keyFromStart(windowForClient(new Date()).start);
loadWeek(new URLSearchParams(location.search).get('week'));
