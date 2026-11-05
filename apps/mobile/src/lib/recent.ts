import AsyncStorage from '@react-native-async-storage/async-storage';

// Produits vus récemment (« Historique »), gardés sur le téléphone uniquement.
const KEY = 'km.recent.v1';
const MAX = 40;

export async function readRecent(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Ajoute un article (inventory_id) en tête de l'historique. */
export async function pushRecent(inventoryId: string): Promise<void> {
  try {
    const list = (await readRecent()).filter((id) => id !== inventoryId);
    list.unshift(inventoryId);
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // L'historique est un confort : une erreur ne doit rien bloquer.
  }
}

export async function clearRecent(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
