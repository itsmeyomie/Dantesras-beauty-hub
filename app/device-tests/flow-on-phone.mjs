// =====================================================================
// Real-phone check of the whole working day, on the TEST copy of the app
// (same set-up as roles-on-phone.mjs). Test logins only.
//
// client signs in (email code) → books → reopens app (still signed in)
// → receptionist is notified, assigns a stylist, confirms
// → client sees "confirmed" → stylist is notified, starts, checks out (cash)
// → owner sees the sale; Google sign-in (test mode) for a new client.
// =====================================================================
import { _android } from 'playwright';
import { mkdirSync } from 'node:fs';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const PW = 'test1234';
const OUT = 'device-tests/shots';
mkdirSync(OUT, { recursive: true });
const results = [];
const [device] = await _android.devices();
let page;

async function launch({ fresh = false } = {}) {
  await device.shell(`am force-stop ${PKG}`);
  if (fresh) await device.shell(`pm clear ${PKG}`);
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const wv = await device.webView({ pkg: PKG }, { timeout: 30_000 });
  page = await wv.page();
  page.setDefaultTimeout(15_000);
  await page.waitForTimeout(2000);
}
const view = () => page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
const path = () => new URL(page.url()).pathname;
const shot = (n) => device.screenshot({ path: `${OUT}/${n}.png` });
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✔', name); }
  catch (e) {
    const msg = String(e.message ?? e).split('\n')[0];
    results.push({ name, ok: false, err: msg }); console.log('  ✘', name, '–', msg);
    await shot(`FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`).catch(() => {});
  }
}
const toast = (re) => page.locator('ion-toast').filter({ hasText: re }).last().waitFor({ state: 'visible' });
async function alertOk(button, text) {
  const a = page.locator('ion-alert').last();
  await a.waitFor();
  if (text !== undefined) await a.locator('input').first().fill(text);
  await a.locator('button').filter({ hasText: button }).click();
}
async function staffLogin(email) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill(email);
  await view().getByTestId('su-password').fill(PW);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
}
async function clientCode(email, name, phone) {
  await page.goto(`${BASE}/portal/sign-in`);
  await view().getByTestId('signin-address').fill(email);
  await view().getByTestId('signin-send').click();
  const code = ((await view().getByTestId('dev-code').locator('strong').textContent()) ?? '').trim();
  await view().getByTestId('signin-code').fill(code);
  if (name) {
    await view().getByTestId('signin-name').fill(name);
    await view().getByTestId('signin-phone').fill(phone);
    await view().getByTestId('signin-save-name').click();
  }
  await toast(/Welcome/);
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const tag = Date.now().toString(36).slice(-5);
const CLIENT = `Phone Test ${tag}`;
const EMAIL = `phone.${tag}@example.com`;
// today, about 90 minutes from now (salon open till 20:00)
const when = new Date(Date.now() + 90 * 60000);
const TIME = `${String(Math.min(when.getHours(), 18)).padStart(2, '0')}:${String(Math.floor(when.getMinutes() / 5) * 5).padStart(2, '0')}`;

console.log('Phone:', device.model(), '· client', CLIENT, '· today at', TIME);
await launch({ fresh: true });

// ---------------------------------------------------------------- client
console.log('\nCLIENT');
await step('client signs in with an email code and gives name + phone', async () => {
  await clientCode(EMAIL, CLIENT, '0711' + String(Date.now() % 1e6).padStart(6, '0'));
});
await step('client books Refill for today', async () => {
  await page.goto(`${BASE}/portal/book`);
  await view().locator('[data-service="Refill"] .p-add').click();
  await view().getByTestId('book-next').click();
  await view().getByTestId('book-next').click();               // salon
  const cell = view().locator(`app-month-calendar [data-date="${ymd(new Date())}"]`);
  await cell.click();
  if (!(await view().getByTestId('time-input').count())) await view().getByTestId('any-time').click();
  await view().getByTestId('time-input').fill(TIME);
  await view().getByTestId('time-input').dispatchEvent('change');
  await view().getByTestId('time-ok').filter({ hasText: TIME }).waitFor();
  await view().getByTestId('book-next').click();               // → choose stylist (any)
  await view().getByTestId('book-next').click();               // → review
  await view().getByTestId('book-next').click();               // send request
  await view().getByText('Pay later').click();
  await view().getByText("You're all set").waitFor();
  await shot('flow-1-client-booked');
});
await step('client is still signed in after closing the app for 10 s', async () => {
  await device.shell(`am force-stop ${PKG}`);
  await new Promise((r) => setTimeout(r, 10_000));
  await launch();
  await page.goto(`${BASE}/portal/bookings`);
  await page.waitForTimeout(2000);
  if (path().includes('sign-in')) throw new Error('client was signed out');
  await view().getByTestId('my-booking').filter({ hasText: TIME }).first().waitFor();
});

// ---------------------------------------------------------------- receptionist
console.log('\nRECEPTIONIST');
await step('receptionist is notified of the new request', async () => {
  await staffLogin('reception@dantesras.test');
  await page.goto(`${BASE}/notifications`);
  await view().getByTestId('notification').filter({ hasText: CLIENT }).first().waitFor();
});
await step('receptionist sees who is free and assigns Wanjiku', async () => {
  await page.goto(`${BASE}/desk`);
  await view().getByTestId('team-board').waitFor();
  const req = view().getByTestId('desk-request').filter({ hasText: CLIENT });
  await req.getByTestId('desk-assign').click();
  const sheet = page.getByTestId('assign-sheet');
  await sheet.locator('button.p-assign').filter({ hasText: 'Wanjiku' }).first().click();
  await sheet.getByTestId('assign-save').click();
  await toast(/Assigned to Wanjiku/);
});
await step('receptionist confirms with a message', async () => {
  const req = view().getByTestId('desk-request').filter({ hasText: CLIENT });
  await req.getByTestId('desk-confirm').click();
  await alertOk('OK', 'See you later today!');
  await toast(/onfirmed/);
  await shot('flow-2-desk-confirmed');
});

// ---------------------------------------------------------------- stylist
console.log('\nSTYLIST');
await step('stylist is notified and sees the client on My day', async () => {
  await staffLogin('stylist@dantesras.test');
  await page.goto(`${BASE}/notifications`);
  await view().getByTestId('notification').filter({ hasText: CLIENT }).first().waitFor();
  await page.goto(`${BASE}/my-day`);
  await view().getByTestId('my-job').filter({ hasText: CLIENT }).waitFor();
});
await step('stylist starts the client (arrived)', async () => {
  const job = view().getByTestId('my-job').filter({ hasText: CLIENT });
  await job.locator('button').filter({ hasText: 'Start' }).click();
  await toast(/Started/);
});
await step('stylist checks out: cash, sale recorded', async () => {
  await page.goto(`${BASE}/my-day`);
  const job = view().getByTestId('my-job').filter({ hasText: CLIENT });
  await job.locator('button').filter({ hasText: 'Checkout' }).click();
  await page.waitForFunction(() => location.pathname === '/checkout');
  await view().getByText('Booking checkout').waitFor();
  const due = Number(((await view().locator('strong.maroon').first().textContent()) ?? '').replace(/[^\d]/g, ''));
  const amount = view().locator('app-payment-entry ion-input').filter({ hasText: 'Amount' }).locator('input').first();
  await amount.fill(String(due));
  await amount.press('Tab');
  const btn = view().locator('ion-button').filter({ hasText: 'Complete sale' });
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  // on a real phone the floating tab bar must not cover the button
  const covered = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(hit && (el === hit || el.contains(hit) || hit.closest('ion-button') === el));
  });
  if (covered) { await shot('flow-COVERED-complete-sale'); throw new Error('Complete sale is hidden under the tab bar'); }
  await btn.click();
  await view().getByText('Sale recorded').waitFor({ timeout: 20_000 });
  await shot('flow-3-sale-recorded');
});

// ---------------------------------------------------------------- client again
console.log('\nCLIENT AGAIN');
await step('client sees "Booking confirmed" with the salon message', async () => {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await clientCode(EMAIL);
  await page.goto(`${BASE}/portal/notifications`);
  const n = view().getByTestId('notification').filter({ hasText: 'Booking confirmed' }).first();
  await n.waitFor();
  if (!(await n.textContent())?.includes('See you later today!')) throw new Error('message missing');
});
await step('client booking moved to Past and shows as done', async () => {
  await page.goto(`${BASE}/portal/bookings`);
  await page.waitForTimeout(1500);
  await view().locator('.p-seg button, ion-segment-button').filter({ hasText: 'Past' }).first().click();
  await page.waitForTimeout(1000);
  const txt = await view().textContent();
  if (!/Done|thank you/i.test(txt ?? '')) throw new Error('booking not shown as done');
});

// ---------------------------------------------------------------- owner
console.log('\nOWNER');
await step('owner sees the sale in Sales', async () => {
  await staffLogin('owner@dantesras.test');
  await page.goto(`${BASE}/sales`);
  await view().getByText(CLIENT).first().waitFor();
});

// ---------------------------------------------------------------- Google (test mode)
console.log('\nGOOGLE SIGN-IN (test mode)');
await step('new client signs in with Google (simulated) and is asked for a phone', async () => {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/portal/sign-in`);
  await view().getByTestId('signin-google').click();
  await view().getByTestId('google-test-email').fill(`g.${tag}@gmail.com`);
  await view().getByTestId('google-test-name').fill(`Google ${tag}`);
  await view().getByTestId('google-test-go').click();
  await view().getByTestId('signin-phone').fill('0712' + String(Date.now() % 1e6).padStart(6, '0'));
  await view().getByTestId('signin-save-name').click();
  await toast(/Welcome/);
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} flow checks passed on ${device.model()}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAILED:', r.name, '–', r.err);
await device.close();
process.exit(ok === results.length ? 0 : 1);
