const fmt = value => new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
const state=document.querySelector('#state'), grid=document.querySelector('#topics');
const sourceDialog=el('dialog','source-dialog'), dialogBody=el('div','dialog-body'), dialogClose=el('button','dialog-close','Đóng');
dialogClose.type='button'; dialogClose.addEventListener('click',()=>sourceDialog.close()); sourceDialog.append(dialogClose,dialogBody); document.body.append(sourceDialog);
function openSource(source){dialogBody.replaceChildren(el('p','eyebrow','Dữ liệu gốc liên quan'),el('h2','',source.displayName),el('p','meta',`${source.group || 'Chưa rõ nhóm'} · ${fmt(source.submittedAt)}`),el('p','question',source.questionText || 'Câu hỏi không có tiêu đề'),el('blockquote','',source.originalAnswer),el('code','',`Khóa nguồn: ${source.sourceAnswerKey}`));sourceDialog.showModal()}
function render(data){
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
    for(const item of visible){const card=el('article','topic amber'),head=el('div','topic-head');head.append(el('span','pill',item.label),el('span','count',`${item.contributors.length} nguồn`));card.append(head,el('h2','',`${item.number}. ${item.summary}`),el('p','ai',`AI diễn giải · độ tin cậy ${Math.round(Number(item.confidence || 0)*100)}%${item.needsHumanReview?' · cần rà soát':''}`));const people=el('div','contributors');people.append(el('span','', 'Học viên: '));for(const source of item.contributors){const b=el('button','person-link',source.displayName);b.type='button';b.addEventListener('click',()=>openSource(source));people.append(b)}card.append(people);const details=el('details');details.append(el('summary','',`Xem ${item.contributors.length} nguồn đối chiếu`));for(const source of item.contributors){const box=el('div','evidence');box.append(el('p','quote',`“${source.originalAnswer}”`),el('p','meta',`${source.displayName} · ${source.group || 'Chưa rõ nhóm'} · ${fmt(source.submittedAt)}`),el('code','',source.sourceAnswerKey));details.append(box)}card.append(details);grid.append(card)}
  };
  document.querySelector('#search').addEventListener('input',paint);document.querySelectorAll('.filter').forEach(button=>button.hidden=true);paint();
}
async function start(){state.hidden=false;state.textContent='Đang tải bản tổng hợp gần nhất…';try{const response=await fetch('/api/public/week',{cache:'no-store'});if(!response.ok)throw new Error(response.status===503?'Chưa có bản đồng bộ thành công đầu tiên.':'Không thể tải dữ liệu.');render(await response.json());state.hidden=true}catch(error){state.classList.add('error');state.textContent=`${error.message} Hệ thống sẽ giữ bản gần nhất khi các lần đồng bộ sau gặp lỗi.`}}
start();
