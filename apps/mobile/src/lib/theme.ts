// Couleurs relevées sur le logo officiel Kin Marché (rouge du texte, bleu/turquoise de l'anneau).
// L'administrateur peut les remplacer via app_settings.branding.colors.
export interface Palette {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  accent: string;
  accent2: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  onPrimary: string;
}

export interface BrandColors {
  primary?: string;
  primary_dark?: string;
  accent?: string;
  accent_2?: string;
}

export function buildPalette(dark: boolean, brand?: BrandColors): Palette {
  const primary = brand?.primary ?? '#DE3530';
  const primaryDark = brand?.primary_dark ?? '#B5241F';
  const accent = brand?.accent ?? '#0097FC';
  const accent2 = brand?.accent_2 ?? '#01789D';
  return dark
    ? {
        primary, primaryDark, accent, accent2,
        primarySoft: '#3A1513',
        background: '#0F1115',
        surface: '#181B21',
        surfaceAlt: '#20242B',
        text: '#F2F3F5',
        textMuted: '#A0A6B0',
        border: '#2C313A',
        success: '#3DD68C',
        warning: '#F5B544',
        danger: '#FF6B66',
        onPrimary: '#FFFFFF',
      }
    : {
        primary, primaryDark, accent, accent2,
        primarySoft: '#FDECEB',
        background: '#F6F7F9',
        surface: '#FFFFFF',
        surfaceAlt: '#F0F2F5',
        text: '#16181D',
        textMuted: '#626A76',
        border: '#E3E6EB',
        success: '#13A35F',
        warning: '#C77D00',
        danger: '#D93025',
        onPrimary: '#FFFFFF',
      };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, xxl: 26 } as const;
