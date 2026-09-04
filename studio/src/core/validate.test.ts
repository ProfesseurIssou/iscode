import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleLine, validateGrammar } from "./validate";
import type { LanguageJson } from "../../../src/types";

function loadRealGrammar(level: string, version: number): LanguageJson {
	const url = new URL("../../../convert/" + level + "/v" + version + ".json", import.meta.url);
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as LanguageJson;
}

describe("sampleLine (matérialisation d'un snippet)", () => {
	it("remplace les choix par le premier", () => {
		expect(sampleLine("mode ${1|8,16,32,64|}")).toBe("mode 8");
	});

	it("remplace les placeholders génériques par une valeur neutre", () => {
		expect(sampleLine("print ${1}")).toBe("print sample");
		expect(sampleLine("${1} = prm${2|0,1|}")).toBe("sample = prm0");
	});

	it("retourne null pour un snippet vide", () => {
		expect(sampleLine("")).toBeNull();
	});
});

describe("validateGrammar", () => {
	it("les grammaires réelles isc0 et isc1 v1 n'ont aucune issue", () => {
		expect(validateGrammar(loadRealGrammar("isc0", 1))).toEqual([]);
		expect(validateGrammar(loadRealGrammar("isc1", 1))).toEqual([]);
	});

	it("token référencé inexistant -> erreur pointée", () => {
		const grammar: any = loadRealGrammar("isc0", 1);
		grammar.version = 99;
		grammar.instructions.defineTen.syntax = ["indentation", "Inconnu"];
		const issues = validateGrammar(grammar);
		const missing = issues.find((issue) => issue.message.includes("Inconnu"));
		expect(missing?.severity).toBe("error");
		expect(missing?.path).toBe("instructions.defineTen.syntax[1]");
	});

	it("cible déclarée sans 'grammar' : chaque instruction doit avoir une traduction", () => {
		const grammar: any = {
			name: "t", version: 1,
			renderZoneOrder: ["head", "body", "tail"],
			availableTranslation: { out: { extension: "out" } },
			tokens: { indentation: "^[ ]{0,}", space: "[ ]{1,}", word: "[a-z]+" },
			instructions: {
				avec: {
					syntax: ["indentation", "word"],
					ast: { op: "avec" },
					translation: { out: [{ zone: "body", line: "a" }] }
				},
				sans: { syntax: ["indentation", "word"], ast: { op: "sans" }, translation: {} }
			}
		};
		const issues = validateGrammar(grammar);
		const coverage = issues.find((issue) => issue.message.includes("no translation"));
		expect(coverage?.severity).toBe("error");
		expect(coverage?.message).toContain("sans");
	});

	it("cible rendant via une autre grammaire (champ grammar) : pas de contrôle de couverture", () => {
		const grammar: any = {
			name: "t", version: 1,
			availableTranslation: { lower: { extension: "low", grammar: "isc0" } },
			tokens: { indentation: "^[ ]{0,}", space: "[ ]{1,}", word: "[a-z]+" },
			instructions: {
				sans: { syntax: ["indentation", "word"], ast: { op: "sans" }, translation: {} }
			}
		};
		expect(validateGrammar(grammar).filter((issue) => issue.message.includes("no translation"))).toEqual([]);
	});

	it("instruction masquée par une instruction déclarée avant elle", () => {
		const grammar: any = {
			name: "t", version: 1,
			renderZoneOrder: ["head", "body", "tail"],
			availableTranslation: { out: { extension: "out" } },
			tokens: {
				indentation: "^[ ]{0,}", space: "[ ]{1,}",
				word: "[a-z]+", numbers: "[0-9]+", InstHello: "hello"
			},
			instructions: {
				generic: {
					syntax: ["indentation", "word", "space", "numbers"],
					ast: { op: "generic" },
					snippet: { output: "abc 1" },
					translation: { out: [{ zone: "body", "line": "g" }] }
				},
				specific: {
					syntax: ["indentation", "InstHello", "space", "numbers"],
					ast: { op: "specific" },
					snippet: { output: "hello 2" },
					translation: { out: [{ zone: "body", "line": "s" }] }
				}
			}
		};
		const issues = validateGrammar(grammar);
		const shadow = issues.find((issue) => issue.message.includes("unreachable"));
		expect(shadow?.severity).toBe("error");
		expect(shadow?.path).toBe("instructions.specific");
		expect(shadow?.message).toContain("generic");
		expect(shadow?.message).toContain("hello 2");
	});

	it("zone de rendu inconnue -> avertissement", () => {
		const grammar: any = {
			name: "t", version: 1,
			renderZoneOrder: ["head", "body", "tail"],
			availableTranslation: { out: { extension: "out" } },
			tokens: { indentation: "^[ ]{0,}", word: "[a-z]+" },
			instructions: {
				x: {
					syntax: ["indentation", "word"],
					ast: { op: "x" },
					translation: { out: [{ zone: "mid", line: "?" }] }
				}
			}
		};
		const issues = validateGrammar(grammar);
		expect(issues.some((issue) => issue.severity === "warning" && issue.message.includes("'mid'"))).toBe(true);
	});

	it("ast.op manquant -> erreur", () => {
		const grammar: any = {
			name: "t", version: 1,
			availableTranslation: { out: { extension: "out" } },
			tokens: { indentation: "^[ ]{0,}", word: "[a-z]+" },
			instructions: { x: { syntax: ["indentation", "word"], ast: {}, translation: { out: [] } } }
		};
		expect(validateGrammar(grammar).some((issue) => issue.path === "instructions.x.ast")).toBe(true);
	});

	it("cible sans extension -> avertissement", () => {
		const grammar: any = {
			name: "t", version: 1,
			availableTranslation: { out: {} },
			tokens: { indentation: "^[ ]{0,}", word: "[a-z]+" },
			instructions: { x: { syntax: ["indentation", "word"], ast: { op: "x" }, translation: {} } }
		};
		expect(validateGrammar(grammar).some((issue) => issue.path === "availableTranslation.out")).toBe(true);
	});
});
