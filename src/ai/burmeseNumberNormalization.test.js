import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNumbersForBurmeseTts, numberToBurmeseWords } from './burmeseNumberNormalization.js';

// --- Task's own worked examples -------------------------------------------

test('matches every worked example from the task exactly', () => {
    assert.equal(normalizeNumbersForBurmeseTts('18'), 'တစ်ဆယ့်ရှစ်');
    assert.equal(normalizeNumbersForBurmeseTts('25'), 'နှစ်ဆယ့်ငါး');
    assert.equal(normalizeNumbersForBurmeseTts('100'), 'တစ်ရာ');
    assert.equal(normalizeNumbersForBurmeseTts('1,500'), 'တစ်ထောင်ငါးရာ');
    assert.equal(normalizeNumbersForBurmeseTts('3.5'), 'သုံး ဒဿမ ငါး');
    assert.equal(normalizeNumbersForBurmeseTts('50%'), 'ငါးဆယ် ရာခိုင်နှုန်း');
});

// --- Cardinal numbers -------------------------------------------------------

test('single digits and zero', () => {
    assert.equal(numberToBurmeseWords(0), 'သုည');
    assert.equal(numberToBurmeseWords(1), 'တစ်');
    assert.equal(numberToBurmeseWords(9), 'ကိုး');
});

test('teens use the tens+connector+unit form, not a bare unit reading', () => {
    assert.equal(numberToBurmeseWords(10), 'တစ်ဆယ်');
    assert.equal(numberToBurmeseWords(11), 'တစ်ဆယ့်တစ်');
    assert.equal(numberToBurmeseWords(19), 'တစ်ဆယ့်ကိုး');
});

test('round tens have no trailing connector', () => {
    assert.equal(numberToBurmeseWords(20), 'နှစ်ဆယ်');
    assert.equal(numberToBurmeseWords(90), 'ကိုးဆယ်');
});

test('hundreds concatenate directly with the tens/units remainder (no connector at that boundary)', () => {
    assert.equal(numberToBurmeseWords(200), 'နှစ်ရာ');
    assert.equal(numberToBurmeseWords(105), 'တစ်ရာငါး');
    assert.equal(numberToBurmeseWords(999), 'ကိုးရာကိုးဆယ့်ကိုး');
});

test('thousands, ten-thousands, and hundred-thousands compose without a connector between place values', () => {
    assert.equal(numberToBurmeseWords(1_000), 'တစ်ထောင်');
    // 2026 = 2x1000 + 26; no connector between ထောင် (thousand) and the
    // following tens -- "့" is reserved strictly for the ဆယ်-then-unit
    // junction, so this must NOT read "နှစ်ထောင့်..." (with a connector).
    assert.equal(numberToBurmeseWords(2_026), 'နှစ်ထောင်နှစ်ဆယ့်ခြောက်');
    assert.equal(numberToBurmeseWords(10_000), 'တစ်သောင်း');
    assert.equal(numberToBurmeseWords(100_000), 'တစ်သိန်း');
    assert.equal(numberToBurmeseWords(1_000_000), 'တစ်သန်း');
});

test('a multi-digit multiplier at a large place value is itself spelled out (the သန်း/ဘီလီယံ gap)', () => {
    assert.equal(numberToBurmeseWords(25_000_000), 'နှစ်ဆယ့်ငါးသန်း');
    assert.equal(numberToBurmeseWords(1_000_000_000), 'တစ်ဘီလီယံ');
});

test('rejects invalid input rather than silently producing wrong output', () => {
    assert.throws(() => numberToBurmeseWords(-1));
    assert.throws(() => numberToBurmeseWords(NaN));
});

// --- Comma-grouped, decimal, percentage, negative --------------------------

test('comma-grouped integers are read as one number, not split at the comma', () => {
    assert.equal(normalizeNumbersForBurmeseTts('12,345'), numberToBurmeseWords(12345));
});

test('decimals read the fractional part digit-by-digit, never as a whole number', () => {
    assert.equal(normalizeNumbersForBurmeseTts('3.14'), 'သုံး ဒဿမ တစ် လေး');
    assert.equal(normalizeNumbersForBurmeseTts('0.5'), 'သုည ဒဿမ ငါး');
});

test('percentages append ရာခိုင်နှုန်း after the number word, including for decimal percentages', () => {
    assert.equal(normalizeNumbersForBurmeseTts('100%'), 'တစ်ရာ ရာခိုင်နှုန်း');
    assert.equal(normalizeNumbersForBurmeseTts('3.5%'), 'သုံး ဒဿမ ငါး ရာခိုင်နှုန်း');
});

test('negative numbers are prefixed with the negation word, including negative decimals', () => {
    assert.equal(normalizeNumbersForBurmeseTts('-5'), 'အနုတ် ငါး');
    assert.equal(normalizeNumbersForBurmeseTts('-3.5'), 'အနုတ် သုံး ဒဿမ ငါး');
});

// --- Dates, times, ranges (handled via independent per-component conversion) ---

test('dates convert each component independently and keep the original separators', () => {
    const result = normalizeNumbersForBurmeseTts('18/8/2026');
    assert.equal(result, `${numberToBurmeseWords(18)}/${numberToBurmeseWords(8)}/${numberToBurmeseWords(2026)}`);
});

test('ISO dates are not mistaken for one giant number or for a negative number at the dashes', () => {
    const result = normalizeNumbersForBurmeseTts('2026-08-06');
    assert.equal(result, `${numberToBurmeseWords(2026)}-${numberToBurmeseWords(8)}-${numberToBurmeseWords(6)}`);
});

test('times convert each component independently and keep the colon', () => {
    const result = normalizeNumbersForBurmeseTts('10:30');
    assert.equal(result, `${numberToBurmeseWords(10)}:${numberToBurmeseWords(30)}`);
});

test('a plain number range converts both endpoints and is not mistaken for a single negative number', () => {
    const result = normalizeNumbersForBurmeseTts('10-20');
    assert.equal(result, `${numberToBurmeseWords(10)}-${numberToBurmeseWords(20)}`);
});

// --- Currency ---------------------------------------------------------------

test('currency symbols and unit words are left untouched; only the digits convert', () => {
    assert.equal(normalizeNumbersForBurmeseTts('$100'), `$${numberToBurmeseWords(100)}`);
    assert.equal(normalizeNumbersForBurmeseTts('1,500 ကျပ်'), `${numberToBurmeseWords(1500)} ကျပ်`);
});

// --- Preservation: IDs, filenames, URLs, version strings, alphanumeric codes ---

test('digits directly touching letters (codes, units, extensions) are left untouched', () => {
    for (const text of ['ID12345', 'GPT4', '104px', 'H1N1', 'video_100.mp4']) {
        assert.equal(normalizeNumbersForBurmeseTts(text), text, text);
    }
});

test('hyphenated letter-prefixed codes are preserved whole, including a digit group after a digit-hyphen', () => {
    for (const text of ['COVID-19', 'GPT-4', 'PO-2024-0091']) {
        assert.equal(normalizeNumbersForBurmeseTts(text), text, text);
    }
});

test('URLs, including ones with purely numeric path segments, are preserved verbatim', () => {
    const withPath = 'Watch it at https://example.com/watch?v=12345 for more.';
    assert.equal(
        normalizeNumbersForBurmeseTts(withPath),
        withPath,
    );
    assert.equal(normalizeNumbersForBurmeseTts('visit www.example.com/page2'), 'visit www.example.com/page2');
});

test('email addresses are preserved verbatim', () => {
    assert.equal(normalizeNumbersForBurmeseTts('contact user2026@example.com now'), 'contact user2026@example.com now');
});

test('version strings (2+ dots) are preserved, unlike a genuine one-dot decimal', () => {
    assert.equal(normalizeNumbersForBurmeseTts('v2.1.3'), 'v2.1.3');
    assert.equal(normalizeNumbersForBurmeseTts('upgrade to 1.0.0 today'), 'upgrade to 1.0.0 today');
});

test('a real surrounding sentence with both a preserved code and a spoken number converts only the number', () => {
    const input = 'Model GPT-4 scored 95 points.';
    const result = normalizeNumbersForBurmeseTts(input);
    assert.equal(result, `Model GPT-4 scored ${numberToBurmeseWords(95)} points.`);
});

// --- Already-Burmese text is left alone -------------------------------------

test('numbers already written as Burmese words are never touched', () => {
    const text = 'ဒီနေ့ တစ်ဆယ့်ရှစ် နှစ်ရှိပါပြီ။';
    assert.equal(normalizeNumbersForBurmeseTts(text), text);
});

test('Myanmar-script numerals (not ASCII digits) are never touched', () => {
    const text = 'အသက် ၁၈ နှစ်။';
    assert.equal(normalizeNumbersForBurmeseTts(text), text);
});

test('a number embedded directly against Burmese script with no space still converts (real translated-narration shape)', () => {
    const result = normalizeNumbersForBurmeseTts('အသက်18နှစ်');
    assert.equal(result, `အသက်${numberToBurmeseWords(18)}နှစ်`);
});

// --- Safety / non-crashing behavior -----------------------------------------

test('non-string and empty input pass through unchanged instead of throwing', () => {
    assert.equal(normalizeNumbersForBurmeseTts(''), '');
    assert.equal(normalizeNumbersForBurmeseTts(null), null);
    assert.equal(normalizeNumbersForBurmeseTts(undefined), undefined);
});

test('text with no digits at all is returned unchanged', () => {
    const text = 'ဗီဒီယိုကို ကြည့်ရှုပါ။';
    assert.equal(normalizeNumbersForBurmeseTts(text), text);
});

test('an unrealistically long digit string falls back to digit-by-digit reading instead of losing precision', () => {
    const huge = '123456789012345678';
    const result = normalizeNumbersForBurmeseTts(huge);
    const expected = huge.split('').map(d => numberToBurmeseWords(Number(d))).join(' ');
    assert.equal(result, expected);
});

test('multiple numbers in one sentence each convert independently', () => {
    const input = 'ဗီဒီယို 3 ခု ကို 18 မိနစ် အတွင်း ကြည့်ပါ။';
    const result = normalizeNumbersForBurmeseTts(input);
    assert.equal(result, `ဗီဒီယို ${numberToBurmeseWords(3)} ခု ကို ${numberToBurmeseWords(18)} မိနစ် အတွင်း ကြည့်ပါ။`);
});
