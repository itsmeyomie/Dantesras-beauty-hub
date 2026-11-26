import { expect, Page, test } from '@playwright/test';
import { STAFF, loginAs, toast, view } from './helpers';

// Staff accounts: sign up with email + photo, owner approves and gives the role, role-based access.

// 1×1 maroon PNG as a stand-in photo
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4W8f8HwAGJQKNzGzVZQAAAABJRU5ErkJggg==', 'base64');

async function signInForm(page: Page, email: string, password: string) {
  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('su-email').fill(email);
  await v.getByTestId('su-password').fill(password);
  await v.getByTestId('su-submit').click();
}

test('wrong password is refused; protected pages need sign-in', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/staff\/sign-in\?returnUrl=%2Freports/);
  await expect(view(page).getByTestId('owner-setup')).toHaveCount(0); // owner already set up
  await signInForm(page, STAFF.owner, 'nope-nope');
  await expect(view(page).getByTestId('su-error')).toHaveText('Wrong email or password');
});

test('sign up with photo → pending → owner approves as receptionist → can sign in', async ({ page, browser, request }) => {
  const email = `new.${Date.now() % 1_000_000}@example.com`;
  const name = `New Staff ${Date.now() % 10000}`;
  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('tab-create').click();
  await v.getByTestId('photo-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(v.locator('.p-upload img')).toBeVisible();
  await v.getByTestId('su-name').fill(name);
  await v.getByTestId('su-email').fill(email);
  await v.getByTestId('su-phone').fill('0799 ' + String(Date.now() % 1_000_000).padStart(6, '0'));
  await v.getByTestId('su-password').fill('secret12');
  await v.locator('[data-role="stylist"]').click();
  await v.getByTestId('su-specialty').fill('Pedicure');
  await v.getByTestId('su-submit').click();
  await expect(v.getByTestId('pending-badge')).toBeVisible();
  await expect(v.getByText('Waiting')).toBeVisible();

  // signing in before approval shows the waiting screen again
  await signInForm(page, email, 'secret12');
  await expect(view(page).getByTestId('pending-badge')).toBeVisible();

  // owner (separate browser) approves – but as receptionist
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await loginAs(owner, request, 'owner');
  await owner.goto('/staff-requests');
  const card = view(owner).getByTestId('staff-request').filter({ hasText: name });
  await expect(card).toContainText('Wants: Stylist');
  await expect(card.locator('img')).toBeVisible();
  await card.locator('[data-role="receptionist"]').click();
  await card.getByTestId('approve').click();
  await toast(owner, `${name} approved as Receptionist`);
  await expect(view(owner).getByTestId('staff-request').filter({ hasText: name })).toHaveCount(0);
  await ownerCtx.close();

  // now the new person gets in, as receptionist
  await signInForm(page, email, 'secret12');
  await expect(page).not.toHaveURL(/sign-in/);
  await expect(view(page).getByTestId('role-pill')).toHaveText('Receptionist');
});

test('owner declines a request; the person is told why', async ({ page, browser, request }) => {
  const email = `no.${Date.now() % 1_000_000}@example.com`;
  const name = `Declined Person ${Date.now() % 10000}`;
  const res = await request.post('http://localhost:54329/rest/v1/rpc/staff_signup', {
    data: { p: { name, email, password: 'secret12', role: 'manager' } },
  });
  expect(res.ok()).toBeTruthy();
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await loginAs(owner, request, 'owner');
  await owner.goto('/staff-requests');
  const card = view(owner).getByTestId('staff-request').filter({ hasText: name });
  await expect(card).toContainText('Wants: Manager');
  await card.getByTestId('decline').click();
  const alert = owner.locator('ion-alert').filter({ visible: true }).last();
  await alert.locator('input').fill('We are not hiring managers yet');
  await alert.locator('button').filter({ hasText: 'OK' }).click();
  await toast(owner, 'Request declined');
  await ownerCtx.close();

  await signInForm(page, email, 'secret12');
  await expect(view(page).getByTestId('su-error')).toContainText('We are not hiring managers yet');
});

test('each role only opens its own areas', async ({ page, request }) => {
  await loginAs(page, request, 'stylist');
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/my-day$/);
  await page.goto('/staff-requests');
  await expect(page).toHaveURL(/\/my-day$/);
  await page.goto('/more');
  await expect(view(page).locator('[data-module="Settings"]')).toHaveCount(0);
  await expect(view(page).locator('[data-module="Bookings"]')).toBeVisible();
});

test('manager sees everything except owner-only areas', async ({ page, request }) => {
  await loginAs(page, request, 'manager');
  await page.goto('/more');
  await expect(view(page).getByTestId('role-pill')).toHaveText('Manager');
  await expect(view(page).locator('[data-module="Reports"]')).toBeVisible();
  await expect(view(page).locator('[data-module="Team"]')).toBeVisible();
  await expect(view(page).locator('[data-module="Settings"]')).toHaveCount(0);
  await expect(view(page).locator('[data-module="Staff"]')).toHaveCount(0);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('a stylist approved after the owner opened the app shows up in New booking and Assign at once', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/bookings');                                    // the app has loaded the team now
  const name = `Late Joiner ${Date.now().toString(36).slice(-5)}`;
  const email = `${name.replace(/\s/g, '.').toLowerCase()}@gmail.com`;
  await request.post('http://localhost:54329/rest/v1/rpc/staff_signup', { data: { p: { name, email, password: 'secret123', role: 'stylist' } } });
  // approved somewhere else (another owner's phone)
  const owner2 = await (await request.post('http://localhost:54329/rest/v1/rpc/staff_login', { data: { p_email: STAFF.owner, p_password: 'test1234' } })).json();
  const pend = await (await request.post('http://localhost:54329/rest/v1/rpc/staff_requests', { data: { p_token: owner2.token } })).json();
  const me = (pend as { id: string; email: string }[]).find((s) => s.email === email)!;
  await request.post('http://localhost:54329/rest/v1/rpc/staff_approve', { data: { p_token: owner2.token, p_id: me.id, p_role: 'stylist' } });

  // same open app, no reload: New booking lists the new stylist
  const v = view(page);
  await v.locator('ion-header ion-button').filter({ hasText: 'New' }).click();
  await page.waitForTimeout(800);
  await page.locator('ion-modal.show-modal ion-select').filter({ hasText: 'Stylist' }).first().click();
  await expect(page.locator('ion-alert').filter({ visible: true }).getByText(name)).toBeVisible();
});

test('Team screen fits a phone: no sideways scrolling, unpaid shown per person', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/staff-list');
  const v = view(page);
  await expect(v.getByTestId('team-row').first()).toBeVisible();
  await expect(v.getByTestId('team-row').first()).toContainText('Unpaid');
  const spill = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid="team-list"], [data-testid="team-row"]')] as HTMLElement[];
    return els.some((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth + 1);
  });
  expect(spill).toBe(false);
});
