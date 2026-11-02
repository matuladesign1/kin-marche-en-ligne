'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Confort de la messagerie (comme une messagerie instantanée) :
 * défilement en bas de la discussion, Entrée pour envoyer (Maj+Entrée = nouvelle ligne),
 * zone de saisie qui s'agrandit, pièce jointe signalée, et mise à jour automatique
 * dès qu'un message arrive ou est lu (petite vérification toutes les 8 secondes).
 */
export function ChatEnhancer({ count, poll, everyMs = 8000 }: { count: number; poll: string; everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const body = document.getElementById('chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, [count]);

  useEffect(() => {
    const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    const form = input?.form ?? null;
    const file = form?.querySelector<HTMLInputElement>('input[type=file]') ?? null;
    const label = file?.closest('label') ?? null;

    const grow = () => {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      if (input?.value.trim() || file?.files?.length) form?.requestSubmit();
    };
    const onFile = () => {
      const name = file?.files?.[0]?.name;
      label?.classList.toggle('has-file', !!name);
      if (label) label.title = name ? `Pièce jointe : ${name}` : 'Joindre une image ou un PDF';
    };
    const onSubmit = () => { label?.classList.remove('has-file'); };

    input?.addEventListener('keydown', onKey);
    input?.addEventListener('input', grow);
    file?.addEventListener('change', onFile);
    form?.addEventListener('submit', onSubmit);

    let baseline: string | null = null;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch(poll, { cache: 'no-store' });
        if (!res.ok) return;
        const { v } = (await res.json()) as { v: string | null };
        if (v == null) return;
        if (baseline === null) { baseline = v; return; }
        if (v === baseline) return;
        if (input?.value.trim() || file?.files?.length) return; // ne jamais gêner une saisie en cours
        baseline = v;
        router.refresh();
      } catch {
        // réseau indisponible : nouvel essai au prochain tour
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(check, everyMs);

    return () => {
      input?.removeEventListener('keydown', onKey);
      input?.removeEventListener('input', grow);
      file?.removeEventListener('change', onFile);
      form?.removeEventListener('submit', onSubmit);
      window.clearInterval(timer);
    };
  }, [router, poll, everyMs, count]);

  return null;
}
