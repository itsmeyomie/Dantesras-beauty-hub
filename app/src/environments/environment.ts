// Development: the internal test database (local-db). Start it with:  cd local-db && npm start
// To use a real Supabase project instead, put its Project URL and anon key here
// (Supabase Dashboard → Project Settings → API).
export const environment = {
  production: false,
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: 'local-dev',
  /** Show simulated M-Pesa prompts and one-time codes on screen (no Daraja / SMS account yet). */
  simulate: true,
  /** true = client sign-in codes are shown on screen and "Google" is simulated (test mode).
   *  false = real email codes and Google through Supabase Auth (set up the free accounts first – docs/free-setup.md). */
  simulateSignIn: true,
};
