import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Flash } from '@/components/Shell';
import { dateTime } from '@/lib/format';
import { supabaseServer } from '@/lib/supabase-server';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_review: { label: 'À vérifier', cls: 'warn' },
  verified: { label: 'Certifié', cls: 'ok' },
  suspended: { label: 'Suspendu', cls: 'bad' },
  rejected: { label: 'Refusé', cls: 'bad' },
};
const DOC: Record<string, string> = { id_photo: 'Pièce d’identité', vehicle_registration: 'Document du véhicule', license: 'Permis', other: 'Autre' };
const TRANSPORT: Record<string, string> = { foot: 'À pied', bicycle: 'Vélo', motorbike: 'Moto', car: 'Voiture', van: 'Camionnette', truck: 'Camion' };

async function review(formData: FormData) {
  'use server';
  const sb = await supabaseServer();
  const { error } = await sb.rpc('review_driver', {
    p_driver_id: String(formData.get('id')), p_status: String(formData.get('status')), p_note: String(formData.get('note') ?? '') || null,
  });
  revalidatePath('/admin/livreurs');
  redirect(`/admin/livreurs?f=${formData.get('f') ?? 'pending_review'}&${error ? 'err=' + encodeURIComponent(error.message) : 'ok=Décision enregistrée et notifiée au livreur'}`);
}

export default async function Livreurs({ searchParams }: { searchParams: Promise<{ f?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const f = STATUS[sp.f ?? ''] ? sp.f! : 'pending_review';
  const sb = await supabaseServer();
  const { data: drivers } = await sb.from('drivers')
    .select('id, driver_code, status, address, zone_communes, emergency_contact_name, emergency_contact_phone, payout_method, payout_account_masked, is_available, verified_at, rating, rating_count, created_at, profiles(full_name, email, phone, avatar_url), driver_vehicles(mode, plate_number, max_weight_kg), driver_documents(id, doc_type, storage_path, status, created_at)')
    .eq('status', f).order('created_at', { ascending: true });

  // Documents d'identité : bucket privé, liens signés valables 10 minutes, visibles par l'admin uniquement.
  const paths = (drivers ?? []).flatMap((d: any) => (d.driver_documents ?? []).map((x: any) => x.storage_path));
  const signed: Record<string, string> = {};
  if (paths.length) {
    const { data } = await sb.storage.from('driver-documents').createSignedUrls(paths, 600);
    (data ?? []).forEach((s) => { if (s.path && s.signedUrl) signed[s.path] = s.signedUrl; });
  }

  return (
    <>
      <h1>Livreurs</h1>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(STATUS).map(([k, v]) => <a key={k} className={`btn ${k === f ? '' : 'secondary'}`} href={`/admin/livreurs?f=${k}`}>{v.label}</a>)}
      </div>
      {!drivers?.length ? <p className="muted">Aucun livreur dans cette catégorie.</p> : null}
      {(drivers ?? []).map((d: any) => (
        <div key={d.id} className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="row" style={{ alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.profiles?.avatar_url ? <img src={d.profiles.avatar_url} alt="" style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover' }} /> : null}
              <div>
                <b>{d.profiles?.full_name}</b> <span className={`badge ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                <div className="muted">{d.driver_code} · {d.profiles?.email} · {d.profiles?.phone}</div>
              </div>
            </div>
            <span className="muted">Candidature du {dateTime(d.created_at)}</span>
          </div>
          <div className="cols" style={{ marginTop: 12 }}>
            <div><div className="muted">Adresse</div>{d.address}</div>
            <div><div className="muted">Zones</div>{(d.zone_communes ?? []).join(', ')}</div>
            <div><div className="muted">Transport</div>{(d.driver_vehicles ?? []).map((v: any) => `${TRANSPORT[v.mode]}${v.plate_number ? ' · ' + v.plate_number : ''}${v.max_weight_kg ? ' · ' + v.max_weight_kg + ' kg' : ''}`).join(' ; ')}</div>
            <div><div className="muted">Contact d&apos;urgence</div>{d.emergency_contact_name} · {d.emergency_contact_phone}</div>
            <div><div className="muted">Paiement des gains</div>{d.payout_method} · {d.payout_account_masked}</div>
            {d.status === 'verified' ? <div><div className="muted">Activité</div>{d.is_available ? 'Disponible' : 'Indisponible'} · note {Number(d.rating).toFixed(1)} ({d.rating_count})</div> : null}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {(d.driver_documents ?? []).map((x: any) => (
              <a key={x.id} href={signed[x.storage_path]} target="_blank" rel="noreferrer" className="btn secondary">{DOC[x.doc_type] ?? x.doc_type} ({x.status})</a>
            ))}
            {!d.driver_documents?.length ? <span className="badge bad">Aucun document</span> : null}
          </div>
          <form action={review} className="row" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={d.id} /><input type="hidden" name="f" value={f} />
            <label>Note au livreur (facultatif)<input name="note" /></label>
            {d.status !== 'verified' ? <button name="status" value="verified">Certifier</button> : null}
            {d.status === 'verified' ? <button name="status" value="suspended" className="danger">Suspendre</button> : null}
            {d.status === 'pending_review' ? <button name="status" value="rejected" className="secondary">Refuser</button> : null}
          </form>
        </div>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>Un livreur ne peut se rendre disponible et recevoir des missions qu&apos;une fois certifié. Toute décision est inscrite au journal d&apos;audit.</p>
    </>
  );
}
