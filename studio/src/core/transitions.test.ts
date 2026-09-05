import { describe, expect, it } from "vitest";
import { buildTransitionGraph, layoutTransitionGraph } from "./transitions";
import type { GrammarProvider, RegistryStatus } from "./provider";
import type { LanguageJson, TargetDef } from "../../../src/types";

/*Stub structurel du provider (même interface GrammarProvider, données en dur)*/
function stubProvider(grammars: Record<string, LanguageJson>, drafts: Array<string> = []): GrammarProvider {
	const levels = Object.keys(grammars);
	return {
		status: { baseUrl: "test:", source: "draft" } as RegistryStatus,
		subscribe: () => () => undefined,
		setBaseUrl: () => undefined,
		ensureLoaded: async () => undefined,
		refresh: async () => undefined,
		listLevels: () => levels,
		listVersions: (level) => (grammars[level] ? [grammars[level].version] : []),
		isDraft: (level) => drafts.indexOf(level) >= 0,
		loadGrammar: (level) => {
			const grammar = grammars[level];
			if (!grammar) throw new Error("Unknown ISCode level: " + level);
			return grammar;
		},
		registerDraft: () => undefined,
		unregisterDraft: () => undefined
	};
}

function grammar(name: string, availableTranslation: LanguageJson["availableTranslation"]): LanguageJson {
	return { name, version: 1, availableTranslation, tokens: {}, instructions: {} } as unknown as LanguageJson;
}

const toIs0: TargetDef = { extension: "isc0", grammar: "isc0", target: "isc0", emitHeader: true };

describe("arbre de transitions (construction)", () => {
	it("construit les noeuds et arêtes de la cascade isc2/isc1 -> isc0 -> sorties", () => {
		const provider = stubProvider({
			isc2: grammar("isc2", { ISCode_0: toIs0 }),
			isc1: grammar("isc1", { ISCode_0: toIs0 }),
			isc0: grammar("isc0", { isc0: { extension: "isc0", emitHeader: true }, nasm_x86_x64: { extension: "nasm" } })
		});

		const graph = buildTransitionGraph(provider);

		const levels = graph.nodes.filter((n) => n.kind === "level").map((n) => (n as { level: string }).level);
		expect(levels).toEqual(["isc2", "isc1", "isc0"]);
		const outputs = graph.nodes.filter((n) => n.kind === "output").map((n) => (n as { output: string }).output);
		expect(outputs).toEqual([".isc0", ".nasm"]);

		expect(graph.edges).toEqual([
			{ from: "isc2", to: "isc0", toKind: "level", label: "ISCode_0", emitHeader: true },
			{ from: "isc1", to: "isc0", toKind: "level", label: "ISCode_0", emitHeader: true },
			{ from: "isc0", to: ".isc0", toKind: "output", label: "isc0", emitHeader: true },
			{ from: "isc0", to: ".nasm", toKind: "output", label: "nasm_x86_x64", emitHeader: undefined }
		]);
	});

	it("fusionne les cibles qui pointent au même endroit", () => {
		const provider = stubProvider({
			isc0: grammar("isc0", { nasm_a: { extension: "nasm" }, nasm_b: { extension: "nasm" } })
		});

		const graph = buildTransitionGraph(provider);

		expect(graph.edges.length).toBe(1);
		expect(graph.edges[0].label).toBe("nasm_a / nasm_b");
		expect(graph.edges[0].to).toBe(".nasm");
	});

	it("une cible vers un niveau absent du provider devient un noeud manquant", () => {
		const provider = stubProvider({
			isc1: grammar("isc1", { ISCode_0: { extension: "isc0", grammar: "isc9" } })
		});

		const graph = buildTransitionGraph(provider);

		const missing = graph.nodes.find((n) => n.kind === "level" && (n as { level: string }).level === "isc9");
		expect(missing).toBeDefined();
		expect((missing as { missing?: boolean }).missing).toBe(true);
	});

	it("un niveau dont la grammaire est illisible est ignoré sans casser le graphe", () => {
		const provider = stubProvider({
			isc0: grammar("isc0", { nasm_x86_x64: { extension: "nasm" } })
		});
		(provider as { listLevels: () => Array<string> }).listLevels = () => ["cassé", "isc0"];
		/*loadGrammar lève pour "cassé" (absent du stub) et réussit pour isc0*/

		const graph = buildTransitionGraph(provider);

		const levels = graph.nodes.filter((n) => n.kind === "level").map((n) => (n as { level: string }).level);
		expect(levels).toEqual(["isc0"]);
	});
});

describe("arbre de transitions (layout)", () => {
	function sampleGraph() {
		const provider = stubProvider({
			isc2: grammar("isc2", { ISCode_0: toIs0 }),
			isc1: grammar("isc1", { ISCode_0: toIs0 }),
			isc0: grammar("isc0", { nasm_x86_x64: { extension: "nasm" } })
		});
		return buildTransitionGraph(provider);
	}

	it("place les sources en haut, le niveau commun en dessous, les sorties en dernière ligne", () => {
		const layout = layoutTransitionGraph(sampleGraph());

		const rowOf = (key: string) => {
			const box = layout.boxes.find((b) => b.key === key);
			expect(box).toBeDefined();
			return box!.row;
		};
		expect(rowOf("isc2")).toBe(0);
		expect(rowOf("isc1")).toBe(0);
		expect(rowOf("isc0")).toBe(1);
		expect(rowOf(".nasm")).toBe(2);

		/*isc2 et isc1 sur la même ligne, centrés de part et d'autre de isc0*/
		const isc2 = layout.boxes.find((b) => b.key === "isc2")!;
		const isc1 = layout.boxes.find((b) => b.key === "isc1")!;
		const isc0 = layout.boxes.find((b) => b.key === "isc0")!;
		expect(isc0.x).toBeGreaterThan(isc2.x);
		expect(isc0.x).toBeLessThan(isc1.x);

		expect(layout.edges.length).toBe(3);
		expect(layout.width).toBeGreaterThan(0);
		expect(layout.height).toBeGreaterThan(0);

		/*les arêtes vont du bas de la source (haut du dessin) vers le haut de la cible (dessous)*/
		const first = layout.edges[0];
		expect(first.y2).toBeGreaterThan(first.y1);
	});

	it("un cycle de grammaires ne provoque pas de boucle infinie", () => {
		const provider = stubProvider({
			a: grammar("a", { toB: { extension: "b", grammar: "b" } }),
			b: grammar("b", { toA: { extension: "a", grammar: "a" } })
		});

		expect(() => layoutTransitionGraph(buildTransitionGraph(provider))).not.toThrow();
	});

	it("graphe vide : layout minimal sans exception", () => {
		const layout = layoutTransitionGraph({ nodes: [], edges: [] });
		expect(layout.boxes).toEqual([]);
		expect(layout.width).toBeGreaterThan(0);
	});
});
