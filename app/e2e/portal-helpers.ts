import { expect, Page, test } from '@playwright/test';
import { view } from './helpers';

/** A fresh, valid Safaricom-style number for each new test client. */
export function newPhone(): string {
  return '0711' + String(Date.now() % 1_000_000).padStart(6, '0');
}

/** A fresh email for each new test client. */
export function newEmail(): string {
  return `client.${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}@example.com`;
}

/**
 * Sign in on the sign-in page that is on screen with an emailed code (shown in test mode).
 * `who` is an email, or a phone number for a NEW client (a fresh email is made and the phone saved).
 */
export async function completeSignIn(page: Page, who: string, name?: string) {
  const v = view(page);
  const isEmail = who.includes('@');
  await v.getByTestId('signin-address').fill(isEmail ? who : newEmail());
  await v.getByTestId('signin-send').click();
  const dev = v.getByTestId('dev-code');
  await expect(dev).toBeVisible();
  const code = ((await dev.locator('strong').textContent()) ?? '').trim();
  expect(code).toMatch(/^\d{6}$/);
  await v.getByTestId('signin-code').fill(code); // 6 digits → verifies by itself
  if (name) {
    await expect(v.getByTestId('signin-name')).toBeVisible();
    await v.getByTestId('signin-name').fill(name);
    if (!isEmail) await v.getByTestId('signin-phone').fill(who);
    await v.getByTestId('signin-save-name').click();
  }
  await expect(page.locator('ion-toast').filter({ hasText: 'Welcome' }).last()).toBeVisible();
}

export async function signIn(page: Page, who: string, name?: string) {
  await page.goto('/portal/sign-in');
  await completeSignIn(page, who, name);
}

/** Simulated M-Pesa prompt inside the given scope: enter PIN and send. */
export async function payPrompt(page: Page, pin = '4321') {
  const v = page.locator('app-stk-push').filter({ visible: true }).last();
  await v.getByTestId('stk-send').click();
  const phone = v.getByTestId('sim-phone');
  await expect(phone).toBeVisible();
  await phone.getByLabel('M-Pesa PIN').fill(pin);
  await phone.getByRole('button', { name: 'Send' }).click();
  await expect(v.getByText(/received/)).toBeVisible({ timeout: 15_000 });
}

/** 'YYYY-MM-DD' for today + n days */
export function dayKey(n: number): string {
  const d = new Date(Date.now() + n * 86400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Phone and desktop runs share one database: each books on its own day. */
export const bookingOffset = () => (test.info().project.name === 'desktop' ? 3 : 2);

/** A random time 13:00–16:59 (open every day, also Sunday) so bookings of different tests rarely meet. */
export function randomTime(): string {
  return `${13 + Math.floor(Math.random() * 4)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
}

/** Click a day on the month calendar (moves to the next month if needed). */
export async function pickDay(page: Page, n: number) {
  const v = view(page);
  await expect(v.getByTestId('cal-month')).toBeVisible();
  await expect(v.locator('app-month-calendar [data-date]').first()).toBeVisible();
  const cell = v.locator(`app-month-calendar [data-date="${dayKey(n)}"]`);
  if (!(await cell.count())) await v.getByRole('button', { name: 'Next month' }).click();
  await expect(cell).toBeEnabled();
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
}

/** Type an exact time into the time box (opens "Any time" first). */
export async function setTime(page: Page, time: string) {
  const v = view(page);
  if (!(await v.getByTestId('time-input').count())) await v.getByTestId('any-time').click();
  const input = v.getByTestId('time-input');
  await input.fill(time);
  await input.dispatchEvent('change');
}

/** Walk the booking steps for one service; returns the chosen time. */
export async function bookSteps(page: Page, opts: { category?: string; service: string; stylist?: string; home?: string; time?: string }) {
  await page.goto('/portal/book');
  const v = view(page);
  if (opts.category) await v.locator('.p-chip').filter({ hasText: opts.category }).first().click();
  await v.locator(`[data-service="${opts.service}"] .p-add`).click();
  await v.getByTestId('book-next').click();
  if (opts.home) {
    await v.getByTestId('where-home').click();
    await expect(v.getByTestId('book-next')).toBeDisabled();
    await v.getByTestId('address').fill(opts.home);
  }
  await v.getByTestId('book-next').click();
  // book calendar
  await pickDay(page, bookingOffset());
  let time = opts.time ?? randomTime();
  await setTime(page, time);
  // many tests book the same day: if every stylist is busy at a random time, try another one
  const okAt = (t: string) => expect(v.getByTestId('time-ok').filter({ hasText: t })).toBeVisible({ timeout: 3000 }).then(() => true, () => false);
  for (let i = 0; !opts.time && i < 6 && !(await okAt(time)); i++) {
    time = randomTime();
    await setTime(page, time);
  }
  await expect(v.getByTestId('time-ok')).toContainText(time);
  await v.getByTestId('book-next').click();
  // choose stylist (free at that time)
  await expect(v.locator('ion-title')).toHaveText('Choose stylist');
  if (opts.stylist) {
    const st = v.locator(`[data-stylist="${opts.stylist}"]`);
    await expect(st).toBeEnabled();
    await st.click();
    await expect(st).toHaveClass(/\bon\b/);
  }
  await v.getByTestId('book-next').click();
  await expect(v.locator('ion-title')).toHaveText('Review');
  await expect(v.getByText(opts.service).first()).toBeVisible();
  return time;
}
