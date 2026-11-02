'use client';
import { createBrowserClient } from '@supabase/ssr';

// Client navigateur : réutilise la session (cookies) ouverte sur l'espace web. Clé publique uniquement.
let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!client) client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}
