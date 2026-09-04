/* eslint-disable @typescript-eslint/naming-convention */

/*PARTIES PURES DE LA RESOLUTION DE GRAMMAIRE (aucune dépendance fs/path) :
  réutilisables telles quelles dans le navigateur (ISCode Studio) comme dans Node
  (extension, CLI). Le chargement disque des grammaires reste dans language.ts.*/

export interface SourceHeader {
    level?: string,
    version?: number
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

/*Choisit la version à utiliser parmi les versions disponibles (triées croissant) :
  la version demandée si elle existe, sinon la plus récente — avec un avertissement
  quand une version inconnue était demandée (le fichier reste traduisible).*/
export function pickVersion(available: Array<number>, requested?: number, label?: string): { version: number, warning?: string } {
    const latest = available[available.length - 1];
    if (requested === undefined) return { version: latest };
    if (available.indexOf(requested) >= 0) return { version: requested };
    return {
        version: latest,
        warning: "ISCode " + (label || "") + " v" + requested + " inconnue, traduction avec v" + latest
    };
}
