import { LanguageJson } from "../../../src/types";
import { pickVersion } from "../../../src/grammar";
import { appStorage } from "./storage";

/*MANIFEST du registry : révision + niveaux + chemin de chaque version (relatif à l'URL de base)*/
export interface RegistryManifest {
	revision: string,
	levels: { [level: string]: { versions: { [version: string]: string } } }
}

export type GrammarSource = "network" | "cache" | "draft";

export interface RegistryStatus {
	baseUrl: string,
	revision?: string,
	source: GrammarSource | "unloaded",
	lastCheck?: string,              /*ISO*/
	lastError?: string
}

/*Cache local complet : permet le repli hors-ligne quand le registry ne répond pas*/
interface RegistryCache {
	baseUrl: string,
	revision: string,
	grammars: { [key: string]: LanguageJson }      /*"level@v<n>" -> grammaire*/
}

export const DEFAULT_REGISTRY_URL = "grammars/";
const REGISTRY_URL_KEY = "iscode-studio:registry-url";
const CACHE_KEY = "iscode-studio:registry-cache";

/*Résout une URL relative : contre l'origine du document dans le navigateur,
	en simple concaténation hors navigateur (tests).*/
function resolveUrl(base: string, relative: string): string {
	if (typeof location !== "undefined") {
		return new URL(relative, new URL(base, location.href)).href;
	}
	return base.replace(/\/?$/, "/") + relative;
}

type Listener = () => void;

/*Contrat consommé par les vues (structurellement satisfait par HttpRegistryProvider)*/
export interface GrammarProvider {
	readonly status: RegistryStatus;
	subscribe(listener: Listener): () => void;
	setBaseUrl(url: string): void;
	ensureLoaded(): Promise<void>;
	refresh(): Promise<void>;
	listLevels(): Array<string>;
	listVersions(level: string): Array<number>;
	isDraft(level: string): boolean;
	loadGrammar(level: string, version?: number): LanguageJson;
	registerDraft(grammar: LanguageJson): void;
	unregisterDraft(level: string): void;
}

/*Source de grammaires de l'application :
  - registry HTTP (manifest.json + grammaires), mis en cache dans localStorage
    avec repli hors-ligne si le serveur ne répond pas ;
  - drafts locaux enregistrés par la vue Language Studio (prioritaires, même nom).
  Le registry par défaut (public/grammars/, généré depuis convert/) joue en dev le
  rôle du futur serveur : changer l'URL dans la vue Languages suffit à pointer ailleurs.*/
export class HttpRegistryProvider implements GrammarProvider {
	private manifest: RegistryManifest | undefined;
	private grammars = new Map<string, LanguageJson>();
	private drafts = new Map<string, LanguageJson>();
	private listeners = new Set<Listener>();
	private fetchImpl: typeof fetch;
	private _status: RegistryStatus;

	constructor(baseUrl?: string, fetchImpl?: typeof fetch) {
		this.fetchImpl = fetchImpl || ((input, init) => fetch(input, init));
		this._status = { baseUrl: baseUrl ?? appStorage.get(REGISTRY_URL_KEY, DEFAULT_REGISTRY_URL), source: "unloaded" };
	}

	get status(): RegistryStatus {
		return this._status;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of Array.from(this.listeners)) listener();
	}

	/*Change l'URL du registry (persistée) et remet l'état à zéro ; appeler ensureLoaded() ensuite*/
	setBaseUrl(url: string): void {
		this._status = { baseUrl: url, source: "unloaded" };
		this.manifest = undefined;
		this.grammars.clear();
		appStorage.set(REGISTRY_URL_KEY, url);
		this.notify();
	}

	/*Charge le registry une seule fois (les vues appellent ça avant de lister)*/
	async ensureLoaded(): Promise<void> {
		if (this.manifest) return;
		await this.refresh();
	}

	/*Recharge tout depuis le réseau ; en cas d'échec, repli sur le cache local
	  si l'URL correspond, sinon l'erreur est propagée (pas de grammaire disponible).*/
	async refresh(): Promise<void> {
		const baseUrl = this._status.baseUrl;
		try {
			const manifestResponse = await this.fetchImpl(resolveUrl(baseUrl, "manifest.json"), { cache: "no-cache" });
			if (!manifestResponse.ok) throw new Error("HTTP " + manifestResponse.status + " for manifest.json");
			const manifest = await manifestResponse.json() as RegistryManifest;

			const grammars = new Map<string, LanguageJson>();
			for (const [level, info] of Object.entries(manifest.levels || {})) {
				for (const [version, file] of Object.entries(info.versions || {})) {
					const grammarResponse = await this.fetchImpl(resolveUrl(baseUrl, file));
					if (!grammarResponse.ok) throw new Error("HTTP " + grammarResponse.status + " for " + file);
					grammars.set(level + "@v" + version, await grammarResponse.json() as LanguageJson);
				}
			}

			this.manifest = manifest;
			this.grammars = grammars;
			this._status = { baseUrl, revision: manifest.revision, source: "network", lastCheck: new Date().toISOString() };
			const cache: RegistryCache = { baseUrl, revision: manifest.revision, grammars: Object.fromEntries(grammars) };
			appStorage.set(CACHE_KEY, cache);
			this.notify();
		} catch (error) {
			const cache = appStorage.get<RegistryCache | null>(CACHE_KEY, null);
			if (cache && cache.baseUrl === baseUrl && Object.keys(cache.grammars).length > 0) {
				this.grammars = new Map(Object.entries(cache.grammars));
				this.manifest = manifestFromCache(cache);
				this._status = { baseUrl, revision: cache.revision, source: "cache", lastError: String(error) };
				this.notify();
				return;
			}
			this._status = { baseUrl, source: "unloaded", lastError: String(error) };
			this.notify();
			throw error;
		}
	}

	/*Niveaux disponibles : drafts d'abord, puis niveaux du registry (un draft masque le niveau de même nom)*/
	listLevels(): Array<string> {
		const registryLevels = this.manifest ? Object.keys(this.manifest.levels) : [];
		return [...this.drafts.keys(), ...registryLevels.filter((level) => !this.drafts.has(level))];
	}

	listVersions(level: string): Array<number> {
		const info = this.manifest ? this.manifest.levels[level] : undefined;
		if (!info) return [];
		return Object.keys(info.versions).map(Number).sort((a, b) => a - b);
	}

	isDraft(level: string): boolean {
		return this.drafts.has(level);
	}

	/*Charge une grammaire : draft si le nom correspond, sinon le registry
	  (version demandée si elle existe, sinon la plus récente).*/
	loadGrammar(level: string, version?: number): LanguageJson {
		const draft = this.drafts.get(level);
		if (draft) return draft;

		const info = this.manifest ? this.manifest.levels[level] : undefined;
		if (!info) throw new Error("Unknown ISCode level: " + level);

		const picked = pickVersion(Object.keys(info.versions).map(Number).sort((a, b) => a - b), version, level);
		const grammar = this.grammars.get(level + "@v" + picked.version);
		if (!grammar) throw new Error("Grammar " + level + " v" + picked.version + " not loaded");
		return grammar;
	}

	registerDraft(grammar: LanguageJson): void {
		if (!grammar || !grammar.name) return;
		this.drafts.set(grammar.name, grammar);
		this.notify();
	}

	unregisterDraft(level: string): void {
		if (this.drafts.delete(level)) this.notify();
	}
}

/*Reconstruit un manifest depuis les clés du cache ("level@v<n>")*/
function manifestFromCache(cache: RegistryCache): RegistryManifest {
	const levels: RegistryManifest["levels"] = {};
	for (const key of Object.keys(cache.grammars)) {
		const at = key.lastIndexOf("@v");
		if (at < 0) continue;
		const level = key.slice(0, at);
		const version = key.slice(at + 2);
		if (!levels[level]) levels[level] = { versions: {} };
		levels[level].versions[version] = level + "/v" + version + ".json";
	}
	return { revision: cache.revision, levels };
}
