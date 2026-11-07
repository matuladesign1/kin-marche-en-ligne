'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { pastryError } from './pastry';
import { supabaseServer } from './supabase-server';

// Actions de l'espace Pâtisserie (administration générale et supermarchés). Chaque fonction de la base
// vérifie elle-même les droits : administrateur général, agent « supermarchés » de la zone, ou direction du magasin.

const BASES = ['/admin/patisserie', '/magasin/patisserie'];

function back(formData: FormData, result: { ok?: string; err?: string }, extra: Record<string, string> = {}): never {
  const base = BASES.includes(String(formData.get('base'))) ? String(formData.get('base')) : BASES[0];
  const keep: Record<string, string> = {};
  for (const k of ['tab', 'f', 'store', 'id', 'cf']) {
    const v = formData.get(k);
    if (typeof v === 'string' && v) keep[k] = v;
  }
  const params = { ...keep, ...extra, ...(result.err ? { err: result.err } : {}), ...(result.ok ? { ok: result.ok } : {}) };
  const q = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  revalidatePath(base);
  redirect(`${base}${q ? `?${q}` : ''}`);
}

const str = (formData: FormData, k: string) => String(formData.get(k) ?? '').trim();

/** Ouvre l'espace pâtissier d'un compte existant, rattaché à un supermarché. */
export async function grantChefAction(formData: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('grant_pastry_chef', { p_email: str(formData, 'email'), p_store_id: str(formData, 'store_id') });
  back(formData, error ? { err: pastryError(error.message) }
    : { ok: 'Accès pâtissier ouvert : la personne a été prévenue et complète son profil dans l’application.' }, { tab: 'chefs', cf: 'all' });
}

async function setStatus(formData: FormData, status: 'active' | 'suspended' | 'revoked', ok: string) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('set_pastry_chef_status', { p_chef: str(formData, 'chef'), p_status: status });
  back(formData, error ? { err: pastryError(error.message) } : { ok });
}
export async function suspendChefAction(formData: FormData) { await setStatus(formData, 'suspended', 'Pâtissier suspendu : il ne reçoit plus de commandes.'); }
export async function activateChefAction(formData: FormData) { await setStatus(formData, 'active', 'Pâtissier réactivé.'); }
export async function revokeChefAction(formData: FormData) { await setStatus(formData, 'revoked', 'Accès pâtissier retiré : le compte redevient un compte client.'); }

async function certify(formData: FormData, value: boolean) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('certify_pastry_chef', { p_chef: str(formData, 'chef'), p_certified: value });
  back(formData, error ? { err: pastryError(error.message) }
    : { ok: value ? 'Pâtissier certifié : son badge s’affiche auprès des clients.' : 'Certification retirée.' });
}
export async function certifyChefAction(formData: FormData) { await certify(formData, true); }
export async function uncertifyChefAction(formData: FormData) { await certify(formData, false); }

/** Refus motivé d'une demande (le motif est envoyé au client). */
export async function rejectRequestAction(formData: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('pastry_reject', { p_id: str(formData, 'id'), p_reason: str(formData, 'reason') });
  back(formData, error ? { err: pastryError(error.message) } : { ok: 'Demande refusée : le client a été prévenu.' });
}

/** Annulation d'une demande non payée. */
export async function cancelRequestAction(formData: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.rpc('pastry_cancel', { p_id: str(formData, 'id'), p_reason: str(formData, 'reason') || null });
  back(formData, error ? { err: pastryError(error.message) } : { ok: 'Demande annulée : le client a été prévenu.' });
}

/** Message au client depuis l'administration (discussion de la commande). */
export async function messageCustomerAction(formData: FormData) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/connexion');
  const body = str(formData, 'body');
  if (!body) back(formData, { err: 'Écrivez un message.' });
  const { error } = await sb.from('pastry_messages').insert({ cake_order_id: str(formData, 'id'), sender_id: auth.user.id, body: body.slice(0, 2000) });
  back(formData, error ? { err: pastryError(error.message) } : { ok: 'Message envoyé au client.' });
}

/** Réglages (administrateur général) : commandes ouvertes, délai minimum en heures. */
export async function saveSettingsAction(formData: FormData) {
  const sb = await supabaseServer();
  const lead = Number(str(formData, 'lead'));
  const { error } = await sb.rpc('save_pastry_settings', { p_enabled: formData.get('enabled') === 'on', p_min_lead_hours: Number.isFinite(lead) ? Math.round(lead) : -1 });
  back(formData, error ? { err: pastryError(error.message) } : { ok: 'Réglages de la pâtisserie enregistrés.' });
}
