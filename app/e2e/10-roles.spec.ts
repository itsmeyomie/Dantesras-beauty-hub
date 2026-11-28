import { APIRequestContext, expect, test } from '@playwright/test';
import { answerAlert, loginAs, toast, view, ownerApi } from './helpers';

// Roles the owner creates (with the screens they may open) and the finisher.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };
const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();

async function addStaff(request: APIRequestContext, name: string, roles: string[]): Promise<string> {
  const r = await (await ownerApi(request)).post(`${API}/staff?select=id`, { headers: H, data: { name, roles, active: true } });
  return (await r.json())[0].id;
}
async function addBooking(request: APIRequestContext, data: Record<string, unknown>, crew: { id: string; part: string }[] = []) {
  const r = await (await ownerApi(request)).post(`${API}/bookings`, { headers: H, data: { channel: 'salon', duration_min: 60, ...data } });
  const id = (await r.json())[0].id as string;
  for (const c of crew) await (await ownerApi(request)).post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: c.id, part: c.part } });
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

test('finisher: assigned with the main stylist, paid an amount, sees "Finish for" on My day', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const main = await addStaff(request, `Main ${tag} Braider`, ['stylist']);
  const fin = await addStaff(request, `Fin ${tag} Finisher`, ['finisher']);
  const guest = `Braids ${tag}`;
  const bid = await addBooking(request, { status: 'booked', scheduled_at: at(30), guest_name: guest });
  await (await ownerApi(request)).post(`${API}/booking_services`, { data: { booking_id: bid, name: 'Knotless', price: 1700 } });

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

  // checkout: both are on the job; pay is in amounts – no percentage shares to fill in
  await page.goto(`/checkout?booking=${bid}`);
  await expect(view(page).getByRole('spinbutton', { name: 'Share percent' })).toHaveCount(0);
  await expect(view(page).getByTestId('co-finisher')).toContainText(`Fin ${tag} Finisher`);
});

test('finisher login lands on My day with jobs marked "Finish for" and no walk-in taking', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const staff = await (await (await ownerApi(request)).get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
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

test('owner assigns an "any stylist" online request to a stylist + finisher; the stylist accepts it, the finisher sees it', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const staff = await (await (await ownerApi(request)).get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  const faith = staff.find((s) => s.name === 'Faith Wambui')!.id;
  const wanjiku = staff.find((s) => s.name === 'Wanjiku Kamau')!.id;
  const guest = `Anyone ${tag}`;
  const late = new Date(); late.setHours(23, 15, 0, 0);
  const bid = await addBooking(request, { status: 'requested', source: 'Online', scheduled_at: late.toISOString(), guest_name: guest });

  // owner: Bookings → Online → Assign stylist (main + finisher)
  await loginAs(page, request, 'owner');
  await page.goto('/bookings');
  const v = view(page);
  await v.locator('ion-segment-button').filter({ hasText: 'Online' }).click();
  const card = v.getByTestId('request').filter({ hasText: guest });
  await expect(card).toContainText('Any stylist');
  await card.getByTestId('request-assign').click();
  const sheet = page.getByTestId('assign-sheet');
  await sheet.getByTestId(`assign-${wanjiku}`).click();
  await sheet.getByTestId(`finisher-${faith}`).click();
  await sheet.getByTestId('assign-save').click();
  await toast(page, 'Assigned to Wanjiku + finisher Faith');
  await expect(v.getByTestId('request').filter({ hasText: guest })).toContainText('Asked for');
  const crew = await (await (await ownerApi(request)).get(`${API}/booking_staff?select=staff_id,part&booking_id=eq.${bid}`)).json() as { staff_id: string; part: string }[];
  expect(crew.find((c) => c.staff_id === wanjiku)?.part).toBe('main');
  expect(crew.find((c) => c.staff_id === faith)?.part).toBe('finisher');

  // the stylist sees it on Today and accepts it
  await loginAs(page, request, 'stylist');
  await page.goto('/my-day');
  const job = view(page).getByTestId('my-job').filter({ hasText: guest });
  await job.getByTestId('job-accept').click();
  await answerAlert(page, 'OK', '');
  await toast(page, /Accepted|Booking accepted/);
  await expect(job.getByTestId('job-accept')).toHaveCount(0);

  // the finisher sees it as "Finish for Wanjiku"
  await loginAs(page, request, 'finisher');
  await page.goto('/my-day');
  await expect(view(page).getByTestId('my-job').filter({ hasText: guest }).getByTestId('finish-for')).toHaveText('Finish for Wanjiku');
});

test('stylist adds a finisher to her own job, then hands the job to another stylist; only new people are notified', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const owner = await ownerApi(request);
  const staff = await (await owner.get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  const faith = staff.find((s) => s.name === 'Faith Wambui')!.id;
  const wanjiku = staff.find((s) => s.name === 'Wanjiku Kamau')!.id;
  const other = await addStaff(request, `Other ${tag} Stylist`, ['stylist']);
  const guest = `Handover ${tag}`;
  const late = new Date(); late.setHours(23, 30, 0, 0);
  const bid = await addBooking(request, { status: 'booked', scheduled_at: late.toISOString(), guest_name: guest }, [{ id: wanjiku, part: 'main' }]);
  const tok: Record<string, string> = {};
  for (const [who, email] of [[wanjiku, "stylist@dantesras.test"], [faith, "finisher@dantesras.test"]]) {
    tok[who] = (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: email, p_password: "test1234" } })).json()).token;
  }
  const notes = async (who: string) =>
    ((await (await request.post(`${API}/rpc/staff_notifications`, { data: { p_token: tok[who] } })).json()) as { title: string; body: string }[])
      .filter((n) => n.body.includes(guest));
  expect(await notes(wanjiku)).toHaveLength(1);

  await loginAs(page, request, 'stylist');
  await page.goto('/my-day');
  const v = view(page);
  const job = () => v.getByTestId('my-job').filter({ hasText: guest });
  const sheet = page.getByTestId('assign-sheet');

  // 1) add a finisher, keep the job
  await job().getByTestId('job-handover').click();
  await expect(sheet.getByTestId(`assign-${wanjiku}`)).toHaveClass(/on/);
  await sheet.getByTestId(`finisher-${faith}`).click();
  await sheet.getByTestId('assign-save').click();
  await toast(page, 'Assigned to Wanjiku + finisher Faith');
  await expect(job()).toBeVisible();
  expect(await notes(wanjiku)).toHaveLength(1);                 // not notified again
  expect((await notes(faith)).map((n) => n.title)).toEqual(['You finish a client']);

  // 2) hand the job to another stylist (the finisher stays)
  await job().getByTestId('job-handover').click();
  await sheet.getByTestId(`assign-${other}`).click();
  await sheet.getByTestId('assign-save').click();
  await toast(page, 'Assigned to Other + finisher Faith');
  await expect(job()).toHaveCount(0);                            // no longer on my day
  const crew = await (await owner.get(`${API}/booking_staff?select=staff_id,part&booking_id=eq.${bid}`)).json() as { staff_id: string; part: string }[];
  expect(crew.map((c) => `${c.staff_id}:${c.part}`).sort()).toEqual([`${faith}:finisher`, `${other}:main`].sort());
  expect(await notes(faith)).toHaveLength(1);
});

test('finishers cannot hand over a job', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const staff = await (await (await ownerApi(request)).get(`${API}/staff?select=id,name&name=in.(Faith Wambui,Wanjiku Kamau)`)).json() as { id: string; name: string }[];
  const faith = staff.find((s) => s.name === 'Faith Wambui')!.id;
  const wanjiku = staff.find((s) => s.name === 'Wanjiku Kamau')!.id;
  const guest = `NoHand ${tag}`;
  await addBooking(request, { status: 'booked', scheduled_at: at(50), guest_name: guest }, [{ id: wanjiku, part: 'main' }, { id: faith, part: 'finisher' }]);
  await loginAs(page, request, 'finisher');
  await page.goto('/my-day');
  const job = view(page).getByTestId('my-job').filter({ hasText: guest });
  await expect(job.getByTestId('finish-for')).toBeVisible();
  await expect(job.getByTestId('job-handover')).toHaveCount(0);
});
