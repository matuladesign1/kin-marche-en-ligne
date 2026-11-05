import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * « Version » de la messagerie visible par la personne connectée (RLS) : dernier fil modifié,
 * dernier message, dernière lecture. La page ne se recharge que si cette valeur change.
 */
export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ v: null }, { status: 401 });
  const store = new URL(req.url).searchParams.get('store');
  let tickets = sb.from('support_tickets').select('updated_at').order('updated_at', { ascending: false }).limit(1);
  if (store && /^[0-9a-f-]{36}$/i.test(store)) tickets = tickets.eq('store_id', store);
  const [t, m, r] = await Promise.all([
    tickets,
    sb.from('messages').select('created_at').order('created_at', { ascending: false }).limit(1),
    sb.from('messages').select('read_at').not('read_at', 'is', null).order('read_at', { ascending: false }).limit(1),
  ]);
  const v = [t.data?.[0]?.updated_at, m.data?.[0]?.created_at, r.data?.[0]?.read_at].map((x) => x ?? '').join('|');
  return NextResponse.json({ v }, { headers: { 'Cache-Control': 'no-store' } });
}
