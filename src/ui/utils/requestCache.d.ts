export function dedupeRequest<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T>;
export function clearDedupeCache(): void;
