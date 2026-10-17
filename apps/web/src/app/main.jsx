// Entry: draw the page and start following running jobs.
import './react-global.js';
import { startWatcher } from './api.js';
import { App } from './app.jsx';

function start() {
  const el = document.getElementById('al-root');
  window.ReactDOM.createRoot(el).render(<App />);
  startWatcher();
}
try {
  start();
} catch (e) {
  console.error(e);
  const el = document.getElementById('al-root');
  if (el) el.textContent = '화면을 준비하지 못했습니다. 페이지를 다시 열어 주세요.';
}
