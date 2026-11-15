import { describe, expect, it } from 'vitest';
import { unsupportedNumbers } from './numberGuard';

const RICE = JSON.stringify({ rows: [{ country: 'India', areaHa: 48106122 }, { country: 'Viet Nam', areaHa: 7089041, rank: 6, sharePct: 43.2 }], source: 'FAOSTAT QCL, 2021-2024' });

describe('numbers written two ways are one number', () => {
  it('reads 7.089.041 and 7,089,041 as the number of the source', () => {
    expect(unsupportedNumbers('Việt Nam thu hoạch 7.089.041 ha lúa.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('Viet Nam harvests 7,089,041 ha of rice.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('Viet Nam harvests 7089041 ha of rice.', [RICE])).toEqual([]);
  });

  it('reads a source written with marks too', () => {
    expect(unsupportedNumbers('7089041 ha', ['Viet Nam: 7,089,041 ha, the 6th largest'])).toEqual([]);
    expect(unsupportedNumbers('1.234.567,89 đồng', ['amount: 1234567.89'])).toEqual([]);
  });

  it('tries both readings of a lone mark before three digits', () => {
    // 6.094 t/ha, and 1,173 USD: a decimal and a thousand.
    expect(unsupportedNumbers('Năng suất 6,094 t/ha.', ['yieldTHa: 6.094'])).toEqual([]);
    expect(unsupportedNumbers('A loss of 1,173 USD/ha.', ['marginLowUsd: -1173'])).toEqual([]);
    expect(unsupportedNumbers('A loss of 1.173 USD/ha.', ['marginLowUsd: -1173'])).toEqual([]);
  });
});

describe('rounding to the digits written', () => {
  it('accepts 6,1 t/ha when the source says 6.094', () => {
    expect(unsupportedNumbers('Năng suất khoảng 6,1 t/ha.', ['{"yieldTHa":6.094}'])).toEqual([]);
    expect(unsupportedNumbers('About 6.1 t/ha.', ['{"yieldTHa":6.094}'])).toEqual([]);
    expect(unsupportedNumbers('About 6 t/ha.', ['{"yieldTHa":6.094}'])).toEqual([]);
  });

  it('refuses a rounding that the digits do not carry', () => {
    expect(unsupportedNumbers('About 6.2 t/ha.', ['{"yieldTHa":6.094}'])).toEqual(['6.2']);
    expect(unsupportedNumbers('Khoảng 170 triệu ha.', ['worldAreaHa: 168793303'])).toEqual(['170']);
  });

  it('accepts a share rounded to a whole percent and a size word', () => {
    expect(unsupportedNumbers('Lúa chiếm 43 % diện tích.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('Việt Nam có khoảng 7,1 triệu ha lúa.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('India has about 48 million ha.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('India has about 50 million ha.', [RICE])).toEqual(['50']);
  });

  it('accepts a whole number rounded to its leading digits, when there are two of them or more', () => {
    expect(unsupportedNumbers('Khoảng 7.100.000 ha.', [RICE])).toEqual([]);
    expect(unsupportedNumbers('About 48,100,000 ha.', [RICE])).toEqual([]);
    // One leading digit is not a rounding anyone can check.
    expect(unsupportedNumbers('About 7,000,000 ha.', [RICE])).toEqual(['7,000,000']);
  });

  it('takes a size word in a source both ways', () => {
    const src = 'cost: 60.5 million VND/ha in a 3 t/ha budget';
    expect(unsupportedNumbers('Chi phí 60,5 triệu đồng/ha.', [src])).toEqual([]);
    expect(unsupportedNumbers('Chi phí 60.500.000 đồng/ha.', [src])).toEqual([]);
  });
});

describe('what is not a number of the answer', () => {
  it('does not count [S2] or [S1, S12]', () => {
    expect(unsupportedNumbers('Đất hơi chua [S2]. Xem thêm [S1, S12].', [])).toEqual([]);
  });

  it('does not count the numbering of a list', () => {
    const answer = ['Ba phương án:', '1. Giữ nguyên.', '2. Thêm cây che phủ.', ' 3) Đổi sang lúa.'].join('\n');
    expect(unsupportedNumbers(answer, [])).toEqual([]);
  });

  it('does not count digits inside a name', () => {
    expect(unsupportedNumbers('Nguồn: ERA5, MOD13Q1, SMAP L4, Sentinel-2 và SoilGrids v2.0.', [])).toEqual([]);
    expect(unsupportedNumbers('N2O và P2O5 không có trong số liệu.', [])).toEqual([]);
  });

  it('takes the digits of a name in a source for the name only', () => {
    const src = 'ph: 5.6 (SoilGrids v2.0, 250 m pixel)';
    // The answer may drop the "v"; it may not turn the version into a quantity.
    expect(unsupportedNumbers('pH 5.6 theo SoilGrids 2.0, ô 250 m.', [src])).toEqual([]);
    expect(unsupportedNumbers('Bón 2 tấn vôi.', [src])).toEqual(['2']);
  });

  it('still counts a number after a range mark', () => {
    expect(unsupportedNumbers('Khoảng 5-95 % là 4.9 đến 6.3.', ['5-95%: 4.9-6.3'])).toEqual([]);
    expect(unsupportedNumbers('pH từ 5-7.', ['ph 5.6'])).toEqual(['5', '7']);
  });
});

describe('numbers of the answer that no source holds', () => {
  it('returns them as written, once each, in order', () => {
    expect(unsupportedNumbers('Bón 2 tấn vôi mỗi ha, rồi 2 tấn nữa sau 30 ngày. pH hiện là 5.6.', ['ph: 5.6 (SoilGrids v2.0, 250 m pixel)'])).toEqual(['2', '30']);
  });

  it('takes a number of the question as given', () => {
    expect(unsupportedNumbers('Với 3 ha như bạn nói, chưa có số liệu về chi phí.', ['Tôi có 3 ha, trồng gì?'])).toEqual([]);
  });

  it('reads the parts of a date', () => {
    expect(unsupportedNumbers('Dự báo đến 21/11/2026.', ['forecast until 2026-11-21'])).toEqual([]);
    expect(unsupportedNumbers('Dự báo đến 22/11/2026.', ['forecast until 2026-11-21'])).toEqual(['22']);
  });

  it('reads "3,5" as three and five when that is what the source holds', () => {
    expect(unsupportedNumbers('Thiếu nước vào tháng 3,5 và 7.', ['months short of water: 3, 5, 7'])).toEqual([]);
  });

  it('does not take "tỉ lệ" for a billion', () => {
    expect(unsupportedNumbers('Đạt 80 tỉ lệ phần trăm.', ['suitability: 80'])).toEqual([]);
    expect(unsupportedNumbers('Doanh thu 80 tỷ đồng.', ['revenue: 80'])).toEqual([]);
  });

  it('finds nothing in an answer without numbers', () => {
    expect(unsupportedNumbers('Chưa có số liệu cho thửa ruộng này.', [])).toEqual([]);
  });
});
