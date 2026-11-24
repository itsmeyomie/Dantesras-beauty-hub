// Android build (npm run android:build) – the Dantesras Supabase project, so the app works on any phone.
// Build it with LIVE=1 (https only):  PowerShell:  $env:LIVE='1'; npm run android:build
// To test against the internal database on this computer instead, use http://10.0.2.2:54321 (emulator)
// and key 'local-dev', and build without LIVE.
export const environment = {
  production: true,
  supabaseUrl: 'https://frjflqepqhjkxfzknnoz.supabase.co',
  supabaseAnonKey: 'sb_publishable_kbfjk0D-jDpZ0gWDf6opaw_Iwscb68J',
  /** TEST MODE: sign-in codes and M-Pesa prompts shown on screen (no SMS, no money). */
  simulate: true,
  /** true = client sign-in codes are shown on screen and "Google" is simulated (test mode).
   *  false = real email codes and Google through Supabase Auth (set up the free accounts first – docs/free-setup.md). */
  simulateSignIn: true,
};
