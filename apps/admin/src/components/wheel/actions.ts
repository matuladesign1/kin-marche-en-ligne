'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { kinLocalToIso, wheelError } from '@/lib/wheel';
import { supabaseServer } from '@/lib/supabase-server';

// Actions de la page « Roue de la chance » (administrateur général) et des commandes des supermarchés.
// Les droits sont vérifiés par les fonctions de la base.

type RpcResult = { error: { message: string } | null };

function finish(url: string, res: RpcResult, ok: string): never {
  revalidatePath(url.split('?')[0]);
  const msg = res.error ? `err=${encodeURIComponent(wheelError(res.error.message))}` : `ok=${encodeURIComponent(ok)}`;
  redirect(`${url}${url.includes('?') ? '&' : '?'}${msg}`);
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const num = (fd: FormData, k: string) => str(fd, k).replace(/\s/g, '').replace(',', '.');

export async function saveWheelSettingsAction(fd: FormData) {
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_update_wheel_settings', {
    p_settings: {
      enabled: fd.get('enabled') === 'on',
      min_order_usd: num(fd, 'min_order_usd'),
      spins_per_order: num(fd, 'spins_per_order'),
      spin_validity_days: num(fd, 'spin_validity_days'),
      coupon_validity_days: num(fd, 'coupon_validity_days'),
      // Heure de Kinshasa ; vide = sans limite.
      starts_at: kinLocalToIso(str(fd, 'starts_at')),
      ends_at: kinLocalToIso(str(fd, 'ends_at')),
    },
  });
  finish('/admin/roue', res, 'Réglages de la roue enregistrés');
}

export async function savePrizeAction(fd: FormData) {
  const id = str(fd, 'id') || null;
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_save_wheel_prize', {
    p_id: id,
    p: {
      label: str(fd, 'label'),
      label_i18n: { en: str(fd, 'label_en'), ln: str(fd, 'label_ln'), sw: str(fd, 'label_sw') },
      kind: str(fd, 'kind'),
      value: num(fd, 'value'),
      product_id: str(fd, 'product_id'),
      quantity: num(fd, 'quantity'),
      min_order_usd: num(fd, 'min_order_usd'),
      weight: num(fd, 'weight'),
      stock: num(fd, 'stock'),
      color: str(fd, 'color'),
      is_active: fd.get('is_active') === 'on',
      sort_order: num(fd, 'sort_order'),
    },
  });
  finish('/admin/roue', res, id ? 'Lot modifié' : 'Lot ajouté à la roue');
}

export async function deletePrizeAction(fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_delete_wheel_prize', { p_id: str(fd, 'id') });
  finish('/admin/roue', { error }, data === 'disabled' ? 'Lot déjà gagné : il est désactivé (l’historique des gains est conservé)' : 'Lot supprimé');
}

const REWARD_OK: Record<string, string> = {
  deliver: 'Cadeau marqué comme remis : le client a été notifié',
  cancel: 'Gain annulé',
  reset: 'Cadeau remis en attente : il sera joint à la prochaine commande payée',
};

export async function rewardAction(fd: FormData) {
  const action = str(fd, 'action');
  const back = `/admin/roue?view=gains${str(fd, 'qs') ? `&${str(fd, 'qs')}` : ''}`;
  const sb = await supabaseServer();
  const res = await sb.rpc('admin_set_wheel_reward', { p_id: str(fd, 'id'), p_action: action, p_note: str(fd, 'note') || null });
  finish(back, res, REWARD_OK[action] ?? 'Gain mis à jour');
}

export async function grantSpinsAction(fd: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc('admin_grant_wheel_spins', {
    p_query: str(fd, 'customer'), p_count: Number(num(fd, 'count')), p_note: str(fd, 'note') || null,
  });
  const who = (data as { full_name?: string | null } | null)?.full_name ?? 'le client';
  const n = (data as { count?: number } | null)?.count ?? 0;
  finish('/admin/roue?view=offrir', { error }, `${n} tour(s) offert(s) à ${who} : une notification lui a été envoyée`);
}

/** Supermarché : cadeau indisponible pour cette commande → reporté à la suivante. */
export async function deferGiftAction(fd: FormData) {
  const orderId = str(fd, 'order_id');
  const sb = await supabaseServer();
  const res = await sb.rpc('store_defer_wheel_gift', { p_reward: str(fd, 'id'), p_note: str(fd, 'note') || null });
  finish(`/magasin/commandes/${orderId}`, res, 'Cadeau reporté à la prochaine commande du client');
}
