import { APIRequestContext, expect, test } from '@playwright/test';
import { answerAlert, loginAs, toast, view } from './helpers';

// Roles the owner creates (with the screens they may open) and the finisher.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };
const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();

async function addStaff(request: APIRequestContext, name: string, roles: string[]): Promise<string> {
  const r = await request.post(`${API}/staff`, { headers: H, data: { name, roles, active: true } });
  return (await r.json())[0].id;
}
async function addBooking(request: APIRequestContext, data: Record<string, unknown>, crew: { id: string; part: string }[] = []) {
  const r = await request.post(`${API}/bookings`, { headers: H, data: { channel: 'salon', duration_min: 60, ...data } });
  const id = (await r.json())[0].id as string;
  for (const c of crew) await request.post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: c.id, part: c.part } });
  return id;
}
async function tokenFor(request: APIRequestContext, email: string, password: string) {
  const r = await request.post(`${API}/rpc/staff_login`, { data: { p_email: email, p_password: password } });
  return (await r.json()) as { status: string; token?: string };
}

test('owner creates a role with chosen screens; a new person approved into it only opens those', async ({ page, browser, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const roleName = `Washer ${tag}`;
  await loginAs(page, request, 'owner');
  await page.goto('/roles');
  const v = view(page);
  await expect(v.getByTestId('roles-title')).toBeVisible();
  await expect(v.getByTestId('role-owner')).toContainText('Every screen');
  await v.getByTestId('role-new').click();
  const form = page.getByTestId('role-form');
  await form.getByTestId('role-name').fill(roleName);
  await form.getByTestId('area-bookings').uncheck();   // starts with My day + Bookings
  await form.getByTestId('area-clients').check();
  await form.getByTestId('role-save').click();
  await toast(page, `Role "${roleName}" created`);
  const key = `washer_${tag}`;
  const card = v.getByTestId(`role-${key}`);
  await expect(card).toContainText('My day · Clients');

  // someone asks to join in that job, owner approves
  const email = `washer.${tag}@example.com`;
  const su = await request.post(`${API}/rpc/staff_signup`, { data: { p: { name: `Wash ${tag} Person`, email, password: 'secret12', role: key } } });
  expect(su.ok()).toBeTruthy();
  await page.goto('/staff-requests');
  const req = view(page).getByTestId('staff-request').filter({ hasText: `Wash ${tag} Person` });
  await expect(req).toContainText(`Wants: ${roleName}`);
  await req.getByTestId('approve').click();
  await toast(page, `approved as ${roleName}`);

  // the washer signs in: lands on My day, can open Clients, Bookings is refused
  const t = await tokenFor(request, email, 'secret12');
  expect(t.status).toBe('approved');
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 } });
  const w = await ctx.newPage();
  await w.addInitScript((tok) => localStorage.setItem('dbh.staff.token', tok), t.token!);
  await w.goto('/staff/sign-in');
  await w.goto('/clients');
  await expect(w).toHaveURL(/\/clients$/);
  await w.goto('/bookings');
  await expect(w).toHaveURL(/\/my-day$/);
  await expect(view(w).getByTestId('role-pill')).toHaveText(roleName);
  const tabs = w.getByTestId('staff-tabs');
  await expect(tabs.getByRole('link', { name: 'Clients' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Bookings' })).toHaveCount(0);
  await ctx.close();

  // the role can't be deleted while someone has it
  await page.goto('/roles');
  await view(page).getByTestId(`role-${key}`).click();
  await page.getByTestId('role-form').getByTestId('role-delete').click();
  await answerAlert(page, 'Delete');
  await expect(page.getByTestId('role-form')).toContainText('First move the 1 staff member');
});

test('built-in roles cannot be deleted and the owner role is fixed', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/roles');
  await view(page).getByTestId('role-stylist').click();
  const form = page.getByTestId('role-form');
  await expect(form.getByTestId('role-delete')).toHaveCount(0);
  await expect(form.getByTestId('area-my-day')).toBeChecked();
  await form.getByRole('button', { name: 'Cancel' }).click();
  await view(page).getByTestId('role-owner').click();
  await expect(page.getByTestId('role-form')).toContainText('The owner always has every screen');
  await expect(page.getByTestId('role-form').getByTestId('role-save')).toHaveCount(0);
});

test('finisher: assigned with the main stylist, shares the commission, sees "Finish for" on My day', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const main = await addStaff(request, `Main ${tag} Braider`, ['stylist']);
  const fin = await addStaff(request, `Fin ${tag} Finisher`, ['finisher']);
  const guest = `Braids ${tag}`;
  const bid = await addBooking(request, { status: 'booked', scheduled_at: at(30), guest_name: guest });
  await request.post(`${API}/booking_services`, { data: { booking_id: bid, name: 'Knotless', price: 1700 } });

  // desk assigns the main stylist and the finisher
  await loginAs(page, request, 'receptionist');
  await page.goto('/desk');
  const v = view(page);
  await expect(v.getByTestId('team-board').getByTestId(`team-${fin}`)).toContainText('Finisher');
  await v.locator('.p-card.p-row').filter({ hasText: guest }).getByRole('button', { name: 'Assign' }).click();
  const sheet = page.getByTestId('assign-sheet');
  await expect(sheet.getByTestId(`assign-${fin}`)).toHaveCount(0);       // finishers are not main stylists
  await sheet.getByTestId(`assign-${main}`).click();
  await sheet.getByTestId(`finisher-${fin}`).click();
  await sheet.getByTestId('assign-save').click();
  await toast(page, `Assigned to Main + finisher Fin`);
  await expect(v.locator('.p-card.p-row').filter({ hasText: guest })).toContainText('finisher Fin');

  // checkout: commission split 80 / 20 (finisher share setting)
  await page.goto(`/checkout?booking=${bid}`);
  const shares = view(page).getByRole('spinbutton', { name: 'Share percent' });
  await expect(shares).toHaveCount(2);
  await expect(shares.nth(0)).toHaveValue('80');
  await expect(shares.nth(1)).toHaveValue('20');
  await expect(view(page).getByText(`Fin ${tag} Finisher · finisher`)).toBeVisible();
});

test('finisher login lands on My day with jobs marked "Finish for" and no walk-in taking', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const staff = await (await request.get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  const faith = staff.find((s) => s.name === 'Faith Wambui')!.id;
  const wanjiku = staff.find((s) => s.name === 'Wanjiku Kamau')!.id;
  const guest = `Finish Me ${tag}`;
  await addBooking(request, { status: 'booked', scheduled_at: at(40), guest_name: guest }, [{ id: wanjiku, part: 'main' }, { id: faith, part: 'finisher' }]);
  await addBooking(request, { channel: 'walkin', status: 'waiting', guest_name: `Walk ${tag}` });

  await loginAs(page, request, 'finisher');
  await page.goto('/staff/sign-in');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/my-day$/);
  const v = view(page);
  await expect(v.getByTestId('role-pill')).toHaveText('Finisher');
  const job = v.getByTestId('my-job').filter({ hasText: guest });
  await expect(job.getByTestId('finish-for')).toHaveText('Finish for Wanjiku');
  await expect(v.getByTestId('walkin')).toHaveCount(0);
  await expect(page.getByTestId('staff-tabs').getByRole('link', { name: 'Checkout' })).toHaveCount(0);
});
