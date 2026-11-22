import type { CapacitorConfig } from '@capacitor/cli';

// Android app. Build:  npm run android:build   (test build, talks to the internal test database)
// LIVE=1 npm run android:build  → for the real Supabase backend (https only).
const live = process.env['LIVE'] === '1';

const config: CapacitorConfig = {
  appId: 'ke.dantesras.app',
  appName: 'Dantesras',
  webDir: 'www',
  backgroundColor: '#faf6f0',
  android: {
    // test build reaches the computer's database over plain http (10.0.2.2 / Wi-Fi IP)
    allowMixedContent: !live,
  },
  server: live ? { androidScheme: 'https' } : { androidScheme: 'http', cleartext: true },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#4a0f1b', showSpinner: false },
  },
};

export default config;
