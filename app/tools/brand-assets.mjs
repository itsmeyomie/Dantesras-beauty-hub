// Draws the Dantesras app icon, round icon, adaptive-icon foreground, splash screens and the web
// favicon / PWA icon in maroon & gold, by rendering HTML with Playwright's Chromium.
//   node tools/brand-assets.mjs        (run from app/, after `npx cap add android`)
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const font = (f) => pathToFileURL(path.join(app, 'node_modules/@fontsource', f)).href;
const RES = path.join(app, 'android/app/src/main/res');

const css = `
  @font-face { font-family: PF; font-weight: 700; src: url(${font('playfair-display/files/playfair-display-latin-700-normal.woff2')}); }
  @font-face { font-family: IN; font-weight: 500; src: url(${font('inter/files/inter-latin-500-normal.woff2')}); }
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
  .gold { background: linear-gradient(160deg, #f6dc8c 0%, #d9b13e 45%, #a9831c 100%); -webkit-background-clip: text; color: transparent; }
  .bg { background: radial-gradient(circle at 50% 38%, #a3324a 0%, #7b1e2e 48%, #3e0c17 100%); }
`;

// the "D" monogram inside a thin gold ring; size = box edge in px
const monogram = (size) => `
  <div style="position:relative;width:${size}px;height:${size}px">
    <div style="position:absolute;inset:${size * 0.06}px;border-radius:50%;border:${Math.max(1, size * 0.022)}px solid rgba(233,196,92,.85)"></div>
    <div style="position:absolute;inset:${size * 0.115}px;border-radius:50%;border:${Math.max(1, size * 0.008)}px solid rgba(233,196,92,.45)"></div>
    <div class="gold" style="position:absolute;inset:0;display:grid;place-items:center;font:700 ${size * 0.6}px/1 PF;padding-bottom:${size * 0.05}px">D</div>
  </div>`;

const html = {
  square: (s) => `<div class="bg" style="width:${s}px;height:${s}px;display:grid;place-items:center">${monogram(s * 0.86)}</div>`,
  round: (s) => `<div class="bg" style="width:${s}px;height:${s}px;border-radius:50%;display:grid;place-items:center">${monogram(s * 0.86)}</div>`,
  // adaptive foreground: art must sit in the middle 66/108 (launchers crop the rest)
  fore: (s) => `<div style="width:${s}px;height:${s}px;display:grid;place-items:center">${monogram(s * 0.6)}</div>`,
  splash: (w, h) => {
    const m = Math.min(w, h);
    return `<div class="bg" style="width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${m * 0.035}px">
      ${monogram(m * 0.34)}
      <div class="gold" style="font:700 ${m * 0.085}px/1 PF;letter-spacing:.16em;padding-left:.16em">DANTESRAS</div>
      <div style="font:500 ${m * 0.034}px/1.3 IN;color:rgba(255,236,190,.82);letter-spacing:.06em">Beauty Hub · Hair and Beauty School</div>
    </div>`;
  },
};

const size = (file) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(body, w, h, out, transparent = true) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head><style>${css}</style></head><body>${body}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } }));
  console.log('  ✓', path.relative(app, out), `${w}x${h}`);
}

if (existsSync(RES)) {
  for (const dir of readdirSync(RES)) {
    const d = path.join(RES, dir);
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png', 'splash.png']) {
      const file = path.join(d, f);
      if (!existsSync(file)) continue;
      const [w, h] = size(file);
      if (f === 'ic_launcher.png') await render(html.square(w), w, h, file);
      else if (f === 'ic_launcher_round.png') await render(html.round(w), w, h, file);
      else if (f === 'ic_launcher_foreground.png') await render(html.fore(w), w, h, file);
      else await render(html.splash(w, h), w, h, file, false);
    }
  }
  writeFileSync(path.join(RES, 'values/ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7B1E2E</color>\n</resources>\n');
}
// web: favicon and home-screen icon
await render(html.square(512), 512, 512, path.join(app, 'src/assets/icon/icon-512.png'));
await render(html.square(192), 192, 192, path.join(app, 'src/assets/icon/icon-192.png'));
await render(html.round(64), 64, 64, path.join(app, 'src/assets/icon/favicon.png'));
await browser.close();
