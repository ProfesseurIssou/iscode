import { LanguageJson } from "../../../src/types";

export interface ValidationIssue {
	severity: "error" | "warning",
	message: string,
	path: string                            /*ex : "instructions.assign.syntax[2]"*/
}

/*Matérialise une ligne d'exemple depuis le snippet vscode/monaco d'une instruction :
	"${1|8,16,32,64|}" -> premier choix ; "${1}" / "$1" -> valeur générique.
	Retourne null si le snippet est vide. Best effort : sert à tester le masquage
	et à générer un fichier d'exemple, pas à être exact syntaxiquement.*/
export function sampleLine(snippetOutput: string): string | null {
	if (!snippetOutput) return null;
	let line = snippetOutput.replace(/\$\{\d+\|([^}]*)\}/g, (_full, choices: string) => {
		const first = String(choices).split(",")[0].trim();
		return first.length > 0 ? first : "sample";
	});
	line = line.replace(/\$\{?\d+\}?/g, "sample");
	return line;
}

/*Génère un contenu d'exemple pour une grammaire : en-tête de version + une ligne
	par instruction qui a un snippet (dans l'ordre de déclaration).
	La ligne de commentaire n'est émise que si la grammaire sait parser les commentaires,
	et pas de ligne vide finale : l'exemple doit être 100% reconnu par la grammaire,
	même pour un draft minimal sans instruction emptyLine/commentLine.*/
export function buildExampleContent(grammar: LanguageJson): string {
	const lines: Array<string> = [
		"#! iscode-level: " + grammar.name,
		"#! iscode-version: " + grammar.version
	];
	const hasComment = Object.values(grammar.instructions || {}).some((instruction) => instruction.ast && instruction.ast.op === "comment");
	if (hasComment) lines.push("// Generated example for " + grammar.name + " v" + grammar.version);
	for (const instruction of Object.values(grammar.instructions || {})) {
		if (!instruction.snippet) continue;
		const sample = sampleLine(instruction.snippet.output);
		if (sample !== null) lines.push(sample);
	}
	return lines.join("\n");
}

/*Compile la regex d'une instruction (même construction que le parser). Retourne null si invalide.*/
function compileInstructionRegex(grammar: LanguageJson, syntax: Array<string>): RegExp | null {
	let regexSource = "";
	for (const tokenName of syntax) {
		const token = (grammar.tokens || {})[tokenName];
		if (token === undefined) return null;
		regexSource += "(" + token + ")";
	}
	try {
		return new RegExp(regexSource);
	} catch {
		return null;
	}
}

function tokenRegex(grammar: LanguageJson, tokenName: string): string | undefined {
	return (grammar.tokens || {})[tokenName];
}

/*Valide une grammaire (draft du Language Studio ou grammaire du registry) :
	1. structure minimale (name, version, tokens, instructions) ;
	2. chaque instruction : tokens référencés existants, regex compilable, op présent,
	   zones de rendu connues, cibles déclarées couvertes ;
	3. détection de masquage : le parser est "première regex qui matche gagne",
	   une instruction dont la ligne d'exemple est capturée par une instruction
	   déclarée AVANT elle est inatteignable.
	Seules les cibles rendues avec la grammaire elle-même (sans champ "grammar")
	sont contrôlées pour la couverture : les autres rendent via la grammaire du niveau cible.*/
export function validateGrammar(grammar: any): Array<ValidationIssue> {
	const issues: Array<ValidationIssue> = [];
	if (!grammar || typeof grammar !== "object") {
		return [{ severity: "error", message: "Grammar is not a JSON object", path: "$" }];
	}

	if (typeof grammar.name !== "string" || grammar.name.length === 0) {
		issues.push({ severity: "error", message: "Missing or empty 'name'", path: "name" });
	}
	if (typeof grammar.version !== "number") {
		issues.push({ severity: "error", message: "'version' must be a number", path: "version" });
	}
	if (!grammar.tokens || typeof grammar.tokens !== "object") {
		issues.push({ severity: "warning", message: "No 'tokens' defined: no instruction can match", path: "tokens" });
	}
	if (!grammar.instructions || typeof grammar.instructions !== "object") {
		issues.push({ severity: "error", message: "Missing or empty 'instructions'", path: "instructions" });
		return issues;
	}

	const zoneOrder = Array.isArray(grammar.renderZoneOrder) ? grammar.renderZoneOrder : ["head", "body", "tail"];
	const instructionNames = Object.keys(grammar.instructions);

	/*Cibles déclarées : extension + couverture des traductions (cibles sans "grammar" seulement)*/
	for (const [targetName, targetDef] of Object.entries<any>(grammar.availableTranslation || {})) {
		if (!targetDef || typeof targetDef.extension !== "string" || targetDef.extension.length === 0) {
			issues.push({
				severity: "warning",
				message: "Target '" + targetName + "' has no 'extension'",
				path: "availableTranslation." + targetName
			});
		}
	}

	/*Par instruction : tokens, regex, op, zones + collecte des regex compilées dans l'ordre*/
	const compiled: Array<{ name: string, regex: RegExp | null }> = [];
	for (const name of instructionNames) {
		const instruction = grammar.instructions[name];
		const basePath = "instructions." + name;

		if (!Array.isArray(instruction.syntax) || instruction.syntax.length === 0) {
			issues.push({ severity: "error", message: "Missing or empty 'syntax'", path: basePath + ".syntax" });
			compiled.push({ name, regex: null });
			continue;
		}
		const missing = instruction.syntax
			.map((tokenName: string, index: number) => ({ tokenName, index }))
			.filter(({ tokenName }: { tokenName: string }) => tokenRegex(grammar, tokenName) === undefined);
		for (const { tokenName, index } of missing) {
			issues.push({
				severity: "error",
				message: "Token '" + tokenName + "' does not exist",
				path: basePath + ".syntax[" + index + "]"
			});
		}

		const regex = missing.length === 0 ? compileInstructionRegex(grammar, instruction.syntax) : null;
		if (missing.length === 0 && !regex) {
			issues.push({ severity: "error", message: "Syntax regex does not compile", path: basePath + ".syntax" });
		}
		compiled.push({ name, regex });

		if (!instruction.ast || typeof instruction.ast !== "object" || !instruction.ast.op) {
			issues.push({ severity: "error", message: "Missing 'ast.op'", path: basePath + ".ast" });
		}

		for (const [targetName, entries] of Object.entries<any>(instruction.translation || {})) {
			const first = Array.isArray(entries) ? entries[0] : undefined;
			if (first && zoneOrder.indexOf(first.zone) < 0) {
				issues.push({
					severity: "warning",
					message: "Zone '" + first.zone + "' is not in renderZoneOrder " + JSON.stringify(zoneOrder),
					path: basePath + ".translation." + targetName
				});
			}
		}
	}

	/*Couverture : pour chaque cible rendue avec cette grammaire (pas de champ "grammar"),
	  toutes les instructions doivent avoir une traduction non vide — sinon le rendu lève "Pas de rendu".*/
	for (const [targetName, targetDef] of Object.entries<any>(grammar.availableTranslation || {})) {
		if (!targetDef || targetDef.grammar) continue;
		const uncovered = instructionNames.filter((name) => {
			const entries = grammar.instructions[name].translation && grammar.instructions[name].translation[targetName];
			return !entries || entries.length === 0;
		});
		if (uncovered.length > 0) {
			issues.push({
				severity: "error",
				message: "Target '" + targetName + "': " + uncovered.length + " instruction(s) have no translation: " + uncovered.join(", "),
				path: "instructions"
			});
		}
	}

	/*Masquage : ligne d'exemple capturée par une instruction déclarée plus tôt.
	  On ne teste que si l'exemple matche SA PROPRE regex (sinon l'exemple est
	  simplement non représentatif et le test ne dirait rien d'utile).*/
	for (let i = 1; i < compiled.length; i++) {
		const current = compiled[i];
		if (!current.regex) continue;
		const instruction = grammar.instructions[current.name];
		if (!instruction.snippet || !instruction.snippet.output) continue;

		const sample = sampleLine(instruction.snippet.output);
		if (sample === null || !current.regex.test(sample)) continue;

		for (let j = 0; j < i; j++) {
			const earlier = compiled[j];
			if (earlier.regex && earlier.regex.test(sample)) {
				issues.push({
					severity: "error",
					message: "'" + current.name + "' is unreachable: its sample line \"" + sample +
						"\" is matched first by '" + earlier.name + "' (reorder or specialize the syntax)",
					path: "instructions." + current.name
				});
				break;
			}
		}
	}

	return issues;
}
