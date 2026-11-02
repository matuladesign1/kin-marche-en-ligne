import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase-server';

export type Role = 'customer' | 'store_admin' | 'driver' | 'super_admin';

export interface CurrentUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: p } = await sb.from('profiles').select('id, email, full_name, role, is_active').eq('id', data.user.id).maybeSingle();
  if (!p || !p.is_active) return null;
  return { id: p.id, email: p.email, full_name: p.full_name, role: p.role as Role };
}

/** Garde serveur : redirige si le rôle ne correspond pas. La RLS protège de toute façon les données. */
export async function requireRole(role: Role): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect('/connexion');
  if (u.role !== role) redirect('/');
  return u;
}

export function homeFor(role: Role): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'store_admin') return '/magasin';
  return '/acces-refuse';
}
