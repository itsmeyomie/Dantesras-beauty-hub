import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, StaffRoleName } from './helpers';

// Role lock-down: what the public (no sign-in) and each role may read or change in the database.

const API = 'http://localhost:54329/rest/v1';
const tokens: Record<string, string> = {};
async function as(request: APIRequestContext, role: StaffRoleName) {
  if (!tokens[role]) {
    const r = await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF[role], p_password: 'test1234' } });
    tokens[role] = (await r.json()).token;
  }
  return { 'x-staff-token': tokens[role] };
}
/** number of rows returned; a refusal (error) counts as 0 rows */
const rows = async (r: Awaited<ReturnType<APIRequestContext['get']>>) => { const j = await r.json(); return Array.isArray(j) ? j.length : 0; };

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'database rules – checked once'));

test('the public sees only the price list; private data and money actions are closed', async ({ request }) => {
  expect(await rows(await request.get(`${API}/services?select=id`))).toBeGreaterThan(0);
  expect(await rows(await request.get(`${API}/courses?select=id`))).toBeGreaterThan(0);
  for (const t of ['clients', 'sales', 'payments', 'staff', 'bookings', 'students', 'staff_earnings', 'v_debts']) {
    expect(await rows(await request.get(`${API}/${t}?select=*&limit=5`)), t).toBe(0);
  }
  const ins = await request.post(`${API}/bookings`, { data: { channel: 'salon', guest_name: 'Outsider' } });
  expect(ins.status()).toBeGreaterThanOrEqual(400);
  const co = await request.post(`${API}/rpc/checkout`, { data: { p: {} } });
  expect(JSON.stringify(await co.json())).toContain('sign in');
  const stk = await request.post(`${API}/rpc/stk_complete`, { data: { p_checkout_request_id: 'x', p_result_code: 0, p_result_desc: 'x' } });
  expect(stk.ok()).toBeFalsy();
  const set = await request.post(`${API}/settings`, { headers: { Prefer: 'resolution=merge-duplicates' }, data: { key: 'deposit_min', value: 1 } });
  expect(set.status()).toBeGreaterThanOrEqual(400);
  // a fake or expired token is the same as none
  expect(await rows(await request.get(`${API}/clients?select=id`, { headers: { 'x-staff-token': 'not-a-real-token' } }))).toBe(0);
});

test('stylist: own sales and earnings only; no reports, voids, prices or settings', async ({ request }) => {
  const h = await as(request, 'stylist');
  const own = await rows(await request.get(`${API}/sales?select=id`, { headers: h }));
  const all = await rows(await request.get(`${API}/sales?select=id`, { headers: await as(request, 'owner') }));
  expect(own).toBeLessThan(all);
  const me = (await (await request.post(`${API}/rpc/staff_me`, { data: { p_token: h['x-staff-token'] } })).json()).id;
  const earn = (await (await request.get(`${API}/staff_earnings?select=staff_id`, { headers: h })).json()) as { staff_id: string }[];
  expect(earn.every((e) => e.staff_id === me)).toBeTruthy();
  const rep = await request.post(`${API}/rpc/sales_report`, { headers: h, data: { p_from: '2026-01-01', p_to: '2026-12-31' } });
  expect(JSON.stringify(await rep.json())).toContain('Your role cannot do this');
  const sale = ((await (await request.get(`${API}/sales?select=id&limit=1`, { headers: h })).json()) as { id: string }[])[0];
  const v = await request.post(`${API}/rpc/void_sale`, { headers: h, data: { p_sale_id: sale.id, p_reason: 'test' } });
  expect(JSON.stringify(await v.json())).toContain('Your role cannot do this');
  const p = await request.patch(`${API}/services?id=not.is.null`, { headers: { ...h, Prefer: 'return=representation' }, data: { price: 1 } });
  expect(await rows(p)).toBe(0);
  const s = await request.post(`${API}/settings`, { headers: { ...h, Prefer: 'resolution=merge-duplicates' }, data: { key: 'deposit_min', value: 1 } });
  expect(s.status()).toBeGreaterThanOrEqual(400);
  // but day-to-day work is allowed: bookings and clients
  expect(await rows(await request.get(`${API}/bookings?select=id&limit=3`, { headers: h }))).toBeGreaterThan(0);
  expect(await rows(await request.get(`${API}/clients?select=id&limit=3`, { headers: h }))).toBeGreaterThan(0);
});

test('receptionist: sales and reports yes, settings and price list changes no; owner: everything', async ({ request }) => {
  const r = await as(request, 'receptionist');
  const rep = await request.post(`${API}/rpc/sales_report`, { headers: r, data: { p_from: '2026-01-01', p_to: '2026-12-31' } });
  expect(rep.ok()).toBeTruthy();
  const s = await request.post(`${API}/settings`, { headers: { ...r, Prefer: 'resolution=merge-duplicates' }, data: { key: 'deposit_min', value: 1 } });
  expect(s.status()).toBeGreaterThanOrEqual(400);
  const p = await request.patch(`${API}/services?id=not.is.null`, { headers: { ...r, Prefer: 'return=representation' }, data: { price: 1 } });
  expect(await rows(p)).toBe(0);

  const o = await as(request, 'owner');
  const ok = await request.post(`${API}/settings`, { headers: { ...o, Prefer: 'resolution=merge-duplicates' }, data: { key: 'late_minutes', value: 20 } });
  expect(ok.ok()).toBeTruthy();
});
