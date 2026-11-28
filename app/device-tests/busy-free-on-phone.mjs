// =====================================================================
// Real-phone check: a stylist shows Booked → In chair → Free again after checkout.
// TEST copy of the app ("Dantesras TEST") against the computer's test database,
// test logins only (local-db/dev-accounts.sql). No screenshots are taken.
//
//   adb reverse tcp:54321 tcp:54321 && node device-tests/busy-free-on-phone.mjs
// =====================================================================
import { _android } from 'playwright';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const API = 'http://localhost:54321/rest/v1';
const PW = 'test1234';
const SLOW = Number(process.env.SLOW ?? 1500);
const results = [];

const [device] = await _android.devices();
if (!device) throw new Error('No phone found (adb devices)');
console.log('Phone:', device.model());

// ----- test database (owner test login) -----
const ownerTok = (await (await fetch(`${API}/rpc/staff_login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_email: 'owner@dantesras.test', p_password: PW }) })).json()).token;
const db = async (path, body, method = 'POST') => {
  const r = await fetch(`${API}/${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-staff-token': ownerTok, Prefer: 'return=representation' }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${t}`);
  return t ? JSON.parse(t) : null;
};

// ----- phone -----
let page;
async function launch() {
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`pm clear ${PKG}`);
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  page = await (await device.webView({ pkg: PKG }, { timeout: 30_000 })).page();
  page.setDefaultTimeout(20_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}
const view = () => page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
const pause = (ms = SLOW) => page.waitForTimeout(ms);
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✔', name); }
  catch (e) { results.push({ name, ok: false }); console.log('  ✘', name, '–', String(e.message ?? e).split('\n')[0]); }
}
async function board() {
  await page.goto(`${BASE}/desk`);
  await view().getByTestId('team-board').waitFor();
  await pause(800);
}
const member = (id) => view().getByTestId(`team-${id}`);
async function expectState(id, state, text) {
  for (let i = 0; i < 20; i++) {
    const s = await member(id).getAttribute('data-state');
    const t = (await member(id).locator('.s').textContent())?.trim();
    if (s === state && t === text) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`expected ${text}, the board shows ${(await member(id).locator('.s').textContent())?.trim()}`);
}

await launch();
let who, bookingId, guest;

await step('owner signs in on the phone (test login)', async () => {
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill('owner@dantesras.test');
  await view().getByTestId('su-password').fill(PW);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await pause();
});

await step('front desk: pick a stylist who is Free now', async () => {
  await board();
  const free = view().locator('.p-team-m[data-state="free"]').filter({ hasNot: page.locator('.f') });
  if (!(await free.count())) throw new Error('nobody is free on the test database right now');
  const tid = await free.first().getAttribute('data-testid');
  who = { id: tid.replace('team-', ''), name: (await free.first().locator('.n').textContent()).trim() };
  console.log('     stylist:', who.name);
  await expectState(who.id, 'free', 'Free');
  await pause();
});

await step('a client is booked with her now → the board shows "Booked"', async () => {
  guest = `Phone test ${Date.now().toString(36).slice(-4)}`;
  const [b] = await db('bookings', { channel: 'salon', status: 'booked', source: 'WhatsApp', duration_min: 60,
    scheduled_at: new Date(Date.now() - 5 * 60000).toISOString(), guest_name: guest });
  bookingId = b.id;
  await db('booking_services', { booking_id: b.id, name: 'Knotless', price: 1600 });
  await db('booking_staff', { booking_id: b.id, staff_id: who.id, part: 'main' });
  await board();
  await expectState(who.id, 'busy', 'Booked');
  await pause(SLOW * 2);
});

await step('the client arrives (Arrived / start) → "In chair"', async () => {
  await db('rpc/start_booking', { p_id: bookingId, p_reason: null });
  await board();
  await expectState(who.id, 'chair', 'In chair');
  await member(who.id).click(); // her day opens under the board
  await view().getByTestId('team-day').waitFor();
  await pause(SLOW * 2);
});

await step('checkout on the phone: Complete sale', async () => {
  await page.goto(`${BASE}/checkout?booking=${bookingId}`);
  const v = view();
  await v.locator('app-payment-entry').first().waitFor();
  await pause();
  const amount = v.locator('app-payment-entry').first().locator('ion-input').filter({ hasText: 'Amount' }).locator('input');
  await amount.fill('1600');
  await amount.dispatchEvent('change');
  await pause();
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await v.getByText('Sale recorded').waitFor();
  await pause(SLOW * 2);
});

await step('after checkout she is "Free" again', async () => {
  await board();
  await expectState(who.id, 'free', 'Free');
  await pause(SLOW * 2);
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed on the phone`);
process.exit(ok === results.length ? 0 : 1);
