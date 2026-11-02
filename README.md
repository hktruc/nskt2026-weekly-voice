# NSKT2026 Weekly Voice

Prototype công khai dùng dữ liệu giả lập cho Ban Phụng sự đọc và xử lý phản hồi học viên theo tuần.

## Trạng thái

- UI responsive dùng **dữ liệu giả lập** trong `dist/fixtures.mjs`.
- Chưa kết nối DH3G API, chưa dùng AI thật, chưa chứa tên/nội dung học viên thật.
- Chủ sở hữu đã chọn website **công khai, không đăng nhập**. Mã nguồn demo ở `hktruc/nskt2026-weekly-voice`; bản fixture được triển khai bằng Workers Static Assets tại `https://nskt2026-weekly-voice-demo.hktruc.workers.dev`.

## Chạy local

```powershell
npx serve . -l 4173
```

Mở `http://localhost:4173/dist/`.

## Kiểm thử

```powershell
node --test tests/*.test.mjs
```

## Luồng production dự kiến

1. Cloudflare Worker gọi DH3G API trực tiếp bằng secret phía server (không đưa token xuống trình duyệt).
2. Worker chuẩn hóa submission/answer, khử trùng khóa dẫn xuất và lưu snapshot đã được phép vào D1. API giới hạn mỗi khoảng truy vấn tối đa 62 ngày; đây không phải khẳng định về thời gian lưu giữ dữ liệu.
3. Bộ phân loại AI đọc **toàn bộ câu trả lời dạng văn bản**, không phụ thuộc số câu hỏi, trả về cấu trúc theo `docs/semantic-contract.md`.
4. Mỗi kết luận giữ provenance: submission ID, khóa câu trả lời dẫn xuất, thời gian thật, tác giả và nguyên văn; source và diễn giải AI luôn tách riêng.
5. UI chỉ nhận dữ liệu sau khi xác thực và kiểm tra quyền truy cập.

### API đã truy vết từ lịch sử dự án

- Endpoint được ghi nhận: `GET https://api.dh3g.vn/hkm-api/public/report/cohort-submissions`.
- `communityId=44`, xác thực bằng header `X-API-KEY` ở server và `includeAnswers=true` để lấy nội dung trả lời. Response được ghi nhận gồm `assignments[]`, `members[]`; mỗi submission có `assignmentId`, `dueDate`, `status`, `submissionId`, `submittedAt` và tùy chọn `answers[]`.
- Đây là bằng chứng lịch sử, chưa phải kiểm chứng API live trong prototype này.
- Bộ lọc ngày của API từng được xác định là lọc theo **hạn bài tập (assignment due date)**, không phải thời gian nộp. Vì vậy không được truyền thẳng ranh giới tuần báo cáo làm `fromDate/toDate`: phải lấy đủ các bài đang mở/có hạn tương lai liên quan, sau đó phân tuần bằng timestamp submission/answer đã xác minh.
- API chỉ trả submission mới nhất và không tài liệu hóa pagination. `answers[]` không có answer ID; app phải dùng khóa dẫn xuất có xử lý va chạm, giữ question text/index và không giả dạng khóa đó là ID nguồn.
- Loại bỏ contact fields khỏi projection công khai và không lưu nếu không cần. `feedbacks[]` là nhận xét người chấm, không phải nội dung học viên.

## Chốt cần có trước production

1. Với website công khai: hiển thị tên + nguyên văn góp ý, hay chỉ bản tổng hợp đã ẩn danh?
2. Tài liệu endpoint/schema và cơ chế auth DH3G đang dùng ở dashboard NSKT2026 DEV.
3. Dịch vụ AI nào đã được phê duyệt để xử lý phản hồi học viên, chính sách lưu dữ liệu và vùng xử lý.
4. Trước khi nối dữ liệu thật, tạo Worker API/server-side secrets và chính sách lưu trữ đã được phê duyệt; bản hiện tại chỉ là static demo.

Không commit secrets, dữ liệu học viên, log payload thật hoặc output AI chứa dữ liệu thật.

### Biên dữ liệu công khai

Worker phải tách hai tầng: `private_evidence` (nguyên văn, ID, tác giả; không có endpoint công khai) và `public_projection` (chỉ các trường đã allowlist và duyệt để xuất bản). Frontend công khai chỉ đọc `public_projection`; không được gọi DH3G trực tiếp từ trình duyệt.

