import { monaco, EDITOR_OPTIONS } from "../monaco";
import { appStorage } from "../core/storage";
import { languageIdFor, registerLanguage, registerNasm } from "../core/languages";
import { buildReverseMap, resolveTarget, translate } from "../core/pipeline";
import { buildExampleContent } from "../core/validate";
import type { GrammarProvider } from "../core/provider";
import type { LanguageJson, SourceMap } from "../../../src/types";
import type { View, ViewFactory } from "./view";

const LEVEL_KEY = "iscode-studio:translate:level";
const contentKey = (level: string) => "iscode-studio:translate:content:" + level;
const targetKey = (level: string) => "iscode-studio:translate:target:" + level;

const HIGHLIGHT_OPTIONS: monaco.editor.IModelDecorationOptions = {
	isWholeLine: true,
	className: "sync-line",
	linesDecorationsClassName: "sync-line-glyph",
	overviewRuler: { color: "#4f9cf0", position: monaco.editor.OverviewRulerLane.Center }
};

/*Vue Translate : éditeur source (complétion + marqueurs d'erreurs) et sortie côte à côte,
	re-traduction débouncée à chaque frappe, lignes liées par la source map :
	curseur dans la sortie -> ligne source surlignée (clic : révélée et centrée),
	curseur source -> lignes de sortie surlignées (index inverse).*/
export function createTranslateView(ctx: { provider: GrammarProvider }): View {
	const provider = ctx.provider;

	let grammar: LanguageJson | undefined;
	let currentLevel = "";
	let map: SourceMap = {};
	let reverseMap = new Map<number, Array<number>>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;

	let container: HTMLElement;
	let levelSelect: HTMLSelectElement;
	let targetSelect: HTMLSelectElement;
	let statusEl: HTMLElement;
	let sourcePaneTitle: HTMLElement;
	let outputPaneTitle: HTMLElement;
	let sourceEditor: monaco.editor.IStandaloneCodeEditor;
	let outputEditor: monaco.editor.IStandaloneCodeEditor;
	let sourceModel: monaco.editor.ITextModel;
	let outputModel: monaco.editor.ITextModel;
	let sourceHighlight: monaco.editor.IEditorDecorationsCollection;
	let outputHighlight: monaco.editor.IEditorDecorationsCollection;

	function scheduleTranslate(): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(doTranslate, 200);
	}

	function saveContent(): void {
		if (currentLevel) appStorage.set(contentKey(currentLevel), sourceModel.getValue());
	}

	function initialContent(level: string, theGrammar: LanguageJson): string {
		return "#! iscode-level: " + level + "\n#! iscode-version: " + theGrammar.version + "\n";
	}

	function populateLevels(): void {
		const levels = provider.listLevels();
		const previous = currentLevel;
		const selected = levels.indexOf(currentLevel) >= 0 ? currentLevel : appStorage.get(LEVEL_KEY, previous || levels[0] || "");
		levelSelect.replaceChildren(...levels.map((level) => {
			const option = document.createElement("option");
			option.value = level;
			option.textContent = level + (provider.isDraft(level) ? " (draft)" : "");
			return option;
		}));
		const fallback = levels.indexOf(selected) >= 0 ? selected : levels[0];
		if (fallback) levelSelect.value = fallback;
		if (fallback && fallback !== previous) selectLevel(fallback);
	}

	function populateTargets(): void {
		if (!grammar) return;
		const targets = Object.keys(grammar.availableTranslation);
		targetSelect.replaceChildren(...targets.map((name) => {
			const option = document.createElement("option");
			option.value = name;
			option.textContent = name;
			return option;
		}));
		const stored = appStorage.get(targetKey(currentLevel), targets[0] || "");
		targetSelect.value = targets.indexOf(stored) >= 0 ? stored : targets[0];
		appStorage.set(targetKey(currentLevel), targetSelect.value);
	}

	function selectLevel(level: string): void {
		saveContent();
		currentLevel = level;
		appStorage.set(LEVEL_KEY, level);

		let loaded: LanguageJson;
		try {
			loaded = provider.loadGrammar(level);
		} catch (error) {
			grammar = undefined;
			statusEl.textContent = String(error);
			statusEl.classList.add("error");
			return;
		}
		grammar = loaded;

		registerLanguage(grammar);
		monaco.editor.setModelLanguage(sourceModel, languageIdFor(level));
		sourcePaneTitle.textContent = "main." + level;

		const stored = appStorage.get(contentKey(level), "");
		sourceModel.setValue(stored.length > 0 ? stored : initialContent(level, grammar));
		populateTargets();
		doTranslate();
	}

	function outputLanguageId(): string {
		if (!grammar) return "plaintext";
		const targetDef = grammar.availableTranslation[targetSelect.value];
		if (!targetDef) return "plaintext";
		if (targetDef.grammar) return languageIdFor(targetDef.grammar);
		if (targetDef.extension === "nasm") {
			registerNasm();
			return "nasm";
		}
		return "plaintext";
	}

	function doTranslate(): void {
		timer = undefined;
		if (!grammar || !currentLevel) return;
		statusEl.classList.remove("error");

		let resolved;
		try {
			resolved = resolveTarget(grammar, targetSelect.value, (level) => {
				try {
					return provider.loadGrammar(level);
				} catch {
					return undefined;
				}
			});
		} catch (error) {
			statusEl.textContent = String(error);
			statusEl.classList.add("error");
			return;
		}

		appStorage.set(targetKey(currentLevel), targetSelect.value);
		const result = translate(sourceModel.getValue(), "main." + currentLevel, grammar, resolved);
		map = result.map;
		reverseMap = buildReverseMap(map);

		/*Sortie : on préserve la position de scroll lors du remplacement du texte*/
		const viewState = outputEditor.saveViewState();
		monaco.editor.setModelLanguage(outputModel, outputLanguageId());
		outputModel.setValue(result.text);
		if (viewState) outputEditor.restoreViewState(viewState);
		outputPaneTitle.textContent = "main." + resolved.targetDef.extension;

		monaco.editor.setModelMarkers(sourceModel, "iscode", result.errors.map((error) => ({
			startLineNumber: error.line,
			endLineNumber: error.line,
			startColumn: 1,
			endColumn: sourceModel.getLineMaxColumn(error.line),
			message: "Unrecognized instruction (ignored in the output)",
			severity: monaco.MarkerSeverity.Error
		})));

		const parts = [grammar.name + " v" + grammar.version + "  →  " + targetSelect.value];
		if (result.renderError) {
			parts.push(result.renderError);
			statusEl.classList.add("error");
		} else {
			parts.push(result.text.replace(/\n$/, "").split("\n").length + " lines");
		}
		if (result.errors.length > 0) parts.push(result.errors.length + " unrecognized line(s)");
		statusEl.textContent = parts.join("   ·   ");
	}

	function setSourceHighlight(line: number | undefined): void {
		sourceHighlight.set(line === undefined ? [] : [{
			range: new monaco.Range(line, 1, line, 1),
			options: HIGHLIGHT_OPTIONS
		}]);
	}

	function setOutputHighlight(lines: Array<number>): void {
		outputHighlight.set(lines.map((line) => ({
			range: new monaco.Range(line, 1, line, 1),
			options: HIGHLIGHT_OPTIONS
		})));
	}

	async function mount(root: HTMLElement): Promise<void> {
		container = document.createElement("div");
		container.className = "view translate-view";
		container.innerHTML = `
			<div class="toolbar">
				<label class="field">Source <select id="level-select"></select></label>
				<label class="field">Target <select id="target-select"></select></label>
				<button id="example-btn" class="btn" type="button">Insert example</button>
				<span id="status" class="status"></span>
			</div>
			<div class="split">
				<div class="pane">
					<div class="pane-title" id="source-title">source</div>
					<div class="editor" id="source-editor"></div>
				</div>
				<div class="pane">
					<div class="pane-title" id="output-title">output</div>
					<div class="editor" id="output-editor"></div>
				</div>
			</div>`;
		root.appendChild(container);

		levelSelect = container.querySelector("#level-select")!;
		targetSelect = container.querySelector("#target-select")!;
		statusEl = container.querySelector("#status")!;
		sourcePaneTitle = container.querySelector("#source-title")!;
		outputPaneTitle = container.querySelector("#output-title")!;

		sourceModel = monaco.editor.createModel("", "plaintext");
		outputModel = monaco.editor.createModel("", "plaintext");
		sourceEditor = monaco.editor.create(container.querySelector("#source-editor") as HTMLElement, {
			...EDITOR_OPTIONS,
			model: sourceModel
		});
		outputEditor = monaco.editor.create(container.querySelector("#output-editor") as HTMLElement, {
			...EDITOR_OPTIONS,
			model: outputModel,
			readOnly: true
		});
		sourceHighlight = sourceEditor.createDecorationsCollection([]);
		outputHighlight = outputEditor.createDecorationsCollection([]);

		sourceModel.onDidChangeContent(() => {
			saveContent();
			scheduleTranslate();
		});
		sourceEditor.onDidChangeCursorPosition((event) => {
			setOutputHighlight(reverseMap.get(event.position.lineNumber) || []);
		});
		outputEditor.onDidChangeCursorPosition((event) => {
			const entry = map[String(event.position.lineNumber)];
			setSourceHighlight(entry ? entry.line : undefined);
		});
		outputEditor.onMouseDown((event) => {
			const position = event.target.position;
			if (!position) return;
			const entry = map[String(position.lineNumber)];
			if (!entry) return;
			sourceEditor.revealLineInCenter(entry.line);
			sourceEditor.setPosition({ lineNumber: entry.line, column: 1 });
		});

		levelSelect.addEventListener("change", () => selectLevel(levelSelect.value));
		targetSelect.addEventListener("change", () => {
			appStorage.set(targetKey(currentLevel), targetSelect.value);
			doTranslate();
		});
		(container.querySelector("#example-btn") as HTMLButtonElement).addEventListener("click", () => {
			if (!grammar) return;
			sourceModel.setValue(buildExampleContent(grammar));
		});

		unsubscribe = provider.subscribe(() => {
			if (!provider.listLevels().includes(currentLevel)) {
				populateLevels();
			}
		});

		try {
			await provider.ensureLoaded();
		} catch (error) {
			statusEl.textContent = "Registry unavailable: " + String(error);
			statusEl.classList.add("error");
		}
		populateLevels();
	}

	function unmount(): void {
		if (timer) clearTimeout(timer);
		saveContent();
		if (unsubscribe) unsubscribe();
		monaco.editor.setModelMarkers(sourceModel, "iscode", []);
		sourceModel.dispose();
		outputModel.dispose();
		sourceEditor.dispose();
		outputEditor.dispose();
		container.remove();
	}

	return { mount, unmount };
}

export const translateViewFactory: ViewFactory = createTranslateView;
