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

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

const windowKind = new URLSearchParams(window.location.search).get('window');
if (windowKind === 'pet') document.documentElement.classList.add('is-pet-window');
if (windowKind === 'shot') document.documentElement.classList.add('is-shot-window');

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
    ) : (
      <ErrorBoundary label="主界面">
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>
);
