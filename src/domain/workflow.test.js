import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    JOB_STATUSES,
    WORKFLOW_STAGE_IDS,
    WORKFLOW_STAGE_LABELS,
    WORKFLOW_VERSION,
    getFinalSpeedStageOutcome,
    hasCompletedStage,
    isJobStatus,
    readCompatibleWorkflowState
} from './workflow.js';

const EXPECTED_STAGES = [
    'upload', 'extract_audio', 'detect_scenes', 'transcribe_source',
    'translate_burmese', 'generate_tts', 'match_scenes', 'build_timeline',
    'rebuild_scenes', 'export_final', 'adjust_final_speed', 'cleanup', 'done'
];

const EXPECTED_LABELS = [
    'Uploading video', 'Extracting audio', 'Detecting scenes',
    'Transcribing with Faster-Whisper', 'Translating to Burmese',
    'Generating Burmese speech', 'Matching speech to scenes chronologically',
    'Building timeline', 'Rebuilding video scenes', 'Exporting final video',
    'Adjusting final playback speed', 'Cleaning up', 'Complete'
];

test('workflow v2 has stable stage ordering and exact frontend labels', () => {
    assert.equal(WORKFLOW_VERSION, 2);
    assert.deepEqual(WORKFLOW_STAGE_IDS, EXPECTED_STAGES);
    assert.deepEqual(EXPECTED_STAGES.map(id => WORKFLOW_STAGE_LABELS[id]), EXPECTED_LABELS);
    assert.deepEqual(JOB_STATUSES, ['queued', 'processing', 'complete', 'error', 'cancelled']);
});

test('stage control flow accepts IDs and rejects old display strings', () => {
    assert.equal(hasCompletedStage('build_timeline', 'match_scenes'), true);
    assert.equal(hasCompletedStage('Timeline Builder', 'Semantic Matching'), false);
    assert.equal(hasCompletedStage('Done', 'Export Final'), false);
});

test('workflow state rejects old and mismatched cache versions', () => {
    assert.throws(() => readCompatibleWorkflowState('{}'), { code: 'WORKFLOW_VERSION_MISMATCH' });
    assert.throws(() => readCompatibleWorkflowState('{"workflowVersion":1}'), { code: 'WORKFLOW_VERSION_MISMATCH' });
    assert.equal(readCompatibleWorkflowState('{"workflowVersion":2,"stageId":"upload"}').stageId, 'upload');
});

test('active contract excludes blur, visible subtitle, SRT, and font stages', () => {
    const contract = JSON.stringify({ ids: WORKFLOW_STAGE_IDS, labels: WORKFLOW_STAGE_LABELS }).toLowerCase();
    for (const forbidden of ['blur', 'subtitle', 'srt', 'font', 'semantic']) {
        assert.equal(contract.includes(forbidden), false, `active contract must exclude ${forbidden}`);
    }
});

test('SaaS lifecycle supports cancellation without changing workflow stages', () => {
    assert.equal(isJobStatus('cancelled'), true);
    assert.equal(WORKFLOW_STAGE_IDS.includes('cancelled'), false);
});

test('frontend imports the shared stage contract rather than display-string mappings', () => {
    const appSource = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(appSource, /WORKFLOW_STAGES/);
    assert.match(appSource, /job\.stageId/);
    assert.doesNotMatch(appSource, /job\.currentStep|Semantic Matching|Subtitle Builder/);
});

test('1.0x final speed is explicitly marked skipped', () => {
    assert.deepEqual(getFinalSpeedStageOutcome(1), {
        stageId: 'adjust_final_speed', stageOutcome: 'skipped'
    });
    assert.equal(getFinalSpeedStageOutcome(1.25).stageOutcome, 'completed');
});
