// Supabase Edge Function: send a client their 6-digit sign-in code by SMS, WhatsApp or email.
//
// Secrets (Dashboard → Edge Functions → Secrets). A channel without its secrets runs in SIMULATION
// mode (the code is returned to the app and shown on screen) – never leave that on in the live app:
//   OTP_SIMULATE=1                 allow simulation (testing only)
//   SMS:      AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional)          – Africa's Talking
//   WhatsApp: WA_TOKEN, WA_PHONE_NUMBER_ID, WA_TEMPLATE (approved "authentication" template, default "login_code")
//   Email:    RESEND_API_KEY, EMAIL_FROM (e.g. "Dantesras <no-reply@yourdomain.co.ke>")
//
// Deploy: supabase functions deploy portal-otp
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const text = (code: string) => `${code} is your Dantesras sign-in code. It expires in 10 minutes. Don't share it with anyone.`;

async function sendSms(to: string, code: string) {
  const body = new URLSearchParams({ username: env('AT_USERNAME'), to: '+' + to, message: text(code) });
  if (env('AT_SENDER_ID')) body.set('from', env('AT_SENDER_ID'));
  const host = env('AT_USERNAME') === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const r = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST', headers: { apiKey: env('AT_API_KEY'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error('Could not send the SMS. Try WhatsApp or email.');
}

async function sendWhatsApp(to: string, code: string) {
  const r = await fetch(`https://graph.facebook.com/v20.0/${env('WA_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${env('WA_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: env('WA_TEMPLATE') || 'login_code', language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ] },
    }),
  });
  if (!r.ok) throw new Error('Could not send the WhatsApp message. Try SMS or email.');
}

async function sendEmail(to: string, code: string) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM'), to, subject: `${code} – your Dantesras sign-in code`, text: text(code) }),
  });
  if (!r.ok) throw new Error('Could not send the email. Try SMS or WhatsApp.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { channel, address } = await req.json();
    const ready = channel === 'sms' ? !!env('AT_API_KEY') : channel === 'whatsapp' ? !!env('WA_TOKEN') : !!env('RESEND_API_KEY');
    if (!ready && env('OTP_SIMULATE') !== '1') return json({ message: `Sign-in by ${channel} is not available yet. Try another way.` }, 400);

    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await db.rpc('portal_issue_code', { p_channel: channel, p_address: address });
    if (error) return json({ message: error.message }, 400);

    if (!ready) return json({ sent: true, channel, to: data.address, simulated: true, dev_code: data.code });
    if (channel === 'sms') await sendSms(data.address, data.code);
    else if (channel === 'whatsapp') await sendWhatsApp(data.address, data.code);
    else await sendEmail(data.address, data.code);
    return json({ sent: true, channel, to: data.address, simulated: false });
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
