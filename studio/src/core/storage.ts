/*Petite couche de persistance : localStorage dans le navigateur, avec repli mémoire
(tests Node, contextes restreints). Toutes les valeurs sont stockées en JSON.*/

const memory = new Map<string, string>();

function backingStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
	try {
		if (typeof localStorage !== "undefined") return localStorage;
	} catch {
		/*accès localStorage interdit (sandbox) : repli mémoire*/
	}
	return {
		getItem: (key: string) => memory.get(key) ?? null,
		setItem: (key: string, value: string) => void memory.set(key, value),
		removeItem: (key: string) => void memory.delete(key)
	};
}

export const appStorage = {
	get<T>(key: string, fallback: T): T {
		const raw = backingStorage().getItem(key);
		if (raw === null) return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return fallback;
		}
	},
	set(key: string, value: unknown): void {
		backingStorage().setItem(key, JSON.stringify(value));
	},
	remove(key: string): void {
		backingStorage().removeItem(key);
	}
};
