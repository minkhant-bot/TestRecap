import crypto from 'node:crypto';

const modelCache = new Map();
const normalizeName = name => String(name || '').replace(/^models\//, '');
const supportsGenerateContent = model =>
    (model?.supportedActions || model?.supportedGenerationMethods || [])
        .some(action => String(action).toLowerCase() === 'generatecontent');

const isStableFlash = name => {
    const normalized = normalizeName(name).toLowerCase();
    return normalized.startsWith('gemini-') &&
        normalized.includes('flash') &&
        !/(preview|experimental|(?:^|-)exp(?:-|$)|image|audio|live)/.test(normalized);
};

const scoreModel = name => {
    const normalized = normalizeName(name).toLowerCase();
    const version = normalized.match(/gemini-(\d+)(?:\.(\d+))?/);
    const versionScore = version ? Number(version[1]) * 100 + Number(version[2] || 0) : 0;
    return (normalized.includes('lite') ? 0 : 100000) +
        (normalized.includes('latest') ? 50000 : 0) +
        versionScore;
};

export const rankCompatibleFlashModels = models => models
    .filter(model => supportsGenerateContent(model) && isStableFlash(model.name))
    .map(model => normalizeName(model.name))
    .filter((name, index, names) => name && names.indexOf(name) === index)
    .sort((left, right) => scoreModel(right) - scoreModel(left) || left.localeCompare(right));

export const listCompatibleFlashModels = async listModels => {
    const pager = await listModels({ config: { pageSize: 100 } });
    const models = [];
    if (pager && Symbol.asyncIterator in Object(pager)) {
        for await (const model of pager) models.push(model);
    } else if (Array.isArray(pager)) {
        models.push(...pager);
    } else if (Array.isArray(pager?.page)) {
        models.push(...pager.page);
    }
    return rankCompatibleFlashModels(models);
};

const keyFingerprint = apiKey =>
    crypto.createHash('sha256').update(String(apiKey)).digest('hex');

export const getModelCandidates = async ({ apiKey, listModels }) => {
    const key = keyFingerprint(apiKey);
    const cached = modelCache.get(key);
    if (cached) {
        return cached.selected
            ? [cached.selected, ...cached.candidates.filter(model => model !== cached.selected)]
            : [...cached.candidates];
    }
    const candidates = await listCompatibleFlashModels(listModels);
    modelCache.set(key, { candidates, selected: null });
    return candidates;
};

export const rememberSuccessfulGeminiModel = (apiKey, model) => {
    const key = keyFingerprint(apiKey);
    const cached = modelCache.get(key) || { candidates: [model], selected: null };
    modelCache.set(key, {
        candidates: cached.candidates.includes(model)
            ? cached.candidates
            : [model, ...cached.candidates],
        selected: model
    });
};

export const clearGeminiModelCacheForTests = () => modelCache.clear();
