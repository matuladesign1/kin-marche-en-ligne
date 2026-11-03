'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loyaltyError, parseMembers } from '@/lib/loyalty';
import { supabaseServer } from '@/lib/supabase-server';

// Actions des pages « Cartes fidélité » (administration générale et supermarchés).
// Les droits sont vérifiés par les fonctions de la base (administrateur général
// ou administrateur de supermarché ; import, file d'export et réglages : général seulement).

const BASES = ['/admin/fidelite', '/magasin/fidelite'];

function baseOf(fd: FormData): string {
  const b = String(fd.get('base') ?? '');
  return BASES.includes(b) ? b : '/admin/fidelite';
}

type RpcResult = { error: { message: string; details?: string | null } | null };

function finish(url: string, res: RpcResult, ok: string): never {
  revalidatePath(url);
  const msg = res.error ? `err=${encodeURIComponent(loyaltyError(res.error.message, res.error.details))}` : `ok=${encodeURIComponent(ok)}`;
  redirect(`${url}${url.includes('?') ? '&' : '?'}${msg}`);
}

const note = (fd: FormData) => String(fd.get('note') ?? '').trim() || null;
const userId = (fd: FormData) => String(fd.get('id') ?? '');

export async function setTierAction(fd: FormData) {
  const sb = await supabaseServer();
  const tier = String(fd.get('tier') ?? '');
  const res = await sb.rpc('admin_set_loyalty_tier', { p_user: userId(fd), p_tier: tier, p_note: note(fd) });
  const label = ({ silver: 'Argent', gold: 'Gold', platinum: 'Platinum' } as Record<string, string>)[tier] ?? tier;
  finish(`${baseOf(fd)}/${userId(fd)}`, res, `Carte au niveau ${label} : le client a été notifié`);
}

export async function suspendAction(fd: FormData) {
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_set_loyalty_card_status', { p_user: userId(fd), p_status: 'suspended', p_note: note(fd) });
  finish(`${baseOf(fd)}/${userId(fd)}`, res, 'Carte suspendue');
}

export async function reactivateAction(fd: FormData) {
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_set_loyalty_card_status', { p_user: userId(fd), p_status: 'active', p_note: note(fd) });
  finish(`${baseOf(fd)}/${userId(fd)}`, res, 'Carte réactivée');
}

export async function adjustPointsAction(fd: FormData) {
  const sb = await supabaseServer();
  const raw = String(fd.get('points') ?? '').replace(/\s/g, '');
  const pts = /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN;
  const res = Number.isSafeInteger(pts)
    ? await sb.rpc('admin_adjust_loyalty_points', { p_user: userId(fd), p_points: pts, p_note: note(fd) })
    : { error: { message: 'INVALID_POINTS' } };
  finish(`${baseOf(fd)}/${userId(fd)}`, res, `${pts > 0 ? '+' : ''}${pts} points enregistrés`);
}

async function link(fd: FormData, action: 'verify' | 'unlink' | 'relink', ok: string) {
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_loyalty_link', { p_user: userId(fd), p_action: action });
  finish(`${baseOf(fd)}/${userId(fd)}`, res, ok);
}
export async function verifyLinkAction(fd: FormData) { await link(fd, 'verify', 'Carte vérifiée : les points du magasin sont utilisables'); }
export async function unlinkAction(fd: FormData) { await link(fd, 'unlink', 'Liaison retirée'); }
export async function relinkAction(fd: FormData) { await link(fd, 'relink', 'Nouvelle liaison autorisée'); }

// Touche Entrée dans un champ : aucune action.
export async function noAction() {}

const REASONS: Record<string, string> = { CARD_NUMBER: 'numéro invalide', DUPLICATE: 'doublon', POINTS: 'points invalides', FORMAT: 'ligne illisible' };

export async function importMembersAction(fd: FormData) {
  const file = fd.get('file');
  let text = String(fd.get('text') ?? '');
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) redirect(`/admin/fidelite/import?err=${encodeURIComponent('Fichier trop volumineux (5 Mo au plus).')}`);
    text = await file.text();
  }
  const { rows } = parseMembers(text);
  if (!rows.length) {
    redirect(`/admin/fidelite/import?err=${encodeURIComponent('Aucune ligne avec un numéro de carte ou de téléphone n’a été trouvée.')}`);
  }
  const sb = await supabaseServer();
  const total = { rows: 0, inserted: 0, updated: 0, linked: 0, points: 0, invalid: [] as { row: number; reason: string }[] };
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const { data, error } = await sb.rpc('admin_import_loyalty_members', { p_rows: chunk });
    if (error) finish('/admin/fidelite/import', { error }, '');
    total.rows += data.rows; total.inserted += data.inserted; total.updated += data.updated;
    total.linked += data.linked; total.points += data.points_delta;
    for (const x of data.invalid ?? []) total.invalid.push({ row: x.row + i + 1, reason: x.reason });
  }
  const skipped = total.invalid.length
    ? ` Lignes ignorées : ${total.invalid.slice(0, 8).map((x) => `${x.row} (${REASONS[x.reason] ?? x.reason})`).join(', ')}${total.invalid.length > 8 ? '…' : ''}.`
    : '';
  finish('/admin/fidelite/import', { error: null },
    `${total.rows} lignes lues : ${total.inserted} nouveaux membres, ${total.updated} mis à jour, ${total.linked} cartes reliées automatiquement à un compte de l’application${total.points ? `, ${total.points > 0 ? '+' : ''}${total.points} points mis à jour` : ''}.${skipped}`);
}

export async function saveSettingsAction(fd: FormData) {
  const num = (k: string) => Number(String(fd.get(k) ?? '').replace(/\s/g, '').replace(',', '.'));
  const settings = {
    enroll_min_cdf: num('enroll_min_cdf'),
    earn_per_usd: num('earn_per_usd'),
    point_value_usd: num('point_value_usd'),
    max_redeem_ratio: num('max_redeem_pct') / 100,
    expiry_days: num('expiry_days'),
    link_review: fd.get('link_review') === 'on',
    tier_bonus: { silver: num('bonus_silver') / 100, gold: num('bonus_gold') / 100, platinum: num('bonus_platinum') / 100 },
    program: {
      name: String(fd.get('program_name') ?? '').trim(),
      url: String(fd.get('program_url') ?? '').trim(),
      phone: String(fd.get('program_phone') ?? '').trim(),
    },
  };
  const bad = Object.entries(settings).find(([, v]) => typeof v === 'number' && !Number.isFinite(v));
  const sb = await supabaseServer();
  const res = bad ? { error: { message: 'INVALID_SETTING', details: bad[0] } } : await sb.rpc('admin_update_loyalty_settings', { p_settings: settings });
  finish('/admin/fidelite/reglages', res, 'Réglages du programme enregistrés');
}

async function mark(fd: FormData, status: 'sent' | 'skipped' | 'pending', ok: string) {
  const ids = fd.getAll('ids').map((v) => Number(v)).filter((n) => Number.isSafeInteger(n));
  const back = `/admin/fidelite/operations?f=${encodeURIComponent(String(fd.get('f') ?? 'pending'))}`;
  if (!ids.length) redirect(`${back}&err=${encodeURIComponent('Cochez au moins une opération.')}`);
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_mark_loyalty_sync', { p_ids: ids, p_status: status });
  finish(back, res, `${ids.length} opération(s) ${ok}`);
}
export async function markSentAction(fd: FormData) { await mark(fd, 'sent', 'marquée(s) comme saisie(s) dans Kin Marché Fidélité'); }
export async function markSkippedAction(fd: FormData) { await mark(fd, 'skipped', 'ignorée(s)'); }
export async function markPendingAction(fd: FormData) { await mark(fd, 'pending', 'remise(s) en attente'); }
