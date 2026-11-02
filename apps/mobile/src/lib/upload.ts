import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export interface PickedImage { uri: string; mimeType: string; ext: string }

/** Ouvre l'appareil photo (caméra frontale possible) ou la galerie. Retourne null si annulé ou refusé. */
export async function pickImage(source: 'camera' | 'gallery', opts: { front?: boolean; square?: boolean } = {}): Promise<PickedImage | null | 'denied'> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: !!opts.square,
    aspect: opts.square ? [1, 1] : undefined,
    cameraType: opts.front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const mimeType = a.mimeType ?? 'image/jpeg';
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  return { uri: a.uri, mimeType, ext };
}

/** Envoie un fichier local dans un bucket Supabase Storage (les règles d'accès sont appliquées côté serveur). */
export async function uploadFile(bucket: string, path: string, file: PickedImage): Promise<string> {
  const body = await (await fetch(file.uri)).arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType: file.mimeType, upsert: false });
  if (error) throw error;
  return path;
}

export function randomName(ext: string): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
}
