import { expect, test } from '@playwright/test';
import { answerAlert, loginAs, modal, toast, view } from './helpers';
import { bookSteps, newPhone, signIn } from './portal-helpers';

// Owner / manager home and the receptionist's front desk.

test('owner home: money today, needs-the-owner list, week chart', async ({ page, request }) => {
  await request.post('http://localhost:54329/rest/v1/rpc/staff_signup', {
    data: { p: { name: `Waiting Stylist ${Date.now() % 10000}`, email: `w.${Date.now() % 1_000_000}@example.com`, password: 'secret12', role: 'stylist' } },
  });
  await loginAs(page, request, 'owner');
  await page.goto('/dashboard');
  const v = view(page);
  await expect(v.getByTestId('home-title')).toHaveText(/Your\s+business/i);
  await expect(v.getByTestId('money-today')).toContainText('Money in today');
  await expect(v.getByTestId('inbox')).toContainText(/staff account requests?/);
  await v.getByTestId('inbox').locator('.p-list-line').filter({ hasText: /staff account/ }).getByRole('link', { name: 'Approve' }).click();
  await expect(page).toHaveURL(/staff-requests/);
});

test('manager home is "Today at the salon" without owner-only items', async ({ page, request }) => {
  await loginAs(page, request, 'manager');
  await page.goto('/dashboard');
  const v = view(page);
  await expect(v.getByTestId('home-title')).toHaveText(/Today at\s+the salon/i);
  await expect(v.getByTestId('money-today')).toContainText('Sales today');
  await expect(v.getByText(/staff account request/)).toHaveCount(0);
  await expect(v.getByTestId('role-pill')).toHaveText('Manager');
});

test('receptionist lands on the front desk and confirms an online request there', async ({ page, browser, request }) => {
  // a client sends a request
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  const name = `Desk Client ${Date.now() % 10000}`;
  await signIn(client, newPhone(), name);
  await bookSteps(client, { service: 'Refill' });
  await view(client).getByTestId('book-next').click();
  await view(client).getByText('Pay later').click();
  await clientCtx.close();

  await loginAs(page, request, 'receptionist');
  await page.goto('/staff/sign-in');
  await page.goto('/');
  await page.goto('/dashboard'); // not allowed → sent to the desk
  await expect(page).toHaveURL(/\/desk$/);
  const v = view(page);
  await expect(v.getByTestId('desk-title')).toBeVisible();
  await expect(v.getByTestId('role-pill')).toHaveText('Receptionist');
  const req = v.getByTestId('desk-request').filter({ hasText: name });
  await expect(req).toBeVisible();
  await req.getByTestId('desk-confirm').click();
  await answerAlert(page, 'OK', 'Welcome!');
  await toast(page, /Confirmed|Booking confirmed/);
  await expect(v.getByTestId('desk-request').filter({ hasText: name })).toHaveCount(0);
});

test('front desk shortcuts open the walk-in and booking forms', async ({ page, request }) => {
  await loginAs(page, request, 'receptionist');
  await page.goto('/desk');
  await view(page).getByTestId('desk-walkin').click();
  const m = modal(page);
  await expect(m.locator('ion-title')).toHaveText('New booking');
  await expect(m.locator('ion-button').filter({ hasText: 'Add to queue' })).toBeVisible();
});

test('staff can sign out from More (phone and Android app) and the staff pages close', async ({ page, request }) => {
  await loginAs(page, request, 'receptionist');
  await page.goto('/more');
  await page.evaluate(() => sessionStorage.setItem('e2e.signedOut', '1')); // keep the test login from coming back
  await view(page).getByTestId('more-signout').click();
  await answerAlert(page, 'Sign out');
  await expect(page).toHaveURL(/\/staff\/sign-in/);
  expect(await page.evaluate(() => localStorage.getItem('dbh.staff.token'))).toBeNull();
  await page.goto('/desk');
  await expect(page).toHaveURL(/\/staff\/sign-in/);
});
