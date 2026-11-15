# Live run of the generative mode

Written by `npx tsx scripts/rag/live-run.ts` from the transcripts in this folder; do not edit by hand. One file per question of `questions.json`: the question, each function called with its input and result, the answer, the model, the tokens, the time and what the number check found. No key and no header is in any of them.

- Questions: 30 (15 in Vietnamese, 15 in English); with a demo field: 14.
- Asked of the model: 25 (gemini gemini-3.5-flash-lite); answered by the router without the model (declined, or a species the atlas dropped): 5.
- Generated answers given: 25. Extractive answer given in place of a generated one: 0.
- Number check: 25 of 25 answers of the model held only numbers of their sources.
- Function calls: 16 in all, 0 failed; requests to the model: 41.
- Tokens: 304007 in, 19767 out. Time per answer: median 3.8 s, longest 6.3 s.
- Asked between 2026-11-15T08:07:26.565Z and 2026-11-15T08:09:41.443Z.

| # | Lang | Field | Question | Expect | Mode | Functions called | Requests | Tokens in / out | Time | Numbers without a source |
|---|---|---|---|---|---|---|---:|---:|---:|---|
| 01 | vi |  | Việt Nam trồng bao nhiêu lúa, và những nước nào trồng lúa nhiều nhất? | answer | generative |  | 1 | 4340 / 1699 | 4.9 s | none |
| 02 | vi |  | Ở Việt Nam người ta trồng những cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 10816 / 1032 | 4.5 s | none |
| 03 | vi |  | Tỉnh Đắk Lắk trồng cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 9654 / 584 | 3.6 s | none |
| 04 | vi |  | Việt Nam có trồng sầu riêng không, diện tích bao nhiêu? | no-data | generative | whereGrown | 2 | 8675 / 678 | 3.8 s | none |
| 05 | vi |  | So sánh yêu cầu của cà phê vối và hồ tiêu. | answer | generative |  | 1 | 4597 / 1728 | 4.0 s | none |
| 06 | vi | daklak-coffee | Tôi nên luân canh thế nào trên thửa này? | answer | generative | rotationOptions | 2 | 21760 / 1458 | 6.3 s | none |
| 07 | vi | daklak-coffee | Đất của tôi có cần bón vôi không? | answer | generative | soilPlan | 2 | 17422 / 416 | 3.6 s | none |
| 08 | vi | daklak-coffee | Trồng sầu riêng ở thửa này được không? | answer | generative | fieldSuitability | 2 | 18697 / 1042 | 5.2 s | none |
| 09 | vi | cantho-rice | Giá lúa tham chiếu và lãi một vụ ở ruộng tôi khoảng bao nhiêu? | answer | generative | priceAndMargin | 2 | 18733 / 439 | 3.5 s | none |
| 10 | vi | cantho-rice | Đất ruộng tôi có bị mặn không? | no-data | generative |  | 1 | 8561 / 454 | 2.4 s | none |
| 11 | vi | cantho-rice | Tháng nào mưa nhiều nhất ở ruộng tôi? | answer | generative |  | 1 | 8635 / 680 | 2.0 s | none |
| 12 | vi | iowa-corn-soy | Tuần tới có sương giá không? | answer | generative |  | 1 | 8986 / 1850 | 4.2 s | none |
| 13 | vi |  | Aibika trồng thế nào? | router | extractive (answered by the router: species not in the atlas) |  | 0 |  |  |  |
| 14 | vi |  | Giá cà phê tuần sau lên hay xuống? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 15 | vi |  | Nên phun thuốc gì và liều bao nhiêu cho bệnh đạo ôn? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 16 | en |  | Where is coffee grown, and how much does Viet Nam grow? | answer | generative |  | 1 | 4140 / 692 | 2.6 s | none |
| 17 | en |  | What are the main crops of the United States by harvested area? | answer | generative | cropsInPlace | 2 | 9703 / 516 | 2.3 s | none |
| 18 | en |  | What does Iowa grow most? | answer | generative | cropsInPlace | 2 | 10135 / 396 | 3.4 s | none |
| 19 | en |  | Compare maize and soybean: what does each need? | answer | generative | compareCrops | 2 | 10847 / 1148 | 5.2 s | none |
| 20 | en |  | What conditions does quinoa need? | answer | generative |  | 1 | 4492 / 1236 | 3.9 s | none |
| 21 | en | iowa-corn-soy | Which rotation would you suggest for this field? | answer | generative | rotationOptions | 2 | 21897 / 543 | 4.0 s | none |
| 22 | en | iowa-corn-soy | How well does soybean suit this field? | answer | generative | fieldSuitability | 2 | 19235 / 820 | 4.0 s | none |
| 23 | en | iowa-corn-soy | What is the reference price and margin for maize here? | answer | generative | priceAndMargin | 2 | 18833 / 244 | 2.0 s | none |
| 24 | en | nevada-alfalfa | Can I grow rice on this field? | answer | generative | fieldSuitability | 2 | 19486 / 694 | 3.8 s | none |
| 25 | en | nevada-alfalfa | What is my soil pH and where does that number come from? | answer | generative |  | 1 | 8340 / 82 | 1.5 s | none |
| 26 | en | nevada-alfalfa | Should I lime this field? | answer | generative |  | 1 | 8826 / 584 | 3.0 s | none |
| 27 | en | daklak-coffee | What would a season of quinoa earn on this field? | no-data | generative | priceAndMargin | 2 | 17829 / 477 | 4.0 s | none |
| 28 | en |  | How much durian does Thailand grow? | no-data | generative | whereGrown | 2 | 9368 / 275 | 3.0 s | none |
| 29 | en |  | Can you diagnose this leaf from a photo? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 30 | en |  | Is it legal to lease farmland to a foreign company? | declined | extractive (declined by the router) |  | 0 |  |  |  |
