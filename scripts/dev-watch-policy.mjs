import path from 'node:path';

const BACKEND_SOURCE_ROOTS = Object.freeze([
  'src/ai',
  'src/auth',
  'src/config',
  'src/domain',
  'src/firebase',
  'src/middleware',
  'src/routes',
  'src/services',
  'src/workers'
]);

export const watchedBackendPaths = (projectRoot = process.cwd()) => [
  path.join(projectRoot, 'server.js'),
  ...BACKEND_SOURCE_ROOTS.map(relative => path.join(projectRoot, relative))
];

export const shouldRestartForPath = (changedPath, projectRoot = process.cwd()) => {
  const absolute = path.resolve(projectRoot, changedPath);
  return watchedBackendPaths(projectRoot).some(watched =>
    absolute === watched || absolute.startsWith(`${watched}${path.sep}`));
};
