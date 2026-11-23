import { APIRequestContext, expect, Locator, Page } from '@playwright/test';

/** Ionic keeps previous pages in the DOM (hidden); always look inside the page on screen. */
export function view(page: Page): Locator {
  return page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
}

/** The top-most open modal / sheet. */
export function modal(page: Page): Locator {
  return page.locator('ion-modal.show-modal').last();
}

/** Type into an <ion-input>/<ion-textarea> found by its label text. */
export async function fill(scope: Locator, label: string | RegExp, value: string) {
  const field = scope.locator('ion-input, ion-textarea').filter({ hasText: label }).first();
  const native = await field.locator('input, textarea').first().elementHandle();
  if (!native) throw new Error(`No input labelled ${label}`);
  await native.fill(value); // fires "input" → ngModel
  await native.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true }))); // → ionChange
}

/** Open an <ion-select> by its label and pick option(s) from whatever overlay Ionic shows. */
export async function choose(page: Page, scope: Locator, label: string | RegExp, options: string | RegExp | (string | RegExp)[]) {
  const list = Array.isArray(options) ? options : [options];
  await scope.locator('ion-select').filter({ hasText: label }).first().click();
  const overlay = page.locator('ion-action-sheet, ion-popover, ion-alert, ion-select-modal').filter({ visible: true }).last();
  await expect(overlay).toBeVisible();
  for (const o of list) {
    const opt = overlay.locator('button, ion-item, ion-radio, ion-checkbox').filter({ hasText: o }).first();
    await opt.click();
  }
  // multi-select alerts need OK; single selects close by themselves
  const ok = overlay.locator('button.alert-button').filter({ hasText: /^OK$/i });
  if (await ok.count()) await ok.click();
  await expect(overlay).toBeHidden();
}

/** Click a segment button by text. */
export async function segment(scope: Locator, text: string | RegExp) {
  await scope.locator('ion-segment-button').filter({ hasText: text }).first().click();
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.locator('ion-toast').filter({ hasText: text }).last()).toBeVisible();
}

/** Answer an <ion-alert> (confirm / prompt). */
export async function answerAlert(page: Page, button: string | RegExp, input?: string) {
  const alert = page.locator('ion-alert').filter({ visible: true }).last();
  await expect(alert).toBeVisible();
  if (input !== undefined) await alert.locator('input').first().fill(input);
  await alert.locator('button').filter({ hasText: button }).click();
  await expect(alert).toBeHidden();
}

/** Fails the test on any uncaught page error or console error. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Desktop: the side menu. Phones: the "Everything" page (More tab). */
export async function goMenu(page: Page, title: string) {
  const menu = page.locator('ion-menu').first();
  const docked = await menu.evaluate((el) => el.classList.contains('menu-pane-visible'));
  if (docked) {
    await menu.locator('a.it').filter({ hasText: new RegExp(`^\\s*${title}\\s*$`) }).first().click();
  } else {
    await page.locator('[data-testid="staff-tabs"] a[aria-label="More"]').click();
    await expect(page).toHaveURL(/\/more$/);
    await view(page).locator(`[data-module="${title}"]`).click();
  }
  await expect(view(page).locator('ion-title, h1.p-display').first()).toBeVisible();
}

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36).slice(-5)}`;

/** Phone and desktop runs share one database: give each its own booking day so they don't collide. */
export async function goToBookingDay(page: Page, project: string) {
  const days = project === 'desktop' ? 2 : 1;
  for (let i = 0; i < days; i++) await view(page).getByRole('button', { name: 'Next day' }).click();
}

// ---------- staff sign-in (test logins from local-db/dev-accounts.sql) ----------
export const STAFF = {
  owner: 'owner@dantesras.test',
  manager: 'manager@dantesras.test',
  receptionist: 'reception@dantesras.test',
  stylist: 'stylist@dantesras.test',
  finisher: 'finisher@dantesras.test',
} as const;
export type StaffRoleName = keyof typeof STAFF;

/** Signs the browser in as a staff role before the page loads (token in localStorage). */
export async function loginAs(page: Page, request: APIRequestContext, role: StaffRoleName = 'owner') {
  const res = await request.post('http://localhost:54329/rest/v1/rpc/staff_login', { data: { p_email: STAFF[role], p_password: 'test1234' } });
  const body = await res.json();
  if (!body.token) throw new Error(`login ${role} failed: ${JSON.stringify(body)}`);
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('e2e.signedOut')) localStorage.setItem('dbh.staff.token', t);
  }, body.token);
}
