// Pure helpers for the Japan Customs "trends in exports and imports" CSV files
// (税関 輸出入額の推移, https://www.customs.go.jp/toukei/suii/html/time.htm).
// Terms: https://www.customs.go.jp/copyright_e.htm (Public Data License 1.0).

export const BASE = 'https://www.customs.go.jp/toukei/suii/html/data/';
export const SOURCE = 'Japan Customs, Ministry of Finance — 輸出入額の推移 (Trade Statistics of Japan)';

/** Area tables: total exports/imports, broken down by partner country (except the world table). */
export const AREAS = {
    世界: 'd41{f}a', アジア: 'd42{f}a001', 大洋州: 'd42{f}a002', 北米: 'd42{f}a003', 中南米: 'd42{f}a004',
    西欧: 'd42{f}a005', '中東欧・ロシア等': 'd42{f}a006', 中東: 'd42{f}a007', アフリカ: 'd42{f}a008',
    特殊地域: 'd42{f}a009', EU: 'd42{f}a010', ASEAN: 'd42{f}a012',
};

/** Commodity tables: exports (d5) / imports (d6) by commodity group for one partner. */
export const COMMODITY_PARTNERS = {
    世界: '{d}1{f}a', 米国: '{d}2{f}a001', EU: '{d}2{f}a002', アジア: '{d}2{f}a003', 中国: '{d}2{f}a004',
    韓国: '{d}2{f}a005', ASEAN: '{d}2{f}a006', 中東: '{d}2{f}a007', ロシア: '{d}2{f}a008',
};

export class FormatError extends Error {}

const FREQ = { monthly: 'm', yearly: 'c' };

export function areaTableUrl(area, frequency) {
    const tpl = AREAS[area];
    if (!tpl) throw new Error(`Unknown area "${area}".`);
    return `${BASE}${tpl.replace('{f}', FREQ[frequency])}.csv`;
}

export function commodityTableUrl(partner, flow, frequency) {
    const tpl = COMMODITY_PARTNERS[partner];
    if (!tpl) throw new Error(`Unknown partner "${partner}".`);
    const d = flow === 'export' ? 'd5' : flow === 'import' ? 'd6' : null;
    if (!d) throw new Error(`Unknown flow "${flow}".`);
    return `${BASE}${tpl.replace('{d}', d).replace('{f}', FREQ[frequency])}.csv`;
}

/** Shift_JIS bytes -> text. */
export function decode(buffer) {
    return new TextDecoder('shift_jis').decode(buffer);
}

function splitLines(text) {
    return text.split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim()));
}

/** "1979/01" -> "1979-01", "1979" -> "1979". */
export function normalizePeriod(raw) {
    const s = String(raw ?? '').trim();
    let m = /^(\d{4})\/(\d{1,2})$/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = /^(\d{4})$/.exec(s);
    return m ? m[1] : null;
}

/** Number or null. "-" and blanks are null. Throws on anything else. */
export function parseNumber(raw) {
    const s = String(raw ?? '').trim();
    if (s === '' || s === '-') return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new FormatError(`Unexpected numeric value "${s}"`);
    return Number(s);
}

/**
 * Period rows of a table, validated: every row must have all value columns. Placeholder rows at the end
 * of the file (periods not yet published: every value 0 or "-") are dropped; within the published range
 * a real 0 stays 0 and "-" becomes null.
 */
function periodRows(lines, start, columns, width) {
    const out = [];
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const period = normalizePeriod(line[0]);
        if (!period) {
            if (line.some((cell) => cell !== '')) throw new FormatError(`Unexpected row ${i + 1}: "${line.slice(0, 3).join(',')}"`);
            continue;
        }
        if (line.length !== width) throw new FormatError(`Row ${i + 1} (${period}) has ${line.length} columns, expected ${width}`);
        let values;
        try {
            values = columns.map(({ c, valueOnly }) => [parseNumber(line[c]), valueOnly ? null : parseNumber(line[c + 1])]);
        } catch (err) {
            throw new FormatError(`Row ${i + 1} (${period}): ${err.message}`);
        }
        out.push({ period, values, hasData: values.some(([a, b]) => (a !== null && a !== 0) || (b !== null && b !== 0)) });
    }
    if (!out.length) throw new FormatError('Table has no period rows');
    let last = out.length - 1;
    while (last >= 0 && !out[last].hasData) last--;
    return out.slice(0, last + 1);
}

export function periodInRange(period, from, to) {
    // Compare by prefix so that "2024" covers "2024-01".."2024-12" and vice versa.
    if (from && period.localeCompare(from) < 0 && !from.startsWith(period)) return false;
    if (to && period.localeCompare(to) > 0 && !period.startsWith(to)) return false;
    return true;
}

/**
 * Area table -> rows { period, partnerCode, partnerName, exportThousandJPY, importThousandJPY }.
 * partnerCode is null for the area total. Trailing unpublished periods are skipped (see periodRows).
 */
export function parseAreaTable(text) {
    const lines = splitLines(text);
    const headerIdx = lines.findIndex((l) => /^Years(\/Months)?$/.test(l[0]) && l[1] === 'Exp-Total' && l[2] === 'Imp-Total');
    if (headerIdx < 0) throw new FormatError('Area table header (Years, Exp-Total, Imp-Total) not found');
    const header = lines[headerIdx];
    const names = lines[headerIdx + 1] ?? [];
    const hasNames = names[0] === '' && normalizePeriod(names[0]) === null && names.slice(3).some(Boolean);
    const columns = [];
    for (let c = 1; c < header.length; c += 2) {
        const exp = /^Exp-(.+)$/.exec(header[c] ?? '');
        const imp = /^Imp-(.+)$/.exec(header[c + 1] ?? '');
        if (!exp || !imp || exp[1] !== imp[1]) {
            if (!header[c] && !header[c + 1]) continue;
            throw new FormatError(`Unexpected area table columns "${header[c]}", "${header[c + 1]}"`);
        }
        const code = exp[1] === 'Total' ? null : exp[1];
        columns.push({ c, partnerCode: code, partnerName: code === null ? null : (hasNames ? names[c] || null : null) });
    }
    const rows = [];
    for (const { period, values } of periodRows(lines, headerIdx + (hasNames ? 2 : 1), columns, header.length)) {
        columns.forEach((col, k) => rows.push({
            period,
            partnerCode: col.partnerCode,
            partnerName: col.partnerName,
            exportThousandJPY: values[k][0],
            importThousandJPY: values[k][1],
        }));
    }
    return rows;
}

const unquoteCode = (s) => String(s ?? '').replace(/'/g, '').replace(/[〜～~]/g, '-').replace(/\s+/g, '') || null;

/**
 * Commodity table -> rows { period, group, commodityCode, commodityName, valueThousandJPY, quantity, quantityUnit }.
 * Layout: label rows (報道発表品目名 / 概況品名 / 概況品コード) sit one column left of each
 * value/quantity pair (the 総額 pair at column 1 is labelled in column 1).
 */
export function parseCommodityTable(text) {
    const lines = splitLines(text);
    const press = lines.findIndex((l) => l[0] === '報道発表品目名');
    if (press < 0 || lines[press + 1]?.[0] !== '概況品名' || lines[press + 2]?.[0] !== '概況品コード') {
        throw new FormatError('Commodity table label rows (報道発表品目名 / 概況品名 / 概況品コード) not found');
    }
    const kind = lines[press + 3];
    const units = lines[press + 4];
    if (!/^Years(\/Months)?$/.test(units?.[0] ?? '')) throw new FormatError('Commodity table unit row not found');
    const columns = [];
    let group = null;
    for (let c = 1; c < kind.length; c += 2) {
        // The last commodity may have a value column only (no quantity column).
        const valueOnly = kind[c] === '金額' && c + 1 === kind.length;
        if (kind[c] !== '金額' || (!valueOnly && kind[c + 1] !== '数量')) {
            if (!kind[c] && !kind[c + 1]) continue;
            throw new FormatError(`Unexpected value/quantity columns at ${c}: "${kind[c]}", "${kind[c + 1]}"`);
        }
        const lc = c === 1 ? 1 : c - 1;
        const code = unquoteCode(lines[press + 2][lc]);
        if (!code) throw new FormatError(`Missing commodity code for column ${c}`);
        const pressName = lines[press][lc] || null;
        // Only numbered press names ("１．食料品") start a new top-level group.
        if (pressName && /^[０-９0-9]+．/.test(pressName)) group = pressName.replace(/^[０-９0-9]+．/, '');
        const name = lines[press + 1][lc] || pressName?.replace(/^[０-９0-9]+．/, '') || null;
        const unitMatch = valueOnly ? null : /単位：([^)）]+)/.exec(units[c + 1] ?? '');
        columns.push({ c, valueOnly, commodityCode: code, commodityName: name, group: c === 1 ? null : group, quantityUnit: unitMatch ? unitMatch[1] : null });
    }
    if (!columns.length) throw new FormatError('No commodity columns found');
    const rows = [];
    for (const { period, values } of periodRows(lines, press + 5, columns, kind.length)) {
        columns.forEach((col, k) => rows.push({
            period,
            group: col.group,
            commodityCode: col.commodityCode,
            commodityName: col.commodityName,
            valueThousandJPY: values[k][0],
            quantity: values[k][1],
            quantityUnit: col.quantityUnit,
        }));
    }
    return rows;
}

export function sanitize(message) {
    return String(message)
        .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s'"`)]*/g, '<path>')
        .replace(/\/(?:home|Users|root|tmp|var|usr)\/[^\s'"`)]*/g, '<path>');
}
