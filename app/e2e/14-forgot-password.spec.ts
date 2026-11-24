import { expect, test } from '@playwright/test';
import { view } from './helpers';

// Staff "Forgot password?": code by email (shown on screen in test mode), new password twice.

const API = 'http://localhost:54329/rest/v1';

test('staff resets a forgotten password with the emailed code', async ({ page, request }) => {
  const tag = Date.now().toString(36).slice(-6);
  const email = `forgot.${tag}@example.com`;
  const su = await request.post(`${API}/rpc/staff_signup`, { data: { p: { name: `Forgot ${tag}`, email, password: 'oldpass12', role: 'stylist' } } });
  expect(su.ok()).toBeTruthy();

  await page.goto('/staff/sign-in');
  const v = view(page);
  await v.getByTestId('forgot-link').click();
  await v.getByTestId('fp-email').fill(email);
  await v.getByTestId('fp-send').click();
  const dev = v.getByTestId('fp-dev-code');
  await expect(dev).toBeVisible();
  const code = ((await dev.locator('strong').textContent()) ?? '').trim();

  // the two passwords must match and be long enough
  await v.getByTestId('fp-code').fill(code);
  await v.getByTestId('fp-new').fill('short');
  await v.getByTestId('fp-new2').fill('short');
  await v.getByTestId('fp-save').click();
  await expect(v.getByTestId('su-error')).toHaveText('Use at least 8 characters');
  await v.getByTestId('fp-new').fill('NewPass2026');
  await v.getByTestId('fp-new2').fill('NewPass2027');
  await v.getByTestId('fp-save').click();
  await expect(v.getByTestId('su-error')).toHaveText('The two passwords are not the same');

  // wrong code is refused
  await v.getByTestId('fp-code').fill(code === '000000' ? '111111' : '000000');
  await v.getByTestId('fp-new2').fill('NewPass2026');
  await v.getByTestId('fp-save').click();
  await expect(v.getByTestId('su-error')).toContainText('Wrong code');

  // right code → back at sign in with the email filled in
  await v.getByTestId('fp-code').fill(code);
  await v.getByTestId('fp-save').click();
  await expect(page.locator('ion-toast').filter({ hasText: 'Password changed' })).toBeVisible();
  await expect(v.getByTestId('su-email')).toHaveValue(email);

  // the new password works, the old one does not
  const oldTry = await request.post(`${API}/rpc/staff_login`, { data: { p_email: email, p_password: 'oldpass12' } });
  expect(oldTry.ok()).toBeFalsy();
  const newTry = await request.post(`${API}/rpc/staff_login`, { data: { p_email: email, p_password: 'NewPass2026' } });
  expect(newTry.ok()).toBeTruthy();
});

test('an email that is not a staff account cannot be reset', async ({ request }) => {
  const email = `nobody.${Date.now().toString(36)}@example.com`;
  const c = await (await request.post(`${API}/rpc/staff_reset_test_code`, { data: { p_email: email } })).json();
  const r = await request.post(`${API}/rpc/staff_reset_with_test_code`, { data: { p_email: email, p_code: c.dev_code, p_password: 'Whatever123' } });
  expect(JSON.stringify(await r.json())).toContain('not linked to a staff account');
  // and the real (Supabase Auth) reset needs a verified email sign-in
  const real = await request.post(`${API}/rpc/staff_reset_password`, { data: { p_password: 'Whatever123' } });
  expect(JSON.stringify(await real.json())).toContain('code from your email');
});
