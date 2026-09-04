import { monaco, EDITOR_OPTIONS } from "../monaco";
import { appStorage } from "../core/storage";
import { languageIdFor, registerLanguage, registerNasm } from "../core/languages";
import { resolveTarget, translate } from "../core/pipeline";
import { buildExampleContent, validateGrammar, type ValidationIssue } from "../core/validate";
import { createGrammarForm, type GrammarForm } from "./studioForm";
import grammarSchema from "../../schemas/grammar.schema.json";
import type { GrammarProvider } from "../core/provider";
import type { AstNode, LanguageJson, TargetDef } from "../../../src/types";
import type { View, ViewFactory } from "./view";
import { el } from "./view";

const DRAFT_KEY = "iscode-studio:studio:draft";
const MODE_KEY = "iscode-studio:studio:mode";
const exampleKey = (name: string) => "iscode-studio:studio:example:" + name;

/*Template de départ : un mini-langage qui marche immédiatement (cible = lui-même),
	sur le pattern documenté du README.*/
const BLANK_TEMPLATE = `{
    "name": "mylang",
    "version": 1,
    "renderZoneOrder": ["head", "body", "tail"],
    "pipeline": [],
    "availableTranslation": {
        "mylang": { "extension": "mylang", "emitHeader": true }
    },
    "tokens": {
        "indentation": "^[ ]{0,}",
        "space": "[ ]{1,}",
        "numbers": "[0-9]{1,}",
        "communData": "[a-zA-Z0-9_]{1,}",
        "InstPrint": "print"
    },
    "instructions": {
        "print": {
            "syntax": ["indentation", "InstPrint", "space", "communData"],
            "ast": { "op": "print", "value": "%{4}" },
            "snippet": {
                "output": "print ${1}",
                "documentation": "Print a value",
                "commitChars": null
            },
            "translation": {
                "mylang": [ { "zone": "body", "line": "out %{value}" } ]
            }
        }
    }
}`;

interface TargetOutput {
	text?: string,
	error?: string
}

/*Vue Language Studio : éditeur de grammaire JSON (validé par JSON Schema) à gauche,
	test live à droite — exemple source (coloration/complétion de la grammaire draft),
	sorties par cible, table AST et liste d'issues (validation + parse + rendu).
	La grammaire draft est enregistrée dans le provider : elle devient utilisable
	dans la vue Translate et visible dans la vue Languages.*/
export function createStudioView(ctx: { provider: GrammarProvider }): View {
	const provider = ctx.provider;

	let container: HTMLElement;
	let grammarEditor: monaco.editor.IStandaloneCodeEditor;
	let exampleEditor: monaco.editor.IStandaloneCodeEditor;
	let outputEditor: monaco.editor.IStandaloneCodeEditor;
	let grammarModel: monaco.editor.ITextModel;
	let exampleModel: monaco.editor.ITextModel;
	let outputModel: monaco.editor.ITextModel;
	let tabsHost: HTMLElement;
	let outputBody: HTMLElement;
	let astBody: HTMLElement;
	let issuesBody: HTMLElement;
	let statusEl: HTMLElement;
	let downloadBtn: HTMLButtonElement;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let draft: LanguageJson | undefined;
	let lastDraftName: string | undefined;
	let outputs: Record<string, TargetOutput> = {};
	let astNodes: Array<AstNode> = [];
	let issues: Array<ValidationIssue> = [];
	let exampleErrors: Array<{ line: number, text: string }> = [];
	let selectedTab: string | undefined;
	let currentExampleLanguage: string | undefined;

	/*Edition via formulaire : le formulaire mute la grammaire puis resérialise le modèle JSON ;
	  editSource="form" indique à update() de ne pas re-rendre le formulaire (focus conservé).*/
	let grammarForm: GrammarForm | undefined;
	let formHost: HTMLElement | undefined;
	let editSource: "form" | null = null;
	let lastFormJson: string | undefined;
	let currentMode: "form" | "json" = "form";

	function scheduleUpdate(): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(update, 250);
	}

	/*Changement de draft : (re)enregistre le langage Monaco, met à jour la langue de
	  l'éditeur d'exemple, l'enregistre dans le provider, recharge l'exemple par défaut*/
	function applyDraft(parsed: LanguageJson): void {
		const nameChanged = lastDraftName !== undefined && lastDraftName !== parsed.name;
		if (nameChanged) provider.unregisterDraft(lastDraftName!);
		lastDraftName = parsed.name;

		registerLanguage(parsed);
		const exampleId = languageIdFor(parsed.name);
		if (currentExampleLanguage !== exampleId) {
			currentExampleLanguage = exampleId;
			monaco.editor.setModelLanguage(exampleModel, exampleId);
			const stored = appStorage.get(exampleKey(parsed.name), "");
			exampleModel.setValue(stored.length > 0 ? stored : buildExampleContent(parsed));
		}
		provider.registerDraft(parsed);
	}

	function outputLanguageFor(targetDef: TargetDef): string {
		if (targetDef.grammar) return languageIdFor(targetDef.grammar);
		if (targetDef.extension === "nasm") {
			registerNasm();
			return "nasm";
		}
		return "plaintext";
	}

	function runTests(parsed: LanguageJson): void {
		outputs = {};
		for (const targetName of Object.keys(parsed.availableTranslation || {})) {
			try {
				const resolved = resolveTarget(parsed, targetName, (level) => {
					try {
						return provider.loadGrammar(level);
					} catch {
						return undefined;
					}
				});
				const result = translate(exampleModel.getValue(), "example." + parsed.name, parsed, resolved);
				astNodes = result.nodes;
				exampleErrors = result.errors.map((error) => ({ line: error.line, text: error.text }));
				if (result.renderError) outputs[targetName] = { error: result.renderError };
				else outputs[targetName] = { text: result.text };
			} catch (error) {
				outputs[targetName] = { error: String(error).replace(/^Error: /, "") };
			}
		}

		monaco.editor.setModelMarkers(exampleModel, "iscode", exampleErrors.map((error) => ({
			startLineNumber: error.line,
			endLineNumber: error.line,
			startColumn: 1,
			endColumn: exampleModel.getLineMaxColumn(error.line),
			message: "Unrecognized instruction (no instruction matches this line)",
			severity: monaco.MarkerSeverity.Error
		})));
	}

	function update(): void {
		timer = undefined;
		appStorage.set(DRAFT_KEY, grammarModel.getValue());

		let parsed: LanguageJson | undefined;
		try {
			parsed = JSON.parse(grammarModel.getValue()) as LanguageJson;
		} catch (error) {
			issues = [{ severity: "error", message: "Invalid JSON: " + String(error).replace(/^SyntaxError: /, ""), path: "$" }];
			statusEl.textContent = "Invalid JSON";
			statusEl.classList.add("error");
			editSource = null;
			renderTabs();
			renderIssues();
			return;
		}

		issues = validateGrammar(parsed);
		draft = parsed;
		statusEl.classList.remove("error");

		const errors = issues.filter((issue) => issue.severity === "error").length;
		const warnings = issues.length - errors;
		const usable = typeof parsed.name === "string" && parsed.name.length > 0 && parsed.instructions && parsed.tokens;
		if (usable) applyDraft(parsed);

		runTests(parsed);

		statusEl.textContent =
			parsed.name + " v" + parsed.version + "  ·  " +
			Object.keys(parsed.instructions || {}).length + " instructions  ·  " +
			errors + " error(s), " + warnings + " warning(s)" +
			(usable ? "" : "  ·  minimal fields (name/tokens/instructions) required to test");
		if (errors > 0) statusEl.classList.add("error");
		downloadBtn.disabled = false;

		/*Formulaire re-rendu seulement si le JSON a changé ailleurs que depuis le formulaire
		  (édition JSON, chargement de template) — jamais pendant une saisie formulaire*/
		if (editSource !== "form" && grammarModel.getValue() !== lastFormJson) {
			lastFormJson = grammarModel.getValue();
			if (currentMode === "form" && formHost) grammarForm!.render(formHost, parsed);
		}
		editSource = null;

		renderTabs();
		renderAst();
		renderIssues();
	}

	function renderTabs(): void {
		const tabNames = [...Object.keys(outputs), "AST", "Issues"];
		if (selectedTab === undefined || tabNames.indexOf(selectedTab) < 0) selectedTab = tabNames[0];
		tabsHost.replaceChildren(...tabNames.map((name) => {
			const tab = el("button", "tab" + (name === selectedTab ? " active" : ""), name);
			if (name === "Issues" && issues.length + exampleErrors.length > 0) {
				tab.appendChild(el("span", "tab-count", String(issues.length + exampleErrors.length)));
			}
			tab.addEventListener("click", () => {
				selectedTab = name;
				showTab(name);
				tabsHost.querySelectorAll(".tab").forEach((node) => node.classList.remove("active"));
				tab.classList.add("active");
			});
			return tab;
		}));
		showTab(selectedTab);
	}

	function showTab(name: string): void {
		outputBody.classList.toggle("visible", outputs[name] !== undefined);
		astBody.classList.toggle("visible", name === "AST");
		issuesBody.classList.toggle("visible", name === "Issues");

		const banner = container.querySelector("#output-error-banner") as HTMLElement;
		if (outputs[name] !== undefined && draft) {
			const output = outputs[name];
			if (output.error) {
				monaco.editor.setModelLanguage(outputModel, "plaintext");
				outputModel.setValue("");
				banner.textContent = output.error;
				banner.classList.remove("hidden");
			} else {
				const targetDef = (draft.availableTranslation || {})[name] as TargetDef | undefined;
				if (targetDef) monaco.editor.setModelLanguage(outputModel, outputLanguageFor(targetDef));
				outputModel.setValue(output.text || "");
				banner.classList.add("hidden");
			}
		}
	}

	function renderAst(): void {
		if (astNodes.length === 0) {
			astBody.replaceChildren(el("div", "meta", "No AST (fix the example source first)."));
			return;
		}
		const table = el("table", "ast-table");
		table.innerHTML = "<thead><tr><th>#</th><th>line</th><th>op</th><th>instruction</th><th>fields</th></tr></thead>";
		const body = el("tbody");
		astNodes.forEach((node, index) => {
			const row = el("tr");
			row.appendChild(el("td", undefined, String(index + 1)));
			row.appendChild(el("td", undefined, String(node.origin.line)));
			row.appendChild(el("td", undefined, node.op));
			row.appendChild(el("td", undefined, node._instruction || "—"));
			const fields = Object.entries(node)
				.filter(([key]) => key !== "op" && key !== "origin" && !key.startsWith("_"))
				.map(([key, value]) => key + "=" + String(value))
				.join("  ");
			row.appendChild(el("td", "mono", fields));
			body.appendChild(row);
		});
		table.appendChild(body);
		astBody.replaceChildren(table);
	}

	function renderIssues(): void {
		const list = el("div", "issues");
		if (issues.length === 0 && exampleErrors.length === 0) {
			list.appendChild(el("div", "meta", "No issue found. 🎉"));
		}
		for (const issue of issues) {
			const item = el("div", "issue issue-" + issue.severity);
			item.appendChild(el("span", "issue-severity", issue.severity === "error" ? "✖" : "⚠"));
			item.appendChild(el("span", "issue-path", issue.path));
			item.appendChild(el("span", "issue-message", issue.message));
			list.appendChild(item);
		}
		for (const error of exampleErrors) {
			const item = el("div", "issue issue-error");
			item.appendChild(el("span", "issue-severity", "✖"));
			item.appendChild(el("span", "issue-path", "example:" + error.line));
			item.appendChild(el("span", "issue-message", "Unrecognized instruction: \"" + error.text + "\""));
			list.appendChild(item);
		}
		issuesBody.replaceChildren(list);
	}

	function loadTemplate(): void {
		const select = container.querySelector("#template-select") as HTMLSelectElement;
		let text: string;
		if (select.value === "blank") {
			text = BLANK_TEMPLATE;
		} else {
			try {
				const grammar = provider.loadGrammar(select.value);
				text = JSON.stringify(grammar, null, 4);
			} catch (error) {
				statusEl.textContent = String(error);
				statusEl.classList.add("error");
				return;
			}
		}
		if (grammarModel.getValue().trim().length > 0 &&
			grammarModel.getValue() !== text &&
			!window.confirm("Replace the current draft with the template?")) return;
		grammarModel.setValue(text);
	}

	function download(): void {
		if (!draft) return;
		const fileName = draft.name + "-v" + draft.version + ".json";
		const blob = new Blob([JSON.stringify(draft, null, 4) + "\n"], { type: "application/json" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = fileName;
		link.click();
		URL.revokeObjectURL(link.href);
		statusEl.textContent = "Downloaded " + fileName + " — place it in convert/" + draft.name + "/v" + draft.version + ".json";
	}

	async function mount(root: HTMLElement): Promise<void> {
		container = el("div", "view studio-view");
		container.innerHTML = `
			<div class="toolbar">
				<label class="field">Start from
					<select id="template-select">
						<option value="blank">Blank template</option>
						<option value="isc0">isc0 (registry)</option>
						<option value="isc1">isc1 (registry)</option>
					</select>
				</label>
				<button id="load-template" class="btn" type="button">Load</button>
				<span id="grammar-status" class="status"></span>
				<button id="download" class="btn btn-primary" type="button">Download</button>
			</div>
			<div class="split studio-split">
				<div class="pane" id="grammar-pane">
					<div class="pane-title">Grammar
						<span class="pane-sub">tokens, rules and outputs</span>
						<span class="pane-tools">
							<button id="mode-form" class="btn btn-small" type="button">Form</button>
							<button id="mode-json" class="btn btn-small" type="button">JSON</button>
						</span>
					</div>
					<div id="grammar-form-host" class="form-host"></div>
					<div class="editor" id="grammar-editor"></div>
				</div>
				<div class="pane col">
					<div class="pane grow">
						<div class="pane-title">Example source <span class="pane-sub">live-tested against the draft grammar</span></div>
						<div class="editor" id="example-editor"></div>
					</div>
					<div class="pane grow">
						<div class="tabs" id="studio-tabs"></div>
						<div id="tab-output" class="tab-body output-body">
							<div id="output-error-banner" class="error-banner hidden"></div>
							<div class="editor" id="output-editor"></div>
						</div>
						<div id="tab-ast" class="tab-body"></div>
						<div id="tab-issues" class="tab-body"></div>
					</div>
				</div>
			</div>`;
		root.appendChild(container);

		statusEl = container.querySelector("#grammar-status")!;
		tabsHost = container.querySelector("#studio-tabs")!;
		outputBody = container.querySelector("#tab-output")!;
		astBody = container.querySelector("#tab-ast")!;
		issuesBody = container.querySelector("#tab-issues")!;
		downloadBtn = container.querySelector("#download")!;

		/*Validation JSON Schema sur le modèle de draft (fileMatch par URI du modèle)*/
		monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
			validate: true,
			allowComments: false,
			schemas: [{
				uri: "http://iscode.local/schemas/grammar.json",
				fileMatch: ["*.grammar.json"],
				schema: grammarSchema as Record<string, unknown>
			}]
		});

		grammarModel = monaco.editor.createModel(
			appStorage.get(DRAFT_KEY, "") || BLANK_TEMPLATE,
			"json",
			monaco.Uri.parse("inmemory://draft.grammar.json")
		);
		exampleModel = monaco.editor.createModel("", "plaintext");
		outputModel = monaco.editor.createModel("", "plaintext");

		grammarEditor = monaco.editor.create(container.querySelector("#grammar-editor") as HTMLElement, {
			...EDITOR_OPTIONS,
			model: grammarModel
		});
		exampleEditor = monaco.editor.create(container.querySelector("#example-editor") as HTMLElement, {
			...EDITOR_OPTIONS,
			model: exampleModel
		});
		outputEditor = monaco.editor.create(container.querySelector("#output-editor") as HTMLElement, {
			...EDITOR_OPTIONS,
			model: outputModel,
			readOnly: true
		});

		/*Formulaire d'édition : mute la grammaire -> resérialise le modèle JSON
		  (le reste du pipeline live repart de là, comme pour une édition JSON)*/
		const grammarPane = container.querySelector("#grammar-pane") as HTMLElement;
		formHost = container.querySelector("#grammar-form-host") as HTMLElement;
		grammarForm = createGrammarForm((edited) => {
			editSource = "form";
			const serialized = JSON.stringify(edited, null, 4);
			lastFormJson = serialized;
			grammarModel.setValue(serialized);
		}, {
			getLevels: () => provider.listLevels(),
			getVersions: (level) => provider.listVersions(level),
			getGrammar: (level) => {
				try {
					return provider.loadGrammar(level);
				} catch {
					return undefined;
				}
			}
		});

		const modeFormBtn = container.querySelector("#mode-form") as HTMLButtonElement;
		const modeJsonBtn = container.querySelector("#mode-json") as HTMLButtonElement;
		const setMode = (mode: "form" | "json"): void => {
			currentMode = mode;
			appStorage.set(MODE_KEY, mode);
			grammarPane.classList.toggle("mode-form", mode === "form");
			modeFormBtn.classList.toggle("btn-primary", mode === "form");
			modeJsonBtn.classList.toggle("btn-primary", mode === "json");
			if (mode === "form" && draft && formHost) grammarForm!.render(formHost, draft);
		};
		modeFormBtn.addEventListener("click", () => setMode("form"));
		modeJsonBtn.addEventListener("click", () => setMode("json"));

		grammarModel.onDidChangeContent(scheduleUpdate);
		exampleModel.onDidChangeContent(() => {
			if (draft) appStorage.set(exampleKey(draft.name), exampleModel.getValue());
			scheduleUpdate();
		});
		(container.querySelector("#load-template") as HTMLButtonElement).addEventListener("click", loadTemplate);
		downloadBtn.addEventListener("click", download);

		try {
			await provider.ensureLoaded();
		} catch {
			/*le template registry ne marchera pas, le blank template oui*/
		}
		setMode(appStorage.get<"form" | "json">(MODE_KEY, "form"));
		update();
	}

	function unmount(): void {
		if (timer) clearTimeout(timer);
		appStorage.set(DRAFT_KEY, grammarModel.getValue());
		if (draft) appStorage.set(exampleKey(draft.name), exampleModel.getValue());
		monaco.editor.setModelMarkers(exampleModel, "iscode", []);
		grammarModel.dispose();
		exampleModel.dispose();
		outputModel.dispose();
		grammarEditor.dispose();
		exampleEditor.dispose();
		outputEditor.dispose();
		container.remove();
	}

	return { mount, unmount };
}

export const studioViewFactory: ViewFactory = createStudioView;
