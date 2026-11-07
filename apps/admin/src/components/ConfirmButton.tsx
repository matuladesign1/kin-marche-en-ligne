'use client';

import type { ReactNode } from 'react';

/** Bouton d'envoi qui demande une confirmation (actions définitives, comme une suppression). */
export function ConfirmButton({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  return (
    <button type="submit" className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
