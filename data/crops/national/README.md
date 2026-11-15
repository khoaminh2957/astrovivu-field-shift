# Thống kê diện tích và mức phổ biến cấp quốc gia (`VNM` & `USA`) — Issue #9 (T4)

Thư mục này chứa bảng đầu vào [`prevalence.csv`](./prevalence.csv) bổ sung số liệu thống kê quốc gia chính thức và lý do phân loại cho **73 cây đã biên soạn** tại **Việt Nam (`VNM`)** và **Mỹ (`USA`)**, cùng các dòng chuyển sang từ bảng kiểm **T1 (#8)**.

> Tài liệu quy tắc đầy đủ của toàn bộ atlas nằm tại [`docs/CROP_DATA.md`](../../../docs/CROP_DATA.md) (mục **7.1**).

---

## 1. Tóm tắt những gì thay đổi trong nhánh `data/national-prevalence-vn-us`

| Hạng mục | Trước T4 (`main`) | Sau T4 (`data/national-prevalence-vn-us`) |
|---|---|---|
| Số cây đã biên soạn (73 cây) có dòng trong `crop_country.csv` ở `VNM` & `USA` | `53 / 73` cây mỗi nước (`20` cây `match = none` không có dòng nào) | **`73 / 73` cây** ở cả `VNM` và `USA` (không thiếu cây nào) |
| Cây `group` (12 cây) & `none` (20 cây) có mức phổ biến thực tế (`major`/`common`/`minor`) | `0 / 32` cây ở cả hai nước | **`3` cây đã biên soạn** (`durio-zibethinus`, `musa-acuminata`, `mangifera-indica`; + `litchi-chinensis`) ở `VNM`; **`11` cây** ở `USA`. Các cây còn lại giữ `unknown` kèm `note` |
| Cây bị xếp `absent` sai (`sai-absent` từ T1 #8) | `9` cây rau/gia vị quen thuộc ở `VNM` (`cà chua, dưa leo, cà tím, gừng, hành lá, đậu bắp, dâu tây, đậu Hà Lan, đậu trắng`) và `2` cây ở `USA` (`hành lá, mè`) bị đánh `absent` | **`USA`**: `allium-fistulosum` (`2.435 ha`) và `sesamum-indicum` (`17.740 ha`) chuyển sang **`minor`** (`match = national`). **`VNM`**: cả 9 cây chuyển sang **`unknown` kèm `note`** giải thích rõ FAOSTAT không báo mã hàng riêng và NSO gộp trong rau/gia vị, để mô hình K3 (#23) không loại nhầm |
| Cột mới trong `data/crops/atlas/crop_country.csv` | 15 cột (đến `source`) | **18 cột**: thêm `url`, `accessed`, `note`; cột `match` có thêm giá trị `national` |
| Chỉ số mới trong `data/crops/atlas/summary.csv` | 52 dòng | **57 dòng**: thêm `crop_country_rows_national = 59`, tách thành `crop_country_rows_national_with_figure = 17` và `crop_country_rows_national_without_figure = 42`; `national_rows_read = 76`; `national_rows_ignored = 0` (`crop_country_rows = 72.706`) |
| Nguồn trong `data/crops/atlas/sources.csv` | 22 dòng | **33 dòng**: thêm 11 ấn phẩm quốc gia (`national-…`: tên, đơn vị công bố, URL, giấy phép, ngày tra cứu), do build ghi từ `NATIONAL_SOURCES` trong `national.ts`; không có SHA-256 vì build không lưu bản sao |
| Mã nguồn & Kiểm thử | Chưa có mô-đun đọc số liệu quốc gia | Thêm [`scripts/crops/atlas/national.ts`](../../../scripts/crops/atlas/national.ts) và [`scripts/crops/atlas/national.test.ts`](../../../scripts/crops/atlas/national.test.ts) (**5 tệp test, 56/56 test đạt**) |

---

## 2. Quy tắc ghép vào `crop_country.csv`

1. **Tử số và mẫu số của tỉ trọng (`share_of_country_harvested_area_pct`):**
   - **Tử số:** diện tích thu hoạch cấp quốc gia (`area_ha` trong `prevalence.csv`).
   - **Mẫu số:** tổng diện tích thu hoạch mọi mặt hàng cây trồng FAOSTAT của nước đó (`total_harvested_area_ha` trong `country_crops.csv`: **`13.504.720 ha`** cho `VNM`, **`98.830.011 ha`** cho `USA`).
2. **Khi có số liệu diện tích/sản lượng quốc gia (`17 dòng`):**
   - Ghi `match = national`, `faostat_item_code` để trống, `year_from = year_to = year`, tính `share_of_country_harvested_area_pct`, xếp hạng `rank_in_country` và tính `level` bằng `levelFor(area_ha, share, production_t)` (`major` ≥ 5%, `common` ≥ 0,5%, `minor` < 0,5%).
   - Đưa cây vào `cropsOfCountry` để `country_crops.csv` liệt kê trong `major_crop_ids`, `common_crop_ids`, `minor_crop_ids`.
3. **Khi thống kê quốc gia gộp chung hoặc không có dòng riêng (`59 dòng`):**
   - Để trống `area_ha` và `production_t`, giữ `level = unknown` (không bao giờ suy diện tích từ hàng gộp FAOSTAT) và ghi rõ lý do vào cột `note`.
   - **Chỉ nhập số khi nguồn cho số của đúng loài đó trên phạm vi cả nước.** Diện tích của một thành phố, một xã hay một mô hình trình diễn không phải số liệu quốc gia; số của cả một nhóm (mọi loại đậu ăn hạt khô, bí ngô và bí của mọi loài, mọi loại cải Trung Quốc, mọi loài đậu tằm) không phải số của một loài. Trong cả hai trường hợp ô số để trống, `level = unknown`, còn `note` ghi đúng điều nguồn nêu (xem mục 3.3).
4. **Không ghi đè dòng `exact` đã có diện tích:**
   - Dòng quốc gia chỉ thay thế dòng `unknown` hoặc `absent`; mọi dòng `exact` mà FAOSTAT có báo cáo cho nước đó (có diện tích, hoặc chỉ có sản lượng: `present`) được giữ nguyên tuyệt đối, dù dòng quốc gia có số hay không. Dòng quốc gia bị bỏ qua như vậy được build liệt kê (`national rows ignored` trong báo cáo, `national_rows_ignored` trong `summary.csv`; hiện không có dòng nào).

---

## 3. Bảng 17 dòng có số liệu diện tích thu hoạch chính thức

### 3.1. Việt Nam (`VNM` — mẫu số FAOSTAT: `13.504.720 ha`)

| `crop_id` | Tên cây | Trước T4 | `area_ha` (ha) | `production_t` (tấn) | Năm | Tỉ trọng (%) | Mức mới (`level`) | Nguồn & Bảng |
|---|---|---|---:|---:|---:|---:|---|---|
| `durio-zibethinus` | Sầu riêng | `unknown` (hàng 603) | `178.800` | `1.470.000` | 2024 | `1,324%` | **`common`** | Bộ NN&MT / Cục Trồng trọt & BVTV, *Báo cáo thường niên thị trường Rau quả 2025*, Mục 1.2.1 & 1.2.2.(i) (tr. 13, 15–17) |
| `musa-acuminata` | Chuối | không có dòng (`none`) | `144.600` | `2.997.900` | 2024 | `1,071%` | **`common`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |
| `mangifera-indica` | Xoài | `unknown` (hàng 571) | `96.500` | `1.094.100` | 2024 | `0,715%` | **`common`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |
| `litchi-chinensis` | Vải *(từ T1 #8)* | `unknown` (hàng 619) | `51.900` | `255.000` | 2024 | `0,384%` | **`minor`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |

### 3.2. Hoa Kỳ (`USA` — mẫu số FAOSTAT: `98.830.011 ha`)

| `crop_id` | Tên cây | Trước T4 | `area_ha` (ha) | `production_t` (tấn) | Năm | Tỉ trọng (%) | Mức mới (`level`) | Nguồn & Bảng |
|---|---|---|---:|---:|---:|---:|---|---|
| `medicago-sativa` | Cỏ linh lăng (Alfalfa) | không có dòng (`none`) | `5.939.230` | `45.552.470` | 2025 | `6,010%` | **`major`** | USDA NASS *Crop Production 2025 Summary*, Metric Units (pp. 96–97, *Hay, Alfalfa*) |
| `lactuca-sativa-var-capitata` | Xà lách cuộn | `unknown` (hàng 372) | `45.163` | `1.737.848` | 2025 | `0,046%` | **`minor`** | USDA NASS *Vegetables 2025 Summary* (p. 45, *Head Lettuce*: 111.600 acres, 38.313,0 nghìn cwt) |
| `capsicum-annuum` | Ớt | `unknown` (hàng 401) | `18.413` | `598.810` | 2025 | `0,019%` | **`minor`** | USDA NASS *Vegetables 2025 Summary* (pp. 54, 58, *Bell & Chile Peppers*: 32.300 + 13.200 acres, 10.578,0 + 2.623,5 nghìn cwt) |
| `sesamum-indicum` | Mè / Vừng *(từ T1 #8)* | `absent` (hàng 289) | `17.740` | `12.465` | 2022 | `0,018%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 27 (p. 496, *Sesame*) |
| `raphanus-sativus` | Củ cải trắng | `unknown` (hàng 463) | `9.894` | — | 2022 | `0,010%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (pp. 33, 36, *Daikon & Radishes*) |
| `trifolium-pratense` | Cỏ ba lá đỏ | không có dòng (`none`) | `5.812` | `4.172` | 2022 | `0,006%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 484, *Red clover seed*) |
| `mentha-spicata-var-crispa` | Húng lủi | `unknown` (hàng 748) | `4.690` | `730` | 2025 | `0,005%` | **`minor`** | USDA NASS *Crop Production 2025 Summary*, Metric Units (pp. 96–97, *Spearmint oil*) |
| `sorghum-x-drummondii` | Cỏ Sudan | không có dòng (`none`) | `4.386` | `7.344` | 2022 | `0,004%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 484, *Sudangrass seed*) |
| `brassica-juncea` | Cải bẹ xanh | không có dòng (`none`) | `4.379` | — | 2022 | `0,004%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (pp. 33–34, *Cabbage, mustard & Mustard greens*) |
| `trifolium-incarnatum` | Cỏ ba lá đỏ thẫm | không có dòng (`none`) | `3.443` | `3.414` | 2022 | `0,003%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 482, *Crimson clover seed*) |
| `allium-fistulosum` | Hành lá *(từ T1 #8)* | `absent` (hàng 402) | `2.435` | — | 2022 | `0,002%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (p. 35, *Onions, green*) |
| `mangifera-indica` | Xoài | `unknown` (hàng 571) | `1.272` | — | 2022 | `0,001%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 37 (p. 39, *Mangoes*) |
| `musa-acuminata` | Chuối | không có dòng (`none`) | `498` | — | 2022 | `<0,001%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 37 (p. 37, *Bananas*) |

Quy đổi: 1 acre = 0,40468564 ha; 1 cwt = 45,359237 kg; 1 lb = 0,45359237 kg.

### 3.3. Bảy dòng có nguồn nhưng nguồn không cho số liệu quốc gia của loài (`level = unknown`)

| `crop_id` | Nước | Nguồn nêu gì | Vì sao không nhập |
|---|---|---|---|
| `ipomoea-aquatica` | `VNM` | Diện tích rau muống nước của riêng TP. Hồ Chí Minh, khoảng 508,4 ha (Trung tâm Khuyến nông TP.HCM) | Số của một thành phố, không phải cả nước |
| `ocimum-basilicum` | `VNM` | Một mô hình trình diễn 3 ha tại xã Lạc Sơn, huyện Đô Lương, Nghệ An (Trung tâm Khuyến nông Quốc gia) | Số của một mô hình, không phải cả nước |
| `basella-alba` | `VNM` | Khoảng 1,2 ha của khoảng 5 hộ tại xã Hưng Điền, huyện Tân Hưng, Long An (Văn phòng Điều phối NTM tỉnh Hà Tĩnh dẫn lại) | Số của một xã, không phải cả nước |
| `phaseolus-vulgaris` | `USA` | *Dry edible beans*: 540.100 ha, 1.218.120 tấn năm 2025 (*Crop Production 2025 Summary*, pp. 96–97) | Nhóm nhiều lớp thương mại thuộc hơn một loài (có Lima, Blackeye); không tách *Phaseolus vulgaris* |
| `cucurbita-moschata` | `USA` | *Pumpkins*: 68.100 acres, 14.654,5 nghìn cwt; *Squash*: 37.200 acres, 6.388,0 nghìn cwt năm 2025 (*Vegetables 2025 Summary*, pp. 60, 66) | Gộp mọi loài *Cucurbita*; không tách *C. moschata* |
| `brassica-rapa-pak-choi` | `USA` | *Cabbage, Chinese (nappa, bok choy, etc.)*: 15.626 acres năm 2022 (Census Table 36, p. 32) | Gộp cải thảo, cải thìa và các loại khác |
| `vicia-villosa-ssp-villosa` | `USA` | *Vetch seed*: 2.122 acres, 1.204.720 lb năm 2022 (Census Ch. 2 Table 26, p. 485) | Gộp mọi loài *Vicia* |

---

## 4. Cách chạy lại và kiểm tra

```bash
npx tsx scripts/crops/atlas/build.ts --offline
npx tsx scripts/crops/country-tables.ts
npx vitest run scripts/crops src/data
npx tsc --noEmit
```
