import type { ViewInsets } from '@/contracts';
import type { MissionState } from '@/state/mission';
import { ADD_CARD, NARROW_QUERY, useMissionUi } from './uiState';

interface ShellGeometry {
  width: number;
  height: number;
  narrow: boolean;
  locked: boolean;
  finding: boolean;
  finderH: number;
  addCard: boolean;
  workspaceSplit: number;
  railWidth: number;
}

export function shellInsets({ width, height, narrow, locked, finding, finderH, addCard, workspaceSplit, railWidth }: ShellGeometry): ViewInsets {
  if (locked) {
    if (narrow) {
      const mapHeight = Math.round(height * 0.45);
      return { top: 52, left: 0, right: 56, bottom: height - mapHeight };
    }
    return { top: 96, left: Math.round(width * workspaceSplit / 100), right: 0, bottom: 96 };
  }

  if (finding) {
    const side = narrow ? 0 : 64;
    const left = !narrow && addCard ? ADD_CARD.margin + ADD_CARD.width : side;
    return { top: 12, left, right: side, bottom: (finderH || 150) + 12 };
  }

  if (narrow) {
    const mapHeight = Math.round(height * 0.45);
    return { top: 52, left: 0, right: 56, bottom: height - mapHeight };
  }

  return { top: 56, left: railWidth, right: 64, bottom: 0 };
}

/** Can be called before React commits: phase and parcel already describe the destination. */
export function getShellInsets({ phase, parcel }: Pick<MissionState, 'phase' | 'parcel'>): ViewInsets {
  // Rotation covers the map, but leaving it should reveal the same field framing.
  const locked = !!parcel && (phase === 'locked' || phase === 'advisory');
  const finding = !locked && (phase === 'hero' || phase === 'explore' || !parcel);
  const { finderH, addCard } = useMissionUi.getState();
  const css = getComputedStyle(document.documentElement);
  return shellInsets({
    width: window.innerWidth,
    height: window.innerHeight,
    narrow: window.matchMedia(NARROW_QUERY).matches,
    locked,
    finding,
    finderH,
    addCard,
    workspaceSplit: parseFloat(css.getPropertyValue('--workspace-split')) || 45,
    railWidth: parseFloat(css.getPropertyValue('--rail-w')) || 56,
  });
}
