// =====================================================================
// push-send – sends waiting notifications to phones through Firebase Cloud Messaging (free).
// Called every minute by the database job in supabase/live/push-cron.sql.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   FIREBASE_SERVICE_ACCOUNT  the whole JSON file from Firebase → Project settings → Service accounts
//                             → "Generate new private key". Without it, nothing is pushed (notifications
//                             still show in the app).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Deploy with "Verify JWT" OFF – the request is checked with the job's own secret instead.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

type Job = { id: string; title: string; body: string; url: string | null; devices: string[] };
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** OAuth access token for FCM from the service account (signed JWT, RS256). */
async function googleToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Google token: ' + JSON.stringify(j));
  return j.access_token;
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: allowed } = await db.rpc('push_check_secret', { p_secret: req.headers.get('x-job-secret') ?? '' });
  if (!allowed) return new Response('Not allowed', { status: 401 });

  const { data: jobs, error } = await db.rpc('push_take_batch', { p_limit: 100 });
  if (error) return new Response(error.message, { status: 500 });
  const list = (jobs ?? []) as Job[];
  if (!list.length) return Response.json({ sent: 0 });

  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  const done: { id: string; error?: string }[] = [];
  const dead: string[] = [];
  if (!raw) {
    // Firebase not set up yet: mark as handled so the list doesn't grow; they are still in the app
    await db.rpc('push_mark', { p_done: list.map((j) => ({ id: j.id, error: 'no FIREBASE_SERVICE_ACCOUNT' })), p_dead_devices: [] });
    return Response.json({ sent: 0, note: 'FIREBASE_SERVICE_ACCOUNT not set' });
  }
  const sa = JSON.parse(raw) as ServiceAccount;
  const token = await googleToken(sa);
  let sent = 0;
  for (const j of list) {
    let err: string | undefined;
    for (const device of j.devices) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: device,
            notification: { title: j.title, body: j.body },
            data: { url: j.url ?? '' },
            android: { priority: 'high', notification: { channel_id: 'dantesras', color: '#7b1e2e' } },
          },
        }),
      });
      if (res.ok) sent++;
      else {
        const t = await res.text();
        if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t)) dead.push(device);
        else err = `${res.status} ${t.slice(0, 200)}`;
      }
    }
    done.push({ id: j.id, error: j.devices.length ? err : 'no phone registered' });
  }
  await db.rpc('push_mark', { p_done: done, p_dead_devices: dead });
  return Response.json({ sent, notifications: list.length });
});
