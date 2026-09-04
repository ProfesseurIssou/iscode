import { LanguageJson } from "../../../src/types";

/*Forme Monarch minimale (structurelle) : permet de tester la génération sous Node
	sans dépendre de monaco-editor (languages.ts fait le collage Monaco).*/
export type MonarchRule = [RegExp | string, string];
export interface MonarchLanguage {
	ignoreCase?: boolean,
	tokenizer: { [state: string]: Array<MonarchRule> }
}

const REGEX_META = /[\\^$.?*+()[\]{}]/;

/*Un token est "littéral" si sa regex est un mot pur ou une alternance de mots purs
	(ex : "mode", "byte|BYTE", "CONST:") : ces mots deviennent des mots-clés colorés.
	Les tokens génériques (classes de caractères, quantificateurs...) sont ignorés.*/
export function literalAlternatives(regexSource: string): Array<string> | null {
	const trimmed = regexSource.replace(/^\^/, "").replace(/\$$/, "");
	const words: Array<string> = [];
	for (const part of trimmed.split("|")) {
		if (part.length === 0 || REGEX_META.test(part)) return null;
		words.push(part);
	}
	return words.length > 0 ? words : null;
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*Génère un tokenizer Monarch depuis une grammaire :
	- lignes meta "#!" en tête de fichier ;
	- commentaires "//..." et chaînes '...' par convention ISCode ;
	- nombres ;
	- mots-clés = tous les tokens littéraux de la grammaire (insensible à la casse
	  seulement si la grammaire liste explicitement les variantes, d'où ignoreCase false).*/
export function buildMonarch(grammar: LanguageJson): MonarchLanguage {
	const words = new Set<string>();
	for (const token of Object.values(grammar.tokens || {})) {
		const literals = literalAlternatives(token);
		if (literals) for (const word of literals) words.add(word);
	}
	const keywords = Array.from(words).sort((a, b) => b.length - a.length);

	const rules: Array<MonarchRule> = [
		[/^\s*#!.*$/.source, "keyword"],
		[/\/\/.*$/.source, "comment"],
		[/'[^'\n]*'/.source, "string"],
		[/\d+/.source, "number"]
	];
	if (keywords.length > 0) {
		rules.push(["(?<![\\w])(" + keywords.map(escapeRegex).join("|") + ")(?![\\w])", "keyword"]);
	}

	return { ignoreCase: false, tokenizer: { root: rules } };
}
