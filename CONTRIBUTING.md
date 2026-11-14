# Cách làm việc chung trên repo này

Nhóm Astrovivu làm trên một repo: <https://github.com/quocbao271207/astrovivu-field-shift>. Tài liệu này nói ai làm phần nào, làm ở thư mục nào, và các bước để đưa thay đổi vào `main` mà không đè lên nhau.

## 1. Ai làm gì

| Người | Tài khoản | Phần phụ trách | Thư mục của mình |
|---|---|---|---|
| Bảo | `quocbao271207` | UI/UX toàn bộ, bản đồ, hợp đồng dữ liệu, gộp nhánh | `src/ui/**` (trừ `mascot`), `src/globe/**`, `src/styles/**`, `src/contracts/**`, `src/state/**` |
| Uyên | `thuyyen03052008` | Mascot | `src/ui/mascot/**`, `public/mascot/**`, `docs/MASCOT.md` |
| Thái | `quocthai2711` | Dữ liệu cây trồng, giá và chi phí; công cụ trồng rau đô thị | `data/crops/**`, `scripts/crops/**`, `scripts/build-crop-catalog.ts`, `src/core/crops/**`, `public/data/crops/**`, `src/core/urban/**`, `docs/CROP_DATA.md` |
| Khoa | `khoaminh2957` | Mô hình: độ phù hợp và tối ưu lợi nhuận; chatbot | `src/core/scoring/**`, `src/core/economics/**`, `src/core/advisory/rotation.ts`, `src/rag/**`, `server/**`, `scripts/rag/**`, `data/rag/**`, `public/rag/**`, `docs/SCORING.md`, `docs/SCORING_PAPER.md`, `docs/ECONOMICS.md`, `docs/RAG.md` |
| Duy | `MinDuy314` | Cải tạo đất từ dữ liệu đất | `src/core/soil/**`, `docs/SOIL.md` |

`.github/CODEOWNERS` ghi lại bảng này cho GitHub: pull request chạm vào thư mục nào thì người phụ trách thư mục đó được mời review.

Cần sửa ngoài thư mục của mình thì vẫn sửa được, nhưng người phụ trách phần đó phải review. Riêng `src/contracts/**` chỉ được **thêm** (trường tuỳ chọn mới, kiểu mới), không đổi tên, không xoá: ba phần còn lại đều đọc từ đó.

## Quy tắc chung: việc gì cũng có căn cứ

Không đưa vào repo thứ gì không chỉ được căn cứ: số liệu có nguồn và ngày truy cập; công thức và ngưỡng có tài liệu công bố hoặc phép thử trên dữ liệu thật; thay đổi giao diện có quan sát, số đo hoặc yêu cầu đề bài đứng sau. Bảng đầy đủ ở mục 1 của `docs/UX_PLAN.md`; mẫu pull request có ô "Căn cứ" để ghi.

## 2. Cài đặt lần đầu

Cần Git và Node 24.

```bash
git clone https://github.com/quocbao271207/astrovivu-field-shift.git
cd astrovivu-field-shift
npm install
npm run dev
```

Mở <http://localhost:5173>. Khoá API (nếu có) để trong tệp `.env`, tệp này không bao giờ được commit.

Đặt tên và email cho commit của mình (email ẩn của GitHub lấy ở Settings → Emails):

```bash
git config user.name "ten-tai-khoan-github"
git config user.email "ID+ten-tai-khoan@users.noreply.github.com"
```

## 3. Quy trình mỗi lần làm việc

Không commit thẳng lên `main`. Mỗi việc một nhánh, xong thì mở pull request.

1. Lấy bản mới nhất rồi tạo nhánh:

   ```bash
   git switch main
   git pull
   git switch -c data/crop-prevalence-vn
   ```

2. Làm, rồi kiểm tra trước khi commit (CI chạy đúng ba lệnh này):

   ```bash
   npx tsc --noEmit
   npx vitest run
   npx vite build
   ```

3. Commit thành từng bước nhỏ, rồi đẩy nhánh lên:

   ```bash
   git add <các tệp của mình>
   git commit -m "feat(crops): cột mức độ phổ biến theo quốc gia"
   git push -u origin data/crop-prevalence-vn
   ```

4. Mở pull request vào `main` trên GitHub và điền mẫu có sẵn. Nhánh `main` được bảo vệ: GitHub chỉ cho gộp khi CI xanh và có ít nhất một người khác duyệt (người phụ trách phần bị chạm được mời tự động). Không ai đẩy thẳng, đẩy đè (force push) hay xoá `main` được; riêng chủ repo đẩy thẳng được khi cần. Gộp bằng **Squash and merge**, rồi xoá nhánh.

5. Nhánh sống lâu hơn một ngày thì cập nhật từ `main` trước khi làm tiếp:

   ```bash
   git fetch origin
   git merge origin/main
   ```

### Tên nhánh

| Tiền tố | Dùng cho | Ví dụ |
|---|---|---|
| `ui/` | giao diện, bản đồ | `ui/field-panel-width` |
| `mascot/` | mascot | `mascot/first-poses` |
| `data/` | dữ liệu cây trồng | `data/cost-by-country` |
| `model/` | chấm điểm, kinh tế | `model/profit-optimizer` |
| `chat/` | chatbot | `chat/table-lookups` |
| `urban/` | trồng rau đô thị | `urban/sun-hours` |
| `soil/` | cải tạo đất | `soil/diagnosis` |
| `db/` | cơ sở dữ liệu Supabase, dữ liệu giá | `db/price-views` |
| `ci/` | workflow, kiểm tra tự động | `ci/smoke-test` |
| `fix/` | sửa lỗi nhỏ ở bất kỳ đâu | `fix/calendar-label` |
| `docs/` | chỉ tài liệu | `docs/demo-script` |

### Lời nhắn commit

`loại(phạm vi): việc đã làm`, viết ngắn, tiếng Anh hoặc tiếng Việt đều được. Loại: `feat`, `fix`, `data`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, `revert`. Ví dụ: `fix(scoring): pH gate no longer zeroes alfalfa in Nevada`.

Tiêu đề pull request viết theo đúng mẫu này: khi gộp bằng Squash and merge, tiêu đề trở thành lời nhắn commit trên `main`, nên có một kiểm tra tự động cho nó.

## 4. Những chỗ dễ đụng nhau

| Tệp | Vì sao | Cách tránh |
|---|---|---|
| `src/contracts/**` | cả bốn phần đọc | chỉ thêm trường tuỳ chọn; ghi rõ trong pull request |
| `src/state/mission.ts` | trạng thái chung | báo Bảo trước khi sửa |
| `src/core/crops/curated.generated.ts`, `public/data/crops/ecocrop.json` | tệp sinh ra, rất dài | **không sửa tay, không tự gỡ xung đột**: sửa nguồn trong `scripts/crops/` hoặc `data/crops/`, chạy `npm run crops:build`, commit cả nguồn lẫn tệp sinh ra; khi xung đột thì lấy bản của `main` rồi chạy lại lệnh |
| `strings.ts` trong mỗi thư mục UI | nhiều người thêm chuỗi | mỗi chuỗi một dòng, luôn có cả tiếng Anh và tiếng Việt |
| `package.json`, `package-lock.json` | thêm thư viện | một pull request riêng chỉ để thêm thư viện, gộp sớm |

## 5. Việc của từng phần

### Mascot (Uyên)

Đọc `src/ui/mascot/README.md`: tranh để ở đâu, thành phần React cần xuất ra như thế nào, và quy tắc (tranh tự vẽ, tệp nhỏ, lời thoại có cả hai thứ tiếng). Bảo sẽ gắn mascot vào các màn hình; Uyên không cần sửa các tệp UI khác.

### Dữ liệu cây trồng (Thái)

**Vấn đề hiện tại.** Danh mục có 2.062 loài từ FAO EcoCrop và 73 cây đã biên soạn. Việc xếp hạng (`rankCrops` trong `src/core/scoring/index.ts`) chỉ dựa trên khí hậu và đất ở toạ độ của thửa ruộng, nên một loài hợp khí hậu nhưng không ai trồng ở nước đó vẫn được đề xuất. Chi phí và giá tham chiếu (`scripts/crops/economics.ts`) mới có bốn vùng: `VN`, `US`, `US-HEARTLAND`, `US-WEST`.

**Mục tiêu.**

1. Một cột "cổng" cho biết cây đó có phổ biến ở quốc gia hoặc vùng đó không, để mô hình loại hoặc hạ điểm cây lạ.
2. Chi phí đầu vào và giá bán đầu ra của từng cây theo từng quốc gia.

**Chỗ làm.**

| Việc | Tệp |
|---|---|
| Bảng nguồn (CSV, mỗi dòng có nguồn, năm, đường dẫn) | `data/crops/` |
| Mã đọc bảng và ghép vào danh mục | `scripts/crops/`, `scripts/build-crop-catalog.ts` |
| Kiểu dữ liệu mới (ví dụ mức phổ biến theo mã quốc gia ISO) | thêm trường tuỳ chọn vào `CropProfile` trong `src/contracts/crop.ts`, Bảo review |
| Vùng kinh tế mới | `EconRegion` và `ReferenceEconomics` trong `src/core/economics/types.ts`, Khoa review |
| Tài liệu: nguồn, cách tính, giới hạn | `docs/CROP_DATA.md` (tạo mới) |

Sau khi sửa nguồn: `npm run crops:build`, rồi ba lệnh kiểm tra ở mục 3.

**Quy tắc dữ liệu** (trích `AGENTS.md`, mục 5): không tự đặt ra con số. Mỗi giá trị có nguồn, năm và chất lượng nguồn (`official`, `budget`, `press`, `derived`, `none`). Không tìm được thì để trống (`null`) và ghi là không có, không ước lượng thay.

**Ranh giới với Khoa.** Thái đưa ra cột dữ liệu và ý nghĩa của nó. Việc cột đó thành cổng loại hẳn hay hệ số nhân vào điểm là quyết định của mô hình (Khoa). Hai người thống nhất tên và đơn vị của trường mới trong một pull request nhỏ vào `src/contracts/` trước, rồi mỗi người làm phần mình.

### Mô hình: độ phù hợp và lợi nhuận (Khoa)

**Đang có.** `src/core/scoring/` chấm điểm theo ngưỡng EcoCrop (hàm hình thang, cổng cứng, tích có trọng số), kèm độ tin cậy từ 20 năm khí hậu. `docs/SCORING.md` và `docs/SCORING_PAPER.md` mô tả phương pháp; `scripts/crops/evaluate-scoring-paper.ts` chạy đánh giá và ghi `data/crops/scoring-paper-results.json`. `src/core/economics/` tính năng suất → doanh thu → chi phí → lãi. `src/core/advisory/rotation.ts` dựng các phương án luân canh.

**Mục tiêu.** Nghiên cứu và cải thiện cách tính độ phù hợp, và cách chọn cây hoặc luân canh tối ưu lợi nhuận.

**Quy tắc của phần lõi.** `src/core` là hàm thuần: không gọi mạng, không đụng DOM, không dùng `Date.now()` (ngày hôm nay được truyền vào). Mỗi thay đổi công thức đi kèm test trong cùng thư mục và một đoạn trong `docs/SCORING.md` hoặc `docs/ECONOMICS.md` ghi công thức, nguồn và giới hạn. Test hiện có là hành vi đã chốt; nếu một test phải đổi vì công thức đổi thì nói rõ trong pull request là đổi gì và vì sao.

**Thử nghiệm.** Mã thử để trong `scripts/` (chạy bằng `npx tsx`), kết quả để trong `data/crops/` hoặc `docs/`. Dự án không dùng Python; nếu cần sổ tay Python cho nghiên cứu thì để ngoài repo hoặc hỏi Bảo trước.

### Chatbot (Khoa), trồng rau đô thị (Thái), cải tạo đất (Duy)

Việc cần làm, từng bước và "xong là thế nào": `docs/PLAN.md` mục 6, 7 và 8. Cả ba phần đều là hàm thuần trong `src/core` hoặc `src/rag`; phần giao diện tương ứng (`src/ui/ask`, `src/ui/urban`, thẻ thửa ruộng) do Bảo giữ, nên khi cần hiển thị thêm thứ gì thì ghi trong pull request.

### UI/UX (Bảo)

`src/ui/**`, `src/globe/**`, thiết kế trong `docs/DESIGN.md`. Bảo cũng là người gộp pull request và giữ `src/contracts/`.

## 6. Làm việc cùng trợ lý AI

Ai dùng Claude Code hay công cụ tương tự thì cho nó đọc `AGENTS.md` trước. Trợ lý làm trên nhánh của người dùng nó và theo đúng quy trình ở mục 3; nó không được đẩy thẳng lên `main` của người khác và không gộp pull request thay người.

## 7. Khi có sự cố

| Tình huống | Làm gì |
|---|---|
| CI đỏ | mở tab Checks của pull request, đọc bước nào lỗi, chạy lại đúng lệnh đó trên máy; từng kiểm tra chạy lệnh gì: `docs/CI_CD.md` |
| Kiểm tra tiêu đề pull request đỏ | sửa tiêu đề theo mẫu `loại(phạm vi): việc đã làm` (mục 3), kiểm tra tự chạy lại |
| Trang thật lỗi sau khi gộp | quay về bản trước trong Vercel rồi mới sửa: `docs/CI_CD.md`, mục 6 |
| Xung đột khi gộp | `git fetch origin` rồi `git merge origin/main`, gỡ trong tệp của mình; tệp sinh ra thì xem mục 4 |
| Lỡ commit lên `main` trên máy (chưa đẩy) | `git switch -c ten-nhanh-moi`, rồi đẩy nhánh đó; `main` trên máy đặt lại bằng `git switch main` và `git reset --hard origin/main` |
| Lỡ commit khoá bí mật | báo Bảo ngay và đổi khoá; xoá khỏi lịch sử không đủ |
