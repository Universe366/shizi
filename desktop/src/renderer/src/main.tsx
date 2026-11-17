import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const PetWindow = lazy(() =>
  import('./PetWindow').then((module) => ({ default: module.PetWindow }))
);
const ShotOverlay = lazy(() =>
  import('./ShotOverlay').then((module) => ({ default: module.ShotOverlay }))
);
const DetachedPanel = lazy(() =>
  import('./DetachedPanel').then((module) => ({ default: module.DetachedPanel }))
);

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

const windowKind = new URLSearchParams(window.location.search).get('window');
if (windowKind === 'pet') document.documentElement.classList.add('is-pet-window');
if (windowKind === 'shot') document.documentElement.classList.add('is-shot-window');
if (windowKind === 'panel') document.documentElement.classList.add('is-panel-window');

createRoot(root).render(
  <React.StrictMode>
    {windowKind === 'pet' ? (
      <ErrorBoundary label="桌宠">
        <Suspense fallback={null}>
          <PetWindow />
        </Suspense>
      </ErrorBoundary>
    ) : windowKind === 'shot' ? (
      <ErrorBoundary label="截图">
        <Suspense fallback={null}>
          <ShotOverlay />
        </Suspense>
      </ErrorBoundary>
    ) : windowKind === 'panel' ? (
      <ErrorBoundary label="独立面板">
        <Suspense fallback={null}>
          <DetachedPanel />
        </Suspense>
      </ErrorBoundary>
    ) : (
      <ErrorBoundary label="主界面">
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>
);
