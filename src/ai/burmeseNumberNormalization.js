// Deterministic Burmese number-to-words normalization, applied only to the
// text handed to Edge TTS immediately before speech synthesis (see
// generateNarrationTTS in sawaungthinTts.js). Raw ASCII digits ("18") are
// pronounced unnaturally by the Burmese voice, so this rewrites them into
// natural Burmese number words ("တစ်ဆယ့်ရှစ်") before the text ever reaches
// the TTS engine. Nothing here touches the translated transcript, subtitle
// text, timestamps, or segmentation -- the caller is responsible for keeping
// this output separate from anything that gets displayed or persisted as
// the subtitle/transcript text.
//
// This is intentionally NOT a general NLP number-reading system -- it is a
// bounded, testable, deterministic text transform with clear boundary rules
// (see NUMBER_TOKEN_RE below) so it never has to guess.

const BURMESE_DIGITS = ['သုည', 'တစ်', 'နှစ်', 'သုံး', 'လေး', 'ငါး', 'ခြောက်', 'ခုနစ်', 'ရှစ်', 'ကိုး'];

// Place-value words for composing multi-digit numbers. Traditional Burmese
// names every power of ten distinctly (unlike English's x1000 grouping);
// beyond သန်း (million) modern usage commonly borrows "ဘီလီယံ" (billion)
// rather than the rarer traditional ကုဋေ/ပကောဋိ terms, so that's what's
// used here for very large counts.
const PLACE_VALUES = [
    [1_000_000_000, 'ဘီလီယံ'],
    [1_000_000, 'သန်း'],
    [100_000, 'သိန်း'],
    [10_000, 'သောင်း'],
    [1_000, 'ထောင်'],
    [100, 'ရာ'],
];

// The connector "့" is only ever inserted between the tens place (ဆယ်) and
// a trailing bare units digit -- e.g. 18 -> "တစ်ဆယ့်ရှစ်", 25 -> "နှစ်ဆယ့်ငါး".
// Every other place-value transition concatenates directly with no
// connector -- e.g. 1,500 -> "တစ်ထောင်" + "ငါးရာ" = "တစ်ထောင်ငါးရာ" (no "့").
// This rule is fitted exactly to those three examples; it is not a general
// grammar model and only applies at this one specific junction.
export const numberToBurmeseWords = n => {
    if (!Number.isFinite(n) || n < 0) throw new RangeError('numberToBurmeseWords requires a finite, non-negative number.');
    let remaining = Math.floor(n);
    if (remaining === 0) return BURMESE_DIGITS[0];

    let result = '';
    for (const [value, word] of PLACE_VALUES) {
        if (remaining >= value) {
            const count = Math.floor(remaining / value);
            remaining -= count * value;
            // Recursing on the multiplier handles both the common case
            // (a single digit, e.g. "5" + "ထောင်") and the rarer case where
            // the multiplier itself needs spelling out (e.g. 25,000,000 ->
            // "နှစ်ဆယ့်ငါး" + "သန်း" for the gap between သန်း and ဘီလီယံ).
            result += numberToBurmeseWords(count) + word;
        }
    }

    if (remaining >= 10) {
        const tens = Math.floor(remaining / 10);
        const ones = remaining % 10;
        remaining = ones;
        // "ဆယ့်" and "ဆယ်" are each written here as one pre-composed
        // literal, not built by splicing "့" onto "ဆယ်" at runtime -- the
        // Myanmar combining marks in "ယ့်" have a required Unicode order
        // (dot-below U+1037 before asat U+103A), and appending U+1037
        // *after* an already-terminated "ဆယ်" (which already ends in
        // U+103A) produces the two marks in the wrong order, an invisible
        // but very real correctness bug that breaks the connector.
        result += BURMESE_DIGITS[tens] + (ones > 0 ? 'ဆယ့်' : 'ဆယ်');
    }
    if (remaining > 0) {
        result += BURMESE_DIGITS[remaining];
    }
    return result;
};

// Integers beyond this length risk floating-point precision loss (and have
// no well-defined traditional/modern Burmese place-value word in
// PLACE_VALUES). Falling back to digit-by-digit reading is always safe and
// always correct character-for-character, even if less idiomatic.
const MAX_SAFE_DIGIT_LENGTH = 15;

const digitByDigitWords = digitString =>
    digitString.split('').map(digit => BURMESE_DIGITS[Number(digit)]).join(' ');

const integerStringToBurmeseWords = digitString => {
    const normalized = digitString.replace(/^0+(?=\d)/, '');
    if (normalized.length > MAX_SAFE_DIGIT_LENGTH) return digitByDigitWords(normalized);
    return numberToBurmeseWords(Number(normalized));
};

// Matches a standalone numeric token: an optional leading minus, an integer
// (plain or comma-grouped), an optional decimal part, and an optional
// percent sign.
//
// Boundary rules (the two lookbehinds / lookahead) are what keep this safe
// around IDs, filenames, URLs, version strings, and alphanumeric codes:
//   - (?<![A-Za-z0-9_]) / (?![A-Za-z0-9_]): never start or extend a match
//     immediately next to a Latin letter, digit, or underscore. This is
//     what protects "mp4" in "video_100.mp4", "px" in "104px", "4" in
//     "GPT4", etc. -- and, as a side effect, means a number embedded
//     directly against Burmese script with no space (e.g. "အသက်18နှစ်",
//     common in translated narration) is still matched and converted,
//     since Burmese letters fall outside [A-Za-z0-9_].
//   - (?<![A-Za-z]-): never start a match on a "-" that is itself directly
//     preceded by a Latin letter -- protects "19" in "COVID-19", "4" in
//     "GPT-4", etc.
//   - A "-" that is directly preceded by a digit (e.g. the middle "-" in an
//     ISO date "2026-08-06") can never itself become the start of a match
//     either, because the position right at that "-" is preceded by a
//     digit, which the first lookbehind already excludes. That is what
//     keeps dates ("2026-08-06"), times ("10:30"), and ranges ("10-20")
//     safe without any dedicated date/time/range-parsing code: each
//     component is matched and converted independently, and the original
//     separator ("-", "/", ":") is left untouched in place.
const NUMBER_TOKEN_RE = /(?<![A-Za-z0-9_])(?<![A-Za-z]-)(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?(?![A-Za-z0-9_])/g;

const convertNumberToken = match => {
    const isNegative = match.startsWith('-');
    let body = isNegative ? match.slice(1) : match;
    const isPercent = body.endsWith('%');
    if (isPercent) body = body.slice(0, -1);

    const [integerPart, fractionPart] = body.split('.');
    const integerDigits = integerPart.replace(/,/g, '');

    let words;
    if (fractionPart !== undefined) {
        // Decimals are read digit-by-digit after "ဒဿမ" (decimal point),
        // never as a whole number -- e.g. 3.5 -> "သုံး ဒဿမ ငါး", never
        // "သုံး ဒဿမ ဆယ့်ငါး" (which would misread ".5" as fifty).
        words = `${integerStringToBurmeseWords(integerDigits)} ဒဿမ ${digitByDigitWords(fractionPart)}`;
    } else {
        words = integerStringToBurmeseWords(integerDigits);
    }
    if (isPercent) words = `${words} ရာခိုင်နှုန်း`;
    if (isNegative) words = `အနုတ် ${words}`;
    return words;
};

// Spans matching any of these are protected from number conversion entirely
// (replaced with a placeholder, then restored verbatim afterward) so their
// digits are never touched, regardless of what punctuation surrounds them.
// These cover cases the boundary rules on NUMBER_TOKEN_RE alone can't fully
// disambiguate -- e.g. a purely numeric URL path segment ("/watch?v=12345"),
// or a multi-segment code where a later digit group is only preceded by
// another digit-hyphen ("PO-2024-0091").
const PROTECTED_SPAN_PATTERNS = [
    /\bhttps?:\/\/\S+/gi, // full URLs
    /\bwww\.\S+/gi, // www.-prefixed hosts
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, // email addresses
    /\b[\w-]+\.(?:mp4|mp3|wav|mov|avi|mkv|webm|json|png|jpe?g|gif|pdf|docx?|xlsx?|csv|zip|srt|txt|js|ts|py)\b/gi, // filenames with a known extension
    /\bv?\d+(?:\.\d+){2,}\b/gi, // version strings with 2+ dots: 2.1.3, v1.0.0 (a real decimal only ever has one dot)
    /\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b/g, // letter-initial hyphenated codes: PO-2024-0091, COVID-19, GPT-4
];

// Each protected span is swapped for a single Private Use Area character
// (never legitimately present in translated narration text) rather than a
// digit-bearing placeholder string -- a digit-bearing placeholder would risk
// being re-matched and mangled by NUMBER_TOKEN_RE itself before restoration.
// A PUA character contains no digits, so it structurally cannot collide
// with the number regex, without relying on any adjacency heuristics.
const PRIVATE_USE_AREA_BASE = 0xe000;

const protectSpans = text => {
    const originals = [];
    let protectedText = text;
    for (const pattern of PROTECTED_SPAN_PATTERNS) {
        protectedText = protectedText.replace(pattern, matched => {
            const marker = String.fromCodePoint(PRIVATE_USE_AREA_BASE + originals.length);
            originals.push(matched);
            return marker;
        });
    }
    return { protectedText, originals };
};

const restoreSpans = (text, originals) => originals.reduce(
    (result, original, index) => result.split(String.fromCodePoint(PRIVATE_USE_AREA_BASE + index)).join(original),
    text,
);

// The one entry point: converts every standalone Arabic-numeral number in
// `text` into natural Burmese words, immediately before that text is handed
// to TTS. Safe to call on any string, including text with no digits at all
// (returned unchanged) or text already fully in Burmese words/script
// (never matched, since this only ever looks for ASCII 0-9).
export const normalizeNumbersForBurmeseTts = text => {
    if (typeof text !== 'string' || text === '') return text;
    const { protectedText, originals } = protectSpans(text);
    const converted = protectedText.replace(NUMBER_TOKEN_RE, convertNumberToken);
    return restoreSpans(converted, originals);
};
