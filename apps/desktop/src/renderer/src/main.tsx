import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ClipView } from './views/ClipView';
import './styles.css';

// Clip windows load the same page with `#clip=<id>`.
const clipId = /^#clip=(.+)$/.exec(window.location.hash)?.[1];

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{clipId ? <ClipView clipId={decodeURIComponent(clipId)} /> : <App />}</React.StrictMode>,
);
