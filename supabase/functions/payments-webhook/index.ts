import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getProvider, json } from '../_shared/payment-provider.ts';

// Appelé par le prestataire. À déployer avec verify_jwt = false :
// l'authenticité est vérifiée par la signature propre au prestataire (parseWebhook).
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const provider = getProvider();
  if (!provider) return json({ error: 'PAYMENT_PROVIDER_NOT_CONFIGURED' }, 503);

  const raw = await req.text();
  let event;
  try {
    event = await provider.parseWebhook(req, raw);
  } catch {
    return json({ error: 'INVALID_SIGNATURE' }, 401);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (event.status === 'succeeded') {
    const { data, error } = await admin.rpc('confirm_payment', {
      p_payment_id: event.paymentId, p_provider_reference: event.providerReference,
      p_amount: event.amount, p_currency: event.currency, p_raw: event.raw,
    });
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }
  await admin.rpc('fail_payment', { p_payment_id: event.paymentId, p_reason: event.reason ?? 'failed', p_raw: event.raw });
  return json({ ok: true });
});
