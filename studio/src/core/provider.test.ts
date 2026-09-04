import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HttpRegistryProvider, type RegistryManifest } from "./provider";
import type { LanguageJson } from "../../../src/types";

function loadRealGrammar(level: string): LanguageJson {
	const url = new URL("../../../convert/" + level + "/v1.json", import.meta.url);
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as LanguageJson;
}

function manifestOf(levels: Array<string>): RegistryManifest {
	const result: RegistryManifest = { revision: "2026-09-04T00:00:00Z", levels: {} };
	for (const level of levels) result.levels[level] = { versions: { "1": level + "/v1.json" } };
	return result;
}

/*fetch simulé : manifest + grammaires réelles servies depuis convert/ (statut HTTP pilotable par test)*/
function makeFetch(options: { failManifest?: boolean } = {}): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("manifest.json")) {
			if (options.failManifest) throw new Error("network down");
			return new Response(JSON.stringify(manifestOf(["isc0", "isc1"])), { status: 200 });
		}
		const match = url.match(/([a-z0-9]+)\/v(\d+)\.json$/);
		if (match) {
			return new Response(JSON.stringify(loadRealGrammar(match[1])), { status: 200 });
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}

describe("HttpRegistryProvider", () => {
	it("charge le registry depuis le réseau et expose niveaux et grammaires", async () => {
		const provider = new HttpRegistryProvider("grammars/", makeFetch());
		await provider.ensureLoaded();

		expect(provider.listLevels()).toEqual(["isc0", "isc1"]);
		expect(provider.listVersions("isc0")).toEqual([1]);
		expect(provider.loadGrammar("isc0").name).toBe("isc0");
		expect(provider.loadGrammar("isc0").instructions.assign).toBeDefined();
		expect(provider.status.source).toBe("network");
		expect(provider.status.revision).toBe("2026-09-04T00:00:00Z");
	});

	it("niveau inconnu -> erreur explicite", () => {
		const provider = new HttpRegistryProvider("grammars/", makeFetch());
		expect(() => provider.loadGrammar("unknowable")).toThrow(/Unknown ISCode level/);
	});

	it("repli hors-ligne sur le cache local quand le réseau échoue (même URL)", async () => {
		const online = new HttpRegistryProvider("cached/", makeFetch());
		await online.ensureLoaded();

		const offline = new HttpRegistryProvider("cached/", makeFetch({ failManifest: true }));
		await offline.ensureLoaded();

		expect(offline.status.source).toBe("cache");
		expect(offline.listLevels()).toEqual(["isc0", "isc1"]);
		expect(offline.loadGrammar("isc1").name).toBe("isc1");
	});

	it("réseau en panne sans cache correspondant -> l'erreur est propagée", async () => {
		const provider = new HttpRegistryProvider("uncached/", makeFetch({ failManifest: true }));
		await expect(provider.ensureLoaded()).rejects.toThrow(/network down/);
		expect(provider.status.source).toBe("unloaded");
	});

	it("les drafts coexistent avec le registry (prioritaires sur le niveau de même nom)", async () => {
		const provider = new HttpRegistryProvider("grammars/", makeFetch());
		await provider.ensureLoaded();

		const draft = loadRealGrammar("isc0");
		draft.instructions = { onlyOne: draft.instructions.assign };
		provider.registerDraft(draft);

		expect(provider.listLevels()).toEqual(["isc0", "isc1"]);
		expect(provider.isDraft("isc0")).toBe(true);
		expect(Object.keys(provider.loadGrammar("isc0").instructions)).toEqual(["onlyOne"]);

		provider.unregisterDraft("isc0");
		expect(provider.isDraft("isc0")).toBe(false);
		expect(Object.keys(provider.loadGrammar("isc0").instructions).length).toBeGreaterThan(1);
	});

	it("subscribe notifie les changements", async () => {
		const provider = new HttpRegistryProvider("grammars/", makeFetch());
		let notified = 0;
		provider.subscribe(() => notified++);

		await provider.ensureLoaded();
		expect(notified).toBeGreaterThan(0);

		const before = notified;
		provider.registerDraft(loadRealGrammar("isc1"));
		expect(notified).toBeGreaterThan(before);
	});
});
