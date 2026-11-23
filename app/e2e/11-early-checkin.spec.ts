import { expect, test } from '@playwright/test';
import { answerAlert, loginAs, toast, view } from './helpers';

// A client can't be checked in before the booking day unless staff give a reason; the booking then moves to today.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };

function inDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(11, 0, 0, 0);
  return d;
}

test('the database refuses starting or completing a future booking without a reason', async ({ request }) => {
  const r = await request.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', status: 'booked', scheduled_at: inDays(3).toISOString(), guest_name: 'Early API' } });
  const id = (await r.json())[0].id;
  const start = await request.post(`${API}/rpc/start_booking`, { data: { p_id: id, p_reason: null } });
  expect(start.ok()).toBeFalsy();
  expect(JSON.stringify(await start.json())).toContain('give a reason');
  const direct = await request.patch(`${API}/bookings?id=eq.${id}`, { data: { status: 'in_progress' } });
  expect(direct.ok()).toBeFalsy();
  const ok = await request.post(`${API}/rpc/start_booking`, { data: { p_id: id, p_reason: 'Travelling on the booking day' } });
  expect(ok.ok()).toBeTruthy();
  expect((await ok.json()).moved).toBe(true);
});

test('front desk: early arrival needs a reason, then the booking moves to today', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const guest = `Early Bird ${tag}`;
  const when = inDays(2);
  await request.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', status: 'booked', scheduled_at: when.toISOString(), guest_name: guest } });

  await loginAs(page, request, 'owner');
  await page.goto(`/bookings`);
  const v = view(page);
  for (let i = 0; i < 2; i++) await v.getByRole('button', { name: 'Next day' }).click();
  const card = () => v.locator('.card.booking').filter({ hasText: guest });
  await expect(card()).toBeVisible();

  // cancel → nothing happens
  await card().getByRole('button', { name: 'Arrived / start' }).click();
  await expect(page.locator('ion-alert')).toContainText('This booking is for');
  await answerAlert(page, 'Cancel');
  await expect(card()).toContainText('booked');

  // no reason → refused
  await card().getByRole('button', { name: 'Arrived / start' }).click();
  await answerAlert(page, 'OK', '');
  await toast(page, 'A reason is needed');
  await expect(card()).toContainText('booked');

  // with a reason → checked in, moved to today
  await card().getByRole('button', { name: 'Arrived / start' }).click();
  await answerAlert(page, 'OK', 'Travelling on Thursday');
  await toast(page, 'Checked in early');
  await expect(card()).toHaveCount(0);
  await v.getByRole('button', { name: 'Today' }).click();
  await expect(card()).toContainText('in progress');
  await expect(card().getByTestId('early-note')).toContainText('Reason: Travelling on Thursday');
});

test('checkout of a future booking asks for the early reason first', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const r = await request.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', status: 'booked', scheduled_at: inDays(1).toISOString(), guest_name: `Early Pay ${tag}` } });
  const id = (await r.json())[0].id;
  await request.post(`${API}/booking_services`, { data: { booking_id: id, name: 'Gel', price: 500 } });
  const staff = await (await request.get(`${API}/staff?select=id&name=eq.Wanjiku Kamau`)).json();
  await request.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: staff[0].id } });

  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${id}`);
  const v = view(page);
  await expect(v.getByRole('cell', { name: 'Gel', exact: true })).toBeVisible();
  await v.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.locator('ion-alert')).toContainText('Client came early');
  await answerAlert(page, 'Cancel');
  const b = await (await request.get(`${API}/bookings?select=status&id=eq.${id}`)).json();
  expect(b[0].status).toBe('booked');
});
