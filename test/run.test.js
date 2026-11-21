import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../src/run.js';

const bytes = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const FILES = {
    'https://www.customs.go.jp/toukei/suii/html/data/d41ma.csv': bytes('d41ma.csv'),
    'https://www.customs.go.jp/toukei/suii/html/data/d51ma.csv': bytes('d51ma.csv'),
    'https://www.customs.go.jp/toukei/suii/html/data/d42ca001.csv': bytes('d42ca001.csv'),
};

async function exec(input, files = FILES) {
    const records = [];
    const values = new Map();
    const lifecycle = [];
    const logs = [];
    const requests = [];
    const actor = {
        async init() {},
        async getInput() { return input; },
        async pushData(r) { records.push(...(Array.isArray(r) ? r : [r])); },
        async setValue(k, v) { values.set(k, v); },
        async exit() { lifecycle.push('exit'); },
        async fail(m) { lifecycle.push('fail', m); },
    };
    const log = { info: (m) => logs.push(m), warning: (m) => logs.push(m), error: (m) => logs.push(m) };
    const fetchImpl = async (url) => {
        requests.push(url);
        const body = files[url];
        if (body === undefined) return new Response('nope', { status: 404 });
        if (body === 503) return new Response('busy', { status: 503 });
        return new Response(body);
    };
    await run({ actor, log, fetchImpl, sleep: async () => {} });
    return { records, summary: values.get('RUN_SUMMARY'), lifecycle, logs, requests };
}

test('countries mode, world monthly with period filter', async () => {
    const r = await exec({ mode: 'countries', areas: ['世界'], frequency: 'monthly', from: '2024-01', to: '2024-03' });
    assert.deepEqual(r.lifecycle, ['exit']);
    assert.deepEqual(r.records.map((x) => x.period), ['2024-01', '2024-02', '2024-03']);
    const x = r.records[0];
    assert.equal(x.partnerCode, 'Total');
    assert.equal(x.exportJPY, x.exportThousandJPY * 1000);
    assert.equal(x.balanceJPY, (x.exportThousandJPY - x.importThousandJPY) * 1000);
    assert.equal(x.area, '世界');
    assert.match(x.source, /Customs/);
});

test('countries mode with partner code filter', async () => {
    const r = await exec({ mode: 'countries', areas: ['アジア'], frequency: 'yearly', partnerCodes: ['105'], from: '1980', to: '1980' });
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].partnerName, 'CHINA');
});

test('commodities mode with code filter and maxItems', async () => {
    const r = await exec({ mode: 'commodities', partners: ['世界'], flows: ['export'], commodityCodes: ["'0'+'1'"], maxItems: 5 });
    assert.equal(r.records.length, 5);
    assert.ok(r.records.every((x) => x.commodityCode === '0+1' && x.flow === 'export' && x.partner === '世界'));
    assert.equal(r.records[0].valueJPY, r.records[0].valueThousandJPY * 1000);
});

test('invalid input and HTTP errors fail with a clear message', async () => {
    const bad = await exec({ mode: 'countries', areas: ['火星'] });
    assert.equal(bad.lifecycle[0], 'fail');
    assert.match(bad.lifecycle[1], /Unknown area/);
    const period = await exec({ from: '2024/01' });
    assert.match(period.lifecycle[1], /YYYY or YYYY-MM/);
    const missing = await exec({ mode: 'commodities', partners: ['中国'], flows: ['import'] });
    assert.match(missing.lifecycle[1], /HTTP 404/);
});

test('503 is retried', async () => {
    let n = 0;
    const url = 'https://www.customs.go.jp/toukei/suii/html/data/d41ma.csv';
    const files = new Proxy({}, { get: (_, k) => (k === url ? (n++ < 1 ? 503 : FILES[url]) : undefined) });
    const r = await exec({ from: '2024-01', to: '2024-01' }, files);
    assert.deepEqual(r.lifecycle, ['exit']);
    assert.equal(r.records.length, 1);
});

test('per-flow commodity codes and name filter', async () => {
    const files = {
        ...FILES,
        'https://www.customs.go.jp/toukei/suii/html/data/d61ma.csv': FILES['https://www.customs.go.jp/toukei/suii/html/data/d51ma.csv'],
    };
    const r = await exec({
        mode: 'commodities', partners: ['世界'], flows: ['export', 'import'], from: '1988-01', to: '1988-01',
        exportCommodityCodes: ['0'], importCommodityCodes: ['1'],
    }, files);
    assert.deepEqual(r.records.map((x) => [x.flow, x.commodityCode]), [['export', '0'], ['import', '1']]);
    const named = await exec({ mode: 'commodities', partners: ['世界'], flows: ['export'], from: '1988-01', to: '1988-01', commodityNameContains: ['医薬品'] });
    assert.deepEqual(named.records.map((x) => x.commodityName), ['医薬品']);
});

test('invalid periods are rejected before any download', async () => {
    for (const input of [{ from: '2024-13' }, { from: '2024-06', to: '2024-01' }]) {
        const r = await exec(input);
        assert.equal(r.lifecycle[0], 'fail');
        assert.equal(r.requests.length, 0);
    }
    const ok = await exec({ frequency: 'monthly', from: '2024-01', to: '2024' });
    assert.deepEqual(ok.lifecycle, ['exit']);
});
