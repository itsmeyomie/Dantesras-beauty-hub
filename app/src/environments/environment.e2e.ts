// End-to-end tests: a separate, throw-away copy of the internal database on port 54329
// (started by playwright.config.ts), so tests never touch your own test data.
export const environment = {
  production: false,
  supabaseUrl: 'http://localhost:54329',
  supabaseAnonKey: 'local-dev',
  /** Show simulated M-Pesa prompts and one-time codes on screen (no Daraja / SMS account yet). */
  simulate: true,
};
