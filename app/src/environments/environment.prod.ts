// Live build (npm run build) – the Dantesras Supabase project.
// The publishable key is meant to be in the app; never put the secret / service_role key here.
export const environment = {
  production: true,
  supabaseUrl: 'https://frjflqepqhjkxfzknnoz.supabase.co',
  supabaseAnonKey: 'sb_publishable_kbfjk0D-jDpZ0gWDf6opaw_Iwscb68J',
  /** true = TEST MODE: sign-in codes and M-Pesa prompts are shown on screen (no SMS, no money).
   *  Set to false once SMS/WhatsApp/email and Daraja keys are added in Supabase. */
  simulate: true,
};
