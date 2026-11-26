// Opening then saving a spreadsheet must not change the type or value of untouched cells.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
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

test('styling a covered cell of a merged range keeps the text and the master style', async () => {
    const sheets = [{
        name: 'S',
        merges: ['A1:B2'],
        styles: [{ bgcolor: '#ff0000' }, { bgcolor: '#0000ff' }],
        rows: {
            len: 2,
            0: { cells: { 0: { text: 'Titre', style: 0 }, 1: { style: 1 } } },
            1: { cells: { 0: { style: 1 }, 1: { style: 1 } } },
        },
    }];
    await export_xlsx({ getData: () => sheets }, 'xlsx');
    const sheet = await openXlsx(saved());
    assert.equal(sheet.getCell('A1').value, 'Titre');
    assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFFF0000');
});

test('cell notes survive a save, rich notes included', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = 'x';
    sheet.getCell('A1').note = 'Remarque';
    sheet.getCell('C1').value = 'riche';
    sheet.getCell('C1').note = { texts: [{ text: 'Gras', font: { bold: true } }, { text: ' fin' }] };
    const { data } = await resave('xlsx', await workbook.xlsx.writeBuffer());
    assert.equal(data.sheets[0].rows[0].cells[0].note, 'Remarque');
    const reopened = await openXlsx(new Uint8Array(saved()));
    assert.equal(reopened.getCell('A1').note, 'Remarque');
    assert.equal(reopened.getCell('C1').note.texts[0].text, 'Gras');
    assert.equal(reopened.getCell('C1').note.texts[0].font.bold, true);
});

test('a cell that holds only a note is written and read back', async () => {
    const sheets = [{ name: 'S', rows: { len: 1, 0: { cells: { 1: { text: '', note: 'Seule' } } } } }];
    await export_xlsx({ getData: () => sheets }, 'xlsx');
    const sheet = await openXlsx(saved());
    assert.equal(sheet.getCell('B1').note, 'Seule');
    const data = await loadSheets(toArrayBuffer(saved()), '.xlsx');
    assert.equal(data.sheets[0].rows[0].cells[1].note, 'Seule');
});

// Moves the notes of an ExcelJS file to the names and targets openpyxl uses, with its plain note text.
async function withOpenpyxlNotes(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    for (const rels of zip.file(/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/)) {
        let xml = await rels.async('string');
        for (const rel of xml.match(/<Relationship\b[^>]*\/>/g) ?? []) {
            const comments = /Target="\.\.\/comments(\d+)\.xml"/.exec(rel);
            const vml = /Target="\.\.\/drawings\/vmlDrawing(\d+)\.vml"/.exec(rel);
            if (!comments && !vml) continue;
            const from = comments ? `xl/comments${comments[1]}.xml` : `xl/drawings/vmlDrawing${vml[1]}.vml`;
            const to = comments ? `xl/comments/comment${comments[1]}.xml` : `xl/drawings/commentsDrawing${vml[1]}.vml`;
            if (comments) {
                const text = (await zip.file(from).async('string')).replace(/<r>(<t[^>]*>[\s\S]*?<\/t>)<\/r>/g, '$1');
                zip.file(to, text);
            } else {
                zip.file(to, await zip.file(from).async('uint8array'));
            }
            zip.remove(from);
            xml = xml.replace(rel, rel.replace(/Target="[^"]*"/, `Target="/${to}"`));
        }
        zip.file(rels.name, xml);
    }
    return zip.generateAsync({ type: 'uint8array' });
}

test('a file with openpyxl notes opens and keeps the note text', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = 'x';
    sheet.getCell('A1').note = 'solo';
    const bytes = await withOpenpyxlNotes(await workbook.xlsx.writeBuffer());
    const data = await loadSheets(toArrayBuffer(bytes), '.xlsx');
    assert.equal(data.sheets[0].rows[0].cells[0].note, 'solo');
});

test('openpyxl notes on the second sheet only stay on their cell', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('A').getCell('A1').value = 'a';
    const second = workbook.addWorksheet('B');
    second.getCell('B2').value = 'b';
    second.getCell('B2').note = 'note 2';
    const bytes = await withOpenpyxlNotes(await workbook.xlsx.writeBuffer());
    const data = await loadSheets(toArrayBuffer(bytes), '.xlsx');
    assert.equal(data.sheets[0].rows[0].cells[0].note, undefined);
    assert.equal(data.sheets[1].rows[1].cells[1].note, 'note 2');
});

// Adds notes on B1 (inside the used range) and on D6 (beyond it) on cells with no value and no style,
// as openpyxl writes them. The sheet is the ExcelJS one, so run text is kept when `run` is set.
async function withEmptyNoteCells(bytes, run) {
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    zip.file('xl/worksheets/sheet1.xml', sheet
        .replace('</row>', '<c r="B1" t="n"></c></row>')
        .replace('</sheetData>', '<row r="6"><c r="D6" t="n"></c></row></sheetData>'));
    const note = (ref, text) => `<comment ref="${ref}" authorId="0"><text>${run ? `<r>${text}</r>` : text}</text></comment>`;
    const comments = await zip.file('xl/comments1.xml').async('string');
    zip.file('xl/comments1.xml', comments.replace('</commentList>',
        `${note('B1', '<t>vide B1</t>')}${note('D6', '<t>vide D6</t>')}</commentList>`));
    return zip.generateAsync({ type: 'uint8array' });
}

async function singleNoteBook() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = 'x';
    sheet.getCell('A1').note = 'solo';
    return workbook.xlsx.writeBuffer();
}

function assertEmptyNotes(data) {
    assert.equal(data.sheets[0].rows[0].cells[0].note, 'solo');
    assert.equal(data.sheets[0].rows[0].cells[1].note, 'vide B1');
    assert.equal(data.sheets[0].rows[0].cells[1].text, '');
    assert.equal(data.sheets[0].rows[5].cells[3].note, 'vide D6');
    assert.equal(data.sheets[0].rows[5].cells[3].text, '');
}

test('openpyxl notes on empty cells, inside and beyond the used range, are kept', async () => {
    const bytes = await withOpenpyxlNotes(await withEmptyNoteCells(await singleNoteBook(), false));
    assertEmptyNotes(await loadSheets(toArrayBuffer(bytes), '.xlsx'));
});

test('notes on empty cells are kept when the parts already have the ExcelJS names', async () => {
    const bytes = await withEmptyNoteCells(await singleNoteBook(), true);
    assertEmptyNotes(await loadSheets(toArrayBuffer(bytes), '.xlsx'));
});

test('covered cells of a merged range keep their own borders', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.mergeCellsWithoutStyle('B3:D4');
    const red = { style: 'thin', color: { argb: 'FFFF0000' } };
    sheet.getCell('B3').border = { top: red, left: red, bottom: red, right: red };
    sheet.getCell('C3').border = { top: { style: 'thin', color: { argb: 'FF0000FF' } } };
    await resave('xlsx', await workbook.xlsx.writeBuffer());
    const reopened = await openXlsx(new Uint8Array(saved()));
    assert.equal(reopened.getCell('B3').border.top.color.argb, 'FFFF0000');
    assert.equal(reopened.getCell('C3').border.top.color.argb, 'FF0000FF');
});

test('a fill on a whole merged range survives two saves', async () => {
    const sheets = [{
        name: 'S',
        merges: ['A1:B2'],
        styles: [{ bgcolor: '#00ff00' }],
        rows: {
            len: 2,
            0: { cells: { 0: { text: 'Titre', style: 0 }, 1: { style: 0 } } },
            1: { cells: { 0: { style: 0 }, 1: { style: 0 } } },
        },
    }];
    await export_xlsx({ getData: () => sheets }, 'xlsx');
    const first = await loadSheets(toArrayBuffer(saved()), '.xlsx');
    await export_xlsx({ getData: () => first.sheets }, 'xlsx');
    const sheet = await openXlsx(new Uint8Array(saved()));
    assert.equal(sheet.getCell('A1').value, 'Titre');
    assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FF00FF00');
    assert.equal(sheet.getCell('B2').fill.fgColor.argb, 'FF00FF00');
});
