import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  deleteGeminiApiKey,
  getGeminiApiKeyAvailability,
  saveGeminiApiKey,
} from './api';

interface GeminiKeyContextValue {
  hasApiKey: boolean;
  loading: boolean;
  saveApiKey(value: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

const GeminiKeyContext = createContext<GeminiKeyContextValue | null>(null);

export function GeminiKeyProvider({ children }: { children: ReactNode }) {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getGeminiApiKeyAvailability()
      .then(result => {
        if (active) setHasApiKey(result.hasApiKey);
      })
      .catch(() => {
        if (active) setHasApiKey(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);
  const value = useMemo(() => ({
    hasApiKey,
    loading,
    saveApiKey: async (next: string) => {
      const result = await saveGeminiApiKey(next.trim());
      setHasApiKey(result.hasApiKey);
    },
    clearApiKey: async () => {
      const result = await deleteGeminiApiKey();
      setHasApiKey(result.hasApiKey);
    },
  }), [hasApiKey, loading]);
  return <GeminiKeyContext.Provider value={value}>{children}</GeminiKeyContext.Provider>;
}

export function useGeminiKey() {
  const context = useContext(GeminiKeyContext);
  if (!context) throw new Error('useGeminiKey must be used within GeminiKeyProvider.');
  return context;
}
