// Android test build (npm run android:build). Talks to the internal test database on this computer:
//  - Android emulator: 10.0.2.2 is the computer's own address.
//  - Real phone on the same Wi-Fi: replace with the computer's IP (e.g. http://192.168.1.20:54321)
//    and start the database with LOCAL_DB_HOST=0.0.0.0.
// For the live app, use the same Supabase URL and anon key as environment.prod.ts and set simulate: false.
export const environment = {
  production: true,
  supabaseUrl: 'http://10.0.2.2:54321',
  supabaseAnonKey: 'local-dev',
  simulate: true,
};
