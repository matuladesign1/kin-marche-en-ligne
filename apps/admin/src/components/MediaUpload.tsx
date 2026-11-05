'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

/**
 * Envoi direct du navigateur vers le stockage Supabase (session de l'utilisateur, règles de sécurité appliquées),
 * puis l'adresse publique est transmise au formulaire via un champ caché.
 * Évite la limite de taille des requêtes serveur pour les vidéos et les grandes photos.
 */
export function MediaUpload({ name, label, accept, prefix, maxMb, kind, hint }: {
  name: string; label: string; accept: string; prefix: 'banner' | 'partner'; maxMb: number; kind: 'image' | 'video'; hint?: string;
}) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setUrl('');
    if (!file) { setState('idle'); return; }
    const ext = EXT[file.type];
    if (!ext || !accept.split(',').map((a) => a.trim()).includes(file.type)) {
      setState('error'); setMessage('Format non accepté.'); return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      setState('error'); setMessage(`Fichier trop lourd : ${maxMb} Mo maximum.`); return;
    }
    setState('busy'); setMessage('Envoi en cours…');
    const sb = supabaseBrowser();
    const path = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('branding').upload(path, file, { contentType: file.type, upsert: false });
    if (error) { setState('error'); setMessage(`Envoi refusé : ${error.message}`); return; }
    setUrl(sb.storage.from('branding').getPublicUrl(path).data.publicUrl);
    setState('done'); setMessage('Fichier prêt.');
  }

  return (
    <label>
      {label}
      <input type="file" accept={accept} onChange={onChange} />
      <input type="hidden" name={name} value={url} />
      {hint ? <span className="muted" style={{ fontSize: 12 }}>{hint}</span> : null}
      {state !== 'idle' ? <span className={`upload-state ${state}`}>{message}</span> : null}
      {url ? (
        <span className="upload-preview">
          {kind === 'video'
            ? <video src={url} muted loop autoPlay playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={url} alt="Aperçu" />}
        </span>
      ) : null}
    </label>
  );
}
