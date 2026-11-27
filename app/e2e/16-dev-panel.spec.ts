import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, answerAlert, loginAs, toast, view } from './helpers';

// Developer panel (/dev): only developers; pause / resume the service, messages, health, users.

const API = 'http://localhost:54329/rest/v1';
const rpc = (request: APIRequestContext, fn: string, data: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  request.post(`${API}/rpc/${fn}`, { data, headers });
async function token(request: APIRequestContext, email: string) {
  return (await (await rpc(request, 'staff_login', { p_email: email, p_password: 'test1234' })).json()).token as string;
}
/** Always leave the service running and the messages empty for the other tests. */
async function reset(request: APIRequestContext) {
  const t = await token(request, STAFF.dev);
  await rpc(request, 'dev_set_control', { p_token: t, p: { paused: false, maintenance: false, banner: '', min_version_code: 0 } });
}
test.afterEach(async ({ request }) => reset(request));

test('the owner cannot open the developer panel or call its functions', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/more');
  await expect(view(page).locator('[data-module="Developer"]')).toHaveCount(0);
  await page.goto('/dev');
  await expect(page).not.toHaveURL(/\/dev$/);
  const t = await token(request, STAFF.owner);
  expect(JSON.stringify(await (await rpc(request, 'dev_overview', { p_token: t })).json())).toContain('Developers only');
  expect(JSON.stringify(await (await rpc(request, 'dev_set_control', { p_token: t, p: { paused: true } })).json())).toContain('Developers only');
  // the private tables cannot be read directly
  expect(await (await request.get(`${API}/app_control?select=*`, { headers: { 'x-staff-token': t } })).json()).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 1 })]));
});

test('developer sees health, staff and clients', async ({ page, request }) => {
  await loginAs(page, request, 'dev');
  await page.goto('/more');
  await expect(view(page).locator('[data-module="Developer"]')).toBeVisible();
  await page.goto('/dev');
  const v = view(page);
  await expect(v.getByTestId('dev-service-state')).toHaveText('ON');
  await expect(v.getByTestId('dev-counts')).toContainText('Clients');
  await expect(v.getByTestId('dev-staff-row').filter({ hasText: 'Wanjiku' })).toBeVisible();
  await expect(v.getByTestId('dev-client-row').first()).toBeVisible();
});

test('pause: everyone is blocked (also old apps), nobody is signed out; resume brings everyone back', async ({ page, browser, request }) => {
  const stylist = await token(request, STAFF.stylist);
  await loginAs(page, request, 'dev');
  await page.goto('/dev');
  const v = view(page);
  await v.getByTestId('dev-pause-msg').fill('Paused by the developer. Call 0700 000 000.');
  await v.getByTestId('dev-pause').click();
  await answerAlert(page, 'Pause');
  await toast(page, 'Service paused');
  await expect(v.getByTestId('dev-service-state')).toHaveText('PAUSED');
  await expect(page.getByTestId('dev-paused-strip')).toBeVisible();          // the developer keeps working

  // an old app with a saved sign-in: every call refused with the message, tables come back empty
  expect(JSON.stringify(await (await rpc(request, 'staff_me', { p_token: stylist })).json())).toContain('SERVICE_PAUSED: Paused by the developer');
  expect(await (await request.get(`${API}/bookings?select=id&limit=1`, { headers: { 'x-staff-token': stylist } })).json()).toEqual([]);
  // signing in is refused too
  expect(JSON.stringify(await (await rpc(request, 'staff_login', { p_email: STAFF.owner, p_password: 'test1234' })).json())).toContain('SERVICE_PAUSED');

  // the new app: staff and clients see the paused screen
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const staffPage = await ctx.newPage();
  await staffPage.addInitScript((t) => localStorage.setItem('dbh.staff.token', t), stylist); // signed in before the pause
  await staffPage.goto('/my-day');
  await expect(staffPage.getByTestId('service-blocker')).toHaveAttribute('data-kind', 'paused');
  await expect(staffPage.getByTestId('service-blocker-msg')).toContainText('Call 0700 000 000');
  const client = await ctx.newPage();
  await client.goto('/portal');
  await expect(client.getByTestId('service-blocker')).toBeVisible();

  // resume: the same saved sign-in works again (nobody had to sign in again)
  await page.getByTestId('dev-paused-strip').click();
  await view(page).getByTestId('dev-resume').click();
  await toast(page, 'Service running again');
  expect((await (await rpc(request, 'staff_me', { p_token: stylist })).json()).name).toBe('Wanjiku Kamau');
  await staffPage.reload();
  await expect(staffPage.getByTestId('service-blocker')).toHaveCount(0);
  await expect(view(staffPage).locator('.p-hey')).toContainText('Wanjiku');
  await ctx.close();
});

test('maintenance screen and banner reach the apps; the developer is not blocked', async ({ page, browser, request }) => {
  await loginAs(page, request, 'dev');
  await page.goto('/dev');
  const v = view(page);
  await v.getByTestId('dev-banner').fill('Closed on Monday 1 Dec');
  await v.getByTestId('dev-save-messages').click();
  await toast(page, 'Saved');
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const client = await ctx.newPage();
  await client.goto('/portal');
  await expect(client.getByTestId('app-banner')).toContainText('Closed on Monday 1 Dec');

  await v.getByTestId('dev-maint').check();
  await v.getByTestId('dev-maint-msg').fill('Updating, back at 10:00');
  await v.getByTestId('dev-save-messages').click();
  await toast(page, 'Saved');
  await client.reload();
  await expect(client.getByTestId('service-blocker')).toHaveAttribute('data-kind', 'maintenance');
  await expect(client.getByTestId('service-blocker-msg')).toHaveText('Updating, back at 10:00');
  await page.goto('/dashboard');
  await expect(page.getByTestId('service-blocker')).toHaveCount(0);
  await ctx.close();
});

test('errors from phones show in the panel and can be cleared', async ({ page, request }) => {
  const msg = `TypeError: test crash ${Date.now()}`;
  await rpc(request, 'report_error', { p: { app: 'client', version: 'android 1.9 (10)', url: '/portal/book', message: msg } });
  await loginAs(page, request, 'dev');
  await page.goto('/dev');
  const v = view(page);
  await expect(v.getByTestId('dev-errors')).toContainText(msg);
  await v.getByTestId('dev-clear-errors').click();
  await answerAlert(page, 'Clear');
  await expect(v.getByTestId('dev-errors')).toContainText('No errors reported');
});

test('developer signs a stylist out everywhere and switches an account off and on', async ({ page, request }) => {
  const stylist = await token(request, STAFF.stylist);
  await loginAs(page, request, 'dev');
  await page.goto('/dev');
  const v = view(page);
  const row = v.getByTestId('dev-staff-row').filter({ hasText: 'Wanjiku' });
  await row.getByTestId('dev-staff-signout').click();
  await answerAlert(page, 'Sign out');
  await toast(page, /Wanjiku Kamau signed out/);
  expect(JSON.stringify(await (await rpc(request, 'staff_me', { p_token: stylist })).json())).toContain('sign in again');

  await row.getByTestId('dev-staff-toggle').click();
  await answerAlert(page, 'Switch off');
  await toast(page, 'Wanjiku Kamau switched off');
  expect(JSON.stringify(await (await rpc(request, 'staff_login', { p_email: STAFF.stylist, p_password: 'test1234' })).json())).toContain('switched off');
  await v.getByTestId('dev-staff-row').filter({ hasText: 'Wanjiku' }).getByTestId('dev-staff-toggle').click();
  await toast(page, 'Wanjiku Kamau switched on');
  expect((await (await rpc(request, 'staff_login', { p_email: STAFF.stylist, p_password: 'test1234' })).json()).token).toBeTruthy();
});
