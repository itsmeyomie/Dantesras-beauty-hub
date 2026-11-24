# Dantesras Beauty Hub – Salon, School & Client App

One Ionic + Angular code base → **web app** and **Android app**, with a Supabase (PostgreSQL) database.

```
docs/requirements.md      ← approved requirements (SRS)
supabase/migrations/      ← database: 001 schema · 002 business logic & reports · 003 starting data
                            004 M-Pesa prompt (STK push) · 005 client app & online booking · 006 school applications
supabase/functions/       ← Edge Functions: mpesa-stk, mpesa-callback, mpesa-simulate, portal-otp
app/                      ← Ionic Angular app (web + Android in app/android)
app/e2e/                  ← end-to-end tests (Playwright)
local-db/                 ← internal test database (no internet needed)
```

## What's in this version
**Client app** (`/portal` – what clients and students see): sign in with a 6-digit code by SMS, WhatsApp
or email · browse the menu · book salon or home service, pick a stylist, day and free time · pay the
deposit by **M-Pesa prompt** · see the salon's answer · cancel · apply to the school · see fee balance
and pay fees by M-Pesa prompt.

**Staff app** (`/dashboard` …): clients (and guests) · service menu · products & stock · bookings
(salon, home service, walk-in queue, **online requests to confirm / decline**) with deposits, lateness
and no-shows · checkout with cash / M-Pesa Till / Paybill / Send Money and split payments · debts ·
commission and payouts · school courses, students, fees and **applications** · owner dashboard · reports ·
settings (incl. online booking on/off, salon phone, M-Pesa Paybill/Till).

**M-Pesa prompt (STK push)** for deposits, debts and school fees. Runs in **test mode** (simulated on
screen, no money moves) until the Daraja keys are added – see section 4.

**Staff accounts and roles** (`/staff/sign-in`): staff create their own account (email, password, photo,
speciality, role wanted); the **owner approves** and gives the role. Each role gets its own screens:
- **Owner** – everything, plus staff requests and settings ("Your business" home, side menu on a computer).
- **Manager** – everything except staff requests and settings ("Today at the salon").
- **Receptionist** – front desk (online requests, walk-in queue, today), bookings, checkout, clients, debts, school.
- **Stylist** – my day (next client, take a walk-in), my calendar, checkout, my earnings, my profile.
Photos and specialities are shown to clients when they choose a stylist.

**Not yet:** WhatsApp/SMS reminders, attendance, location check on staff sign-in (AT-00).

> ⚠️ The screens are now role-based, but the database is still open to anyone with the app's address and
> public key (development policy). Locking the tables down per role is the next security step – don't load
> real client data before that.

**Test logins** (internal test database only, password `test1234`): `owner@dantesras.test`,
`manager@dantesras.test`, `reception@dantesras.test`, `stylist@dantesras.test`, `finisher@dantesras.test`.

## 0. Internal test database (no internet, no Supabase account)
`local-db/` is an embedded PostgreSQL that runs on this computer with ~200 sales of fake data
(staff, clients, kids, bookings, walk-ins, debts, products, students and fees). It runs the **same**
SQL files as Supabase, so checkout, commission and reports behave exactly like the live system.

```bash
cd local-db
npm install
npm start
```
- **Console (browse tables, add / edit / delete rows, run any SQL):** http://localhost:54321
- **App** (in a second terminal): `cd app && npm start`, then open http://localhost:4200. In development
  the app already points at the local database (`app/src/environments/environment.ts`).
- **Start over with fresh dummy data:** `npm run reset` (wipes `local-db/data/`).
- Data is saved in `local-db/data/` and survives restarts. Only this computer can connect.
- Dummy data lives in `local-db/dummy-data.sql` – fake names and numbers, never load it into the live database.

## 1. Set up Supabase (once)
1. Create a free project at supabase.com → choose the region closest to Kenya (e.g. EU-Central or South Africa if offered).
2. **SQL Editor → New query**: paste and **Run** each file in order:
   `001_schema.sql`, `002_functions.sql`, `003_seed.sql`, `004_mpesa_stk.sql`, `005_client_portal.sql`, `006_school_portal.sql`, `007_any_time_booking.sql`, `008_stylists_at_time.sql`, `009_staff_accounts.sql`.
   (The internal test database applies new files automatically on start.)
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Put them in **both** `app/src/environments/environment.ts` and `environment.prod.ts`.
5. In the app: **Staff & commission → + Staff** to add your stylists, then **Service menu** to set each service's commission %.

## 2. Run on this computer
```bash
cd app
npm install
npm start
```
- Client app: http://localhost:4200/portal (the address clients get)
- Staff app: http://localhost:4200/dashboard (also in the client app: *Account → Staff area*)

In test mode the sign-in code and the M-Pesa prompt appear **on screen** (marked "Test mode" /
"Simulation") because no SMS or Safaricom account is connected yet.

### End-to-end tests (run before every release)
```bash
cd app
npx playwright install chromium   # once
npx playwright test               # 103 tests: staff app, M-Pesa prompt, client app (email / Google sign-in), school, owner settings, staff accounts, every role, team free/busy, custom roles and finisher, early check-in, database security, notifications – phone and desktop size
npx playwright show-report e2e-report
```
The tests start their own throw-away database (port 54329) and app (port 4300) – your test data is not touched.

## 3. Publish on Africa hosting (cPanel)
1. Build: `cd app && npm run build` → creates `app/www/`.
2. cPanel → **File Manager** → `public_html` (or a subdomain folder such as `app.yourdomain.co.ke`).
3. Upload **everything inside `app/www/`** (including the hidden `.htaccess`, which makes page links work and forces https).
4. Turn on free SSL (cPanel → SSL/TLS Status → AutoSSL) – needed for phones and, later, location-based login.
5. On staff phones: open the site in Chrome → menu → **Add to Home screen**.

Hosting only serves files; all data lives in Supabase (free tier to start; Pro is USD 25/month if you outgrow it).
Clients get the main address (it opens the client app); the site can also be installed from Chrome
(*Add to Home screen*) with the Dantesras icon.

## 4. M-Pesa prompt and sign-in codes – going live

> **Free setup (no SMS):** clients sign in with an email code or Google, notifications go through
> Firebase, backups run on GitHub. The steps that need your own accounts are in
> [docs/free-setup.md](docs/free-setup.md). Database access is locked per role since migration 014.
Deploy the Edge Functions once (Supabase CLI): `supabase functions deploy mpesa-stk portal-otp mpesa-simulate`
and `supabase functions deploy mpesa-callback --no-verify-jwt`. Then add **secrets** (Dashboard → Edge Functions → Secrets):

| For | Secrets |
|---|---|
| M-Pesa prompt (Safaricom Daraja, "Lipa na M-Pesa Online") | `DARAJA_ENV` (`sandbox` / `production`), `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, `DARAJA_CALLBACK_SECRET` (any long random text), `DARAJA_TILL` (only for Buy Goods) |
| Codes by SMS (Africa's Talking) | `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (optional) |
| Codes by WhatsApp (Meta WhatsApp Cloud API) | `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_TEMPLATE` (approved authentication template) |
| Codes by email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` |

- Without Daraja keys the prompt stays **simulated**; `mpesa-simulate` refuses to run once keys are set.
- A sign-in channel without its keys is refused, unless `OTP_SIMULATE=1` (testing only – never in the live app).
- Set `simulate: false` in `app/src/environments/environment.prod.ts` for the live build.
- In the app: **Settings → M-Pesa prompt** – choose Paybill or Till, so STK payments are recorded under the right method.

## 5. Android app
Needs JDK 21 and the Android SDK (both are on this computer).
```bash
cd app
npm run android:build        # → app/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open         # opens Android Studio (to run on a phone / emulator, or make a signed release)
```
- The **test build** talks to the internal test database: on the Android emulator via `10.0.2.2:54321`.
  For a real phone on the same Wi-Fi, put the computer's IP in `src/environments/environment.android.ts`
  and start the database with `LOCAL_DB_HOST=0.0.0.0` (test data only).
- For the **live app**: put the Supabase URL/key and `simulate: false` in `environment.android.ts`, build with
  `LIVE=1` (PowerShell: `$env:LIVE='1'; npm run android:build` – https only), then in Android Studio *Build → Generate Signed App Bundle* for the Play Store.
- Icons and splash screen: `node tools/brand-assets.mjs` redraws them in maroon & gold.

## Business rules (where they live)
| Rule | Where |
|---|---|
| Deposit ≥ KSh 500 or full amount holds a slot | `add_deposit()` + Settings |
| Late > 20 min → reschedule (shown as alert) | Bookings page + Settings |
| Discount above 10 % needs owner | `checkout()` + Settings |
| Commission on price after discount, staff shares must total 100 % | `checkout()` |
| Transport fee → stylists who travelled, no commission | `checkout()` |
| Guests can't owe money | `checkout()` |
| Sales never deleted; void reverses commission and stock | `void_sale()` |
| Kids prices for ages 0–12 | client birth date + Settings |
