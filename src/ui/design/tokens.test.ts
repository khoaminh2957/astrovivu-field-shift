import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRANCHES } from '@/contracts';
import { BRANCH_HEX, COLOR, contrastRatio, RAMPS, rampColor } from './tokens';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
const cssColor = (name: string): string | undefined => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/(\D)(\d)/, '$1-$2');

describe('design tokens', () => {
  it('tokens.ts mirrors every colour in tokens.css', () => {
    for (const [key, hex] of Object.entries(COLOR)) expect(cssColor(kebab(key)), key).toBe(hex);
    for (const b of BRANCHES) expect(cssColor(`branch-${kebab(b)}`), b).toBe(BRANCH_HEX[b]);
  });

  it('ramp stops match the CSS gradients', () => {
    const gradient = (name: string) => new RegExp(`--ramp-${name}:\\s*linear-gradient\\(90deg, ([^)]+)\\)`).exec(css)?.[1].split(', ');
    expect(gradient('vegetation')).toEqual(RAMPS.vegetation.sequential.stops);
    expect(gradient('moisture')).toEqual(RAMPS.moisture.sequential.stops);
    expect(gradient('heat')).toEqual(RAMPS.heat.sequential.stops);
    expect(gradient('rain')).toEqual(RAMPS.rain.sequential.stops);
    expect(gradient('anomaly-wet')).toEqual(RAMPS.moisture.diverging.stops);
    expect(gradient('anomaly-heat')).toEqual(RAMPS.heat.diverging.stops);
  });

  it('text inks pass WCAG AA on every surface; control edges pass 3:1 on the surfaces controls sit on', () => {
    const surfaces = [COLOR.void, COLOR.surface0, COLOR.surface1, COLOR.surface2, COLOR.surface3, COLOR.inset];
    for (const s of surfaces) for (const ink of [COLOR.ink1, COLOR.ink2, COLOR.ink3]) expect(contrastRatio(ink, s)).toBeGreaterThanOrEqual(4.5);
    for (const s of [COLOR.surface0, COLOR.surface1, COLOR.surface2, COLOR.inset]) expect(contrastRatio(COLOR.line3, s)).toBeGreaterThanOrEqual(3);
    for (const state of [COLOR.nominal, COLOR.watch, COLOR.alert, COLOR.stale, COLOR.simulated]) for (const s of surfaces) expect(contrastRatio(state, s)).toBeGreaterThanOrEqual(4.5);
    // Light theme: white on the green primary meets AA for text (it was 7:1 inverse video on the dark theme).
    expect(contrastRatio(COLOR.onSignal, COLOR.signal)).toBeGreaterThanOrEqual(4.5);
  });

  it('rampColor clamps and spans the ramp', () => {
    expect(rampColor('vegetation', -5, [0, 1])).toBe(rampColor('vegetation', 0, [0, 1]));
    expect(rampColor('vegetation', 9, [0, 1])).toBe(rampColor('vegetation', 1, [0, 1]));
    expect(rampColor('heat', 0, [-2, 2], 'diverging')).toBe('rgb(247, 247, 247)');
  });
});
