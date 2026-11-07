import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { adminClient, cors, currentUser, reply, serverSecret } from '../_shared/server.ts';

// Envoi d'une campagne promotionnelle sur WhatsApp et par e-mail (le canal « Application » passe par la base :
// fonction campaign_send_app). Appelée par l'administration web avec la session de l'administrateur général.
// Clés des fournisseurs : coffre privé du serveur (réglées depuis l'administration, jamais relues).

type Recipient = { user_id: string; full_name: string | null; email: string | null; phone: string | null; language: string };
type Campaign = {
  id: string; title: string; body: string; image_url: string | null; link_type: string | null; link_value: string | null;
  channels: string[]; stats: Record<string, unknown>;
};
type Result = { sent: number; failed: number; skipped: number; error?: string; at: string };

const GRAPH = 'https://graph.facebook.com/v25.0';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const firstName = (r: Recipient) => (r.full_name ?? '').trim().split(/\s+/)[0] ?? '';

/** Numéro WhatsApp au format international sans « + » (RDC : 0812345678 ou 812345678 → 243812345678). */
export function waNumber(phone: string | null): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '243' + d.slice(1);
  else if (d.length === 9) d = '243' + d;
  return /^\d{11,15}$/.test(d) ? d : null;
}
const validEmail = (e: string | null) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** Lien « Voir l'offre » : page publique de l'administration qui ouvre l'application (ou propose de la télécharger). */
function offerLink(c: Campaign, openBase: string | null): string | null {
  if (!c.link_type) return null;                   // message seul : pas de bouton
  if (c.link_type === 'url') return c.link_value && /^https:\/\//.test(c.link_value) ? c.link_value : null;
  if (!openBase) return null;
  const q = new URLSearchParams({ c: c.id });
  if (c.link_type) q.set('t', c.link_type);
  if (c.link_value) q.set('v', c.link_value);
  return `${openBase}/ouvrir?${q.toString()}`;
}

function emailHtml(c: Campaign, r: Recipient, link: string | null, openBase: string | null): string {
  const hello = firstName(r) ? `Bonjour ${esc(firstName(r))},` : 'Bonjour,';
  const body = esc(c.body).replace(/\r?\n/g, '<br>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F3">
<div style="display:none;max-height:0;overflow:hidden">${esc(c.body.slice(0, 120))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden">
${openBase ? `<tr><td style="padding:16px 22px;border-bottom:1px solid #EEEEEE"><img src="${openBase}/logo-wide.png" alt="Kin Marché" height="40" style="display:block;height:40px;width:auto"></td></tr>` : ''}
${c.image_url ? `<tr><td>${link ? `<a href="${esc(link)}">` : ''}<img src="${esc(c.image_url)}" alt="${esc(c.title)}" width="560" style="display:block;width:100%;height:auto;border:0">${link ? '</a>' : ''}</td></tr>` : ''}
<tr><td style="padding:22px 22px 8px;color:#5B6170;font-size:14px">${hello}</td></tr>
<tr><td style="padding:0 22px"><h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:#1B1D22">${esc(c.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3D4250">${body}</p></td></tr>
${link ? `<tr><td style="padding:0 22px 26px"><a href="${esc(link)}" style="display:inline-block;background:#E60024;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:12px">Voir l’offre</a></td></tr>` : ''}
<tr><td style="padding:14px 22px;background:#FAFAFA;color:#8A8F9C;font-size:12px;line-height:1.5">Vous recevez ce message parce que vous êtes client(e) Kin Marché.
Pour ne plus recevoir nos promotions : application Kin Marché › Compte › Notifications › Promotions.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmails(c: Campaign, list: Recipient[], key: string, from: string, openBase: string | null): Promise<Result> {
  const out: Result = { sent: 0, failed: 0, skipped: 0, at: new Date().toISOString() };
  const ok = list.filter((r) => validEmail(r.email));
  out.skipped = list.length - ok.length;
  const link = offerLink(c, openBase);
  for (let i = 0; i < ok.length; i += 100) {
    const chunk = ok.slice(i, i + 100);
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map((r) => ({
        from, to: [r.email], subject: c.title,
        html: emailHtml(c, r, link, openBase),
        text: `${firstName(r) ? `Bonjour ${firstName(r)},` : 'Bonjour,'}\n\n${c.title}\n\n${c.body}${link ? `\n\nVoir l'offre : ${link}` : ''}`,
      }))),
    }).catch(() => null);
    if (res?.ok) out.sent += chunk.length;
    else {
      out.failed += chunk.length;
      const j = res ? await res.json().catch(() => ({})) : {};
      out.error ??= res ? `${res.status} ${(j as { message?: string }).message ?? ''}`.trim() : 'Réseau injoignable';
    }
  }
  return out;
}

async function sendWhatsApp(c: Campaign, list: Recipient[], token: string, phoneId: string, template: string, lang: string): Promise<Result> {
  const out: Result = { sent: 0, failed: 0, skipped: 0, at: new Date().toISOString() };
  // Les paramètres d'un modèle WhatsApp n'acceptent ni retour à la ligne ni tabulation.
  const flat = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, max);
  const targets = [...new Set(list.map((r) => waNumber(r.phone)).filter((n): n is string => !!n))];
  out.skipped = list.length - targets.length;
  const components: unknown[] = [];
  if (c.image_url) components.push({ type: 'header', parameters: [{ type: 'image', image: { link: c.image_url } }] });
  components.push({ type: 'body', parameters: [{ type: 'text', text: flat(c.title, 80) }, { type: 'text', text: flat(c.body, 900) }] });

  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const to = targets[next++];
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: lang }, components } }),
      }).catch(() => null);
      if (res?.ok) out.sent++;
      else {
        out.failed++;
        const j = res ? await res.json().catch(() => ({})) : {};
        const e = (j as { error?: { message?: string; error_data?: { details?: string } } }).error;
        out.error ??= res ? `${res.status} ${e?.error_data?.details ?? e?.message ?? ''}`.trim() : 'Réseau injoignable';
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, targets.length) }, worker));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const { user } = await currentUser(req);
  if (!user) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const admin = adminClient();
  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle();
  if (me?.role !== 'super_admin' || !me.is_active) return reply({ error: 'FORBIDDEN' }, 403);

  const body = await req.json().catch(() => ({}));
  const test = body.test === true;
  const openBase = typeof body.open_base === 'string' && /^https:\/\/[^/]+$/.test(body.open_base) ? body.open_base : null;
  const { data: c } = await admin.from('campaigns')
    .select('id, title, body, image_url, link_type, link_value, channels, stats').eq('id', String(body.campaign_id ?? '')).maybeSingle();
  if (!c) return reply({ error: 'NOT_FOUND' }, 404);
  const campaign = c as Campaign;

  const { data: rec, error } = await admin.rpc('campaign_recipients', { p_campaign: campaign.id, p_only: test ? user.id : null });
  if (error) return reply({ error: 'RECIPIENTS_FAILED', detail: error.message }, 500);
  const list = (rec ?? []) as Recipient[];

  const results: Record<string, Result | { error: string }> = {};
  // Jamais deux fois le même canal pour une campagne déjà envoyée (les tests, eux, sont libres).
  const wants = (ch: string) => campaign.channels.includes(ch) && (test || !(ch in (campaign.stats ?? {})));

  if (wants('email')) {
    const key = await serverSecret(admin, 'RESEND_API_KEY');
    const from = await serverSecret(admin, 'EMAIL_FROM');
    results.email = key && from ? await sendEmails(campaign, list, key, from, openBase) : { error: 'NOT_CONFIGURED' };
  }
  if (wants('whatsapp')) {
    const token = await serverSecret(admin, 'WHATSAPP_TOKEN');
    const phoneId = await serverSecret(admin, 'WHATSAPP_PHONE_NUMBER_ID');
    const template = await serverSecret(admin, 'WHATSAPP_TEMPLATE');
    const lang = (await serverSecret(admin, 'WHATSAPP_TEMPLATE_LANG')) ?? 'fr';
    results.whatsapp = token && phoneId && template
      ? await sendWhatsApp(campaign, list, token, phoneId, template, lang)
      : { error: 'NOT_CONFIGURED' };
  }

  // Statistiques : seuls les canaux réellement partis sont enregistrés (un canal non configuré pourra partir plus tard).
  if (!test) {
    const done = Object.fromEntries(Object.entries(results).filter(([, r]) => 'sent' in r));
    if (Object.keys(done).length) {
      const { data: fresh } = await admin.from('campaigns').select('stats, sent_at').eq('id', campaign.id).maybeSingle();
      await admin.from('campaigns').update({
        stats: { ...((fresh?.stats as Record<string, unknown>) ?? {}), ...done },
        status: 'sent', sent_at: fresh?.sent_at ?? new Date().toISOString(),
      }).eq('id', campaign.id);
    }
  }
  return reply({ recipients: list.length, results });
});
