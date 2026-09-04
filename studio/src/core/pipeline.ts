import { AstNode, LanguageJson, ParseError, SourceMap, TargetDef } from "../../../src/types";
import * as parser from "../../../src/parser";
import * as passes from "../../../src/passes";
import * as render from "../../../src/render";

export interface TranslateResult {
	text: string,
	map: SourceMap,
	nodes: Array<AstNode>,
	errors: Array<ParseError>,          /*lignes sources non reconnues (non bloquantes)*/
	renderError?: string                /*erreur de rendu (ex : op sans traduction pour la cible), sans casser l'UI*/
}

export interface ResolvedTarget {
	targetName: string,
	targetDef: TargetDef,
	renderTarget: string,               /*clé de rendu : targetDef.target || targetName*/
	outputGrammar: LanguageJson,        /*grammaire de rendu : celle du niveau cible si targetDef.grammar, sinon la source*/
	emitHeader: boolean
}

/*Résout une cible de traduction : grammaire de sortie et clé de rendu.
	getGrammar charge la grammaire d'un niveau (provider) quand la cible rend via une autre grammaire.*/
export function resolveTarget(grammar: LanguageJson, targetName: string, getGrammar: (level: string) => LanguageJson | undefined): ResolvedTarget {
	const targetDef = grammar.availableTranslation[targetName];
	if (!targetDef) throw new Error("Unknown target '" + targetName + "' for " + grammar.name);

	let outputGrammar = grammar;
	if (targetDef.grammar) {
		const loaded = getGrammar(targetDef.grammar);
		if (!loaded) throw new Error("Output grammar '" + targetDef.grammar + "' is not available in the registry");
		outputGrammar = loaded;
	}
	return {
		targetName,
		targetDef,
		renderTarget: targetDef.target || targetName,
		outputGrammar,
		emitHeader: targetDef.emitHeader === true
	};
}

/*Pipeline complet (identique à l'extension/CLI) : parse -> passes -> rendu.
	Les erreurs de rendu sont renvoyées dans renderError au lieu de lever.*/
export function translate(content: string, fileName: string, grammar: LanguageJson, resolved: ResolvedTarget): TranslateResult {
	const parsed = parser.parse(content, grammar, fileName);
	const nodes = passes.run(grammar, parsed.nodes);

	try {
		const result = render.render(nodes, resolved.outputGrammar, resolved.renderTarget, { emitHeader: resolved.emitHeader });
		return { text: result.text, map: result.map, nodes, errors: parsed.errors };
	} catch (error) {
		return { text: "", map: {}, nodes, errors: parsed.errors, renderError: String(error).replace(/^Error: /, "") };
	}
}

/*Index inverse de la source map : ligne source -> lignes de sortie (triées),
	pour surligner la sortie depuis la position du curseur source.*/
export function buildReverseMap(map: SourceMap): Map<number, Array<number>> {
	const reverse = new Map<number, Array<number>>();
	for (const outputLine of Object.keys(map)) {
		const entry = map[outputLine];
		const list = reverse.get(entry.line);
		if (list) list.push(parseInt(outputLine, 10));
		else reverse.set(entry.line, [parseInt(outputLine, 10)]);
	}
	for (const list of reverse.values()) list.sort((a, b) => a - b);
	return reverse;
}
