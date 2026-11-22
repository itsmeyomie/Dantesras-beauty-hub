// Supabase Edge Function: send an M-Pesa STK push (Lipa na M-Pesa Online) to a phone.
//
// Secrets (Supabase Dashboard → Edge Functions → Secrets). Until DARAJA_CONSUMER_KEY is set the
// function runs in SIMULATION mode: same checks, no request to Safaricom, the app shows the prompt.
//   DARAJA_ENV              sandbox | production
//   DARAJA_CONSUMER_KEY     from the Daraja app
//   DARAJA_CONSUMER_SECRET
//   DARAJA_SHORTCODE        Paybill number, or for Buy Goods the HEAD OFFICE / store number
//   DARAJA_PASSKEY          Lipa na M-Pesa Online passkey
//   DARAJA_TILL             (Buy Goods only) the till number customers pay to
//   DARAJA_CALLBACK_SECRET  random text; Safaricom calls  …/functions/v1/mpesa-callback?key=<this>
//
// Deploy:  supabase functions deploy mpesa-stk
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';
const live = !!env('DARAJA_CONSUMER_KEY');
const base = env('DARAJA_ENV') === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

async function darajaToken(): Promise<string> {
  const auth = btoa(`${env('DARAJA_CONSUMER_KEY')}:${env('DARAJA_CONSUMER_SECRET')}`);
  const r = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`Daraja login failed (${r.status})`);
  return (await r.json()).access_token;
}

function timestamp(): string {
  // yyyyMMddHHmmss in Kenyan time
  const d = new Date(Date.now() + 3 * 3600_000);
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json();
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

    // same checks as the database: valid phone, amount ≤ what is owed, booking still open…
    const { data: row, error } = await db.rpc('stk_create', {
      p_purpose: b.purpose, p_phone: b.phone, p_amount: b.amount,
      p_booking_id: b.booking_id ?? null, p_sale_id: b.sale_id ?? null, p_student_id: b.student_id ?? null,
      p_simulated: !live,
    });
    if (error) return json({ message: error.message }, 400);

    if (!live) {
      const checkout = `ws_CO_SIM_${Date.now()}`;
      await db.rpc('stk_accepted', { p_id: row.id, p_merchant_request_id: 'SIM', p_checkout_request_id: checkout });
      return json({ id: row.id, checkout_request_id: checkout, phone: row.phone, amount: row.amount, simulated: true,
        customer_message: 'Simulation – no Daraja keys set' });
    }

    const shortcode = env('DARAJA_SHORTCODE');
    const ts = timestamp();
    const till = env('DARAJA_TILL');
    const callback = `${env('SUPABASE_URL')}/functions/v1/mpesa-callback?key=${encodeURIComponent(env('DARAJA_CALLBACK_SECRET'))}`;
    const r = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await darajaToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: btoa(`${shortcode}${env('DARAJA_PASSKEY')}${ts}`),
        Timestamp: ts,
        TransactionType: till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: Math.round(Number(row.amount)),
        PartyA: row.phone,
        PartyB: till || shortcode,
        PhoneNumber: row.phone,
        CallBackURL: callback,
        AccountReference: row.account_ref,
        TransactionDesc: row.description,
      }),
    });
    const out = await r.json();
    if (!r.ok || out.ResponseCode !== '0') {
      const msg = out.errorMessage || out.ResponseDescription || 'M-Pesa did not accept the request';
      await db.rpc('stk_rejected', { p_id: row.id, p_desc: msg });
      return json({ message: msg }, 400);
    }
    await db.rpc('stk_accepted', { p_id: row.id, p_merchant_request_id: out.MerchantRequestID, p_checkout_request_id: out.CheckoutRequestID });
    return json({ id: row.id, checkout_request_id: out.CheckoutRequestID, phone: row.phone, amount: row.amount, simulated: false,
      customer_message: out.CustomerMessage });
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
