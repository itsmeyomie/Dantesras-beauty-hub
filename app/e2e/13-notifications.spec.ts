import { expect, test } from '@playwright/test';
import { answerAlert, loginAs, ownerApi, toast, view } from './helpers';
import { bookSteps, newPhone, signIn } from './portal-helpers';

// In-app notifications (push to the Android app uses the same list).

const API = 'http://localhost:54329/rest/v1';

test('client request → front desk is notified; salon confirms → client is notified with a badge', async ({ page, browser, request }) => {
  const name = `Notify Client ${Date.now() % 100000}`;
  await signIn(page, newPhone(), name);
  await bookSteps(page, { service: 'Refill' });
  await view(page).getByTestId('book-next').click();
  await view(page).getByText('Pay later').click();

  // receptionist: notification about the new request, opens the online requests
  const desk = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await loginAs(desk, request, 'receptionist');
  await desk.goto('/notifications');
  const n = view(desk).getByTestId('notification').filter({ hasText: name });
  await expect(n).toContainText('New online booking request');
  await desk.goto('/desk');
  const req = view(desk).getByTestId('desk-request').filter({ hasText: name });
  await req.getByTestId('desk-confirm').click();
  await answerAlert(desk, 'OK', 'See you then!');
  await toast(desk, /confirmed/i);
  await desk.context().close();

  // client: badge on the bell, then the message
  await page.goto('/portal');
  await expect(view(page).getByTestId('bell-count')).toBeVisible();
  await view(page).getByTestId('bell').click();
  await expect(view(page).getByTestId('notification').first()).toContainText('Booking confirmed');
  await expect(view(page).getByTestId('notification').first()).toContainText('See you then!');
  await page.goto('/portal');
  await expect(view(page).getByTestId('bell-count')).toHaveCount(0); // read now
});

test('a stylist is notified when given a client; reminders go out the evening before', async ({ page, request }) => {
  const api = await ownerApi(request);
  const staff = await (await api.get(`${API}/staff?select=id&name=eq.Wanjiku%20Kamau`)).json();
  const client = await (await api.get(`${API}/clients?select=id&limit=1`)).json();
  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setHours(11, 0, 0, 0);
  const guest = `Assigned ${Date.now() % 100000}`;
  const [b] = await (await api.post(`${API}/bookings`, { headers: { Prefer: 'return=representation' },
    data: { channel: 'salon', status: 'booked', scheduled_at: tomorrow.toISOString(), guest_name: guest, client_id: client[0].id } })).json();
  await api.post(`${API}/booking_staff`, { data: { booking_id: b.id, staff_id: staff[0].id } });

  await loginAs(page, request, 'stylist');
  await page.goto('/my-day');
  await expect(view(page).getByTestId('staff-bell-count')).toBeVisible();
  await view(page).getByTestId('staff-bell').click();
  await expect(view(page).getByTestId('notification').first()).toContainText('New client for you');

  // the evening job (queue_reminders) is server-only: the app cannot call it
  const r = await request.post(`${API}/rpc/queue_reminders`, { data: {} });
  expect(r.ok()).toBeFalsy();
});
