import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import AppErrorBoundary from './components/AppErrorBoundary';
import './index.css';
import './styles/mobile-system.css';

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </ToastProvider>,
);
