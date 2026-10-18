// Entry: draw the page and start following running jobs.
import { createRoot } from 'react-dom/client';
import './fonts/pretendard/pretendard.css';
import './index.css';
import { startWatcher } from './app/api.js';
import { App } from './App.jsx';

try {
  createRoot(document.getElementById('root')).render(<App />);
  startWatcher();
} catch (e) {
  console.error(e);
  const el = document.getElementById('root');
  if (el) el.textContent = '화면을 준비하지 못했습니다. 페이지를 다시 열어 주세요.';
}
