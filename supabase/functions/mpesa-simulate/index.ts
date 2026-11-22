// Supabase Edge Function – SIMULATION ONLY. Answers a simulated STK prompt as if from the phone.
// Refuses to run once real Daraja keys are set, so it can't fake payments in the live system.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const OUTCOMES: Record<string, [number, string]> = {
  pay: [0, 'The service request is processed successfully.'],
  cancel: [1032, 'Request cancelled by user'],
  insufficient: [1, 'The balance is insufficient for the transaction'],
  timeout: [1037, 'DS timeout user cannot be reached'],
  wrong_pin: [2001, 'The initiator information is invalid'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (Deno.env.get('DARAJA_CONSUMER_KEY')) return json({ message: 'Simulation is off – real M-Pesa is connected' }, 403);
  const b = await req.json();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: r } = await db.from('mpesa_stk_requests').select('simulated').eq('checkout_request_id', b.checkout_request_id).single();
  if (!r?.simulated) return json({ message: 'Not a simulated request' }, 400);
  const [code, desc] = OUTCOMES[b.outcome] ?? OUTCOMES.pay;
  const receipt = code === 0 ? 'SIM' + crypto.randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase() : null;
  const { data, error } = await db.rpc('stk_complete', {
    p_checkout_request_id: b.checkout_request_id, p_result_code: code, p_result_desc: desc, p_receipt: receipt,
  });
  if (error) return json({ message: error.message }, 400);
  return json({ ResultCode: code, ResultDesc: desc, status: data.status });
});
