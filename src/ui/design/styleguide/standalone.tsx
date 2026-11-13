import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useMission } from '@/state/mission';
import '@/styles/index.css';
import { StyleGuide } from '../StyleGuide';

/** Dev-only entry for standalone.html. `?lang=vi` selects Vietnamese, as in the app. */
const lang = new URLSearchParams(window.location.search).get('lang');
if (lang === 'vi' || lang === 'en') useMission.getState().setLang(lang);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StyleGuide />
  </StrictMode>,
);
