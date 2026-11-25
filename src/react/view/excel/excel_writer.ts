import ExcelJS from '@cweijan/exceljs';
import JSZip from 'jszip';
import { handler } from "../../util/vscode";
import * as XLSX from 'xlsx';
import Spreadsheet from './x-spreadsheet/index';
import type { CellData, RowData, SheetData } from './x-spreadsheet/index';
import { CsvEncoding, encodeCsvText } from './csvEncoding';
import { DEFAULT_ROW_HEIGHT_PX, freezeExprToExcelView, pxToExcelRowHeight } from './excel_meta';
import { patchWorksheetSortStateXml } from './excel_sort_state';
import { applySpreadsheetStyle } from './excel_styles';
import { hyperlinkKey, writeCellHyperlink, type SpreadsheetHyperlink } from './excel_hyperlink';
import { writeWorksheetValidations } from './excel_validation';
import { writeWorksheetProtection } from './excel_protection';
import { writeWorksheetImages } from './excel_images';
import { dateToSerial, isNumberText, parseDateText } from './excel_source';

const DEFAULT_COL_WIDTH = 100;

export { buildFormattingSnapshot, hasFormattingChanged } from './excel_meta';

export interface ExportOptions {
    /** 通过另存为对话框保存，而非覆盖当前文件 */
    saveAs?: boolean;
    /** saveAs 时指定目标格式 */
    saveAsExt?: string;
}

function isRowData(row: RowData | number | undefined): row is RowData {
    return row != null && typeof row === 'object';
}

function getColWidth(cols: SheetData['cols'], ci: number) {
    const col = cols?.[ci];
    if (col && typeof col === 'object' && col.width != null) return col.width;
    return DEFAULT_COL_WIDTH;
}

function pxToExcelColWidth(px: number) {
    return Math.max((px - 5) / 7, 0);
}

function setCellValue(cell: ExcelJS.Cell, cellData: CellData) {
    const text = cellData.text ?? '';
    const source = cellData.source;
    if (source && source.text === text && !source.formula) {
        cell.value = source.date ? new Date(source.value as number) : source.value as ExcelJS.CellValue;
        return;
    }
    const editedDate = source?.date ? parseDateText(text) : undefined;
    if (editedDate) {
        cell.value = editedDate;
        return;
    }
    if (typeof source?.value === 'boolean' && /^(true|false)$/i.test(text)) {
        cell.value = text.toLowerCase() === 'true';
        return;
    }
    if (!text) {
        cell.value = null;
        return;
    }
    if (text.startsWith('=')) {
        cell.value = { formula: text.slice(1) };
        return;
    }
    if (isNumberText(text)) {
        cell.value = Number(text);
        return;
    }
    cell.value = text;
}

function applySheetMeta(worksheet: ExcelJS.Worksheet, sheetData: SheetData) {
    if (sheetData.freeze) {
        const frozen = freezeExprToExcelView(sheetData.freeze);
        if (frozen) {
            worksheet.views = [{
                state: 'frozen',
                xSplit: frozen.xSplit,
                ySplit: frozen.ySplit,
                topLeftCell: sheetData.freeze,
            }];
        }
    }

    const autofilter = sheetData.autofilter;
    if (autofilter?.ref) {
        worksheet.autoFilter = autofilter.ref;
    }
}

function writeRowHeights(worksheet: ExcelJS.Worksheet, rows: SheetData['rows']) {
    if (!rows?.len) return;
    for (let ri = 0; ri < rows.len; ri += 1) {
        const row = rows[ri];
        if (!isRowData(row) || row.height == null) continue;
        if (Math.abs(row.height - DEFAULT_ROW_HEIGHT_PX) < 1) continue;
        worksheet.getRow(ri + 1).height = pxToExcelRowHeight(row.height);
    }
}

async function writeSheetToExcelJs(worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, sheetData: SheetData) {
    const { rows, cols, styles = [], merges = [], hyperlinks = {}, validations } = sheetData;

    if (cols?.len) {
        for (let ci = 0; ci < cols.len; ci += 1) {
            worksheet.getColumn(ci + 1).width = pxToExcelColWidth(getColWidth(cols, ci));
        }
    }

    for (let i = 0; i < merges.length; i += 1) {
        worksheet.mergeCells(merges[i]);
    }

    applySheetMeta(worksheet, sheetData);
    writeRowHeights(worksheet, rows);
    writeWorksheetValidations(worksheet, validations);

    if (!rows) return;

    const rowLen = rows.len ?? 0;
    for (let ri = 0; ri < rowLen; ri += 1) {
        const row = rows[ri];
        if (!isRowData(row) || !row.cells) continue;
        for (const ciKey of Object.keys(row.cells)) {
            const ci = Number(ciKey);
            if (Number.isNaN(ci)) continue;
            const cellData = row.cells[ci];
            const excelCell = worksheet.getCell(ri + 1, ci + 1);
            const hl = hyperlinks[hyperlinkKey(ri, ci)] as SpreadsheetHyperlink | undefined;
            if (hl?.link) {
                writeCellHyperlink(excelCell, cellData.text ?? '', hl);
            } else {
                setCellValue(excelCell, cellData);
            }
            const style = cellData.style != null ? styles[cellData.style] : undefined;
            if (style) {
                applySpreadsheetStyle(excelCell, style);
            }
            // Unless the user picked another format, keep the exact one of the file.
            if (cellData.numFmt && cellData.numFmtFormat === style?.format) {
                excelCell.numFmt = cellData.numFmt;
            }
        }
    }

    writeWorksheetImages(worksheet, workbook, sheetData.images, sheetData.backgroundImage);
    await writeWorksheetProtection(worksheet, sheetData);
}

async function emitSave(buffer: Uint8Array, options?: ExportOptions) {
    const content = [...buffer];
    if (options?.saveAs) {
        handler.emit('saveAs', { content, ext: options.saveAsExt ?? 'xlsx' });
        return;
    }
    handler.emit('save', content);
}

async function patchWorkbookSortStates(buffer: Uint8Array, sheets: SheetData[]) {
    const zip = await JSZip.loadAsync(buffer);
    for (let i = 0; i < sheets.length; i += 1) {
        const file = zip.file(`xl/worksheets/sheet${i + 1}.xml`);
        if (!file) continue;
        const xml = await file.async('string');
        zip.file(`xl/worksheets/sheet${i + 1}.xml`, patchWorksheetSortStateXml(xml, sheets[i].autofilter));
    }
    return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function exportWithExcelJs(sheets: SheetData[], options?: ExportOptions) {
    const workbook = new ExcelJS.Workbook();
    for (let i = 0; i < sheets.length; i += 1) {
        const sheetData = sheets[i];
        const worksheet = workbook.addWorksheet(sheetData.name || `Sheet${i + 1}`);
        await writeSheetToExcelJs(worksheet, workbook, sheetData);
    }
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const patched = await patchWorkbookSortStates(buffer, sheets);
    await emitSave(patched, options);
}

function applyColWidths(ws: XLSX.WorkSheet, xws: SheetData) {
    const cols = xws.cols;
    if (!cols?.len) return;
    const colWidths = [];
    for (let ci = 0; ci < cols.len; ci += 1) {
        colWidths.push({ wpx: getColWidth(cols, ci) });
    }
    ws['!cols'] = colWidths;
}

/** Typed cell for the xls and ods writers. */
function toSheetJsCell(cellData: CellData): XLSX.CellObject | undefined {
    const text = cellData.text ?? '';
    const source = cellData.source;
    const format = cellData.numFmt ? { z: cellData.numFmt } : {};
    if (source && source.text === text) {
        if (source.formula) return { t: source.type ?? 'n', v: source.value as number, f: source.formula, ...format };
        // Sources read from xlsx have no SheetJS type.
        if (source.date) {
            const v = source.type ? source.value as number : dateToSerial(new Date(source.value as number));
            return { t: 'n', v, z: cellData.numFmt ?? 'yyyy-mm-dd' };
        }
        if (source.type) return { t: source.type, v: source.value as string, ...format };
        if (typeof source.value === 'boolean') return { t: 'b', v: source.value };
    }
    if (!text) return undefined;
    if (text.startsWith('=')) return { t: 'n', v: 0, f: text.slice(1), ...format };
    const editedDate = source?.date ? parseDateText(text) : undefined;
    if (editedDate) return { t: 'n', v: dateToSerial(editedDate), z: cellData.numFmt ?? 'yyyy-mm-dd' };
    // A string read from the file stays a string, even if it looks like a number.
    if (isNumberText(text) && source?.text !== text) return { t: 'n', v: Number(text), ...format };
    return { t: 's', v: text };
}

function forEachCell(xws: SheetData, visit: (ri: number, ci: number, cell: CellData) => void) {
    const rows = xws.rows;
    for (let ri = 0; ri < (rows?.len ?? 0); ri += 1) {
        const row = rows[ri];
        if (!isRowData(row)) continue;
        for (const ciKey of Object.keys(row.cells ?? {})) {
            const ci = Number(ciKey);
            if (!Number.isNaN(ci)) visit(ri, ci, row.cells[ci]);
        }
    }
}

function dataToSheetJs(xws: SheetData) {
    const ws: XLSX.WorkSheet = {};
    let maxRow = 0;
    let maxCol = 0;
    forEachCell(xws, (ri, ci, cellData) => {
        const cell = toSheetJsCell(cellData);
        if (!cell) return;
        ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = cell;
        maxRow = Math.max(maxRow, ri);
        maxCol = Math.max(maxCol, ci);
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
    if (xws.merges?.length) ws['!merges'] = xws.merges.map((merge) => XLSX.utils.decode_range(merge));
    applyColWidths(ws, xws);
    return ws;
}

/** CSV and TSV store the grid text as it is. */
function dataToDelimitedText(xws: SheetData, delimiter: string) {
    const aoa: string[][] = [];
    forEachCell(xws, (ri, ci, cellData) => {
        (aoa[ri] ??= [])[ci] = cellData.text;
    });
    const rows = Array.from(aoa, (row) => row ?? []);
    return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows), { FS: delimiter });
}

function exportWithSheetJs(sheets: SheetData[], bookType: XLSX.BookType) {
    const workbook = XLSX.utils.book_new();
    for (let i = 0; i < sheets.length; i += 1) {
        const sheetData = sheets[i];
        XLSX.utils.book_append_sheet(workbook, dataToSheetJs(sheetData), sheetData.name || `Sheet${i + 1}`);
    }
    const buffer = XLSX.write(workbook, { bookType, type: 'array' });
    handler.emit('save', [...new Uint8Array(buffer)]);
}

export async function exportSaveAs(
    spreadSheet: Spreadsheet,
    targetExt: string,
    csvEncoding: CsvEncoding = 'utf8',
    csvDelimiter: string = ',',
): Promise<boolean> {
    const ext = targetExt.replace('.', '').toLowerCase();
    const sheets = spreadSheet.getData();
    if (ext === 'xlsx' || ext === 'xlsm') {
        await exportWithExcelJs(sheets, { saveAs: true, saveAsExt: ext });
        return false;
    }
    if (ext === 'xls' || ext === 'ods') {
        const wb = XLSX.utils.book_new();
        sheets.forEach((s, i) => {
            const ws = dataToSheetJs(s);
            XLSX.utils.book_append_sheet(wb, ws, s.name || `Sheet${i + 1}`);
        });
        const buf = XLSX.write(wb, { bookType: ext as XLSX.BookType, type: 'array' });
        handler.emit('saveAs', { content: [...new Uint8Array(buf)], ext });
        return false;
    }
    if (ext === 'csv' || ext === 'tsv') {
        const fs = ext === 'tsv' ? '\t' : csvDelimiter;
        const csvContent = dataToDelimitedText(sheets[0], fs);
        const { bytes, fallback } = encodeCsvText(csvContent, csvEncoding);
        handler.emit('saveAs', { content: [...bytes], ext });
        return fallback;
    }
    return false;
}

export async function export_xlsx(
    spreadSheet: Spreadsheet,
    extName: string,
    csvEncoding: CsvEncoding = 'utf8',
    options?: ExportOptions,
    csvDelimiter: string = ',',
): Promise<boolean> {
    const ext = extName.replace('.', '').toLowerCase();
    const sheets = spreadSheet.getData();

    if (ext === 'xlsx' || ext === 'xlsm' || options?.saveAs) {
        await exportWithExcelJs(sheets, options?.saveAs ? { saveAs: true } : undefined);
        return false;
    }
    if (ext === 'xls' || ext === 'ods') {
        exportWithSheetJs(sheets, ext);
        return false;
    }
    if (ext === 'csv' || ext === 'tsv') {
        const fs = ext === 'tsv' ? '\t' : csvDelimiter;
        const csvContent = dataToDelimitedText(sheets[0], fs);
        const { bytes, fallback } = encodeCsvText(csvContent, csvEncoding);
        handler.emit('save', [...bytes]);
        return fallback;
    }
    return false;
}
