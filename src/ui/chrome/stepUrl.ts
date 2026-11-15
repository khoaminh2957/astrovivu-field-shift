/**
 * The address follows the step on screen, so a step can be shared, reloaded and left with the
 * browser's Back button: `?sample=<id>&phase=locked|advisory|urban&view=farm|compare|plan|dossier`.
 *
 * Each move to another step adds one history entry; Back restores the step it names. A field that
 * is not a demo field cannot be named in the address: its steps change the phase and the view only.
 */
import { useEffect } from 'react';
import { type Phase, useMission } from '@/state/mission';
import { ADVISORY_VIEWS, type AdvisoryView, useMissionUi } from './uiState';

const STEP_PHASES: Phase[] = ['locked', 'advisory', 'urban', 'explore'];

interface Step {
  phase: Phase;
  view: AdvisoryView;
  sample: string | null;
}

function stepNow(): Step {
  const m = useMission.getState();
  return { phase: m.phase, view: useMissionUi.getState().advisoryView, sample: m.parcel?.source === 'sample' ? m.parcel.id : null };
}

function urlOf(step: Step): URL {
  const url = new URL(window.location.href);
  for (const key of ['phase', 'view', 'sample']) url.searchParams.delete(key);
  if (step.phase === 'hero') return url;
  if (step.sample) url.searchParams.set('sample', step.sample);
  url.searchParams.set('phase', step.phase);
  if (step.phase === 'advisory') url.searchParams.set('view', step.view);
  return url;
}

export function useStepUrl(): void {
  useEffect(() => {
    let restoring = false;
    const write = () => {
      if (restoring) return;
      const step = stepNow();
      // The landing owns its own address (goLanding clears it); a field still loading has no step yet.
      if (step.phase === 'hero') return;
      const next = urlOf(step);
      if (next.search === window.location.search) return;
      window.history.pushState({ astrovivu: true }, '', next);
    };
    const offMission = useMission.subscribe((s, prev) => {
      if (s.phase !== prev.phase && useMissionUi.getState().workspacePage) useMissionUi.getState().setWorkspacePage(null);
      if (s.phase !== prev.phase || s.parcel?.id !== prev.parcel?.id) write();
    });
    const offUi = useMissionUi.subscribe((s, prev) => {
      if (s.advisoryView !== prev.advisoryView && useMission.getState().phase === 'advisory') write();
    });
    const onPop = () => {
      const q = new URLSearchParams(window.location.search);
      const phase = q.get('phase') as Phase | null;
      const view = q.get('view') as AdvisoryView | null;
      const sample = q.get('sample');
      const m = useMission.getState();
      restoring = true;
      try {
        if (view && ADVISORY_VIEWS.includes(view)) useMissionUi.getState().setAdvisoryView(view);
        if (sample && m.parcel?.id !== sample) {
          void m.lockSample(sample).then(() => {
            if (phase === 'advisory' || phase === 'urban') useMission.getState().setPhase(phase);
          });
        } else if (phase && STEP_PHASES.includes(phase)) {
          // A step that needs a field cannot be restored once the field is closed.
          if ((phase === 'locked' || phase === 'advisory') && !m.parcel) m.setPhase('explore');
          else m.setPhase(phase);
        } else if (!phase && m.phase !== 'hero') {
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
