# Thuật ngữ Astrovivu (tiếng Việt)

Viết cho Astrovivu dựa trên docs/ARCHITECTURE.md và docs/DATA_SOURCES.md. Mỗi mục có mã cố định trùng với tệp tiếng Anh. Giấy phép: CC BY 4.0, nhóm Astrovivu.

## ndvi
title: NDVI (Chỉ số thực vật khác biệt chuẩn hoá)
aliases: ndvi, chỉ số thực vật, độ xanh, sức khoẻ cây, mật độ tán lá
tags: term, vegetation, modis, satellite

NDVI đo mức độ xanh và dày của thảm thực vật. Lá khoẻ hấp thụ ánh sáng đỏ để quang hợp và phản xạ mạnh ánh sáng cận hồng ngoại, nên NDVI = (NIR − Đỏ) / (NIR + Đỏ). Giá trị từ −1 đến 1: đất trống khoảng 0,1-0,2, cây thưa hoặc bị stress 0,2-0,5, tán dày khoẻ 0,6-0,9. Nước và mây cho giá trị gần hoặc dưới 0.

Trong Astrovivu, NDVI lấy từ MODIS MOD13Q1: điểm ảnh 250 m, tổng hợp 16 ngày để loại mây, công bố khoảng một đến hai tuần sau kỳ đo. Một điểm ảnh 250 m rộng 6,25 ha, nên với ruộng nhỏ hơn khoảng 6 ha giá trị bị trộn với đất xung quanh (đường, cây rừng, cây trồng khác). Hãy dùng NDVI như xu hướng của khu vực và so với mức bình thường của chính điểm ảnh đó vào cùng thời điểm, thay vì coi con số tuyệt đối là của riêng thửa ruộng. NDVI giảm có thể do hạn, sâu bệnh, thu hoạch hoặc chỉ do ảnh tổng hợp nhiều mây.

## evi
title: EVI (Chỉ số thực vật tăng cường)
aliases: evi, chỉ số thực vật tăng cường
tags: term, vegetation, modis, satellite

EVI là chỉ số thực vật giống NDVI nhưng dùng thêm kênh xanh lam để hiệu chỉnh ảnh hưởng của khí quyển và của đất lộ ra dưới tán. EVI ít bị bão hoà hơn ở vùng cây rậm, nên phân biệt tán tốt với tán rất tốt rõ hơn NDVI. Astrovivu đọc EVI từ cùng sản phẩm MODIS MOD13Q1 (điểm ảnh 250 m, tổng hợp 16 ngày). Giá trị thường gặp ở cây trồng là 0,2-0,6. Lưu ý tương tự: với thửa nhỏ, điểm ảnh trộn cả đất xung quanh.

## lst
title: Nhiệt độ bề mặt đất (LST)
aliases: lst, nhiệt độ bề mặt, nhiệt độ bề mặt đất, nhiệt bề mặt
tags: term, thermal, modis, satellite, temperature

Nhiệt độ bề mặt đất là nhiệt độ của mặt đất hoặc mặt tán lá do cảm biến nhiệt ghi nhận, không phải nhiệt độ không khí ở độ cao 2 m. Vào buổi chiều nắng, ruộng trống khô có thể nóng hơn không khí 10-20 °C; cây đủ nước thoát hơi nước nên giữ gần bằng nhiệt độ không khí, vì sự bốc hơi làm mát lá. Vì vậy LST là tín hiệu stress: tán cây nóng hơn bình thường nhiều thường là đang thiếu nước.

Astrovivu dùng MODIS MOD11A2: điểm ảnh 1 km, tổng hợp 8 ngày cho ngày và đêm. Ở 1 km, giá trị mô tả cảnh quan quanh ruộng, nên ứng dụng đọc nó như độ lệch so với mức bình thường của chính điểm ảnh. ECOSTRESS đo LST ở 70 m nhưng chỉ theo các lượt bay không đều và cần token Earthdata.

## evaporative-stress
title: Stress bốc thoát hơi và Chỉ số stress bốc thoát hơi (ESI)
aliases: esi, chỉ số stress bốc thoát hơi, stress nước, cây thiếu nước, stress bốc hơi
tags: term, thermal, water, satellite

Stress bốc thoát hơi so sánh lượng nước đất và cây thực sự bốc hơi, thoát hơi với lượng có thể đạt được trong cùng điều kiện thời tiết nếu không thiếu nước. Chỉ số ESI thể hiện tỷ lệ đó dưới dạng độ lệch chuẩn hoá (đơn vị σ) so với mức bình thường của tuần: giá trị âm nghĩa là cây đang dùng ít nước hơn thường lệ, một dấu hiệu sớm của hạn, thường xuất hiện trước khi lá đổi màu. Astrovivu đọc ESI (tổng hợp 4 tuần, giá trị hằng tuần) từ NASA SERVIR ClimateSERV khi có. Đây là tín hiệu vùng ở quy mô kilômét, nên hiểu là "khu vực quanh ruộng khô hơn hay ẩm hơn bình thường".

## evapotranspiration
title: Bốc thoát hơi nước (ET) và bốc thoát hơi tham chiếu ET0
aliases: bốc thoát hơi, bốc thoát hơi nước, thoát hơi nước, bốc hơi, et, et0, nhu cầu nước của cây, lượng nước cây dùng
tags: term, water, agromet

Bốc thoát hơi nước là lượng nước rời khỏi ruộng dưới dạng hơi: bốc hơi từ mặt đất cộng thoát hơi nước qua lá. Đó là lượng nước cây sử dụng, thường tính bằng mm/ngày (1 mm trên 1 ha = 10 m³).

Bốc thoát hơi tham chiếu (ET0) là lượng nước của một thảm cỏ thấp chuẩn, đủ nước, trong thời tiết của ngày đó, tính bằng phương trình Penman-Monteith FAO-56 từ bức xạ, nhiệt độ, độ ẩm và gió. ET0 mô tả "sức hút nước" của khí quyển. Nhu cầu nước của một cây trồng là ETc = Kc × ET0, trong đó Kc là hệ số cây trồng. Astrovivu lấy ET0 từ tái phân tích ERA5 qua Open-Meteo (ô khoảng 9-25 km) và ET thực tế từ MODIS MOD16 (500 m, 8 ngày). ET0 mùa khô vùng nhiệt đới thường 4-6 mm/ngày.

## crop-coefficient
title: Hệ số cây trồng Kc theo FAO-56
aliases: kc, hệ số cây trồng, fao-56, fao 56, kc ini, kc mid, kc end
tags: term, water, fao56

Hệ số cây trồng Kc chuyển bốc thoát hơi tham chiếu (ET0) thành lượng nước của một cây cụ thể: ETc = Kc × ET0. Tài liệu Tưới tiêu và Thoát nước số 56 của FAO cho Kc theo ba giá trị trong vụ: Kc đầu vụ khi cây còn nhỏ và phần lớn nước bốc hơi từ đất trống (thường 0,3-0,5), Kc giữa vụ khi tán phủ kín (thường 1,0-1,2 với cây ruộng) và Kc cuối vụ khi cây chín và khô dần. Vụ được chia thành các giai đoạn đầu, phát triển, giữa vụ và cuối vụ. Bộ chấm điểm của Astrovivu dùng các hệ số và độ dài giai đoạn này từ danh mục cây trồng để đổi thời tiết thành nhu cầu nước hằng ngày; giá trị thực tế phụ thuộc giống, ngày gieo và khí hậu, cần đối chiếu với hướng dẫn địa phương.

## soil-moisture
title: Độ ẩm đất: lớp mặt và vùng rễ
aliases: độ ẩm đất, ẩm độ đất, độ ẩm vùng rễ, độ ẩm tầng rễ, độ ẩm lớp mặt, m3/m3, nước trong đất
tags: term, soil-moisture, smap, satellite, water

Độ ẩm đất là phần thể tích đất chứa nước, đơn vị m³/m³ (0,25 m³/m³ nghĩa là một phần tư thể tích đất là nước). Độ ẩm lớp mặt mô tả khoảng 5 cm trên cùng, khô đi trong vài ngày sau mưa. Độ ẩm vùng rễ mô tả khoảng 1 m đất trên cùng, nơi phần lớn rễ cây hút nước; nó thay đổi chậm hơn và quan trọng hơn với cây.

Vệ tinh SMAP của NASA đo độ ẩm lớp mặt bằng máy đo bức xạ vi sóng; sản phẩm SMAP cấp 4 kết hợp số đo đó với mô hình đất để ước tính độ ẩm vùng rễ trên lưới 9 km, có sau hai đến ba ngày. Một điểm ảnh 9 km rộng khoảng 8.100 ha, nên đây là tín hiệu vùng: Astrovivu so sánh với mức bình thường của chính điểm ảnh vào cùng thời điểm (độ lệch) thay vì coi đó là độ ẩm dưới một thửa ruộng. Tham khảo: dưới khoảng 0,15 m³/m³ là khô, 0,20-0,35 là ẩm, trên khoảng 0,40 là rất ướt, tuỳ thành phần cơ giới đất. Số đo của nông dân sẽ thay thế giá trị vệ tinh.

## soil-moisture-anomaly
title: Độ lệch độ ẩm đất so với bình thường
aliases: độ lệch độ ẩm đất, độ lệch, bất thường, khô hơn bình thường, ẩm hơn bình thường, phân vị, so với bình thường
tags: term, soil-moisture, anomaly, baseline

Độ lệch (anomaly) là mức một giá trị khác với mức bình thường của chính nơi đó vào cùng thời điểm trong năm. Với mỗi nguồn có lịch sử, Astrovivu tính khí hậu theo ngày trong năm của cùng điểm ảnh: giá trị trung bình và dải phân vị 10-90. Độ lệch độ ẩm đất khi đó cho biết, ví dụ, "độ ẩm vùng rễ nằm trong nhóm 10 % năm khô nhất của giữa tháng Ba" hoặc "cao hơn bình thường 0,04 m³/m³".

Dữ liệu thô (điểm ảnh từ 1 km trở lên) được dùng dưới dạng độ lệch chứ không phải giá trị tuyệt đối, vì độ lệch chuyển xuống thửa ruộng tốt hơn nhiều so với chính con số: nếu cả điểm ảnh 9 km khô bất thường thì ruộng gần như chắc chắn cũng khô hơn thường lệ, dù độ ẩm tuyệt đối của nó khác do loại đất. Các Dấu hiệu bất thường trên dòng thời gian được tính từ những độ lệch này.

## water-balance
title: Cân bằng nước
aliases: cân bằng nước, thiếu hụt nước, thâm hụt nước, dư thừa nước, mưa trừ bốc thoát hơi
tags: term, water, water-balance

Cân bằng nước của ruộng là sổ sách nước vào và ra vùng rễ: mưa và tưới đi vào; bốc thoát hơi của cây, nước chảy tràn và thấm sâu đi ra. Khi cây dùng nhiều hơn lượng được cấp trong thời gian đủ dài, kho nước trong đất cạn dần và cây rơi vào thiếu hụt; khi đã dùng quá một tỷ lệ nước dễ tiêu riêng của từng cây (FAO-56 gọi là p, thường 0,4-0,6), cây bắt đầu bị ảnh hưởng.

Dạng đơn giản nhất Astrovivu hiển thị là lượng mưa trừ nhu cầu nước của cây trong một khoảng thời gian (P − ETc), đơn vị mm. Tổng cả vụ −150 mm nghĩa là cây cần thêm 150 mm so với lượng nhận được; tưới hoặc nước dự trữ trong đất phải bù phần đó. Nếu nông dân đặt chế độ tưới "đầy đủ", lượng mưa không còn là yếu tố giới hạn và cân bằng nước tính theo nhu cầu.

## growing-degree-days
title: Độ-ngày sinh trưởng (GDD)
aliases: độ ngày sinh trưởng, tích ôn, gdd, độ ngày, tổng nhiệt
tags: term, temperature, gdd

Độ-ngày sinh trưởng đo lượng nhiệt tích luỹ thúc đẩy cây phát triển. Mỗi ngày, GDD = max(0, (Tmax + Tmin)/2 − Tgốc), trong đó Tgốc là nhiệt độ mà dưới đó cây không phát triển (khoảng 10 °C với ngô và đậu nành, 5 °C với lúa mì). Cộng dồn GDD từ ngày gieo dự báo các giai đoạn như ra hoa, chín tốt hơn đếm ngày lịch, vì vụ mát làm cây chậm lại và vụ ấm làm cây nhanh hơn. Nhiệt độ không khí của Astrovivu lấy từ NASA POWER (ô khoảng 50 km, hiệu chỉnh theo độ cao SRTM của thửa với −6,5 °C mỗi km) và ERA5.

## frost-risk
title: Nguy cơ sương giá
aliases: sương giá, sương muối, băng giá, rét hại, nhiệt độ gây chết, lạnh
tags: term, risk, temperature, frost

Sương giá hình thành khi bề mặt nguội xuống 0 °C hoặc thấp hơn, thường vào đêm quang mây, lặng gió. Mô cây có thể bị hại ngay cả khi không khí ở 2 m vẫn hơi trên 0 °C, vì lá toả nhiệt và lạnh hơn không khí. Chỗ trũng tích khí lạnh và bị trước. EcoCrop cho mỗi cây một nhiệt độ gây chết ở giai đoạn đầu; Astrovivu cảnh báo nguy cơ sương giá khi nhiệt độ thấp nhất dự báo (Open-Meteo, 16 ngày) gần ngưỡng đó, và đếm số ngày sương giá từ lịch sử NASA POWER. Dự báo chỉ là dự báo: sương giá trên một thửa phụ thuộc vị trí của nó trong địa hình, điều mà ô thời tiết 10-50 km không thấy được.

## imerg-rainfall
title: Lượng mưa từ GPM IMERG
aliases: imerg, gpm, mưa vệ tinh, lượng mưa, mưa
tags: term, rain, imerg, satellite

GPM IMERG ghép số đo vi sóng và hồng ngoại từ một chòm vệ tinh thành ước tính lượng mưa toàn cầu mỗi nửa giờ trên lưới 0,1° (khoảng 10 km). Astrovivu dùng tổng ngày. Mưa vệ tinh là ước tính trung bình cho cả ô: một cơn dông có thể đổ xuống ruộng này mà bỏ qua ruộng bên cạnh, mưa nhỏ hoặc mưa vùng núi thường bị ước tính thấp hoặc cao. Hãy dùng IMERG cho thời điểm và lượng mưa của vùng, so 30 hoặc 90 ngày gần nhất với bình thường, và tin vào thùng đo mưa tại vườn hơn cho chính thửa ruộng. Nguồn dự phòng là CHIRPS (ClimateSERV) và tái phân tích ERA5.

## nasa-power
title: Dữ liệu khí hậu nông nghiệp NASA POWER
aliases: nasa power, power, merra-2, khí tượng nông nghiệp, nhiệt độ không khí, độ ẩm không khí, bức xạ mặt trời, gió
tags: term, agromet, power

NASA POWER cung cấp thời tiết hằng ngày cho nông nghiệp từ tái phân tích MERRA-2 (khoảng 50 km) và dữ liệu bức xạ CERES (khoảng 100 km): nhiệt độ không khí ở 2 m, độ ẩm, gió, bức xạ mặt trời và độ ẩm đất mô hình. Đây là số liệu mô hình, không đo tại ruộng, nên Astrovivu hiệu chỉnh nhiệt độ theo chênh lệch giữa độ cao trung bình của ô và độ cao SRTM của thửa. Lỗi đã biết: ở Đông Nam Á lượng mưa của POWER nhảy vọt giữa 2015 và 2016, nên Astrovivu không dùng mưa POWER cho đường nền vượt qua năm 2016 ở khu vực này.

## par
title: Bức xạ quang hợp (PAR)
aliases: par, bức xạ quang hợp, ánh sáng, nắng, bức xạ mặt trời
tags: term, agromet, light

PAR là phần ánh sáng mặt trời (400-700 nm) mà cây dùng để quang hợp, đơn vị MJ/m²/ngày, xấp xỉ 45-50 % tổng bức xạ tới. Những đợt âm u kéo dài làm giảm PAR và làm chậm sinh trưởng, vào chắc hạt, kể cả khi đủ nước. Astrovivu đọc PAR từ NASA POWER (CERES, ô khoảng 100 km), là giá trị của vùng.

## srtm-terrain
title: Địa hình từ SRTM: độ cao, độ dốc, hướng dốc, thoát nước
aliases: srtm, địa hình, độ cao, độ dốc, hướng dốc, hướng dòng chảy, mô hình số độ cao
tags: term, terrain, srtm

Sứ mệnh SRTM đo bề mặt địa hình bằng radar vào tháng 2 năm 2000; Astrovivu dùng mô hình độ cao 30 m. Ở 30 m, một thửa 2 ha có khoảng 22 điểm ảnh, nên độ cao, độ dốc và hướng dốc thực sự ở cấp thửa ruộng. Độ dốc ảnh hưởng xói mòn và máy móc, hướng dốc ảnh hưởng nắng và nhiệt, còn hướng dòng chảy cho biết nước chảy về đâu và đọng ở đâu (nguy cơ úng ở chân dốc). Độ cao cũng dùng để hiệu chỉnh nhiệt độ từ dữ liệu thô (−6,5 °C mỗi km).

## soilgrids
title: Đặc tính đất SoilGrids
aliases: soilgrids, dữ liệu đất, bản đồ đất, sét, cát, thịt, cacbon hữu cơ, cec
tags: term, soil, soilgrids

SoilGrids (ISRIC) là bản đồ đặc tính đất toàn cầu 250 m, tạo bằng học máy từ khoảng 240.000 phẫu diện đất và các biến môi trường. Astrovivu đọc pH, cacbon hữu cơ, sét, cát, thịt, đạm, dung tích trao đổi cation và dung trọng cho tầng 0-30 cm, kèm khoảng phân vị 5-95. Đây là ước tính mô hình về đất của khu vực, không phải số đo của thửa ruộng: việc bón vôi, canh tác và xói mòn tại chỗ không thể hiện trong đó. Kết quả phân tích đất của ruộng luôn thay thế giá trị này. Ở Hoa Kỳ, Astrovivu dùng dữ liệu điều tra SSURGO.

## soil-ph
title: pH đất và độ chua
aliases: ph, ph đất, độ chua, đất chua, đất phèn, đất kiềm, vôi, bón vôi
tags: term, ph, soil

pH đất đo độ chua theo thang logarit: pH 7 là trung tính, dưới 5,5 là chua, trên 7,5 là kiềm; mỗi đơn vị chênh nhau mười lần. pH quyết định rễ hút được chất dinh dưỡng nào. Ở đất chua (dưới khoảng 5,5), nhôm và mangan có thể gây độc, còn lân, canxi và molypden trở nên thiếu, đặc biệt bất lợi cho cây họ đậu như đậu nành và đậu phộng. Mỗi cây có khoảng pH tối ưu (EcoCrop ghi, ví dụ, đậu nành 5,5-6,5). Vôi nông nghiệp nâng pH chậm trong nhiều tháng; lượng bón phụ thuộc thành phần cơ giới và khả năng đệm của đất và phải dựa trên kết quả phân tích đất cùng hướng dẫn địa phương.

## soil-texture
title: Thành phần cơ giới đất và thoát nước
aliases: thành phần cơ giới, sa cấu, đất sét, đất cát, đất thịt, đất nặng, đất nhẹ, thoát nước, ngập úng, úng
tags: term, soil, texture, drainage

Thành phần cơ giới là tỷ lệ cát, thịt (limon) và sét. EcoCrop chia thành đất nặng (nhiều sét), trung bình (đất thịt) và nhẹ (đất cát), cùng đất hữu cơ. Đất nặng giữ nước và dinh dưỡng tốt hơn nhưng thoát nước chậm và dễ úng; đất nhẹ thoát nước nhanh, ấm lên sớm và cần tưới thường xuyên hơn. Cấp thoát nước (kém, tốt, quá mạnh) mô tả tốc độ nước thừa rời khỏi vùng rễ; nhiều cây, gồm phần lớn cây họ đậu và cà phê, chết khi đất úng. Thành phần cơ giới hầu như không thay đổi được; thoát nước có thể cải thiện bằng luống, vồng hoặc rãnh.

## satellite-vs-ground
title: Dữ liệu vệ tinh và số đo mặt đất khác nhau thế nào
aliases: vệ tinh và mặt đất, số đo thực địa, đo tại ruộng, điểm ảnh, độ phân giải, điểm ảnh hỗn hợp, vì sao vệ tinh khác, độ chính xác
tags: term, satellite, ground-truth, resolution

Vệ tinh không đo một thửa ruộng: nó đo một điểm ảnh. Độ ẩm đất SMAP là một giá trị cho ô vuông 9 km, mưa IMERG cho 10 km, thời tiết NASA POWER cho khoảng 50 km, NDVI MODIS cho 250 m, độ cao SRTM cho 30 m. Một thửa 2 ha rộng khoảng 140 m, nên với hầu hết nguồn, thửa ruộng chỉ là phần rất nhỏ của điểm ảnh và giá trị đọc được là trung bình của cả đường sá, rừng, làng và các ruộng khác. Vệ tinh cũng đo gián tiếp (độ sáng vi sóng cho độ ẩm, ánh sáng phản xạ cho độ xanh), vào một giờ nhất định và có độ trễ.

Số đo mặt đất (phân tích đất, thùng đo mưa, máy đo ẩm) là trực tiếp và tại chỗ nhưng chỉ cho một điểm, một thời điểm. Hai loại bổ sung cho nhau: vệ tinh cho độ phủ liên tục, lịch sử và phép so với bình thường; số đo mặt đất cho mức thật của ruộng. Nguyên tắc của Astrovivu là số đo thực địa được ưu tiên: giá trị nông dân nhập vào thay thế ước tính vệ tinh và phần chênh lệch được hiển thị.

## footprint-fit
title: Kích thước điểm ảnh và mức khớp với thửa ruộng
aliases: kích thước điểm ảnh, độ khớp, độ phân giải không gian, quy mô thửa, số điểm ảnh trên thửa
tags: term, resolution, confidence

Astrovivu công bố mức khớp giữa điểm ảnh của mỗi nguồn với thửa ruộng: fit = min(1, √(diện tích thửa) / kích thước điểm ảnh). Thửa 2 ha (√20.000 m² ≈ 141 m) có fit 1,0 với SRTM (30 m), 0,56 với NDVI MODIS (250 m), 0,14 với LST MODIS (1 km) và 0,016 với SMAP (9 km). Lưới từ 1 km trở lên được đọc tại tâm thửa và coi là tín hiệu vùng; lưới 250-500 m dùng điểm ảnh dưới tâm hoặc trung bình các điểm ảnh chạm vào thửa lớn; lưới dưới 100 m dùng thống kê trong đa giác. Mức khớp được đưa vào Huy hiệu Độ tin cậy.

## latency-revisit
title: Chu kỳ lặp, độ trễ và số đo cũ
aliases: độ trễ, chu kỳ lặp, chu kỳ, tổng hợp, số liệu cũ, quá hạn, tuổi số đo, đang chờ
tags: term, latency, confidence

Mỗi nguồn có chu kỳ (bao lâu có một giá trị: hằng ngày, 8 ngày, 16 ngày, hằng tháng) và độ trễ (bao lâu sau khi đo thì được công bố: SMAP cấp 4 hai đến ba ngày, NDVI MODIS một đến hai tuần sau kỳ 16 ngày). Tại mỗi ngày trên dòng thời gian, Astrovivu hiển thị số đo hợp lệ gần nhất của mỗi nguồn vào hoặc trước ngày đó và chỉ giữ nó trong một khoảng chờ (hằng ngày 3 ngày, 8 ngày 12, hằng tuần 10, 16 ngày 24, hằng tháng 45). Quá khoảng đó số đo bị đánh dấu là cũ và độ tin cậy giảm. Những ngày cuối của dòng thời gian, khi nguồn chưa công bố, được vẽ là đang chờ, không phải bằng 0.

## confidence-badge
title: Huy hiệu Độ tin cậy
aliases: huy hiệu độ tin cậy, độ tin cậy, tin được không, cao trung bình thấp, mức tin cậy
tags: term, confidence

Mỗi số đo trong Astrovivu có một Huy hiệu Độ tin cậy cho biết có thể tin nó đến đâu ở quy mô thửa ruộng. Điểm số nhân bốn phần: không gian = 0,30 + 0,70 × √fit (điểm ảnh khớp với thửa đến đâu); độ mới = 1,0 khi số đo còn trong chu kỳ, giảm tuyến tính xuống 0,3 ở mức ba lần chu kỳ; nguồn = 1,00 cho quan trắc và số đo thực địa, 0,75 mô hình, 0,70 dẫn xuất, 0,60 dự báo, 0,30 mô phỏng; chất lượng = 1,00 tốt, 0,85 khá, 0,70 nội suy, 0,50 kém. Mức cao khi từ 0,70, trung bình từ 0,45, thấp khi dưới 0,45. Số đo của nông dân luôn ở mức cao. Trợ lý dùng từ ngữ theo mức: cao "cho thấy", trung bình "gợi ý", thấp "có thể cho thấy, nên kiểm tra tại ruộng".

## provenance
title: Giá trị quan trắc, mô hình, dự báo, dẫn xuất và mô phỏng
aliases: nguồn gốc số liệu, quan trắc, mô hình, tái phân tích, dự báo, dẫn xuất, mô phỏng, ước tính
tags: term, confidence, provenance

Astrovivu ghi rõ cách tạo ra mỗi con số. Quan trắc: số đo vệ tinh (NDVI MODIS, mưa IMERG). Mô hình: tái phân tích hoặc đầu ra mô hình (ERA5, NASA POWER, độ ẩm vùng rễ SMAP cấp 4, SoilGrids). Dự báo: dự đoán tương lai (dự báo 16 ngày Open-Meteo). Dẫn xuất: Astrovivu tính từ các giá trị khác (cân bằng nước, độ lệch). Mô phỏng: giá trị demo dựng cho câu chuyện, luôn được ghi rõ. Số đo thực địa: do nông dân nhập, được ưu tiên hơn tất cả.

## productivity-score
title: Điểm năng suất và yếu tố giới hạn
aliases: điểm năng suất, điểm, năng suất, độ phù hợp, điều kiện sinh trưởng, yếu tố giới hạn, vì sao điểm giảm, điểm giảm, mức phù hợp
tags: term, score

Trung tâm Năng suất hiển thị điểm năng suất 0-100 của thửa tại ngày con trỏ. Khi đã chọn cây, điểm kết hợp độ phù hợp (mức thích hợp tĩnh giữa cây và đất đai từ khí hậu, pH, thành phần cơ giới, thoát nước và các yêu cầu EcoCrop khác) với điều kiện (trạng thái sinh trưởng động: nước, nhiệt, sức sống, stress bốc thoát hơi, ánh sáng). Mỗi yếu tố được chấm 0-1 theo khoảng tối ưu và chịu được của cây; thông tin thiếu được bỏ qua chứ không tính bằng 0. Yếu tố giới hạn là yếu tố kéo điểm xuống nhiều nhất vào ngày đó. Điểm giảm thường do một yếu tố ra khỏi khoảng tối ưu, ví dụ độ ẩm vùng rễ xuống dưới bình thường trong mùa khô; danh sách yếu tố của ngày đó cho biết yếu tố nào.

## ground-truth-override
title: Ghi đè bằng số đo thực địa
aliases: ghi đè, số đo của tôi, phân tích đất, nhập ph, chế độ tưới, hiệu chỉnh
tags: term, ground-truth

Chức năng Ghi đè bằng số đo thực địa cho nông dân nhập những gì họ biết rõ hơn vệ tinh: pH, EC, thành phần cơ giới, thoát nước, độ sâu tầng đất, chế độ tưới, nguồn nước, cây và giống, ngày gieo, độ ẩm đất hoặc lượng mưa đo được, năng suất vụ trước, giá bán và chi phí. Mỗi giá trị nhập thay thế giá trị vệ tinh hoặc mô hình tương ứng trong mọi phép tính, và một ghi chú hiệu chỉnh lưu cả hai giá trị cùng tác động. Độ ẩm hoặc mưa đo được còn tạo hệ số hiệu chỉnh áp dụng cho chuỗi vệ tinh. Tưới đầy đủ loại bỏ lượng mưa khỏi danh sách yếu tố giới hạn.

## crop-rotation-basics
title: Nguyên tắc luân canh cây trồng
aliases: luân canh, luân canh cây trồng, trồng gì tiếp theo, cây luân canh, cây trồng sau, cây cắt vòng sâu bệnh, xen canh
tags: rotation

Luân canh giúp cắt vòng đời sâu bệnh, cân bằng dinh dưỡng và cải thiện cấu trúc đất. Nguyên tắc thường dùng: không trồng tiếp một cây cùng họ hoặc cùng nhóm sâu bệnh (ví dụ cà chua sau khoai tây hoặc cà tím); sau cây hút nhiều đạm (ngô, lúa) nên trồng cây họ đậu (đậu nành, đậu phộng, đậu xanh, đậu đũa) có vi khuẩn nốt sần cố định đạm; xen kẽ cây rễ sâu và rễ nông; và giữ đất được che phủ giữa hai vụ chính bằng cây che phủ. Lựa chọn luân canh còn phải phù hợp nguồn nước và thị trường. Phần tư vấn của Astrovivu so sánh ít nhất ba phương án luân canh, gồm cả phương án hiện tại, kèm bằng chứng, lợi ích, thông tin còn thiếu và rủi ro.

## cover-crop-basics
title: Cây che phủ và phân xanh
aliases: cây che phủ, cây phân xanh, phân xanh, thảm phủ sống, che phủ đất, cây trồng xen che phủ
tags: rotation, cover-crop

Cây che phủ được trồng để bảo vệ và cải tạo đất chứ không phải để bán. Cây che phủ họ đậu (đậu tằm lông, cỏ ba lá, muồng sợi, đậu mèo, đậu ván, cỏ stylo) bổ sung đạm; cỏ và ngũ cốc (lúa mạch đen, yến mạch, cao lương) tạo nhiều sinh khối và giữ lại đạm còn dư; cây họ cải như củ cải phá lớp đất chặt. Cây che phủ giảm xói mòn và cỏ dại, tăng chất hữu cơ, nhưng cũng dùng nước, nên trong mùa khô có thể cạnh tranh với vụ sau. Trong vườn cây lâu năm như cà phê, cây họ đậu thấp hoặc thảm phủ sống giữa hàng đóng vai trò tương tự.

## nasa-sources-summary
title: Astrovivu dùng những nguồn dữ liệu NASA và đối tác nào
aliases: nguồn dữ liệu, vệ tinh nào, nguồn, dữ liệu nasa, bộ dữ liệu, smap, modis, viirs, ecostress, gibs
tags: term, satellite, sources

Astrovivu hợp nhất tám nhánh dữ liệu trên một thửa: độ ẩm đất từ SMAP cấp 4 (9 km, hằng ngày, trễ 2-3 ngày; dự phòng độ ẩm đất mô hình của NASA POWER); thảm thực vật từ NDVI/EVI MODIS MOD13Q1 (250 m, 16 ngày; dự phòng VIIRS VNP13A1); nhiệt bề mặt từ nhiệt độ bề mặt đất MODIS MOD11A2 (1 km, 8 ngày) và stress bốc thoát hơi; lượng mưa từ GPM IMERG (khoảng 10 km, hằng ngày; dự phòng CHIRPS và ERA5); khí tượng nông nghiệp từ NASA POWER (khoảng 50 km); địa hình từ SRTM (30 m); đất từ SoilGrids (250 m; SSURGO ở Hoa Kỳ); và rủi ro thời tiết từ dự báo 16 ngày của Open-Meteo. Lớp bản đồ lấy từ NASA GIBS. Khi nguồn chính lỗi, ứng dụng dùng nguồn kế tiếp và ghi rõ điều đó.
