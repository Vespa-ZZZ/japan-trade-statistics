import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    areaTableUrl, commodityTableUrl, decode, normalizePeriod, parseNumber, periodInRange,
    parseAreaTable, parseCommodityTable, FormatError, sanitize,
} from '../src/trade.js';

const fx = (name) => decode(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('table URLs', () => {
    assert.equal(areaTableUrl('世界', 'monthly'), 'https://www.customs.go.jp/toukei/suii/html/data/d41ma.csv');
    assert.equal(areaTableUrl('アジア', 'yearly'), 'https://www.customs.go.jp/toukei/suii/html/data/d42ca001.csv');
    assert.equal(commodityTableUrl('世界', 'export', 'monthly'), 'https://www.customs.go.jp/toukei/suii/html/data/d51ma.csv');
    assert.equal(commodityTableUrl('中国', 'import', 'yearly'), 'https://www.customs.go.jp/toukei/suii/html/data/d62ca004.csv');
    assert.throws(() => areaTableUrl('火星', 'monthly'), /Unknown area/);
    assert.throws(() => commodityTableUrl('世界', 'transit', 'monthly'), /Unknown flow/);
});

test('helpers', () => {
    assert.equal(normalizePeriod('1979/1'), '1979-01');
    assert.equal(normalizePeriod('1979 '), '1979');
    assert.equal(normalizePeriod('Years'), null);
    assert.equal(parseNumber('-'), null);
    assert.equal(parseNumber(' 0 '), 0);
    assert.equal(parseNumber('123 '), 123);
    assert.throws(() => parseNumber('1,234'), FormatError);
    assert.equal(periodInRange('2024-05', '2024', '2024'), true);
    assert.equal(periodInRange('2023-12', '2024-01', null), false);
    assert.equal(periodInRange('2024', '2024-06', null), true);
    assert.equal(periodInRange('2025-01', null, '2024'), false);
});

test('world monthly table: totals, unpublished months skipped', () => {
    const rows = parseAreaTable(fx('d41ma.csv'));
    assert.equal(rows[0].period, '1979-01');
    assert.equal(rows[0].partnerCode, null);
    assert.equal(rows[0].exportThousandJPY, 1192541404);
    assert.equal(rows[0].importThousandJPY, 1476341312);
    const last = rows.at(-1);
    assert.ok(last.exportThousandJPY > 0, 'trailing all-zero (unpublished) months are skipped');
    assert.ok(!rows.some((r) => r.exportThousandJPY === 0 && r.importThousandJPY === 0));
});

test('region yearly table: one row per partner country, real zeros kept', () => {
    const rows = parseAreaTable(fx('d42ca001.csv'));
    const y1979 = rows.filter((r) => r.period === '1979');
    assert.equal(y1979[0].partnerCode, null);
    const korea = y1979.find((r) => r.partnerCode === '103');
    assert.equal(korea.partnerName, 'R KOREA');
    assert.equal(korea.exportThousandJPY, 1359726296);
    const bhutan = y1979.find((r) => r.partnerName === 'BHUTAN');
    assert.equal(bhutan.importThousandJPY, 0);
});

test('commodity table: labels one column left of value/quantity pairs, sums consistent', () => {
    const rows = parseCommodityTable(fx('d51ma.csv'));
    const jan88 = rows.filter((r) => r.period === '1988-01');
    const by = (code) => jan88.find((r) => r.commodityCode === code);
    assert.equal(by('0-9').valueThousandJPY, 2187613965);
    assert.equal(by('0-9').commodityName, '総額');
    assert.equal(by('0+1').valueThousandJPY, 14091115);
    assert.equal(by('0').commodityName, '食料品及び動物');
    assert.equal(by('0').valueThousandJPY + by('1').valueThousandJPY, by('0+1').valueThousandJPY);
    assert.equal(by('2').valueThousandJPY + by('4').valueThousandJPY, by('2+4').valueThousandJPY);
    assert.equal(by('2').quantity, 25097);
    assert.equal(by('2').quantityUnit, 'MT');
    assert.equal(by('0').quantity, null);
    assert.equal(by('0').group, '食料品');
    assert.ok(!rows.some((r) => r.period === '2026-12'), 'unpublished months ("-") are skipped');
});

test('unknown layouts fail clearly', () => {
    assert.throws(() => parseAreaTable('foo,bar\n1,2'), FormatError);
    assert.throws(() => parseCommodityTable('foo,bar\n1,2'), FormatError);
    const broken = fx('d51ma.csv').replace('金額,数量', '金額,重量');
    assert.throws(() => parseCommodityTable(broken), /Unexpected value\/quantity columns/);
});

test('sanitize', () => {
    const p = ['C:', 'Users', 'someone', 'x.csv'].join('\\');
    assert.equal(sanitize(`ENOENT ${p}`), 'ENOENT <path>');
    assert.equal(sanitize('HTTP 503 for https://www.customs.go.jp/x.csv'), 'HTTP 503 for https://www.customs.go.jp/x.csv');
});

test('sub-items keep their numbered top-level group', () => {
    const rows = parseCommodityTable(fx('d51ma.csv')).filter((r) => r.period === '1988-01');
    const organic = rows.find((r) => r.commodityCode === '50101');
    assert.equal(organic.commodityName, '有機化合物');
    assert.equal(organic.group, '化学製品');
});

test('published zeros and blanks inside the published range are kept; only trailing placeholders are dropped', () => {
    const csv = [
        'Years/Months,Exp-Total,Imp-Total,Exp-103,Imp-103',
        ',,,R KOREA,R KOREA',
        '2026/01,100 ,200 ,0 ,0 ',
        '2026/02,0 ,0 ,0 ,0 ',
        '2026/03,5 ,- ,1 ,2 ',
        '2026/04,0 ,0 ,0 ,0 ',
        '2026/05,0 ,0 ,0 ,0 ',
    ].join('\n');
    const rows = parseAreaTable(csv);
    assert.deepEqual([...new Set(rows.map((r) => r.period))], ['2026-01', '2026-02', '2026-03']);
    const feb = rows.find((r) => r.period === '2026-02' && r.partnerCode === null);
    assert.equal(feb.exportThousandJPY, 0);
    assert.equal(rows.find((r) => r.period === '2026-03' && r.partnerCode === null).importThousandJPY, null);
});

test('truncated rows and header-only tables fail with the row number', () => {
    const header = 'Years/Months,Exp-Total,Imp-Total,Exp-103,Imp-103\n,,,R KOREA,R KOREA\n';
    assert.throws(() => parseAreaTable(`${header}2026/01,100 ,200 ,5\n`), /Row 3 \(2026-01\) has 4 columns, expected 5/);
    assert.throws(() => parseAreaTable(header), /no period rows/);
    const lines = fx('d51ma.csv').split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith('1990/01'));
    lines[i] = lines[i].split(',').slice(0, 10).join(',');
    assert.throws(() => parseCommodityTable(lines.join('\n')), /Row \d+ \(1990-01\) has 10 columns/);
});

test('trailing value-only commodity column is read; rows with extra columns fail', () => {
    const rows = parseCommodityTable(fx('d51ma.csv')).filter((r) => r.period === '1988-01');
    const last = rows.find((r) => r.commodityCode === '81301');
    assert.equal(last.valueThousandJPY, 22914307);
    assert.equal(last.quantity, null);
    const header = 'Years/Months,Exp-Total,Imp-Total\n,,\n';
    assert.throws(() => parseAreaTable(`${header}2026/01,100,999,200\n`), /has 4 columns, expected 3/);
});
