// Opening then saving a spreadsheet must not change the type or value of untouched cells.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadModules } from './load.mjs';

const { ExcelJS, XLSX, loadSheets, export_xlsx, detectCsvEncoding, saved } = await loadModules();

const toArrayBuffer = (bytes) => new Uint8Array(bytes).slice().buffer;

async function resave(ext, input, edit, encoding) {
    const data = await loadSheets(toArrayBuffer(input), `.${ext}`);
    edit?.(data.sheets[0].rows);
    const fallback = await export_xlsx({ getData: () => data.sheets }, ext, encoding, undefined, data.csvDelimiter);
    return { data, bytes: new Uint8Array(saved()), fallback };
}

async function xlsxSource() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = 1234.5;
    sheet.getCell('A1').numFmt = '"$"#,##0.00';
    sheet.getCell('B1').value = new Date(Date.UTC(2024, 0, 5));
    sheet.getCell('B1').numFmt = 'yyyy-mm-dd';
    sheet.getCell('C1').value = { formula: 'A1*2', result: 2469 };
    sheet.getCell('D1').value = true;
    sheet.getCell('E1').value = '00123';
    sheet.getCell('F1').value = '42';
    sheet.getCell('G1').value = new Date(Date.UTC(2024, 2, 31, 13, 45, 30));
    sheet.getCell('G1').numFmt = 'dd/mm/yyyy hh:mm';
    sheet.getCell('H1').value = { richText: [{ text: 'gras', font: { bold: true } }, { text: ' normal' }] };
    return workbook.xlsx.writeBuffer();
}

async function openXlsx(bytes) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes));
    return workbook.worksheets[0];
}

test('xlsx keeps types, values and number formats', async () => {
    const { data, bytes } = await resave('xlsx', await xlsxSource());
    assert.equal(data.sheets[0].rows[0].cells[1].text, '2024-01-05');
    const sheet = await openXlsx(bytes);
    assert.equal(sheet.getCell('A1').value, 1234.5);
    assert.equal(sheet.getCell('A1').numFmt, '"$"#,##0.00');
    assert.deepEqual(sheet.getCell('B1').value, new Date(Date.UTC(2024, 0, 5)));
    assert.equal(sheet.getCell('B1').numFmt, 'yyyy-mm-dd');
    assert.equal(sheet.getCell('C1').value.formula, 'A1*2');
    assert.equal(sheet.getCell('D1').value, true);
    assert.equal(sheet.getCell('E1').value, '00123');
    assert.equal(sheet.getCell('F1').value, '42');
    assert.deepEqual(sheet.getCell('G1').value, new Date(Date.UTC(2024, 2, 31, 13, 45, 30)));
    assert.equal(sheet.getCell('H1').value.richText.length, 2);
});

test('xlsx cells that were edited take the new value', async () => {
    const { bytes } = await resave('xlsx', await xlsxSource(), (rows) => {
        rows[0].cells[1].text = '2025-12-24';
        rows[0].cells[3].text = 'false';
        rows[0].cells[5].text = '43';
    });
    const sheet = await openXlsx(bytes);
    assert.deepEqual(sheet.getCell('B1').value, new Date(Date.UTC(2025, 11, 24)));
    assert.equal(sheet.getCell('D1').value, false);
    assert.equal(sheet.getCell('F1').value, 43);
});

function legacySource(bookType) {
    const sheet = {
        A1: { t: 'n', v: 1234.5, z: '"$"#,##0.00' },
        B1: { t: 'n', v: 45296, z: 'yyyy-mm-dd' },
        C1: { t: 'b', v: true },
        D1: { t: 's', v: '00123' },
        E1: { t: 's', v: '42' },
        F1: { t: 'n', v: 2469, f: 'A1*2' },
        '!ref': 'A1:F2',
        A2: { t: 's', v: 'fusion' },
        '!merges': [XLSX.utils.decode_range('A2:C2')],
    };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'S');
    return XLSX.write(workbook, { bookType, type: 'array' });
}

for (const bookType of ['xls', 'ods']) {
    test(`${bookType} keeps numbers, dates, booleans, strings and merges`, async () => {
        const { bytes } = await resave(bookType, legacySource(bookType));
        const workbook = XLSX.read(bytes, { type: 'array', cellNF: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        assert.deepEqual([sheet.A1.t, sheet.A1.v], ['n', 1234.5]);
        assert.deepEqual([sheet.B1.t, sheet.B1.v], ['n', 45296]);
        assert.deepEqual([sheet.C1.t, sheet.C1.v], ['b', true]);
        assert.deepEqual([sheet.D1.t, sheet.D1.v], ['s', '00123']);
        assert.deepEqual([sheet.E1.t, sheet.E1.v], ['s', '42']);
        assert.deepEqual([sheet.F1.t, sheet.F1.v], ['n', 2469]);
        assert.equal(XLSX.utils.encode_range(sheet['!merges'][0]), 'A2:C2');
    });
}

const windows1252 = Buffer.from('nom;ville\r\nRené;Évry à côté\r\nprix;12 \x80\r\n', 'latin1');

test('windows-1252 CSV is read and written without loss', async () => {
    const encoding = detectCsvEncoding(toArrayBuffer(windows1252), 'fr');
    assert.equal(encoding, 'windows-1252');
    const { data, bytes, fallback } = await resave('csv', windows1252, undefined, encoding);
    assert.equal(data.sheets[0].rows[1].cells[1].text, 'Évry à côté');
    assert.equal(data.sheets[0].rows[2].cells[1].text, '12 €');
    assert.equal(fallback, false);
    assert.equal(Buffer.from(bytes).toString('latin1').trim(), windows1252.toString('latin1').replaceAll('\r', '').trim());
});

test('CSV switches to UTF-8 rather than replacing characters', async () => {
    const { bytes, fallback } = await resave('csv', windows1252, (rows) => {
        rows[1].cells[0].text = 'Łukasz 中';
    }, 'windows-1252');
    assert.equal(fallback, true);
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(new TextDecoder().decode(bytes), /Łukasz 中;Évry à côté/);
});

test('CSV keeps its UTF-8 byte order mark', async () => {
    const source = Buffer.from('﻿a;é\n1;2\n', 'utf8');
    const encoding = detectCsvEncoding(toArrayBuffer(source), 'fr');
    const { bytes } = await resave('csv', source, undefined, encoding);
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('GBK is only assumed for Chinese users', () => {
    const gbk = toArrayBuffer([0xd6, 0xd0, 0xce, 0xc4]);
    assert.equal(detectCsvEncoding(gbk, 'zh-CN'), 'gbk');
    assert.equal(detectCsvEncoding(gbk, 'fr'), 'windows-1252');
});
