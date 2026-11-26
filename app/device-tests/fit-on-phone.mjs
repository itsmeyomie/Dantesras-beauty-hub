// =====================================================================
// Real-phone check: every staff screen fits the phone width (no sideways
// spill), per role. TEST copy of the app + test database, test logins only.
// Also: a stylist approved while the owner's app is open shows in New booking.
// =====================================================================
import { _android } from 'playwright';
import { mkdirSync } from 'node:fs';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const API = 'http://localhost:54321/rest/v1';
const PW = 'test1234';
const OUT = 'device-tests/shots';
mkdirSync(OUT, { recursive: true });
const [device] = await _android.devices();
if (!device) throw new Error('No phone found (adb devices)');
const results = [];
await device.shell(`am force-stop ${PKG}`);
await device.shell(`pm clear ${PKG}`);
await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
const page = await (await device.webView({ pkg: PKG }, { timeout: 30_000 })).page();
page.setDefaultTimeout(15_000);
await page.waitForTimeout(2000);
const view = () => page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
const shot = async () => {}; // no screenshots: the phone may show private things (calls, chats)
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✔', name); }
  catch (e) { const msg = String(e.message ?? e).split('\n')[0]; results.push({ name, ok: false, err: msg }); console.log('  ✘', name, '–', msg); }
}
async function login(email) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill(email);
  await view().getByTestId('su-password').fill(PW);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await page.waitForTimeout(1200);
}
/** Elements wider than the screen (things that make the page spill sideways). */
const spill = () => page.evaluate(() => {
  const W = window.innerWidth;
  const page = [...document.querySelectorAll('ion-router-outlet .ion-page:not(.ion-page-hidden)')].pop();
  if (!page) return ['no page'];
  const out = [];
  for (const el of page.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
    // inside a box that scrolls sideways on its own (and fits the screen) = fine
    let held = false;
    for (let a = el.parentElement; a && a !== page; a = a.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= W + 2) { held = true; break; }
    }
    if (r.right > W + 2 && !held && !el.closest('.p-chips, ion-segment, .p-scroll-x, [data-scroll-x]')) {
      out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''} → ${Math.round(r.right)}px`);
    }
  }
  return out.slice(0, 5);
});
async function sweep(role, email, urls) {
  console.log(`\n${role.toUpperCase()}`);
  await login(email);
  for (const u of urls) {
    await step(`${role}: ${u} fits the phone`, async () => {
      await page.goto(`${BASE}${u}`);
      await page.waitForTimeout(1800);
      const bad = await spill();
      if (bad.length) { await shot(`SPILL-${role}-${u.replace(/\W+/g, '-')}`); throw new Error(bad.join(' | ')); }
    });
  }
}

console.log('Phone:', device.model());
await sweep('owner', 'owner@dantesras.test', ['/dashboard', '/bookings', '/checkout', '/staff-list', '/more', '/desk', '/sales', '/clients', '/debts', '/services', '/products', '/school', '/staff-requests', '/roles', '/reports', '/settings', '/notifications', '/me']);
await step('owner: Team screen screenshot', async () => {
  await page.goto(`${BASE}/staff-list`);
  await view().getByTestId('team-row').first().waitFor();
  await page.waitForTimeout(1500);
  await shot('fit-team');
});
await step('owner: a stylist approved on another phone shows in New booking', async () => {
  await page.goto(`${BASE}/bookings`);
  await page.waitForTimeout(1500);
  const name = `Phone Joiner ${Date.now().toString(36).slice(-4)}`;
  const email = `${name.replace(/\s/g, '.').toLowerCase()}@gmail.com`;
  const post = (fn, data) => page.request.post(`${API}/rpc/${fn}`, { data });
  await post('staff_signup', { p: { name, email, password: 'secret123', role: 'stylist' } });
  const tok = (await (await post('staff_login', { p_email: 'owner@dantesras.test', p_password: PW })).json()).token;
  const who = (await (await post('staff_requests', { p_token: tok })).json()).find((s) => s.email === email);
  await post('staff_approve', { p_token: tok, p_id: who.id, p_role: 'stylist' });
  await view().locator('ion-header ion-button').filter({ hasText: 'New' }).click();
  await page.waitForTimeout(1200);
  await page.locator('ion-modal.show-modal ion-select').filter({ hasText: 'Stylist' }).first().click();
  await page.locator('ion-alert').filter({ hasText: name }).waitFor();
  await page.waitForTimeout(1200);
  await shot('fit-new-booking-stylists');
  await page.locator('ion-alert button').filter({ hasText: /Cancel/ }).click();
});
await sweep('manager', 'manager@dantesras.test', ['/dashboard', '/bookings', '/staff-list', '/reports']);
await sweep('receptionist', 'reception@dantesras.test', ['/desk', '/bookings', '/checkout', '/clients', '/school']);
await sweep('stylist', 'stylist@dantesras.test', ['/my-day', '/my-calendar', '/checkout', '/my-earnings', '/me']);
await sweep('finisher', 'finisher@dantesras.test', ['/my-day', '/my-earnings']);

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} checks passed on ${device.model()}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAILED:', r.name, '–', r.err);
await device.close();
process.exit(ok === results.length ? 0 : 1);
