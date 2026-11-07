'use client';
import { useState } from 'react';
import { blurhashFromFile } from '@/lib/blurhash';
import { supabaseBrowser } from '@/lib/supabase-browser';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
};
interface Item { key: string; name: string; kind: 'image' | 'video'; state: 'busy' | 'done' | 'error'; url?: string; error?: string; blurhash?: string | null }

/**
 * Photos et vidéos du produit envoyées directement au stockage (aucune limite de taille du serveur web),
 * puis rattachées au produit à l'enregistrement du formulaire.
 */
export function ProductMediaUpload() {
  const [items, setItems] = useState<Item[]>([]);
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const sb = supabaseBrowser();
    for (const file of files) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = EXT[file.type];
      const kind = file.type.startsWith('video/') ? 'video' : 'image';
      if (!ext) { setItems((l) => [...l, { key, name: file.name, kind, state: 'error', error: 'Format non accepté' }]); continue; }
      if (file.size > 50 * 1024 * 1024) { setItems((l) => [...l, { key, name: file.name, kind, state: 'error', error: 'Plus de 50 Mo' }]); continue; }
      setItems((l) => [...l, { key, name: file.name, kind, state: 'busy' }]);
      const path = `catalogue/${key}.${ext}`;
      // Empreinte visuelle de la photo (recherche par photo similaire dans l'application), calculée ici.
      const [{ error }, blurhash] = await Promise.all([
        sb.storage.from('product-media').upload(path, file, { contentType: file.type, upsert: false }),
        kind === 'image' ? blurhashFromFile(file) : Promise.resolve(null),
      ]);
      if (error) patch(key, { state: 'error', error: error.message });
      else patch(key, { state: 'done', url: sb.storage.from('product-media').getPublicUrl(path).data.publicUrl, blurhash });
    }
  }

  const busy = items.some((i) => i.state === 'busy');
  return (
    <div className="stack">
      <label>Ajouter des photos ou des vidéos
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={onChange} />
        <span className="muted" style={{ fontSize: 12 }}>JPG, PNG, WebP, MP4 ou MOV · 50 Mo maximum par fichier · photo carrée sur fond clair conseillée.</span>
      </label>
      {items.length ? (
        <div className="media-strip">
          {items.map((it) => (
            <div key={it.key} className={`media-tile ${it.state}`} title={it.name}>
              {it.url ? (it.kind === 'video'
                ? <video src={it.url} muted playsInline />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={it.url} alt={it.name} />) : <span>{it.state === 'busy' ? 'Envoi…' : it.error}</span>}
              {it.url ? <input type="hidden" name="media_url" value={it.url} /> : null}
              {it.url && it.blurhash ? <input type="hidden" name="media_blurhash" value={`${it.url} ${it.blurhash}`} /> : null}
              <button type="button" className="secondary" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>Retirer</button>
            </div>
          ))}
        </div>
      ) : null}
      {busy ? <span className="upload-state busy">Envoi en cours… attendez la fin avant d’enregistrer.</span> : null}
    </div>
  );
}
