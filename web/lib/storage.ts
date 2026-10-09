// Same API as React Native AsyncStorage, backed by localStorage, so the app's services work unchanged.
const ls = () => (typeof window !== 'undefined' ? window.localStorage : null);

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    try { return ls()?.getItem(key) ?? null; } catch { return null; }
  },
  async setItem(key: string, value: string): Promise<void> {
    try { ls()?.setItem(key, value); } catch { /* storage full or blocked */ }
  },
  async removeItem(key: string): Promise<void> {
    try { ls()?.removeItem(key); } catch { /* ignore */ }
  },
};

export default AsyncStorage;
