import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, choose, fill, loginAs, ownerApi, toast, view } from './helpers';
import { newPhone, signIn } from './portal-helpers';

// Staff pay rule "fixed amounts": salon fee, finisher, main stylist (KSh) – the owner keeps the rest.
// Settings defaults: salon 200, finisher 250, stylist 50% of the rest when a service has no stylist amount.
//   1,600 (no amounts on the service) → salon 200, finisher 250, stylist 575, owner keeps 575.
// Only the owner sees the split.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };

async function setRule(request: APIRequestContext, rule: 'percent' | 'fee_split') {
  const api = await ownerApi(request);
  for (const [key, value] of [['pay_rule', rule], ['salon_fee', 200], ['finisher_fee', 250], ['stylist_balance_pct', 50]] as const) {
    await api.post(`${API}/settings`, { headers: { Prefer: 'resolution=merge-duplicates' }, data: { key, value } });
  }
}
async function token(request: APIRequestContext, role: keyof typeof STAFF) {
  return (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF[role], p_password: 'test1234' } })).json()).token as string;
}
async function people(request: APIRequestContext) {
  const rows = await (await (await ownerApi(request)).get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  return { wanjiku: rows.find((s) => s.name === 'Wanjiku Kamau')!.id, faith: rows.find((s) => s.name === 'Faith Wambui')!.id };
}
/** an in-progress booking with Wanjiku (stylist) and Faith (finisher) */
async function job(request: APIRequestContext, guest: string, withFinisher = true, svc: { id?: string; name: string; price: number } = { name: 'Knotless', price: 1600 }) {
  const api = await ownerApi(request);
  const { wanjiku, faith } = await people(request);
  const r = await api.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', duration_min: 60, status: 'in_progress', scheduled_at: new Date().toISOString(), guest_name: guest } });
  const id = (await r.json())[0].id as string;
  await api.post(`${API}/booking_services`, { data: { booking_id: id, service_id: svc.id ?? null, name: svc.name, price: svc.price } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: wanjiku, part: 'main' } });
  if (withFinisher) await api.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: faith, part: 'finisher' } });
  return { id, wanjiku, faith };
}
/** commission per person on the sale of this booking, and the split kept on the sale (owner's view) */
async function earnings(request: APIRequestContext, bookingId: string) {
  const api = await ownerApi(request);
  const sale = (await (await api.get(`${API}/sales?select=id&booking_id=eq.${bookingId}`)).json())[0];
  const rows = await (await api.get(`${API}/staff_earnings?select=staff_id,amount&kind=eq.commission&sale_id=eq.${sale.id}`)).json() as { staff_id: string; amount: number }[];
  return { saleId: sale.id as string, by: Object.fromEntries(rows.map((r) => [r.staff_id, Number(r.amount)])) as Record<string, number> };
}
async function payAndFinish(page: import('@playwright/test').Page, amount: string) {
  const v = view(page);
  await fill(v.locator('app-payment-entry').first(), 'Amount', amount);
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(v.getByText('Sale recorded')).toBeVisible();
}

test.afterEach(async ({ request }) => {
  await setRule(request, 'percent'); // the other tests expect the commission % rule
});

test('owner switches on fixed amounts in Settings and sees the 1,600 example', async ({ page, request }) => {
  await setRule(request, 'percent');
  await loginAs(page, request, 'owner');
  await page.goto('/settings');
  const card = view(page).getByTestId('pay-card');
  await expect(card.getByTestId('finisher-share')).toBeVisible();
  await choose(page, card, 'How staff are paid', 'Fixed amounts');
  await expect(card.getByTestId('pay-example')).toContainText('main stylist KSh 575');
  await expect(card.getByTestId('pay-example')).toContainText('owner keeps KSh 575');
  await fill(card, 'Finisher fee', '300');
  await expect(card.getByTestId('pay-example')).toContainText('owner keeps KSh 550'); // 1,600 − 200 − 300 = 1,100 → 550 / 550
  await fill(card, 'Finisher fee', '250');
  await view(page).locator('ion-button').filter({ hasText: 'Save settings' }).click();
  await toast(page, 'Settings saved');
  const saved = await (await (await ownerApi(request)).get(`${API}/settings?key=eq.pay_rule`)).json();
  expect(saved[0].value).toBe('fee_split');
});

test('a service with its own amounts: 1,800 → salon 200, finisher 200, stylist 700, owner 700', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const api = await ownerApi(request);
  const cat = (await (await api.get(`${API}/service_categories?select=id&name=eq.Adult%20Hair`)).json())[0].id;
  const name = `Knotless 1800 ${Date.now().toString(36).slice(-4)}`;
  // the owner sets the amounts on the Service menu
  const [svc] = await (await api.post(`${API}/services?select=id`, { headers: { ...H, Prefer: 'return=representation' }, data: { category_id: cat, name, price: 1800 } })).json();
  await loginAs(page, request, 'owner');
  await page.goto('/services');
  await view(page).getByTestId('menu-search').locator('input').fill(name);
  await view(page).getByText(name).click();
  const m = page.locator('ion-modal.show-modal').last();
  await fill(m, 'Salon fee (KSh)', '200');
  await fill(m, 'Finisher (KSh)', '200');
  await fill(m, 'Main stylist (KSh)', '700');
  await expect(m.getByTestId('svc-pay-example')).toContainText('owner keeps KSh 700');
  await m.locator('ion-button').filter({ hasText: /^Save$/ }).click();
  await toast(page, 'Service saved');

  const { id, wanjiku, faith } = await job(request, `Amt ${Date.now().toString(36).slice(-5)}`, true, { id: svc.id, name, price: 1800 });
  await page.goto(`/checkout?booking=${id}`);
  const box = view(page).getByTestId('pay-split');
  await expect(box.getByTestId('split-salon-fee')).toHaveText('KSh 200');
  await expect(box.getByTestId('split-finisher')).toHaveText('KSh 200');
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 700');
  await expect(box.getByTestId('split-owner')).toHaveText('KSh 700');
  await payAndFinish(page, '1800');
  const e = await earnings(request, id);
  expect(e.by[wanjiku]).toBe(700);
  expect(e.by[faith]).toBe(200);
});

test('no amounts on the service: defaults 575 / 250; no finisher: stylist 700, owner 700', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const a = await job(request, `Split ${Date.now().toString(36).slice(-5)}`);
  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${a.id}`);
  let box = view(page).getByTestId('pay-split');
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 575');
  await expect(box.getByTestId('split-owner')).toHaveText('KSh 575');
  await payAndFinish(page, '1600');
  expect((await earnings(request, a.id)).by).toMatchObject({ [a.wanjiku]: 575, [a.faith]: 250 });

  const b = await job(request, `Solo ${Date.now().toString(36).slice(-5)}`, false);
  await page.goto(`/checkout?booking=${b.id}`);
  box = view(page).getByTestId('pay-split');
  await expect(box.getByTestId('split-finisher')).toHaveCount(0);
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 700');
  await expect(box.getByTestId('split-owner')).toHaveText('KSh 700');
  await payAndFinish(page, '1600');
  expect((await earnings(request, b.id)).by[b.wanjiku]).toBe(700);
});

test('owner types the amounts for one job; stylists and managers never see the split', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const { id, wanjiku, faith } = await job(request, `Own ${Date.now().toString(36).slice(-5)}`);
  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${id}`);
  const box = view(page).getByTestId('pay-split');
  await box.getByTestId('choice-change').click();
  await fill(box, 'Salon fee (KSh)', '300');
  await fill(box, 'Finisher (KSh)', '300');
  await fill(box, 'Main stylist (KSh)', '600');
  await expect(box.getByTestId('split-owner')).toHaveText('KSh 400');
  await payAndFinish(page, '1600');
  const e = await earnings(request, id);
  expect(e.by[wanjiku]).toBe(600);
  expect(e.by[faith]).toBe(300);

  // stylist: no split on screen, can't set one through the database
  const second = await job(request, `Sty ${Date.now().toString(36).slice(-5)}`);
  const ctx = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
  const sp = await ctx.newPage();
  await loginAs(sp, request, 'stylist');
  await sp.goto(`/checkout?booking=${second.id}`);
  await expect(view(sp).getByText('Complete sale')).toBeVisible();
  await expect(view(sp).getByTestId('pay-split')).toHaveCount(0);
  await ctx.close();
  const sty = await token(request, 'stylist');
  const r = await request.post(`${API}/rpc/checkout`, {
    headers: { 'x-staff-token': sty },
    data: { p: { booking_id: second.id, guest_name: 'x', channel: 'salon', discount: 0, items: [{ kind: 'service', name: 'Knotless', qty: 1, unit_price: 1600 }],
      staff: [{ staff_id: second.wanjiku, share_pct: 100 }], payments: [{ method: 'cash', amount: 1600 }], pay: { salon_fee: 0, finisher_fee: 0, stylist_amount: 1600 } } },
  });
  expect(r.ok()).toBeFalsy();
  expect(await r.text()).toContain('Only the owner');

  // manager: can't read the pay settings, the service amounts or a sale's split
  const man = await token(request, 'manager');
  const hdr = { headers: { 'x-staff-token': man } };
  expect(await (await request.get(`${API}/settings?select=key&key=in.(pay_rule,salon_fee,finisher_fee,stylist_balance_pct)`, hdr)).json()).toEqual([]);
  expect((await request.get(`${API}/services?select=salon_fee&limit=1`, hdr)).ok()).toBeFalsy();
  expect((await request.get(`${API}/services?select=stylist_fee&limit=1`, hdr)).ok()).toBeFalsy();
  expect((await request.get(`${API}/sales?select=pay_split&id=eq.${e.saleId}`, hdr)).ok()).toBeFalsy();
  expect(await (await request.post(`${API}/rpc/service_pay`, { ...hdr, data: {} })).json()).toEqual({});
  // … nor clients
  expect((await request.get(`${API}/services?select=finisher_fee&limit=1`)).ok()).toBeFalsy();
});

test('the client is told who her stylist and finisher are – no money', async ({ page, request }) => {
  const name = `Told ${Date.now().toString(36).slice(-5)}`;
  await signIn(page, newPhone(), name);
  const ptok = await page.evaluate(() => localStorage.getItem('dbh.portal.token'));
  const api = await ownerApi(request);
  const own = await token(request, 'owner');
  const client = (await (await request.post(`${API}/rpc/search_clients`, { headers: { 'x-staff-token': own }, data: { p_term: name } })).json())[0];
  const { wanjiku, faith } = await people(request);
  const when = new Date(Date.now() + 2 * 86400_000);
  when.setHours(14, 0, 0, 0);
  const [b] = await (await api.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', status: 'booked', scheduled_at: when.toISOString(), client_id: client.id } })).json();
  await api.post(`${API}/booking_services`, { data: { booking_id: b.id, name: 'Knotless', price: 1600 } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: b.id, staff_id: wanjiku, part: 'main' } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: b.id, staff_id: faith, part: 'finisher' } });

  const notes = await (await request.post(`${API}/rpc/portal_notifications`, { data: { p_token: ptok } })).json() as { title: string; body: string }[];
  const sty = notes.find((n) => n.title === 'Your stylist')!;
  const fin = notes.find((n) => n.title === 'Your finisher')!;
  expect(sty.body).toContain('Wanjiku Kamau will be your stylist');
  expect(fin.body).toContain('Faith Wambui will finish your hair');
  expect(JSON.stringify(notes)).not.toMatch(/KSh|\d{3,}\s*(bob|\/=)/);
});
