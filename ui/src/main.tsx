import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './live.css';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

// Static replay bundle (make replay): land on the recording, there is no backend.
if (import.meta.env.VITE_REPLAY_ONLY && !location.hash) location.hash = '#/replay';

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
