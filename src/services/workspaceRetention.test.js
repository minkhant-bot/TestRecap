import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const jobManagerUrl = new URL('./jobManager.js', import.meta.url).href;
const workspaceJobsUrl = new URL('./workspaceJobs.js', import.meta.url).href;
const cleanupUrl = new URL('./cleanup.js', import.meta.url).href;

const TERMINAL_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVE_ID = '22222222-2222-4222-8222-222222222222';
const LEGACY_ID = '33333333-3333-4333-8333-333333333333';
const MISMATCH_ID = '44444444-4444-4444-8444-444444444444';
const ORPHAN_ID = '55555555-5555-4555-8555-555555555555';

test('retention sweep coordinates linked terminal deletion and preserves active or mismatched workspace state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-retention-'));
    try {
        const output = execFileSync(process.execPath, [
            '--input-type=module',
            '--eval',
            `
                import fs from 'node:fs';
                import path from 'node:path';
                const core = await import(process.env.JOB_MANAGER_MODULE_URL);
                const workspace = await import(process.env.WORKSPACE_JOBS_MODULE_URL);
                const cleanup = await import(process.env.CLEANUP_MODULE_URL);

                const root = process.env.DATA_DIR;
                const ownerUid = 'retention-owner';
                const ids = ${JSON.stringify([TERMINAL_ID, ACTIVE_ID, LEGACY_ID, MISMATCH_ID])};
                const createArtifacts = id => {
                    const output = path.join(root, 'output');
                    const cache = path.join(root, 'cache', id);
                    fs.mkdirSync(output, { recursive: true });
                    fs.mkdirSync(cache, { recursive: true });
                    fs.writeFileSync(path.join(output, id + '.mp4'), 'video');
                    fs.writeFileSync(path.join(output, id + '.mp3'), 'audio');
                    fs.writeFileSync(path.join(cache, 'state.json'), 'cache');
                };
                const createWorkspace = (id, status) => {
                    const directory = path.join(root, 'uploads', 'workspace', id);
                    const storedPath = path.join(directory, 'source.mp4');
                    fs.mkdirSync(directory, { recursive: true });
                    fs.writeFileSync(storedPath, 'source');
                    workspace.createWorkspaceJob({
                        id,
                        ownerUid,
                        filename: id + '.mp4',
                        fileSize: 6,
                        duration: 1,
                        storedPath
                    });
                    if (status !== 'pending') {
                        workspace.updateWorkspaceJobInternal(id, {
                            status,
                            stage: status === 'completed' ? 'completed' : status
                        });
                    }
                    return storedPath;
                };

                const terminalSource = createWorkspace('${TERMINAL_ID}', 'completed');
                const activeSource = createWorkspace('${ACTIVE_ID}', 'pending');
                const mismatchSource = createWorkspace('${MISMATCH_ID}', 'completed');
                const orphanSource = createWorkspace('${ORPHAN_ID}', 'completed');
                workspace.updateWorkspaceJobInternal('${ORPHAN_ID}', {
                    completedAt: new Date(1).toISOString()
                });
                for (const id of ids) createArtifacts(id);
                createArtifacts('${ORPHAN_ID}');
                for (const id of ids) {
                    core.createJob(id, {
                        ownerUid: id === '${MISMATCH_ID}' ? 'different-owner' : ownerUid,
                        videoPath: id === '${TERMINAL_ID}' ? terminalSource :
                            id === '${ACTIVE_ID}' ? activeSource :
                            id === '${MISMATCH_ID}' ? mismatchSource : null,
                        audioPath: null,
                        originalFilename: id + '.mp4'
                    });
                    core.updateJob(id, {
                        status: 'complete',
                        stageId: 'done',
                        completed_at: 1
                    });
                }
                core.setJobKeys('${TERMINAL_ID}', { geminiApiKey: 'terminal-secret' });

                const candidates = cleanup.sweepExpiredCompletedJobs({
                    now: 10000,
                    maxAgeMs: 100
                });
                console.log(JSON.stringify({
                    candidates,
                    terminal: {
                        workspace: workspace.getWorkspaceJobInternal('${TERMINAL_ID}'),
                        core: core.getJob('${TERMINAL_ID}'),
                        credentials: core.getJobKeys('${TERMINAL_ID}'),
                        sourceExists: fs.existsSync(terminalSource),
                        outputExists: fs.existsSync(path.join(root, 'output', '${TERMINAL_ID}.mp4')),
                        cacheExists: fs.existsSync(path.join(root, 'cache', '${TERMINAL_ID}'))
                    },
                    active: {
                        workspaceStatus: workspace.getWorkspaceJobInternal('${ACTIVE_ID}')?.status,
                        coreStatus: core.getJob('${ACTIVE_ID}')?.status,
                        sourceExists: fs.existsSync(activeSource),
                        outputExists: fs.existsSync(path.join(root, 'output', '${ACTIVE_ID}.mp4'))
                    },
                    legacy: {
                        core: core.getJob('${LEGACY_ID}'),
                        outputExists: fs.existsSync(path.join(root, 'output', '${LEGACY_ID}.mp4'))
                    },
                    mismatch: {
                        workspaceStatus: workspace.getWorkspaceJobInternal('${MISMATCH_ID}')?.status,
                        coreOwner: core.getJob('${MISMATCH_ID}')?.ownerUid,
                        outputExists: fs.existsSync(path.join(root, 'output', '${MISMATCH_ID}.mp4'))
                    },
                    orphan: {
                        workspace: workspace.getWorkspaceJobInternal('${ORPHAN_ID}'),
                        sourceExists: fs.existsSync(orphanSource),
                        outputExists: fs.existsSync(path.join(root, 'output', '${ORPHAN_ID}.mp4')),
                        cacheExists: fs.existsSync(path.join(root, 'cache', '${ORPHAN_ID}'))
                    }
                }));
            `
        ], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                DATA_DIR: root,
                JOB_STORE_PATH: path.join(root, 'saas-state.json'),
                WORKSPACE_JOB_STORE_PATH: path.join(root, 'workspace-jobs.json'),
                JOB_MANAGER_MODULE_URL: jobManagerUrl,
                WORKSPACE_JOBS_MODULE_URL: workspaceJobsUrl,
                CLEANUP_MODULE_URL: cleanupUrl
            },
            encoding: 'utf8'
        });
        const result = JSON.parse(output.trim().split('\n').at(-1));

        assert.equal(result.candidates, 5);
        assert.deepEqual(result.terminal, {
            workspace: null,
            core: null,
            credentials: {},
            sourceExists: false,
            outputExists: false,
            cacheExists: false
        });
        assert.deepEqual(result.active, {
            workspaceStatus: 'pending',
            coreStatus: 'complete',
            sourceExists: true,
            outputExists: true
        });
        assert.deepEqual(result.legacy, {
            core: null,
            outputExists: false
        });
        assert.deepEqual(result.mismatch, {
            workspaceStatus: 'completed',
            coreOwner: 'different-owner',
            outputExists: true
        });
        assert.deepEqual(result.orphan, {
            workspace: null,
            sourceExists: false,
            outputExists: false,
            cacheExists: false
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
