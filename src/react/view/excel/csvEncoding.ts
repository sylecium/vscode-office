import iconv from 'iconv-lite';

export type CsvEncoding = 'utf8' | 'utf8bom' | 'windows-1252' | 'gbk';

const UTF8_BOM = [0xef, 0xbb, 0xbf];

const hasUtf8Bom = (bytes: Uint8Array) => UTF8_BOM.every((byte, i) => bytes[i] === byte);

function canDecode(encoding: string, bytes: Uint8Array): boolean {
    try {
        new TextDecoder(encoding, { fatal: true }).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

export function isValidUtf8(buffer: ArrayBuffer): boolean {
    return canDecode('utf-8', new Uint8Array(buffer));
}

let windows1252: { chars: string[]; bytes: Map<string, number> } | undefined;

/** One character per byte in both directions, so saving never alters untouched bytes. */
function windows1252Table() {
    if (!windows1252) {
        const decoder = new TextDecoder('windows-1252');
        const chars = Array.from({ length: 256 }, (_, byte) => decoder.decode(new Uint8Array([byte])));
        windows1252 = { chars, bytes: new Map(chars.map((char, byte) => [char, byte])) };
    }
    return windows1252;
}

/**
 * Most 8-bit text also looks like valid GBK, so GBK is only assumed for Chinese users.
 * Otherwise windows-1252, the encoding of Excel CSV exports in Western Europe.
 */
export function detectCsvEncoding(buffer: ArrayBuffer, language = globalThis.navigator?.language ?? ''): CsvEncoding {
    const bytes = new Uint8Array(buffer);
    if (hasUtf8Bom(bytes)) return 'utf8bom';
    if (isValidUtf8(buffer)) return 'utf8';
    return language.toLowerCase().startsWith('zh') && canDecode('gbk', bytes) ? 'gbk' : 'windows-1252';
}

export function decodeCsvBuffer(buffer: ArrayBuffer): string {
    const encoding = detectCsvEncoding(buffer);
    const bytes = new Uint8Array(buffer);
    if (encoding === 'gbk') return iconv.decode(bytes as Buffer, 'gbk');
    if (encoding === 'windows-1252') {
        const { chars } = windows1252Table();
        return Array.from(bytes, (byte) => chars[byte]).join('');
    }
    return new TextDecoder('utf-8').decode(encoding === 'utf8bom' ? bytes.subarray(3) : bytes);
}

/** `fallback` is true when the text did not fit the requested encoding and was written as UTF-8. */
export function encodeCsvText(text: string, encoding: CsvEncoding): { bytes: Uint8Array; fallback: boolean } {
    if (encoding === 'gbk') {
        const encoded = iconv.encode(text, 'gbk');
        if (iconv.decode(encoded, 'gbk') === text) return { bytes: new Uint8Array(encoded), fallback: false };
    }
    if (encoding === 'windows-1252') {
        const { bytes } = windows1252Table();
        const encoded = Array.from(text, (char) => bytes.get(char));
        if (encoded.every((byte) => byte !== undefined)) return { bytes: new Uint8Array(encoded), fallback: false };
    }
    const utf8 = new TextEncoder().encode(text);
    // The BOM tells Excel that a file which was not plain UTF-8 now is.
    const bom = encoding !== 'utf8';
    return {
        bytes: bom ? new Uint8Array([...UTF8_BOM, ...utf8]) : utf8,
        fallback: encoding === 'gbk' || encoding === 'windows-1252',
    };
}
