import type { CSSProperties } from 'react';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CampaignComposer, AUDIENCES, LINKS, type Audiences, type ChannelState } from '@/components/campaigns/CampaignComposer';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Flash } from '@/components/Shell';
import { requireSuper } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

// Campagnes promotionnelles de l'administrateur général : application (Messages + push avec photo), WhatsApp, e-mail.

const SUPABASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const BRANDING = `${SUPABASE}/storage/v1/object/public/branding/`;
const CHANNELS = ['app', 'whatsapp', 'email'] as const;
const CHANNEL_FR: Record<string, string> = { app: 'Application', whatsapp: 'WhatsApp', email: 'E-mail' };
const kpi = (c: string) => ({ '--kpi': c }) as CSSProperties;
const back = (q: string): never => redirect(`/admin/campagnes?${q}`);
const fail = (m: string): never => back('err=' + encodeURIComponent(m));

type Campaign = {
  id: string; title: string; body: string; image_url: string | null; link_type: string | null; link_value: string | null;
  audience: string; audience_value: string | null; channels: string[]; status: string; sent_at: string | null; created_at: string;
  stats: Record<string, { sent?: number; failed?: number; skipped?: number; error?: string } | string>;
};
type ChannelResult = { sent?: number; failed?: number; skipped?: number; error?: string };

/** Envoie une campagne sur ses canaux (ou seulement à soi-même pour un test) et résume le résultat. */
async function dispatch(id: string, channels: string[], test: boolean): Promise<string> {
  const sb = await supabaseServer();
  const parts: string[] = [];
  if (channels.includes('app')) {
    const { data, error } = await sb.rpc('campaign_send_app', { p_campaign: id, p_test: test });
    if (error) parts.push(error.message.includes('ALREADY_SENT') ? 'Application : déjà envoyée' : `Application : ${error.message}`);
    else parts.push(test ? 'Application : test reçu dans vos Messages' : `Application : ${data} client(s)`);
  }
  const external = channels.filter((c) => c !== 'app');
  if (external.length) {
    const { data: s } = await sb.auth.getSession();
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    const res = await fetch(`${SUPABASE}/functions/v1/campaign-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      body: JSON.stringify({ campaign_id: id, test, open_base: host ? `https://${host}` : null }),
      cache: 'no-store',
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      const why = res?.status === 404 ? 'service d’envoi pas encore installé sur le serveur' : (json as { error?: string }).error ?? `erreur ${res?.status ?? 'réseau'}`;
      parts.push(`${external.map((c) => CHANNEL_FR[c]).join(' et ')} : ${why}`);
    } else {
      for (const [c, r] of Object.entries((json as { results?: Record<string, ChannelResult> }).results ?? {})) {
        if (r.error === 'NOT_CONFIGURED') { parts.push(`${CHANNEL_FR[c]} : non configuré (voir les réglages)`); continue; }
        const who = c === 'email' ? 'sans e-mail' : 'sans numéro';
        parts.push(`${CHANNEL_FR[c]} : ${r.sent ?? 0} envoyé(s)${r.failed ? `, ${r.failed} échec(s)` : ''}${r.skipped ? `, ${r.skipped} ${who}` : ''}${r.error ? ` — ${r.error}` : ''}`);
      }
    }
  }
  return parts.join(' · ');
}

async function createCampaign(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const intent = String(f.get('intent') ?? 'send');
  const title = String(f.get('title') ?? '').trim();
  const body = String(f.get('body') ?? '').trim();
  const rawImage = String(f.get('image_url') ?? '').trim();
  const image = rawImage.startsWith(BRANDING) ? rawImage : null;
  const linkType = Object.keys(LINKS).includes(String(f.get('link_type'))) ? String(f.get('link_type')) : null;
  const linkValue = linkType === 'product' ? String(f.get('product_id') ?? '').trim()
    : linkType === 'category' ? String(f.get('category_id') ?? '').trim()
    : linkType === 'url' ? String(f.get('url') ?? '').trim() : null;
  const audience = Object.keys(AUDIENCES).includes(String(f.get('audience'))) ? String(f.get('audience')) : 'all';
  const audienceValue = audience === 'city' ? String(f.get('city') ?? '').trim() || null : null;
  const channels = CHANNELS.filter((c) => f.get(`ch_${c}`) === 'on');

  if (!title || !body) fail('Titre et message obligatoires.');
  if (!channels.length) fail('Choisissez au moins un canal.');
  if (channels.includes('whatsapp') && !image) fail('Une photo est obligatoire pour WhatsApp (modèle de message avec image).');
  if ((linkType === 'product' || linkType === 'category') && !linkValue) fail('Choisissez le produit ou la catégorie du lien.');
  if (linkType === 'url' && !/^https:\/\/\S+$/.test(linkValue ?? '')) fail('Le lien du site doit commencer par https://');
  if (audience === 'city' && !audienceValue) fail('Choisissez la ville.');

  const { data, error } = await sb.from('campaigns').insert({
    title, body, image_url: image, link_type: linkType, link_value: linkValue || null,
    audience, audience_value: audienceValue, channels,
  }).select('id').single();
  if (error || !data) fail(error?.message ?? 'Enregistrement impossible.');

  revalidatePath('/admin/campagnes');
  if (intent === 'draft') back('ok=' + encodeURIComponent('Brouillon enregistré.'));
  const summary = await dispatch(data!.id, channels, intent === 'test');
  revalidatePath('/admin/campagnes');
  back('ok=' + encodeURIComponent(intent === 'test' ? `Test envoyé (brouillon enregistré) — ${summary}` : `Campagne envoyée — ${summary}`));
}

/** Envoie un brouillon, ou une campagne aux canaux pas encore partis (par exemple WhatsApp configuré après coup). */
async function sendExisting(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const id = String(f.get('id') ?? '');
  const test = f.get('test') === '1';
  const { data: c } = await sb.from('campaigns').select('channels, stats').eq('id', id).maybeSingle();
  if (!c) fail('Campagne introuvable.');
  const pending = test ? (c!.channels as string[]) : (c!.channels as string[]).filter((ch) => !(ch in ((c!.stats as object) ?? {})));
  if (!pending.length) fail('Tous les canaux de cette campagne sont déjà partis.');
  const summary = await dispatch(id, pending, test);
  revalidatePath('/admin/campagnes');
  back('ok=' + encodeURIComponent(`${test ? 'Test envoyé' : 'Envoi terminé'} — ${summary}`));
}

/** Réutiliser une campagne : copie en brouillon (mêmes texte, photo, lien, public et canaux). */
async function duplicate(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const { data: c } = await sb.from('campaigns')
    .select('title, body, image_url, link_type, link_value, audience, audience_value, channels').eq('id', String(f.get('id') ?? '')).maybeSingle();
  if (!c) fail('Campagne introuvable.');
  const { error } = await sb.from('campaigns').insert(c!);
  revalidatePath('/admin/campagnes');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=' + encodeURIComponent('Copie enregistrée en brouillon : envoyez-la depuis l’historique.'));
}

/** Retire la promotion des « Messages » de tous les clients (l'historique reste). */
async function withdraw(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('campaign_withdraw', { p_campaign: String(f.get('id') ?? '') });
  revalidatePath('/admin/campagnes');
  back(error ? 'err=' + encodeURIComponent(error.message) : 'ok=' + encodeURIComponent(`Promotion retirée de ${data} boîte(s) Messages.`));
}

/** Supprime la campagne de l'historique, la retire des Messages des clients et efface sa photo. */
async function remove(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const id = String(f.get('id') ?? '');
  await sb.rpc('campaign_withdraw', { p_campaign: id });
  const { data: gone, error } = await sb.from('campaigns').delete().eq('id', id).select('image_url');
  if (error) fail(error.message);
  const image = gone?.[0]?.image_url as string | null | undefined;
  if (image?.startsWith(BRANDING)) {
    const { count } = await sb.from('campaigns').select('id', { count: 'exact', head: true }).eq('image_url', image);
    if (!count) await sb.storage.from('branding').remove([image.slice(BRANDING.length)]);
  }
  revalidatePath('/admin/campagnes');
  back('ok=' + encodeURIComponent('Campagne supprimée.'));
}

/** Clés WhatsApp et e-mail : enregistrées dans le coffre du serveur (champ vide = inchangé). */
async function saveChannels(f: FormData) {
  'use server';
  await requireSuper();
  const sb = await supabaseServer();
  const clear = String(f.get('clear') ?? '');
  const groups: Record<string, string[]> = {
    email: ['RESEND_API_KEY', 'EMAIL_FROM'],
    whatsapp: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE', 'WHATSAPP_TEMPLATE_LANG'],
  };
  const names = clear ? groups[clear] ?? [] : Object.values(groups).flat();
  for (const name of names) {
    const value = clear ? '' : String(f.get(name) ?? '').trim();
    if (!clear && !value) continue;
    const { error } = await sb.rpc('set_channel_secret', { p_name: name, p_value: value });
    if (error) fail(error.message);
  }
  revalidatePath('/admin/campagnes');
  back('ok=' + encodeURIComponent(clear ? `${clear === 'email' ? 'E-mail' : 'WhatsApp'} désactivé.` : 'Réglages enregistrés.'));
}

function Stats({ c, live }: { c: Campaign; live?: { delivered: number; seen: number } }) {
  const lines: string[] = [];
  const app = c.stats.app as ChannelResult | undefined;
  if (app?.sent !== undefined) {
    const seen = live?.seen ?? 0;
    const pct = app.sent ? Math.round((seen / app.sent) * 100) : 0;
    lines.push(`Application : ${app.sent} envoyée(s) · ${seen} vue(s) (${pct} %)`);
  }
  for (const ch of ['whatsapp', 'email'] as const) {
    const r = c.stats[ch] as ChannelResult | undefined;
    if (r?.sent !== undefined) lines.push(`${CHANNEL_FR[ch]} : ${r.sent} envoyé(s)${r.failed ? ` · ${r.failed} échec(s)` : ''}${r.skipped ? ` · ${r.skipped} injoignable(s)` : ''}`);
  }
  const pending = c.status === 'sent' ? c.channels.filter((ch) => !(ch in c.stats)) : [];
  return (
    <div className="campaign-stats">
      {lines.map((l) => <span key={l}>{l}</span>)}
      {pending.length ? <span className="warn">Pas encore parti : {pending.map((ch) => CHANNEL_FR[ch]).join(', ')}</span> : null}
      {c.stats.withdrawn_at ? <span className="muted">Retirée des Messages le {dateTime(c.stats.withdrawn_at as string)}</span> : null}
    </div>
  );
}

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireSuper();
  const sp = await searchParams;
  const sb = await supabaseServer();
  const [{ data: rows }, { data: statRows }, { data: aud }, { data: chs }, { data: prodRows }, { data: catRows }] = await Promise.all([
    sb.from('campaigns').select('*').order('created_at', { ascending: false }).limit(60),
    sb.rpc('campaign_stats'),
    sb.rpc('campaign_audiences'),
    sb.rpc('campaign_channels'),
    sb.from('products').select('id, name').eq('is_active', true).order('name').limit(1500),
    sb.from('product_categories').select('id, name, sort_order').eq('is_active', true).order('sort_order'),
  ]);
  const campaigns = (rows ?? []) as Campaign[];
  const live = new Map(((statRows ?? []) as { campaign_id: string; delivered: number; seen: number }[]).map((s) => [s.campaign_id, s]));
  const audiences: Audiences = (aud as Audiences | null) ?? { segments: {}, cities: [] };
  const channels = (chs ?? { email: false, whatsapp: false, push_devices: 0 }) as ChannelState & {
    email_from?: string | null; whatsapp_template?: string | null; whatsapp_lang?: string; whatsapp_phone_id?: string | null;
  };
  const categories = ((catRows ?? []) as { id: string; name: Record<string, string> | string }[])
    .map((c) => ({ id: c.id, name: typeof c.name === 'string' ? c.name : c.name.fr ?? Object.values(c.name)[0] ?? '' }));
  const products = (prodRows ?? []) as { id: string; name: string }[];
  const linkLabel = (c: Campaign) => {
    if (!c.link_type) return 'Sans lien';
    if (c.link_type === 'product') return `Produit : ${products.find((p) => p.id === c.link_value)?.name ?? 'produit'}`;
    if (c.link_type === 'category') return `Catégorie : ${categories.find((x) => x.id === c.link_value)?.name ?? 'catégorie'}`;
    if (c.link_type === 'url') return `Site : ${c.link_value}`;
    return LINKS[c.link_type] ?? c.link_type;
  };
  const sent = campaigns.filter((c) => c.status === 'sent');
  const totalSent = sent.reduce((n, c) => n + ((c.stats.app as ChannelResult | undefined)?.sent ?? 0), 0);
  const totalSeen = sent.reduce((n, c) => n + (live.get(c.id)?.seen ?? 0), 0);

  return (
    <>
      <h1>Campagnes promotionnelles</h1>
      <p className="page-sub">
        Envoyez une promotion avec sa photo directement aux clients : dans l’application (boîte Messages, grande carte et notification push
        avec la photo en grand), sur leur numéro WhatsApp et par e-mail. Faites d’abord un test sur votre propre compte.
      </p>
      <Flash ok={sp.ok} err={sp.err} />

      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="l">Campagnes envoyées</div><div className="v">{sent.length}</div><div className="s">{campaigns.length - sent.length} brouillon(s)</div></div>
        <div className="card kpi" style={kpi('var(--accent)')}><div className="l">Promotions reçues (application)</div><div className="v">{totalSent}</div>
          <div className="s">{totalSeen} vue(s){totalSent ? ` · ${Math.round((totalSeen / totalSent) * 100)} %` : ''}</div></div>
        <div className="card kpi" style={kpi('var(--green)')}><div className="l">Clients joignables</div><div className="v">{audiences.segments.all?.customers ?? 0}</div>
          <div className="s">{audiences.segments.all?.phone ?? 0} avec numéro · {audiences.segments.all?.email ?? 0} avec e-mail</div></div>
        <div className="card kpi" style={kpi('var(--amber)')}><div className="l">Canaux</div>
          <div className="v" style={{ fontSize: 18, marginTop: 10 }}>App ✓ · WhatsApp {channels.whatsapp ? '✓' : '✗'} · E-mail {channels.email ? '✓' : '✗'}</div>
          <div className="s">{channels.push_devices} téléphone(s) avec push actif</div></div>
      </div>

      <CampaignComposer action={createCampaign} audiences={audiences} channels={channels} products={products} categories={categories} />

      <h2 style={{ marginTop: 28 }}>Historique</h2>
      {!campaigns.length ? <p className="muted">Aucune campagne pour le moment.</p> : null}
      <div className="campaign-list">
        {campaigns.map((c) => (
          <div key={c.id} className="card campaign-item">
            <div className="campaign-thumb">{c.image_url ? <img src={c.image_url} alt="" /> : <span>Sans photo</span>}</div>
            <div className="campaign-info">
              <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <b>{c.title}</b>
                {c.status === 'sent' ? <span className="badge ok">Envoyée le {dateTime(c.sent_at)}</span> : <span className="badge warn">Brouillon</span>}
              </div>
              <p className="campaign-body">{c.body}</p>
              <div className="campaign-meta">
                <span>{AUDIENCES[c.audience] ?? c.audience}{c.audience_value ? ` : ${c.audience_value}` : ''}</span>
                <span>{c.channels.map((ch) => CHANNEL_FR[ch]).join(' · ')}</span>
                <span>{linkLabel(c)}</span>
                <span>Créée le {dateTime(c.created_at)}</span>
              </div>
              <Stats c={c} live={live.get(c.id)} />
              <div className="row campaign-actions">
                {c.status !== 'sent' || c.channels.some((ch) => !(ch in c.stats)) ? (
                  <form action={sendExisting}>
                    <input type="hidden" name="id" value={c.id} />
                    <ConfirmButton message={c.status === 'sent' ? 'Envoyer aux canaux pas encore partis ?' : 'Envoyer cette campagne maintenant ?'}>
                      {c.status === 'sent' ? 'Envoyer aux canaux restants' : 'Envoyer'}
                    </ConfirmButton>
                  </form>
                ) : null}
                <form action={sendExisting}>
                  <input type="hidden" name="id" value={c.id} /><input type="hidden" name="test" value="1" />
                  <button type="submit" className="secondary">Test sur mon compte</button>
                </form>
                <form action={duplicate}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="secondary">Réutiliser</button>
                </form>
                {c.status === 'sent' && !c.stats.withdrawn_at ? (
                  <form action={withdraw}>
                    <input type="hidden" name="id" value={c.id} />
                    <ConfirmButton className="secondary" message="Retirer cette promotion des Messages de tous les clients ? (Les WhatsApp et e-mails déjà envoyés restent chez les clients.)">
                      Retirer des Messages
                    </ConfirmButton>
                  </form>
                ) : null}
                <form action={remove}>
                  <input type="hidden" name="id" value={c.id} />
                  <ConfirmButton className="danger" message="Supprimer cette campagne ? Elle disparaît de l’historique et des Messages des clients.">Supprimer</ConfirmButton>
                </form>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Réglages WhatsApp et e-mail</h2>
      <p className="page-sub">
        Les clés sont gardées dans le coffre privé du serveur : elles ne s’affichent plus jamais après l’enregistrement.
        Laissez un champ vide pour ne pas le changer.
      </p>
      <div className="campaign-settings">
        <form action={saveChannels} className="card stack">
          <div className="card-title"><span>E-mail (Resend)</span>{channels.email ? <span className="badge ok">configuré</span> : <span className="badge warn">non configuré</span>}</div>
          <label>Clé API Resend<input name="RESEND_API_KEY" type="password" autoComplete="off" placeholder={channels.email ? '•••••••• (enregistrée)' : 're_…'} /></label>
          <label>Expéditeur<input name="EMAIL_FROM" placeholder={channels.email_from ?? 'Kin Marché <promo@votre-domaine.cd>'} /></label>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Créez un compte sur resend.com, vérifiez votre nom de domaine (enregistrements DNS), puis créez une clé API.
            L’adresse de l’expéditeur doit utiliser ce domaine.
          </p>
          <div className="row"><button type="submit">Enregistrer</button>
            {channels.email ? <button type="submit" name="clear" value="email" className="secondary">Désactiver l’e-mail</button> : null}</div>
        </form>
        <form action={saveChannels} className="card stack">
          <div className="card-title"><span>WhatsApp (Meta, API Cloud)</span>{channels.whatsapp ? <span className="badge ok">configuré</span> : <span className="badge warn">non configuré</span>}</div>
          <label>Jeton d’accès permanent<input name="WHATSAPP_TOKEN" type="password" autoComplete="off" placeholder={channels.whatsapp ? '•••••••• (enregistré)' : 'EAAG…'} /></label>
          <label>Identifiant du numéro (Phone number ID)<input name="WHATSAPP_PHONE_NUMBER_ID" inputMode="numeric" placeholder={channels.whatsapp_phone_id ?? '1234567890'} /></label>
          <div className="cols">
            <label>Nom du modèle approuvé<input name="WHATSAPP_TEMPLATE" placeholder={channels.whatsapp_template ?? 'promo_kin_marche'} /></label>
            <label>Langue du modèle<input name="WHATSAPP_TEMPLATE_LANG" placeholder={channels.whatsapp_lang ?? 'fr'} /></label>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Dans le WhatsApp Manager de Meta, créez un modèle de catégorie « Marketing » : en-tête <b>Image</b>,
            corps <code>*{'{{1}}'}*</code> puis <code>{'{{2}}'}</code> (1 = titre, 2 = message). Les promotions partent après l’approbation du modèle par Meta.
          </p>
          <div className="row"><button type="submit">Enregistrer</button>
            {channels.whatsapp ? <button type="submit" name="clear" value="whatsapp" className="secondary">Désactiver WhatsApp</button> : null}</div>
        </form>
      </div>
    </>
  );
}
