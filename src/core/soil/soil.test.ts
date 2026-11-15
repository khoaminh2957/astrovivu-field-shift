import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldTelemetry, ModelInput } from '@/contracts';
import { getSampleParcel } from '@/data/samples';
import { calculateBufferPhPlan } from './buffer';
import { diagnoseSoil } from './diagnosis';
import { buildSoilPlan } from './plan';

const IDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;
const load = (id: string): FieldTelemetry =>
  JSON.parse(readFileSync(`public/data/samples/${id}.json`, 'utf8')) as FieldTelemetry;

function inputFor(id: string, gt = true): ModelInput {
  const p = getSampleParcel(id)!;
  const dgt = (p as { defaultGroundTruth?: ModelInput['groundTruth'] }).defaultGroundTruth;
  return {
    parcel: p,
    telemetry: load(id),
    cropId: p.defaultCropId,
    groundTruth: gt ? { ...(dgt ?? {}) } : {},
    priorities: ['profit', 'water', 'soil'],
    today: '2026-11-14',
  };
}

describe('Soil diagnosis & management on real sample fields', () => {
  for (const id of IDS) {
    for (const gt of [true, false]) {
      it(`runs pure diagnosis and plan on ${id} (groundTruth: ${gt})`, () => {
        const input = inputFor(id, gt);
        const diag = diagnoseSoil(input);

        expect(diag.fieldId).toBe(input.parcel.id);
        expect(diag.metrics.length).toBeGreaterThanOrEqual(6);
        expect(diag.summary.en && diag.summary.vi).toBeTruthy();

        // Bilingual check
        for (const m of diag.metrics) {
          expect(m.label.en && m.label.vi).toBeTruthy();
          expect(m.note.en && m.note.vi).toBeTruthy();
        }

        const plan = buildSoilPlan(diag, input);
        expect(plan.items.length).toBeGreaterThan(0);
        expect(plan.summary.en && plan.summary.vi).toBeTruthy();

        for (const item of plan.items) {
          expect(item.title.en && item.title.vi).toBeTruthy();
          expect(item.action.en && item.action.vi).toBeTruthy();
          expect(item.timing.en && item.timing.vi).toBeTruthy();
          expect(item.verification.en && item.verification.vi).toBeTruthy();
          for (const ev of item.evidence) {
            expect(ev.label.en && ev.label.vi).toBeTruthy();
            if (typeof ev.value === 'object' && ev.value !== null) {
              expect(ev.value.en && ev.value.vi).toBeTruthy();
            }
          }
        }
      });
    }
  }

  it('Nevada alfalfa: pH 8.8 is reported as outside optimal and limits growth', () => {
    const input = inputFor('nevada-alfalfa', true);
    const diag = diagnoseSoil(input);
    const phMetric = diag.metrics.find((m) => m.key === 'ph');

    expect(phMetric).toBeDefined();
    expect(phMetric?.currentValue).toBe(8.8);
    // Alfalfa optimal is 6.5 - 8.2; 8.8 is reported as outside optimal (tolerable with deficit 0.6)
    expect(['tolerable', 'outside']).toContain(phMetric?.status);
    expect(phMetric?.note.vi).toContain('ngoài khoảng tối ưu');
    expect(phMetric?.note.en).toContain('outside optimal');
    expect(phMetric?.deficit).toBe(0.6);
    expect(phMetric?.isLimiting).toBe(true);
    expect(diag.mostLimitingFactor?.key).toBe('ph');

    const plan = buildSoilPlan(diag, input);
    const phItem = plan.items.find((i) => i.metric === 'ph');
    expect(phItem).toBeDefined();
    expect(phItem?.action.en).toContain('sulfur');
  });

  it('Can Tho rice: salinity and drainage report no_data and trigger "measure first"', () => {
    const input = inputFor('cantho-rice', false); // without ground truth override
    const diag = diagnoseSoil(input);

    const salMetric = diag.metrics.find((m) => m.key === 'salinity');
    expect(salMetric).toBeDefined();
    expect(salMetric?.status).toBe('no_data');

    const drainMetric = diag.metrics.find((m) => m.key === 'drainage');
    expect(drainMetric).toBeDefined();
    expect(drainMetric?.status).toBe('no_data');

    const plan = buildSoilPlan(diag, input);
    const salItem = plan.items.find((i) => i.metric === 'salinity');
    expect(salItem).toBeDefined();
    expect(salItem?.status).toBe('no_data');
    expect(salItem?.rateRange).toBeNull();
    expect(salItem?.action.vi).toContain('Lấy mẫu đất');
  });

  it('Buffer capacity: clay soil requires more lime than sandy soil for same pH delta', () => {
    // Fabricate two inputs differing only in texture and CEC
    const base = inputFor('iowa-corn-soy', true);

    const sandyInput: ModelInput = {
      ...base,
      cropId: 'glycine-max', // Soybean (opt pH 6.0 - 7.0)
      groundTruth: { ph: 5.0, texture: 'light' },
    };

    const clayInput: ModelInput = {
      ...base,
      cropId: 'glycine-max',
      groundTruth: { ph: 5.0, texture: 'heavy' },
    };

    const sandyPlan = calculateBufferPhPlan(sandyInput);
    const clayPlan = calculateBufferPhPlan(clayInput);

    expect(sandyPlan?.amendment).toBe('lime');
    expect(clayPlan?.amendment).toBe('lime');
    expect(sandyPlan?.rateTHa).not.toBeNull();
    expect(clayPlan?.rateTHa).not.toBeNull();

    // Clay buffer capacity requires significantly higher lime than sandy soil
    expect(clayPlan!.rateTHa![1]).toBeGreaterThan(sandyPlan!.rateTHa![1]);
  });
});

