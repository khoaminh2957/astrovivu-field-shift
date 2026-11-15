import { describe, expect, it } from 'vitest';
import { parseStep, phaseWithoutField, stepSearch } from './stepUrl';

describe('step address', () => {
  it('names the assistant page, with or without a demo field', () => {
    expect(stepSearch({ phase: 'ask', view: 'farm', sample: null }, '')).toBe('?phase=ask');
    expect(stepSearch({ phase: 'ask', view: 'farm', sample: 'daklak-coffee' }, '?lang=vi')).toBe('?lang=vi&sample=daklak-coffee&phase=ask');
  });

  it('keeps the view for the rotation only and clears the step on the landing', () => {
    expect(stepSearch({ phase: 'advisory', view: 'dossier', sample: 's' }, '?phase=ask')).toBe('?sample=s&phase=advisory&view=dossier');
    expect(stepSearch({ phase: 'locked', view: 'dossier', sample: 's' }, '?view=plan')).toBe('?sample=s&phase=locked');
    expect(stepSearch({ phase: 'hero', view: 'farm', sample: 's' }, '?phase=ask&sample=s&lang=en')).toBe('?lang=en');
  });

  it('reads the assistant page back and drops what it does not know', () => {
    expect(parseStep('?phase=ask')).toEqual({ phase: 'ask', view: null, sample: null });
    expect(parseStep('?sample=s&phase=ask&view=nope')).toEqual({ phase: 'ask', view: null, sample: 's' });
    expect(parseStep('?phase=hero&view=plan')).toEqual({ phase: null, view: 'plan', sample: null });
  });

  it('opens the assistant and the urban page without a field, but not the steps of a field', () => {
    expect(phaseWithoutField('ask')).toBe('ask');
    expect(phaseWithoutField('urban')).toBe('urban');
    expect(phaseWithoutField('advisory')).toBe('explore');
    expect(phaseWithoutField('locked')).toBe('explore');
  });
});
