/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";
import * as path from "path";
import { LanguageJson } from "./types";

export interface SourceHeader {
    level?: string,
    version?: number
}
export interface ResolvedFile {
    grammar: LanguageJson,
    header: SourceHeader,
    warning?: string
}

/*Lit l'en-tête meta d'un fichier source :
  #! iscode-level: isc1
  #! iscode-version: 1
Les lignes commençant par "#!" sont des meta-lignes, ignorées par le parser.*/
export function parseHeader(content: string): SourceHeader {
    const header: SourceHeader = {};
    const lines = content.replace(/\r\n/g, "\n").split("\n").slice(0, 10);
    for (const line of lines) {
        if (line.indexOf("#!") !== 0) continue;
        const levelMatch = line.match(/^#!\s*iscode-level\s*:\s*(\S+)/);
        if (levelMatch) header.level = levelMatch[1];
        const versionMatch = line.match(/^#!\s*iscode-version\s*:\s*(\d+)/);
        if (versionMatch) header.version = parseInt(versionMatch[1], 10);
    }
    return header;
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

    let usedVersion = version;
    if (usedVersion === undefined || versions.indexOf(usedVersion) < 0) {
        usedVersion = versions[versions.length - 1];
    }

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

    let warning: string | undefined = undefined;
    let version = header.version;
    if (version !== undefined && versions.indexOf(version) < 0) {
        warning = "ISCode " + level + " v" + version + " inconnue, traduction avec v" + versions[versions.length - 1];
        version = undefined;
    }

    return { grammar: loadGrammar(extensionPath, level, version), header, warning };
}
