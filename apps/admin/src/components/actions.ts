'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

export async function signOutAction() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/connexion');
}
