# Live run of the generative mode

Written by `npx tsx scripts/rag/live-run.ts` from the transcripts in this folder; do not edit by hand. One file per question of `questions.json`: the question, each function called with its input and result, the answer, the model, the tokens, the time and what the number check found. No key and no header is in any of them.

- Questions: 30 (15 in Vietnamese, 15 in English); with a demo field: 14.
- Asked of the model: 25 (gemini gemini-3.5-flash-lite); answered by the router without the model (declined, or a species the atlas dropped): 5.
- Generated answers given: 25. Extractive answer given in place of a generated one: 0.
- Number check: 25 of 25 answers of the model held only numbers of their sources.
- Function calls: 18 in all, 0 failed; requests to the model: 43.
- Tokens: 318594 in, 18423 out. Time per answer: median 3.4 s, longest 6.4 s.
- Asked between 2026-11-15T08:23:12.683Z and 2026-11-15T08:25:23.865Z.

| # | Lang | Field | Question | Expect | Mode | Functions called | Requests | Tokens in / out | Time | Numbers without a source |
|---|---|---|---|---|---|---|---:|---:|---:|---|
| 01 | vi |  | Việt Nam trồng bao nhiêu lúa, và những nước nào trồng lúa nhiều nhất? | answer | generative |  | 1 | 4393 / 1262 | 4.0 s | none |
| 02 | vi |  | Ở Việt Nam người ta trồng những cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 10494 / 958 | 3.7 s | none |
| 03 | vi |  | Tỉnh Đắk Lắk trồng cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 9652 / 283 | 2.6 s | none |
| 04 | vi |  | Việt Nam có trồng sầu riêng không, diện tích bao nhiêu? | no-data | generative | whereGrown | 2 | 8853 / 836 | 4.2 s | none |
| 05 | vi |  | So sánh yêu cầu của cà phê vối và hồ tiêu. | answer | generative |  | 1 | 4597 / 1319 | 3.2 s | none |
| 06 | vi | daklak-coffee | Tôi nên luân canh thế nào trên thửa này? | answer | generative | rotationOptions | 2 | 21793 / 1534 | 6.4 s | none |
| 07 | vi | daklak-coffee | Đất của tôi có cần bón vôi không? | answer | generative | soilPlan | 2 | 17402 / 326 | 2.9 s | none |
| 08 | vi | daklak-coffee | Trồng sầu riêng ở thửa này được không? | answer | generative | fieldSuitability | 2 | 18734 / 1570 | 5.6 s | none |
| 09 | vi | cantho-rice | Giá lúa tham chiếu và lãi một vụ ở ruộng tôi khoảng bao nhiêu? | answer | generative | priceAndMargin | 2 | 18734 / 522 | 3.4 s | none |
| 10 | vi | cantho-rice | Đất ruộng tôi có bị mặn không? | no-data | generative |  | 1 | 8561 / 685 | 3.1 s | none |
| 11 | vi | cantho-rice | Tháng nào mưa nhiều nhất ở ruộng tôi? | answer | generative |  | 1 | 8635 / 1015 | 2.9 s | none |
| 12 | vi | iowa-corn-soy | Tuần tới có sương giá không? | answer | generative |  | 1 | 8986 / 953 | 2.7 s | none |
| 13 | vi |  | Aibika trồng thế nào? | router | extractive (answered by the router: species not in the atlas) |  | 0 |  |  |  |
| 14 | vi |  | Giá cà phê tuần sau lên hay xuống? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 15 | vi |  | Nên phun thuốc gì và liều bao nhiêu cho bệnh đạo ôn? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 16 | en |  | Where is coffee grown, and how much does Viet Nam grow? | answer | generative | whereGrown | 2 | 9285 / 1303 | 5.1 s | none |
| 17 | en |  | What are the main crops of the United States by harvested area? | answer | generative | cropsInPlace | 2 | 9748 / 417 | 2.4 s | none |
| 18 | en |  | What does Iowa grow most? | answer | generative | cropsInPlace | 2 | 10105 / 196 | 2.5 s | none |
| 19 | en |  | Compare maize and soybean: what does each need? | answer | generative | compareCrops | 2 | 10858 / 484 | 3.7 s | none |
| 20 | en |  | What conditions does quinoa need? | answer | generative |  | 1 | 4492 / 617 | 2.8 s | none |
| 21 | en | iowa-corn-soy | Which rotation would you suggest for this field? | answer | generative | rotationOptions | 2 | 21811 / 571 | 3.8 s | none |
| 22 | en | iowa-corn-soy | How well does soybean suit this field? | answer | generative | fieldSuitability | 2 | 19231 / 424 | 3.2 s | none |
| 23 | en | iowa-corn-soy | What is the reference price and margin for maize here? | answer | generative | priceAndMargin | 2 | 18897 / 596 | 3.7 s | none |
| 24 | en | nevada-alfalfa | Can I grow rice on this field? | answer | generative | fieldSuitability | 2 | 19554 / 1029 | 4.6 s | none |
| 25 | en | nevada-alfalfa | What is my soil pH and where does that number come from? | answer | generative |  | 1 | 8340 / 63 | 1.1 s | none |
| 26 | en | nevada-alfalfa | Should I lime this field? | answer | generative | soilPlan | 2 | 18300 / 544 | 3.6 s | none |
| 27 | en | daklak-coffee | What would a season of quinoa earn on this field? | no-data | generative | priceAndMargin | 2 | 17762 / 674 | 3.9 s | none |
| 28 | en |  | How much durian does Thailand grow? | no-data | generative | whereGrown | 2 | 9377 / 242 | 2.0 s | none |
| 29 | en |  | Can you diagnose this leaf from a photo? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 30 | en |  | Is it legal to lease farmland to a foreign company? | declined | extractive (declined by the router) |  | 0 |  |  |  |
