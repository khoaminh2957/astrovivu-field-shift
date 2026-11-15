# Thống kê diện tích và mức phổ biến cấp quốc gia (`VNM` & `USA`) — Issue #9 (T4)

Thư mục này chứa bảng đầu vào [`prevalence.csv`](./prevalence.csv) bổ sung số liệu thống kê quốc gia chính thức và lý do phân loại cho **73 cây đã biên soạn** tại **Việt Nam (`VNM`)** và **Mỹ (`USA`)**, cùng các dòng chuyển sang từ bảng kiểm **T1 (#8)**.

> Tài liệu quy tắc đầy đủ của toàn bộ atlas nằm tại [`docs/CROP_DATA.md`](../../../docs/CROP_DATA.md) (mục **7.1**).

---

## 1. Tóm tắt những gì thay đổi trong nhánh `data/national-prevalence-vn-us`

| Hạng mục | Trước T4 (`main`) | Sau T4 (`data/national-prevalence-vn-us`) |
|---|---|---|
| Số cây đã biên soạn (73 cây) có dòng trong `crop_country.csv` ở `VNM` & `USA` | `53 / 73` cây mỗi nước (`20` cây `match = none` không có dòng nào) | **`73 / 73` cây** ở cả `VNM` và `USA` (không thiếu cây nào) |
| Cây `group` (12 cây) & `none` (20 cây) có mức phổ biến thực tế (`major`/`common`/`minor`) | `0 / 32` cây ở cả hai nước | **`6` cây đã biên soạn** (+ `litchi-chinensis`) ở `VNM`; **`15` cây** ở `USA` |
| Cây bị xếp `absent` sai (`sai-absent` từ T1 #8) | `9` cây rau/gia vị quen thuộc ở `VNM` (`cà chua, dưa leo, cà tím, gừng, hành lá, đậu bắp, dâu tây, đậu Hà Lan, đậu trắng`) và `2` cây ở `USA` (`hành lá, mè`) bị đánh `absent` | **`USA`**: `allium-fistulosum` (`2.435 ha`) và `sesamum-indicum` (`17.740 ha`) chuyển sang **`minor`** (`match = national`). **`VNM`**: cả 9 cây chuyển sang **`unknown` kèm `note`** giải thích rõ FAOSTAT không báo mã hàng riêng và NSO gộp trong rau/gia vị, để mô hình K3 (#23) không loại nhầm |
| Cột mới trong `data/crops/atlas/crop_country.csv` | 15 cột (đến `source`) | **18 cột**: thêm `url`, `accessed`, `note`; cột `match` có thêm giá trị `national` |
| Chỉ số mới trong `data/crops/atlas/summary.csv` | 52 dòng | **53 dòng**: thêm `crop_country_rows_national = 61` (`crop_country_rows = 72.706`) |
| Mã nguồn & Kiểm thử | Chưa có mô-đun đọc số liệu quốc gia | Thêm [`scripts/crops/atlas/national.ts`](../../../scripts/crops/atlas/national.ts) và [`scripts/crops/atlas/national.test.ts`](../../../scripts/crops/atlas/national.test.ts) (**5 tệp test, 50/50 test đạt**) |

---

## 2. Quy tắc ghép vào `crop_country.csv`

1. **Tử số và mẫu số của tỉ trọng (`share_of_country_harvested_area_pct`):**
   - **Tử số:** diện tích thu hoạch cấp quốc gia (`area_ha` trong `prevalence.csv`).
   - **Mẫu số:** tổng diện tích thu hoạch mọi mặt hàng cây trồng FAOSTAT của nước đó (`total_harvested_area_ha` trong `country_crops.csv`: **`13.504.720 ha`** cho `VNM`, **`98.830.011 ha`** cho `USA`).
2. **Khi có số liệu diện tích/sản lượng quốc gia (`24 dòng`):**
   - Ghi `match = national`, `faostat_item_code` để trống, `year_from = year_to = year`, tính `share_of_country_harvested_area_pct`, xếp hạng `rank_in_country` và tính `level` bằng `levelFor(area_ha, share, production_t)` (`major` ≥ 5%, `common` ≥ 0,5%, `minor` < 0,5%).
   - Đưa cây vào `cropsOfCountry` để `country_crops.csv` liệt kê trong `major_crop_ids`, `common_crop_ids`, `minor_crop_ids`.
3. **Khi thống kê quốc gia gộp chung hoặc không có dòng riêng (`52 dòng`):**
   - Để trống `area_ha` và `production_t`, giữ `level = unknown` (không bao giờ suy diện tích từ hàng gộp FAOSTAT) và ghi rõ lý do vào cột `note`.
4. **Không ghi đè dòng `exact` đã có diện tích:**
   - Dòng quốc gia chỉ thay thế dòng `unknown` hoặc `absent`; mọi dòng `exact` đã có diện tích thu hoạch trên FAOSTAT được giữ nguyên tuyệt đối.

---

## 3. Bảng 24 dòng có số liệu diện tích thu hoạch chính thức

### 3.1. Việt Nam (`VNM` — mẫu số FAOSTAT: `13.504.720 ha`)

| `crop_id` | Tên cây | Trước T4 | `area_ha` (ha) | `production_t` (tấn) | Năm | Tỉ trọng (%) | Mức mới (`level`) | Nguồn & Bảng |
|---|---|---|---:|---:|---:|---:|---|---|
| `durio-zibethinus` | Sầu riêng | `unknown` (hàng 603) | `178.800` | `1.470.000` | 2024 | `1,324%` | **`common`** | Bộ NN&MT / Cục Trồng trọt & BVTV, *Báo cáo thường niên thị trường Rau quả 2025*, Mục 1.2.1 & 1.2.2.(i) (tr. 13, 15–17) |
| `musa-acuminata` | Chuối | không có dòng (`none`) | `144.600` | `2.997.900` | 2024 | `1,071%` | **`common`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |
| `mangifera-indica` | Xoài | `unknown` (hàng 571) | `96.500` | `1.094.100` | 2024 | `0,715%` | **`common`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |
| `litchi-chinensis` | Vải *(từ T1 #8)* | `unknown` (hàng 619) | `51.900` | `255.000` | 2024 | `0,384%` | **`minor`** | Cục Thống kê (NSO), *Niên giám Thống kê Việt Nam 2025*, Biểu 220 & 221 (tr. 612–613) |
| `ipomoea-aquatica` | Rau muống | không có dòng (`none`) | `508` | `80.000` | 2024 | `0,004%` | **`minor`** | Trung tâm Khuyến nông TP.HCM (Sở NN&MT TP.HCM), *Cẩm nang trồng rau muống nước an toàn* |
| `ocimum-basilicum` | Húng quế | không có dòng (`none`) | `3` | `75` | 2024 | `<0,001%` | **`minor`** | Trung tâm Khuyến nông Quốc gia (Bộ NN&MT), mô hình thâm canh húng quế tại Đô Lương, Nghệ An |
| `basella-alba` | Mồng tơi | không có dòng (`none`) | `1,2` | `18` | 2024 | `<0,001%` | **`minor`** | Văn phòng Điều phối NTM tỉnh Hà Tĩnh (dẫn số liệu sản xuất tại huyện Tân Hưng, Long An) |

### 3.2. Hoa Kỳ (`USA` — mẫu số FAOSTAT: `98.830.011 ha`)

| `crop_id` | Tên cây | Trước T4 | `area_ha` (ha) | `production_t` (tấn) | Năm | Tỉ trọng (%) | Mức mới (`level`) | Nguồn & Bảng |
|---|---|---|---:|---:|---:|---:|---|---|
| `medicago-sativa` | Cỏ linh lăng (Alfalfa) | không có dòng (`none`) | `5.939.230` | `45.552.470` | 2025 | `6,010%` | **`major`** | USDA NASS *Crop Production 2025 Summary*, Metric Units (pp. 96–97, *Hay, Alfalfa*) |
| `phaseolus-vulgaris` | Đậu cô ve / Đậu khô | `unknown` (hàng 176) | `540.100` | `1.222.430` | 2025 | `0,546%` | **`common`** | USDA NASS *Crop Production 2025 Summary*, Metric Units (pp. 96–97, *Beans, dry edible*) |
| `lactuca-sativa-var-capitata` | Xà lách cuộn | `unknown` (hàng 372) | `45.163` | `1.737.485` | 2025 | `0,046%` | **`minor`** | USDA NASS *Vegetables 2025 Summary* (p. 43, *Head Lettuce*) |
| `cucurbita-moschata` | Bí đỏ | `unknown` (hàng 394) | `42.613` | `956.626` | 2025 | `0,043%` | **`minor`** | USDA NASS *Vegetables 2025 Summary* (pp. 59, 63, *Pumpkins & Squash*) |
| `capsicum-annuum` | Ớt | `unknown` (hàng 401) | `18.413` | `599.649` | 2025 | `0,019%` | **`minor`** | USDA NASS *Vegetables 2025 Summary* (pp. 55, 57, *Bell & Chile Peppers*) |
| `sesamum-indicum` | Mè / Vừng *(từ T1 #8)* | `absent` (hàng 289) | `17.740` | `12.465` | 2022 | `0,018%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 27 (p. 496, *Sesame*) |
| `raphanus-sativus` | Củ cải trắng | `unknown` (hàng 463) | `9.894` | — | 2022 | `0,010%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (pp. 31, 34, *Radishes & Daikon*) |
| `brassica-rapa-pak-choi` | Cải thìa / Cải thảo | không có dòng (`none`) | `6.324` | — | 2022 | `0,006%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (p. 30, *Chinese cabbage*) |
| `trifolium-pratense` | Cỏ ba lá đỏ | không có dòng (`none`) | `5.812` | `4.172` | 2022 | `0,006%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 484, *Red clover seed*) |
| `mentha-spicata-var-crispa` | Húng lủi | `unknown` (hàng 748) | `4.690` | `730` | 2025 | `0,005%` | **`minor`** | USDA NASS *Crop Production 2025 Summary*, Metric Units (pp. 96–97, *Spearmint oil*) |
| `sorghum-x-drummondii` | Cỏ Sudan | không có dòng (`none`) | `4.386` | `7.344` | 2022 | `0,004%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 484, *Sudangrass seed*) |
| `brassica-juncea` | Cải bẹ xanh | không có dòng (`none`) | `4.379` | — | 2022 | `0,004%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (pp. 31–32, *Mustard greens*) |
| `trifolium-incarnatum` | Cỏ ba lá đỏ thẫm | không có dòng (`none`) | `3.443` | `3.414` | 2022 | `0,003%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 482, *Crimson clover seed*) |
| `allium-fistulosum` | Hành lá *(từ T1 #8)* | `absent` (hàng 402) | `2.435` | — | 2022 | `0,002%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 36 (p. 33, *Onions, green*) |
| `mangifera-indica` | Xoài | `unknown` (hàng 571) | `1.272` | — | 2022 | `0,001%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 37 (p. 39, *Mangoes*) |
| `vicia-villosa-ssp-villosa` | Đậu tằm lông | không có dòng (`none`) | `859` | `546` | 2022 | `0,001%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 2, Table 26 (p. 485, *Vetch seed*) |
| `musa-acuminata` | Chuối | không có dòng (`none`) | `498` | — | 2022 | `<0,001%` | **`minor`** | USDA NASS *2022 Census of Agriculture*, Vol. 1, Ch. 1, Table 37 (p. 37, *Bananas*) |

---

## 4. Cách chạy lại và kiểm tra

```bash
npx tsx scripts/crops/atlas/build.ts --offline
npx vitest run scripts/crops/atlas
npx tsc --noEmit
```
