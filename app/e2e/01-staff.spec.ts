import { expect, test } from '@playwright/test';
import { answerAlert, choose, fill, goMenu, goToBookingDay, modal, segment, toast, unique, view, watchErrors , loginAs } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'owner');
});

// Staff app – the existing modules must keep working after every change.

// every module of the owner's "Everything" menu, with the page title it opens
const PAGES: [string, RegExp][] = [
  ['Dashboard', /business|salon/i], ['Bookings', /Bookings/], ['Checkout', /Checkout/], ['Sales', /Sales/],
  ['Clients', /Clients/], ['Debts', /Debts/], ['Service menu', /Service menu/], ['Products', /Products/],
  ['Team', /Staff/], ['Students', /School/], ['Reports', /Reports/], ['Settings', /Settings/],
];

test('owner can open every staff page from the menu, without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/dashboard');
  for (const [module, title] of PAGES) {
    await goMenu(page, module);
    await expect(view(page).locator('ion-title, h1.p-display').first()).toHaveText(title);
    await expect(view(page).locator('.notice').filter({ hasText: /not configured/i })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('dashboard shows sales from the dummy data', async ({ page }) => {
  await page.goto('/reports');
  await expect(view(page).getByText(/KSh [1-9]/).first()).toBeVisible();
});

test('walk-in: add guest to queue, start, checkout with cash, shows in sales', async ({ page }) => {
  const errors = watchErrors(page);
  const guest = unique('Walkin Guest');
  await page.goto('/bookings');
  await segment(view(page), /Walk-ins/);
  await view(page).locator('ion-button').filter({ hasText: 'New' }).click();

  const m = modal(page);
  await expect(m.locator('ion-title')).toHaveText('New booking');
  await segment(m, 'Guest (name only)');
  await fill(m, 'Guest name', guest);
  await choose(page, m, 'Service', /Nails: Gel$/);
  await m.locator('ion-button').filter({ hasText: /^Add$/ }).click();
  await expect(m.getByText('KSh 500').first()).toBeVisible();
  await m.locator('ion-button').filter({ hasText: 'Add to queue' }).click();
  await toast(page, 'Added to the queue');

  const card = view(page).locator('.card.booking').filter({ hasText: guest });
  await expect(card).toBeVisible();
  await card.locator('ion-button').filter({ hasText: 'Start' }).click();
  await toast(page, 'Started');
  await expect(card.locator('.pill')).toContainText('in progress');

  await card.locator('ion-button').filter({ hasText: 'Checkout' }).click();
  const co = view(page);
  await expect(co.locator('ion-title')).toHaveText('Checkout');
  await expect(co.getByText('Booking checkout')).toBeVisible();
  await expect(co.getByTestId('co-lines')).toContainText('Gel');
  await choose(page, co, 'Stylist(s)', 'Wanjiku Kamau');
  await fill(co.locator('app-payment-entry').first(), 'Amount', '500');
  await co.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(co.getByText('Sale recorded')).toBeVisible();

  await goMenu(page, 'Sales');
  await expect(view(page).getByText(guest).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('salon booking for a client with a cash deposit is held (booked)', async ({ page }, info) => {
  await page.goto('/bookings');
  // book tomorrow at 10:00 (Mon–Sat 08:00 open, Sunday from 12:00 → use 13:00 to be safe)
  await goToBookingDay(page, info.project.name);
  await view(page).locator('ion-button').filter({ hasText: 'New' }).click();
  const m = modal(page);
  await m.locator('ion-searchbar input').fill('Grace');
  await m.locator('.result').filter({ hasText: 'Grace Wanjiru' }).click();
  await choose(page, m, 'Service', /Nails: Builder gel$/);
  await m.locator('ion-button').filter({ hasText: /^Add$/ }).click();
  await fill(m, 'Time', '13:00');
  await fill(m.locator('app-payment-entry'), 'Amount', '500');
  await choose(page, m.locator('app-payment-entry'), 'Method', 'Cash');
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Booking saved');
  const card = view(page).locator('.card.booking').filter({ hasText: 'Grace Wanjiru' }).filter({ hasText: 'Builder gel' });
  await expect(card).toBeVisible();
  await expect(card.locator('.pill.booked')).toBeVisible();
  await expect(card).toContainText('KSh 500');
});

test('cancel needs a reason', async ({ page }) => {
  await page.goto('/bookings');
  await segment(view(page), /Walk-ins/);
  const card = view(page).locator('.card.booking').first();
  const name = (await card.locator('strong').nth(1).textContent())!.trim();
  await card.locator('ion-button').filter({ hasText: 'Left / cancel' }).click();
  await answerAlert(page, 'OK', 'Client left');
  await toast(page, 'Cancelled');
  await expect(view(page).locator('.card.booking').filter({ hasText: name })).toHaveCount(0);
});

test('bookings calendar: month view with counts, picking a day opens it', async ({ page }) => {
  await page.goto('/bookings');
  const v = view(page);
  const cal = v.locator('app-month-calendar');
  await expect(cal).toBeVisible();
  await expect(cal.locator('.count').first()).toBeVisible(); // dummy data has bookings this month
  // pick the 1st of next month
  await cal.getByRole('button', { name: 'Next month' }).click();
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
  await cal.locator(`[data-date="${key}"]`).click();
  await expect(v.locator('strong').filter({ hasText: first.toLocaleDateString('en-GB', { month: 'short' }) }).first()).toContainText(' 1 ');
  await v.getByTestId('toggle-cal').click();
  await expect(cal).toHaveCount(0);
});
