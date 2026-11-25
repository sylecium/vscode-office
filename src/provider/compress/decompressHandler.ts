import { Handler } from "@/common/handler";
import { randomUUID } from "crypto";
import { rm } from "fs";
import { tmpdir } from "os";
import { Uri, commands } from "vscode";

export function handlerCommonDecompress(uri: Uri, handler: Handler) {
    const decompressPath = `${tmpdir()}/officeViewer-decompress-${randomUUID()}`;
    handler
        .on('showInExplorer', () => {
            commands.executeCommand('revealFileInOS', uri);
        }).on('dispose', () => {
            rm(decompressPath, { recursive: true, force: true }, () => { });
        });

    return decompressPath;
}
