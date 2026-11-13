import type { CSSProperties } from 'react';

/** Throwaway styling for the scaffold placeholders. Delete once every area ships its real UI. */
export const box: CSSProperties = {
  position: 'absolute',
  padding: 12,
  border: '1px dashed #3a4656',
  background: 'rgba(10,14,20,0.82)',
  font: '12px/1.5 ui-monospace, monospace',
  color: '#c9d3df',
  zIndex: 10,
};

export const btn: CSSProperties = {
  margin: '2px 4px 2px 0',
  padding: '4px 8px',
  border: '1px solid #4b5a6d',
  background: '#111823',
  color: '#e8ecf1',
  font: 'inherit',
  cursor: 'pointer',
};
