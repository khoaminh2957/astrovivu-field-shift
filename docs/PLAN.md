# Kế hoạch làm việc của nhóm

Viết ngày 15/11/2026. Bốn phần việc, ai làm phần nào và theo quy trình git nào: xem `CONTRIBUTING.md`. Tài liệu này nói **làm gì, theo thứ tự nào, xong là thế nào**. Mốc thời gian chưa có ngày: Bảo điền khi chốt hạn nộp.

## 1. Vấn đề cần giải

Web đang đề xuất nhiều cây lạ. Nguyên nhân đã kiểm trong mã:

| Nguyên nhân | Chỗ trong mã |
|---|---|
| Việc xếp hạng chỉ dựa vào khí hậu và đất tại toạ độ thửa ruộng; không có thông tin cây đó có ai trồng ở nước đó không | `rankCrops` trong `src/core/scoring/index.ts` |
| Thứ duy nhất mang tính địa lý là giới hạn vĩ độ của EcoCrop, và nó chỉ hạ điểm xuống 0,7 khi thửa nằm ngoài giới hạn hơn 3° | `GATE.latitude`, cùng tệp |
| Nhiều cây cùng đạt 100 điểm; khi hoà thì xếp theo bảng chữ cái | dòng `out.sort(...)` của `rankCrops` |
| Chi phí và giá tham chiếu chỉ có bốn vùng (`VN`, `US`, `US-HEARTLAND`, `US-WEST`) | `scripts/crops/economics.ts` |

Hướng giải: Thái dựng dữ liệu "cây nào phổ biến ở nước nào" và "chi phí, giá theo nước"; Khoa đưa dữ liệu đó vào mô hình chấm điểm và tối ưu lợi nhuận; Bảo đưa kết quả lên giao diện; Uyên làm mascot song song, không phụ thuộc ba phần kia.

```
Bảng của Thái ──► data/crops/*.csv ──► npm run crops:build ──► danh mục cây (CropProfile)
                                                                    │
                                              mô hình của Khoa ◄────┘
                                              (độ phù hợp, cổng phổ biến, lợi nhuận)
                                                                    │
                                              giao diện của Bảo ◄───┘        mascot của Uyên ──► giao diện
```

## 2. Dữ liệu cây trồng (Thái)

### 2.1 Bảng tính hiện tại

Bảng "thái" trên Google Sheets, đọc ngày 15/11/2026: ba trang (`features` là bảng giải thích cột, `atlas` là dữ liệu, `Bản sao của atlas` là bản đang làm dở với 199 dòng).

| Điểm | Số liệu |
|---|---|
| Số cây trong `atlas` | 489 |
| Số cột | 38: 37 cột lấy từ EcoCrop và cột mới `faostat_cac_nuoc_san_xuat` (danh sách nước có sản xuất theo FAOSTAT) |
| Cây đã biên soạn của web có trong bảng | 57 trên 73 |
| Số danh sách nước khác nhau | 146 cho 489 cây |
| Cây dùng chung danh sách nước với cây khác | 409 trên 489 |

**Điểm cần sửa trước khi dùng làm cổng.** Phần lớn danh sách nước không phải của riêng loài đó mà của cả một nhóm hàng trong FAOSTAT:

| Nhóm | Số cây chung một danh sách | Số nước | Hệ quả |
|---|---|---|---|
| Rau các loại (aibika, rau dền, mồng tơi, rau muống, cần tây...) | 49 | 181 | aibika được ghi là có ở 181 nước |
| Trái cây nhiệt đới (sầu riêng, mít, na, khế...) | 47 | 81 | sầu riêng **không** có Việt Nam trong danh sách |
| Trái cây khác (lựu, dâu tằm, cà chua thân gỗ...) | 34 | 140 | |
| Gia vị (nghệ, sả, thì là, kinh giới...) | 27 | 67 | |
| Củ (khoai mỡ, củ đậu, khoai sọ...) | 20 | 64 | |

Dùng nguyên như vậy thì cổng sẽ sai theo cả hai chiều: giữ lại cây lạ (vì nhóm của nó có ở khắp nơi) và loại cây quen (vì nhóm của nó thiếu nước đó).

Các điểm khác:

- Cột mới chỉ nói **có hay không**, chưa nói **nhiều hay ít**, chưa có năm số liệu và mã hàng FAOSTAT.
- Chưa có cột chi phí và giá.
- Chưa có mã EcoCrop và mã cây của web (`id`), nên chưa ghép được vào danh mục một cách chắc chắn. 16 cây đã biên soạn không tìm thấy theo tên khoa học: khoai tây, cà chua, cà phê chè, bưởi, cỏ linh lăng, cỏ ba lá đỏ, cỏ ba lá đỏ thẫm, đậu mèo, điên điển, lạc dại, cải thìa, húng quế, tía tô, vạn thọ, dừa cạn, cao lương lai. Một số có thể đang mang tên khoa học cũ trong EcoCrop (ví dụ cà chua là *Lycopersicon esculentum*).
- Cây làm thức ăn gia súc và cây phủ đất (cỏ linh lăng, điên điển) không có trong thống kê cây trồng của FAOSTAT: cần nguồn khác hoặc ghi "không có dữ liệu".
- Trang `features` đã ghi chú lỗi các ô pH bị Sheets đổi thành ngày tháng: sửa trong bảng, và khi xuất phải kiểm lại bốn cột pH.
- Ô không có dữ liệu đang là `-` hoặc `---`: đổi thành ô trống.

### 2.2 Các bước

| Bước | Việc | Xong khi |
|---|---|---|
| T1 | Thêm hai cột khoá: `ecocrop_id` (mã trong `data/ecocrop/ecocrop_2568_plants.csv`) và `crop_id` (mã của web, có trong `data/crops/curated-crops.csv` với 73 cây đã biên soạn) | mọi dòng có `ecocrop_id`; 73 cây đã biên soạn đều có dòng |
| T2 | Với mỗi cây ghi mã và tên hàng FAOSTAT đã dùng, và mức khớp: `exact` (hàng đó chính là cây này), `group` (hàng gộp nhiều loài), `none` | cột `faostat_item_code`, `faostat_item`, `match` đầy đủ |
| T3 | Với cây `exact`: lấy diện tích thu hoạch và sản lượng theo nước, trung bình 3 năm gần nhất, tính tỉ trọng trong tổng diện tích thu hoạch của nước đó | bảng dài `data/crops/prevalence.csv` (cấu trúc ở 2.3) |
| T4 | Với cây `group` và cây không có trong FAOSTAT: bổ sung từ thống kê quốc gia, **trước hết cho Việt Nam và Mỹ** (hai nước có thửa mẫu). Không tìm được thì ghi `unknown`, không suy từ nhóm | 73 cây đã biên soạn có mức phổ biến ở VN và US, hoặc `unknown` kèm lý do |
| T5 | Chi phí và giá theo nước: năng suất, giá bán tại ruộng, chi phí biến đổi | bảng dài `data/crops/economics.csv` (cấu trúc ở 2.3), trước hết 73 cây × VN, US |
| T6 | Mã đọc hai bảng và ghép vào danh mục; test | `npm run crops:build` chạy được; test kiểm mỗi dòng có nguồn và năm |
| T7 | Mở rộng: 489 cây × mọi nước cho phần `exact`; thêm nước cho phần chi phí và giá | số dòng và độ phủ ghi trong `docs/CROP_DATA.md` |
| T8 | Viết `docs/CROP_DATA.md`: nguồn, ngày truy cập, giấy phép, cách tính, giới hạn | có tệp |

Thứ tự ưu tiên: T1 → T2 → T3 và T4 cho 73 cây ở VN và US → T5 → T6. Xong đến đó là Khoa và Bảo dùng được. T7 làm sau.

### 2.3 Cấu trúc bảng đề xuất

`data/crops/prevalence.csv`, mỗi dòng một cặp cây và nước:

| Cột | Ý nghĩa |
|---|---|
| `crop_id`, `ecocrop_id` | khoá |
| `iso3` | mã nước ISO 3 chữ (VNM, USA) thay cho tên nước |
| `match` | `exact`, `group`, `national` (từ thống kê quốc gia) |
| `faostat_item_code` | mã hàng, trống khi `national` |
| `area_ha`, `production_t` | trung bình các năm trong `year_from`–`year_to` |
| `share_pct` | tỉ trọng trong tổng diện tích thu hoạch của nước đó |
| `level` | `major`, `common`, `minor`, `absent`, `unknown` |
| `source`, `url`, `accessed` | nguồn, đường dẫn, ngày truy cập |

Ngưỡng của `level` do Thái đề xuất và ghi trong `docs/CROP_DATA.md`, Khoa góp ý. `absent` chỉ dùng khi nguồn có số liệu của nước đó và cây đó bằng 0 hoặc không xuất hiện ở hàng `exact`; còn lại là `unknown`.

`data/crops/economics.csv`, mỗi dòng một cặp cây và nước (hoặc vùng trong nước):

| Cột | Ý nghĩa |
|---|---|
| `crop_id`, `iso3`, `region` | khoá; `region` trống nếu là cả nước |
| `yield_t_ha`, `price_usd_t`, `cost_usd_ha` | để trống khi không có nguồn |
| `year` | năm số liệu |
| `quality_yield`, `quality_price`, `quality_cost` | `official`, `budget`, `press`, `derived`, `none` (định nghĩa trong `src/core/economics/types.ts`) |
| `source`, `url`, `accessed` | |

Năng suất và giá có trong FAOSTAT cho nhiều nước. **Chi phí sản xuất không có bộ dữ liệu toàn cầu**: phải lấy từ ngân sách trang trại của từng nước (Mỹ có USDA ERS), sẽ thưa. Chỗ không có thì để trống; mô hình và giao diện đã xử lý được giá trị trống.

### 2.4 Quy tắc

Không tự đặt ra con số. Mỗi giá trị có nguồn và năm. Kiểm giấy phép của từng nguồn (FAOSTAT có trang điều khoản riêng cho cơ sở dữ liệu thống kê) và ghi vào `docs/CROP_DATA.md`.

## 3. Mô hình (Khoa)

| Bước | Việc | Xong khi |
|---|---|---|
| K1 | Tái hiện vấn đề: in 15 cây đứng đầu của `rankCrops` cho bốn thửa mẫu, đánh dấu cây nào người địa phương không trồng | bảng trong `docs/SCORING.md`, dùng làm mốc so sánh |
| K2 | Thống nhất với Thái và Bảo trường dữ liệu mới trong `src/contracts/` (mức phổ biến theo `iso3`; vùng kinh tế theo nước) | một pull request nhỏ chỉ sửa `src/contracts/` |
| K3 | Đưa mức phổ biến vào xếp hạng. Đề xuất ba chế độ: mặc định chỉ xếp cây `major`, `common`, `minor`; cây `absent` nhưng hợp khí hậu vào một danh sách riêng "cây mới, cần thử nghiệm"; `unknown` không bị coi là `absent` | test: sầu riêng ở Đắk Lắk không bị loại; aibika ở Iowa không đứng đầu |
| K4 | Bỏ kiểu phá hoà theo bảng chữ cái: hoà điểm thì xếp theo mức phổ biến, rồi độ tin cậy | test |
| K5 | Đánh giá cách tính độ phù hợp bằng chính dữ liệu của Thái: với các cặp cây và nước `exact`, cây có trồng thật có được chấm cao hơn cây không trồng không (ví dụ AUC theo nước). Ở Mỹ có thêm lịch sử cây trồng của thửa (Cropland Data Layer) | số liệu trước và sau trong `docs/SCORING_PAPER.md`, chạy bằng `scripts/crops/evaluate-scoring-paper.ts` |
| K6 | Xem lại cổng vĩ độ: giữ, đổi hay bỏ khi đã có mức phổ biến | quyết định kèm số liệu K5 |
| K7 | Tối ưu lợi nhuận: lãi kỳ vọng mỗi vụ = năng suất theo độ phù hợp × giá − chi phí, kèm khoảng dao động; chọn luân canh lãi cao nhất dưới ràng buộc (nước, sàn sức khoẻ đất, quy tắc luân canh, mức chấp nhận rủi ro từ ưu tiên của nông dân). Không gian tìm kiếm nhỏ nên duyệt hết hoặc quy hoạch động được, kết quả lặp lại được | `src/core/advisory/customRotation.ts` hoặc mô-đun mới; test; mục trong `docs/ECONOMICS.md` |
| K8 | Phân tích độ nhạy: lãi đổi thế nào khi giá, năng suất, chi phí lệch ±20% | bảng trong `docs/ECONOMICS.md`; giao diện có thể hiện khoảng thay cho một con số |

K1 làm ngay được. K3 trở đi cần T3 và T4 của Thái; trong lúc chờ, dùng vài dòng dữ liệu thật của VN và US do Thái đưa trước để dựng và test.

## 4. Mascot (Uyên)

| Bước | Việc | Xong khi |
|---|---|---|
| U1 | Ba phác thảo nhân vật, cả nhóm chọn một | một hướng được chọn, ghi trong `docs/MASCOT.md` |
| U2 | Bốn trạng thái: bình thường, vui, đang nghĩ, cảnh báo; ưu tiên SVG | tệp trong `public/mascot/` |
| U3 | Thành phần `Mascot` theo `src/ui/mascot/README.md`, lời thoại hai thứ tiếng | pull request `mascot/...` |
| U4 | Đề xuất chỗ xuất hiện: màn hình đầu, trạng thái trống, trợ lý hỏi đáp, công cụ trồng rau đô thị, lúc đang tải | danh sách trong pull request; Bảo gắn vào |
| U5 | Ghi cách làm ra từng tệp tranh | `docs/MASCOT.md` |

## 5. UI/UX (Bảo)

| Bước | Việc | Cần |
|---|---|---|
| B1 | Điền mã nước cho thửa ruộng (`PlaceInfo.countryCode` đã có trong hợp đồng) ở mọi đường thêm thửa | không |
| B2 | Ô chọn cây và màn hình luân canh: nhãn "trồng phổ biến ở Việt Nam", công tắc "chỉ cây có trồng ở đây", danh sách riêng cho "cây mới" | K3 |
| B3 | Số tiền: hiện khoảng dao động và chất lượng nguồn theo nước | T5, K8 |
| B4 | Gắn mascot | U3 |
| B5 | Các khác biệt còn lại so với OneSoil: bề rộng bảng thửa, cột mùa vụ và ô tích trong danh sách | không |
| B6 | Lỗi đã biết: giá trị bằng chứng còn tiếng Anh ở chế độ tiếng Việt; chiến lược dự phòng ở thửa Nevada xếp chồng hai vụ | không |
| B7 | Cập nhật README, kịch bản demo, JUDGING cho khớp giao diện mới | không |

## 6. Thứ tự và mốc

| Mốc | Nội dung | Ai |
|---|---|---|
| M1 | Hợp đồng dữ liệu chốt: trường mức phổ biến, vùng kinh tế theo nước (K2) | Thái, Khoa, Bảo |
| M2 | 73 cây đã biên soạn có mức phổ biến và kinh tế ở VN và US (T1–T6); mô hình dùng cổng (K3, K4); giao diện có nhãn và công tắc (B1, B2) | cả ba |
| M3 | Đánh giá mô hình bằng dữ liệu phổ biến (K5, K6); tối ưu lợi nhuận (K7, K8); mascot có mặt trên web (U3, B4) | Khoa, Uyên, Bảo |
| M4 | Mở rộng dữ liệu (T7); tài liệu, kịch bản demo, video (T8, B7) | Thái, Bảo |

M1 là việc chặn mọi việc khác: nên xong trong ngày đầu bằng một pull request nhỏ.

## 7. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Hàng gộp của FAOSTAT làm cổng sai | chỉ dùng `exact` làm cổng; `group` là `unknown` cho đến khi có nguồn quốc gia |
| Chi phí theo nước thưa | để trống, hiện "không có dữ liệu" kèm chất lượng nguồn; không ngoại suy giữa các nước |
| Cổng phổ biến làm web chỉ còn đề xuất cây cũ, mất ý "thích ứng" của đề bài | giữ danh sách "cây mới, cần thử nghiệm" có ghi rõ rủi ro |
| Hai người cùng sửa tệp sinh ra | theo mục 4 của `CONTRIBUTING.md` |
| Danh mục phình to làm web tải chậm | dữ liệu phổ biến để tệp riêng, tải khi cần, theo cách `public/data/crops/ecocrop.json` đang làm |
