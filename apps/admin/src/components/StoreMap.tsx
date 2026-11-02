'use client';
import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { L?: any } }

// Leaflet 1.9.4 (version figée + empreintes d'intégrité officielles) et fond de carte OpenStreetMap / CARTO.
const LEAFLET_CSS = { href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' };
const LEAFLET_JS = { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' };
let loader: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  if (window.L) return Promise.resolve(window.L);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS.href;
      css.integrity = LEAFLET_CSS.integrity;
      css.crossOrigin = '';
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET_JS.src;
      js.integrity = LEAFLET_JS.integrity;
      js.crossOrigin = '';
      js.async = true;
      js.onload = () => (window.L ? resolve(window.L) : reject(new Error('leaflet')));
      js.onerror = () => { loader = null; reject(new Error('leaflet')); };
      document.head.appendChild(js);
    });
  }
  return loader;
}

export interface MapStore { id: string; name: string; lat: number; lng: number; commune: string | null; open: boolean; verified: boolean }

/** Carte des supermarchés (positions GPS enregistrées et vérifiées par la Direction). */
export function StoreMap({ stores, linkBase }: { stores: MapStore[]; linkBase?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(stores);

  useEffect(() => {
    let map: any = null;
    let cancelled = false;
    const list = JSON.parse(key) as MapStore[];
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current) return;
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([-4.325, 15.322], 11); // Kinshasa
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
        maxZoom: 19, subdomains: 'abcd',
        attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
      }).addTo(map);
      const pts: [number, number][] = [];
      for (const s of list) {
        const icon = L.divIcon({ className: '', html: `<span class="km-pin${s.open ? ' open' : ''}"></span>`, iconSize: [28, 36], iconAnchor: [14, 34], popupAnchor: [0, -30] });
        const marker = L.marker([s.lat, s.lng], { icon, title: s.name, alt: s.name }).addTo(map);
        // Contenu construit sans HTML injecté (noms saisis par les utilisateurs).
        const el = document.createElement('div');
        el.className = 'km-popup';
        const b = document.createElement('b');
        b.textContent = s.name;
        const p = document.createElement('div');
        p.textContent = [s.commune, s.open ? 'Ouvert' : 'Fermé', s.verified ? 'Adresse vérifiée' : 'Adresse à vérifier'].filter(Boolean).join(' · ');
        el.append(b, p);
        if (linkBase) {
          const a = document.createElement('a');
          a.href = `${linkBase}/${s.id}`;
          a.textContent = 'Ouvrir la fiche du magasin';
          el.append(a);
        }
        marker.bindPopup(el);
        pts.push([s.lat, s.lng]);
      }
      if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 14 });
      else if (pts.length === 1) map.setView(pts[0], 14);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; map?.remove(); };
  }, [key, linkBase]);

  if (failed) return <div className="mapbox map-empty">Carte indisponible pour le moment (fond de carte inaccessible).</div>;
  return <div ref={ref} className="mapbox" role="region" aria-label="Carte des supermarchés" />;
}
