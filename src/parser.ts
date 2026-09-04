/* eslint-disable @typescript-eslint/naming-convention */
import { AstNode, LanguageJson, ParseError, ParseResult } from "./types";

interface CompiledInstruction {
    name: string,
    regex: RegExp,
    ast: { [key: string]: any }
}

/*Cache des regex compilées, par identité d'objet grammaire :
  - grammaires du registry / chargées une fois : le même objet revient, le cache sert ;
  - grammaires éditées (drafts du Studio, convert/ modifié pendant une session) :
    un objet différent à chaque édition -> recompilation, jamais de regex périmée.*/
const compiledCache = new WeakMap<LanguageJson, Array<CompiledInstruction>>();

/*Construit une regex par instruction : chaque token de "syntax" devient un groupe de capture*/
function compileGrammar(grammar: LanguageJson): Array<CompiledInstruction> {
	const cached = compiledCache.get(grammar);
	if (cached) return cached;

    const compiled: Array<CompiledInstruction> = [];
    for (const instructionName of Object.keys(grammar.instructions)) {
        const instruction = grammar.instructions[instructionName];

        let regexSource = "";
        for (const tokenName of instruction.syntax) {
            const token = grammar.tokens[tokenName];
            if (token === undefined) throw new Error("Token manquant '" + tokenName + "' (instruction " + instructionName + ", niveau " + grammar.name + " v" + grammar.version + ")");
            regexSource += "(" + token + ")";
        }

        if (!instruction.ast || typeof instruction.ast !== "object" || !instruction.ast.op) {
            throw new Error("Template 'ast' invalide pour l'instruction " + instructionName + " (niveau " + grammar.name + ")");
        }

        compiled.push({ name: instructionName, regex: new RegExp(regexSource), ast: instruction.ast });
    }

    compiledCache.set(grammar, compiled);
    return compiled;
}

/*Remplace les placeholders %{n} du template "ast" par les captures de la regex*/
function resolveAstTemplate(template: any, match: RegExpExecArray): any {
    if (typeof template === "string") {
        return template.replace(/%\{(\d+)\}/g, (_full, groupIndex) => {
            const value = match[parseInt(groupIndex, 10)];
            return value === undefined ? "" : value;
        });
    }
    if (Array.isArray(template)) return template.map((item) => resolveAstTemplate(item, match));
    if (template !== null && typeof template === "object") {
        const resolved: { [key: string]: any } = {};
        for (const key of Object.keys(template)) resolved[key] = resolveAstTemplate(template[key], match);
        return resolved;
    }
    return template;
}

/*Parse le fichier source ligne par ligne : chaque ligne reconnue devient un noeud d'AST portant son origine.
Les lignes meta ("#!...") sont ignorées ; les lignes non reconnues sont remontées dans errors.*/
export function parse(content: string, grammar: LanguageJson, fileName: string): ParseResult {
    const compiled = compileGrammar(grammar);

    const nodes: Array<AstNode> = [];
    const errors: Array<ParseError> = [];

    const lines = content.replace(/\r\n/g, "\n").split("\n");
    lines.forEach((line, lineIndex) => {
        if (line.indexOf("#!") === 0) return; /*meta-ligne d'en-tête*/

        for (const instruction of compiled) {
            const match = instruction.regex.exec(line);
            if (!match) continue;

            const node: AstNode = resolveAstTemplate(instruction.ast, match);
            node._indent = line.match(/^[ ]*/)![0];
            node._instruction = instruction.name;
            node.origin = { file: fileName, line: lineIndex + 1, level: grammar.name, version: grammar.version };
            nodes.push(node);
            return; /*la première instruction qui matche gagne*/
        }

        errors.push({ line: lineIndex + 1, text: line });
    });

    return { nodes, errors };
}
