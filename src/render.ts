/* eslint-disable @typescript-eslint/naming-convention */
import { AstNode, LanguageJson, Origin, RenderResult, SourceMap } from "./types";

interface RenderedLine {
    text: string,
    origin?: Origin
}

/*Remplace les placeholders %{champ} par les champs du noeud d'AST (dst, src, value...).*/
function resolvePlaceholders(text: string, node: AstNode): string {
    return text.replace(/%\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, field) => {
        const value = node[field];
        return value === undefined || value === null ? "" : String(value);
    });
}

/*Rend un AST en texte, pour une grammaire et une cible de rendu données.
- Chaque instruction peut émettre plusieurs lignes réparties dans des zones (head/body/tail...).
- Les zones sont assemblées dans l'ordre déclaré par renderZoneOrder, séparées par une ligne vide.
- En zone "body", l'indentation d'origine du noeud est réappliquée.
- Chaque ligne de sortie est tracée dans la source map vers sa ligne d'origine.*/
export function render(nodes: Array<AstNode>, grammar: LanguageJson, target: string, options?: { emitHeader?: boolean }): RenderResult {
    const zoneOrder = grammar.renderZoneOrder || ["head", "body", "tail"];
    const zoneLines: { [zone: string]: Array<RenderedLine> } = {};

    /*Index op -> instruction, pour les noeuds générés par les passes (qui n'ont pas de _instruction).
      Plusieurs instructions peuvent partager le même op (defineByte/defineWord... -> "define"),
      la dernière déclarée gagne ; les noeuds parsés, eux, utilisent leur instruction d'origine.*/
    const opIndex: { [op: string]: any } = {};
    for (const instructionName of Object.keys(grammar.instructions)) {
        const instruction = grammar.instructions[instructionName];
        if (instruction.ast && instruction.ast.op) opIndex[instruction.ast.op] = instruction;
    }

    for (const node of nodes) {
        const instruction = (node._instruction && grammar.instructions[node._instruction]) || opIndex[node.op];
        const entries = instruction ? instruction.translation[target] : undefined;
        if (!entries) {
            throw new Error("Pas de rendu '" + target + "' pour l'instruction '" + node.op + "' (grammaire " + grammar.name + " v" + grammar.version + ")");
        }

        for (const entry of entries) {
            const rawLines = Array.isArray(entry.line) ? entry.line : [entry.line];
            for (const rawLine of rawLines) {
                let text = resolvePlaceholders(rawLine, node);
                if (entry.zone === "body") text = (node._indent || "") + text;
                if (!zoneLines[entry.zone]) zoneLines[entry.zone] = [];
                zoneLines[entry.zone].push({ text, origin: node.origin });
            }
        }
    }

    /*Assemblage final dans l'ordre des zones, numérotation des lignes et remplissage de la source map*/
    const outputLines: Array<string> = [];
    const map: SourceMap = {};

    const addOutputLine = (text: string, origin?: Origin) => {
        outputLines.push(text);
        if (origin) {
            map[String(outputLines.length)] = {
                file: origin.file,
                level: origin.level,
                version: origin.version,
                line: origin.line
            };
        }
    };

    if (options && options.emitHeader) {
        addOutputLine("#! iscode-level: " + grammar.name);
        addOutputLine("#! iscode-version: " + grammar.version);
    }

    zoneOrder.forEach((zone, zoneIndex) => {
        const lines = zoneLines[zone] || [];
        if (lines.length === 0) return;
        if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== "") addOutputLine("");
        for (const renderedLine of lines) addOutputLine(renderedLine.text, renderedLine.origin);
    });

    while (outputLines.length > 0 && outputLines[outputLines.length - 1] === "") outputLines.pop();

    return { text: outputLines.join("\n") + "\n", map };
}
