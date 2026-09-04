import { appStorage } from "../core/storage";
import { DEFAULT_REGISTRY_URL, type GrammarProvider } from "../core/provider";
import type { LanguageJson, TargetDef } from "../../../src/types";
import type { View, ViewFactory } from "./view";
import { el } from "./view";

/*Chaîne de traduction d'un niveau : on suit les cibles qui rendent via une autre
	grammaire (champ "grammar") jusqu'au bout de la cascade, et on collecte les
	cibles terminales (rendues directement : nasm, isc0 identité...).*/
function computeChain(level: string, provider: GrammarProvider): { path: Array<string>, terminals: Array<string> } {
	const path = [level];
	const terminals: Array<string> = [];
	const seen = new Set([level]);
	let current = level;

	while (true) {
		let grammar: LanguageJson;
		try {
			grammar = provider.loadGrammar(current);
		} catch {
			break;
		}
		let next: string | undefined;
		for (const [name, def] of Object.entries(grammar.availableTranslation || {})) {
			const targetDef = def as TargetDef;
			if (targetDef.grammar && !seen.has(targetDef.grammar)) next = targetDef.grammar;
			else if (!targetDef.grammar) terminals.push(name + " (." + targetDef.extension + ")");
		}
		if (!next) break;
		seen.add(next);
		path.push(next);
		current = next;
	}
	return { path, terminals };
}

function timeLabel(iso: string | undefined): string {
	if (!iso) return "never";
	try {
		return new Date(iso).toLocaleTimeString();
	} catch {
		return iso;
	}
}

function chainBadges(level: string, provider: GrammarProvider): HTMLElement {
	const wrap = el("div", "badges chain");
	const chain = computeChain(level, provider);
	chain.path.forEach((name, index) => {
		if (index > 0) wrap.appendChild(el("span", "chain-arrow", "→"));
		const badge = el("span", "badge badge-level", name);
		if (index === 0) badge.classList.add("badge-source");
		wrap.appendChild(badge);
	});
	if (chain.terminals.length > 0) {
		wrap.appendChild(el("span", "chain-arrow", "⇒"));
		for (const terminal of chain.terminals) wrap.appendChild(el("span", "badge badge-terminal", terminal));
	}
	return wrap;
}

function levelCard(level: string, provider: GrammarProvider): HTMLElement {
	const card = el("div", "card level-card");

	const header = el("div", "card-header");
	header.appendChild(el("h3", "card-title", level));
	if (provider.isDraft(level)) {
		header.appendChild(el("span", "badge badge-draft", "draft"));
		const removeBtn = el("button", "btn btn-small", "Remove draft");
		removeBtn.addEventListener("click", () => provider.unregisterDraft(level));
		header.appendChild(removeBtn);
	} else {
		header.appendChild(el("span", "badge", "v" + provider.listVersions(level).join(", v")));
	}
	card.appendChild(header);

	try {
		const grammar = provider.loadGrammar(level);
		const meta = el("div", "meta");
		meta.textContent =
			Object.keys(grammar.instructions || {}).length + " instructions · " +
			Object.keys(grammar.tokens || {}).length + " tokens" +
			(grammar.pipeline && grammar.pipeline.length > 0 ? " · passes: " + grammar.pipeline.join(", ") : "");
		card.appendChild(meta);
		card.appendChild(chainBadges(level, provider));

		const targets = el("div", "target-list");
		for (const [name, def] of Object.entries(grammar.availableTranslation || {})) {
			const targetDef = def as TargetDef;
			const row = el("div", "target-row");
			row.appendChild(el("code", undefined, name));
			const details: Array<string> = ["." + targetDef.extension];
			if (targetDef.grammar) details.push("renders via " + targetDef.grammar);
			if (targetDef.emitHeader) details.push("emits header");
			row.appendChild(el("span", "muted", details.join(" · ")));
			targets.appendChild(row);
		}
		card.appendChild(targets);
	} catch (error) {
		card.appendChild(el("div", "meta error", String(error)));
	}
	return card;
}

/*Vue Languages : niveaux disponibles (registry + drafts), chaîne de traduction,
	cibles, et réglages du registry (URL, refresh, statut réseau/cache).*/
export function createLanguagesView(ctx: { provider: GrammarProvider }): View {
	const provider = ctx.provider;
	let container: HTMLElement;
	let cardsHost: HTMLElement;
	let urlInput: HTMLInputElement;
	let statusLine: HTMLElement;
	let unsubscribe: (() => void) | undefined;

	function renderStatus(): void {
		const status = provider.status;
		const parts: Array<string> = [];
		parts.push("source: " + status.source);
		if (status.revision) parts.push("revision: " + status.revision.slice(0, 19).replace("T", " "));
		parts.push("checked: " + timeLabel(status.lastCheck));
		if (status.lastError && status.source === "cache") parts.push("offline (cached copy)");
		statusLine.textContent = parts.join("   ·   ");
	}

	function renderCards(): void {
		cardsHost.replaceChildren();
		for (const level of provider.listLevels()) cardsHost.appendChild(levelCard(level, provider));
		if (cardsHost.childElementCount === 0) {
			cardsHost.appendChild(el("div", "meta", "No language available."));
		}
	}

	function renderAll(): void {
		renderCards();
		renderStatus();
		urlInput.value = provider.status.baseUrl;
	}

	async function mount(root: HTMLElement): Promise<void> {
		container = el("div", "view languages-view");

		const settings = el("div", "card settings-card");
		settings.appendChild(el("h3", "card-title", "Grammar registry"));
		const row = el("div", "toolbar-row");
		const label = el("label", "field");
		label.appendChild(document.createTextNode("URL "));
		urlInput = document.createElement("input");
		urlInput.type = "text";
		urlInput.className = "input";
		urlInput.placeholder = DEFAULT_REGISTRY_URL;
		label.appendChild(urlInput);
		row.appendChild(label);

		const applyBtn = el("button", "btn", "Apply");
		applyBtn.addEventListener("click", async () => {
			provider.setBaseUrl(urlInput.value.trim() || DEFAULT_REGISTRY_URL);
			await provider.ensureLoaded().catch(() => undefined);
			renderAll();
		});
		row.appendChild(applyBtn);

		const resetBtn = el("button", "btn", "Reset");
		resetBtn.addEventListener("click", async () => {
			provider.setBaseUrl(DEFAULT_REGISTRY_URL);
			await provider.ensureLoaded().catch(() => undefined);
			renderAll();
		});
		row.appendChild(resetBtn);

		const refreshBtn = el("button", "btn btn-primary", "Refresh");
		refreshBtn.addEventListener("click", async () => {
			refreshBtn.disabled = true;
			await provider.refresh().catch(() => undefined);
			refreshBtn.disabled = false;
			renderAll();
		});
		row.appendChild(refreshBtn);
		settings.appendChild(row);
		statusLine = el("div", "meta status-line");
		settings.appendChild(statusLine);
		settings.appendChild(el("div", "hint",
			"The default registry is bundled with the app (generated from convert/). Point the URL to your own server to distribute and auto-update grammars."));
		container.appendChild(settings);

		cardsHost = el("div", "cards");
		container.appendChild(cardsHost);
		root.appendChild(container);

		unsubscribe = provider.subscribe(renderStatus);

		try {
			await provider.ensureLoaded();
		} catch {
			/*statut affiché par renderStatus*/
		}
		renderAll();
	}

	function unmount(): void {
		if (unsubscribe) unsubscribe();
		container.remove();
	}

	return { mount, unmount };
}

export const languagesViewFactory: ViewFactory = createLanguagesView;
