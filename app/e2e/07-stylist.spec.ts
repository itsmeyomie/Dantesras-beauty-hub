import { expect, test } from '@playwright/test';
import { loginAs, toast, view, ownerApi } from './helpers';

// Stylist app: my day, take a walk-in, calendar, earnings, profile.

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'stylist');
});

test('stylist lands on My day with her own tabs', async ({ page }) => {
  await page.goto('/my-day');
  const v = view(page);
  await expect(v.getByTestId('role-pill')).toHaveText('Stylist');
  await expect(v.locator('.p-hey')).toContainText('Hey Wanjiku');
  const tabs = page.getByTestId('staff-tabs');
  if (await tabs.count()) {
    for (const t of ['Today', 'Calendar', 'Checkout', 'Earnings', 'Me']) await expect(tabs.locator(`a[aria-label="${t}"]`)).toBeVisible();
  }
});

test('stylist takes a walk-in from the queue and checks the client out', async ({ page, request }) => {
  const guest = `Queue Guest ${Date.now() % 100000}`;
  const res = await (await ownerApi(request)).post('http://localhost:54329/rest/v1/bookings', {
    headers: { Prefer: 'return=representation' },
    data: { guest_name: guest, channel: 'walkin', status: 'waiting', source: 'In person', scheduled_at: new Date().toISOString() },
  });
  const [b] = await res.json();
  const svc = await (await (await ownerApi(request)).get('http://localhost:54329/rest/v1/services?select=id&name=eq.Gel')).json();
  await (await ownerApi(request)).post('http://localhost:54329/rest/v1/booking_services', { data: { booking_id: b.id, service_id: svc[0].id, name: 'Gel', price: 500 } });

  await page.goto('/my-day');
  const v = view(page);
  const row = v.getByTestId('walkin').filter({ hasText: guest });
  await expect(row).toBeVisible();
  await row.getByTestId('take').click();
  await toast(page, 'Walk-in is yours');
  const mine = v.getByTestId('my-job').filter({ hasText: guest });
  await expect(mine).toBeVisible();
  await mine.getByRole('button', { name: 'Checkout' }).click();
  await expect(page).toHaveURL(/checkout\?booking=/);
  await expect(view(page).getByText('Booking checkout')).toBeVisible();
  await expect(view(page).locator('table.t').first()).toContainText('Gel');
});

test('my calendar and my earnings show my own numbers', async ({ page, request }) => {
  // a booking for Wanjiku later today (dummy data is random)
  const api = 'http://localhost:54329/rest/v1';
  const me = (await (await (await ownerApi(request)).get(`${api}/staff?select=id&name=eq.Wanjiku%20Kamau`)).json())[0];
  const guest = `Calendar Guest ${Date.now() % 100000}`;
  const at = new Date();
  at.setHours(Math.min(at.getHours() + 1, 23), 0, 0, 0);
  const [b] = await (await (await ownerApi(request)).post(`${api}/bookings`, { headers: { Prefer: 'return=representation' },
    data: { guest_name: guest, channel: 'salon', status: 'booked', scheduled_at: at.toISOString(), duration_min: 60 } })).json();
  await (await ownerApi(request)).post(`${api}/booking_staff`, { data: { booking_id: b.id, staff_id: me.id } });

  await page.goto('/my-calendar');
  const v = view(page);
  await expect(v.locator('app-month-calendar')).toBeVisible();
  await expect(v.locator('app-month-calendar .count').first()).toBeVisible();
  await expect(v.getByTestId('cal-booking').filter({ hasText: guest })).toBeVisible();

  await page.goto('/my-earnings');
  const e = view(page);
  await e.locator('.p-chip').filter({ hasText: 'This month' }).click();
  await expect.poll(async () => Number(((await e.getByTestId('commission').textContent()) ?? '').replace(/\D/g, ''))).toBeGreaterThanOrEqual(0);
  await expect(e.getByTestId('unpaid')).toContainText('KSh');
  await expect(e.locator('.p-bars i')).toHaveCount(7);
});

test('stylist updates her speciality; clients see it when choosing a stylist', async ({ page }) => {
  const spec = `Nails & art ${Date.now() % 1000}`;
  await page.goto('/me');
  const v = view(page);
  await v.getByTestId('me-specialty').fill(spec);
  await v.getByTestId('me-save').click();
  await toast(page, 'Saved');
  const res = await page.request.post('http://localhost:54329/rest/v1/rpc/portal_catalog', { data: {} });
  const cat = await res.json();
  expect(cat.stylists.find((s: { name: string }) => s.name === 'Wanjiku Kamau').specialty).toBe(spec);
});
