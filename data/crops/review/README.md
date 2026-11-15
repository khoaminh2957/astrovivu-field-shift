# Đối chiếu Atlas Cây Trồng (`VNM` & `USA`) — T1 (#8)

Thư mục này lưu bảng đối chiếu thủ công kết quả dựng tự động của Crop Atlas (`data/crops/atlas/`) với niên giám và báo cáo thống kê nông nghiệp quốc gia chính thức của Việt Nam (`VNM`) và Hoa Kỳ (`USA`).

## Tệp trong thư mục

| Tệp | Mô tả |
|---|---|
| `atlas-check-vnm-usa.csv` | Bảng kiểm 62 dòng: 15 mặt hàng diện tích lớn nhất ở `VNM`, 15 mặt hàng lớn nhất ở `USA`, 20 cây đã biên soạn đang bị xếp `absent` ở `VNM`, 9 cây đã biên soạn đang bị xếp `absent` ở `USA`, và 3 cây biên soạn quan trọng bị thiếu mức (`musa-acuminata`, `durio-zibethinus` ở `VNM`; `medicago-sativa` ở `USA`). |

## Ý nghĩa các cột trong `atlas-check-vnm-usa.csv`

- `iso3`: Mã quốc gia (`VNM` hoặc `USA`).
- `crop_id`: Mã cây trong `data/crops/atlas/crops.csv`.
- `faostat_item_code`: Mã mặt hàng FAOSTAT QCL gắn với cây (hoặc trống nếu `curated-only`).
- `atlas_area_ha`: Diện tích thu hoạch trung bình 2022–2024 trong atlas (ha).
- `atlas_level`: Mức phổ biến hiện tại trong `crop_country.csv` (`major`, `common`, `minor`, `absent`, `unknown`, hoặc `curated-only`).
- `national_area_ha`: Diện tích thu hoạch (ha) tra từ nguồn thống kê quốc gia chính thức cùng kỳ.
- `national_year`: Năm hoặc giai đoạn của số liệu quốc gia.
- `verdict`: Kết luận đối chiếu:
  - `dung` (18 dòng): Mức tính từ thống kê quốc gia khớp với mức của atlas.
  - `sai-muc` (0 dòng): Mức tính từ thống kê quốc gia lệch mức của atlas.
  - `sai-absent` (2 dòng): Atlas ghi `absent`, và một nguồn thống kê quốc gia nêu diện tích lớn hơn 0 cho đúng cây đó (2 cây ở `USA`).
  - `sai-cay` (2 dòng): Diện tích mặt hàng đúng nhưng gắn lệch mã loài (`musa-sapientum` thay vì `musa-acuminata` ở `VNM`; `beta-vulgaris` thay vì `beta-vulgaris-var-saccharifera` ở `USA`).
  - `chung-hang` (4 dòng): Một mặt hàng FAOSTAT gán chung diện tích cho nhiều loài trong cùng chi (`Coffea`, `Cinnamomum`, `Triticum`, `Gossypium`).
  - `thieu` (8 dòng): Cây quan trọng ở cấp quốc gia nhưng đang ở mức `unknown` (do nằm trong hàng gộp) hoặc `curated-only` (không có mặt hàng FAOSTAT).
  - `khong-co-nguon` (28 dòng): Không tách dòng riêng trong niên giám/báo cáo thống kê quốc gia (gồm 11 cây ôn đới/khô hạn `absent` đúng ở `VNM`, 7 cây nhiệt đới `absent` đúng ở `USA`, và 9 cây rau, đậu, gia vị, quả ở `VNM` được cho là có trồng nhưng chưa có nguồn nào nêu diện tích riêng).
- `source`, `url`, `accessed`, `note`: Nguồn trích dẫn, liên kết, ngày truy cập (`2026-11-15`) và thuyết minh chi tiết.

## Tóm tắt chuyển giao cho T4 (#9) và K3 (#23)

1. **2 dòng `sai-absent`**, **8 dòng `thieu` (+ 2 dòng `sai-cay`)** và **9 dòng `khong-co-nguon` của `VNM` cần tìm nguồn nêu tên cây** được chuyển sang `data/crops/national/prevalence.csv` ở bước **T4 (#9)**.
2. Kết quả kiểm tra 4 vùng thửa mẫu (`Dak Lak`, `Can Tho city`, `Iowa`, `Nevada`) trên `region_crops.csv` (MapSPAM 2020 V2r2) được ghi chi tiết tại mục **9.1** của `docs/CROP_DATA.md`.
