import { expect, test } from '@playwright/test';
import { answerAlert, segment, toast, view, watchErrors , loginAs, ownerApi } from './helpers';

test.beforeEach(async ({ page, request }) => {
  await loginAs(page, request, 'owner');
});
import { bookSteps, bookingOffset, completeSignIn, newPhone, payPrompt, pickDay, setTime, signIn, newEmail } from './portal-helpers';

// Module 2: client app – sign-in, online booking with M-Pesa deposit, salon confirms / declines.

test('home: brand, services and tabs; no staff menu for clients', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/portal$/);
  const v = view(page);
  await expect(v.getByTestId('brand-title')).toContainText('beauty moment');
  await expect(v.getByTestId('featured')).toBeVisible();
  await expect(v.locator('.p-cat')).toHaveCount(5);
  await expect(v.locator('.p-cat').filter({ hasText: 'Nails' })).toContainText('from KSh 500');
  expect(await page.locator('ion-menu').evaluate((m) => (m as unknown as { disabled: boolean }).disabled)).toBe(true);
  await v.locator('.p-cat').filter({ hasText: 'Kids Hair' }).click();
  await expect(page).toHaveURL(/portal\/book\?category=/);
  await expect(view(page).locator('.p-chip.on')).toHaveText('Kids Hair');
  await expect(view(page).getByText('For children aged 0 – 12')).toBeVisible();
  // signed-out client opening My bookings is sent to sign-in
  await page.goto('/portal');
  await view(page).locator('.p-tabs a[aria-label="Bookings"]').click();
  await expect(page).toHaveURL(/portal\/sign-in\?returnUrl=%2Fportal%2Fbookings/);
  expect(errors).toEqual([]);
});

test('sign-in: wrong email, wrong code and too-fast resend are refused', async ({ page }) => {
  await page.goto('/portal/sign-in');
  const v = view(page);
  await expect(v.getByTestId('signin-google')).toBeVisible();
  await v.getByTestId('signin-address').fill('not-an-email');
  await v.getByTestId('signin-send').click();
  await expect(v.getByText('Enter a valid email address')).toBeVisible();

  await v.getByTestId('signin-address').fill(newEmail());
  await v.getByTestId('signin-send').click();
  await expect(v.getByTestId('dev-code')).toBeVisible();
  await v.getByTestId('signin-code').fill('000000');
  await expect(v.getByText('Wrong code')).toBeVisible();
  // asking again within 30 s is refused
  await v.getByText('Change').click();
  await v.getByTestId('signin-send').click();
  await expect(v.getByText(/Wait 30 seconds/)).toBeVisible();
});

test('existing client: staff add their email, they sign in by email and are recognised', async ({ page, request }) => {
  const email = newEmail();
  const api = await ownerApi(request);
  const c = await (await api.get(`http://localhost:54329/rest/v1/clients?select=id&name=eq.Grace%20Wanjiru`)).json();
  await api.patch(`http://localhost:54329/rest/v1/clients?id=eq.${c[0].id}`, { data: { email } });
  await signIn(page, email); // no "your details" step: already known with a phone
  await page.goto('/portal/account');
  await expect(view(page).getByTestId('acc-name')).toHaveValue('Grace Wanjiru');
});

test('Google sign-in (simulated in test mode) creates the client and asks for name and phone', async ({ page }) => {
  await page.goto('/portal/sign-in');
  const v = view(page);
  await v.getByTestId('signin-google').click();
  await v.getByTestId('google-test-email').fill(newEmail());
  await v.getByTestId('google-test-name').fill('Gmail Tester');
  await v.getByTestId('google-test-go').click();
  await expect(v.getByTestId('signin-name')).toHaveValue('Gmail Tester');
  await v.getByTestId('signin-phone').fill(newPhone());
  await v.getByTestId('signin-save-name').click();
  await expect(page.locator('ion-toast').filter({ hasText: 'Welcome, Gmail' })).toBeVisible();
  await page.goto('/portal/account');
  await expect(view(page).getByTestId('acc-name')).toHaveValue('Gmail Tester');
  await view(page).getByTestId('privacy-link').click();
  await expect(view(page).getByTestId('privacy')).toContainText('How we use your details');
});

test('full booking: choose, sign in, request, pay deposit, salon confirms, client sees it', async ({ page }) => {
  const errors = watchErrors(page);
  const name = `Online Client ${Date.now() % 10000}`;
  const time = await bookSteps(page, { service: 'Gel', stylist: 'Wanjiku Kamau' });

  // not signed in yet → sign in, come back to review with the booking kept
  await view(page).getByTestId('book-next').click();
  await expect(page).toHaveURL(/portal\/sign-in/);
  await completeSignIn(page, newPhone(), name);
  await expect(page).toHaveURL(/portal\/book\?step=5/);
  await expect(view(page).locator('ion-title')).toHaveText('Review');
  await expect(view(page).getByText('Gel').first()).toBeVisible();
  await view(page).getByTestId('book-next').click();

  // deposit by M-Pesa prompt
  await expect(view(page).getByText('Request sent')).toBeVisible();
  await expect(view(page).getByTestId('stk-amount').locator('input')).toHaveValue('500');
  await payPrompt(page);
  await view(page).locator('ion-button').filter({ hasText: 'Done' }).click();
  await expect(view(page).getByText("You're all set")).toBeVisible();

  await view(page).getByText('View my bookings').click();
  const card = view(page).getByTestId('my-booking').filter({ hasText: time }).first();
  await expect(card.getByTestId('status')).toHaveText('Waiting for the salon to confirm');
  await expect(card).toContainText('paid KSh 500');
  await expect(card).toContainText('With Wanjiku Kamau');
  await expect(card.getByText(/Pay deposit/)).toHaveCount(0);

  // salon confirms
  await page.goto('/bookings');
  await segment(view(page), /Online/);
  const req = view(page).getByTestId('request').filter({ hasText: name });
  await expect(req).toContainText('Deposit paid: KSh 500');
  await expect(req).toContainText('Asked for Wanjiku Kamau');
  await req.locator('ion-button').filter({ hasText: 'Confirm' }).click();
  await answerAlert(page, 'OK', 'See you soon!');
  await toast(page, 'Booking confirmed');
  await expect(view(page).getByTestId('request').filter({ hasText: name })).toHaveCount(0);

  // client sees the answer
  await page.goto('/portal/bookings');
  const mine = view(page).getByTestId('my-booking').filter({ hasText: time }).first();
  await expect(mine.getByTestId('status')).toHaveText('Confirmed');
  await expect(mine).toContainText('Salon: See you soon!');
  expect(errors).toEqual([]);
});

test('home service without deposit: salon declines, client sees the reason', async ({ page }) => {
  const name = `Home Client ${Date.now() % 10000}`;
  await signIn(page, newPhone(), name);
  const time = await bookSteps(page, { category: 'Adult Hair', service: 'Knotless', home: 'Membley estate, House 12' });
  await view(page).getByTestId('book-next').click();
  await expect(view(page).getByText('Request sent')).toBeVisible();
  await view(page).getByText('Pay later').click();
  await expect(view(page).getByText("You're all set")).toBeVisible();

  await page.goto('/portal/bookings');
  const card = view(page).getByTestId('my-booking').filter({ hasText: time }).first();
  await expect(card).toContainText('Home · Membley estate, House 12');
  await expect(card.getByText(/Pay deposit KSh 500/)).toBeVisible();

  await page.goto('/bookings');
  await segment(view(page), /Online/);
  const req = view(page).getByTestId('request').filter({ hasText: name });
  await expect(req).toContainText('Home service');
  await req.locator('ion-button').filter({ hasText: 'Decline' }).click();
  await answerAlert(page, 'OK', 'Fully booked, please choose Saturday');
  await toast(page, /^Declined$/);

  await page.goto('/portal/bookings');
  await view(page).locator('.p-seg button').filter({ hasText: 'Past' }).click();
  const past = view(page).getByTestId('my-booking').filter({ hasText: 'Fully booked' }).first();
  await expect(past.getByTestId('status')).toHaveText('Not available');
  await expect(past).toContainText('Salon: Fully booked, please choose Saturday');
});

test('client cancels a request; account update and sign out', async ({ page }) => {
  await signIn(page, newPhone(), 'Cancel Tester');
  const time = await bookSteps(page, { service: 'Refill' });
  await view(page).getByTestId('book-next').click();
  await view(page).getByText('Pay later').click();
  await page.goto('/portal/bookings');
  const card = view(page).getByTestId('my-booking').filter({ hasText: time }).first();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await answerAlert(page, 'Cancel booking');
  await toast(page, 'Booking cancelled');
  await expect(view(page).getByTestId('my-booking').filter({ hasText: 'Refill' })).toHaveCount(0);

  await page.goto('/portal/account');
  await view(page).getByTestId('acc-name').fill('Cancel Tester Renamed');
  await view(page).getByTestId('acc-save').click();
  await toast(page, 'Saved');
  await expect(view(page).getByText('Cancel Tester Renamed').first()).toBeVisible();
  await view(page).getByTestId('acc-signout').click();
  await toast(page, 'Signed out');
  await page.goto('/portal/bookings');
  await expect(page).toHaveURL(/portal\/sign-in/);
});

test('calendar and any-time picking: closed hours and a busy stylist suggest other times', async ({ page }) => {
  // a request holds the stylist's time
  await signIn(page, newPhone(), 'Slot Holder');
  const time = await bookSteps(page, { service: 'Pedi gel', stylist: 'Achieng Otieno' });
  expect(time).toMatch(/^\d\d:\d\d$/);
  await view(page).getByTestId('book-next').click();
  await view(page).getByText('Pay later').click();

  await page.goto('/portal/book');
  const v = view(page);
  await v.locator('[data-service="Gel"] .p-add').click();
  await v.getByTestId('book-next').click();
  await v.getByTestId('book-next').click();

  // a real month calendar: past days can't be picked, Next stays off until a time is OK
  await expect(v.getByTestId('cal-month')).toBeVisible();
  const yesterday = v.locator('app-month-calendar [data-date]').first();
  await expect(yesterday).toBeDisabled();
  await pickDay(page, bookingOffset());
  await expect(v.getByTestId('book-next')).toBeDisabled();

  // a quick-time pill works
  await v.locator('.p-slot').filter({ hasText: /^\s*15:30\s*$/ }).click();
  await expect(v.getByTestId('time-ok')).toContainText('15:30');

  // outside opening hours (any time) → reason + nearest times, pick a suggestion
  await setTime(page, '06:45');
  await expect(v.getByTestId('time-bad')).toContainText('Choose a time between');
  await expect(v.getByTestId('book-next')).toBeDisabled();
  const other = ((await v.getByTestId('suggestion').first().textContent()) ?? '').trim();
  await v.getByTestId('suggestion').first().click();
  await expect(v.getByTestId('time-ok')).toContainText(other);
  await setTime(page, '19:07'); // 19:00 is the last start
  await expect(v.getByTestId('time-bad')).toContainText('Choose a time between');

  // the exact minute Achieng is already booked: the time is fine (others are free) …
  await setTime(page, time);
  await expect(v.getByTestId('time-ok')).toContainText(time);
  await v.getByTestId('book-next').click();
  // … but on "Choose stylist" she shows Busy and can't be picked
  const achieng = v.locator('[data-stylist="Achieng Otieno"]');
  await expect(achieng).toBeDisabled();
  await expect(achieng.locator('.state')).toHaveText('Busy');
  await expect(v.locator('[data-stylist] .state').filter({ hasText: 'Free' }).first()).toBeVisible();
  await expect(v.getByTestId('stylist-any')).toHaveClass(/\bon\b/);
  await v.getByTestId('book-next').click();
  await expect(v.locator('ion-title')).toHaveText('Review');
  await expect(v.getByText('Any stylist').first()).toBeVisible();
});
