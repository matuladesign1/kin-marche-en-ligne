import type { TFunction } from './i18n';

export type Channel = 'general' | 'store' | 'driver';

export interface Ticket {
  id: string;
  subject: string;
  status: string;
  channel: Channel;
  province: string | null;
  city: string | null;
  updated_at: string;
  created_at: string;
  store_id: string | null;
  order_id: string | null;
  stores: { name: string } | null;
  orders: { id: string; order_number: string; status: string; payment_status: string } | null;
}

export interface ChatMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  body: string;
  sender_label: string | null;
  sender_verified: boolean;
  attachment_path: string | null;
  read_at: string | null;
  created_at: string;
  url?: string | null;
}

/** Nom affiché d'une conversation : toujours « ASSISTANT … » (ville / province ou supermarché). */
export function conversationTitle(c: { channel: Channel; city?: string | null; province?: string | null; storeName?: string | null }): string {
  if (c.channel === 'store') return `ASSISTANT ${c.storeName ?? 'Kin Marché'}`;
  if (c.channel === 'driver') return 'LIVREUR Kin Marché';
  return `ASSISTANT ${c.city || c.province || 'Kin Marché'}`;
}

export function conversationSubtitle(channel: Channel, t: TFunction): string {
  if (channel === 'store') return t('inbox.storeAssistant');
  if (channel === 'driver') return t('inbox.driverChannel');
  return t('inbox.certifiedAssistant');
}

export function shortTime(iso: string, language: string, t: TFunction): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString();
  const locale = language === 'en' ? 'en-GB' : 'fr-FR';
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (yesterday) return t('inbox.yesterday');
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

export function dayLabel(iso: string, language: string, t: TFunction): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t('inbox.today');
  if (new Date(now.getTime() - 86_400_000).toDateString() === d.toDateString()) return t('inbox.yesterday');
  return d.toLocaleDateString(language === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
