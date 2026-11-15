/**
 * The address follows the step on screen, so a step can be shared, reloaded and left with the
 * browser's Back button: `?sample=<id>&phase=locked|advisory|urban|ask&view=farm|compare|plan|dossier`.
 *
 * Each move to another step adds one history entry; Back restores the step it names. A field that
 * is not a demo field cannot be named in the address: its steps change the phase and the view only.
 */
import { useEffect } from 'react';
import { type Phase, useMission } from '@/state/mission';
import { ADVISORY_VIEWS, type AdvisoryView, useMissionUi } from './uiState';

export const STEP_PHASES: Phase[] = ['locked', 'advisory', 'urban', 'ask', 'explore'];
/** Pages that stand on their own: they open with or without a field. */
const FIELDLESS: Phase[] = ['urban', 'ask', 'explore'];

export interface Step {
  phase: Phase;
  view: AdvisoryView;
  sample: string | null;
}

function stepNow(): Step {
  const m = useMission.getState();
  return { phase: m.phase, view: useMissionUi.getState().advisoryView, sample: m.parcel?.source === 'sample' ? m.parcel.id : null };
}

/** The query string that names `step`, keeping any other parameter of `search` (lang, crop). */
export function stepSearch(step: Step, search: string): string {
  const q = new URLSearchParams(search);
  for (const key of ['phase', 'view', 'sample']) q.delete(key);
  if (step.phase !== 'hero') {
    if (step.sample) q.set('sample', step.sample);
    q.set('phase', step.phase);
    if (step.phase === 'advisory') q.set('view', step.view);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** What a query string asks for; anything unknown is dropped. */
export function parseStep(search: string): { phase: Phase | null; view: AdvisoryView | null; sample: string | null } {
  const q = new URLSearchParams(search);
  const phase = q.get('phase') as Phase | null;
  const view = q.get('view') as AdvisoryView | null;
  return {
    phase: phase && STEP_PHASES.includes(phase) ? phase : null,
    view: view && ADVISORY_VIEWS.includes(view) ? view : null,
    sample: q.get('sample'),
  };
}

/** The phase to show for `phase` when no field is open: a step of a field falls back to the map. */
export function phaseWithoutField(phase: Phase): Phase {
  return FIELDLESS.includes(phase) ? phase : 'explore';
}

export function useStepUrl(): void {
  useEffect(() => {
    let restoring = false;
    const write = () => {
      if (restoring) return;
      const step = stepNow();
      // The landing owns its own address (goLanding clears it); a field still loading has no step yet.
      if (step.phase === 'hero') return;
      const next = stepSearch(step, window.location.search);
      if (next === window.location.search) return;
      const url = new URL(window.location.href);
      url.search = next;
      window.history.pushState({ astrovivu: true }, '', url);
    };
    const offMission = useMission.subscribe((s, prev) => {
      if (s.phase !== prev.phase || s.parcel?.id !== prev.parcel?.id) write();
    });
    const offUi = useMissionUi.subscribe((s, prev) => {
      if (s.advisoryView !== prev.advisoryView && useMission.getState().phase === 'advisory') write();
    });
    const onPop = () => {
      const { phase, view, sample } = parseStep(window.location.search);
      const m = useMission.getState();
      restoring = true;
      try {
        if (view) useMissionUi.getState().setAdvisoryView(view);
        if (sample && m.parcel?.id !== sample) {
          void m.lockSample(sample).then(() => {
            if (phase === 'advisory' || phase === 'urban' || phase === 'ask') useMission.getState().setPhase(phase);
          });
        } else if (phase) {
          // A step that needs a field cannot be restored once the field is closed.
          m.setPhase(m.parcel ? phase : phaseWithoutField(phase));
        } else if (m.phase !== 'hero') {
          m.setPhase(m.parcel ? 'locked' : 'explore');
        }
      } finally {
        restoring = false;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      offMission();
      offUi();
      window.removeEventListener('popstate', onPop);
    };
  }, []);
}
