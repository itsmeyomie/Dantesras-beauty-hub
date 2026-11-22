// Development: the internal test database (local-db). Start it with:  cd local-db && npm start
// To use a real Supabase project instead, put its Project URL and anon key here
// (Supabase Dashboard → Project Settings → API).
export const environment = {
  production: false,
  supabaseUrl: 'http://localhost:54321',
  supabaseAnonKey: 'local-dev',
  /** Show simulated M-Pesa prompts and one-time codes on screen (no Daraja / SMS account yet). */
  simulate: true,
};
