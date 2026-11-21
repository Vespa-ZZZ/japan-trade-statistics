import { setTimeout as delay } from 'node:timers/promises';
import {
    AREAS, COMMODITY_PARTNERS, SOURCE, areaTableUrl, commodityTableUrl, decode, parseAreaTable,
    parseCommodityTable, periodInRange, sanitize,
} from './trade.js';

const USER_AGENT = 'japan-trade-statistics-actor/1.0';
const BATCH = 500;

class InputError extends Error {}

const PERIOD = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const MAX_WAIT_MS = 120000;

function retryAfterMs(res) {
    const h = res.headers.get('retry-after');
    if (!h) return 0;
    if (/^\d+$/.test(h)) return Number(h) * 1000;
    const t = Date.parse(h);
    return Number.isFinite(t) ? Math.max(0, t - Date.now()) : 0;
}

function makeFetcher({ fetchImpl, sleep, intervalMs, log }) {
    let first = true;
    return async (url) => {
        for (let attempt = 0; attempt <= 3; attempt++) {
            if (!first) await sleep(attempt === 0 ? intervalMs : intervalMs * 2 ** attempt);
            first = false;
            let res;
            let body;
            try {
                res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
                if (res.ok) body = new Uint8Array(await res.arrayBuffer());
            } catch (err) {
                // Covers errors while connecting and while reading the body.
                if (attempt === 3) throw new Error(`Network error for ${url}: ${err.message}`);
                log.warning(`Network error for ${url}, retrying`);
                continue;
            }
            if (res.ok) return decode(body);
            if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
            if (attempt === 3) throw new Error(`HTTP ${res.status} for ${url} after retries`);
            const wait = retryAfterMs(res);
            if (wait > MAX_WAIT_MS) throw new Error(`HTTP ${res.status} for ${url}; the server asked to wait ${Math.round(wait / 1000)} s — try again later`);
            if (wait > 0) await sleep(wait);
            log.warning(`HTTP ${res.status} for ${url}, retrying`);
        }
        throw new Error(`Request failed: ${url}`);
    };
}

export async function run({ actor, log, fetchImpl = fetch, sleep = delay }) {
    await actor.init();
    try {
        const input = (await actor.getInput()) ?? {};
        const mode = input.mode ?? 'countries';
        const frequency = input.frequency ?? 'monthly';
        const from = input.from || null;
        const to = input.to || null;
        const intervalMs = Math.max(1000, Number(input.requestIntervalMs ?? 2000));
        const maxItems = Math.max(1, Math.min(Number(input.maxItems ?? 100000), 1000000));

        if (!['countries', 'commodities'].includes(mode)) throw new InputError('mode must be "countries" or "commodities".');
        if (!['monthly', 'yearly'].includes(frequency)) throw new InputError('frequency must be "monthly" or "yearly".');
        for (const [k, v] of [['from', from], ['to', to]]) {
            if (v && !PERIOD.test(v)) throw new InputError(`${k} must be YYYY or YYYY-MM (month 01-12).`);
        }
        if (from && to && from.slice(0, 7) > to.slice(0, 7) && !(to.length === 4 && from.startsWith(to))) {
            throw new InputError('from must not be later than to.');
        }

        const tables = [];
        if (mode === 'countries') {
            const areas = input.areas?.length ? input.areas : ['世界'];
            const bad = areas.filter((a) => !AREAS[a]);
            if (bad.length) throw new InputError(`Unknown area(s): ${bad.join(', ')}`);
            for (const area of new Set(areas)) tables.push({ url: areaTableUrl(area, frequency), meta: { area } });
        } else {
            const partners = input.partners?.length ? input.partners : ['世界'];
            const flows = input.flows?.length ? input.flows : ['export', 'import'];
            const bad = partners.filter((p) => !COMMODITY_PARTNERS[p]);
            if (bad.length) throw new InputError(`Unknown partner(s): ${bad.join(', ')}`);
            const badFlows = flows.filter((f) => !['export', 'import'].includes(f));
            if (badFlows.length) throw new InputError(`Unknown flow(s): ${badFlows.join(', ')}`);
            for (const partner of new Set(partners)) {
                for (const flow of new Set(flows)) tables.push({ url: commodityTableUrl(partner, flow, frequency), meta: { partner, flow } });
            }
        }
        // Commodity codes differ between the export and import tables (e.g. semiconductors are 70323 in
        // exports but 70311 in imports), so codes can be given per flow; commodityCodes applies to both.
        const codeSet = (v) => new Set((v ?? []).map((c) => String(c).replace(/'/g, '').trim()).filter(Boolean));
        const codesByFlow = {
            export: new Set([...codeSet(input.commodityCodes), ...codeSet(input.exportCommodityCodes)]),
            import: new Set([...codeSet(input.commodityCodes), ...codeSet(input.importCommodityCodes)]),
        };
        const nameTerms = (input.commodityNameContains ?? []).map((t) => String(t).trim()).filter(Boolean);
        const countries = new Set((input.partnerCodes ?? []).map((c) => String(c).trim()).filter(Boolean));

        const get = makeFetcher({ fetchImpl, sleep, intervalMs, log });
        let pushed = 0;
        let latest = null;
        for (const { url, meta } of tables) {
            if (pushed >= maxItems) break;
            const text = await get(url);
            const rows = mode === 'countries' ? parseAreaTable(text) : parseCommodityTable(text);
            const out = [];
            for (const r of rows) {
                if (!periodInRange(r.period, from, to)) continue;
                if (mode === 'countries' && countries.size && !countries.has(r.partnerCode ?? 'Total')) continue;
                if (mode === 'commodities') {
                    const codes = codesByFlow[meta.flow];
                    if (codes.size && !codes.has(r.commodityCode)) continue;
                    if (nameTerms.length && !nameTerms.some((t) => r.commodityName?.includes(t) || r.group?.includes(t))) continue;
                }
                if (!latest || r.period > latest) latest = r.period;
                const valueKey = mode === 'countries' ? null : 'valueThousandJPY';
                out.push({
                    ...meta,
                    frequency,
                    ...r,
                    ...(mode === 'countries'
                        ? {
                            partnerCode: r.partnerCode ?? 'Total',
                            exportJPY: r.exportThousandJPY === null ? null : r.exportThousandJPY * 1000,
                            importJPY: r.importThousandJPY === null ? null : r.importThousandJPY * 1000,
                            balanceJPY: r.exportThousandJPY === null || r.importThousandJPY === null
                                ? null : (r.exportThousandJPY - r.importThousandJPY) * 1000,
                        }
                        : { valueJPY: r[valueKey] === null ? null : r[valueKey] * 1000 }),
                    sourceUrl: url,
                    source: SOURCE,
                });
                if (pushed + out.length >= maxItems) break;
            }
            for (let i = 0; i < out.length; i += BATCH) await actor.pushData(out.slice(i, i + BATCH));
            pushed += out.length;
            log.info(`${url}: ${out.length} rows`);
        }
        await actor.setValue('RUN_SUMMARY', { tables: tables.length, pushed, latestPeriod: latest });
        if (pushed === 0) log.warning('No rows matched. Check the period range and filters.');
        log.info(`Done. Pushed ${pushed} rows. Latest period: ${latest ?? 'n/a'}.`);
        await actor.exit();
    } catch (err) {
        const msg = sanitize(err.message);
        log.error(err instanceof InputError ? `Invalid input: ${msg}` : msg);
        await actor.fail(msg);
    }
}
