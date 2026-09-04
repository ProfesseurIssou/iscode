import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMonarch, literalAlternatives } from "./monarch";
import type { LanguageJson } from "../../../src/types";

function loadRealGrammar(level: string): LanguageJson {
	const url = new URL("../../../convert/" + level + "/v1.json", import.meta.url);
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as LanguageJson;
}

describe("literalAlternatives", () => {
	it("détecte les mots purs et leurs alternances", () => {
		expect(literalAlternatives("mode")).toEqual(["mode"]);
		expect(literalAlternatives("byte|BYTE")).toEqual(["byte", "BYTE"]);
		expect(literalAlternatives("CONST:")).toEqual(["CONST:"]);
	});

	it("rejette les tokens génériques", () => {
		expect(literalAlternatives("^[ ]{0,}")).toBeNull();
		expect(literalAlternatives("[a-zA-Z0-9_]{1,}")).toBeNull();
		expect(literalAlternatives("[/]{2}")).toBeNull();
		expect(literalAlternatives("")).toBeNull();
	});
});

describe("buildMonarch", () => {
	it("génère des mots-clés depuis les tokens littéraux de la grammaire isc0", () => {
		const monarch = buildMonarch(loadRealGrammar("isc0"));
		const rules = monarch.tokenizer.root;
		const keywordRule = rules.find((rule) => rule[1] === "keyword" && String(rule[0]).includes("(?<!["));
		expect(keywordRule).toBeDefined();

		const pattern = new RegExp(String(keywordRule![0]));
		for (const word of ["mode", "CONST:", "byte", "BYTE", "func", "syscall", "equ", "reserve"]) {
			expect(pattern.test(word)).toBe(true);
		}
	});

	it("les mots-clés ne matchent pas à l'intérieur d'un identifiant", () => {
		const monarch = buildMonarch(loadRealGrammar("isc0"));
		const keywordRule = monarch.tokenizer.root.find((rule) => rule[1] === "keyword" && String(rule[0]).includes("(?<!["));
		const pattern = new RegExp(String(keywordRule![0]));
		expect(pattern.test("remode")).toBe(false);
		expect(pattern.test("xCONST:")).toBe(false);
		expect(pattern.test("mode 64")).toBe(true);
	});

	it("contient les règles conventionnelles (meta, commentaire, chaîne, nombre)", () => {
		const monarch = buildMonarch(loadRealGrammar("isc1"));
		const sources = monarch.tokenizer.root.map((rule) => String(rule[0]));
		expect(sources.some((source) => source.includes("#!"))).toBe(true);
		expect(sources.some((source) => new RegExp(source).test("// a comment"))).toBe(true);
		expect(sources.some((source) => new RegExp(source).test("'a string'"))).toBe(true);
		expect(sources.some((source) => /\\d/.test(source))).toBe(true);
	});

	it("toutes les règles générées compilent en RegExp", () => {
		for (const level of ["isc0", "isc1"]) {
			for (const rule of buildMonarch(loadRealGrammar(level)).tokenizer.root) {
				expect(() => new RegExp(String(rule[0]))).not.toThrow();
			}
		}
	});
});
