const MYANMAR_DIGITS = '၀၁၂၃၄၅၆၇၈၉';
const DIGIT_WORDS = ['သုည', 'တစ်', 'နှစ်', 'သုံး', 'လေး', 'ငါး', 'ခြောက်', 'ခုနစ်', 'ရှစ်', 'ကိုး'];
const MONTHS = ['', 'ဇန်နဝါရီလ', 'ဖေဖော်ဝါရီလ', 'မတ်လ', 'ဧပြီလ', 'မေလ', 'ဇွန်လ', 'ဇူလိုင်လ', 'ဩဂုတ်လ', 'စက်တင်ဘာလ', 'အောက်တိုဘာလ', 'နိုဝင်ဘာလ', 'ဒီဇင်ဘာလ'];
const SCALES = [
    [1000000000000n, 'ထရီလီယံ'], [1000000000n, 'ဘီလီယံ'],
    [10000000n, 'ကုဋေ'], [1000000n, 'သန်း'], [100000n, 'သိန်း'],
    [10000n, 'သောင်း'], [1000n, 'ထောင်'], [100n, 'ရာ']
];

const toArabicDigits = text => text.replace(/[၀-၉]/g, digit => String(MYANMAR_DIGITS.indexOf(digit)));

const integerToWords = value => {
    const number = typeof value === 'bigint' ? value : BigInt(value || 0);
    if (number === 0n) return DIGIT_WORDS[0];
    if (number < 0n) return `အနုတ် ${integerToWords(-number)}`;
    if (number < 10n) return DIGIT_WORDS[Number(number)];
    if (number < 100n) {
        const tens = number / 10n;
        const ones = number % 10n;
        return ones ? `${DIGIT_WORDS[Number(tens)]}ဆယ့်${DIGIT_WORDS[Number(ones)]}` : `${DIGIT_WORDS[Number(tens)]}ဆယ်`;
    }
    for (const [scale, label] of SCALES) {
        if (number >= scale) {
            const head = number / scale;
            const rest = number % scale;
            return `${integerToWords(head)}${label}${rest ? ` ${integerToWords(rest)}` : ''}`;
        }
    }
    return '';
};

const numberToWords = raw => {
    const clean = raw.replace(/,/g, '');
    const negative = clean.startsWith('-');
    const unsigned = negative ? clean.slice(1) : clean;
    const [whole = '0', fraction] = unsigned.split('.');
    let result = integerToWords(BigInt(whole || '0'));
    if (fraction !== undefined) {
        result += ` ဒသမ ${[...fraction].map(digit => DIGIT_WORDS[Number(digit)]).join(' ')}`;
    }
    return negative ? `အနုတ် ${result}` : result;
};

const replaceDate = (_, year, month, day) => {
    const monthNumber = Number(month);
    if (monthNumber < 1 || monthNumber > 12) return _;
    return `${numberToWords(year)} ခုနှစ် ${MONTHS[monthNumber]} ${numberToWords(day)} ရက်`;
};

const replaceDayFirstDate = (_, day, month, year) => {
    const monthNumber = Number(month);
    if (monthNumber < 1 || monthNumber > 12) return _;
    return `${numberToWords(year)} ခုနှစ် ${MONTHS[monthNumber]} ${numberToWords(day)} ရက်`;
};

const replaceTime = (_, hourRaw, minuteRaw, meridiem = '') => {
    let hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const marker = meridiem.toUpperCase();
    let period = '';
    if (marker === 'AM') {
        period = hour < 6 ? 'မနက်စောစော' : 'မနက်';
        if (hour === 12) hour = 0;
    } else if (marker === 'PM') {
        period = hour < 5 ? 'နေ့လယ်' : 'ညနေ';
        if (hour > 12) hour -= 12;
    }
    const minuteWords = minute ? ` ${numberToWords(String(minute))} မိနစ်` : '';
    return `${period ? `${period} ` : ''}${numberToWords(String(hour))} နာရီ${minuteWords}`;
};

const UNIT_WORDS = new Map([
    ['km/h', 'တစ်နာရီလျှင် ကီလိုမီတာ'], ['mph', 'တစ်နာရီလျှင် မိုင်'],
    ['km', 'ကီလိုမီတာ'], ['cm', 'စင်တီမီတာ'], ['mm', 'မီလီမီတာ'], ['m', 'မီတာ'],
    ['kg', 'ကီလိုဂရမ်'], ['mg', 'မီလီဂရမ်'], ['g', 'ဂရမ်'], ['lb', 'ပေါင်'],
    ['ml', 'မီလီလီတာ'], ['l', 'လီတာ'], ['°c', 'ဒီဂရီ စင်တီဂရိတ်'], ['°f', 'ဒီဂရီ ဖာရင်ဟိုက်']
]);

export const normalizeBurmeseNumberText = input => {
    if (typeof input !== 'string' || input.length === 0) return input;
    let text = toArabicDigits(input);

    text = text.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, replaceDate);
    text = text.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, replaceDayFirstDate);
    text = text.replace(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/gi, replaceTime);

    text = text.replace(/\$\s*(-?\d[\d,]*(?:\.\d+)?)/g, (_, amount) => `အမေရိကန်ဒေါ်လာ ${numberToWords(amount)}`);
    text = text.replace(/€\s*(-?\d[\d,]*(?:\.\d+)?)/g, (_, amount) => `ယူရို ${numberToWords(amount)}`);
    text = text.replace(/£\s*(-?\d[\d,]*(?:\.\d+)?)/g, (_, amount) => `ဗြိတိသျှပေါင် ${numberToWords(amount)}`);
    text = text.replace(/\b(USD|EUR|GBP|MMK)\s*(-?\d[\d,]*(?:\.\d+)?)/gi, (_, code, amount) => {
        const names = { USD: 'အမေရိကန်ဒေါ်လာ', EUR: 'ယူရို', GBP: 'ဗြိတိသျှပေါင်', MMK: 'မြန်မာကျပ်' };
        return `${names[code.toUpperCase()]} ${numberToWords(amount)}`;
    });

    text = text.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*%/g, (_, value) => `${numberToWords(value)} ရာခိုင်နှုန်း`);
    text = text.replace(/(-?\d[\d,]*(?:\.\d+)?)\s*(km\/h|mph|km|cm|mm|kg|mg|ml|lb|°C|°F|m|g|L)\b/gi,
        (_, value, unit) => `${numberToWords(value)} ${UNIT_WORDS.get(unit.toLowerCase())}`);

    text = text.replace(/-?\d[\d,]*(?:\.\d+)?/g, value => numberToWords(value));
    return text.replace(/\s{2,}/g, ' ').trim();
};
