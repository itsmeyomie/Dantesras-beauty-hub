// =====================================================================
// Real-phone checks (Android, USB debugging on) for the TEST copy of the app
// ("Dantesras TEST", ke.dantesras.app.test) against the computer's test database.
//
//   1. npm --prefix ../local-db start              (test database)
//   2. npx ng build --configuration development && npx cap sync android
//      cd android && gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
//   3. adb reverse tcp:54321 tcp:54321              (phone reaches the test database)
//   4. node device-tests/roles-on-phone.mjs
//
// Uses only the TEST logins from local-db/dev-accounts.sql – never real accounts.
// =====================================================================
import { _android } from 'playwright';
import { mkdirSync } from 'node:fs';

const PKG = 'ke.dantesras.app.test';
const BASE = 'http://localhost';
const PW = 'test1234'; // test-database password (local-db/dev-accounts.sql)
const OUT = process.env.SHOTS ?? 'device-tests/shots';
mkdirSync(OUT, { recursive: true });

const results = [];
const [device] = await _android.devices();
if (!device) throw new Error('No phone found (adb devices)');
console.log('Phone:', device.model(), device.serial());

let page;
async function launch({ fresh = false } = {}) {
  await device.shell(`am force-stop ${PKG}`);
  if (fresh) await device.shell(`pm clear ${PKG}`);
  await device.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const wv = await device.webView({ pkg: PKG }, { timeout: 30_000 });
  page = await wv.page();
  page.setDefaultTimeout(15_000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}
const view = () => page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
const path = () => new URL(page.url()).pathname;

async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log('  ✔', name);
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message ?? e).split('\n')[0] });
    console.log('  ✘', name, '–', String(e.message ?? e).split('\n')[0]);
    await device.screenshot({ path: `${OUT}/FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png` }).catch(() => {});
  }
}
const expectPath = async (re, what) => {
  await page.waitForFunction((r) => new RegExp(r).test(location.pathname), re.source, { timeout: 15_000 })
    .catch(() => { throw new Error(`${what}: expected ${re}, got ${path()}`); });
};
const shot = (n) => device.screenshot({ path: `${OUT}/${n}.png` });

async function signOutHard() {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}
async function staffLogin(email) {
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill(email);
  await view().getByTestId('su-password').fill(PW);
  await view().getByTestId('su-submit').click();
  await page.waitForFunction(() => !location.pathname.includes('sign-in'), null, { timeout: 20_000 });
  await page.waitForTimeout(1200);
}
async function blocked(url, home) {
  await page.goto(`${BASE}${url}`);
  await page.waitForTimeout(1500);
  if (path() === url) throw new Error(`${url} should be closed for this role`);
  if (home && !home.test(path())) throw new Error(`${url} → ${path()} (expected home)`);
}
async function opens(url) {
  await page.goto(`${BASE}${url}`);
  await page.waitForTimeout(1500);
  if (path() !== url) throw new Error(`${url} did not open (now at ${path()})`);
  const err = await view().locator('.p-error, ion-toast[color=danger]').count();
  if (err) throw new Error(`${url} shows an error`);
}
const tabs = async () => (await page.getByTestId('staff-tabs').locator('a').allTextContents()).map((s) => s.trim());

// ---------------------------------------------------------------- roles
const ROLES = [
  { key: 'owner', email: 'owner@dantesras.test', home: /^\/dashboard$/, pill: 'Owner',
    open: ['/bookings', '/checkout', '/sales', '/clients', '/debts', '/services', '/products', '/staff-list', '/school', '/reports', '/settings', '/staff-requests', '/roles', '/notifications'],
    closed: [] },
  { key: 'manager', email: 'manager@dantesras.test', home: /^\/dashboard$/, pill: 'Manager',
    open: ['/bookings', '/checkout', '/sales', '/clients', '/reports', '/staff-list', '/school'],
    closed: ['/settings', '/staff-requests', '/roles'] },
  { key: 'receptionist', email: 'reception@dantesras.test', home: /^\/desk$/, pill: 'Receptionist',
    open: ['/bookings', '/checkout', '/sales', '/clients', '/debts', '/school'],
    closed: ['/reports', '/services', '/staff-list', '/settings', '/dashboard'] },
  { key: 'stylist', email: 'stylist@dantesras.test', home: /^\/my-day$/, pill: 'Stylist',
    open: ['/my-day', '/my-calendar', '/my-earnings', '/bookings', '/checkout'],
    closed: ['/sales', '/reports', '/clients', '/settings', '/dashboard', '/desk'] },
  { key: 'finisher', email: 'finisher@dantesras.test', home: /^\/my-day$/, pill: 'Finisher',
    open: ['/my-day', '/bookings'],
    closed: ['/checkout', '/sales', '/reports', '/settings'] },
];

await launch({ fresh: true });
await step('app starts on the client home', async () => {
  await expectPath(/^\/portal/, 'start page');
  await view().getByTestId('brand-title').waitFor();
  await shot('00-client-home');
});

for (const r of ROLES) {
  console.log(`\n${r.key.toUpperCase()}`);
  await signOutHard();
  await step(`${r.key}: sign in lands on its home`, async () => {
    await staffLogin(r.email);
    await expectPath(r.home, 'home');
    const pill = (await view().getByTestId('role-pill').textContent())?.trim();
    if (pill !== r.pill) throw new Error(`role pill "${pill}"`);
    await shot(`${r.key}-1-home`);
  });
  await step(`${r.key}: phone tabs`, async () => {
    const t = await tabs();
    if (t.length < 3) throw new Error(`only ${t.length} tabs: ${t.join(', ')}`);
    console.log('     tabs:', t.join(' · '));
  });
  for (const u of r.open) await step(`${r.key}: opens ${u}`, () => opens(u));
  for (const u of r.closed) await step(`${r.key}: refused ${u}`, () => blocked(u, r.home));

  await step(`${r.key}: still signed in after closing the app for 10 s`, async () => {
    await page.goto(`${BASE}${r.key === 'owner' || r.key === 'manager' ? '/dashboard' : r.key === 'receptionist' ? '/desk' : '/my-day'}`);
    await page.waitForTimeout(1000);
    await device.shell(`am force-stop ${PKG}`);
    await new Promise((res) => setTimeout(res, 10_000));
    await launch();
    await page.goto(`${BASE}/more`);
    await page.waitForTimeout(2000);
    if (path().includes('sign-in')) throw new Error('was signed out after reopening');
    const pill = (await view().getByTestId('role-pill').textContent())?.trim();
    if (pill !== r.pill) throw new Error(`after reopening the role is "${pill}"`);
  });
  await step(`${r.key}: Sign out from More`, async () => {
    await page.goto(`${BASE}/more`);
    await view().getByTestId('more-signout').click();
    await page.locator('ion-alert button').filter({ hasText: 'Sign out' }).click();
    await expectPath(/^\/staff\/sign-in/, 'after sign out');
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(1500);
    if (!path().includes('sign-in')) throw new Error(`after sign out ${path()} still opens`);
  });
  await step(`${r.key}: stays signed out after reopening`, async () => {
    await launch();
    await page.goto(`${BASE}/my-day`);
    await page.waitForTimeout(1500);
    if (!path().includes('sign-in')) throw new Error(`reopened signed in at ${path()}`);
  });
}

// ---------------------------------------------------------------- wrong password
await step('wrong password is refused', async () => {
  await page.goto(`${BASE}/staff/sign-in`);
  await view().getByTestId('su-email').fill('owner@dantesras.test');
  await view().getByTestId('su-password').fill('not-the-password');
  await view().getByTestId('su-submit').click();
  await view().getByTestId('su-error').waitFor();
});

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} checks passed on ${device.model()}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAILED:', r.name, '–', r.err);
await device.close();
process.exit(ok === results.length ? 0 : 1);
