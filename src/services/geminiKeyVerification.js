import { getModelCandidates } from '../ai/geminiModelSelection.js';

const getProviderError = async response => {
    const text = await response.text().catch(() => '');
    let body = text;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        // Preserve non-JSON provider responses verbatim.
    }
    return {
        httpStatus: response.status,
        httpStatusText: response.statusText,
        body,
        rawBody: text
    };
};

export const verifyGeminiApiKey = async (apiKey, {
    fetchImpl = fetch,
    timeoutMs = 15000
} = {}) => {
    const key = String(apiKey || '').trim();
    if (!key) return { valid: false, reason: 'missing' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
        const candidates = await getModelCandidates({
            apiKey: key,
            listModels: async () => {
                const requestUrl = new URL('https://generativelanguage.googleapis.com/v1beta/models');
                requestUrl.searchParams.set('pageSize', '1000');
                requestUrl.searchParams.set('key', key);
                const diagnosticUrl = new URL(requestUrl);
                diagnosticUrl.searchParams.set('key', '[REDACTED]');
                console.info(`[Gemini verification] GET ${diagnosticUrl.toString()}`);
                const response = await fetchImpl(
                    requestUrl.toString(),
                    { signal: controller.signal }
                );
                if (!response.ok) {
                    const providerError = await getProviderError(response);
                    throw Object.assign(new Error(
                        providerError.body?.error?.message || `Google Gemini returned HTTP ${response.status}.`
                    ), { status: response.status, providerError });
                }
                const payload = await response.json();
                return Array.isArray(payload?.models) ? payload.models : [];
            }
        });
        return candidates.length
            ? { valid: true, model: candidates[0] }
            : { valid: false, retryable: false, reason: 'unsupported' };
    } catch (error) {
        if (error?.providerError) {
            return {
                valid: false,
                retryable: error.status === 429 || error.status >= 500,
                status: error.status,
                error: error.message,
                providerError: error.providerError
            };
        }
        return { valid: false, retryable: true, reason: error?.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timeout);
    }
};
