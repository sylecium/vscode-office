export type DiffRole = 'original' | 'modified' | 'changed';

export interface DiffUri {
    scheme: string;
    query: string;
}

/** A git ref, `null` for the working copy, `undefined` when the query cannot be read. */
type Ref = string | null | undefined;

const refOf = (uri: DiffUri): Ref => {
    if (uri.scheme !== 'git') return null;
    const ref = JSON.parse(uri.query).ref;
    return typeof ref === 'string' ? ref : undefined;
};

/** True when `a` is certainly the original side against `b`. */
const isOlder = (a: Ref, b: Ref): boolean => {
    if (typeof a !== 'string' && a !== null) return false;
    if (typeof b !== 'string' && b !== null) return false;
    if (a === null) return false;
    if (b === null) return true;
    if (a === '~' && b !== '~') return true;
    if (a === 'HEAD' && b === '') return true;
    return b !== '' && (a === `${b}^` || a === `${b}^1` || a === `${b}~1`);
};

export function diffRole(own: DiffUri, other: DiffUri): DiffRole {
    let ownRef: Ref;
    let otherRef: Ref;
    try {
        ownRef = refOf(own);
        otherRef = refOf(other);
    } catch {
        return 'changed';
    }
    if (isOlder(ownRef, otherRef)) return 'original';
    if (isOlder(otherRef, ownRef)) return 'modified';
    return 'changed';
}
