# Live run of the generative mode

Written by `npx tsx scripts/rag/live-run.ts` from the transcripts in this folder; do not edit by hand. One file per question of `questions.json`: the question, each function called with its input and result, the answer, the model, the tokens, the time and what the number check found. No key and no header is in any of them.

- Questions: 30 (15 in Vietnamese, 15 in English); with a demo field: 14.
- Asked of the model: 25 (gemini gemini-3.5-flash-lite); answered by the router without the model (declined, or a species the atlas dropped): 5.
- Generated answers given: 25. Extractive answer given in place of a generated one: 0.
- Number check: 25 of 25 answers of the model held only numbers of their sources.
- Function calls: 16 in all, 0 failed; requests to the model: 41.
- Tokens: 314646 in, 19471 out. Time per answer: median 3.4 s, longest 6.2 s.
- Asked between 2026-11-15T08:49:35.621Z and 2026-11-15T08:51:47.846Z.

| # | Lang | Field | Question | Expect | Mode | Functions called | Requests | Tokens in / out | Time | Numbers without a source |
|---|---|---|---|---|---|---|---:|---:|---:|---|
| 01 | vi |  | Việt Nam trồng bao nhiêu lúa, và những nước nào trồng lúa nhiều nhất? | answer | generative |  | 1 | 4462 / 1240 | 3.4 s | none |
| 02 | vi |  | Ở Việt Nam người ta trồng những cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 11186 / 556 | 3.6 s | none |
| 03 | vi |  | Tỉnh Đắk Lắk trồng cây gì nhiều nhất? | answer | generative | cropsInPlace | 2 | 9821 / 574 | 3.4 s | none |
| 04 | vi |  | Việt Nam có trồng sầu riêng không, diện tích bao nhiêu? | answer | generative |  | 1 | 4374 / 453 | 2.2 s | none |
| 05 | vi |  | So sánh yêu cầu của cà phê vối và hồ tiêu. | answer | generative |  | 1 | 4666 / 1410 | 3.7 s | none |
| 06 | vi | daklak-coffee | Tôi nên luân canh thế nào trên thửa này? | answer | generative | rotationOptions | 2 | 21909 / 1202 | 5.7 s | none |
| 07 | vi | daklak-coffee | Đất của tôi có cần bón vôi không? | answer | generative | soilPlan | 2 | 17585 / 934 | 3.9 s | none |
| 08 | vi | daklak-coffee | Trồng sầu riêng ở thửa này được không? | answer | generative | fieldSuitability | 2 | 19266 / 1980 | 6.2 s | none |
| 09 | vi | cantho-rice | Giá lúa tham chiếu và lãi một vụ ở ruộng tôi khoảng bao nhiêu? | answer | generative | priceAndMargin | 2 | 18836 / 302 | 2.1 s | none |
| 10 | vi | cantho-rice | Đất ruộng tôi có bị mặn không? | no-data | generative |  | 1 | 8630 / 533 | 2.4 s | none |
| 11 | vi | cantho-rice | Tháng nào mưa nhiều nhất ở ruộng tôi? | answer | generative |  | 1 | 8704 / 796 | 2.8 s | none |
| 12 | vi | iowa-corn-soy | Tuần tới có sương giá không? | answer | generative |  | 1 | 9055 / 1295 | 4.0 s | none |
| 13 | vi |  | Aibika trồng thế nào? | router | extractive (answered by the router: species not in the atlas) |  | 0 |  |  |  |
| 14 | vi |  | Giá cà phê tuần sau lên hay xuống? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 15 | vi |  | Nên phun thuốc gì và liều bao nhiêu cho bệnh đạo ôn? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 16 | en |  | Where is coffee grown, and how much does Viet Nam grow? | answer | generative |  | 1 | 4260 / 1347 | 4.0 s | none |
| 17 | en |  | What are the main crops of the United States by harvested area? | answer | generative | cropsInPlace | 2 | 12056 / 497 | 3.4 s | none |
| 18 | en |  | What does Iowa grow most? | answer | generative | cropsInPlace | 2 | 10277 / 234 | 2.8 s | none |
| 19 | en |  | Compare maize and soybean: what does each need? | answer | generative | compareCrops | 2 | 10924 / 1145 | 4.7 s | none |
| 20 | en |  | What conditions does quinoa need? | answer | generative |  | 1 | 4561 / 530 | 2.2 s | none |
| 21 | en | iowa-corn-soy | Which rotation would you suggest for this field? | answer | generative | rotationOptions | 2 | 21992 / 1641 | 6.1 s | none |
| 22 | en | iowa-corn-soy | How well does soybean suit this field? | answer | generative | fieldSuitability | 2 | 19376 / 332 | 2.9 s | none |
| 23 | en | iowa-corn-soy | What is the reference price and margin for maize here? | answer | generative | priceAndMargin | 2 | 18944 / 218 | 2.6 s | none |
| 24 | en | nevada-alfalfa | Can I grow rice on this field? | answer | generative | fieldSuitability | 2 | 19569 / 411 | 3.4 s | none |
| 25 | en | nevada-alfalfa | What is my soil pH and where does that number come from? | answer | generative |  | 1 | 8409 / 251 | 1.7 s | none |
| 26 | en | nevada-alfalfa | Should I lime this field? | answer | generative | soilPlan | 2 | 18410 / 673 | 4.0 s | none |
| 27 | en | daklak-coffee | What would a season of quinoa earn on this field? | no-data | generative | priceAndMargin | 2 | 17863 / 632 | 4.1 s | none |
| 28 | en |  | How much durian does Thailand grow? | no-data | generative | whereGrown | 2 | 9511 / 285 | 2.9 s | none |
| 29 | en |  | Can you diagnose this leaf from a photo? | declined | extractive (declined by the router) |  | 0 |  |  |  |
| 30 | en |  | Is it legal to lease farmland to a foreign company? | declined | extractive (declined by the router) |  | 0 |  |  |  |
