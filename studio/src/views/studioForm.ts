import { allPasses } from "../../../src/passes";
import { el } from "./view";

/*Édition de grammaire par formulaire (vue Language Studio) :
	- mute l'objet grammaire en place et notifie le parent à chaque changement
	  (le parent resérialise en JSON -> le pipeline de test live se relance) ;
	- les renommages (token, cible, champ AST) propagent les références ;
	- les changements structurels (ajout/suppression/déplacement/renommage)
	  re-render le formulaire, les saisies simples non (le focus est conservé).*/

export interface GrammarForm {
	render(host: HTMLElement, grammar: any): void;
}

/*Option de select : chaîne simple, ou valeur + libellé distinct (ex "%{2}" affiché "2 · communData")*/
type SelectOption = string | { value: string, label: string };

/*Résolution des références vers l'existant : niveaux du registry/drafts, versions d'un niveau, grammaire chargée*/
export interface GrammarFormExternals {
	getLevels?: () => Array<string>,
	getVersions?: (level: string) => Array<number>,
	getGrammar?: (level: string) => any
}

export function createGrammarForm(onChange: (grammar: any) => void, externals?: GrammarFormExternals): GrammarForm {
	const getLevels = externals && externals.getLevels;
	const getVersions = externals && externals.getVersions;
	const getGrammar = externals && externals.getGrammar;
	let host: HTMLElement | undefined;
	let grammar: any;
	const expanded = new Set<string>();          /*instructions dépliées, conservées entre re-render*/

	/* ---------- notifications ---------- */

	function commit(): void {
		onChange(grammar);
	}

	function commitRerender(): void {
		if (host && grammar) render(host, grammar);
		commit();
	}

	/* ---------- helpers de manipulation ---------- */

	function uniqueName(taken: Array<string>, base: string): string {
		let n = 1;
		while (taken.indexOf(base + n) >= 0) n++;
		return base + n;
	}

	/*Renomme une clé d'objet en conservant l'ordre des autres*/
	function renameKey(container: any, oldKey: string, newKey: string): boolean {
		newKey = newKey.trim();
		if (!newKey || newKey === oldKey || container[newKey] !== undefined) return false;
		const rebuilt: any = {};
		for (const [key, value] of Object.entries(container)) rebuilt[key === oldKey ? newKey : key] = value;
		Object.keys(container).forEach((key) => delete container[key]);
		Object.assign(container, rebuilt);
		return true;
	}

	/*Déplace une clé dans son objet (l'ordre des instructions compte : première regex qui matche gagne)*/
	function moveKey(container: any, key: string, offset: number): void {
		const keys = Object.keys(container);
		const from = keys.indexOf(key);
		const to = from + offset;
		if (from < 0 || to < 0 || to >= keys.length) return;
		keys.splice(to, 0, keys.splice(from, 1)[0]);
		const rebuilt: any = {};
		for (const k of keys) rebuilt[k] = container[k];
		Object.keys(container).forEach((k) => delete container[k]);
		Object.assign(container, rebuilt);
	}

	/* ---------- helpers de construction DOM ---------- */

	function textInput(value: unknown, onInput: (value: string) => void, placeholder?: string): HTMLInputElement {
		const node = el("input", "input");
		node.type = "text";
		node.value = value === undefined || value === null ? "" : String(value);
		if (placeholder) node.placeholder = placeholder;
		node.addEventListener("input", () => onInput(node.value));
		return node;
	}

	/*Champ de nom : validé au blur/change (le renommage impacte d'autres sections)*/
	function nameInput(value: string, onRename: (next: string) => void): HTMLInputElement {
		const node = textInput(value, () => undefined);
		node.classList.add("gf-name");
		node.addEventListener("change", () => onRename(node.value));
		return node;
	}

	function checkbox(value: unknown, onInput: (value: boolean) => void): HTMLInputElement {
		const node = el("input");
		node.type = "checkbox";
		node.checked = value === true;
		node.addEventListener("change", () => onInput(node.checked));
		return node;
	}

	/*Select d'options ; la valeur courante inconnue est conservée et marquée "(missing)"*/
	function select(options: Array<SelectOption>, value: unknown, onChange: (value: string) => void): HTMLSelectElement {
		const node = el("select");
		const current = value === undefined || value === null ? "" : String(value);
		const entries = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
		if (!current && !entries.some((entry) => entry.value === "")) entries.unshift({ value: "", label: "(none)" });
		const known = entries.some((entry) => entry.value === current);
		if (current && !known) entries.push({ value: current, label: current + "  (missing)" });
		node.replaceChildren(...entries.map((entry) => {
			const item = el("option", undefined, entry.label);
			item.value = entry.value;
			return item;
		}));
		node.value = current;
		node.addEventListener("change", () => onChange(node.value));
		return node;
	}

	function iconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
		const node = el("button", "btn btn-small gf-icon-btn", label);
		node.type = "button";
		node.title = title;
		node.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return node;
	}

	function addButton(label: string, onClick: () => void): HTMLButtonElement {
		const node = el("button", "btn btn-small gf-add", "+ " + label);
		node.type = "button";
		node.addEventListener("click", onClick);
		return node;
	}

	function section(root: HTMLElement, title: string, hint?: string): HTMLElement {
		const node = el("div", "gf-section");
		node.appendChild(el("div", "gf-section-title", title));
		if (hint) node.appendChild(el("div", "gf-hint", hint));
		root.appendChild(node);
		return node;
	}

	/* ---------- sections ---------- */

	function buildGeneral(root: HTMLElement): void {
		const sec = section(root, "General");
		const grid = el("div", "gf-grid");
		const levels = getLevels ? getLevels() : [];

		const pair = (label: string, control: HTMLElement) => {
			grid.appendChild(el("label", undefined, label));
			grid.appendChild(control);
		};

		pair("Name", textInput(grammar.name, (v) => { grammar.name = v; commit(); }, "mylang"));

		const version = el("input", "input");
		version.type = "number";
		version.value = grammar.version === undefined || grammar.version === null ? "" : String(grammar.version);
		version.addEventListener("input", () => {
			grammar.version = version.value === "" ? undefined : Number(version.value);
			commit();
		});
		pair("Version", version);

		/*Zones : validées au blur -> les selects de zone des traductions se rafraîchissent*/
		const zones = el("input", "input");
		zones.type = "text";
		zones.value = (grammar.renderZoneOrder || []).join(", ");
		zones.placeholder = "head, body, tail";
		zones.addEventListener("change", () => {
			const list = zones.value.split(",").map((z) => z.trim()).filter((z) => z.length > 0);
			if (list.length > 0) grammar.renderZoneOrder = list;
			else delete grammar.renderZoneOrder;
			commitRerender();
		});
		pair("Zones (order)", zones);

		/*Passes : les passes réelles sont du code TypeScript référencé par nom —
		  cases à cocher plutôt que texte libre (plus de "resolveParam" typo qui explose au rendu)*/
		pair("Pipeline passes", buildPipelineControl());

		/*Niveau de sortie : un niveau existant en local ; choisir un niveau pré-sélectionne sa dernière version*/
		const target = grammar.target && typeof grammar.target === "object" ? grammar.target : undefined;
		pair("Output level", select([{ value: "", label: "(none)" }, ...levels], target ? target.level : "", (v) => {
			if (v) {
				grammar.target = { ...(grammar.target || {}) };
				grammar.target.level = v;
				if (grammar.target.version === undefined) {
					const known = getVersions ? getVersions(v) : [];
					if (known.length > 0) grammar.target.version = known[known.length - 1];
				}
			} else if (grammar.target) {
				delete grammar.target.level;
				if (grammar.target.version === undefined) delete grammar.target;
			}
			commitRerender();   /*rafraîchit le select des versions*/
		}));

		/*Version de sortie : les versions réelles du niveau choisi, ou texte libre si le niveau n'existe pas encore*/
		const targetLevel = target ? target.level : undefined;
		const knownVersions = targetLevel && getVersions ? getVersions(targetLevel) : [];
		let versionControl: HTMLElement;
		if (knownVersions.length > 0) {
			versionControl = select([{ value: "", label: "(none)" }, ...knownVersions.map(String)], target && target.version !== undefined ? String(target.version) : "", (v) => {
				if (v) {
					grammar.target = { ...(grammar.target || {}) };
					grammar.target.version = Number(v);
				} else if (grammar.target) {
					delete grammar.target.version;
					if (!grammar.target.level) delete grammar.target;
				}
				commit();
			});
		} else {
			versionControl = textInput(target && target.version !== undefined ? String(target.version) : "", (v) => {
				const trimmed = v.trim();
				if (trimmed !== "") {
					grammar.target = { ...(grammar.target || {}) };
					grammar.target.version = /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
				} else if (grammar.target) {
					delete grammar.target.version;
					if (!grammar.target.level) delete grammar.target;
				}
				commit();
			}, "1");
		}
		pair("Output version", versionControl);

		sec.appendChild(grid);
	}

	/*Cases à cocher des passes disponibles (ordre de déclaration), entrées inconnues conservées*/
	function buildPipelineControl(): HTMLElement {
		const wrap = el("div", "gf-passes");
		const known = Object.keys(allPasses);
		const current: Array<string> = Array.isArray(grammar.pipeline) ? grammar.pipeline : [];
		const unknown = current.filter((pass) => known.indexOf(pass) < 0);
		const checked = new Set<string>(current);

		const rebuild = () => {
			const selected = [...known.filter((pass) => checked.has(pass)), ...unknown.filter((pass) => checked.has(pass))];
			if (selected.length > 0) grammar.pipeline = selected;
			else delete grammar.pipeline;
			commit();
		};

		for (const name of [...known, ...unknown]) {
			const item = el("label", "gf-pass");
			item.appendChild(checkbox(checked.has(name), (v) => {
				if (v) checked.add(name);
				else checked.delete(name);
				rebuild();
			}));
			item.appendChild(document.createTextNode(name + (known.indexOf(name) < 0 ? "  (unknown)" : "")));
			wrap.appendChild(item);
		}
		if (wrap.childElementCount === 0) wrap.appendChild(el("span", "gf-hint", "No pass available."));
		return wrap;
	}

	function buildTokens(root: HTMLElement): void {
		const sec = section(root, "Tokens", "Named regex fragments, reused in instruction syntaxes.");
		const table = el("div", "gf-table");
		for (const [name, regex] of Object.entries<any>(grammar.tokens || {})) {
			const row = el("div", "gf-row gf-row-token");
			row.appendChild(nameInput(name, (next) => {
				if (renameKey(grammar.tokens, name, next)) {
					/*propager le renommage dans toutes les syntaxes qui référencent le token*/
					for (const instruction of Object.values<any>(grammar.instructions || {})) {
						if (!Array.isArray(instruction.syntax)) continue;
						for (let i = 0; i < instruction.syntax.length; i++) {
							if (instruction.syntax[i] === name) instruction.syntax[i] = next;
						}
					}
				}
				commitRerender();
			}));
			row.appendChild(textInput(regex, (v) => { grammar.tokens[name] = v; commit(); }, "[0-9]{1,}"));
			row.appendChild(iconButton("✕", "Delete token", () => { delete grammar.tokens[name]; commitRerender(); }));
			table.appendChild(row);
		}
		sec.appendChild(table);
		sec.appendChild(addButton("Add token", () => {
			grammar.tokens[uniqueName(Object.keys(grammar.tokens), "token")] = "";
			commitRerender();
		}));
	}

	function buildTargets(root: HTMLElement): void {
		const sec = section(root, "Targets", "Output formats offered in the Translate menu.");
		const levels = getLevels ? getLevels() : [];
		const table = el("div", "gf-table");
		for (const [name, def] of Object.entries<any>(grammar.availableTranslation || {})) {
			if (!def || typeof def !== "object") continue;
			const row = el("div", "gf-row gf-row-target");
			row.appendChild(nameInput(name, (next) => {
				if (renameKey(grammar.availableTranslation, name, next)) {
					/*propager dans les blocs de traduction des instructions*/
					for (const instruction of Object.values<any>(grammar.instructions || {})) {
						if (instruction.translation && instruction.translation[name] !== undefined) {
							renameKey(instruction.translation, name, next);
						}
					}
				}
				commitRerender();
			}));
			row.appendChild(textInput(def.extension, (v) => { def.extension = v; commit(); }, "ext"));
			/*"render via" : un niveau existant en local (registry/drafts), ou direct*/
			row.appendChild(select([{ value: "", label: "(direct)" }, ...levels], def.grammar, (v) => {
				if (v) def.grammar = v;
				else delete def.grammar;
				commitRerender();   /*les blocs de traduction changent de forme*/
			}));
			/*"render key" : quand la cible rend via un niveau chargé, proposer ses clés de traduction réelles*/
			const viaObject = def.grammar && getGrammar ? getGrammar(def.grammar) : undefined;
			const viaKeys = viaObject && viaObject.availableTranslation ? Object.keys(viaObject.availableTranslation) : [];
			const renderKeyControl: HTMLElement = viaKeys.length > 0
				? select([{ value: "", label: "(target name)" }, ...viaKeys], def.target, (v) => {
					if (v) def.target = v;
					else delete def.target;
					commit();
				})
				: textInput(def.target, (v) => { if (v.trim()) def.target = v.trim(); else delete def.target; commit(); }, "render key (optional)");
			row.appendChild(renderKeyControl);
			const check = el("span", "gf-check");
			check.title = "Prepend '#! iscode-level / iscode-version' to the generated file, so ISCode outputs stay re-translatable as-is.";
			check.appendChild(checkbox(def.emitHeader, (v) => { if (v) def.emitHeader = true; else delete def.emitHeader; commit(); }));
			check.appendChild(document.createTextNode("emit header"));
			row.appendChild(check);
			row.appendChild(iconButton("✕", "Delete target", () => { delete grammar.availableTranslation[name]; commitRerender(); }));
			table.appendChild(row);
		}
		sec.appendChild(table);
		sec.appendChild(addButton("Add target", () => {
			grammar.availableTranslation[uniqueName(Object.keys(grammar.availableTranslation), "target")] = { extension: "" };
			commitRerender();
		}));
	}

	function buildInstructions(root: HTMLElement): void {
		const sec = section(root, "Instructions", "Declaration order matters: the first regex matching a line wins.");
		const names = Object.keys(grammar.instructions || {});
		names.forEach((name, index) => {
			sec.appendChild(instructionCard(name, grammar.instructions[name], index, names.length));
		});
		sec.appendChild(addButton("Add instruction", () => {
			const newName = uniqueName(Object.keys(grammar.instructions), "instruction");
			grammar.instructions[newName] = { syntax: [], ast: { op: newName }, snippet: null, translation: {} };
			expanded.add(newName);
			commitRerender();
		}));
	}

	function instructionCard(name: string, inst: any, index: number, total: number): HTMLElement {
		const card = el("details", "gf-inst");
		card.open = expanded.has(name);
		card.addEventListener("toggle", () => {
			if (card.open) expanded.add(name);
			else expanded.delete(name);
		});

		const summary = el("summary", "gf-inst-summary");
		summary.appendChild(nameInput(name, (next) => {
			if (renameKey(grammar.instructions, name, next)) {
				expanded.delete(name);
				expanded.add(next);
			}
			commitRerender();
		}));
		summary.appendChild(el("span", "gf-badge", inst.ast && inst.ast.op ? "op: " + inst.ast.op : "no op"));
		const tools = el("span", "gf-inst-tools");
		if (index > 0) tools.appendChild(iconButton("↑", "Move up (matches first)", () => { moveKey(grammar.instructions, name, -1); commitRerender(); }));
		if (index < total - 1) tools.appendChild(iconButton("↓", "Move down", () => { moveKey(grammar.instructions, name, 1); commitRerender(); }));
		tools.appendChild(iconButton("✕", "Delete instruction", () => { delete grammar.instructions[name]; expanded.delete(name); commitRerender(); }));
		summary.appendChild(tools);
		card.appendChild(summary);

		const body = el("div", "gf-inst-body");
		body.appendChild(syntaxBlock(inst));
		body.appendChild(astBlock(inst));
		body.appendChild(snippetBlock(inst));
		body.appendChild(translationBlock(inst));
		card.appendChild(body);
		return card;
	}

	function syntaxBlock(inst: any): HTMLElement {
		const block = el("div", "gf-block");
		block.appendChild(el("div", "gf-block-title", "Syntax (ordered tokens)"));
		if (!Array.isArray(inst.syntax)) inst.syntax = [];
		const tokenNames = Object.keys(grammar.tokens || {});
		const list = el("div", "gf-table");
		inst.syntax.forEach((tokenName: string, i: number) => {
			const row = el("div", "gf-row gf-row-syntax");
			row.appendChild(el("span", "gf-index", String(i + 1)));
			row.appendChild(select(tokenNames, tokenName, (v) => { inst.syntax[i] = v; commit(); }));
			row.appendChild(iconButton("✕", "Remove token slot", () => { inst.syntax.splice(i, 1); commitRerender(); }));
			list.appendChild(row);
		});
		block.appendChild(list);
		block.appendChild(addButton("Add token slot", () => { inst.syntax.push(tokenNames[0] || ""); commitRerender(); }));
		return block;
	}

	function astBlock(inst: any): HTMLElement {
		const block = el("div", "gf-block");
		block.appendChild(el("div", "gf-block-title", "AST node"));
		if (!inst.ast || typeof inst.ast !== "object") inst.ast = {};
		const grid = el("div", "gf-grid");
		grid.appendChild(el("label", undefined, "op"));
		grid.appendChild(textInput(inst.ast.op, (v) => { inst.ast.op = v; commit(); }, "operation name"));
		block.appendChild(grid);

		/*Valeurs de champs : chaque token de syntaxe est un groupe de capture %{n}
		  (n = position dans la syntaxe). On propose la liste, le texte libre reste
		  possible pour les valeurs calculées mélangeant texte et captures
		  (ex : "[rsp+8*%{1}]").*/
		const syntax: Array<string> = Array.isArray(inst.syntax) ? inst.syntax : [];
		if (syntax.length > 0) {
			block.appendChild(el("div", "gf-hint",
				"Captures: " + syntax.map((tokenName, i) => (i + 1) + " · " + tokenName).join(", ") +
				" — pick one, or free text for computed values."));
		}
		const captures: Array<{ value: string, label: string }> = syntax.map((tokenName, i) => ({
			value: "%{" + (i + 1) + "}",
			label: (i + 1) + " · " + tokenName
		}));
		const CUSTOM: SelectOption = { value: "", label: "text…" };
		const isPureCapture = (value: any) => typeof value === "string" && /^%\{\d+\}$/.test(value);

		const list = el("div", "gf-table");
		const fieldKeys = Object.keys(inst.ast).filter((key) => key !== "op");
		for (const key of fieldKeys) {
			const row = el("div", "gf-row gf-row-ast");
			row.appendChild(nameInput(key, (next) => { renameKey(inst.ast, key, next); commitRerender(); }));

			/*Capture sélectionnée -> champ texte grisé (la valeur vient du select) ;
			  "text…" -> champ réactivé et focalisé ; saisie manuelle -> retour en mode texte*/
			let picker: HTMLSelectElement;
			const valueInput = textInput(inst.ast[key], (v) => {
				inst.ast[key] = v;
				commit();
				picker.value = isPureCapture(v) ? v : "";
				valueInput.disabled = false;
			});
			valueInput.disabled = isPureCapture(inst.ast[key]);
			valueInput.title = "Free text: computed values mixing text and captures (e.g. \"[rsp+8*%{1}]\")";
			picker = select([...captures, CUSTOM], isPureCapture(inst.ast[key]) ? inst.ast[key] : "", (v) => {
				if (v === "") {
					valueInput.disabled = false;
					valueInput.focus();
					return;
				}
				inst.ast[key] = v;
				valueInput.value = v;
				valueInput.disabled = true;
				commit();
			});
			row.appendChild(picker);
			row.appendChild(valueInput);
			row.appendChild(iconButton("✕", "Delete field", () => { delete inst.ast[key]; commitRerender(); }));
			list.appendChild(row);
		}
		block.appendChild(list);
		block.appendChild(addButton("Add field", () => {
			inst.ast[uniqueName(["op", ...fieldKeys], "field")] = captures.length > 0 ? captures[captures.length - 1].value : "";
			commitRerender();
		}));
		return block;
	}

	function snippetBlock(inst: any): HTMLElement {
		const block = el("div", "gf-block");
		block.appendChild(el("div", "gf-block-title", "Snippet (autocompletion)"));
		const grid = el("div", "gf-grid");
		const snippet = inst.snippet && typeof inst.snippet === "object" ? inst.snippet : undefined;

		/*snippet null quand tous les champs sont vides*/
		function collapse(): void {
			const s = inst.snippet;
			if (s && !s.output && !s.documentation && !s.commitChars) inst.snippet = null;
		}
		function edit(field: string, value: any): void {
			if (!inst.snippet) inst.snippet = {};
			inst.snippet[field] = value;
			collapse();
			commit();
		}

		const pair = (label: string, control: HTMLElement) => {
			grid.appendChild(el("label", undefined, label));
			grid.appendChild(control);
		};
		pair("output", textInput(snippet ? snippet.output : "", (v) => edit("output", v), "print ${1}"));
		pair("documentation", textInput(snippet ? snippet.documentation : "", (v) => edit("documentation", v), "shown in completion details"));
		pair("commitChars", textInput(snippet && Array.isArray(snippet.commitChars) ? snippet.commitChars.join(",") : "", (v) => {
			const parts = v.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
			if (parts.length > 0) edit("commitChars", parts);
			else if (inst.snippet) {
				delete inst.snippet.commitChars;
				collapse();
				commit();
			}
		}, "., (optional)"));
		block.appendChild(grid);
		return block;
	}

	function translationBlock(inst: any): HTMLElement {
		const block = el("div", "gf-block");
		block.appendChild(el("div", "gf-block-title", "Translations (per target)"));
		if (!inst.translation || typeof inst.translation !== "object") inst.translation = {};
		const targetNames = Object.keys(grammar.availableTranslation || {});
		if (targetNames.length === 0) {
			block.appendChild(el("div", "gf-hint", "No target declared yet — add one in the Targets section above."));
			return block;
		}
		const zones = Array.isArray(grammar.renderZoneOrder) && grammar.renderZoneOrder.length > 0
			? grammar.renderZoneOrder
			: ["head", "body", "tail"];

		for (const targetName of targetNames) {
			const targetDef = grammar.availableTranslation[targetName] || {};
			const viaGrammar = typeof targetDef.grammar === "string" && targetDef.grammar.length > 0;
			if (!Array.isArray(inst.translation[targetName])) inst.translation[targetName] = [];
			const entries = inst.translation[targetName];

			const group = el("div", "gf-target-group");
			const head = el("div", "gf-target-group-title");
			head.appendChild(el("code", undefined, targetName));
			if (viaGrammar) {
				/*Cible rendue via la grammaire d'un autre niveau : les entrées côté source ne servent pas*/
				head.appendChild(el("span", "gf-count", "rendered via " + targetDef.grammar));
				group.appendChild(el("div", "gf-info",
					"Rendered with the '" + targetDef.grammar + "' grammar: output lines come from that level's instructions, and pipeline passes rewrite the nodes first (e.g. resolveParams turns getParams into assign). Entries on this side are not used."));
			} else {
				head.appendChild(el("span", "gf-count", entries.length + (entries.length > 1 ? " entries" : " entry")));
				head.appendChild(addButton("Add entry", () => { entries.push({ zone: zones[0], line: "" }); commitRerender(); }));
			}
			group.appendChild(head);

			entries.forEach((entry: any, i: number) => {
				if (!entry || typeof entry !== "object") {
					entries[i] = { zone: zones[0], line: "" };
					entry = entries[i];
				}
				const row = el("div", "gf-row gf-row-entry");
				row.appendChild(select(zones, entry.zone, (v) => { entry.zone = v; commit(); }));
				const area = el("textarea", "input gf-line-area");
				area.value = Array.isArray(entry.line) ? entry.line.join("\n") : String(entry.line ?? "");
				area.rows = Math.min(6, Math.max(1, area.value.split("\n").length));
				area.placeholder = "out %{value}   (one line per output line)";
				area.addEventListener("input", () => {
					entry.line = area.value.includes("\n") ? area.value.split("\n") : area.value;
					commit();
				});
				row.appendChild(area);
				row.appendChild(iconButton("✕", "Delete entry", () => { entries.splice(i, 1); commitRerender(); }));
				group.appendChild(row);
			});
			block.appendChild(group);
		}
		return block;
	}

	/* ---------- rendu ---------- */

	function render(nextHost: HTMLElement, nextGrammar: any): void {
		host = nextHost;
		grammar = nextGrammar;
		if (!grammar || typeof grammar !== "object") {
			host.replaceChildren(el("div", "gf-hint", "Invalid grammar — fix the JSON first (JSON mode)."));
			return;
		}
		if (!grammar.tokens || typeof grammar.tokens !== "object") grammar.tokens = {};
		if (!grammar.instructions || typeof grammar.instructions !== "object") grammar.instructions = {};
		if (!grammar.availableTranslation || typeof grammar.availableTranslation !== "object") grammar.availableTranslation = {};

		const root = el("div", "gf-root");
		buildGeneral(root);
		buildTokens(root);
		buildTargets(root);
		buildInstructions(root);
		host.replaceChildren(root);
	}

	return { render };
}
