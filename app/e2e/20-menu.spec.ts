import { expect, test } from '@playwright/test';
import { STAFF, loginAs, ownerApi, toast, view } from './helpers';
import { newPhone, signIn } from './portal-helpers';

// Menu order (Washes first) and staff-only categories such as Finishers (hidden from clients).
// The menu is shared by both test projects, so changes are checked once (phone project).

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };
test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'shared menu – checked once'));

test('menu starts with Washes, Undos, Treatments, Nails, Kids, Adult; washes moved into Washes', async ({ request }) => {
  const cats = await (await request.get(`${API}/service_categories?select=name&order=sort`)).json();
  expect(cats.slice(0, 6).map((c: { name: string }) => c.name)).toEqual(['Washes', 'Locs & Undo', 'Treatments & Care', 'Nails', 'Kids Hair', 'Adult Hair']);
  const washes = await (await request.get(`${API}/services?select=name,service_categories!inner(name)&service_categories.name=eq.Washes`)).json();
  expect(washes.map((s: { name: string }) => s.name)).toContain('Wig wash');
});

test('a staff-only category (Finishers): staff see it, clients do not and cannot book it', async ({ page, request }) => {
  const api = await ownerApi(request);
  const name = `Finishers ${Date.now().toString(36).slice(-5)}`;
  const [cat] = await (await api.post(`${API}/service_categories`, { headers: H, data: { name, client_type: 'any', sort: 200, staff_only: true } })).json();
  const svc = `Finish ends ${Date.now().toString(36).slice(-4)}`;
  const [s] = await (await api.post(`${API}/services`, { headers: H, data: { category_id: cat.id, name: svc, price: 300 } })).json();

  // not signed in / a client: nothing
  expect(await (await request.get(`${API}/services?select=id&id=eq.${s.id}`)).json()).toEqual([]);
  expect(await (await request.get(`${API}/service_categories?select=id&id=eq.${cat.id}`)).json()).toEqual([]);
  // staff: there
  const tok = (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF.stylist, p_password: 'test1234' } })).json()).token;
  expect((await (await request.get(`${API}/services?select=id&id=eq.${s.id}`, { headers: { 'x-staff-token': tok } })).json()).length).toBe(1);

  // the client app's menu doesn't show it
  await signIn(page, newPhone(), 'Menu Client');
  await page.goto('/portal/book');
  await expect(view(page).getByText('Washes').first()).toBeVisible();
  await expect(view(page).getByText(name)).toHaveCount(0);
  await expect(view(page).getByText(svc)).toHaveCount(0);

  // an online booking can't take it
  const [b] = await (await api.post(`${API}/bookings`, { headers: H,
    data: { channel: 'salon', status: 'requested', online: true, scheduled_at: new Date(Date.now() + 86400_000).toISOString(), guest_name: 'Online x' } })).json();
  const r = await api.post(`${API}/booking_services`, { data: { booking_id: b.id, service_id: s.id, name: svc, price: 300 } });
  expect(r.ok()).toBeFalsy();
  expect(await r.text()).toContain('no longer offered');
  // the salon's own booking can
  const [b2] = await (await api.post(`${API}/bookings`, { headers: H,
    data: { channel: 'salon', status: 'booked', scheduled_at: new Date(Date.now() + 40 * 86400_000).toISOString(), guest_name: `Salon ${svc}` } })).json();
  expect((await api.post(`${API}/booking_services`, { data: { booking_id: b2.id, service_id: s.id, name: svc, price: 300 } })).ok()).toBeTruthy();
});

test('owner reorders the menu and switches staff only on the Service menu screen', async ({ page, request }) => {
  await loginAs(page, request, 'owner');
  await page.goto('/services');
  const heads = view(page).getByTestId('cat-head');
  await expect(heads.first()).toContainText('Washes');
  // move Washes down one, then back up
  await heads.first().getByTestId('cat-down').click();
  await expect(heads.nth(0)).toContainText('Locs & Undo');
  await expect(heads.nth(1)).toContainText('Washes');
  await heads.nth(1).getByTestId('cat-up').click();
  await expect(heads.nth(0)).toContainText('Washes');
  // staff only on Nails, then off again
  const nails = heads.filter({ hasText: 'Nails' });
  await nails.getByTestId('cat-staff-only').click();
  await toast(page, 'Nails: hidden from clients');
  await expect(nails.getByTestId('staff-only-pill')).toBeVisible();
  expect(await (await request.get(`${API}/service_categories?select=id&name=eq.Nails`)).json()).toEqual([]);
  await nails.getByTestId('cat-staff-only').click();
  await toast(page, 'Nails: clients can see and book it');
  expect((await (await request.get(`${API}/service_categories?select=id&name=eq.Nails`)).json()).length).toBe(1);
});

test('search: clients find a service in any category; the Service menu filters too', async ({ page, request }) => {
  await page.goto('/portal/book');
  const v = view(page);
  await v.getByTestId('service-search').fill('wig');
  const res = v.getByTestId('search-results');
  await expect(res.locator('[data-service="Wig wash"]')).toContainText('Washes');
  await res.locator('[data-service="Wig wash"] .p-add').click();
  await expect(res.locator('[data-service="Wig wash"] .p-add.on')).toBeVisible();
  await v.getByTestId('service-search').fill('zzqq');
  await expect(v.getByTestId('search-empty')).toBeVisible();

  await loginAs(page, request, 'owner');
  await page.goto('/services');
  const s = view(page);
  await s.getByTestId('menu-search').locator('input').fill('pedicure');
  await expect(s.getByTestId('cat-head')).toHaveCount(1);
  await expect(s.getByTestId('cat-head')).toContainText('Nails');
  await expect(s.getByText('Wig wash')).toHaveCount(0);
});
