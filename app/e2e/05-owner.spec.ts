import { expect, Page, test } from '@playwright/test';
import { fill, toast, view , loginAs } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'owner');
});
import { bookSteps, newPhone, signIn } from './portal-helpers';

// Owner tools around the client app: dashboard inbox and online-booking settings.

// whatever happens, leave online booking switched on for the tests that follow
test.afterEach(async ({ request }) => {
  await request.post('http://localhost:54329/rest/v1/settings', {
    headers: { Prefer: 'resolution=merge-duplicates' },
    data: { key: 'online_booking', value: true },
  });
});

async function saveSettings(page: Page, change: (v: ReturnType<typeof view>) => Promise<void>) {
  await page.goto('/settings');
  const v = view(page);
  await expect(v.locator('ion-title')).toHaveText('Settings');
  await change(v);
  await v.locator('ion-button').filter({ hasText: 'Save settings' }).click();
  await toast(page, 'Settings saved');
}

test('dashboard shows waiting online requests and opens them', async ({ page }) => {
  const name = `Inbox Tester ${Date.now() % 100000}`;
  await signIn(page, newPhone(), name);
  await bookSteps(page, { service: 'Builder gel' });
  await view(page).getByTestId('book-next').click();
  await view(page).getByText('Pay later').click();

  await page.goto('/dashboard');
  const inbox = view(page).getByTestId('inbox');
  await expect(inbox).toContainText(/online booking requests? to answer/);
  await inbox.locator('.p-list-line').filter({ hasText: /online booking request/ }).getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/bookings\?tab=requests/);
  await expect(view(page).getByTestId('request').filter({ hasText: name })).toBeVisible();
});

test('owner pauses online booking and sets the salon phone', async ({ page }) => {
  await saveSettings(page, async (v) => {
    const toggle = v.locator('ion-toggle').filter({ hasText: 'Clients can book online' });
    await expect(toggle).toHaveClass(/toggle-checked/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/toggle-checked/);
    await fill(v, 'Salon phone / WhatsApp shown to clients', '0712 000 111');
  });

  await signIn(page, newPhone(), 'Paused Tester');
  await page.goto('/portal');
  await expect(view(page).getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/254712000111');
  await bookSteps(page, { service: 'Gel' });
  await view(page).getByTestId('book-next').click();
  await expect(view(page).getByText('Online booking is paused')).toBeVisible();

  // switch it back on for the other tests
  await saveSettings(page, async (v) => {
    const toggle = v.locator('ion-toggle').filter({ hasText: 'Clients can book online' });
    await expect(toggle).not.toHaveClass(/toggle-checked/);
    await toggle.click();
    await expect(toggle).toHaveClass(/toggle-checked/);
  });
  await page.goto('/portal/book?step=5');
  await view(page).getByTestId('book-next').click();
  await expect(view(page).getByText('Request sent')).toBeVisible();
});
