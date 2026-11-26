// =====================================================================
// Real-phone check: assigning, accepting and handing over, every role.
// Same set-up as roles-on-phone.mjs (TEST copy of the app, test database,
// test logins only). Slowed down so a person can watch the phone.
//
// client books 2 requests ("any stylist") → receptionist is notified
// → owner assigns both to Wanjiku (Bookings → Online)
// → stylist Wanjiku is notified, accepts both, adds finisher Faith to one
//   and hands the other to Achieng
// → finisher Faith is notified, sees "Finish for Wanjiku", cannot hand over
// → Wanjiku starts + checks out (commission split with Faith)
// → client sees both answers → owner sees the sale and Achieng on the other job
// =====================================================================
import { _android } from 'playwright';
import { mkdirSync } from 'node:fs';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const PW = 'test1234';
const OUT = 'device-tests/shots';
const SLOW = Number(process.env.SLOW ?? 1800);
mkdirSync(OUT, { recursive: true });
const results = [];
const [device] = await _android.devices();
if (!device) throw new Error('No phone found (adb devices)');
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
const pause = (ms = SLOW) => page.waitForTimeout(ms);
const shot = (n) => device.screenshot({ path: `${OUT}/${n}.png` });
async function step(name, fn) {
  try { await fn(); await pause(); results.push({ name, ok: true }); console.log('  ✔', name); }
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
  await pause(700);
  if (text !== undefined) await a.locator('input').first().fill(text);
  await pause(700);
  await a.locator('button').filter({ hasText: button }).click();
}
async function staffLogin(email) {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill(email);
  await view().getByTestId('su-password').fill(PW);
  await pause(600);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await pause();
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
const hhmm = (d) => `${String(Math.min(d.getHours(), 18)).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 5) * 5).padStart(2, '0')}`;
async function book(fromMin) {
  let time = "";
  await page.goto(`${BASE}/portal/book`);
  await view().locator('[data-service="Refill"] .p-add').click();
  await pause(600);
  await view().getByTestId('book-next').click();
  await view().getByTestId('book-next').click();               // salon
  await view().locator(`app-month-calendar [data-date="${ymd(new Date())}"]`).click();
  if (!(await view().getByTestId('time-input').count())) await view().getByTestId('any-time').click();
  for (let m = fromMin; m < fromMin + 240; m += 15) {
    const d = new Date(Date.now() + m * 60000);
    if (d.getHours() > 18) break;
    time = hhmm(d);
    await view().getByTestId('time-input').fill(time);
    await view().getByTestId('time-input').dispatchEvent('change');
    await view().locator('[data-testid="time-ok"], [data-testid="time-bad"]').first().waitFor();
    await pause(500);
    if (await view().getByTestId('time-ok').filter({ hasText: time }).count()) break;
    console.log('    ', time, 'taken:', (await view().getByTestId('time-bad').textContent())?.trim());
    time = '';
  }
  if (!time) throw new Error('no free time today');
  await pause(600);
  await view().getByTestId('book-next').click();               // → stylist: any
  await pause(600);
  await view().getByTestId('book-next').click();               // → review
  await view().getByTestId('book-next').click();               // send
  await view().getByText('Pay later').click();
  await view().getByText("You're all set").waitFor();
  return time;
}

const tag = Date.now().toString(36).slice(-5);
const CLIENT = `Assign Test ${tag}`;
const EMAIL = `assign.${tag}@example.com`;
let T1 = "", T2 = "";
const job = (t) => view().getByTestId('my-job').filter({ hasText: CLIENT }).filter({ hasText: t });
const sheet = () => page.getByTestId('assign-sheet');

console.log('Phone:', device.model(), '· client', CLIENT);
await launch({ fresh: true });

console.log('\nCLIENT');
await step('client signs in and books two requests with "any stylist"', async () => {
  await clientCode(EMAIL, CLIENT, '0713' + String(Date.now() % 1e6).padStart(6, '0'));
  T1 = await book(30);
  const [h, m] = T1.split(":").map(Number);
  T2 = await book(h * 60 + m - (new Date().getHours() * 60 + new Date().getMinutes()) + 60);
  console.log("     booked", T1, "and", T2);
});

console.log('\nRECEPTIONIST');
await step('receptionist is notified of the new requests', async () => {
  await staffLogin('reception@dantesras.test');
  await page.goto(`${BASE}/notifications`);
  await view().getByTestId('notification').filter({ hasText: CLIENT }).first().waitFor();
});

console.log('\nOWNER');
await step('owner: Bookings → Online shows both as "Any stylist"', async () => {
  await staffLogin('owner@dantesras.test');
  await page.goto(`${BASE}/bookings`);
  await view().locator('ion-segment-button').filter({ hasText: 'Online' }).click();
  for (const t of [T1, T2]) {
    const card = view().getByTestId('request').filter({ hasText: CLIENT }).filter({ hasText: t });
    await card.scrollIntoViewIfNeeded();
    if (!(await card.textContent()).includes('Any stylist')) throw new Error(`${t} not "Any stylist"`);
  }
});
for (const t of [T1, T2]) {
  await step(`owner assigns the ${t} request to Wanjiku`, async () => {
    const card = view().getByTestId('request').filter({ hasText: CLIENT }).filter({ hasText: t });
    await card.getByTestId('request-assign').click();
    await sheet().locator('[data-testid^="assign-"]').filter({ hasText: 'Wanjiku' }).first().click();
    await pause(800);
    await sheet().getByTestId('assign-save').click();
    await toast(/Assigned to Wanjiku/);
    await view().getByTestId('request').filter({ hasText: CLIENT }).filter({ hasText: t }).filter({ hasText: 'Asked for Wanjiku' }).waitFor();
  });
}
await shot('assign-1-owner-assigned');

console.log('\nSTYLIST (Wanjiku)');
await step('stylist is notified "New client for you"', async () => {
  await staffLogin('stylist@dantesras.test');
  await page.goto(`${BASE}/notifications`);
  await view().getByTestId('notification').filter({ hasText: 'New client for you' }).filter({ hasText: CLIENT }).first().waitFor();
});
for (const t of [T1, T2]) {
  await step(`stylist accepts the ${t} request on Today`, async () => {
    await page.goto(`${BASE}/my-day`);
    await job(t).scrollIntoViewIfNeeded();
    await job(t).getByTestId('job-accept').click();
    await alertOk('OK', t === T1 ? 'See you soon!' : '');
    await toast(/accepted/i);
    await job(t).getByTestId('job-accept').waitFor({ state: 'detached' });
  });
}
await step(`stylist adds finisher Faith to the ${T1} job and keeps it`, async () => {
  await job(T1).getByTestId('job-handover').click();
  await sheet().locator('[data-testid^="finisher-"]').filter({ hasText: 'Faith' }).first().click();
  await pause(800);
  await sheet().getByTestId('assign-save').click();
  await toast(/Assigned to Wanjiku \+ finisher Faith/);
  await job(T1).waitFor();
  await shot('assign-2-stylist-added-finisher');
});
await step(`stylist hands the ${T2} job to Achieng`, async () => {
  await job(T2).getByTestId('job-handover').click();
  await sheet().locator('[data-testid^="assign-"]').filter({ hasText: 'Achieng' }).first().click();
  await pause(800);
  await sheet().getByTestId('assign-save').click();
  await toast(/Assigned to Achieng/);
  await job(T2).waitFor({ state: 'detached' });
});
await step('the job also shows on My calendar with Hand over', async () => {
  await page.goto(`${BASE}/my-calendar`);
  await view().getByTestId('cal-booking').filter({ hasText: CLIENT }).first().getByTestId('cal-handover').waitFor();
});

console.log('\nFINISHER (Faith)');
await step('finisher is notified "You finish a client"', async () => {
  await staffLogin('finisher@dantesras.test');
  await page.goto(`${BASE}/notifications`);
  await view().getByTestId('notification').filter({ hasText: 'You finish a client' }).filter({ hasText: CLIENT }).first().waitFor();
});
await step('finisher sees "Finish for Wanjiku" and no Hand over button', async () => {
  await page.goto(`${BASE}/my-day`);
  await job(T1).getByTestId('finish-for').waitFor();
  if (await job(T1).getByTestId('job-handover').count()) throw new Error('finisher can hand over');
  await shot('assign-3-finisher');
});

console.log('\nSTYLIST again');
await step('stylist starts the client and checks out with Faith sharing the commission', async () => {
  await staffLogin('stylist@dantesras.test');
  await page.goto(`${BASE}/my-day`);
  await job(T1).locator('button').filter({ hasText: 'Start' }).click();
  await toast(/Started/);
  await pause();
  await page.goto(`${BASE}/my-day`);
  await job(T1).locator('button').filter({ hasText: 'Checkout' }).click();
  await page.waitForFunction(() => location.pathname === '/checkout');
  await view().getByText('Booking checkout').waitFor();
  await view().getByText(/Faith Wambui · finisher/).waitFor();
  const due = Number(((await view().locator('strong.maroon').first().textContent()) ?? '').replace(/[^\d]/g, ''));
  const amount = view().locator('app-payment-entry ion-input').filter({ hasText: 'Amount' }).locator('input').first();
  await amount.fill(String(due));
  await amount.press('Tab');
  await pause();
  const btn = view().locator('ion-button').filter({ hasText: 'Complete sale' });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await view().getByText('Sale recorded').waitFor({ timeout: 20_000 });
  await shot('assign-4-sale');
});

console.log('\nCLIENT again');
await step('client sees "Booking confirmed" with the stylist\'s message', async () => {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await clientCode(EMAIL);
  await page.goto(`${BASE}/portal/notifications`);
  await view().getByTestId('notification').filter({ hasText: 'See you soon!' }).first().waitFor();
});

console.log('\nOWNER again');
await step('owner sees the sale, and Achieng on the handed-over job', async () => {
  await staffLogin('owner@dantesras.test');
  await page.goto(`${BASE}/sales`);
  await view().getByText(CLIENT).first().waitFor();
  await pause();
  await page.goto(`${BASE}/desk`);
  const row = view().locator('.p-card.p-row, .p-tl, [data-testid="desk-day"]').filter({ hasText: CLIENT }).filter({ hasText: 'Achieng' }).first();
  await row.scrollIntoViewIfNeeded();
  await row.waitFor();
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} checks passed on ${device.model()}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAILED:', r.name, '–', r.err);
await device.close();
process.exit(ok === results.length ? 0 : 1);
