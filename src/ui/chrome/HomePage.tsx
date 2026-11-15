import { ArrowRight, Building2, Map as MapIcon, MessageCircleQuestion, RefreshCw } from 'lucide-react';
import { DEMO_FIELD } from '@/data';
import { useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { useMissionUi } from './uiState';
import './workspaceStrings';

const PREVIEWS = [
  { id: 'field', title: 'chrome.nav.field', icon: MapIcon, topics: ['satellite', 'soil', 'timeline'] },
  { id: 'rotation', title: 'chrome.nav.advisory', icon: RefreshCw, topics: ['strategies', 'seasons', 'trade'] },
  { id: 'urban', title: 'chrome.nav.urbanLong', icon: Building2, topics: ['sunlight', 'space', 'planting'] },
  { id: 'ask', title: 'ask.title', icon: MessageCircleQuestion, topics: ['crop', 'fieldContext'] },
] as const;

export function HomePage({ onField, onRotation, onUrban, onAsk }: {
  onField: () => void;
  onRotation: () => void;
  onUrban: () => void;
  onAsk: () => void;
}) {
  const t = useT();
  const hasParcel = useMission((s) => !!s.parcel);
  const showRotation = () => {
    if (hasParcel) return onRotation();
    useMissionUi.getState().setWorkspacePage(null);
    const mission = useMission.getState();
    mission.setAskOpen(false);
    void mission.lockSample(DEMO_FIELD.id);
    mission.setPhase('advisory');
  };

  const actions = { field: onField, rotation: showRotation, urban: onUrban, ask: onAsk };
  const labels = {
    field: hasParcel ? 'workspace.openField' : 'workspace.findField',
    rotation: hasParcel ? 'workspace.openRotation' : 'workspace.rotationSample',
    urban: 'workspace.openUrban',
    ask: 'workspace.openAsk',
  };

  return (
    <main className="workspace-theme workspace-home absolute inset-0 overflow-auto" aria-labelledby="workspace-home-title">
      <div className="workspace-home-inner">
        <h1 id="workspace-home-title" className="workspace-page-title">{t('chrome.nav.home')}</h1>
        <div className="workspace-home-grid">
          {PREVIEWS.map(({ id, title, icon: Icon, topics }) => (
            <article key={id} className="workspace-home-card" aria-labelledby={`home-preview-${id}`}>
              <Icon className="workspace-home-icon" size={22} aria-hidden />
              <h2 id={`home-preview-${id}`} className="workspace-card-title">{t(title)}</h2>
              <p className="workspace-copy">{t(`workspace.${id}Body`)}</p>
              <ul className="workspace-home-topics">
                {topics.map((topic) => <li className="workspace-caption" key={topic}>{t(`workspace.${topic}`)}</li>)}
              </ul>
              <button type="button" className="workspace-home-action" onClick={actions[id]}>
                {t(labels[id])}<ArrowRight size={16} aria-hidden />
              </button>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
