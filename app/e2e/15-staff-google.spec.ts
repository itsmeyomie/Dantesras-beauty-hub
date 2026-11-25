import { expect, test } from '@playwright/test';
import { view } from './helpers';

// Owner and staff: "Continue with Google" on the staff sign-in page (simulated Google in test mode).

const API = 'http://localhost:54329/rest/v1';

test('owner signs in with Google and lands on the dashboard', async ({ page }) => {
  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('staff-google').click();
  await v.getByTestId('sg-test-email').fill('owner@dantesras.test');
  await v.getByTestId('sg-test-go').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(view(page).getByTestId('role-pill')).toHaveText('Owner');
});

test('a Google account with no staff account is refused', async ({ page }) => {
  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('staff-google').click();
  await v.getByTestId('sg-test-email').fill(`stranger.${Date.now()}@gmail.com`);
  await v.getByTestId('sg-test-go').click();
  await expect(v.getByTestId('su-error')).toContainText('No staff account uses');
  await expect(page).toHaveURL(/staff\/sign-in/);
});

test('a staff member waiting for approval sees the waiting screen', async ({ page, request }) => {
  const email = `gwait.${Date.now().toString(36)}@gmail.com`;
  await request.post(`${API}/rpc/staff_signup`, { data: { p: { name: 'Google Waiting', email, password: 'secret123', role: 'stylist' } } });
  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('staff-google').click();
  await v.getByTestId('sg-test-email').fill(email);
  await v.getByTestId('sg-test-go').click();
  await expect(v.getByTestId('pending-badge')).toBeVisible();
});

test('the real Google staff sign-in needs a verified Google login', async ({ request }) => {
  const r = await request.post(`${API}/rpc/staff_login_google`, { data: {} });
  expect(JSON.stringify(await r.json())).toContain('Sign in with Google first');
});
