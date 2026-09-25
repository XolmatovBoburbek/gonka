// Процедурная модель аниме-карта и чиби-пилота: лицо рисуется на canvas (глаза с бликами, румянец, эмоции),
// волосы из сужающихся прядей, хвостики и шарф качаются от ускорений.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon, outlineGeometry, outlineMaterial, glow, softCircleTexture, paint, normalizeGeometry } from '../world/toon.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { taperedTube, limb, rod, onSphere, PartBuilder } from '../world/geom.js';

const OUTLINE = 0x1b1024;

// ---------------------------------------------------------------- лицо
function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k < 0) c.lerp(new THREE.Color(0x000000), -k);
  else c.lerp(new THREE.Color(0xffffff), k);
  return '#' + c.getHexString();
}

function ellipse(g, x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  g.fill();
}

/**
 * Рисует аниме-лицо. (cx, cy) — центр лица, s — масштаб (ширина глаза ~ 0.1*s).
 * expr: normal | blink | happy | hurt | determined
 */
export function drawFace(g, cx, cy, s, char, expr = 'normal') {
  const eyeDX = s * 0.2;
  const eyeW = s * 0.085;
  const eyeH = s * 0.12;
  const ink = '#2a1622';

  // румянец
  g.fillStyle = 'rgba(255,110,140,0.38)';
  ellipse(g, cx - s * 0.3, cy + s * 0.17, s * 0.085, s * 0.045);
  ellipse(g, cx + s * 0.3, cy + s * 0.17, s * 0.085, s * 0.045);
  g.strokeStyle = 'rgba(230,80,110,0.55)';
  g.lineWidth = s * 0.012;
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const bx = cx + side * s * 0.3 + k * s * 0.035;
      g.beginPath();
      g.moveTo(bx - s * 0.012, cy + s * 0.19);
      g.lineTo(bx + s * 0.012, cy + s * 0.145);
      g.stroke();
    }
  }

  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDX;
    const ey = cy;
    if (expr === 'happy' || expr === 'blink') {
      g.strokeStyle = ink;
      g.lineWidth = s * 0.034;
      g.beginPath();
      if (expr === 'happy') {
        g.moveTo(ex - eyeW * 1.05, ey + eyeH * 0.15);
        g.quadraticCurveTo(ex, ey - eyeH * 0.95, ex + eyeW * 1.05, ey + eyeH * 0.15);
      } else {
        g.moveTo(ex - eyeW * 1.05, ey + eyeH * 0.05);
        g.quadraticCurveTo(ex, ey + eyeH * 0.45, ex + eyeW * 1.05, ey + eyeH * 0.05);
      }
      g.stroke();
      continue;
    }
    if (expr === 'hurt') {
      g.strokeStyle = ink;
      g.lineWidth = s * 0.034;
      g.beginPath();
      const d = side;
      g.moveTo(ex - d * eyeW * 0.9, ey - eyeH * 0.6);
      g.lineTo(ex + d * eyeW * 0.8, ey);
      g.lineTo(ex - d * eyeW * 0.9, ey + eyeH * 0.6);
      g.stroke();
      continue;
    }
    // белок
    g.fillStyle = '#ffffff';
    ellipse(g, ex, ey + eyeH * 0.05, eyeW * 1.02, eyeH * 1.0);
    // радужка с градиентом
    const grd = g.createLinearGradient(ex, ey - eyeH, ex, ey + eyeH);
    grd.addColorStop(0, shade(char.eyes, -0.55));
    grd.addColorStop(0.45, char.eyes);
    grd.addColorStop(1, shade(char.eyes, 0.55));
    g.fillStyle = grd;
    ellipse(g, ex, ey + eyeH * 0.12, eyeW * 0.84, eyeH * 0.9);
    // зрачок
    g.fillStyle = shade(char.eyes, -0.75);
    ellipse(g, ex, ey + eyeH * 0.12, eyeW * 0.4, eyeH * 0.5);
    // кольцо-подсветка снизу
    g.fillStyle = shade(char.eyes, 0.7);
    ellipse(g, ex, ey + eyeH * 0.68, eyeW * 0.5, eyeH * 0.12);
    // блики
    g.fillStyle = '#ffffff';
    ellipse(g, ex - eyeW * 0.35, ey - eyeH * 0.32, eyeW * 0.34, eyeH * 0.26, -0.3);
    ellipse(g, ex + eyeW * 0.38, ey + eyeH * 0.38, eyeW * 0.15, eyeH * 0.1);
    // верхнее веко: толстая линия с "хвостиком" наружу
    g.strokeStyle = ink;
    g.lineWidth = s * (expr === 'determined' ? 0.05 : 0.042);
    g.beginPath();
    const topY = ey - eyeH * (expr === 'determined' ? 0.62 : 0.86);
    g.moveTo(ex - side * eyeW * 1.12, ey - eyeH * 0.38);
    g.quadraticCurveTo(ex - side * eyeW * 0.2, topY - eyeH * 0.32, ex + side * eyeW * 1.05, topY + eyeH * 0.12);
    g.lineTo(ex + side * eyeW * 1.38, topY + eyeH * 0.02);
    g.stroke();
    if (expr === 'determined') {
      g.fillStyle = char.skin;
      g.beginPath();
      g.moveTo(ex - eyeW * 1.3, ey - eyeH * 1.4);
      g.lineTo(ex + eyeW * 1.3, ey - eyeH * 1.4);
      g.lineTo(ex + side * eyeW * 1.2, topY - eyeH * 0.1);
      g.lineTo(ex - side * eyeW * 1.2, ey - eyeH * 0.6);
      g.closePath();
      g.fill();
    }
    // нижнее веко
    g.lineWidth = s * 0.014;
    g.beginPath();
    g.moveTo(ex - eyeW * 0.55, ey + eyeH * 1.02);
    g.quadraticCurveTo(ex, ey + eyeH * 1.1, ex + eyeW * 0.55, ey + eyeH * 1.02);
    g.stroke();
    // бровь
    g.strokeStyle = shade(char.hair, -0.35);
    g.lineWidth = s * 0.02;
    g.beginPath();
    const by = ey - eyeH * (expr === 'determined' ? 1.25 : 1.55);
    if (expr === 'determined') {
      g.moveTo(ex - side * eyeW * 0.9, by - eyeH * 0.25);
      g.lineTo(ex + side * eyeW * 0.9, by + eyeH * 0.2);
    } else {
      g.moveTo(ex - eyeW * 0.8, by + eyeH * 0.1);
      g.quadraticCurveTo(ex, by - eyeH * 0.2, ex + eyeW * 0.8, by + eyeH * 0.1);
    }
    g.stroke();
  }

  // нос — крошечный штрих
  g.strokeStyle = 'rgba(200,110,110,0.7)';
  g.lineWidth = s * 0.012;
  g.beginPath();
  g.moveTo(cx + s * 0.005, cy + s * 0.12);
  g.lineTo(cx - s * 0.01, cy + s * 0.14);
  g.stroke();

  // рот
  const my = cy + s * 0.24;
  g.strokeStyle = ink;
  g.lineWidth = s * 0.018;
  if (expr === 'happy') {
    g.fillStyle = '#8a2a3a';
    g.beginPath();
    g.moveTo(cx - s * 0.075, my - s * 0.015);
    g.quadraticCurveTo(cx, my - s * 0.03, cx + s * 0.075, my - s * 0.015);
    g.quadraticCurveTo(cx, my + s * 0.11, cx - s * 0.075, my - s * 0.015);
    g.fill();
    g.fillStyle = '#ff8a9a';
    ellipse(g, cx, my + s * 0.045, s * 0.035, s * 0.02);
    g.stroke();
  } else if (expr === 'hurt') {
    g.fillStyle = '#8a2a3a';
    ellipse(g, cx, my + s * 0.01, s * 0.03, s * 0.04);
  } else if (expr === 'determined') {
    g.beginPath();
    g.moveTo(cx - s * 0.05, my);
    g.lineTo(cx + s * 0.05, my - s * 0.005);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(cx - s * 0.045, my - s * 0.005);
    g.quadraticCurveTo(cx, my + s * 0.035, cx + s * 0.045, my - s * 0.005);
    g.stroke();
  }
}

const faceCache = new Map();

/** Текстура лица для сферы головы (эквиректангулярная развёртка, лицо в u = 0.25). */
export function faceTexture(char, expr = 'normal') {
  const key = char.id + ':' + expr;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = char.skin;
  g.fillRect(0, 0, W, H);
  // лёгкая тень под волосами у лба
  const sh = g.createLinearGradient(0, 0, 0, H * 0.45);
  sh.addColorStop(0, shade(char.skin, -0.12));
  sh.addColorStop(1, char.skin);
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H * 0.45);
  drawFace(g, W * 0.25, H * 0.56, W * 0.26, char, expr);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  return tex;
}

function emblemTexture(char) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = char.kartAccent;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#1b1024';
  g.stroke();
  g.fillStyle = char.kart;
  g.font = `900 ${S * 0.58}px "M PLUS Rounded 1c", "Hiragino Sans", "Noto Sans JP", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(char.emblem || '★', S / 2, S / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- общие материалы
let shared = null;
function sharedMats() {
  if (shared) return shared;
  shared = {
    dark: toon(0x2c2a36),
    tire: toon(0x24222b, { ramp: 'hard' }),
    metal: toon(0xd4d9e4, { rim: 0.3 }),
    headlight: glow(0xfff4c8, 2.2),
    tail: glow(0xff3050, 2.4),
    white: toon(0xffffff),
    blush: toon(0xff9fb0),
    glass: glow(0xffb040, 1.8),
    shadow: new THREE.MeshBasicMaterial({
      map: softCircleTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    flame: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff9a3c).multiplyScalar(3),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    flameCore: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xfff2c0).multiplyScalar(3.5),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
  return shared;
}

// ---------------------------------------------------------------- колёса
function wheelGeometry(r, w) {
  const pts = [
    [0.5 * r, -w / 2],
    [0.84 * r, -w / 2],
    [0.97 * r, -w * 0.42],
    [r, -w * 0.26],
    [r, w * 0.26],
    [0.97 * r, w * 0.42],
    [0.84 * r, w / 2],
    [0.5 * r, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(pts, 22);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.56 * r, 0.56 * r, w * 0.86, 16);
  hub.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(0.2 * r, 0.24 * r, w * 1.02, 10);
  cap.rotateZ(Math.PI / 2);
  return { tire, hub, cap };
}

// ---------------------------------------------------------------- волосы
function buildHair(char, pb, head) {
  const R = 0.38; // радиус головы
  const HR = R * 1.07;
  const c = [0, 0, 0];

  // основа: шапка сверху + затылок
  const cap = new THREE.SphereGeometry(HR, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.4);
  pb.add('hair', cap);
  const backDepth = char.style === 'bob' ? 0.74 : char.style === 'long' ? 0.8 : 0.66;
  const back = new THREE.SphereGeometry(HR * 1.01, 28, 14, Math.PI * 0.82, Math.PI * 1.36, Math.PI * 0.3, Math.PI * (backDepth - 0.3));
  pb.add('hair', back);

  const lock = (theta0, phi0, theta1, phi1, r0, rOut = 1.1, bulge = 1.0) => {
    const a = onSphere(HR * 0.96, theta0, phi0, c);
    const m = onSphere(HR * (1.03 + 0.05 * bulge), (theta0 + theta1) / 2, (phi0 + phi1) / 2, c);
    const b = onSphere(HR * rOut, theta1, phi1, c);
    return taperedTube([a, m, b], (t) => r0 * Math.pow(1 - t, 0.85) + 0.004, 7, 10);
  };

  // чёлка — треугольные пряди над глазами
  const bangs = char.style === 'spikyUp' ? 4 : 6;
  for (let i = 0; i < bangs; i++) {
    const t = i / (bangs - 1) - 0.5;
    const phi = Math.PI * 0.5 + t * Math.PI * 0.62;
    const len = 0.46 + (1 - Math.abs(t) * 1.6) * 0.07 + (i % 2) * 0.025;
    pb.add('hair', lock(Math.PI * 0.16, phi, Math.PI * len, phi + t * 0.12, 0.11, 1.06));
  }
  // пряди у висков
  for (const side of [-1, 1]) {
    const phi = Math.PI * 0.5 + side * Math.PI * 0.36;
    pb.add('hair', lock(Math.PI * 0.3, phi, Math.PI * 0.7, phi + side * 0.05, 0.1, 1.08));
  }

  const swing = [];
  const style = char.style;
  if (style === 'spiky' || style === 'spikyUp' || style === 'messy') {
    const n = style === 'messy' ? 11 : 8;
    for (let i = 0; i < n; i++) {
      const phi = Math.PI * (0.95 + (i / (n - 1)) * 1.1);
      const theta = style === 'spikyUp' ? Math.PI * (0.12 + (i % 3) * 0.1) : Math.PI * (0.22 + (i % 3) * 0.12);
      const base = onSphere(HR * 0.92, theta, phi, c);
      const out = onSphere(1, theta, phi, [0, 0, 0]);
      const dir = out.clone();
      if (style === 'spikyUp') dir.y += 0.9;
      dir.z -= 0.6;
      if (style === 'messy') dir.add(new THREE.Vector3(Math.sin(i * 7.1) * 0.5, Math.cos(i * 3.3) * 0.4, 0));
      dir.normalize();
      const len = style === 'spikyUp' ? 0.42 + (i % 2) * 0.12 : style === 'messy' ? 0.26 + (i % 3) * 0.05 : 0.36 + (i % 2) * 0.1;
      const mid = base.clone().addScaledVector(out, len * 0.45).addScaledVector(dir, len * 0.2);
      const tip = base.clone().addScaledVector(dir, len).addScaledVector(out, len * 0.25);
      pb.add('hair', taperedTube([base, mid, tip], (t) => 0.12 * Math.pow(1 - t, 0.9) + 0.004, 7, 8));
    }
  }
  if (style === 'medium' || style === 'long' || style === 'bob') {
    // пряди по контуру затылка
    const n = 7;
    for (let i = 0; i < n; i++) {
      const phi = Math.PI * (1.05 + (i / (n - 1)) * 0.9);
      const theta0 = Math.PI * 0.5;
      const theta1 = Math.PI * (style === 'long' ? 0.95 : style === 'bob' ? 0.8 : 0.78);
      pb.add('hair', lock(theta0, phi, theta1, phi, 0.13, style === 'long' ? 1.25 : 1.12, 1.4));
    }
  }
  if (style === 'long') {
    // длинные волосы по спине
    const g = new THREE.CapsuleGeometry(0.3, 0.55, 6, 16);
    g.scale(1.15, 1, 0.5);
    g.translate(0, -0.52, -0.22);
    pb.add('hair', g);
    for (const side of [-1, 1]) {
      const phi = Math.PI * 0.5 + side * Math.PI * 0.42;
      pb.add('hair', lock(Math.PI * 0.35, phi, Math.PI * 0.86, phi, 0.1, 1.12));
    }
  }
  if (style === 'bob') {
    for (const side of [-1, 1]) {
      const phi = Math.PI * 0.5 + side * Math.PI * 0.44;
      pb.add('hair', lock(Math.PI * 0.32, phi, Math.PI * 0.72, phi + side * 0.1, 0.14, 1.12, 1.5));
    }
  }
  if (char.catEars) {
    for (const side of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.17, 0.34, 4, 1);
      ear.rotateY(Math.PI / 4);
      ear.scale(1, 1, 0.55);
      ear.rotateZ(-side * 0.45);
      ear.translate(side * 0.25, 0.42, -0.03);
      pb.add('hair', ear);
      const inner = new THREE.ConeGeometry(0.1, 0.21, 4, 1);
      inner.rotateY(Math.PI / 4);
      inner.scale(1, 1, 0.4);
      inner.rotateZ(-side * 0.45);
      inner.translate(side * 0.245, 0.4, 0.03);
      pb.add('blush', inner);
    }
  }
  if (char.ahoge) {
    const a = new THREE.Vector3(0, HR * 0.98, 0.02);
    pb.add(
      'hair',
      taperedTube([a, new THREE.Vector3(0.03, HR + 0.16, 0.1), new THREE.Vector3(0.1, HR + 0.2, -0.02), new THREE.Vector3(0.12, HR + 0.12, -0.08)], (t) => 0.035 * (1 - t) + 0.004, 6, 12)
    );
  }
  if (char.hairStreak) {
    pb.add('streak', lock(Math.PI * 0.14, Math.PI * 0.62, Math.PI * 0.5, Math.PI * 0.66, 0.12, 1.09));
  }

  // качающиеся хвосты
  if (style === 'twintails') {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.33, 0.16, -0.14);
      const tail = taperedTube(
        [new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * 0.14, -0.08, -0.06), new THREE.Vector3(side * 0.24, -0.42, -0.16), new THREE.Vector3(side * 0.2, -0.85, -0.2)],
        (t) => 0.1 + Math.sin(Math.PI * Math.min(1, t * 1.25)) * 0.07 - t * 0.09,
        9,
        16
      );
      const tie = new THREE.SphereGeometry(0.075, 12, 8);
      swing.push({ pivot, side, geos: { hair: [tail], outfitAccent: [tie] }, amp: 1 });
    }
  }
  if (style === 'ponytail') {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.22, -0.36);
    const tail = taperedTube(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.06, -0.16), new THREE.Vector3(0, -0.22, -0.36), new THREE.Vector3(0, -0.66, -0.42)],
      (t) => 0.11 + Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.07 - t * 0.1,
      9,
      16
    );
    const bowL = new THREE.ConeGeometry(0.09, 0.2, 8);
    bowL.rotateZ(Math.PI / 2);
    bowL.translate(0.1, 0.02, 0);
    const bowR = new THREE.ConeGeometry(0.09, 0.2, 8);
    bowR.rotateZ(-Math.PI / 2);
    bowR.translate(-0.1, 0.02, 0);
    const knot = new THREE.SphereGeometry(0.06, 10, 8);
    swing.push({ pivot, side: 0, geos: { hair: [tail], outfitAccent: [bowL, bowR, knot] }, amp: 1.2 });
  }
  return swing;
}

function buildAccessory(char, pb) {
  const acc = char.accessory;
  if (acc === 'flower') {
    const center = new THREE.Vector3(0.3, 0.22, 0.14);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = new THREE.SphereGeometry(0.055, 8, 6);
      p.scale(1, 1, 0.5);
      p.translate(center.x + 0.02, center.y + Math.cos(a) * 0.06, center.z + Math.sin(a) * 0.06);
      pb.add('white', p);
    }
    const ctr = new THREE.SphereGeometry(0.035, 8, 6);
    ctr.translate(center.x + 0.045, center.y, center.z);
    pb.add('outfitAccent', ctr);
  } else if (acc === 'headphones') {
    const band = new THREE.TorusGeometry(0.43, 0.03, 8, 24, Math.PI);
    band.rotateY(Math.PI / 2);
    band.rotateZ(Math.PI / 2);
    band.rotateZ(-Math.PI / 2);
    band.translate(0, 0.02, -0.02);
    pb.add('outfitAccent', band);
    for (const side of [-1, 1]) {
      const cup = new THREE.CylinderGeometry(0.12, 0.12, 0.09, 16);
      cup.rotateZ(Math.PI / 2);
      cup.translate(side * 0.4, 0.0, -0.02);
      pb.add('outfitAccent', cup);
      const pad = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12);
      pad.rotateZ(Math.PI / 2);
      pad.translate(side * 0.44, 0.0, -0.02);
      pb.add('dark', pad);
    }
  } else if (acc === 'snowclip') {
    const flake = new THREE.OctahedronGeometry(0.08, 0);
    flake.scale(1, 1, 0.4);
    flake.rotateY(Math.PI / 2);
    flake.translate(0.33, 0.2, 0.16);
    pb.add('kartAccent', flake);
    const flake2 = new THREE.OctahedronGeometry(0.05, 0);
    flake2.scale(1, 1, 0.4);
    flake2.rotateY(Math.PI / 2);
    flake2.translate(0.36, 0.1, 0.08);
    pb.add('kartAccent', flake2);
  } else if (acc === 'goggles') {
    const band = new THREE.TorusGeometry(0.41, 0.032, 8, 32);
    band.rotateX(Math.PI / 2 + 0.62);
    band.translate(0, 0.2, -0.04);
    pb.add('dark', band);
    for (const side of [-1, 1]) {
      const lens = new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16);
      lens.rotateX(Math.PI / 2 - 0.95);
      lens.translate(side * 0.12, 0.4, 0.21);
      pb.add('glass', lens);
      const rim = new THREE.TorusGeometry(0.1, 0.022, 6, 16);
      rim.rotateX(-0.95);
      rim.translate(side * 0.12, 0.405, 0.225);
      pb.add('dark', rim);
    }
  } else if (acc === 'band') {
    const band = new THREE.TorusGeometry(0.41, 0.04, 8, 32);
    band.rotateX(Math.PI / 2 + 0.28);
    band.translate(0, 0.1, 0.0);
    pb.add('outfitAccent', band);
    const knot1 = new THREE.ConeGeometry(0.05, 0.22, 6);
    knot1.rotateX(-2.2);
    knot1.translate(0.05, 0.02, -0.46);
    pb.add('outfitAccent', knot1);
    const knot2 = new THREE.ConeGeometry(0.05, 0.2, 6);
    knot2.rotateX(-2.0);
    knot2.rotateZ(0.4);
    knot2.translate(-0.06, 0.0, -0.45);
    pb.add('outfitAccent', knot2);
  }
}

// ---------------------------------------------------------------- шарф
class ScarfRibbon {
  constructor(material, side, length = 0.9, width = 0.13, rows = 10) {
    this.rows = rows;
    this.length = length;
    this.width = width;
    this.side = side;
    const geo = new THREE.PlaneGeometry(width, length, 1, rows);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.phase = Math.random() * 10;
  }
  update(time, speed01, lateral) {
    const pos = this.geo.attributes.position;
    const flow = THREE.MathUtils.clamp(speed01 * 1.2, 0, 1);
    for (let r = 0; r <= this.rows; r++) {
      const s = r / this.rows;
      const L = s * this.length;
      // низкая скорость — свисает, высокая — развевается назад
      const back = -L * (0.25 + 0.75 * flow);
      const down = -L * (1 - flow) * 0.9 - L * 0.15;
      const wave = Math.sin(time * (8 + 6 * flow) - s * 6 + this.phase) * 0.08 * s * (0.3 + flow);
      const wave2 = Math.cos(time * 5 - s * 4 + this.phase) * 0.05 * s;
      for (let c = 0; c < 2; c++) {
        const i = r * 2 + c;
        const x = (c === 0 ? -1 : 1) * this.width * 0.5 + this.side * (0.06 + s * 0.12) + wave2 - lateral * s * 0.3;
        pos.setXYZ(i, x, down + wave, back);
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ---------------------------------------------------------------- модель
export class KartView {
  constructor(char, opts = {}) {
    this.char = char;
    const sm = sharedMats();
    const mats = {
      body: toon(char.kart, { rim: 0.35 }),
      kartAccent: toon(char.kartAccent, { rim: 0.25 }),
      trim: toon(char.trim || char.kartAccent),
      dark: sm.dark,
      tire: sm.tire,
      metal: sm.metal,
      headlight: sm.headlight,
      tail: sm.tail,
      white: sm.white,
      blush: sm.blush,
      glass: sm.glass,
      skin: toon(char.skin, { ramp: 'skin' }),
      hair: toon(char.hair, { rim: 0.45, rimColor: 0xffffff }),
      streak: toon(char.hairStreak || char.hair, { rim: 0.4 }),
      outfit: toon(char.outfit, { rim: 0.2 }),
      outfitAccent: toon(char.outfitAccent || char.kartAccent),
      scarf: toon(char.scarf || char.outfitAccent || '#ffffff', { side: THREE.DoubleSide }),
    };
    this.mats = mats;
    // палитра для слияния деталей в один меш с вершинными цветами (меньше draw calls)
    const pal = {
      body: char.kart,
      kartAccent: char.kartAccent,
      trim: char.trim || char.kartAccent,
      dark: 0x2c2a36,
      tire: 0x24222b,
      metal: 0xd4d9e4,
      white: 0xffffff,
      blush: 0xff9fb0,
      skin: char.skin,
      hair: char.hair,
      streak: char.hairStreak || char.hair,
      outfit: char.outfit,
      outfitAccent: char.outfitAccent || char.kartAccent,
      scarf: char.scarf || char.outfitAccent || '#ffffff',
    };
    this.colorMat = toon(0xffffff, { vertexColors: true, rim: 0.3 });
    this.faces = { normal: faceTexture(char, 'normal'), blink: faceTexture(char, 'blink') };
    this.faceMat = toon(0xffffff, { map: this.faces.normal, ramp: 'skin' });
    this.expr = 'normal';
    this.exprTimer = 0;
    this.blinkTimer = 2 + Math.random() * 3;

    this.root = new THREE.Group(); // позиция/ориентация от физики
    this.root.name = 'kart-' + char.id;
    this.body = new THREE.Group(); // крен, тангаж, подскок, вращение
    this.root.add(this.body);

    // ---- корпус
    const pb = new PartBuilder();
    const rb = (w, h, d, r, pos, rot = null, seg = 3) => {
      const g = new RoundedBoxGeometry(w, h, d, seg, r);
      if (rot) g.rotateX(rot[0] || 0).rotateY(rot[1] || 0).rotateZ(rot[2] || 0);
      g.translate(...pos);
      return g;
    };
    const nose = new THREE.SphereGeometry(1, 24, 14);
    nose.scale(0.5, 0.26, 0.74);
    nose.translate(0, 0.44, 0.78);
    pb.add('body', nose);
    pb.add('body', rb(1.12, 0.36, 1.5, 0.14, [0, 0.43, -0.2]));
    for (const s of [-1, 1]) {
      pb.add('body', rb(0.34, 0.32, 1.08, 0.13, [s * 0.64, 0.4, -0.16]));
      pb.add('trim', rb(0.36, 0.05, 0.9, 0.02, [s * 0.64, 0.575, -0.14]));
    }
    pb.add('body', rb(0.96, 0.44, 0.62, 0.16, [0, 0.63, -0.9]));
    pb.add('trim', rb(0.98, 0.06, 0.4, 0.02, [0, 0.86, -0.92]));
    // полоса по носу
    const stripe = new THREE.SphereGeometry(1, 20, 10, Math.PI * 0.44, Math.PI * 0.12, 0.2, 1.2);
    stripe.scale(0.505, 0.265, 0.745);
    stripe.translate(0, 0.44, 0.78);
    pb.add('kartAccent', stripe);
    // переднее крыло и бампер
    pb.add('kartAccent', rb(1.72, 0.09, 0.36, 0.04, [0, 0.24, 1.3]));
    for (const s of [-1, 1]) pb.add('kartAccent', rb(0.06, 0.2, 0.4, 0.025, [s * 0.86, 0.3, 1.3]));
    pb.add('dark', rb(1.26, 0.1, 2.3, 0.05, [0, 0.2, 0.02]));
    pb.add('dark', rb(1.32, 0.15, 0.16, 0.06, [0, 0.3, -1.24]));
    // сиденье
    pb.add('dark', rb(0.66, 0.66, 0.16, 0.07, [0, 0.86, -0.56], [-0.28, 0, 0]));
    pb.add('dark', rb(0.62, 0.14, 0.52, 0.06, [0, 0.58, -0.32]));
    // антикрыло
    pb.add('kartAccent', rb(1.56, 0.07, 0.4, 0.03, [0, 1.14, -1.14], [0.12, 0, 0]));
    for (const s of [-1, 1]) {
      pb.add('body', rb(0.06, 0.32, 0.46, 0.03, [s * 0.79, 1.08, -1.14]));
      pb.add('dark', rb(0.06, 0.46, 0.1, 0.02, [s * 0.3, 0.9, -1.1]));
    }
    // выхлопные трубы
    for (const s of [-1, 1]) {
      const pipe = new THREE.CylinderGeometry(0.075, 0.095, 0.44, 12, 1, true);
      pipe.rotateX(Math.PI / 2 + 0.38);
      pipe.translate(s * 0.25, 0.62, -1.22);
      pb.add('metal', pipe);
    }
    // руль
    pb.add('dark', rod([0, 0.52, 0.62], [0, 0.84, 0.36], 0.03));
    const wheelRing = new THREE.TorusGeometry(0.17, 0.032, 8, 22);
    wheelRing.rotateX(-0.95);
    wheelRing.translate(0, 0.86, 0.33);
    pb.add('dark', wheelRing);
    // фары и стопы
    for (const s of [-1, 1]) {
      const hl = new THREE.SphereGeometry(0.08, 12, 8);
      hl.scale(1, 0.8, 0.5);
      hl.translate(s * 0.26, 0.5, 1.36);
      pb.add('headlight', hl);
      const tl = new THREE.SphereGeometry(0.06, 10, 6);
      tl.scale(1.3, 0.7, 0.5);
      tl.translate(s * 0.45, 0.62, -1.2);
      pb.add('tail', tl);
    }
    // антенна с талисманом
    pb.add('dark', rod([0.42, 0.85, -1.0], [0.5, 1.7, -1.25], 0.012, 0.008, 5));
    const charm = new THREE.OctahedronGeometry(0.08, 0);
    charm.translate(0.5, 1.74, -1.26);
    pb.add('kartAccent', charm);

    const glowKeys = ['headlight', 'tail'];
    this.body.add(pb.buildColored(pal, this.colorMat, { exclude: glowKeys }));
    const lampGeo = [];
    for (const k of glowKeys) lampGeo.push(paint(pb.merged(k), k === 'headlight' ? 0xfff4c8 : 0xff3050));
    const lamps = new THREE.Mesh(mergeGeometries(lampGeo), new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.4, 2.4) }));
    this.body.add(lamps);
    const chassisOutline = new THREE.Mesh(outlineGeometry(pb.allMerged((k) => !['headlight', 'tail'].includes(k))), outlineMaterial(OUTLINE, 0.035));
    this.body.add(chassisOutline);

    // эмблема на носу
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshToonMaterial({ map: emblemTexture(char), gradientMap: mats.body.gradientMap, transparent: true }));
    emblem.rotation.x = -Math.PI / 2 + 0.42;
    emblem.position.set(0, 0.672, 0.93);
    this.body.add(emblem);

    // ---- колёса
    this.wheels = [];
    const wheelDefs = [
      { x: 0.8, y: 0.3, z: 0.88, r: 0.3, w: 0.26, front: true },
      { x: -0.8, y: 0.3, z: 0.88, r: 0.3, w: 0.26, front: true },
      { x: 0.84, y: 0.36, z: -0.78, r: 0.36, w: 0.34, front: false },
      { x: -0.84, y: 0.36, z: -0.78, r: 0.36, w: 0.34, front: false },
    ];
    for (const wd of wheelDefs) {
      const { tire, hub, cap } = wheelGeometry(wd.r, wd.w);
      const steer = new THREE.Group();
      steer.position.set(wd.x, wd.y, wd.z);
      const spin = new THREE.Group();
      steer.add(spin);
      const wpb = new PartBuilder();
      wpb.add('tire', tire).add('kartAccent', hub).add('metal', cap);
      // спица-маркер, чтобы было видно вращение
      wpb.add('body', new THREE.BoxGeometry(wd.w * 0.9, wd.r * 0.95, 0.07));
      const tm = wpb.buildColored(pal, this.colorMat);
      spin.add(tm);
      spin.add(new THREE.Mesh(outlineGeometry(tire), outlineMaterial(OUTLINE, 0.03)));
      this.body.add(steer);
      this.wheels.push({ steer, spin, r: wd.r, front: wd.front, base: new THREE.Vector3(wd.x, wd.y, wd.z) });
    }

    // ---- пилот
    this.driver = new THREE.Group();
    this.driver.position.set(0, 0, -0.26);
    this.body.add(this.driver);
    const dp = new PartBuilder();
    const torso = new THREE.CapsuleGeometry(0.22, 0.26, 6, 14);
    torso.scale(1.05, 1, 0.9);
    torso.rotateX(-0.18);
    torso.translate(0, 0.98, -0.04);
    dp.add('outfit', torso);
    // молния/полоса на куртке
    const zip = new RoundedBoxGeometry(0.06, 0.34, 0.04, 2, 0.02);
    zip.rotateX(-0.18);
    zip.translate(0, 0.98, 0.18);
    dp.add('outfitAccent', zip);
    const collar = new THREE.TorusGeometry(0.13, 0.05, 8, 18);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 1.2, -0.04);
    dp.add(char.scarf ? 'scarf' : 'outfitAccent', collar);
    // руки
    for (const s of [-1, 1]) {
      dp.add('outfit', limb([s * 0.25, 1.12, -0.02], [s * 0.26, 0.92, 0.26], 0.078));
      dp.add('outfit', limb([s * 0.26, 0.92, 0.26], [s * 0.15, 0.9, 0.56], 0.07));
      const hand = new THREE.SphereGeometry(0.075, 10, 8);
      hand.translate(s * 0.14, 0.9, 0.58);
      dp.add('skin', hand);
      // ноги
      dp.add('dark', limb([s * 0.12, 0.68, 0.02], [s * 0.15, 0.56, 0.62], 0.085));
    }
    const neck = new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10);
    neck.translate(0, 1.24, -0.04);
    dp.add('skin', neck);
    this.driver.add(dp.buildColored(pal, this.colorMat));
    const torsoOutline = new THREE.Mesh(outlineGeometry(dp.allMerged()), outlineMaterial(OUTLINE, 0.028));
    this.driver.add(torsoOutline);

    // голова
    this.head = new THREE.Group();
    this.head.position.set(0, 1.56, -0.02);
    this.driver.add(this.head);
    const headGeo = new THREE.SphereGeometry(0.38, 40, 24);
    headGeo.scale(1, 0.96, 0.98);
    const headMesh = new THREE.Mesh(headGeo, this.faceMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    // уши (кроме кошачьих — у Нэко всё равно человеческие скрыты волосами)
    const hp = new PartBuilder();
    for (const s of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.07, 10, 8);
      ear.scale(0.5, 1, 0.8);
      ear.translate(s * 0.37, -0.02, 0.0);
      hp.add('skin', ear);
    }
    const swing = buildHair(char, hp, this.head);
    buildAccessory(char, hp);
    this.head.add(hp.buildColored(pal, this.colorMat, { exclude: ['glass'] }));
    if (hp.has('glass')) this.head.add(new THREE.Mesh(hp.merged('glass'), mats.glass));
    // один контур на голову + волосы
    const headOl = normalizeGeometry(headGeo.clone());
    const hairOutline = new THREE.Mesh(outlineGeometry(mergeGeometries([headOl, hp.allMerged((k) => k !== 'glass')])), outlineMaterial(OUTLINE, 0.022));
    this.head.add(hairOutline);

    this.swing = [];
    for (const s of swing) {
      const spb = new PartBuilder();
      for (const [k, arr] of Object.entries(s.geos)) for (const g of arr) spb.add(k, g);
      s.pivot.add(spb.buildColored(pal, this.colorMat));
      const ol = new THREE.Mesh(outlineGeometry(spb.allMerged()), outlineMaterial(OUTLINE, 0.022));
      s.pivot.add(ol);
      this.head.add(s.pivot);
      this.swing.push({ pivot: s.pivot, side: s.side, amp: s.amp, rx: 0, rz: 0, vx: 0, vz: 0 });
    }

    // шарф
    this.scarves = [];
    if (char.scarf) {
      const anchor = new THREE.Group();
      anchor.position.set(0, 1.2, -0.16);
      this.driver.add(anchor);
      for (const side of [-1, 1]) {
        const rib = new ScarfRibbon(mats.scarf, side, 0.85, 0.12, 10);
        anchor.add(rib.mesh);
        this.scarves.push(rib);
      }
    }

    // ---- пламя из выхлопа
    this.flames = [];
    for (const s of [-1, 1]) {
      const grp = new THREE.Group();
      grp.position.set(s * 0.25, 0.7, -1.44);
      grp.rotation.x = Math.PI / 2 + 0.38;
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 10, 1, true), sm.flame.clone());
      outer.position.y = -0.33;
      outer.rotation.x = Math.PI;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 8, 1, true), sm.flameCore);
      inner.position.y = -0.2;
      inner.rotation.x = Math.PI;
      grp.add(outer, inner);
      grp.visible = false;
      this.body.add(grp);
      this.flames.push({ grp, outer, inner });
    }

    // ---- мягкая тень (если нет теневых карт)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), sm.shadow);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);

    // точки эмиссии искр дрифта (локальные)
    this.sparkPoints = [new THREE.Vector3(0.84, 0.05, -0.95), new THREE.Vector3(-0.84, 0.05, -0.95)];
    this.exhaustPoints = [new THREE.Vector3(0.25, 0.72, -1.45), new THREE.Vector3(-0.25, 0.72, -1.45)];

    this.time = Math.random() * 10;
    this.wheelAngle = 0;
    this.visSteer = 0;
    this.visDriftYaw = 0;
    this.visLean = 0;
    this.visPitch = 0;
    this.prevSpeed = 0;
    this.accelSm = 0;
    this.latSm = 0;
    this.headYaw = 0;
    this.flicker = 0;

    this.root.traverse((o) => {
      if (o.isMesh && !o.userData.isOutline && o !== this.blob) o.castShadow = o.castShadow || false;
    });
  }

  setShadowMode(realShadows) {
    this.blob.visible = !realShadows;
  }

  setExpression(expr, duration = 0) {
    if (!this.faces[expr]) this.faces[expr] = faceTexture(this.char, expr);
    this.expr = expr;
    this.exprTimer = duration;
    this.faceMat.map = this.faces[expr];
  }

  /**
   * s — визуальное состояние от физики:
   * { speed, maxSpeed, steer, drifting, driftDir, boosting, boostKind, airborne, spin, hop, frozen, lean, dt }
   */
  update(s, dt) {
    this.time += dt;
    const speed01 = THREE.MathUtils.clamp(Math.abs(s.speed) / (s.maxSpeed || 40), 0, 1.4);
    // колёса
    this.wheelAngle += (s.speed / 0.33) * dt;
    this.visSteer = THREE.MathUtils.lerp(this.visSteer, s.steer, 1 - Math.exp(-dt * 12));
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelAngle * (0.33 / w.r);
      if (w.front) w.steer.rotation.y = this.visSteer * 0.42 - (s.drifting ? s.driftDir * 0.25 : 0);
    }
    // ускорение для покачиваний
    const acc = (s.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = s.speed;
    this.accelSm = THREE.MathUtils.lerp(this.accelSm, THREE.MathUtils.clamp(acc / 30, -1, 1), 1 - Math.exp(-dt * 6));
    const lat = s.steer * speed01 + (s.drifting ? s.driftDir * 0.6 : 0);
    this.latSm = THREE.MathUtils.lerp(this.latSm, lat, 1 - Math.exp(-dt * 7));

    // корпус: занос, крен, тангаж
    const driftYaw = s.drifting ? s.driftDir * 0.42 : 0;
    this.visDriftYaw = THREE.MathUtils.lerp(this.visDriftYaw, driftYaw, 1 - Math.exp(-dt * 9));
    this.body.rotation.y = this.visDriftYaw + (s.spin || 0);
    const targetLean = -this.latSm * 0.07;
    this.visLean = THREE.MathUtils.lerp(this.visLean, targetLean, 1 - Math.exp(-dt * 8));
    this.body.rotation.z = this.visLean;
    const targetPitch = -this.accelSm * 0.05 + (s.airborne ? -0.08 : 0);
    this.visPitch = THREE.MathUtils.lerp(this.visPitch, targetPitch, 1 - Math.exp(-dt * 6));
    this.body.rotation.x = this.visPitch + (s.trick ? s.trick : 0);
    this.body.position.y = (s.hop || 0) + Math.sin(this.time * 38) * 0.008 * speed01 + (s.bump || 0);

    // пилот наклоняется в поворот и смотрит туда
    this.driver.rotation.z = this.latSm * 0.16;
    this.driver.rotation.x = -this.accelSm * 0.06;
    this.headYaw = THREE.MathUtils.lerp(this.headYaw, -this.visSteer * 0.35 - (s.drifting ? s.driftDir * 0.2 : 0), 1 - Math.exp(-dt * 6));
    this.head.rotation.y = this.headYaw;
    this.head.rotation.z = this.latSm * 0.08 + Math.sin(this.time * 2.1) * 0.02;
    this.head.position.y = 1.56 + Math.sin(this.time * 3.3) * 0.008;

    // хвосты: пружина от ускорения, поворотов и ветра
    for (const sw of this.swing) {
      const wind = speed01 * 0.9;
      const tx = -wind * 0.75 * sw.amp + this.accelSm * 0.35 + Math.sin(this.time * 9 + sw.side) * 0.08 * wind;
      const tz = this.latSm * 0.45 * sw.amp + Math.sin(this.time * 7 + sw.side * 2) * 0.06 * wind;
      const k = 55;
      const damp = 7;
      sw.vx += (k * (tx - sw.rx) - damp * sw.vx) * dt;
      sw.vz += (k * (tz - sw.rz) - damp * sw.vz) * dt;
      sw.rx += sw.vx * dt;
      sw.rz += sw.vz * dt;
      sw.pivot.rotation.x = sw.rx;
      sw.pivot.rotation.z = sw.rz;
    }
    for (const sc of this.scarves) sc.update(this.time, speed01, this.latSm);

    // пламя
    const boosting = !!s.boosting;
    this.flicker += dt * 40;
    for (const f of this.flames) {
      f.grp.visible = boosting;
      if (boosting) {
        const k = 0.85 + Math.sin(this.flicker + f.grp.position.x * 10) * 0.12 + Math.random() * 0.12;
        const big = s.boostKind === 'item' || s.boostKind === 'pad' ? 1.35 : s.boostKind === 'mini3' ? 1.25 : 1.0;
        f.grp.scale.set(k, k * big, k);
        const col = s.boostKind === 'mini1' ? 0x4aa8ff : s.boostKind === 'mini2' ? 0xff9a3c : s.boostKind === 'mini3' ? 0xff4fd8 : 0xff7a2a;
        f.outer.material.color.setHex(col).multiplyScalar(3);
      }
    }

    // эмоции и моргание
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.setExpression('normal');
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && this.expr === 'normal') {
        this.faceMat.map = this.faces.blink;
        if (this.blinkTimer < -0.12) {
          this.faceMat.map = this.faces.normal;
          this.blinkTimer = 2.5 + Math.random() * 3.5;
        }
      }
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

/** Рендер портрета персонажа в dataURL (для меню). */
export function renderPortrait(renderer, char, size = 256) {
  const scene = new THREE.Scene();
  const view = new KartView(char);
  view.setShadowMode(true);
  view.update({ speed: 0, steer: 0 }, 0.016);
  scene.add(view.root);
  view.root.rotation.y = Math.PI + 0.5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a0c0, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2);
  dl.position.set(2, 3, 4);
  scene.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const headWorld = new THREE.Vector3();
  view.head.getWorldPosition(headWorld);
  cam.position.set(headWorld.x - 1.2, headWorld.y + 0.35, headWorld.z - 2.4);
  cam.lookAt(headWorld.x, headWorld.y - 0.05, headWorld.z);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.setClearColor(0x000000, 1);
  rt.dispose();
  view.dispose();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    img.data.set(px.subarray(src, src + size * 4), y * size * 4);
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
