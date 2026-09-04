import { monaco } from "../monaco";
import { LanguageJson } from "../../../src/types";
import { buildMonarch } from "./monarch";
import { nasmMonarch } from "./nasm";

export function languageIdFor(level: string): string {
	return "iscode-" + level;
}

const registered = new Map<string, Array<monaco.IDisposable>>();

/*Enregistre (ou ré-enregistre) un langage Monaco pour une grammaire :
	Monarch généré, configuration (commentaires //), complétion depuis les snippets.
	Ré-enregistrer remplace l'existant — les drafts du Language Studio le font à chaque édition.*/
export function registerLanguage(grammar: LanguageJson): monaco.IDisposable {
	unregisterLanguage(grammar.name);
	const id = languageIdFor(grammar.name);
	const disposables: Array<monaco.IDisposable> = [];

	monaco.languages.register({ id });              /*retourne void*/
	disposables.push(monaco.languages.setMonarchTokensProvider(id, buildMonarch(grammar) as monaco.languages.IMonarchLanguage));
	monaco.languages.setLanguageConfiguration(id, {   /*retourne void : rien à disposer*/
		comments: { lineComment: "//" },
		brackets: [["[", "]"], ["(", ")"]],
		autoClosingPairs: [
			{ open: "[", close: "]" },
			{ open: "(", close: ")" },
			{ open: "'", close: "'", notIn: ["string", "comment"] }
		]
	});

	disposables.push(monaco.languages.registerCompletionItemProvider(id, {
		provideCompletionItems: (model, position) => {
			const word = model.getWordUntilPosition(position);
			const range = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn
			};
			const suggestions: Array<monaco.languages.CompletionItem> = [];
			for (const [name, instruction] of Object.entries(grammar.instructions || {})) {
				if (!instruction.snippet) continue;
				const item: monaco.languages.CompletionItem = {
					label: name,
					kind: monaco.languages.CompletionItemKind.Snippet,
					insertText: instruction.snippet.output,
					insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					range,
					detail: grammar.name + " instruction"
				};
				if (instruction.snippet.documentation) item.documentation = instruction.snippet.documentation;
				if (instruction.snippet.commitChars) item.commitCharacters = instruction.snippet.commitChars;
				suggestions.push(item);
			}
			return { suggestions };
		}
	}));

	registered.set(grammar.name, disposables);
	return { dispose: () => unregisterLanguage(grammar.name) };
}

export function unregisterLanguage(level: string): void {
	const disposables = registered.get(level);
	if (!disposables) return;
	for (const disposable of disposables) disposable.dispose();
	registered.delete(level);
}

let nasmRegistered = false;

/*Langage NASM de sortie (coloration minimale), enregistré une seule fois*/
export function registerNasm(): void {
	if (nasmRegistered) return;
	nasmRegistered = true;
	monaco.languages.register({ id: "nasm" });
	monaco.languages.setMonarchTokensProvider("nasm", nasmMonarch as monaco.languages.IMonarchLanguage);
	monaco.languages.setLanguageConfiguration("nasm", { comments: { lineComment: ";" } });
}
