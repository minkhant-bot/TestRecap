import fs from 'node:fs';
import path from 'node:path';

export const getStoragePaths = (env = process.env, projectRoot = process.cwd()) => {
    const configuredRoot = env.DATA_DIR?.trim();
    if (configuredRoot) {
        const root = path.resolve(configuredRoot);
        return {
            root,
            uploads: path.join(root, 'uploads'),
            paymentProofs: path.join(root, 'payment-proofs'),
            cache: path.join(root, 'cache'),
            output: path.join(root, 'output'),
            settings: root
        };
    }
    const root = path.resolve(projectRoot);
    return {
        root,
        uploads: path.join(root, 'src', 'tmp'),
        paymentProofs: path.join(root, 'data', 'payment-proofs'),
        cache: path.join(root, 'data', 'cache'),
        output: path.join(root, 'public', 'output'),
        settings: path.join(root, 'data')
    };
};

export const ensureStoragePaths = paths => {
    for (const directory of [paths.uploads, paths.paymentProofs, paths.cache, paths.output, paths.settings]) {
        fs.mkdirSync(directory, { recursive: true });
    }
    return paths;
};

export const getServerBinding = (env = process.env) => {
    const parsedPort = Number.parseInt(env.PORT || '', 10);
    return {
        port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000,
        host: env.NODE_ENV === 'production' ? '0.0.0.0' : (env.HOST || '0.0.0.0')
    };
};
