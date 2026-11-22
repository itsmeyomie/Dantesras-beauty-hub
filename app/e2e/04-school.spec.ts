import { expect, Page, test } from '@playwright/test';
import { answerAlert, segment, toast, view, watchErrors , loginAs } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'owner');
});
import { newPhone, payPrompt, signIn } from './portal-helpers';

// Module 3: school in the client app – apply, school accepts / declines, pay fees by M-Pesa.

const tomorrow = () => {
  const d = new Date(Date.now() + 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function applyFor(page: Page, course: string, guardian = true) {
  await page.goto('/portal/school');
  await view(page).locator(`[data-course="${course}"]`).getByRole('button', { name: 'Apply' }).click();
  const m = page.locator('ion-modal.show-modal').last();
  await expect(m.getByRole('heading', { name: course })).toBeVisible();
  if (guardian) {
    await m.getByTestId('app-guardian').fill('Mary Mother');
    await m.getByTestId('app-guardian-phone').fill('0722 999 888');
  }
  await m.getByTestId('app-start').fill(tomorrow());
  await m.getByTestId('app-send').click();
  return m;
}

test('signed-out visitor sees courses and is asked to sign in to apply', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/portal/school');
  const v = view(page);
  await expect(v.getByTestId('course')).toHaveCount(3);
  await expect(v.locator('[data-course="Hairdressing"]')).toContainText('KSh 8,000/month');
  await expect(v.locator('[data-course="Hairdressing"]')).toContainText('KSh 24,000 in total');
  await v.locator('[data-course="Make-up"]').getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/portal\/sign-in\?returnUrl=%2Fportal%2Fschool/);
  expect(errors).toEqual([]);
});

test('apply → school accepts → student pays fees by M-Pesa', async ({ page }) => {
  const name = `Student ${Date.now() % 100000}`;
  await signIn(page, newPhone(), name);
  const m = await applyFor(page, 'Make-up');
  await expect(m.getByText('Application sent')).toBeVisible();
  await m.getByRole('button', { name: 'Done' }).click();
  const app = view(page).getByTestId('application').filter({ hasText: 'Make-up' }).first();
  await expect(app.getByTestId('app-status')).toHaveText('Application received');

  // a second application for the same course is refused
  const again = await applyFor(page, 'Make-up');
  await expect(again.getByText('You already applied for Make-up')).toBeVisible();
  await again.getByRole('button', { name: 'Close' }).click();

  // school accepts
  await page.goto('/school');
  await segment(view(page), /Applications/);
  const card = view(page).getByTestId('application').filter({ hasText: name });
  await expect(card).toContainText('Make-up');
  await expect(card).toContainText('Mary Mother');
  await card.locator('ion-button').filter({ hasText: 'Accept' }).click();
  await answerAlert(page, 'Accept');
  await toast(page, 'Student enrolled');
  await segment(view(page), 'Students');
  const row = view(page).locator('table.t tbody tr').filter({ hasText: name });
  await expect(row).toContainText('KSh 18,000');

  // student sees it and pays 5,000
  await page.goto('/portal/school');
  await expect(view(page).getByTestId('application').filter({ hasText: 'Make-up' }).first().getByTestId('app-status')).toHaveText('Accepted – welcome!');
  const enrol = view(page).getByTestId('enrolment').filter({ hasText: 'Make-up' });
  await expect(enrol.getByTestId('balance')).toHaveText('KSh 18,000');
  await enrol.getByRole('button', { name: /Pay fees/ }).click();
  const sheet = page.locator('ion-modal.show-modal').last();
  await sheet.getByTestId('stk-amount').locator('input').fill('5000');
  await payPrompt(page);
  await sheet.locator('ion-button').filter({ hasText: 'Done' }).click();
  await expect(enrol.getByTestId('balance')).toHaveText('KSh 13,000');

  // the school sees the payment
  await page.goto('/school');
  await view(page).locator('table.t tbody tr').filter({ hasText: name }).click();
  const detail = page.locator('ion-modal.show-modal').last();
  await expect(detail.locator('table.t').last()).toContainText('KSh 5,000');
});

test('school declines with a reason; applicant can withdraw another', async ({ page }) => {
  const name = `Applicant ${Date.now() % 100000}`;
  await signIn(page, newPhone(), name);
  let m = await applyFor(page, 'Nail technology', false);
  await m.getByRole('button', { name: 'Done' }).click();
  m = await applyFor(page, 'Hairdressing', false);
  await m.getByRole('button', { name: 'Done' }).click();

  // withdraw Hairdressing
  const hair = view(page).getByTestId('application').filter({ hasText: 'Hairdressing' }).first();
  await hair.getByRole('button', { name: 'Withdraw application' }).click();
  await answerAlert(page, 'Withdraw');
  await toast(page, 'Application withdrawn');
  await expect(hair.getByTestId('app-status')).toHaveText('Withdrawn');

  // school declines Nail technology
  await page.goto('/school');
  await segment(view(page), /Applications/);
  const card = view(page).getByTestId('application').filter({ hasText: name });
  await expect(card).toHaveCount(1); // the withdrawn one is gone
  await card.locator('ion-button').filter({ hasText: 'Decline' }).click();
  await answerAlert(page, 'OK', 'Class is full – next intake in January');
  await toast(page, 'Application declined');

  await page.goto('/portal/school');
  const nails = view(page).getByTestId('application').filter({ hasText: 'Nail technology' }).first();
  await expect(nails.getByTestId('app-status')).toHaveText('Not accepted');
  await expect(nails).toContainText('School: Class is full – next intake in January');
});
