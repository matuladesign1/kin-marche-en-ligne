import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kin Marché — Administration',
  description: 'Espaces d’administration Kin Marché en ligne',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
