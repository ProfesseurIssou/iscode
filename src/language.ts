/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";
import * as path from "path";
import { LanguageJson } from "./types";
import { SourceHeader, parseHeader, pickVersion } from "./grammar";

/*Compat : parseHeader reste exposé par language.ts (extension, CLI, tests historiques)*/
export { SourceHeader, parseHeader };

export interface ResolvedFile {
    grammar: LanguageJson,
    header: SourceHeader,
    warning?: string
}

/*Liste les versions disponibles pour un niveau (convert/<niveau>/v<N>.json), triées*/
export function listVersions(extensionPath: string, level: string): Array<number> {
    const dir = path.join(extensionPath, "convert", level);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map((file) => file.match(/^v(\d+)\.json$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => parseInt(match[1], 10))
        .sort((a, b) => a - b);
}

/*Charge une grammaire : version demandée, ou la plus récente si absente*/
export function loadGrammar(extensionPath: string, level: string, version?: number): LanguageJson {
    const versions = listVersions(extensionPath, level);
    if (versions.length === 0) throw new Error("Niveau ISCode inconnu : " + level);

    const usedVersion = pickVersion(versions, version).version;
    const filePath = path.join(extensionPath, "convert", level, "v" + usedVersion + ".json");
    return JSON.parse(fs.readFileSync(filePath, { encoding: "utf8", flag: "r" }));
}

/*Résout quelle grammaire utiliser pour un fichier source :
  - niveau : en-tête "#! iscode-level", sinon extension du fichier
  - version : en-tête "#! iscode-version", sinon la plus récente (rétro-compatible avec les fichiers sans en-tête)*/
export function resolveForFile(extensionPath: string, fileName: string, content: string): ResolvedFile {
    const fileNameParts = fileName.split(".");
    const fileExtension = fileNameParts[fileNameParts.length - 1];

    const header = parseHeader(content);
    const level = header.level || fileExtension;

    const versions = listVersions(extensionPath, level);
    if (versions.length === 0) throw new Error("Fichier non compatible : aucun niveau ISCode nommé '" + level + "'");

    const picked = pickVersion(versions, header.version, level);
    return { grammar: loadGrammar(extensionPath, level, picked.version), header, warning: picked.warning };
}
