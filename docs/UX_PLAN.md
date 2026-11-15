# Kế hoạch UI/UX

Viết ngày 15/11/2026, theo ghi chú của Bảo. Kế hoạch chung của nhóm: `docs/PLAN.md`.

## 1. Quy tắc dẫn chứng

Áp dụng cho mọi phần việc của nhóm, không riêng giao diện: **không đưa ra thứ gì không chỉ được căn cứ**.

| Loại việc | Căn cứ phải có |
|---|---|
| Số liệu, bảng dữ liệu | tệp nguồn, đường dẫn, ngày truy cập, giấy phép; ô không có nguồn để trống |
| Công thức, ngưỡng, hệ số | tài liệu công bố hoặc phép thử trên dữ liệu thật, ghi trong `docs/` |
| Thay đổi giao diện | một trong bốn thứ: (a) quan sát trên màn hình hiện tại, có ảnh hoặc số đo; (b) yêu cầu của đề bài; (c) mẫu tham chiếu đã đo (OneSoil, `docs/DESIGN.md`); (d) kết quả cho người khác dùng thử |
| Câu chữ trên web | nói đúng điều dữ liệu cho thấy; ước lượng thì ghi là ước lượng |

Mỗi mục dưới đây viết theo ba phần: **vấn đề** (kèm căn cứ), **thay đổi**, **xong khi** (tiêu chí kiểm được). Mẫu pull request có ô "Căn cứ" để ghi phần này.

## 2. Hành trình cần đạt

Một người lần đầu vào web đi qua bốn bước, mỗi bước một màn hình rõ việc:

1. **Tìm ruộng**: gõ địa điểm hoặc chọn trên bản đồ.
2. **Xem ruộng**: ruộng đang thế nào, theo dữ liệu vệ tinh.
3. **Cho biết điều kiện thật**: đất, nước tưới, cây đang trồng. Số vệ tinh là ước lượng; số của người trồng thay cho nó.
4. **Quyết định**: so sánh các phương án luân canh, xem cần cải tạo đất gì.

Đề bài yêu cầu so sánh ít nhất ba phương án luân canh, mỗi phương án có lý do, bằng chứng, lợi ích, thiếu sót và rủi ro. Bước 4 là đích; ba bước đầu phải ngắn.

## 3. Các hạng mục

### U1. Trang đầu gộp với trang chọn ruộng (đang làm)

**Vấn đề.** Hiện có ba màn hình trước khi thấy dữ liệu của một ruộng tự thêm: trang chào (`src/ui/hero`), danh sách ruộng, bước thêm ruộng (`src/ui/field/FindField.tsx`). Đếm thao tác cho luồng "địa chỉ và diện tích": bấm Bắt đầu, bấm Thêm ruộng, gõ địa chỉ, chọn gợi ý, nhập diện tích, bấm Hiện trên bản đồ, bấm Khoá ruộng: bảy thao tác.

**Thay đổi.** Một trang theo bản phác của Bảo: quả cầu, một câu hỏi, một ô tìm kiếm, hai nút "Chọn trên bản đồ" và "Thử ruộng mẫu". Câu hỏi đổi từ "Where is your farm?" thành "Where is your field?" / "Thửa ruộng của bạn ở đâu?", vì web đọc dữ liệu cho một thửa chứ không cho cả trang trại.

**Xong khi.** Từ lúc mở web đến lúc thấy dữ liệu của ruộng tự chọn còn bốn thao tác: gõ nơi, chọn gợi ý, bấm vào ruộng, khoá. Ruộng mẫu: một thao tác.

### U2. Gộp hai ô tìm kiếm (đang làm)

**Vấn đề.** Có hai ô: "Tìm ruộng" trong danh sách và "Tìm địa điểm" trên bản đồ (`src/ui/chrome/MapSearch.tsx`). Người dùng phải biết gõ vào ô nào.

**Thay đổi.** Một ô, kết quả ghi rõ loại: ruộng của bạn, ruộng mẫu, địa điểm, toạ độ.

**Xong khi.** Trên mọi màn hình chỉ còn một ô tìm kiếm.

### U3. Một ruộng mẫu: Diamond Valley (đang làm)

**Vấn đề.** Bốn ruộng mẫu làm danh sách dài trước khi người dùng có ruộng của mình.

**Thay đổi.** Chỉ đưa ra Diamond Valley. Ba ruộng kia vẫn nằm trong mã vì test và đường dẫn trực tiếp `?sample=` dùng chúng.

**Xong khi.** Trang đầu, danh sách và quả cầu chỉ hiện một ruộng mẫu.

### U4. Thanh điều hướng thành hộp nổi ở dưới giữa trong giai đoạn đầu

**Vấn đề.** Khi chưa có ruộng, thanh biểu tượng bên trái và bảng danh sách 280 px chiếm chỗ của bản đồ, trong khi việc duy nhất lúc đó là tìm ruộng.

**Thay đổi.** Trước khi có ruộng (trang đầu và lúc dò trên bản đồ), mọi điều hướng nằm trong một hộp nổi ở dưới giữa: ô tìm kiếm, "Chọn trên bản đồ", "Ruộng mẫu", lối vào "Trồng rau đô thị" và "Hỏi đáp". Không còn thanh trái và bảng danh sách ở giai đoạn này.

**Đã chốt (Bảo, 15/11).** Sau khi đã có ruộng, điều hướng trở lại thanh trái. Cột danh sách ruộng có thêm nút gom lại và mở ra; khi gom, bản đồ được thêm chỗ và ruộng được căn lại giữa phần còn trống.

**Xong khi.** Ở giai đoạn đầu bản đồ chiếm toàn màn hình; không có lối vào nào bị mất.

### U5. Sắp xếp lại màn hình khi đã có ruộng

**Vấn đề.** Bảng ruộng rộng 580 px có bốn thẻ ngang hàng (Tình trạng, Báo cáo thửa, Dữ liệu, Số liệu thực địa) và hai nút ở đầu (Kế hoạch luân canh, Ghi chép). Thứ tự này theo loại dữ liệu chứ không theo câu hỏi của người trồng. Bảo đã nhận xét bảng bên phải lộn xộn.

**Thay đổi.** Sắp theo bốn câu hỏi của hành trình:

| Thẻ mới | Trả lời câu hỏi | Gồm |
|---|---|---|
| Tổng quan | ruộng đang thế nào | một câu tóm tắt, ba số chính, ảnh ruộng theo ngày, hai biểu đồ |
| Đất và canh tác | điều kiện thật của ruộng là gì | phần người trồng điền (U6), kèm chẩn đoán đất của Duy |
| Luân canh | nên trồng gì | phương án đứng đầu và chênh lệch so với hiện tại, nút mở trang luân canh |
| Dữ liệu | số liệu chi tiết từ đâu | tám nhánh dữ liệu, nguồn, độ tin cậy |

**Xong khi.** Mỗi thẻ trả lời được câu hỏi của nó mà không cần cuộn quá một màn hình ở 1440 × 900; không còn nút nào ở đầu bảng lặp lại một thẻ.

**Đã làm (15/11).** Bốn thẻ như bảng trên (`src/ui/field/FieldPanel.tsx`, `OverviewTab.tsx`, `SoilTab.tsx`, `RotationTab.tsx`). Hai nút "Kế hoạch luân canh" và "Ghi chép" ở đầu bảng đã bỏ; trang Ghi chép vẫn mở được từ thanh trái cho đến khi chốt U9.

- Tổng quan: câu tóm tắt là câu của mô hình (`score.summary.headline`); ba số là điểm, yếu tố giới hạn (kèm giá trị thực và khoảng lý tưởng), NDVI hiện tại so với dải bình thường của ngày đó; tối đa hai thay đổi gần ngày đang xem; ảnh ruộng theo ngày; hai biểu đồ NDVI và mưa tích lũy.
- Luân canh: phương án điểm cao nhất, chuỗi vụ của nó, bốn tiêu chí đầu theo ưu tiên của người trồng so với cách đang làm, nút mở trang so sánh. Mọi số lấy từ báo cáo khuyến nghị, thẻ không tính lại gì.
- Dữ liệu: tám nhánh, biểu đồ tích ôn; phần vùng sinh trưởng trong thửa gập lại, mở khi cần.
- Khác bản kế hoạch: ba ô "cây đang trồng, ngày gieo, thời tiết" ở đầu thẻ cũ đã bỏ. Cây và ngày gieo nằm ở "Đất và canh tác"; thời tiết vẫn ở góc bản đồ trên màn hình rộng, màn hình hẹp hiện không còn chỗ hiện thời tiết.

Đo ở 1440 × 900 (bảng cao 884 px), tiếng Việt, thửa mẫu Cần Thơ có ba vụ:

| Thẻ | Chiều cao nội dung | Phải cuộn |
|---|---|---|
| Tổng quan | 1.325 px | 0,5 màn hình |
| Đất và canh tác | 1.725 px | 0,95 màn hình |
| Luân canh | 884 px | không |
| Dữ liệu | 1.722 px | 0,95 màn hình |

Ở 426 × 690 bốn tên thẻ nằm vừa một hàng (thẻ thứ hai rút thành "Đất"), không tràn ngang.

### U6. "Ground truth" đổi tên, đưa lên trước, vẫn có chỗ điền tình trạng đất

**Vấn đề.** Thẻ "Số liệu thực địa" nằm cuối cùng và tên của nó là thuật ngữ. Đây lại là bước làm kết quả đúng hơn nhiều nhất: `GroundTruth` trong `src/contracts/model.ts` có sáu trường về đất (pH, độ dẫn điện, thành phần cơ giới, thoát nước, độ sâu, chất hữu cơ), cùng nước tưới, cây đang trồng và giá; số vệ tinh về đất chỉ là ước lượng ở ô 250 m.

**Thay đổi.**

- Tên mới: "Đất và canh tác" / "Soil and practice". Tên ngắn trên thẻ: "Đất".
- Ngay sau khi khoá ruộng, một thẻ nhỏ hỏi ba điều dễ trả lời nhất: đất chua hay không (hoặc pH nếu đã đo), có tưới không, đang trồng cây gì. Mỗi ô hiện sẵn ước lượng từ vệ tinh và có lựa chọn "Tôi không biết".
- Phần đầy đủ chia bốn nhóm: Đất, Nước, Cây trồng, Tiền (năng suất, giá, chi phí của chính người trồng).
- Mỗi lần điền, hiện ngay điểm thay đổi thế nào (sổ hiệu chỉnh đã có trong mô hình).

**Xong khi.** Người dùng điền được pH trong hai thao tác kể từ lúc khoá ruộng; mỗi ô có ước lượng vệ tinh làm mặc định và nguồn của nó.

**Đã làm (15/11).** Tên mới ở mọi chỗ trong giao diện, kể cả nhãn trên từng giá trị ("Số của bạn" thay "Đo thực địa") và các câu ở trang luân canh, ghi chép.

- Thẻ ba câu hỏi nằm đầu thẻ Tổng quan ngay khi mở ruộng (`src/ui/override/QuickFacts.tsx`): pH đất, tưới, cây đang trồng. Ô pH hiện sẵn ước tính và nguồn (ví dụ "Ước tính: 6.1 · SoilGrids 2.0 · 250 m"); tưới và cây có lựa chọn "Tôi không biết". Đóng thẻ thì nó không hiện lại với ruộng đó trong phiên làm việc.
- Điền pH: bấm vào ô, gõ số, Enter. Đã thử trên thửa Diamond Valley: nhập 7,5 thay cho ước tính 8,8 thì điểm đổi từ 53 thành 85 và dòng "53 → 85 (+32)" hiện ngay trong thẻ.
- Phần đầy đủ chia bốn nhóm Đất, Nước, Cây trồng, Tiền. Thêm bốn ô trước đây mô hình đã đọc nhưng giao diện chưa cho nhập: chất hữu cơ, nguồn nước, năng suất vụ trước, giá bán, chi phí mỗi ha (USD hoặc VND). Nhóm Tiền hiện giá trị tham chiếu đang dùng và mở ra được nguồn của chúng.
- Các vụ không phải vụ đang trồng thu lại còn một dòng, bấm để mở.
- Dòng điểm trước và sau không tính gì ở giao diện: nó ghi lại điểm đang hiện lúc người dùng nhập và điểm sau khi mô hình tính lại (`src/ui/override/scoreChange.ts`, có test).

**Chưa làm, và vì sao.**

- Câu hỏi "đất chua hay không" cho người chưa đo pH: mô hình chỉ nhận một con số pH, không có đầu vào "chua" hay "không chua". Đổi câu trả lời đó thành một con số là tự đặt ra số liệu, nên thẻ chỉ hỏi pH và giữ ước tính khi để trống.
- Chẩn đoán đất của Duy: `src/core/soil` chưa có. Chỗ dành cho nó là khối "Đất cần gì" dưới nhóm Đất, hiện mới in kế hoạch pH mà phần khuyến nghị đã tính sẵn (chỉ hiện khi cần bón vôi hoặc lưu huỳnh).
- Tưới không có ước tính từ dữ liệu: khi chưa chọn, ô ghi rõ mô hình coi ruộng là nhờ mưa.

### U7. Xoay bản đồ bằng chuột

**Đã chốt (Bảo, 15/11).** Bỏ hai nút xoay cạnh la bàn. Cử chỉ xoay là hai ngón: một ngón đi xuống, một ngón đi lên thì bản đồ xoay theo chiều kim đồng hồ, và ngược lại.

**Thực tế kỹ thuật.**

| Thiết bị | Cử chỉ vặn hai ngón |
|---|---|
| Màn hình cảm ứng (điện thoại, máy tính bảng, laptop cảm ứng) | có sẵn trong MapLibre (`touchZoomRotate`) |
| Bàn rê của Mac trên Safari | Safari báo cử chỉ vặn cho trang web (`gesturechange`); thêm vào |
| Bàn rê của Windows trên Chrome, Edge | trình duyệt chỉ chuyển cho trang web cử chỉ cuộn và chụm, không chuyển cử chỉ vặn; trang web không nhận biết được |

Trên bàn rê Windows vẫn còn hai cách: giữ Alt rồi vuốt hai ngón, và kéo bằng chuột phải. Nút la bàn đưa về hướng bắc.

**Xong khi.** Trên màn hình cảm ứng, vặn hai ngón xoay được bản đồ theo đúng chiều; thanh công cụ không còn hai nút xoay.

### U8. Trang luân canh

**Vấn đề.** Trang cao 7.079 px ở cửa sổ cao 690 px (đo trên thửa An Giang, tiếng Việt), tức hơn mười màn hình cuộn. Năm thẻ phương án phải cuộn ngang. Giá trị trong các ô bằng chứng còn tiếng Anh ở chế độ tiếng Việt. Ở thửa Nevada một phương án xếp chồng hai vụ.

**Thay đổi.**

- Hai cột ở màn hình rộng: trái là lịch mùa vụ và biểu đồ được mất; phải là năm mục lý do, bằng chứng, lợi ích, thiếu sót, rủi ro của phương án đang chọn.
- Dải chọn phương án dính ở đầu trang khi cuộn.
- Kế hoạch năm và các lời khuyên hành động thu gọn mặc định.
- Sửa hai lỗi nêu trên.

**Xong khi.** Trang không quá ba màn hình ở 1440 × 900; đổi phương án không cần cuộn lên đầu.

### U9. Ghi chép của ruộng

**Vấn đề.** Trang hiện tại (`src/ui/tracking`, 434 dòng) gồm nhật ký tự do và phần theo dõi dài hạn bằng dữ liệu mô phỏng. Nó không phục vụ việc so sánh phương án luân canh mà đề bài yêu cầu, và dữ liệu mô phỏng dễ gây hiểu nhầm.

**Thay đổi (đề xuất).** Bỏ trang riêng. Giữ một nhật ký ngắn trong thẻ "Đất và canh tác": mỗi dòng là một việc đã làm (gieo, bón vôi, thu hoạch, số đo đất mới). Các dòng này là dữ liệu thật của người trồng và được mô hình dùng: ngày gieo, năng suất vụ trước, pH đo lại.

**Cần Bảo chốt:** giữ nhật ký ngắn như trên, hay bỏ hẳn.

**Xong khi.** Thanh điều hướng không còn mục Ghi chép; không còn dữ liệu mô phỏng nào hiện ra mà không có nhãn.

### U10. Mascot, màn hình hẹp, chất lượng chung

| Việc | Xong khi |
|---|---|
| Gắn mascot của Uyên: trang đầu, trạng thái trống, hỏi đáp, trồng rau đô thị | không che nội dung; tắt chuyển động khi máy đặt giảm chuyển động |
| Màn hình hẹp (khung 426 px Bảo hay dùng) | mọi màn hình ở U1–U9 dùng được, không tràn ngang |
| Hai thứ tiếng | không còn chuỗi tiếng Anh nào ở chế độ tiếng Việt |
| Tương phản | chữ trắng trên nền xanh lá hiện 2,87:1; nâng lên mức đạt chuẩn hoặc đổi sang xanh đậm |

## 4. Thứ tự

| Đợt | Hạng mục | Phụ thuộc |
|---|---|---|
| 1 (đang làm) | U1, U2, U3 | không |
| 2 (xong 15/11) | U5, U6 | khối "Đất cần gì" chờ chẩn đoán đất của Duy |
| 1 (đang làm, thêm vào) | U4, U7 | đã chốt |
| 4 | U8, U9 | Bảo chốt câu hỏi ở U9 |
| 5 | U10 và dùng thử | mascot của Uyên |

## 5. Cách kiểm

Sau mỗi đợt: kiểm tra kiểu, test, build; mở từng màn hình ở 1440 × 900 và 426 × 690, tiếng Anh và tiếng Việt.

Cuối đợt 5, cho ba người trong nhóm không làm giao diện dùng thử năm việc, ghi thời gian và chỗ vấp:

1. Mở dữ liệu của một ruộng ở quê mình.
2. Nói xem ruộng đó đang tốt hay xấu so với thường lệ.
3. Nhập pH đất và xem điểm đổi thế nào.
4. Chọn một phương án luân canh và nói vì sao nó hơn hiện tại.
5. Hỏi trợ lý một câu về cây đang trồng.

Kết quả ghi vào tài liệu này; chỗ nào hai trong ba người vấp thì sửa trước khi nộp.
