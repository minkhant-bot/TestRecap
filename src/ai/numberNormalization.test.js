import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBurmeseNumberText } from './numberNormalization.js';

test('normalizes Arabic and Myanmar integers without mutating the input', () => {
    const input = 'လူ 12 ယောက်နဲ့ ပစ္စည်း ၃၄ ခု';
    assert.equal(normalizeBurmeseNumberText(input), 'လူ တစ်ဆယ့်နှစ် ယောက်နဲ့ ပစ္စည်း သုံးဆယ့်လေး ခု');
    assert.equal(input, 'လူ 12 ယောက်နဲ့ ပစ္စည်း ၃၄ ခု');
});

test('normalizes decimals and percentages', () => {
    assert.equal(normalizeBurmeseNumberText('12.50%'), 'တစ်ဆယ့်နှစ် ဒသမ ငါး သုည ရာခိုင်နှုန်း');
});

test('normalizes ISO and day-first dates', () => {
    assert.equal(normalizeBurmeseNumberText('2026-07-25'), 'နှစ်ထောင် နှစ်ဆယ့်ခြောက် ခုနှစ် ဇူလိုင်လ နှစ်ဆယ့်ငါး ရက်');
    assert.equal(normalizeBurmeseNumberText('25/07/2026'), 'နှစ်ထောင် နှစ်ဆယ့်ခြောက် ခုနှစ် ဇူလိုင်လ နှစ်ဆယ့်ငါး ရက်');
});

test('normalizes clock times', () => {
    assert.equal(normalizeBurmeseNumberText('3:30 PM'), 'နေ့လယ် သုံး နာရီ သုံးဆယ် မိနစ်');
    assert.equal(normalizeBurmeseNumberText('09:00'), 'ကိုး နာရီ');
});

test('normalizes currency values', () => {
    assert.equal(normalizeBurmeseNumberText('$1,250.50'), 'အမေရိကန်ဒေါ်လာ တစ်ထောင် နှစ်ရာ ငါးဆယ် ဒသမ ငါး သုည');
    assert.equal(normalizeBurmeseNumberText('MMK 5000'), 'မြန်မာကျပ် ငါးထောင်');
});

test('normalizes common units', () => {
    assert.equal(normalizeBurmeseNumberText('10 km, 5kg, 37°C'), 'တစ်ဆယ် ကီလိုမီတာ, ငါး ကီလိုဂရမ်, သုံးဆယ့်ခုနစ် ဒီဂရီ စင်တီဂရိတ်');
    assert.equal(normalizeBurmeseNumberText('60 km/h'), 'ခြောက်ဆယ် တစ်နာရီလျှင် ကီလိုမီတာ');
});
