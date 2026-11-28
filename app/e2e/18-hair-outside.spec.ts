import { APIRequestContext, expect, test } from '@playwright/test';
import { STAFF, choose, fill, goToBookingDay, loginAs, modal, ownerApi, segment, toast, view } from './helpers';

// Home service hair (salon brings it → on her bill, out of stock), things bought from outside shops
// (paid in the evening), and stylists told about a client (once, also when the client is already in the chair).

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };
const tag = () => `${test.info().project.name}-${Date.now().toString(36).slice(-5)}`;

async function token(request: APIRequestContext, role: keyof typeof STAFF) {
  return (await (await request.post(`${API}/rpc/staff_login`, { data: { p_email: STAFF[role], p_password: 'test1234' } })).json()).token as string;
}
async function wanjiku(request: APIRequestContext) {
  return (await (await (await ownerApi(request)).get(`${API}/staff?select=id&name=eq.Wanjiku%20Kamau`)).json())[0].id as string;
}
/** a client in the chair now, 1,600 Knotless with Wanjiku */
async function inChair(request: APIRequestContext, guest: string) {
  const api = await ownerApi(request);
  const [b] = await (await api.post(`${API}/bookings`, { headers: H,
    data: { channel: 'walkin', duration_min: 60, status: 'in_progress', scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(), guest_name: guest } })).json();
  await api.post(`${API}/booking_services`, { data: { booking_id: b.id, name: 'Knotless', price: 1600 } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: b.id, staff_id: await wanjiku(request), part: 'main' } });
  return b.id as string;
}
async function stylistNotes(request: APIRequestContext, text: string) {
  const r = await request.post(`${API}/rpc/staff_notifications`, { data: { p_token: await token(request, 'stylist') } });
  return ((await r.json()) as { title: string; body: string }[]).filter((n) => n.body.includes(text));
}

test('home service: salon brings the hair – shown to the stylist, on her bill, out of stock', async ({ page, request }) => {
  const api = await ownerApi(request);
  const stock = async () => Number((await (await api.get(`${API}/products?select=stock_qty&name=eq.Kanekalon%20braid%20hair`)).json())[0].stock_qty);
  const before = await stock();
  const note = `hair-${tag()}`;

  await loginAs(page, request, 'owner');
  await page.goto('/bookings');
  await goToBookingDay(page, test.info().project.name);
  await view(page).locator('ion-button').filter({ hasText: 'New' }).click();
  const m = modal(page);
  await segment(m, 'Home service');
  await m.locator('ion-searchbar input').fill('Lucy');
  await m.locator('.result').filter({ hasText: 'Lucy Akinyi' }).click();
  await choose(page, m, 'Service', /Nails: Refill$/);
  await m.locator('ion-button').filter({ hasText: /^Add$/ }).click();
  await fill(m, 'Time', '13:00');
  await fill(m, 'Client location / address', 'Membley, House 4');
  await fill(m, 'Notes', note);
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Choose who brings the hair');

  await segment(m.getByTestId('hair-source'), 'Salon brings hair');
  await choose(page, m, 'Hair from stock', /Kanekalon/);
  await fill(m, 'Packets / pieces', '2');
  await m.getByTestId('hair-add').click();
  await expect(m.getByTestId('hair-line')).toContainText('Kanekalon braid hair × 2');
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Booking saved');
  const card = view(page).locator('.card.booking').filter({ hasText: note });
  await expect(card.getByTestId('hair-note')).toHaveText('Salon brings hair: Kanekalon braid hair ×2');

  // the client is served: bill has the hair, stock goes down by 2
  const b = (await (await api.get(`${API}/bookings?select=id,hair_source,hair_items&notes=eq.${note}`)).json())[0];
  expect(b.hair_source).toBe('salon');
  await api.patch(`${API}/bookings?id=eq.${b.id}`, { data: { status: 'in_progress', scheduled_at: new Date().toISOString(), started_at: new Date().toISOString() } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: b.id, staff_id: await wanjiku(request), part: 'main' } }); // the stylist who served her
  await page.goto(`/checkout?booking=${b.id}`);
  const v = view(page);
  await expect(v.getByTestId('co-lines')).toContainText('Kanekalon braid hair × 2');
  await expect(v.getByTestId('co-lines')).toContainText('KSh 600');
  const total = Number((await v.getByTestId('co-total').textContent())!.replace(/[^0-9]/g, ''));
  await fill(v.locator('app-payment-entry').first(), 'Amount', String(total));
  await v.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(v.getByText('Sale recorded')).toBeVisible();
  expect(await stock()).toBe(before - 2);
});

test('client has her own hair: nothing added to the bill', async ({ page, request }) => {
  const api = await ownerApi(request);
  const note = `own-${tag()}`;
  await loginAs(page, request, 'owner');
  await page.goto('/bookings');
  await goToBookingDay(page, test.info().project.name);
  await view(page).locator('ion-button').filter({ hasText: 'New' }).click();
  const m = modal(page);
  await segment(m, 'Home service');
  await m.locator('ion-searchbar input').fill('Lucy');
  await m.locator('.result').filter({ hasText: 'Lucy Akinyi' }).click();
  await choose(page, m, 'Service', /Nails: Gel$/);
  await m.locator('ion-button').filter({ hasText: /^Add$/ }).click();
  await fill(m, 'Time', '15:30');
  await fill(m, 'Client location / address', 'Kamakis');
  await fill(m, 'Notes', note);
  await segment(m.getByTestId('hair-source'), 'Client has hair');
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Booking saved');
  await expect(view(page).locator('.card.booking').filter({ hasText: note }).getByTestId('hair-note')).toHaveText('Client has hair');
  const b = (await (await api.get(`${API}/bookings?select=hair_source,hair_items&notes=eq.${note}`)).json())[0];
  expect(b).toEqual({ hair_source: 'client', hair_items: [] });
});

test('bought outside: on her bill at checkout, shop paid in the evening', async ({ page, request }) => {
  const api = await ownerApi(request);
  const guest = `Outside ${tag()}`;
  const shop = `Mama Njeri ${tag()}`;
  const id = await inChair(request, guest);

  await loginAs(page, request, 'owner');
  await page.goto('/outside');
  const v = view(page);
  // braids for this client, on her bill
  await v.getByTestId('outside-new').click();
  let m = modal(page);
  await fill(m, 'Shop', shop);
  await fill(m, 'Item', 'Braids 1B');
  await fill(m, 'We owe the shop', '800');
  await choose(page, m, 'For which client', new RegExp(guest));
  await m.getByTestId('o-on-bill').click();
  await m.getByTestId('o-save').click();
  await toast(page, 'Enter what to charge the client');
  await fill(m, 'Charge the client', '1000');
  await m.getByTestId('o-save').click();
  await toast(page, `we owe ${shop} KSh 800`);
  // gel for the salon itself, same shop
  await v.getByTestId('outside-new').click();
  m = modal(page);
  await fill(m, 'Shop', shop);
  await fill(m, 'Item', 'Edge gel');
  await fill(m, 'How many', '2');
  await fill(m, 'We owe the shop', '200');
  await m.getByTestId('o-save').click();
  await toast(page, `we owe ${shop} KSh 200`);

  const card = v.getByTestId('shop-card').filter({ hasText: shop });
  await expect(card.getByTestId('shop-total')).toHaveText('KSh 1,000');
  await expect(card.getByTestId('outside-row').filter({ hasText: 'Braids 1B' }).getByTestId('bill-state')).toHaveText('Goes on her bill at checkout (KSh 1,000)');
  await expect(card.getByTestId('outside-row').filter({ hasText: 'Edge gel' }).getByTestId('bill-state')).toHaveText('Salon cost (not on a bill)');

  // checkout (by the stylist): the braids are on the bill
  const sp = await (await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await loginAs(sp, request, 'stylist');
  await sp.goto(`/checkout?booking=${id}`);
  const co = view(sp);
  await expect(co.getByTestId('outside-line')).toBeVisible();
  await expect(co.getByTestId('co-lines')).toContainText('Braids 1B');
  await expect(co.getByTestId('co-total')).toContainText('2,600');
  await fill(co.locator('app-payment-entry').first(), 'Amount', '2600');
  await co.locator('ion-button').filter({ hasText: 'Complete sale' }).click();
  await expect(co.getByText('Sale recorded')).toBeVisible();
  await sp.context().close();

  const sale = (await (await api.get(`${API}/sales?select=id,total&booking_id=eq.${id}`)).json())[0];
  expect(Number(sale.total)).toBe(2600);
  const item = (await (await api.get(`${API}/sale_items?select=unit_cost,unit_price&sale_id=eq.${sale.id}&name=eq.Braids%201B`)).json())[0];
  expect(Number(item.unit_cost)).toBe(800);
  expect(Number(item.unit_price)).toBe(1000);

  // evening: pay the shop by M-Pesa
  await page.reload();
  await expect(card.getByTestId('outside-row').filter({ hasText: 'Braids 1B' }).getByTestId('bill-state')).toHaveText('On her bill (KSh 1,000)');
  await card.getByTestId('shop-pay').click();
  const pay = modal(page);
  await segment(pay.getByTestId('pay-method'), 'M-Pesa');
  await fill(pay, 'M-Pesa code', 'tkq1abc2de');
  await pay.getByTestId('pay-confirm').click();
  await toast(page, `${shop} paid KSh 1,000`);
  await expect(card).toHaveCount(0);
  await expect(v.getByTestId('paid-row').filter({ hasText: shop }).first()).toContainText('M-Pesa TKQ1ABC2DE');
});

test('only the owner and manager see outside buys; a stylist cannot', async ({ page, request }) => {
  const api = await ownerApi(request);
  const guest = `NoPeek ${tag()}`;
  const id = await inChair(request, guest);
  await api.post(`${API}/outside_buys`, { data: { shop: 'Shop X', item: 'Braids 2', cost: 500, booking_id: id, on_bill: true, bill_price: 700 } });

  const sty = await token(request, 'stylist');
  expect(await (await request.get(`${API}/outside_buys?select=id&booking_id=eq.${id}`, { headers: { 'x-staff-token': sty } })).json()).toEqual([]);
  const add = await request.post(`${API}/outside_buys`, { headers: { 'x-staff-token': sty }, data: { shop: 'Shop X', item: 'x', cost: 1 } });
  expect(add.ok()).toBeFalsy();
  // … but checkout still sees what goes on the bill
  const lines = await (await request.post(`${API}/rpc/booking_outside_lines`, { headers: { 'x-staff-token': sty }, data: { p_booking: id } })).json();
  expect(lines.map((l: { item: string }) => l.item)).toEqual(['Braids 2']);

  // the stylist has no "Bought outside" in the menu; the manager has
  await loginAs(page, request, 'stylist');
  await page.goto('/more');
  await expect(view(page).getByText('Bought outside')).toHaveCount(0);
  const mp = await (await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
  await loginAs(mp, request, 'manager');
  await mp.goto('/more');
  await view(mp).getByText('Bought outside').click();
  await expect(view(mp).getByTestId('shop-card').filter({ hasText: 'Shop X' }).first()).toBeVisible();
  await mp.context().close();
});

test('stylist is told when added to a client in the chair, and not again when the booking is edited', async ({ page, request }) => {
  const api = await ownerApi(request);
  const w = await wanjiku(request);
  // in the chair already
  const chair = `Chair ${tag()}`;
  const [b1] = await (await api.post(`${API}/bookings`, { headers: H,
    data: { channel: 'walkin', status: 'in_progress', scheduled_at: new Date().toISOString(), started_at: new Date().toISOString(), guest_name: chair } })).json();
  await api.post(`${API}/booking_staff`, { data: { booking_id: b1.id, staff_id: w, part: 'main' } });
  const n1 = await stylistNotes(request, chair);
  expect(n1.length).toBe(1);
  expect(n1[0].title).toBe('New client for you');
  expect(n1[0].body).toContain('in the chair now');

  // booked for later; the owner edits the booking (same stylist) → still one notification
  const later = `Later ${tag()}`;
  const day = new Date(Date.now() + (test.info().project.name === 'desktop' ? 2 : 1) * 86400_000);
  day.setHours(19, 20, 0, 0); // open every day, clear of the other tests
  const [b2] = await (await api.post(`${API}/bookings`, { headers: H,
    data: { channel: 'salon', status: 'booked', scheduled_at: day.toISOString(), duration_min: 20, guest_name: later } })).json();
  await api.post(`${API}/booking_services`, { data: { booking_id: b2.id, name: 'Knotless', price: 1600 } });
  await api.post(`${API}/booking_staff`, { data: { booking_id: b2.id, staff_id: w, part: 'main' } });
  expect((await stylistNotes(request, later)).length).toBe(1);

  await loginAs(page, request, 'owner');
  await page.goto('/bookings');
  await goToBookingDay(page, test.info().project.name);
  const card = view(page).locator('.card.booking').filter({ hasText: later });
  await card.locator('ion-button').filter({ hasText: 'Reschedule / edit' }).click();
  const m = modal(page);
  await fill(m, 'Notes', 'moved chair');
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Booking saved');
  expect((await stylistNotes(request, later)).length).toBe(1);
});
