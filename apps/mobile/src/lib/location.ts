import * as Location from 'expo-location';

/**
 * Position actuelle du téléphone, sans attente sans fin : si le GPS tarde (intérieur, téléphone lent),
 * on prend la dernière position connue encore récente. null si aucune position n'est disponible.
 */
export async function currentPosition(
  accuracy: Location.Accuracy,
  { timeoutMs = 15_000, maxAgeMs = 10 * 60_000 }: { timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const pos = await Promise.race([Location.getCurrentPositionAsync({ accuracy }).catch(() => null), timeout]);
    if (pos) return pos;
    return await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }).catch(() => null);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
