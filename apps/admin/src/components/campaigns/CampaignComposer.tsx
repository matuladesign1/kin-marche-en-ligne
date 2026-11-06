'use client';

import { useMemo, useState } from 'react';
import { AUDIENCES, LINKS, type Audiences, type ChannelState } from '@/lib/campaigns';
import { supabaseBrowser } from '@/lib/supabase-browser';

type Option = { id: string; name: string };

/** Photo de la promotion : redimensionnée dans le navigateur (1440 px max, JPEG), puis envoyée au stockage « branding ». */
async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';                     // fond blanc sous les zones transparentes (PNG)
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Conversion impossible');
  return { blob, width: w, height: h };
}

/**
 * Rédaction d'une campagne : titre, message, photo, lien, public et canaux, avec l'aperçu en direct
 * (notification du téléphone avec la photo en grand, carte dans « Messages », WhatsApp, e-mail).
 */
export function CampaignComposer({ action, audiences, channels, products, categories }: {
  action: (f: FormData) => Promise<void>;
  audiences: Audiences; channels: ChannelState; products: Option[]; categories: Option[];
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState('');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [upload, setUpload] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; msg: string }>({ state: 'idle', msg: '' });
  const [linkType, setLinkType] = useState('promotion');
  const [audience, setAudience] = useState('all');
  const [city, setCity] = useState(audiences.cities[0]?.city ?? '');
  const [ch, setCh] = useState({ app: true, whatsapp: false, email: false });

  const seg = audience === 'city'
    ? { customers: audiences.cities.find((c) => c.city === city)?.customers ?? 0, phone: null, email: null }
    : audiences.segments[audience as 'all'] ?? { customers: 0, phone: 0, email: 0 };
  const ratio = size ? size.w / size.h : null;
  const offRatio = ratio !== null && (ratio < 1.8 || ratio > 2.2);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!title.trim()) p.push('le titre');
    if (!body.trim()) p.push('le message');
    if (!ch.app && !ch.whatsapp && !ch.email) p.push('au moins un canal');
    if (ch.whatsapp && !image) p.push('une photo (obligatoire pour WhatsApp)');
    if (upload.state === 'busy') p.push('la fin de l’envoi de la photo');
    return p;
  }, [title, body, ch, image, upload.state]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setImage(''); setSize(null);
    if (!file) { setUpload({ state: 'idle', msg: '' }); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setUpload({ state: 'error', msg: 'Format non accepté : JPG, PNG ou WebP.' }); return; }
    if (file.size > 15 * 1024 * 1024) { setUpload({ state: 'error', msg: 'Photo trop lourde (15 Mo maximum).' }); return; }
    setUpload({ state: 'busy', msg: 'Préparation et envoi de la photo…' });
    try {
      const { blob, width, height } = await prepareImage(file);
      const sb = supabaseBrowser();
      const path = `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await sb.storage.from('branding').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error(error.message);
      setImage(sb.storage.from('branding').getPublicUrl(path).data.publicUrl);
      setSize({ w: width, h: height });
      setUpload({ state: 'done', msg: `Photo prête : ${width} × ${height} px, ${Math.round(blob.size / 1024)} Ko.` });
    } catch (err) {
      setUpload({ state: 'error', msg: `Envoi refusé : ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const reach = [
    ch.app ? `${seg.customers} dans l’application` : null,
    ch.whatsapp ? (seg.phone === null ? 'WhatsApp : clients avec numéro' : `${seg.phone} sur WhatsApp`) : null,
    ch.email ? (seg.email === null ? 'e-mail : clients avec adresse' : `${seg.email} par e-mail`) : null,
  ].filter(Boolean).join(' · ');
  const shownTitle = title.trim() || 'Titre de la promotion';
  const shownBody = body.trim() || 'Votre message apparaît ici : l’offre, la durée, le magasin…';

  return (
    <form action={action} className="card campaign-composer">
      <div className="card-title"><span>Nouvelle campagne</span><span className="muted">Application · WhatsApp · E-mail</span></div>
      <div className="campaign-grid">
        <div className="stack">
          <label>Titre * <span className="muted">({title.length}/80)</span>
            <input name="title" maxLength={80} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. : -20 % sur l’huile végétale ce week-end" />
          </label>
          <label>Message * <span className="muted">({body.length}/500)</span>
            <textarea name="body" maxLength={500} rows={4} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ex. : Profitez de -20 % sur toutes les huiles jusqu’à dimanche, dans tous les supermarchés Kin Marché." />
          </label>
          <label>Photo de la promotion {ch.whatsapp ? '*' : ''}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
            <input type="hidden" name="image_url" value={image} />
            <span className="muted" style={{ fontSize: 12 }}>Idéal : 1440 × 720 px (format 2:1), comme les grandes photos des notifications. JPG, PNG ou WebP, réduite automatiquement.</span>
            {upload.state !== 'idle' ? <span className={`upload-state ${upload.state}`}>{upload.msg}</span> : null}
            {offRatio ? <span className="upload-state error">Format {size!.w} × {size!.h} : sur le téléphone, la notification recadre la photo au format 2:1 (voir l’aperçu). Elle reste entière dans l’application.</span> : null}
          </label>

          <div className="cols">
            <label>Au toucher, ouvrir
              <select name="link_type" value={linkType} onChange={(e) => setLinkType(e.target.value)}>
                <option value="">Rien (message seul)</option>
                {Object.entries(LINKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {linkType === 'product' ? (
              <label>Produit
                <select name="product_id" required defaultValue="">
                  <option value="" disabled>Choisir un produit…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ) : null}
            {linkType === 'category' ? (
              <label>Catégorie
                <select name="category_id" required defaultValue="">
                  <option value="" disabled>Choisir une catégorie…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : null}
            {linkType === 'url' ? (
              <label>Adresse du site (https://…)<input name="url" type="url" required pattern="https://.*" placeholder="https://" /></label>
            ) : null}
          </div>

          <div className="cols">
            <label>Public
              <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
                {Object.entries(AUDIENCES).map(([k, v]) => (
                  <option key={k} value={k} disabled={k === 'city' && !audiences.cities.length}>
                    {v}{k !== 'city' ? ` (${audiences.segments[k as 'all']?.customers ?? 0})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {audience === 'city' ? (
              <label>Ville
                <select name="city" value={city} onChange={(e) => setCity(e.target.value)}>
                  {audiences.cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.customers})</option>)}
                </select>
              </label>
            ) : null}
          </div>

          <fieldset className="campaign-channels">
            <legend>Canaux</legend>
            <label className="check"><input type="checkbox" name="ch_app" checked={ch.app} onChange={(e) => setCh({ ...ch, app: e.target.checked })} />
              Application : Messages + push sur le téléphone <span className="badge ok">actif</span></label>
            <label className="check"><input type="checkbox" name="ch_whatsapp" checked={ch.whatsapp} onChange={(e) => setCh({ ...ch, whatsapp: e.target.checked })} />
              WhatsApp {channels.whatsapp ? <span className="badge ok">configuré</span> : <span className="badge warn">non configuré</span>}</label>
            <label className="check"><input type="checkbox" name="ch_email" checked={ch.email} onChange={(e) => setCh({ ...ch, email: e.target.checked })} />
              E-mail {channels.email ? <span className="badge ok">configuré</span> : <span className="badge warn">non configuré</span>}</label>
          </fieldset>

          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Destinataires : {reach || '—'}. Les clients qui ont coupé les « Promotions » dans l’application ne reçoivent rien.
          </p>
          {problems.length ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>À compléter : {problems.join(', ')}.</p> : null}
          <div className="row">
            <button type="submit" name="intent" value="send" disabled={problems.length > 0}
              onClick={(e) => { if (!window.confirm(`Envoyer cette promotion maintenant ?\n${reach}`)) e.preventDefault(); }}>
              Envoyer maintenant
            </button>
            <button type="submit" name="intent" value="test" className="secondary" disabled={problems.length > 0}>M’envoyer un test</button>
            <button type="submit" name="intent" value="draft" className="secondary" disabled={!title.trim() || !body.trim() || upload.state === 'busy'}>Enregistrer le brouillon</button>
          </div>
        </div>

        <aside className="campaign-preview" aria-label="Aperçu">
          <div className="pv-label">Notification sur le téléphone</div>
          <div className="pv-phone">
            <div className="pv-notif">
              <div className="pv-head">
                <span className="pv-app" aria-hidden="true" />
                <span>Kin Marché · maintenant</span>
              </div>
              <div className="pv-row">
                <div className="pv-text">
                  <b>{shownTitle}</b>
                  <span>{shownBody}</span>
                </div>
              </div>
              {image ? <div className="pv-big"><img src={image} alt="" /></div> : <div className="pv-big empty">Photo en grand (2:1)</div>}
            </div>
          </div>

          <div className="pv-label">Dans l’application (Messages)</div>
          <div className="pv-card">
            <div className="pv-tag">PROMOTION</div>
            {image ? <div className="pv-card-img"><img src={image} alt="" /></div> : null}
            <b>{shownTitle}</b>
            <span>{shownBody}</span>
            {linkType ? <span className="pv-cta">Voir l’offre →</span> : null}
          </div>

          {ch.whatsapp ? (
            <>
              <div className="pv-label">WhatsApp</div>
              <div className="pv-wa">
                <div className="pv-wa-bubble">
                  {image ? <img src={image} alt="" /> : null}
                  <b>{shownTitle}</b>
                  <span>{shownBody.replace(/\s*\n+\s*/g, ' · ')}</span>
                </div>
              </div>
            </>
          ) : null}
          {ch.email ? (
            <>
              <div className="pv-label">E-mail</div>
              <div className="pv-mail">
                <div className="pv-mail-subject">{shownTitle}</div>
                {image ? <img src={image} alt="" /> : null}
                <div className="pv-mail-body">
                  <span className="muted">Bonjour Nathan,</span>
                  <b>{shownTitle}</b>
                  <span>{shownBody}</span>
                  {linkType ? <span className="pv-mail-btn">Voir l’offre</span> : null}
                </div>
              </div>
            </>
          ) : null}
          {!channels.push_devices ? (
            <p className="muted pv-note">Application fermée : la photo s’affiche dans la notification dès que le push (Firebase) est activé. En attendant, la promotion arrive dans « Messages » et en grande carte à l’ouverture de l’application.</p>
          ) : null}
        </aside>
      </div>
    </form>
  );
}
