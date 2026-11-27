import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, loginAs, modal, ownerApi, toast, view } from './helpers';

// Client phone numbers (and WhatsApp / email) are for the OWNER only. Staff see names.
// Lucy Akinyi (dummy data) has phone 0722100002.

const API = 'http://localhost:54329/rest/v1';
const LUCY_PHONE = '0722100002';

async function token(request: APIRequestContext, role: keyof typeof STAFF) {
  return (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF[role], p_password: 'test1234' } })).json()).token as string;
}
const as = (tok: string) => ({ headers: { 'x-staff-token': tok } });

test('the database gives client numbers to the owner only', async ({ request }) => {
  const rec = await token(request, 'receptionist');
  const own = await token(request, 'owner');
  const lucy = (await (await request.get(`${API}/clients?select=id,name&name=eq.Lucy%20Akinyi`, as(rec))).json())[0];
  expect(lucy.name).toBe('Lucy Akinyi');

  // staff: the number can't be read, filtered on, or pulled through a booking / debt / helper
  for (const sel of ['phone', 'whatsapp', 'email', '*']) {
    const r = await request.get(`${API}/clients?select=${sel}&id=eq.${lucy.id}`, as(rec));
    expect(r.ok(), sel).toBeFalsy();
  }
  expect((await request.get(`${API}/clients?select=id&phone=eq.${LUCY_PHONE}`, as(rec))).ok()).toBeFalsy();
  expect((await request.get(`${API}/bookings?select=id,clients(phone)&limit=1`, as(rec))).ok()).toBeFalsy();
  const debts = await (await request.get(`${API}/v_debts?select=client_phone`, as(rec))).json();
  expect(debts.length).toBeGreaterThan(0);
  expect(debts.every((d: { client_phone: string | null }) => d.client_phone === null)).toBe(true);
  expect((await request.get(`${API}/mpesa_stk_requests?select=phone`, as(rec))).ok()).toBeFalsy();
  expect(await (await request.post(`${API}/rpc/client_contacts`, { ...as(rec), data: { p_ids: [lucy.id] } })).json()).toEqual({});
  const got = await (await request.post(`${API}/rpc/get_client`, { ...as(rec), data: { p_id: lucy.id } })).json();
  expect(got.name).toBe('Lucy Akinyi');
  expect(got.phone).toBeUndefined();
  // search: by name yes (no number in the answer); by part of a number no; by the full number yes (name only)
  const byName = await (await request.post(`${API}/rpc/search_clients`, { ...as(rec), data: { p_term: 'Lucy' } })).json();
  expect(byName[0].phone).toBeUndefined();
  expect(await (await request.post(`${API}/rpc/search_clients`, { ...as(rec), data: { p_term: '0722100' } })).json()).toEqual([]);
  const byFull = await (await request.post(`${API}/rpc/search_clients`, { ...as(rec), data: { p_term: '0722 100 002' } })).json();
  expect(byFull.map((c: { name: string }) => c.name)).toEqual(['Lucy Akinyi']);
  // a saved number can't be changed by staff
  const ch = await request.patch(`${API}/clients?id=eq.${lucy.id}`, { ...as(rec), data: { phone: '0711000000' } });
  expect(ch.ok()).toBeFalsy();
  expect(await ch.text()).toContain('Only the owner');

  // owner: everything
  const c = await (await request.post(`${API}/rpc/client_contacts`, { ...as(own), data: { p_ids: [lucy.id] } })).json();
  expect(c[lucy.id].phone).toBe(LUCY_PHONE);
  const od = await (await request.get(`${API}/v_debts?select=client_phone`, as(own))).json();
  expect(od.some((d: { client_phone: string | null }) => !!d.client_phone)).toBe(true);
  const os = await (await request.post(`${API}/rpc/search_clients`, { ...as(own), data: { p_term: '0722100' } })).json();
  expect(os.map((x: { phone: string }) => x.phone)).toContain(LUCY_PHONE);
});

test('staff screens show names only; the owner still sees the number', async ({ page, request }) => {
  const api = await ownerApi(request);
  const lucy = (await (await api.get(`${API}/clients?select=id&name=eq.Lucy%20Akinyi`)).json())[0];

  await loginAs(page, request, 'receptionist');
  await page.goto('/clients');
  await expect(view(page).getByText('Lucy Akinyi').first()).toBeVisible();
  await expect(view(page).locator('th', { hasText: 'Phone' })).toHaveCount(0);
  await expect(view(page).getByText(LUCY_PHONE)).toHaveCount(0);
  await page.goto(`/clients/${lucy.id}`);
  await expect(view(page).getByTestId('number-hidden')).toHaveText(/Only the owner sees it/);
  await expect(view(page).getByText(LUCY_PHONE)).toHaveCount(0);
  // editing her details keeps the saved number
  await view(page).locator('ion-button').filter({ hasText: 'Edit' }).click();
  const m = modal(page);
  await expect(m.getByTestId('number-hidden')).toBeVisible();
  await m.locator('ion-textarea textarea').fill('Prefers short knotless');
  await m.locator('ion-button').filter({ hasText: 'Save client' }).click();
  await toast(page, 'Client saved');
  const ownTok = await token(request, 'owner');
  const after = await (await request.post(`${API}/rpc/client_contacts`, { ...as(ownTok), data: { p_ids: [lucy.id] } })).json();
  expect(after[lucy.id].phone).toBe(LUCY_PHONE);
  await page.goto('/bookings');
  await expect(view(page).getByText(LUCY_PHONE)).toHaveCount(0);

  const op = await (await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await loginAs(op, request, 'owner');
  await op.goto(`/clients/${lucy.id}`);
  await expect(view(op).getByText(LUCY_PHONE).first()).toBeVisible();
  await op.context().close();
});

test('reception sends an M-Pesa prompt to the saved number without seeing it', async ({ page, request }) => {
  await loginAs(page, request, 'receptionist');
  await page.goto('/debts');
  const row = view(page).locator('table.t tr').filter({ has: page.locator('ion-button', { hasText: 'Pay' }) }).first();
  await expect(row).toBeVisible();
  await row.locator('ion-button').filter({ hasText: 'Pay' }).click();
  const sheet = modal(page);
  await expect(sheet.getByTestId('stk-phone').locator('input')).toHaveValue('');
  await sheet.getByTestId('stk-amount').locator('input').fill('50');
  await sheet.getByTestId('stk-send').click();
  await expect(sheet.getByText("Prompt sent to the client's saved number")).toBeVisible();
  await expect(sheet.getByText(/07\d\d \d{3} \d{3}/)).toHaveCount(0);
  const phone = sheet.getByTestId('sim-phone');
  await phone.getByLabel('M-Pesa PIN').fill('1234');
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(sheet.getByText(/received/)).toBeVisible({ timeout: 15_000 });
});
