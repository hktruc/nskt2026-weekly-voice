export const records = [
  { submissionId:'demo-sub-01', sourceAnswerKey:'demo-sub-01:q-obstacle:0:v1', submittedAt:'2026-10-31T08:20:00+07:00', author:{displayName:'Học viên Minh (giả lập)',group:'Nhóm Sen'}, questionText:'Điều gì đang cản trở việc học?', answerText:'Tôi chưa rõ cách thực hành bài quán chiếu và sợ làm sai.' },
  { submissionId:'demo-sub-02', sourceAnswerKey:'demo-sub-02:q-support:0:v1', submittedAt:'2026-11-02T20:10:00+07:00', author:{displayName:'Học viên An (giả lập)',group:'Nhóm Trúc'}, questionText:'Bạn muốn BTC hỗ trợ gì?', answerText:'Mong BTC gửi lại đường dẫn tài liệu sớm hơn trước buổi học.' },
  { submissionId:'demo-sub-03', sourceAnswerKey:'demo-sub-03:q-more:0:v1', submittedAt:'2026-11-05T22:40:00+07:00', author:{displayName:'Học viên Bình (giả lập)',group:'Nhóm Mai'}, questionText:'Chia sẻ thêm', answerText:'Buổi tối hơi muộn với tôi nhưng nội dung rất hữu ích.' },
  { submissionId:'demo-sub-gap', sourceAnswerKey:'demo-sub-gap:q-feedback:0:v1', submittedAt:'2026-11-06T08:00:00+07:00', author:{displayName:'Học viên Lan (giả lập)',group:'Nhóm Cúc'}, questionText:'Góp ý', answerText:'Bản ghi này thuộc khoảng nghỉ và phải hiển thị riêng.' }
];

export const topics = [
  { id:'learning', label:'Phương pháp học', tone:'amber', summary:'Một học viên chưa tự tin về cách thực hành bài quán chiếu.', confidence:.88, evidence:['demo-sub-01:q-obstacle:0:v1'], kind:'difficulty' },
  { id:'btc', label:'Hỗ trợ từ BTC', tone:'blue', summary:'Có đề nghị gửi đường dẫn tài liệu sớm hơn trước buổi học.', confidence:.94, evidence:['demo-sub-02:q-support:0:v1'], kind:'suggestion' },
  { id:'schedule', label:'Lịch học & trải nghiệm', tone:'violet', summary:'Có ý kiến giờ học buổi tối hơi muộn, đồng thời đánh giá nội dung hữu ích.', confidence:.83, evidence:['demo-sub-03:q-more:0:v1'], kind:'difficulty' }
];

