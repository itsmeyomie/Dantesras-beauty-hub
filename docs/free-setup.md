# Free setup – what only you can do

Everything is built and live. These steps connect the **free accounts** that need your own login.
Never paste passwords, keys or secret files into a chat – put them only where each step says.
When a step is done, tell Claude ("step 2 done") and it does its part.

| # | What | Time | After it |
|---|------|------|----------|
| 0 | Back up the Android signing key | 2 min | — |
| 1 | Nightly backup (GitHub) | 5 min | backups run every night |
| 2 | Email codes (a salon Gmail) | 10 min | clients get real codes by email |
| 3 | Sign in with Google | 15 min | one-tap sign-in |
| 4 | Firebase (push notifications) | 15 min | notifications on Android phones |
| 5 | Check ODPC registration | — | — |

**Until steps 2 and 3 are done, client sign-in stays in TEST MODE** (the code is shown on screen).
That is fine for testing with people you trust, not for the public.

---

## 0. Back up the Android signing key (important)

The app is now signed with the salon's own key. Copy these two files to a USB stick **and** your
Google Drive (they are not in GitHub on purpose):

- `app/android/keystore.properties`
- `app/android/keystore/dantesras-release.jks`

If they are lost, phones cannot update the app – everyone would have to uninstall and reinstall.

> Testers who installed the earlier test APK must **uninstall it once** and install the new one
> (the signature changed).

## 1. Nightly backup

Follow `docs/backup.md` (two GitHub secrets: `SUPABASE_DB_PASSWORD` and `BACKUP_PASSPHRASE`, then "Run workflow").

## 2. Email codes – free with a Gmail account

1. Make (or use) a salon Gmail, e.g. `dantesras.salon@gmail.com`.
2. Google Account → **Security** → turn on **2-Step Verification** → then **App passwords** →
   create one called "Supabase". Google shows a 16-letter password – copy it.
3. Supabase → **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*:
   - Sender email: your Gmail · Sender name: `Dantesras Beauty Hub`
   - Host `smtp.gmail.com` · Port `465` · Username: your Gmail · Password: the 16-letter app password
4. Supabase → **Authentication → Emails → Templates → Magic Link** – replace the message with:
   ```html
   <h2>Your Dantesras sign-in code</h2>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   <p>Enter this code in the app. It expires in 1 hour. If you did not ask for it, ignore this email.</p>
   ```
5. Supabase → **Authentication → Sign In / Providers → Email**: Email provider **on**,
   "Confirm email" **off**, Email OTP length **6**.

Gmail allows about 500 emails a day – plenty for the salon.

## 3. Sign in with Google – free

1. https://console.cloud.google.com → create a project "Dantesras".
2. **APIs & Services → OAuth consent screen**: External · app name `Dantesras Beauty Hub` ·
   your email · Publish the app (status "In production").
3. **Credentials → Create credentials → OAuth client ID** → *Web application*:
   Authorised redirect URI: `https://frjflqepqhjkxfzknnoz.supabase.co/auth/v1/callback`
4. Supabase → **Authentication → Sign In / Providers → Google** → on → paste the
   **Client ID** and **Client secret** → Save.
5. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://itsmeyomie.github.io/Dantesras-beauty-hub/portal`
   - Redirect URLs – add both:
     `https://itsmeyomie.github.io/Dantesras-beauty-hub/portal/sign-in` and
     `ke.dantesras.app://auth-callback`

→ Then tell Claude: it switches the app to real sign-in, turns test codes off and republishes.

## 4. Firebase – push notifications to Android

1. https://console.firebase.google.com → **Add project** "Dantesras" (Analytics not needed).
2. **Add app → Android** → package name `ke.dantesras.app` → download **google-services.json** →
   save it as `app/android/app/google-services.json` in this folder.
3. Project settings → **Service accounts → Generate new private key** → a .json file downloads.
4. Supabase → **Edge Functions → Secrets** → add `FIREBASE_SERVICE_ACCOUNT` = the **whole content**
   of that file. Then delete the downloaded file from your computer.

→ Then tell Claude: it deploys the `push-send` function, starts the every-minute job and the evening
reminders (`supabase/live/push-cron.sql`), and rebuilds the APK with Firebase.

Website users already see the same messages under the bell (Notifications).

## 5. Data protection (ODPC)

The privacy notice is in the app (Account → Privacy). Check on https://www.odpc.go.ke whether the
salon and the school must register as a data controller (small businesses may be exempt; schools
handling students' data often are not).

## Still simulated (as you asked)

M-Pesa prompts remain in test mode – no money moves through the app. Record real M-Pesa payments
with the code ("Record payment") until Daraja is connected.
