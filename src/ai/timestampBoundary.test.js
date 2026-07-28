import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GEMINI_EOF_DRIFT_TOLERANCE_SECONDS,
    validateTimestamps
} from './index.js';

const segment = (timestamp, text = 'spoken content') => ({ timestamp, text });

test('repairs only safe final-segment drift at the real media boundary', () => {
    const input = [
        segment([0, 9.7], 'beginning'),
        segment([9.7, 10.3], 'ending')
    ];
    const result = validateTimestamps(input, 10);

    assert.deepEqual(result.map(item => item.timestamp), [[0, 9.7], [9.7, 10]]);
    assert.equal(result.length, input.length);
    assert.equal(result[1].text, 'ending');
    assert.deepEqual(input[1].timestamp, [9.7, 10.3]);
});

test('accepts exact 0.3-second EOF drift despite floating-point representation', () => {
    const duration = 227.833991;
    const result = validateTimestamps([
        segment([224, duration + GEMINI_EOF_DRIFT_TOLERANCE_SECONDS])
    ], duration);
    assert.equal(result[0].timestamp[1], duration);
});

test('leaves normal in-range timing and intentional gaps unchanged', () => {
    const input = [
        segment([0.2, 2.1]),
        segment([2.4, 4.7]),
        segment([5, 9.8])
    ];
    assert.deepEqual(validateTimestamps(input, 10), input);
});

test('rejects EOF drift above 0.3 seconds instead of noticeably compressing speech', () => {
    assert.throws(
        () => validateTimestamps([segment([8, 10.3001])], 10),
        /only final-segment drift up to 0\.300s/
    );
});

test('rejects non-final out-of-bounds timestamps instead of repairing the timeline', () => {
    assert.throws(
        () => validateTimestamps([
            segment([0, 5.1]),
            segment([5.1, 9])
        ], 5),
        /only final-segment drift/
    );
});

test('rejects starts outside the media instead of dropping speech', () => {
    assert.throws(
        () => validateTimestamps([segment([10, 10.2])], 10),
        /refusing to drop or truncate speech/
    );
});

test('rejects overlapping Gemini timestamps instead of moving speech', () => {
    assert.throws(
        () => validateTimestamps([
            segment([0, 3]),
            segment([2.9, 5])
        ], 5),
        /refusing to move or overlap speech/
    );
});

test('rejects malformed and zero-length timestamps without omitting records', () => {
    assert.throws(
        () => validateTimestamps([segment([1, 1])], 5),
        /invalid range/
    );
    assert.throws(
        () => validateTimestamps([{ timestamp: [1] }], 5),
        /exactly \[start, end\]/
    );
});
