import { expect, Locator, Page, test } from '@playwright/test';
import { choose, fill, goToBookingDay, modal, segment, toast, view, watchErrors , loginAs } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'owner');
});

// Module 1: M-Pesa prompt (STK push) – simulated, no Daraja keys.

/** first "KSh 1,234" in a text */
const money = (t: string | null) => Number(((t ?? '').match(/KSh\s*([0-9,]+)/)?.[1] ?? '').replace(/,/g, ''));

async function simulatePay(page: Page, scope: Locator, pin = '1234') {
  const phone = scope.getByTestId('sim-phone');
  await expect(phone).toBeVisible();
  await phone.getByLabel('M-Pesa PIN').fill(pin);
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(scope.getByText(/received/)).toBeVisible({ timeout: 15_000 });
  await expect(scope.getByText(/M-Pesa code/)).toBeVisible();
}

/** Booking without deposit (status pending) for tomorrow at the given time. */
async function pendingBooking(page: Page, time: string, service: RegExp) {
  await page.goto('/bookings');
  await goToBookingDay(page, test.info().project.name);
  await view(page).locator('ion-button').filter({ hasText: 'New' }).click();
  const m = modal(page);
  await m.locator('ion-searchbar input').fill('Lucy');
  await m.locator('.result').filter({ hasText: 'Lucy Akinyi' }).click();
  await choose(page, m, 'Service', service);
  await m.locator('ion-button').filter({ hasText: /^Add$/ }).click();
  await fill(m, 'Time', time);
  const tag = `e2e-${test.info().project.name}-${Date.now() % 100000}`;
  await fill(m, 'Notes', tag);
  await m.locator('ion-button').filter({ hasText: 'Save booking' }).click();
  await toast(page, 'Booking saved');
  const card = view(page).locator('.card.booking').filter({ hasText: tag });
  await expect(card.locator('.pill.pending')).toBeVisible();
  return card;
}

test('deposit by M-Pesa prompt holds the booking', async ({ page }) => {
  const errors = watchErrors(page);
  const card = await pendingBooking(page, '15:00', /Nails: Refill$/);
  await card.locator('ion-button').filter({ hasText: '+ Payment' }).click();
  const sheet = modal(page);
  await expect(sheet.locator('app-stk-push')).toBeVisible();
  // phone comes from the client record, amount = what is owed
  await expect(sheet.getByTestId('stk-phone').locator('input')).toHaveValue('0722100002');
  await fill(sheet, /Amount/, '500');
  await sheet.getByTestId('stk-send').click();
  await expect(sheet.getByText('Prompt sent to 0722 100 002')).toBeVisible();
  await simulatePay(page, sheet);
  await sheet.locator('ion-button').filter({ hasText: 'Done' }).click();
  await expect(sheet).toBeHidden();
  await expect(card.locator('.pill.booked')).toBeVisible();
  await expect(card).toContainText('Paid upfront: KSh 500');
  expect(errors).toEqual([]);
});

test('cancelled and failed prompts are reported and can be retried', async ({ page }) => {
  const card = await pendingBooking(page, '16:00', /Nails: Gel$/);
  await card.locator('ion-button').filter({ hasText: '+ Payment' }).click();
  const sheet = modal(page);

  // wrong number
  await fill(sheet, 'M-Pesa phone number', '0812');
  await sheet.getByTestId('stk-send').click();
  await expect(sheet.getByText('Enter a Safaricom number')).toBeVisible();

  // more than owed
  await fill(sheet, 'M-Pesa phone number', '0712345678');
  await fill(sheet, /Amount/, '9000');
  await sheet.getByTestId('stk-send').click();
  await expect(sheet.getByText(/The most you can pay here is KSh 500/)).toBeVisible();

  // client cancels on the phone
  await fill(sheet, /Amount/, '500');
  await sheet.getByTestId('stk-send').click();
  await sheet.getByTestId('sim-phone').getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet.getByText('Not paid')).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByText('cancelled on the phone')).toBeVisible();

  // not enough money
  await sheet.locator('ion-button').filter({ hasText: 'Try again' }).click();
  await sheet.getByTestId('stk-send').click();
  await sheet.getByTestId('sim-phone').getByText('not enough money').click();
  await expect(sheet.getByText(/balance is insufficient/i)).toBeVisible({ timeout: 15_000 });

  // third time lucky
  await sheet.locator('ion-button').filter({ hasText: 'Try again' }).click();
  await sheet.getByTestId('stk-send').click();
  await simulatePay(page, sheet);
  await sheet.locator('ion-button').filter({ hasText: 'Done' }).click();
  await expect(card.locator('.pill.booked')).toBeVisible();
});

test('record payment (cash) still works next to the prompt', async ({ page }) => {
  const card = await pendingBooking(page, '17:00', /Nails: Plain pedicure$/);
  await card.locator('ion-button').filter({ hasText: '+ Payment' }).click();
  const sheet = modal(page);
  await segment(sheet, 'Record payment');
  await choose(page, sheet.locator('app-payment-entry'), 'Method', 'Cash');
  await fill(sheet.locator('app-payment-entry'), 'Amount', '800');
  await sheet.locator('ion-button').filter({ hasText: /^Record payment$/ }).click();
  await toast(page, 'Payment recorded');
  await expect(card.locator('.pill.booked')).toBeVisible();
});

test('debt paid by M-Pesa prompt reduces the balance', async ({ page }) => {
  await page.goto('/debts');
  const row = view(page).locator('table.t tr').filter({ has: page.locator('ion-button', { hasText: 'Pay' }) }).first();
  const name = (await row.locator('strong').first().textContent())!.trim();
  const before = money(await row.locator('td.num').first().textContent());
  await row.locator('ion-button').filter({ hasText: 'Pay' }).click();
  const sheet = modal(page);
  await fill(sheet, 'M-Pesa phone number', '0712345678');
  await fill(sheet, /Amount/, '100');
  await sheet.getByTestId('stk-send').click();
  await simulatePay(page, sheet);
  await sheet.locator('ion-button').filter({ hasText: 'Done' }).click();
  const after = view(page).locator('table.t tr').filter({ hasText: name }).first();
  await expect.poll(async () => money(await after.locator('td.num').first().textContent())).toBe(before - 100);
});

test('school fee paid by M-Pesa prompt shows in payment history', async ({ page }) => {
  await page.goto('/school');
  const row = view(page).locator('table.t tbody tr').filter({ has: page.locator('strong.maroon') }).first();
  const name = (await row.locator('strong').first().textContent())!.trim();
  await row.click();
  const m = modal(page);
  await expect(m.locator('ion-title')).toHaveText(name);
  await fill(m, 'M-Pesa phone number', '0712345678');
  await fill(m, /Amount/, '1000');
  await m.getByTestId('stk-send').click();
  await simulatePay(page, m);
  await m.locator('ion-button').filter({ hasText: 'Done' }).click();
  await expect(m.locator('table.t').last()).toContainText('KSh 1,000');
  await expect(m.locator('table.t').last()).toContainText('M-Pesa Paybill');
});
