// Dantesras – minimal service worker so the website can be installed as an app ("Add to Home screen").
// It does NOT cache anything: every visit loads the latest version, bookings are always live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network as normal */ });
