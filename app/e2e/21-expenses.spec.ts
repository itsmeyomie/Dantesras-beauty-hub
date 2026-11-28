import { APIRequestContext, Page, expect, test } from '@playwright/test';
import { STAFF, answerAlert, choose, fill, loginAs, modal, toast, view } from './helpers';

// Expense module – the acceptance tests of the brief.
// "Jane" = Wanjiku Kamau (stylist@…), another staff member = Joy Atieno (reception@…), owner = owner@….
// Money figures are read before and after (the test database is shared), so each test checks the change it makes.
// Runs once (phone project): the totals are shared.

const API = 'http://localhost:54329/rest/v1';
test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'shared money totals – checked once'));

const tokens: Partial<Record<keyof typeof STAFF, string>> = {};
async function tok(request: APIRequestContext, role: keyof typeof STAFF) {
  return (tokens[role] ??= (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF[role], p_password: 'test1234' } })).json()).token as string);
}
async function rpc(request: APIRequestContext, role: keyof typeof STAFF, fn: string, data: Record<string, unknown> = {}) {
  return request.post(`${API}/rpc/${fn}`, { headers: { 'x-staff-token': await tok(request, role) }, data });
}
type Exp = { id: string; description: string; amount: number; approval_status: string; payment_source: string; rejection_reason: string | null;
  outside_buy_id: string | null; reimbursement: null | { id: string; amount_owed: number; amount_paid: number; outstanding: number; status: string; payments: unknown[] } };
async function all(request: APIRequestContext) {
  return (await (await rpc(request, 'owner', 'exp_all')).json()) as { expenses: Exp[]; payments: { amount: number }[] };
}
async function figures(request: APIRequestContext) {
  const a = await all(request);
  const appr = a.expenses.filter((e) => e.approval_status === 'APPROVED');
  return {
    total: appr.reduce((s, e) => s + Number(e.amount), 0),
    reimbursedPaid: a.payments.reduce((s, p) => s + Number(p.amount), 0),
    outstanding: a.expenses.reduce((s, e) => s + (e.reimbursement ? Number(e.reimbursement.outstanding) : 0), 0),
  };
}
const find = async (request: APIRequestContext, desc: string) => (await all(request)).expenses.find((e) => e.description === desc)!;
async function category(request: APIRequestContext, name: string) {
  return ((await (await rpc(request, 'owner', 'exp_categories')).json()) as { id: string; name: string }[]).find((c) => c.name === name)!.id;
}
const tag = () => Date.now().toString(36).slice(-5);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function payBack(page: Page, desc: string, amount: string) {
  const v = view(page);
  await v.getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Reimbursements' }).click();
  await v.getByTestId('reimb-row').filter({ hasText: desc }).getByTestId('reimb-pay').click();
  const m = modal(page);
  await fill(m, 'Paying now', amount);
  await choose(page, m, 'How', 'M-Pesa');
  await m.getByTestId('pay-save').click();
  await answerAlert(page, 'Record');
}

test('Tests 1–4: Jane submits KSh 2,000, owner approves, pays back 1,000 then 1,000 – the expense stays 2,000', async ({ page, request, browser }) => {
  const desc = `Electricity tokens ${tag()}`;
  const before = await figures(request);

  // TEST 1 – Jane submits in the app
  await loginAs(page, request, 'stylist');
  await page.goto('/expenses');
  const v = view(page);
  await v.getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Add expense' }).click();
  await fill(v, 'What was it for?', desc);
  await fill(v, 'Amount (KSh)', '2000');
  await choose(page, v, 'Category', 'Electricity');
  await v.getByTestId('exp-submit').click();
  await toast(page, 'Sent to the owner for approval');
  const mine = v.getByTestId('my-expense').filter({ hasText: desc });
  await expect(mine.getByTestId('my-status')).toHaveText('Pending approval');
  // another staff member cannot see it
  const joy = await (await rpc(request, 'receptionist', 'exp_mine')).json();
  expect(JSON.stringify(joy)).not.toContain(desc);
  // the owner sees it as pending; pending money is not in salon expenses
  const pend = await find(request, desc);
  expect(pend.approval_status).toBe('PENDING');
  expect(pend.payment_source).toBe('STAFF_PERSONAL');
  expect((await figures(request)).total).toBe(before.total);

  // TEST 2 – owner approves in the app
  const owner = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await loginAs(owner, request, 'owner');
  await owner.goto('/expenses?tab=approvals');
  const ov = view(owner);
  await ov.getByTestId('approval').filter({ hasText: desc }).getByTestId('approve').click();
  await answerAlert(owner, 'Approve');
  await toast(owner, 'Approved');
  let e = await find(request, desc);
  expect(e.approval_status).toBe('APPROVED');
  expect(e.reimbursement).toMatchObject({ amount_owed: 2000, amount_paid: 0, outstanding: 2000, status: 'PENDING' });
  let f = await figures(request);
  expect(f.total).toBe(before.total + 2000);
  expect(f.outstanding).toBe(before.outstanding + 2000);

  // TEST 3 – part payment 1,000
  await payBack(owner, desc, '1000');
  await toast(owner, 'still owed');
  e = await find(request, desc);
  expect(e.amount).toBe(2000);
  expect(e.reimbursement).toMatchObject({ amount_paid: 1000, outstanding: 1000, status: 'PARTIALLY_REIMBURSED' });
  f = await figures(request);
  expect(f.total).toBe(before.total + 2000); // paying back is not another expense
  expect(f.outstanding).toBe(before.outstanding + 1000);
  expect(f.reimbursedPaid).toBe(before.reimbursedPaid + 1000);

  // TEST 4 – the rest
  await payBack(owner, desc, '1000');
  await toast(owner, 'paid back in full');
  e = await find(request, desc);
  expect(e.reimbursement).toMatchObject({ amount_paid: 2000, outstanding: 0, status: 'FULLY_REIMBURSED' });
  expect(e.reimbursement!.payments.length).toBe(2); // two separate payments
  f = await figures(request);
  expect(f.total).toBe(before.total + 2000);
  expect(f.outstanding).toBe(before.outstanding);
  // a fully paid expense takes no more payments
  const more = await rpc(request, 'owner', 'exp_reimburse', { p: { reimbursement_id: e.reimbursement!.id, amount: 1, method: 'cash', paid_on: today() } });
  expect(await more.text()).toContain('already been paid back in full');
  await owner.context().close();

  // Jane sees it paid back, with both payments
  await page.reload();
  await expect(view(page).getByTestId('my-expense').filter({ hasText: desc }).getByTestId('my-status')).toHaveText('Fully reimbursed');
  await expect(view(page).getByTestId('my-expense').filter({ hasText: desc }).locator('table tr')).toHaveCount(2);
});

test('Test 5: owner records a KSh 2,000 water bill from salon funds – no reimbursement', async ({ page, request }) => {
  const desc = `Water bill ${tag()}`;
  const before = await figures(request);
  await loginAs(page, request, 'owner');
  await page.goto('/expenses');
  await view(page).getByTestId('exp-add-owner').click();
  const m = modal(page);
  await fill(m, 'What was it for?', desc);
  await fill(m, 'Amount (KSh)', '2000');
  await choose(page, m, 'Category', 'Water');
  await m.getByTestId('f-save').click();
  await toast(page, 'Expense added');
  const e = await find(request, desc);
  expect(e).toMatchObject({ approval_status: 'APPROVED', payment_source: 'SALON_FUNDS', reimbursement: null });
  const f = await figures(request);
  expect(f.total).toBe(before.total + 2000);
  expect(f.outstanding).toBe(before.outstanding);
  await expect(view(page).getByTestId('tot-expenses')).toBeVisible();
});

test('Test 6: owner rejects with a reason – not counted, nothing owed', async ({ page, request }) => {
  const desc = `Snacks ${tag()}`;
  const cat = await category(request, 'Other Expenses');
  await rpc(request, 'stylist', 'exp_submit', { p: { description: desc, amount: 450, category_id: cat, expense_date: today() } });
  const before = await figures(request);
  await loginAs(page, request, 'owner');
  await page.goto('/expenses?tab=approvals');
  await view(page).getByTestId('approval').filter({ hasText: desc }).getByTestId('reject').click();
  await answerAlert(page, 'OK', 'Not a salon expense');
  await toast(page, 'Rejected');
  const e = await find(request, desc);
  expect(e).toMatchObject({ approval_status: 'REJECTED', rejection_reason: 'Not a salon expense', reimbursement: null });
  expect(await figures(request)).toEqual(before);
  // a reason is required
  const desc2 = `No reason ${tag()}`;
  const s2 = await (await rpc(request, 'stylist', 'exp_submit', { p: { description: desc2, amount: 100, category_id: cat, expense_date: today() } })).json();
  expect(await (await rpc(request, 'owner', 'exp_decide', { p_id: s2.id, p_approve: false, p_reason: '' })).text()).toContain('Give a reason');
});

test('Test 7: staff see only their own; cannot approve, pay, or read the tables', async ({ page, request }) => {
  const cat = await category(request, 'Cleaning Supplies');
  const s = await (await rpc(request, 'stylist', 'exp_submit', { p: { description: `Soap ${tag()}`, amount: 300, category_id: cat, expense_date: today() } })).json();
  for (const [fn, data] of [['exp_all', {}], ['exp_decide', { p_id: s.id, p_approve: true }], ['exp_add', { p: { description: 'x', amount: 1, category_id: cat, expense_date: today() } }],
    ['exp_audit', { p_expense: s.id }], ['exp_category_save', { p: { name: 'Hack' } }]] as const) {
    const r = await rpc(request, 'stylist', fn, data);
    expect(r.ok(), fn).toBeFalsy();
    expect(await r.text(), fn).toContain('Only the owner');
  }
  // the owner approves; the stylist still cannot pay herself back
  await rpc(request, 'owner', 'exp_decide', { p_id: s.id, p_approve: true });
  const e = await find(request, `${(await find(request, s.description)).description}`);
  const r = await rpc(request, 'stylist', 'exp_reimburse', { p: { reimbursement_id: e.reimbursement!.id, amount: 300, method: 'cash', paid_on: today() } });
  expect(await r.text()).toContain('Only the owner');
  // the owner cannot approve her own expense either (only staff submit; owner entries are approved when recorded)
  // tables are closed to everyone in the app
  for (const t of ['expenses', 'staff_reimbursements', 'reimbursement_payments', 'expense_audit', 'expense_categories']) {
    const q = await request.get(`${API}/${t}?select=*&limit=1`, { headers: { 'x-staff-token': await tok(request, 'stylist') } });
    expect(q.ok(), t).toBeFalsy();
  }
  // staff only ever get their own list
  const joy = await (await rpc(request, 'receptionist', 'exp_mine')).json();
  expect(joy.expenses.every((x: { paid_by_name: string }) => x.paid_by_name === 'Joy Atieno')).toBe(true);
  // the staff screen has no totals for the salon
  await loginAs(page, request, 'stylist');
  await page.goto('/expenses');
  await expect(view(page).getByTestId('my-summary')).toBeVisible();
  await expect(view(page).getByTestId('tot-expenses')).toHaveCount(0);
  await expect(view(page).getByTestId('exp-tabs')).toHaveText(/^\s*My expenses\s*Add expense\s*$/);
});

test('Test 8: payments can not be doubled, overpaid or raced; history stays', async ({ request }) => {
  const cat = await category(request, 'Transport and Delivery');
  const desc = `Delivery ${tag()}`;
  const s = await (await rpc(request, 'stylist', 'exp_submit', { p: { description: desc, amount: 300, category_id: cat, expense_date: today() } })).json();
  await rpc(request, 'owner', 'exp_decide', { p_id: s.id, p_approve: true });
  const rid = (await find(request, desc)).reimbursement!.id;
  const pay = (amount: number, key: string) => rpc(request, 'owner', 'exp_reimburse', { p: { reimbursement_id: rid, amount, method: 'mpesa', paid_on: today(), request_key: key } });
  expect(await (await pay(0, crypto.randomUUID())).text()).toContain('above 0');
  expect(await (await pay(301, crypto.randomUUID())).text()).toContain('more than what is still owed');
  // the same payment sent twice is recorded once
  const key = crypto.randomUUID();
  expect((await pay(100, key)).ok()).toBeTruthy();
  expect(await (await pay(100, key)).text()).toContain('already recorded');
  // two payments of the full rest at the same moment: only one goes through
  const [a, b] = await Promise.all([pay(200, crypto.randomUUID()), pay(200, crypto.randomUUID())]);
  expect([a.ok(), b.ok()].filter(Boolean).length).toBe(1);
  const e = await find(request, desc);
  expect(e.reimbursement).toMatchObject({ amount_paid: 300, outstanding: 0, status: 'FULLY_REIMBURSED' });
  expect(e.reimbursement!.payments.length).toBe(2);
  expect(e.amount).toBe(300);
  // the history keeps every step
  const audit = await (await rpc(request, 'owner', 'exp_audit', { p_expense: s.id })).json() as { action: string }[];
  expect(audit.map((x) => x.action)).toEqual(['EXPENSE_CREATED', 'EXPENSE_APPROVED', 'REIMBURSEMENT_OWED', 'PARTIAL_REIMBURSEMENT', 'FULL_REIMBURSEMENT']);
});

test('a shop paid in "Bought outside" becomes a salon expense; categories can be switched off', async ({ page, request }) => {
  const owner = { headers: { 'x-staff-token': await tok(request, 'owner') } };
  const item = `Braids 1B ${tag()}`;
  const [o] = await (await request.post(`${API}/outside_buys?select=id`, { ...owner, headers: { ...owner.headers, Prefer: 'return=representation' },
    data: { shop: 'Mama Njeri', item, cost: 800 } })).json();
  const before = await figures(request);
  await request.patch(`${API}/outside_buys?id=eq.${o.id}`, { ...owner, data: { paid_at: new Date().toISOString(), paid_method: 'cash' } });
  const e = await find(request, `Bought outside: ${item} (Mama Njeri)`);
  expect(e).toMatchObject({ amount: 800, approval_status: 'APPROVED', payment_source: 'SALON_FUNDS', outside_buy_id: o.id, reimbursement: null });
  expect((await figures(request)).total).toBe(before.total + 800);

  // categories: the owner switches one off – staff can't pick it, old expenses keep it
  await loginAs(page, request, 'owner');
  await page.goto('/expenses');
  await view(page).getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Categories' }).click();
  const row = view(page).getByTestId('exp-cat').filter({ hasText: 'Marketing' });
  await row.locator('ion-toggle').click();
  await toast(page, 'Marketing switched off');
  const staffCats = await (await rpc(request, 'stylist', 'exp_categories')).json() as { name: string }[];
  expect(staffCats.map((c) => c.name)).not.toContain('Marketing');
  await row.locator('ion-toggle').click();
  await toast(page, 'Marketing back in use');
});

test('owner reports: export Excel and PDF', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/expenses');
  await view(page).getByTestId('exp-tabs').locator('ion-segment-button', { hasText: 'Reports' }).click();
  await expect(view(page).getByTestId('report-table').first()).toContainText('Total salon expenses');
  const [x] = await Promise.all([page.waitForEvent('download'), view(page).getByTestId('export-excel').click()]);
  expect(x.suggestedFilename()).toMatch(/^dantesras-expenses-.*\.csv$/);
  const [p] = await Promise.all([page.waitForEvent('download'), view(page).getByTestId('export-pdf').click()]);
  expect(p.suggestedFilename()).toMatch(/\.pdf$/);
});
