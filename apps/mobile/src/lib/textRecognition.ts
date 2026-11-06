import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// Module natif « KinVision » (modules/kin-vision) : lit le texte d'une photo sur le téléphone
// (Google ML Kit, modèle intégré à l'application) — gratuit, sans compte Google Cloud ni carte, sans Internet.
type KinVisionNative = {
  recognizeText(uri: string): Promise<{ text: string; words: { text: string; height: number }[]; width: number; height: number }>;
};

const native = Platform.OS === 'android' ? requireOptionalNativeModule<KinVisionNative>('KinVision') : null;

export interface ReadWord { text: string; /** Taille du mot par rapport à la photo (0 à 1) : la marque est écrite en grand. */ size: number }

/** Mots lus sur la photo (vide si le module manque ou si rien n'est lisible). */
export async function readPhotoText(uri: string): Promise<ReadWord[]> {
  if (!native) return [];
  try {
    const r = await native.recognizeText(uri);
    const ref = Math.max(1, Math.min(r.width, r.height));
    return r.words.map((w) => ({ text: w.text, size: w.height / ref }));
  } catch {
    return [];
  }
}
