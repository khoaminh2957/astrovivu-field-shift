import { describe, expect, it } from 'vitest';
import { shellInsets } from './shellInsets';

const desktop = {
  width: 1440,
  height: 900,
  narrow: false,
  locked: true,
  finding: false,
  finderH: 0,
  addCard: false,
  workspaceSplit: 45,
  railWidth: 56,
};

describe('shellInsets', () => {
  it('reserves the final field panel and leaves at least half the desktop for the map', () => {
    const insets = shellInsets(desktop);
    expect(insets).toEqual({ top: 96, left: 648, right: 0, bottom: 96 });
    expect(desktop.width - insets.left - insets.right).toBeGreaterThanOrEqual(desktop.width / 2);
  });

  it('keeps the camera above the mobile field sheet', () => {
    expect(shellInsets({ ...desktop, width: 426, height: 690, narrow: true }))
      .toEqual({ top: 52, left: 0, right: 56, bottom: 379 });
  });

  it('makes space for a pending outline and its confirmation card', () => {
    expect(shellInsets({ ...desktop, locked: false, finding: true, addCard: true, finderH: 162 }))
      .toEqual({ top: 12, left: 376, right: 64, bottom: 174 });
  });
});
