import './ui/styles.css';
import { Game } from './game.js';

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglOk()) {
  document.getElementById('ui').innerHTML =
    '<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:24px;font:700 20px sans-serif">Ваш браузер не поддерживает WebGL — игра не может запуститься.<br>Попробуйте Chrome, Edge, Firefox или Safari.</div>';
} else {
  const game = new Game(document.getElementById('app'));
  window.__game = game;
  game.start().then(() => {
    window.__ready = true;
  });
}
