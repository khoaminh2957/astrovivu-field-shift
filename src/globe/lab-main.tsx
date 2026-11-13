/** Entry of the stand-alone bench page (see lab.html). Mirrors main.tsx without the app shell. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootFromQuery } from '@/state/mission';
import '@/styles/index.css';
import { GlobeLab } from './GlobeLab';

bootFromQuery(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobeLab />
  </StrictMode>,
);
