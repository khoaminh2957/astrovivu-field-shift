import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootFromQuery } from './state/mission';
import './styles/index.css';

bootFromQuery(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
