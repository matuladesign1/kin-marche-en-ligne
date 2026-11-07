import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase-server';

export type Role = 'customer' | 'store_admin' | 'driver' | 'super_admin' | 'agent' | 'pastry_chef';
export type Permission = 'stores' | 'drivers' | 'support' | 'finance' | 'users' | 'marketing';

export const PERMISSION_LABELS: Record<Permission, string> = {
  stores: 'Gestion d’ajouts Supermarché',
  drivers: 'Gestion d’ajouts Livreurs',
  support: 'Assistant messagerie',
  finance: 'Gestionnaire financier',
  users: 'Gestion utilisateurs et rôles',
  marketing: 'Gestionnaire de coupons et bannières',
};

export interface Scope { permission: Permission; province: string | null; city: string | null; commune: string | null }

export interface CurrentUser {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  isSuper: boolean;
  permissions: Permission[];
  scopes: Scope[];
}

export async function currentUser(): Promise<CurrentUser | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await sb.from('profiles').select('id, email, full_name, avatar_url, role, is_active').eq('id', data.user.id).maybeSingle();
  if (!p || !p.is_active) return null;
  let scopes: Scope[] = [];
  if (p.role === 'agent') {
    const { data: rows } = await sb.from('staff_permissions').select('permission, province, city, commune')
      .eq('user_id', p.id).is('revoked_at', null);
    scopes = (rows ?? []) as Scope[];
  }
  const isSuper = p.role === 'super_admin';
  const permissions = isSuper ? (Object.keys(PERMISSION_LABELS) as Permission[]) : [...new Set(scopes.map((s) => s.permission))];
  return { id: p.id, email: p.email, full_name: p.full_name, avatar_url: p.avatar_url, role: p.role as Role, isSuper, permissions, scopes };
}

/** Garde serveur : redirige si le rôle ne correspond pas. La RLS protège de toute façon les données. */
export async function requireRole(role: Role): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect('/connexion');
  if (u.role !== role) redirect('/');
  return u;
}

/** Administrateur général ou agent de la Direction. */
export async function requireStaff(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect('/connexion');
  if (!u.isSuper && u.role !== 'agent') redirect('/');
  return u;
}

/** Mission requise (l'administrateur général les a toutes). */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const u = await requireStaff();
  if (!u.permissions.includes(permission)) redirect(`/admin?err=${encodeURIComponent('Accès non attribué : ' + PERMISSION_LABELS[permission])}`);
  return u;
}

export async function requireSuper(): Promise<CurrentUser> {
  const u = await requireStaff();
  if (!u.isSuper) redirect(`/admin?err=${encodeURIComponent('Réservé à l’administrateur général')}`);
  return u;
}

export function homeFor(role: Role): string {
  if (role === 'super_admin' || role === 'agent') return '/admin';
  if (role === 'store_admin') return '/magasin';
  return '/acces-refuse';
}

/** Libellé lisible de la zone d'un agent. */
export function scopeLabel(s: { province: string | null; city: string | null; commune: string | null }): string {
  const parts = [s.commune, s.city, s.province].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Toutes les régions';
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/** Même règle que la base (has_permission_in) : un lieu est dans la zone d'une mission de l'utilisateur. */
export function inScope(user: CurrentUser, permission: Permission, place: { province?: string | null; city?: string | null; commune?: string | null }): boolean {
  if (user.isSuper) return true;
  return user.scopes.some((s) => s.permission === permission
    && (s.province == null || norm(s.province) === norm(place.province))
    && (s.city == null || norm(s.city) === norm(place.city))
    && (s.commune == null || norm(s.commune) === norm(place.commune)));
}
