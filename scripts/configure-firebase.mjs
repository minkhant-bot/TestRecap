import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const projectRoot = path.resolve(import.meta.dirname, '..');
const serviceAccountPath = path.join(projectRoot, 'firebase-admin.json');
const environmentPath = path.join(projectRoot, '.env.local');
const existingEnvironment = fs.existsSync(environmentPath)
    ? fs.readFileSync(environmentPath, 'utf8')
    : '';
const existingUploadLimit = existingEnvironment
    .split(/\r?\n/)
    .find(line => line.startsWith('MAX_UPLOAD_SIZE_MB='))
    ?.slice('MAX_UPLOAD_SIZE_MB='.length);

if (!fs.existsSync(serviceAccountPath)) {
    throw new Error('firebase-admin.json was not found in the project root.');
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('firebase-admin.json is missing required service-account fields.');
}

const auth = new GoogleAuth({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
});
const client = await auth.getClient();
const projectId = encodeURIComponent(serviceAccount.project_id);
const listResponse = await client.request({
    url: `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`
});
const apps = Array.isArray(listResponse.data?.apps) ? listResponse.data.apps : [];
if (apps.length !== 1) {
    throw new Error(`Expected exactly one Firebase Web App, found ${apps.length}.`);
}

const app = apps[0];
const configResponse = await client.request({
    url: `https://firebase.googleapis.com/v1beta1/${app.name}/config`
});
const config = configResponse.data || {};
if (!config.apiKey || !config.authDomain || !config.projectId || !app.appId) {
    throw new Error('Firebase returned an incomplete Web App configuration.');
}

const environment = [
    '# Generated locally by scripts/configure-firebase.mjs. Never commit this file.',
    `FIREBASE_PROJECT_ID=${config.projectId}`,
    `FIREBASE_WEB_API_KEY=${config.apiKey}`,
    `FIREBASE_AUTH_DOMAIN=${config.authDomain}`,
    `FIREBASE_APP_ID=${app.appId}`,
    'FIREBASE_SERVICE_ACCOUNT_FILE=./firebase-admin.json',
    `VITE_FIREBASE_PROJECT_ID=${config.projectId}`,
    `VITE_FIREBASE_API_KEY=${config.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${config.authDomain}`,
    `VITE_FIREBASE_APP_ID=${app.appId}`,
    ...(existingUploadLimit ? [`MAX_UPLOAD_SIZE_MB=${existingUploadLimit}`] : []),
    ''
].join('\n');

fs.writeFileSync(environmentPath, environment, { mode: 0o600 });
fs.chmodSync(environmentPath, 0o600);
console.log('Firebase local environment configuration created successfully.');
