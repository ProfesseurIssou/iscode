import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReverseMap, resolveTarget, translate } from "./pipeline";
import type { LanguageJson } from "../../../src/types";

function readRepo(...parts: Array<string>): string {
	return readFileSync(fileURLToPath(new URL("../../../" + parts.join("/"), import.meta.url)), "utf8");
}

function loadGrammar(level: string): LanguageJson {
	return JSON.parse(readRepo("convert", level, "v1.json")) as LanguageJson;
}

/*Même assertions que les tests pipeline de l'extension, mais à travers l'adaptateur du studio*/
describe("pipeline du studio (adapter translate)", () => {
	it("isc0 -> nasm : sortie identique à samples/expected + source map", () => {
		const grammar = loadGrammar("isc0");
		const content = readRepo("samples", "main.isc0");
		const resolved = resolveTarget(grammar, "nasm_x86_x64", () => undefined);

		const result = translate(content, "main.isc0", grammar, resolved);

		expect(result.errors).toEqual([]);
		expect(result.renderError).toBeUndefined();
		expect(result.text).toBe(readRepo("samples", "expected", "main.isc0.nasm").replace(/\r\n/g, "\n"));
		expect(result.map["7"].line).toBe(9);
		expect(result.map["16"].line).toBe(18);
		expect(result.map["21"].line).toBe(17);
	});

	it("isc1 -> isc0 : passe resolveParams + grammaire de sortie + header émis", () => {
		const grammar = loadGrammar("isc1");
		const isc0 = loadGrammar("isc0");
		const content = readRepo("samples", "main.isc1");
		const resolved = resolveTarget(grammar, "ISCode_0", (level) => (level === "isc0" ? isc0 : undefined));

		const result = translate(content, "main.isc1", grammar, resolved);

		expect(result.errors).toEqual([]);
		expect(result.text).toBe(readRepo("samples", "expected", "main.isc1.isc0").replace(/\r\n/g, "\n"));
		expect(result.text.startsWith("#! iscode-level: isc0")).toBe(true);
	});

	it("lignes non reconnues : collectées, la traduction continue", () => {
		const grammar = loadGrammar("isc0");
		const resolved = resolveTarget(grammar, "nasm_x86_x64", () => undefined);
		const result = translate("mode 64\n??? 123\n", "x.isc0", grammar, resolved);

		expect(result.errors.length).toBe(1);
		expect(result.errors[0].line).toBe(2);
		expect(result.text).toContain("bits 64");
	});

	it("erreur de rendu (op sans traduction pour la cible) rendue dans renderError, sans lever", () => {
		const grammar: any = loadGrammar("isc0");
		delete grammar.instructions.assign.translation.nasm_x86_x64;
		const resolved = resolveTarget(grammar, "nasm_x86_x64", () => undefined);

		const result = translate("rax = 60\n", "x.isc0", grammar, resolved);

		expect(result.renderError).toMatch(/Pas de rendu/);
		expect(result.text).toBe("");

		/*cible inconnue : resolveTarget lève explicitement*/
		expect(() => resolveTarget(grammar, "cible_inexistante", () => undefined)).toThrow(/Unknown target/);
	});

	it("buildReverseMap : ligne source -> lignes de sortie triées", () => {
		const reverse = buildReverseMap({
			"7": { file: "a", level: "isc0", version: 1, line: 9 },
			"8": { file: "a", level: "isc0", version: 1, line: 9 },
			"21": { file: "a", level: "isc0", version: 1, line: 17 }
		});
		expect(reverse.get(9)).toEqual([7, 8]);
		expect(reverse.get(17)).toEqual([21]);
		expect(reverse.get(999)).toBeUndefined();
	});
});
