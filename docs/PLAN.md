# Kế hoạch làm việc của nhóm

Viết ngày 15/11/2026. Ai làm phần nào và theo quy trình git nào: xem `CONTRIBUTING.md`. Tài liệu này nói **làm gì, theo thứ tự nào, xong là thế nào**. Mốc thời gian chưa có ngày: Bảo điền khi chốt hạn nộp.

| Người | Phần việc |
|---|---|
| Bảo | UI/UX toàn bộ, bản đồ, hợp đồng dữ liệu, gộp nhánh |
| Uyên | Mascot |
| Thái | Dữ liệu cây trồng (mục 2), giá và chi phí, công cụ trồng rau đô thị (mục 7) |
| Khoa | Mô hình độ phù hợp và lợi nhuận (mục 3), chatbot (mục 6) |
| Duy | Cải tạo đất từ dữ liệu đất (mục 8) |

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

### 2.2 Bảng mới: gộp từ các bộ dữ liệu, không tự sinh

Bảng cũ được dựng lại thành một bộ dữ liệu trong repo (`data/crops/atlas/`, mã trong `scripts/crops/atlas/`) và một Google Sheet mới. Mọi giá trị lấy từ một tệp nguồn có tên qua phép biến đổi theo quy tắc (ghép, lọc, cộng gộp, đổi đơn vị); ô không có nguồn thì để trống.

| Nguồn | Dùng để |
|---|---|
| FAO EcoCrop (2.568 loài, đã có trong repo) | yêu cầu sinh thái của cây |
| FAOSTAT, Crops and livestock products | diện tích thu hoạch, sản lượng, năng suất theo nước, trung bình 3 năm gần nhất |
| Định nghĩa hàng của FAOSTAT (có tên khoa học) | ghép loài EcoCrop với hàng FAOSTAT: `exact`, `group` hoặc `none` |
| MapSPAM 2020 (IFPRI) | diện tích từng cây theo tỉnh, bang: cây nào phổ biến ở từng vùng |
| Danh sách 73 cây đã biên soạn của web | mã cây của web, tên tiếng Việt |

| Bảng | Nội dung |
|---|---|
| `crops` | mỗi dòng một cây được giữ: khoá, tên, toàn bộ cột EcoCrop đã làm sạch, hàng FAOSTAT và mức khớp, mức phổ biến |
| `crop_country` | mỗi dòng một cặp cây và nước: diện tích, sản lượng, năng suất, tỉ trọng, hạng, mức |
| `item_country` | số liệu của hàng gộp, gắn với hàng chứ không gắn với từng loài |
| `country_crops` | mỗi dòng một nước: các cây trồng ở đó xếp theo diện tích |
| `region_crops` | mỗi dòng một tỉnh hoặc bang và một cây (từ MapSPAM) |
| `dropped` | loài bị bỏ và lý do |
| `economics_template` | chỉ có tiêu đề cột, để Thái điền giá và chi phí |
| `sources`, `columns` | nguồn, giấy phép, ngày truy cập; giải thích từng cột |

**Giữ cây nào.** Một loài được giữ khi có ít nhất một bằng chứng từ dữ liệu là có người trồng: khớp `exact` với một hàng FAOSTAT có sản lượng; thuộc một hàng gộp và EcoCrop ghi là được trồng (quy mô lớn hoặc nhỏ); là một cây của MapSPAM; hoặc nằm trong 73 cây đã biên soạn (cây thức ăn gia súc và cây phủ đất không có trong thống kê cây trồng của FAOSTAT nhưng phần luân canh cần). Các loài còn lại vào bảng `dropped`, không mất đi lặng lẽ.

Số cây được giữ, số nước, số vùng và đường dẫn Google Sheet được ghi vào `docs/CROP_DATA.md` khi bộ dữ liệu dựng xong.

### 2.3 Các bước còn lại của Thái

| Bước | Việc | Xong khi |
|---|---|---|
| T1–T3 | Khoá, mức khớp FAOSTAT, diện tích và sản lượng theo nước | **đã nằm trong bảng mới (mục 2.2)**; Thái kiểm lại 15 cây đứng đầu của Việt Nam và Mỹ xem có đúng thực tế không |
| T4 | Với cây `group` và cây không có trong FAOSTAT: bổ sung từ thống kê quốc gia, **trước hết cho Việt Nam và Mỹ** (hai nước có thửa mẫu). Không tìm được thì để `unknown`, không suy từ nhóm | 73 cây đã biên soạn có mức phổ biến ở VN và US, hoặc `unknown` kèm lý do |
| T5 | Giá và chi phí theo nước: điền `economics_template` | bảng `data/crops/atlas/economics.csv` (cấu trúc ở 2.4), trước hết 73 cây × VN, US |
| T6 | Mã đọc hai bảng và ghép vào danh mục; test | `npm run crops:build` chạy được; test kiểm mỗi dòng có nguồn và năm |
| T7 | Mở rộng: 489 cây × mọi nước cho phần `exact`; thêm nước cho phần chi phí và giá | số dòng và độ phủ ghi trong `docs/CROP_DATA.md` |
| T8 | Viết `docs/CROP_DATA.md`: nguồn, ngày truy cập, giấy phép, cách tính, giới hạn | có tệp |

Thứ tự ưu tiên: kiểm bảng mới → T4 cho 73 cây ở VN và US → T5 → T6. T7 làm sau. Các cột riêng cho trồng rau đô thị ở mục 7.

### 2.4 Cấu trúc bảng giá và chi phí

Mức phổ biến theo nước đã có trong bảng `crop_country` của bộ dữ liệu mới, với các cột:

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

`data/crops/atlas/economics.csv`, mỗi dòng một cặp cây và nước (hoặc vùng trong nước):

| Cột | Ý nghĩa |
|---|---|
| `crop_id`, `iso3`, `region` | khoá; `region` trống nếu là cả nước |
| `yield_t_ha`, `price_usd_t`, `cost_usd_ha` | để trống khi không có nguồn |
| `year` | năm số liệu |
| `quality_yield`, `quality_price`, `quality_cost` | `official`, `budget`, `press`, `derived`, `none` (định nghĩa trong `src/core/economics/types.ts`) |
| `source`, `url`, `accessed` | |

Năng suất và giá có trong FAOSTAT cho nhiều nước. **Chi phí sản xuất không có bộ dữ liệu toàn cầu**: phải lấy từ ngân sách trang trại của từng nước (Mỹ có USDA ERS), sẽ thưa. Chỗ không có thì để trống; mô hình và giao diện đã xử lý được giá trị trống.

### 2.5 Quy tắc

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

Kế hoạch chi tiết, từng hạng mục có vấn đề, thay đổi và tiêu chí xong: `docs/UX_PLAN.md`. Bảng dưới là các việc nối với phần của người khác.

| Bước | Việc | Cần |
|---|---|---|
| B1 | Điền mã nước cho thửa ruộng (`PlaceInfo.countryCode` đã có trong hợp đồng) ở mọi đường thêm thửa | không |
| B2 | Ô chọn cây và màn hình luân canh: nhãn "trồng phổ biến ở Việt Nam", công tắc "chỉ cây có trồng ở đây", danh sách riêng cho "cây mới" | K3 |
| B3 | Số tiền: hiện khoảng dao động và chất lượng nguồn theo nước | T5, K8 |
| B4 | Gắn mascot | U3 |
| B5 | Các khác biệt còn lại so với OneSoil: bề rộng bảng thửa, cột mùa vụ và ô tích trong danh sách | không |
| B6 | Lỗi đã biết: giá trị bằng chứng còn tiếng Anh ở chế độ tiếng Việt; chiến lược dự phòng ở thửa Nevada xếp chồng hai vụ | không |
| B7 | Cập nhật README, kịch bản demo, JUDGING cho khớp giao diện mới | không |

## 6. Chatbot (Khoa)

### 6.1 Chatbot hiện tại yếu ở đâu

Theo `docs/RAG.md`:

| Điểm yếu | Chi tiết |
|---|---|
| Câu trả lời là mẫu ghép câu trích, không suy luận | câu hỏi ngoài chín loại ý định đã định sẵn thường trả lời lạc đề |
| Chế độ dùng mô hình ngôn ngữ chưa từng chạy thật | chưa có khoá API; mới test bằng mô hình giả |
| Kho kiến thức gồm 2.568 loài của EcoCrop | kể cả loài không ai trồng; chỉ 74 cây có tên và phiếu tiếng Việt |
| Không biết cây nào trồng ở đâu, không có giá | không trả lời được "ở tỉnh tôi người ta trồng gì" |
| Bộ câu hỏi đánh giá nhỏ (56 câu) và do chính người xây viết | điểm cao nhưng chưa nói lên nhiều |

### 6.2 Hướng làm: chatbot hỏi bảng số liệu, không chỉ tìm đoạn văn

Bộ dữ liệu mới là các bảng có khoá. Câu hỏi về số liệu nên được trả lời bằng **tra bảng** (kết quả đúng, có nguồn), còn tìm đoạn văn chỉ dùng cho phần giải thích.

| Bước | Việc | Xong khi |
|---|---|---|
| C1 | Thu kho kiến thức về đúng các cây trong bảng `crops`; dựng lại phiếu cây từ bảng đó, thêm dòng "trồng ở bao nhiêu nước, các nước đứng đầu" | chỉ mục nhỏ hơn; hỏi về loài đã bỏ thì chatbot nói rõ là không có trong dữ liệu |
| C2 | Viết các hàm tra cứu thuần trên bảng: cây phổ biến ở một nước hoặc vùng; cây này trồng ở đâu; số liệu của một cây; so sánh hai cây; độ phù hợp của cây với thửa đang mở (gọi mô hình chấm điểm); phương án luân canh; kế hoạch cải tạo đất (mục 8); giá và lãi (khi Thái có bảng) | mỗi hàm có test với số đúng lấy từ bảng |
| C3 | Thêm ý định mới vào bộ định tuyến: "ở đây trồng gì", "cây này có trồng ở nước tôi không", "giá", "cải tạo đất", "trồng trên ban công" | bộ câu hỏi đánh giá có các loại này |
| C4 | Chế độ mô hình ngôn ngữ gọi công cụ: mô hình chọn hàm ở C2, nhận kết quả, viết câu trả lời; mọi con số trong câu trả lời phải có trong kết quả hàm; lỗi thì rơi về chế độ trích câu | chạy thật với khoá API; ghi lại 30 hội thoại mẫu |
| C5 | Hội thoại nhiều lượt: nhớ cây và thửa đang nói tới; gợi ý câu hỏi tiếp theo từ trạng thái thửa | test |
| C6 | Tên tiếng Việt cho mọi cây được giữ, lấy từ nguồn có sẵn (nhãn tiếng Việt của Wikidata hoặc liên kết ngôn ngữ của Wikipedia), không tự dịch | cột `name_vi` kèm nguồn |
| C7 | Bộ đánh giá mới: khoảng 150 câu, hai thứ tiếng, do người **không** xây chatbot viết; chấm riêng (a) tìm đúng tài liệu, (b) số liệu trong câu trả lời khớp bảng, (c) biết từ chối khi không có dữ liệu | bảng kết quả trong `docs/RAG.md` |
| C8 | Giọng nói của mascot cho chatbot | phối hợp với Uyên |

Thư mục: `src/rag/**`, `server/**`, `scripts/rag/**`, `data/rag/**`, `public/rag/**`, `docs/RAG.md`. Khung hỏi đáp trên giao diện (`src/ui/ask/**`) do Bảo giữ.

Khoá API để trong `.env` trên máy, không commit, không đưa vào mã chạy trên trình duyệt.

## 7. Trồng rau đô thị (Thái)

### 7.1 Công cụ hiện tại yếu ở đâu

Theo `src/core/urban/index.ts`:

| Điểm yếu | Chi tiết |
|---|---|
| Chỉ có 32 cây, được đánh dấu tay | không dựa trên bộ dữ liệu nào |
| Điểm chỉ dựa vào nhiệt độ trung bình tháng và mức ánh sáng | không tính nắng nóng, độ ẩm, số giờ nắng thật |
| Không biết cây nào quen thuộc ở nơi đó | người ở TP. Hồ Chí Minh và ở Berlin nhận cùng một danh sách ứng viên |
| Chậu, khoảng cách, lượng nước chỉ là câu chung chung | không có số |

### 7.2 Hướng làm

| Bước | Việc | Xong khi |
|---|---|---|
| D1 | Chọn ứng viên từ bảng `crops` bằng quy tắc: nhóm rau, rau thơm, quả, hoa; dạng thân thảo, bụi, leo; chu kỳ ngắn hoặc cây thơm lâu năm | cột `urban_candidate` kèm quy tắc trong `docs/CROP_DATA.md`; số ứng viên tăng từ 32 |
| D2 | Thêm các cột cho trồng chậu, mỗi giá trị có nguồn (tài liệu khuyến nông, hướng dẫn trồng chậu của các trường): độ sâu chậu tối thiểu, thể tích chậu, khoảng cách cây, số giờ nắng tối thiểu, ngày đến lứa thu đầu, kiểu thu (cắt lá liên tục hay thu một lần), có cần giàn không, độ khó | bảng `data/crops/atlas/urban.csv`; ô không có nguồn để trống |
| D3 | Ưu tiên cây quen thuộc tại chỗ: dùng mức phổ biến theo nước và theo vùng | ở TP. Hồ Chí Minh rau muống, mồng tơi, húng quế đứng trên cải xoăn |
| D4 | Khí hậu sát hơn: nhiệt độ thấp nhất và cao nhất tháng, độ ẩm, độ dài ngày so với yêu cầu quang chu kỳ của cây | test với ba thành phố khác vùng khí hậu |
| D5 | Giờ nắng theo hướng ban công: người dùng chọn hướng (Đông, Tây, Nam, Bắc) và có bị che không; số giờ nắng trực tiếp từng tháng tính từ vĩ độ bằng hình học mặt trời (hàm thuần, không cần dữ liệu ngoài) | thay ba mức "nắng cả ngày, một phần, râm" bằng số giờ |
| D6 | Lượng nước mỗi chậu mỗi ngày theo tháng: bốc thoát hơi tham chiếu (ET0) từ NASA POWER × hệ số cây × diện tích tán | hiện lít mỗi ngày thay cho câu chung chung |
| D7 | Lịch gieo gối vụ và kế hoạch cho cả ban công: chọn nhiều cây, xếp theo diện tích có | một bản kế hoạch in được |
| D8 | Test và tài liệu | mục Urban trong `docs/ADVISORY.md` |

Thư mục: `src/core/urban/**` và các cột dữ liệu trong `data/crops/atlas/`. Giao diện (`src/ui/urban/**`) do Bảo giữ; ảnh cây đã có từ FAO EcoCrop.

D5 và D6 không phụ thuộc bảng dữ liệu nên làm ngay được.

## 8. Cải tạo đất (Duy)

### 8.1 Đang có gì

| Thứ | Ở đâu |
|---|---|
| Dữ liệu đất của thửa: pH, cacbon hữu cơ, sét, cát, limon, đạm, CEC, dung trọng, mỗi giá trị có khoảng tin cậy 5–95% | SoilGrids (`src/data/adapters/soilgrids.ts`); ở Mỹ có thêm SSURGO |
| Độ dốc, lớp thoát nước | nhánh địa hình |
| Số đo của nông dân ghi đè số vệ tinh | trang Ground truth |
| Yêu cầu của cây về pH, thành phần cơ giới, độ sâu, độ phì, độ mặn, thoát nước, độc nhôm | các cột EcoCrop trong bảng `crops` |
| Lời khuyên hiện có: bón vôi hoặc lưu huỳnh theo khoảng liều, thoát nước, chống xói mòn | `src/core/advisory/actions.ts` (`phPlan`, `advisories`) |

### 8.2 Việc chính

| Bước | Việc | Xong khi |
|---|---|---|
| S1 | Bảng chẩn đoán đất: đặt từng chỉ tiêu đất của thửa cạnh yêu cầu của cây đang chọn, chỉ ra chỉ tiêu nào đang giới hạn và thiếu bao nhiêu | hàm thuần trả về danh sách chênh lệch có nguồn và khoảng tin cậy |
| S2 | Với mỗi chênh lệch, một yêu cầu cải tạo: làm gì, bao nhiêu (khoảng liều), khi nào, kiểm tra lại bằng cách nào | kiểu dữ liệu `SoilPlan` (thêm vào `src/contracts/advisory.ts`), test cho bốn thửa mẫu |
| S3 | Chuyển `phPlan` hiện có vào mô-đun mới và cải thiện: liều vôi theo khả năng đệm của đất (ước từ sét, cacbon hữu cơ, CEC) thay cho một khoảng cố định | liều là một khoảng, lấy từ khoảng tin cậy của số liệu đất |
| S4 | Tài liệu: công thức, nguồn từng hệ số, giới hạn | `docs/SOIL.md` |

Thư mục đề xuất: `src/core/soil/**` (mới), `docs/SOIL.md`. Giao diện do Bảo đặt vào thẻ thửa ruộng và màn hình luân canh.

### 8.3 Ý tưởng thêm cho Duy

| Ý tưởng | Nội dung | Dữ liệu cần |
|---|---|---|
| Độc nhôm trên đất chua | đất bazan Tây Nguyên chua và giàu nhôm; EcoCrop có cột chịu nhôm của từng cây; liều vôi tính theo nhôm trao đổi thay vì chỉ theo pH | pH, CEC có sẵn; nhôm trao đổi cần số đo của nông dân |
| Mặn và sodic | thửa An Giang (mặn theo mùa) và Nevada (tưới bơm): nhu cầu rửa mặn theo FAO 29, liều thạch cao | độ dẫn điện của đất và nước tưới: thêm nguồn HWSD v2 của FAO hoặc số đo |
| Chất hữu cơ | mục tiêu cacbon hữu cơ theo thành phần cơ giới và khí hậu; phương án phân chuồng, phân ủ, than sinh học, cây phủ đất; nối với luân canh (cây họ đậu, cây phủ đất đã có trong các phương án) | cacbon hữu cơ có sẵn |
| Dinh dưỡng theo năng suất mục tiêu | lượng N, P, K cây lấy đi theo mỗi tấn sản phẩm × năng suất mục tiêu − phần đất cung cấp | bảng hệ số lấy đi của cây (nguồn công bố, ghi rõ); đạm tổng số có sẵn |
| Nguy cơ xói mòn bằng dữ liệu NASA | chỉ số kiểu RUSLE: mưa (CHIRPS, ERA5), độ dốc (SRTM), tính dễ xói của đất (từ sét, cát, cacbon hữu cơ), độ che phủ theo tháng (NDVI) | có sẵn trong web; đây là chỗ dùng dữ liệu NASA rõ nhất của phần đất |
| Nén chặt và thoát nước | dung trọng so với ngưỡng theo thành phần cơ giới; khuyến nghị cày sâu, luống cao, cây rễ sâu | dung trọng có sẵn |
| Đo gì trước | số SoilGrids là ước lượng mô hình ở ô 250 m. Xếp hạng phép đo nào đáng làm trước (giấy thử pH, thử lắng trong lọ để biết thành phần cơ giới, bút đo độ dẫn điện) theo mức nó làm đổi khuyến nghị | khoảng tin cậy của SoilGrids |
| Chi phí và thời gian hoàn vốn | chi phí cải tạo so với lãi tăng thêm; nối với giá của Thái và phần tối ưu lợi nhuận của Khoa | bảng giá vật tư theo nước |
| Kế hoạch nhiều năm | cải tạo đất là việc vài vụ: chia liều theo vụ, xếp vào lịch luân canh, nêu chỉ tiêu cần đo lại mỗi năm | không |
| Câu hỏi về đất trong chatbot | "đất tôi chua, trồng đậu nành được không, cần bón gì": chatbot gọi hàm của Duy | phối hợp với Khoa (C2) |

**Điều phải giữ.** Liều lượng luôn là một khoảng kèm câu "cần kiểm tra tại chỗ"; số từ vệ tinh và mô hình không thay được phiếu phân tích đất. Hệ số nào cũng phải có nguồn công bố; không có nguồn thì không đưa ra con số.

## 9. Thứ tự và mốc

| Mốc | Nội dung | Ai |
|---|---|---|
| M1 | Hợp đồng dữ liệu chốt: trường mức phổ biến, vùng kinh tế theo nước (K2) | Thái, Khoa, Bảo |
| M2 | 73 cây đã biên soạn có mức phổ biến và kinh tế ở VN và US (T1–T6); mô hình dùng cổng (K3, K4); giao diện có nhãn và công tắc (B1, B2) | cả ba |
| M3 | Đánh giá mô hình bằng dữ liệu phổ biến (K5, K6); tối ưu lợi nhuận (K7, K8); mascot có mặt trên web (U3, B4); chatbot tra bảng (C1–C3); chẩn đoán và yêu cầu cải tạo đất (S1–S3); urban có giờ nắng và lượng nước (D5, D6) | Khoa, Uyên, Bảo, Duy, Thái |
| M4 | Mở rộng dữ liệu (T7); chatbot gọi công cụ và bộ đánh giá mới (C4–C7); urban dùng bảng mới (D1–D4, D7); ý tưởng thêm của phần đất (8.3); tài liệu, kịch bản demo, video (T8, B7) | cả nhóm |

M1 là việc chặn mọi việc khác: nên xong trong ngày đầu bằng một pull request nhỏ.

## 10. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Hàng gộp của FAOSTAT làm cổng sai | chỉ dùng `exact` làm cổng; `group` là `unknown` cho đến khi có nguồn quốc gia |
| Chi phí theo nước thưa | để trống, hiện "không có dữ liệu" kèm chất lượng nguồn; không ngoại suy giữa các nước |
| Cổng phổ biến làm web chỉ còn đề xuất cây cũ, mất ý "thích ứng" của đề bài | giữ danh sách "cây mới, cần thử nghiệm" có ghi rõ rủi ro |
| Hai người cùng sửa tệp sinh ra | theo mục 4 của `CONTRIBUTING.md` |
| Danh mục phình to làm web tải chậm | dữ liệu phổ biến để tệp riêng, tải khi cần, theo cách `public/data/crops/ecocrop.json` đang làm |
