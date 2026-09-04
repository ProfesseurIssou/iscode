/*Import sélectif : API éditeur + langue JSON uniquement (évite d'embarquer les ~40
	langages de base de Monaco dans le bundle).*/
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

/*Workers Monaco via le pattern officiel Vite (imports ?worker)*/
self.MonacoEnvironment = {
	getWorker(_workerId: string, label: string): Worker {
		if (label === "json") return new jsonWorker();
		return new editorWorker();
	}
};

/*Thème sombre cohérent avec l'UI du studio*/
export function defineTheme(): void {
	monaco.editor.defineTheme("iscode-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "6a9955", fontStyle: "italic" },
			{ token: "string", foreground: "ce9178" },
			{ token: "number", foreground: "b5cea8" },
			{ token: "keyword", foreground: "569cd6" },
			{ token: "type", foreground: "4ec9b0" },
			{ token: "identifier", foreground: "9cdcfe" }
		],
		colors: {
			"editor.background": "#1b1e24",
			"editor.lineHighlightBackground": "#262b33",
			"editorLineNumber.foreground": "5a6272",
			"editorLineNumber.activeForeground": "9aa4b5",
			"editorGutter.background": "#1b1e24"
		}
	});
}

export { monaco };

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
	theme: "iscode-dark",
	automaticLayout: true,
	fontSize: 13.5,
	fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	smoothScrolling: true,
	padding: { top: 8 }
};
