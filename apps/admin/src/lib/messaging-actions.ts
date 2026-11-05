'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase-server';

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

function back(base: string, params: Record<string, string | null | undefined>) {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return `${base}${q ? `?${q}` : ''}`;
}

/** Réponse dans un fil (texte et/ou pièce jointe). La RLS vérifie que l'auteur participe au fil. */
export async function replyAction(formData: FormData) {
  const base = String(formData.get('base'));
  const ticket = String(formData.get('ticket'));
  const store = (formData.get('store') as string) || null;
  const f = (formData.get('f') as string) || null;
  const q = (formData.get('q') as string) || null;
  const body = String(formData.get('body') ?? '').trim();
  const file = formData.get('file') as File | null;
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/connexion');
  let attachment: string | null = null;
  let err: string | null = null;
  if (file && file.size > 0) {
    if (!ALLOWED.includes(file.type) || file.size > 10 * 1024 * 1024) err = 'Fichier refusé : image ou PDF de 10 Mo maximum.';
    else {
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg');
      const path = `${ticket}/${auth.user.id}/${Date.now()}.${ext}`;
      const up = await sb.storage.from('chat-attachments').upload(path, file, { contentType: file.type });
      if (up.error) err = up.error.message; else attachment = path;
    }
  }
  if (!err && !body && !attachment) err = 'Message vide.';
  if (!err) {
    const { error } = await sb.from('messages').insert({ ticket_id: ticket, sender_id: auth.user.id, body: body || 'Pièce jointe', attachment_path: attachment });
    if (error) err = error.message;
  }
  revalidatePath(base);
  redirect(back(base, { f, q, t: ticket, store, err }));
}

export async function setTicketStatusAction(formData: FormData) {
  const base = String(formData.get('base'));
  const ticket = String(formData.get('ticket'));
  const store = (formData.get('store') as string) || null;
  const f = (formData.get('f') as string) || null;
  const q = (formData.get('q') as string) || null;
  const sb = await supabaseServer();
  const { error } = await sb.from('support_tickets').update({ status: String(formData.get('status')) }).eq('id', ticket);
  revalidatePath(base);
  redirect(back(base, { f, q, t: ticket, store, err: error ? 'Statut non modifié : action non autorisée.' : null }));
}

/** Nouveau fil interne entre un supermarché (directeur, assistants) et la Direction de l'application. */
export async function newInternalThreadAction(formData: FormData) {
  const base = String(formData.get('base'));
  const storeId = String(formData.get('store_id') ?? '');
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/connexion');
  if (!storeId || !subject || !body) redirect(back(base, { new: '1', store: storeId, err: 'Magasin, sujet et message sont obligatoires.' }));
  const { data: tk, error } = await sb.from('support_tickets').insert({
    customer_id: auth.user.id, store_id: storeId, channel: 'store', is_internal: true, subject, status: 'open',
  }).select('id').single();
  if (error || !tk) redirect(back(base, { new: '1', store: storeId, err: error?.message === 'FORBIDDEN' ? 'Ce supermarché n’est pas dans votre zone.' : error?.message ?? 'Création impossible' }));
  await sb.from('messages').insert({ ticket_id: tk.id, sender_id: auth.user.id, body });
  revalidatePath(base);
  redirect(back(base, { t: tk.id, store: storeId }));
}
