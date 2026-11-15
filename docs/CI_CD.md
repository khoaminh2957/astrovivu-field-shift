# CI/CD: từ nhánh đến trang thật

Tài liệu này nói một thay đổi đi qua những bước tự động nào trước và sau khi vào `main`, mỗi bước chạy lệnh gì, làm gì khi một bước đỏ, và chủ repo cần cài gì một lần. Quy trình git (nhánh, pull request, ai review): `CONTRIBUTING.md`. Cơ sở dữ liệu: `docs/DATABASE.md`.

Mã: `.github/workflows/`, `.github/actions/setup/`, `.github/dependabot.yml`, `.github/labeler.yml`, `scripts/ci/`.

## 1. Đường đi của một thay đổi

```
nhánh của bạn
   │  git push
   ▼
pull request ──► CI: kiểm kiểu, test, build ──► chạy thử bản build        (ci.yml)
   │             cơ sở dữ liệu: migration + pgTAP   (khi đụng supabase/)
   │             bảo mật: CodeQL, thư viện mới, dò khoá bí mật             (codeql.yml, security.yml)
   │             tiêu đề, nhãn                                             (pr.yml)
   │             Vercel dựng bản xem trước của nhánh
   ▼  CI xanh + một người khác duyệt, Squash and merge
main ──► Vercel dựng và đưa lên trang thật ──► kiểm tra trang thật         (production-check.yml)
   │
   ├─► có migration mới: staging ──► duyệt ──► production                  (database.yml)
   └─► tag v1.0.0: bản phát hành có tệp build, SBOM, chứng thực nguồn gốc  (release.yml)

hằng tuần: CodeQL, kiểm lỗ hổng thư viện, Dependabot mở pull request cập nhật
hằng tháng: đọc bản FAOSTAT mới, nạp lại giá                               (market-data.yml)
hằng ngày: kiểm tra trang thật
```

## 2. Các workflow

| Workflow | Chạy khi | Việc | Chặn gộp |
|---|---|---|---|
| **CI** `ci.yml` | pull request, push lên `main`, chạy tay | 5 job, xem mục 3 | job `Typecheck, test, build` là kiểm tra bắt buộc của `main` |
| **Pull request** `pr.yml` | mở, sửa tiêu đề, đẩy thêm commit | tiêu đề đúng mẫu `loại(phạm vi): việc đã làm`; gắn nhãn theo thư mục bị chạm (`.github/labeler.yml`) | không (đỏ thì sửa tiêu đề) |
| **CodeQL** `codeql.yml` | pull request, push lên `main`, thứ Hai hằng tuần | phân tích tĩnh mã TypeScript và chính các workflow; kết quả ở Security → Code scanning | không |
| **Security** `security.yml` | pull request, push lên `main`, thứ Hai hằng tuần | `Dependencies`: thư viện có lỗ hổng mức cao thì đỏ (trên pull request chỉ xét thư viện pull request thêm vào, nếu Dependency graph bật; còn lại là `npm audit` trên toàn bộ cây thư viện, kèm kiểm chữ ký gói). `Secret scan`: dò khoá bí mật trong các commit (gitleaks) | không |
| **Production check** `production-check.yml` | Vercel báo đã triển khai xong `main`; hằng ngày; chạy tay | tải trang thật và mọi tệp nó cần; lỗi thì mở issue | chạy sau khi gộp |
| **Database deploy** `database.yml` | push lên `main` có đổi `supabase/migrations/**`; chạy tay | áp migration lên staging rồi production | chạy sau khi gộp |
| **Market data** `market-data.yml` | ngày 3 hằng tháng; chạy tay | đọc thử toàn bộ giá FAOSTAT; nạp vào production nếu đã cấu hình | không |
| **Release** `release.yml` | đẩy tag `vX.Y.Z` | kiểm lại, build, đóng gói, phát hành | không |

Dependabot (`.github/dependabot.yml`) mở pull request cập nhật thư viện npm và phiên bản action vào thứ Hai; chúng đi qua đúng các kiểm tra trên.

## 3. Các job của CI và cách chạy lại trên máy

| Job | Lệnh | Khi nào chạy |
|---|---|---|
| `Changed areas` | hỏi GitHub danh sách tệp của pull request | luôn; quyết định hai job cuối có chạy không |
| `Typecheck, test, build` | `npx tsc --noEmit` → `npx vitest run` → `npx vite build` | luôn |
| `Preview smoke test` | `npx vite preview` rồi `npm run smoke -- http://127.0.0.1:4173` | sau job trên, dùng đúng bản build của nó |
| `Database migrations and tests` | `npm run db:start` → `npm run db:test` | pull request đụng `supabase/`, `scripts/market/`, `data/market/`; mọi push lên `main` |
| `Lint workflows` | actionlint và zizmor (qua Docker, lệnh trong `ci.yml`) | pull request đụng `.github/`; mọi push lên `main` |

`Typecheck, test, build` vẫn là đúng ba lệnh trong `CONTRIBUTING.md`. Thêm vào đó, trang tóm tắt của lần chạy (tab Summary) ghi số test, tệp test chậm nhất và kích thước bản build; báo cáo JUnit và thư mục `dist` được giữ lại 14 và 7 ngày dưới dạng artifact.

**Bài chạy thử (smoke test)** là `scripts/ci/smoke.ts`: tải trang đầu, kiểm có phần tử `#root`, tải từng tệp script và stylesheet mà trang gọi (đúng kiểu nội dung, không rỗng), và tải `data/crops/ecocrop.json` (số dòng khớp trường `count`). Nó trả lời một câu: bản build này có lên được không. Cùng bài đó chạy trên trang thật sau mỗi lần triển khai.

Khi một job đỏ: mở tab Checks, đọc bước lỗi, chạy đúng lệnh ở bảng trên trên máy. Job cơ sở dữ liệu cần Docker.

## 4. Sau khi gộp: giao diện

Vercel được nối với repo và tự làm hai việc, không qua GitHub Actions: dựng bản xem trước cho mỗi nhánh, và đưa `main` lên <https://astrovivu-field-shift.vercel.app>. Workflow không dựng hay đẩy lại lần nữa; nó làm bước còn thiếu là **kiểm tra sau triển khai**.

Khi Vercel ghi trạng thái "Deployment has completed" lên một commit của `main`, `Production check` chạy bài smoke test trên trang thật. Lỗi thì workflow mở issue "Production smoke test failed" (hoặc ghi thêm vào issue đang mở). Bài này cũng chạy mỗi ngày lúc 08:07 giờ Việt Nam.

Sự kiện `status` của GitHub nổ cho mọi trạng thái của mọi commit, nên tab Actions sẽ có những lần chạy `Production check` bị bỏ qua (skipped): đó là các trạng thái không phải "Vercel xong trên `main`".

## 5. Sau khi gộp: cơ sở dữ liệu

`Database deploy` áp các migration chưa có lên dự án Supabase: in danh sách sẽ áp (`db push --dry-run`), áp, so lại danh sách migration giữa repo và cơ sở dữ liệu, rồi đọc thử một dòng qua Data API bằng khoá công khai. Thứ tự: `staging` trước; `production` chỉ chạy khi staging xong và có người được chỉ định bấm duyệt. Không có dự án staging thì đi thẳng tới bước duyệt production.

Workflow **không làm gì** cho đến khi các biến dưới đây tồn tại, nên gộp nó trước khi có dự án Supabase là an toàn.

### Cài đặt lần đầu (chủ repo)

1. Tạo dự án trên <https://supabase.com/dashboard> (vùng Singapore gần người dùng Việt Nam). Mật khẩu cơ sở dữ liệu giữ cho riêng mình, không cần đưa vào GitHub. Muốn có staging thì tạo dự án thứ hai.
2. GitHub → Settings → Environments: tạo `production` (và `staging`), ở `production` bật **Required reviewers** và chọn người duyệt.
3. Settings → Secrets and variables → Actions:

   | Loại | Tên | Giá trị |
   |---|---|---|
   | Variable của repo | `SUPABASE_PRODUCTION_PROJECT_REF` | mã 20 ký tự của dự án (trong URL của dashboard) |
   | Variable của repo | `SUPABASE_STAGING_PROJECT_REF` | như trên cho staging; bỏ qua nếu không có |
   | Secret của từng environment | `SUPABASE_ACCESS_TOKEN` | Account → Access Tokens trên Supabase. Workflow dùng token này để xin một vai trò đăng nhập cơ sở dữ liệu chỉ sống vài phút, nên không có secret mật khẩu nào |
   | Secret của từng environment | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API keys, khoá `service_role`; chỉ cần cho việc nạp dữ liệu |
   | Secret của từng environment | `SUPABASE_ANON_KEY` | khoá `anon`; tuỳ chọn, để chạy bước đọc thử |

4. Actions → Database deploy → Run workflow, tích `load_data`: áp migration rồi nạp dữ liệu (387 cây của atlas, 72.666 dòng cây theo nước, 249.700 dòng giá năm; khoảng 63 MB).

Khoá `service_role` bỏ qua mọi quy tắc phân quyền của cơ sở dữ liệu: chỉ để trong secret của environment hoặc tệp `.env` trên máy, không bao giờ trong mã chạy ở trình duyệt, không dán vào pull request hay chat.

### Viết migration

Mỗi thay đổi lược đồ là một tệp mới `supabase/migrations/<YYYYMMDDHHMMSS>_<tên>.sql`; không sửa tệp đã được áp lên một dự án thật. Bảng mới phải bật row level security và cấp quyền rõ ràng trong cùng migration (mẫu: `20261115000400_market_security.sql`), kèm test trong `supabase/tests/`. Chạy `npm run db:reset` và `npm run db:test` trước khi mở pull request.

## 6. Khi trang thật lỗi

| Tình huống | Làm gì |
|---|---|
| Giao diện lỗi sau một lần gộp | Vercel → Deployments → bản production trước đó → **Instant Rollback** (vài giây, không cần build). Sau đó trên GitHub mở pull request đã gộp, bấm **Revert** để tạo pull request hoàn tác, sửa trên nhánh mới |
| Migration làm hỏng dữ liệu hoặc quyền | migration chỉ đi tới: viết migration mới đảo lại thay đổi, qua staging rồi production. Vì thế bước duyệt production tồn tại |
| Lộ khoá | đổi khoá ngay ở nơi cấp (Supabase, Anthropic, NASA Earthdata), cập nhật secret; xoá khỏi lịch sử git không đủ |
| `Production check` mở issue nhưng trang vẫn chạy | đọc bước lỗi trong lần chạy; nếu do mạng thì chạy lại workflow, issue đóng tay |

## 7. Bản phát hành

```bash
git switch main && git pull
git tag v1.0.0 && git push origin v1.0.0
```

`Release` kiểm tag nằm trên `main`, chạy lại ba lệnh kiểm tra, rồi tạo bản phát hành trên GitHub gồm: `dist` nén lại, danh sách mọi gói bên trong (SBOM CycloneDX), `SHA256SUMS`, ghi chú thay đổi sinh từ tiêu đề các pull request, và chứng thực nguồn gốc (commit nào, workflow nào đã build; kiểm bằng `gh attestation verify <tệp> --repo quocbao271207/astrovivu-field-shift`). Trang thật vẫn do Vercel đưa lên từ `main`; bản phát hành là bản cố định để nộp và trích dẫn.

## 8. Quy tắc an toàn của chính các workflow

| Quy tắc | Vì sao |
|---|---|
| Mọi action ghim theo mã commit, kèm chú thích phiên bản | một tag có thể bị trỏ sang mã khác; mã commit thì không. Dependabot cập nhật cả mã lẫn chú thích |
| Ảnh Docker của công cụ (actionlint, zizmor, gitleaks) ghim theo digest | cùng lý do; Dependabot không cập nhật các dòng này, đổi tay khi cần |
| `permissions` mặc định chỉ đọc; job nào cần ghi thì khai riêng đúng quyền đó | token của một job bị lộ không làm được gì hơn việc của job |
| `persist-credentials: false` khi checkout | token không nằm lại trong `.git/config` cho bước sau đọc |
| Dữ liệu do người ngoài viết (tiêu đề pull request) đi qua biến môi trường, không chèn thẳng vào lệnh | tránh chèn lệnh shell |
| Secret chỉ nằm trong environment có người duyệt | pull request không đọc được; chỉ `main` sau khi duyệt mới dùng |
| Dependabot chờ 7 ngày sau khi một phiên bản ra mới đề xuất | phần lớn gói bị cài mã độc được gỡ trong vài ngày |
| `Lint workflows` chạy actionlint và zizmor trên mọi thay đổi trong `.github/` | lỗi cú pháp và lỗi bảo mật của workflow bị bắt trước khi gộp |

## 9. Việc chủ repo cần làm một lần

- [ ] Mục 5: environments, variables, secrets (khi muốn dùng cơ sở dữ liệu).
- [ ] Settings → Branches → quy tắc của `main`: giữ `Typecheck, test, build`; nên thêm `Preview smoke test`, `Secret scan`, `Database migrations and tests`, `Lint workflows` vào danh sách bắt buộc (hai job cuối khi không chạy được tính là đạt). Bật **Require review from Code Owners** nếu muốn người phụ trách thư mục phải là người duyệt.
- [ ] Settings → General: chỉ cho **Squash merging**, bật **Automatically delete head branches** (đúng với `CONTRIBUTING.md`).
- [ ] Settings → Code security: bật **Dependency graph** (đang tắt; cho đến khi bật, job `Dependencies` kiểm cả cây thư viện bằng `npm audit` trên mọi pull request, nên một lỗ hổng mới ở thư viện cũ sẽ làm đỏ cả pull request không liên quan), Dependabot alerts, Secret scanning và Push protection.
- [ ] Nếu đổi tên miền: đặt variable `PRODUCTION_URL`.

**Đừng đổi tên job `Typecheck, test, build`** trong `ci.yml` mà không sửa quy tắc bảo vệ nhánh cùng lúc: GitHub chờ đúng tên đó, đổi tên là mọi pull request bị treo.

## 10. Căn cứ và giới hạn

Căn cứ của thiết kế (đo ngày 15/11/2026):

| Quan sát | Hệ quả |
|---|---|
| `main` được bảo vệ, kiểm tra bắt buộc tên `Typecheck, test, build` (GitHub API, `branches/main`) | giữ nguyên tên và nội dung job đó; các kiểm tra mới là job riêng |
| CI cũ chạy xong trong khoảng 25 giây | các bước chậm (Postgres trong Docker, lint workflow) chỉ chạy khi thư mục liên quan bị chạm |
| Commit trên `main` có trạng thái `Vercel` do `vercel[bot]` ghi; repo không có GitHub Deployment nào | Vercel tự triển khai: workflow không triển khai lần hai, chỉ kiểm tra sau đó, kích hoạt bằng sự kiện `status` |
| Toàn bộ lịch sử của repo (44 commit lúc quét) không có khoá bí mật (gitleaks 8.30.1) | job dò khoá bắt đầu từ trạng thái sạch |
| Bản build hiện tại là một tệp script 2,5 MB | tóm tắt CI ghi kích thước mỗi lần để thấy khi nó tăng; chưa đặt ngưỡng chặn |
| Hai lần triển khai đầu dừng ở bước kết nối: mật khẩu cơ sở dữ liệu trong secret không khớp (Postgres báo 28P01), kể cả sau khi đặt lại | workflow không dùng mật khẩu nữa: không truyền `--password` thì Supabase CLI 3.1.0 xin vai trò đăng nhập tạm thời qua Management API bằng access token |
| Dependency graph của repo đang tắt (API trả 403) | job `Dependencies` tự kiểm điều này: tắt thì chạy `npm audit` trên cả cây thư viện và cảnh báo, bật thì chỉ xét phần pull request thêm vào |

Đã kiểm trên máy trước khi mở pull request: toàn bộ lệnh của job `Typecheck, test, build`, `Preview smoke test` và `Database migrations and tests` trong container Linux với Node 24; actionlint và zizmor trên mọi workflow; gitleaks trên toàn bộ lịch sử; bài smoke test trên trang thật.

Chưa kiểm được trước khi gộp, vì chỉ chạy trên GitHub: `Production check` (sự kiện `status`), `Database deploy` và phần nạp của `Market data` (cần dự án Supabase và secret), `Release` (cần tag), CodeQL và Dependency review (dịch vụ của GitHub). Lần chạy đầu của mỗi cái cần có người xem.

Không có trong pipeline:

- **Kiểm tra kiểu ESLint/Prettier**: repo chưa có cấu hình; thêm vào sẽ sinh cảnh báo trên mã của cả nhóm, nên để nhóm quyết định trong một pull request riêng.
- **Độ phủ test**: cần thêm gói `@vitest/coverage-v8` (đổi `package.json`, theo `CONTRIBUTING.md` là một pull request riêng).
- **Test giao diện trên trình duyệt** (Playwright): bài smoke test chỉ biết trang tải được, không biết nút bấm có chạy không.
- **Smoke test trên bản xem trước của từng nhánh**: địa chỉ bản xem trước chỉ lấy được qua API của Vercel, cần token của chủ dự án.
- **Sao lưu cơ sở dữ liệu**: dùng cơ chế của Supabase theo gói đang dùng; dữ liệu ở đây nạp lại được từ nguồn bằng `npm run db:load`.
