import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, getProvider, json, type PaymentMethod } from '../_shared/payment-provider.ts';

const METHODS: PaymentMethod[] = ['mpesa', 'orange_money', 'airtel_money', 'afrimoney', 'visa', 'mastercard', 'bank_transfer', 'other'];
const MOBILE: PaymentMethod[] = ['mpesa', 'orange_money', 'airtel_money', 'afrimoney'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  // Client « utilisateur » : la RLS garantit qu'il ne voit que SES commandes.
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: 'AUTH_REQUIRED' }, 401);

  let body: { order_id?: string; method?: PaymentMethod; payer_phone?: string };
  try { body = await req.json(); } catch { return json({ error: 'INVALID_BODY' }, 400); }
  if (!body.order_id || !body.method || !METHODS.includes(body.method)) return json({ error: 'INVALID_BODY' }, 400);
  if (MOBILE.includes(body.method) && !/^\+?\d{9,15}$/.test(body.payer_phone ?? '')) return json({ error: 'INVALID_PHONE' }, 400);

  const { data: order } = await userClient.from('orders')
    .select('id, order_number, customer_id, status, payment_status, total_usd, display_currency, exchange_rate')
    .eq('id', body.order_id).maybeSingle();
  if (!order || order.customer_id !== userData.user.id) return json({ error: 'ORDER_NOT_FOUND' }, 404);
  if (order.status !== 'received' || !['pending', 'failed'].includes(order.payment_status)) return json({ error: 'ORDER_NOT_PAYABLE' }, 409);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await admin.from('app_settings').select('value').eq('key', 'payments').maybeSingle();
  const enabled: string[] = cfg?.value?.enabled_methods ?? [];
  const provider = getProvider();
  if (!provider || !enabled.includes(body.method) || !provider.supports(body.method)) {
    return json({ error: 'PAYMENT_PROVIDER_NOT_CONFIGURED' }, 503);
  }

  const currency = order.display_currency as 'USD' | 'CDF' | 'EUR';
  const amount = currency === 'USD' ? Number(order.total_usd) : Math.ceil(Number(order.total_usd) * Number(order.exchange_rate));
  const phone = body.payer_phone ?? null;

  const { data: payment, error } = await admin.from('payments').insert({
    order_id: order.id, customer_id: order.customer_id, method: body.method, provider: provider.name,
    amount, currency, amount_usd: order.total_usd, status: 'pending',
    payer_phone_masked: phone ? phone.slice(0, 6) + '•••' + phone.slice(-2) : null,
  }).select('id').single();
  if (error || !payment) return json({ error: 'PAYMENT_CREATE_FAILED' }, 500);

  try {
    const res = await provider.initiate({
      paymentId: payment.id, orderNumber: order.order_number, amount, currency, method: body.method,
      payerPhone: phone ?? undefined, callbackUrl: `${url}/functions/v1/payments-webhook`,
    });
    await admin.from('payments').update({ status: 'processing', provider_reference: res.providerReference }).eq('id', payment.id);
    await admin.from('orders').update({ payment_status: 'processing' }).eq('id', order.id);
    // La commande n'est PAS marquée payée ici : seul le webhook vérifié la confirme.
    return json({ payment_id: payment.id, status: 'processing', redirect_url: res.redirectUrl ?? null });
  } catch (e) {
    await admin.rpc('fail_payment', { p_payment_id: payment.id, p_reason: String((e as Error).message ?? e), p_raw: null });
    return json({ error: 'PAYMENT_INITIATION_FAILED' }, 502);
  }
});
