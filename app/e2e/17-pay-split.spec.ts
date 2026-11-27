import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, choose, fill, loginAs, ownerApi, toast, view } from './helpers';

// Staff pay rule "salon fee + finisher fee, then split the rest":
// 1,600 → salon fee 200, finisher 250, balance 1,150 split 50/50 → stylist 575, salon keeps 775.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };

async function setRule(request: APIRequestContext, rule: 'percent' | 'fee_split') {
  const api = await ownerApi(request);
  for (const [key, value] of [['pay_rule', rule], ['salon_fee', 200], ['finisher_fee', 250], ['stylist_balance_pct', 50]] as const) {
    await api.post(`${API}/settings`, { headers: { Prefer: 'resolution=merge-duplicates' }, data: { key, value } });
  }
}
async function people(request: APIRequestContext) {
  const rows = await (await (await ownerApi(request)).get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  return { wanjiku: rows.find((s) => s.name === 'Wanjiku Kamau')!.id, faith: rows.find((s) => s.name === 'Faith Wambui')!.id };
}
/** an in-progress booking for 1,600 with Wanjiku (stylist) and Faith (finisher) */
async function job(request: APIRequestContext, guest: string, withFinisher = true) {
  const api = await ownerApi(request);
  const { wanjiku, faith } = await people(request);
  const r = await api.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', duration_min: 60, status: 'in_progress', scheduled_at: new Date().toISOString(), guest_name: guest } });
  const id = (await r.json())[0].id as string;
  await api.post(`${API}/booking_services`, { data: { booking_id: id, name: 'Knotless', price: 1600 } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: wanjiku, part: 'main' } });
  if (withFinisher) await api.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: faith, part: 'finisher' } });
  return { id, wanjiku, faith };
}
/** commission per person on the sale of this booking */
async function earnings(request: APIRequestContext, bookingId: string) {
  const api = await ownerApi(request);
  const sale = (await (await api.get(`${API}/sales?select=id,pay_split&booking_id=eq.${bookingId}`)).json())[0];
  const rows = await (await api.get(`${API}/staff_earnings?select=staff_id,amount&kind=eq.commission&sale_id=eq.${sale.id}`)).json() as { staff_id: string; amount: number }[];
  return { split: sale.pay_split, by: Object.fromEntries(rows.map((r) => [r.staff_id, Number(r.amount)])) as Record<string, number> };
}

test.afterEach(async ({ request }) => {
  await setRule(request, 'percent'); // the other tests expect the commission % rule
});

test('owner switches on the fee split in Settings and sees the 1,600 example', async ({ page, request }) => {
  await setRule(request, 'percent');
  await loginAs(page, request, 'owner');
  await page.goto('/settings');
  const card = view(page).getByTestId('pay-card');
  await expect(card.getByTestId('finisher-share')).toBeVisible();
  await choose(page, card, 'How staff are paid', 'Salon fee + finisher fee');
  await expect(card.getByTestId('pay-example')).toContainText('salon keeps KSh 775');
  await expect(card.getByTestId('pay-example')).toContainText('stylist KSh 575');
  await fill(card, 'Finisher fee', '300');
  await expect(card.getByTestId('pay-example')).toContainText('salon keeps KSh 750'); // 1,600 − 200 − 300 = 1,100 → 550 / 550
  await fill(card, 'Finisher fee', '250');
  await view(page).locator('ion-button').filter({ hasText: 'Save settings' }).click();
  await toast(page, 'Settings saved');
  const saved = await (await (await ownerApi(request)).get(`${API}/settings?key=eq.pay_rule`)).json();
  expect(saved[0].value).toBe('fee_split');
});

test('checkout pays salon 775, stylist 575, finisher 250 on a 1,600 job', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const guest = `Split ${Date.now().toString(36).slice(-5)}`;
  const { id, wanjiku, faith } = await job(request, guest);
  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${id}`);
  const v = view(page);
  const box = v.getByTestId('pay-split');
  await expect(box.getByTestId('split-salon-fee')).toHaveText('KSh 200');
  await expect(box.getByTestId('split-finisher')).toHaveText('KSh 250');
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 575');
  await expect(box.getByTestId('split-salon')).toHaveText('KSh 775');
  await fill(v.locator('app-payment-entry').first(), 'Amount', '1600');
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(v.getByText('Sale recorded')).toBeVisible();
  const e = await earnings(request, id);
  expect(e.by[wanjiku]).toBe(575);
  expect(e.by[faith]).toBe(250);
  expect(e.split.salon_keeps).toBe(775);
});

test('no finisher: the finisher fee is not taken (stylist 700, salon 900)', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const { id, wanjiku } = await job(request, `Solo ${Date.now().toString(36).slice(-5)}`, false);
  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${id}`);
  const v = view(page);
  const box = v.getByTestId('pay-split');
  await expect(box.getByTestId('split-finisher')).toHaveCount(0);
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 700');
  await expect(box.getByTestId('split-salon')).toHaveText('KSh 900');
  await fill(v.locator('app-payment-entry').first(), 'Amount', '1600');
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(v.getByText('Sale recorded')).toBeVisible();
  expect((await earnings(request, id)).by[wanjiku]).toBe(700);
});

test('owner changes the pay for one job; a stylist cannot', async ({ page, request }) => {
  await setRule(request, 'fee_split');
  const { id, wanjiku, faith } = await job(request, `Own ${Date.now().toString(36).slice(-5)}`);
  await loginAs(page, request, 'owner');
  await page.goto(`/checkout?booking=${id}`);
  const v = view(page);
  const box = v.getByTestId('pay-split');
  await box.getByTestId('choice-change').click();
  await fill(box, 'Salon fee (KSh)', '300');
  await fill(box, 'Finisher fee (KSh)', '300');
  await fill(box, "Stylist's share", '60');
  await expect(box.getByTestId('split-stylist')).toHaveText('KSh 600'); // (1,600 − 600) × 60%
  await expect(box.getByTestId('split-salon')).toHaveText('KSh 700');
  await fill(v.locator('app-payment-entry').first(), 'Amount', '1600');
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(v.getByText('Sale recorded')).toBeVisible();
  const e = await earnings(request, id);
  expect(e.by[wanjiku]).toBe(600);
  expect(e.by[faith]).toBe(300);
  expect(e.split.chosen).toBe(true);

  // the stylist sees the split but cannot change it – not in the app, not through the database
  const second = await job(request, `Sty ${Date.now().toString(36).slice(-5)}`);
  const ctx = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL });
  const sp = await ctx.newPage();
  await loginAs(sp, request, 'stylist');
  await sp.goto(`/checkout?booking=${second.id}`);
  await expect(view(sp).getByTestId('split-stylist')).toHaveText('KSh 575');
  await expect(view(sp).getByTestId('choice-change')).toHaveCount(0);
  await ctx.close();
  const tok = (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF.stylist, p_password: 'test1234' } })).json()).token;
  const r = await request.post(`${API}/rpc/checkout`, {
    headers: { 'x-staff-token': tok },
    data: { p: { booking_id: second.id, guest_name: 'x', channel: 'salon', discount: 0, items: [{ kind: 'service', name: 'Knotless', qty: 1, unit_price: 1600 }],
      staff: [{ staff_id: second.wanjiku, share_pct: 100 }], payments: [{ method: 'cash', amount: 1600 }], pay: { salon_fee: 0, finisher_fee: 0, stylist_pct: 100 } } },
  });
  expect(r.ok()).toBeFalsy();
  expect(await r.text()).toContain('Only the owner or a manager');
});
