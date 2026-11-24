import { APIRequestContext, expect, test } from '@playwright/test';
import { loginAs, toast, view, ownerApi } from './helpers';

// Free / occupied team board and giving work to a stylist based on who is free.

const API = 'http://localhost:54329/rest/v1';
const H = { Prefer: 'return=representation' };
const at = (min: number) => new Date(Date.now() + min * 60000).toISOString();

async function addStylist(request: APIRequestContext, name: string): Promise<string> {
  const r = await (await ownerApi(request)).post(`${API}/staff?select=id`, { headers: H, data: { name, roles: ['stylist'], active: true } });
  return (await r.json())[0].id;
}
async function addBooking(request: APIRequestContext, data: Record<string, unknown>, staffId?: string): Promise<string> {
  const r = await (await ownerApi(request)).post(`${API}/bookings`, { headers: H, data: { channel: 'salon', duration_min: 60, ...data } });
  const id = (await r.json())[0].id;
  if (staffId) await (await ownerApi(request)).post(`${API}/booking_staff`, { data: { booking_id: id, staff_id: staffId } });
  return id;
}

test('team board shows who is free and who is in the chair; desk assigns a free stylist', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const busyName = `Chair ${tag} Busy`;
  const freeName = `Free ${tag} Stylist`;
  const busy = await addStylist(request, busyName);
  const free = await addStylist(request, freeName);
  // busy stylist has a client in the chair for the next few hours
  await addBooking(request, { status: 'in_progress', scheduled_at: at(-10), started_at: at(-10), duration_min: 300, guest_name: `Seated ${tag}` }, busy);
  // a booking later today with nobody assigned
  const guest = `Needs Stylist ${tag}`;
  await addBooking(request, { status: 'booked', scheduled_at: at(20), guest_name: guest });

  await loginAs(page, request, 'receptionist');
  await page.goto('/desk');
  const v = view(page);
  const board = v.getByTestId('team-board');
  await expect(board.getByTestId(`team-${busy}`)).toHaveAttribute('data-state', 'chair');
  await expect(board.getByTestId(`team-${free}`)).toHaveAttribute('data-state', 'free');
  await board.getByTestId(`team-${busy}`).click();
  await expect(board.getByTestId('team-day')).toContainText(`Seated ${tag}`);

  // assign the unassigned booking: the sheet marks the busy stylist and the free one
  await v.locator('.p-card.p-row').filter({ hasText: guest }).getByRole('button', { name: 'Assign' }).click();
  const sheet = page.getByTestId('assign-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId(`assign-${busy}`)).toHaveAttribute('data-state', 'chair');
  await expect(sheet.getByTestId(`assign-${free}`)).toHaveAttribute('data-state', 'free');
  await sheet.getByTestId(`assign-${busy}`).click();
  await expect(sheet.getByTestId('assign-clash')).toContainText('Chair');
  await sheet.getByTestId(`assign-${free}`).click();
  await expect(sheet.getByTestId('assign-clash')).toHaveCount(0);
  await sheet.getByTestId('assign-save').click();
  await toast(page, /Assigned to Free/);
  await expect(v.locator('.p-card.p-row').filter({ hasText: guest })).toContainText('Free');

  // the free stylist now has that client later today on the board
  await v.getByTestId('team-board').getByTestId(`team-${free}`).click();
  await expect(v.getByTestId('team-board').getByTestId('team-day')).toContainText(guest);
});

test('owner home shows the team board and assigns from "Coming up today"', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-5);
  const free = await addStylist(request, `Owner Pick ${tag}`);
  const guest = `Home Assign ${tag}`;
  await addBooking(request, { status: 'booked', scheduled_at: at(25), guest_name: guest });

  await loginAs(page, request, 'owner');
  await page.goto('/dashboard');
  const v = view(page);
  await expect(v.getByTestId('team-board').getByTestId(`team-${free}`)).toHaveAttribute('data-state', 'free');
  await v.locator('.p-card.p-row').filter({ hasText: guest }).getByTestId('home-assign').click();
  const sheet = page.getByTestId('assign-sheet');
  await sheet.getByTestId(`assign-${free}`).click();
  await sheet.getByTestId('assign-save').click();
  await toast(page, /Assigned to Owner/);
  await expect(v.locator('.p-card.p-row').filter({ hasText: guest })).toContainText(`Owner Pick ${tag}`);
});

test('stylists see the team board on My day (read-only)', async ({ page, request }) => {
  await loginAs(page, request, 'stylist');
  await page.goto('/my-day');
  const v = view(page);
  await expect(v.getByTestId('team-board')).toBeVisible();
  await expect(v.getByTestId('team-board')).toContainText('Team now');
  await expect(page.getByTestId('assign-sheet')).toHaveCount(0);
});
