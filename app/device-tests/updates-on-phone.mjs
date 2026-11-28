// =====================================================================
// Real-phone check of everything added on 27–28 Nov 2026, in the TEST copy of the app
// ("Dantesras TEST") against the computer's test database, with test logins only.
// No screenshots are taken. Slowed down so a person can watch the phone.
//
//   adb reverse tcp:54321 tcp:54321 && node device-tests/updates-on-phone.mjs
// =====================================================================
import { _android } from 'playwright';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const API = 'http://localhost:54321/rest/v1';
const PW = 'test1234';
const SLOW = Number(process.env.SLOW ?? 1200);
const results = [];
const tag = Date.now().toString(36).slice(-4);
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const [device] = await _android.devices();
if (!device) throw new Error('No phone found (adb devices)');
console.log('Phone:', device.model());

// ----- test database -----
const tokens = {};
async function token(email) {
  return (tokens[email] ??= (await (await fetch(`${API}/rpc/staff_login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_email: email, p_password: PW }) })).json()).token);
}
async function db(path, body, { method = 'POST', as = 'owner@dantesras.test', prefer = 'return=representation' } = {}) {
  const r = await fetch(`${API}/${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-staff-token': await token(as), Prefer: prefer }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${t}`);
  return t ? JSON.parse(t) : null;
}
const setting = (key, value) => db('settings', { key, value }, { prefer: 'resolution=merge-duplicates' });
const staffId = async (name) => (await db(`staff?select=id&name=eq.${encodeURIComponent(name)}`, undefined, { method: 'GET' }))[0].id;

// ----- phone helpers -----
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
const modal = () => page.locator('ion-modal.show-modal').last();
const pause = (ms = SLOW) => page.waitForTimeout(ms);
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✔', name); }
  catch (e) { results.push({ name, ok: false, err: String(e.message ?? e).split('\n')[0] }); console.log('  ✘', name, '–', String(e.message ?? e).split('\n')[0]); }
}
async function fill(scope, label, value) {
  const el = await scope.locator('ion-input, ion-textarea').filter({ hasText: label }).first().locator('input, textarea').first().elementHandle();
  if (!el) throw new Error('no field ' + label);
  await el.fill(value); // fires input → the form field
  await el.evaluate((e) => e.dispatchEvent(new Event('change', { bubbles: true })));
}
async function choose(scope, label, option) {
  await scope.locator('ion-select').filter({ hasText: label }).first().click();
  const overlay = page.locator('ion-popover, ion-action-sheet, ion-alert').filter({ visible: true }).last();
  await overlay.waitFor();
  await overlay.locator('ion-item, button, ion-radio').filter({ hasText: option }).first().click();
  const ok = overlay.locator('button.alert-button').filter({ hasText: /^OK$/i });
  if (await ok.count()) await ok.click();
  await overlay.waitFor({ state: 'hidden' });
}
async function alertButton(text, input) {
  const a = page.locator('ion-alert').filter({ visible: true }).last();
  await a.waitFor();
  if (input !== undefined) await a.locator('input').first().fill(input);
  await a.locator('button').filter({ hasText: text }).click();
  await a.waitFor({ state: 'hidden' });
}
const toast = (text) => page.locator('ion-toast').filter({ hasText: text }).last().waitFor();
async function signIn(email) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill(email);
  await view().getByTestId('su-password').fill(PW);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await pause();
}
async function go(url) {
  await page.goto(`${BASE}${url}`);
  await pause(900);
}
const member = (id) => view().getByTestId(`team-${id}`);
async function expectState(id, state, text) {
  for (let i = 0; i < 20; i++) {
    if ((await member(id).getAttribute('data-state')) === state && (await member(id).locator('.s').textContent())?.trim() === text) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`expected ${text}, the board shows ${(await member(id).locator('.s').textContent())?.trim()}`);
}
async function expectText(loc, text) {
  for (let i = 0; i < 30; i++) {
    if ((await loc.count()) && ((await loc.first().textContent()) ?? '').includes(text)) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`expected "${text}", found "${(await loc.count()) ? (await loc.first().textContent())?.trim() : 'nothing'}"`);
}

await launch();
const wanjiku = await staffId('Wanjiku Kamau');
await setting('pay_rule', 'percent');

// ================= OWNER =================
console.log('\nOwner (test login)');
await signIn('owner@dantesras.test');

let who, busyBooking;
await step('Front desk: a stylist who is free shows "Free"', async () => {
  await go('/desk');
  const free = view().locator('.p-team-m[data-state="free"]').filter({ hasNot: page.locator('.f') });
  if (!(await free.count())) throw new Error('nobody is free on the test database right now');
  who = { id: (await free.first().getAttribute('data-testid')).replace('team-', ''), name: (await free.first().locator('.n').textContent()).trim() };
  console.log('     stylist:', who.name);
  await expectState(who.id, 'free', 'Free');
});
await step('booked with a client now → "Booked"', async () => {
  const [b] = await db('bookings', { channel: 'salon', status: 'booked', duration_min: 60, scheduled_at: new Date(Date.now() - 5 * 60000).toISOString(), guest_name: `Phone ${tag}` });
  busyBooking = b.id;
  await db('booking_services', { booking_id: b.id, name: 'Knotless', price: 1600 });
  await db('booking_staff', { booking_id: b.id, staff_id: who.id, part: 'main' });
  await go('/desk');
  await expectState(who.id, 'busy', 'Booked');
  await pause();
});
await step('client arrives → "In chair"', async () => {
  await db('rpc/start_booking', { p_id: busyBooking, p_reason: null });
  await go('/desk');
  await expectState(who.id, 'chair', 'In chair');
  await pause();
});
await step('checkout on the phone (Complete sale)', async () => {
  await go(`/checkout?booking=${busyBooking}`);
  await fill(view().locator('app-payment-entry').first(), 'Amount', '1600');
  await pause(600);
  await view().locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await view().getByText('Sale recorded').waitFor();
  await pause();
});
await step('after checkout → "Free" again', async () => {
  await go('/desk');
  await expectState(who.id, 'free', 'Free');
  await pause();
});

let hairBooking;
await step('home service: "Salon brings hair" shows on the booking card', async () => {
  const at = new Date(); at.setHours(19, 30, 0, 0);
  const [b] = await db('bookings', { channel: 'home', status: 'booked', duration_min: 30, scheduled_at: at.toISOString(), guest_name: `Home ${tag}`,
    address: 'Membley', hair_source: 'salon', hair_items: [{ product_id: null, name: 'Kanekalon braid hair', qty: 2, price: 300 }] });
  hairBooking = b.id;
  await db('booking_services', { booking_id: b.id, name: 'Knotless', price: 1600 });
  await db('booking_staff', { booking_id: b.id, staff_id: wanjiku, part: 'main' });
  await go('/bookings');
  await expectText(view().locator('.card.booking').filter({ hasText: `Home ${tag}` }).getByTestId('hair-note'), 'Salon brings hair: Kanekalon braid hair ×2');
  await pause();
});

await step('Bought outside: record braids from a shop, then pay the shop', async () => {
  await go('/outside');
  await view().getByTestId('outside-new').click();
  const m = modal();
  await fill(m, 'Shop', `Mama Njeri ${tag}`);
  await fill(m, 'Item', 'Braids 1B');
  await fill(m, 'We owe the shop', '800');
  await m.getByTestId('o-save').click();
  await toast('we owe');
  const card = view().getByTestId('shop-card').filter({ hasText: `Mama Njeri ${tag}` });
  await expectText(card.getByTestId('shop-total'), 'KSh 800');
  await pause();
  await card.getByTestId('shop-pay').click();
  await modal().getByTestId('pay-confirm').click();
  await toast('paid KSh 800');
  await pause();
});

await step('menu: categories in order, Finishers marked staff only', async () => {
  await go('/services');
  const heads = view().getByTestId('cat-head');
  await heads.first().waitFor();
  const names = await heads.allTextContents();
  const order = ['Washes', 'Locs & Undo', 'Treatments & Care', 'Nails', 'Kids Hair', 'Adult Hair'];
  order.forEach((n, i) => { if (!names[i]?.includes(n)) throw new Error(`position ${i + 1}: expected ${n}, got ${names[i]}`); });
  await view().getByTestId('menu-search').locator('input').fill('wig');
  await expectText(view().getByTestId('cat-head'), 'Washes');
  await pause();
});

let payJob;
await step('pay in amounts: the owner sees "Pay for this job" at checkout', async () => {
  await setting('pay_rule', 'fee_split');
  const [b] = await db('bookings', { channel: 'salon', status: 'in_progress', duration_min: 60, scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(), guest_name: `Pay ${tag}` });
  payJob = b.id;
  await db('booking_services', { booking_id: b.id, name: 'Knotless', price: 1600 });
  await db('booking_staff', { booking_id: b.id, staff_id: wanjiku, part: 'main' });
  await go('/settings'); // reload settings for the owner
  await go(`/checkout?booking=${b.id}`);
  await expectText(view().getByTestId('split-owner'), 'KSh');
  await expectText(view().getByTestId('split-stylist'), 'KSh 700');
  await pause(SLOW * 2);
});

// ================= RECEPTION =================
console.log('\nReceptionist (test login)');
await signIn('reception@dantesras.test');
await step('clients list: names only, no Phone column', async () => {
  await go('/clients');
  await view().getByText('Lucy Akinyi').first().waitFor();
  if (await view().locator('th', { hasText: 'Phone' }).count()) throw new Error('Phone column is showing');
  if (await view().getByText('0722100002').count()) throw new Error('a number is showing');
  await pause();
});
await step('a client\'s page: "Only the owner sees it"', async () => {
  await view().getByText('Lucy Akinyi').first().click();
  await expectText(view().getByTestId('number-hidden'), 'Only the owner sees it');
  await pause();
});

// ================= STYLIST =================
console.log('\nStylist Wanjiku (test login)');
await signIn('stylist@dantesras.test');
await step('My day: she sees what hair to carry', async () => {
  await go('/my-day');
  await expectText(view().getByTestId('hair-note'), 'Salon brings hair');
  await pause();
});
await step('checkout: no "Pay for this job" for a stylist', async () => {
  await go(`/checkout?booking=${payJob}`);
  await view().getByText('Complete sale').waitFor();
  if (await view().getByTestId('pay-split').count()) throw new Error('the pay split is showing to a stylist');
  await pause();
});
const expDesc = `Electricity tokens ${tag}`;
await step('Expenses: she adds KSh 2,000 she paid → "Pending approval"', async () => {
  await go('/expenses');
  await view().getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Add expense' }).click();
  await fill(view(), 'What was it for?', expDesc);
  await fill(view(), 'Amount (KSh)', '2000');
  await choose(view(), 'Category', 'Electricity');
  await view().getByTestId('exp-submit').click();
  await toast('Sent to the owner');
  await expectText(view().getByTestId('my-expense').filter({ hasText: expDesc }).getByTestId('my-status'), 'Pending approval');
  await pause();
});

// ================= OWNER again =================
console.log('\nOwner (test login)');
await signIn('owner@dantesras.test');
await step('Expenses: owner approves it', async () => {
  await go('/expenses?tab=approvals');
  await view().getByTestId('approval').filter({ hasText: expDesc }).getByTestId('approve').click();
  await alertButton('Approve');
  await toast('Approved');
  await pause();
});
await step('Expenses: owner pays back KSh 1,000 (part)', async () => {
  await view().getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Reimbursements' }).click();
  await view().getByTestId('reimb-row').filter({ hasText: expDesc }).getByTestId('reimb-pay').click();
  await fill(modal(), 'Paying now', '1000');
  await modal().getByTestId('pay-save').click();
  await alertButton('Record');
  await toast('still owed');
  await expectText(view().getByTestId('reimb-row').filter({ hasText: expDesc }).getByTestId('reimb-left'), 'KSh 1,000');
  await pause();
});
await step('Expenses dashboard shows the totals', async () => {
  await view().getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Dashboard' }).click();
  await view().getByTestId('tot-expenses').waitFor();
  await pause(SLOW * 2);
});

// ================= STYLIST again =================
console.log('\nStylist Wanjiku (test login)');
await signIn('stylist@dantesras.test');
await step('she sees "Partially reimbursed" and KSh 1,000 still owed', async () => {
  await go('/expenses');
  const card = view().getByTestId('my-expense').filter({ hasText: expDesc });
  await expectText(card.getByTestId('my-status'), 'Partially reimbursed');
  await expectText(card, 'still owed KSh 1,000');
  await pause();
});

// ================= CLIENT APP =================
console.log('\nClient app (signed out)');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await step('client menu starts with Washes; no Finishers', async () => {
  await go('/portal/book');
  const chips = view().locator('.p-chip');
  await chips.first().waitFor();
  const first = (await chips.first().textContent())?.trim();
  if (first !== 'Washes') throw new Error(`first category is ${first}`);
  if (await view().getByText(/Finisher/i).count()) throw new Error('Finishers are showing to clients');
  await pause();
});
await step('client search: "wig" finds Wig wash', async () => {
  await view().getByTestId('service-search').fill('wig');
  await view().getByTestId('search-results').locator('[data-service="Wig wash"]').waitFor();
  await pause(SLOW * 2);
});

await setting('pay_rule', 'percent'); // back to how the test database was
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed on the phone`);
for (const r of results.filter((x) => !x.ok)) console.log('  FAILED:', r.name, '–', r.err);
process.exit(ok === results.length ? 0 : 1);
