/*Génère le registry statique des grammaires (studio/public/grammars/) depuis convert/ :
  - copie chaque convert/<niveau>/v<N>.json vers public/grammars/<niveau>/v<N>.json
  - écrit manifest.json (révision + niveaux + chemin de chaque version, relatif au manifest)
En dev, Vite sert ce dossier tel quel ; en production, c'est le contenu à déployer
sur le serveur de grammaires — l'URL du registry est configurable dans la vue Languages.*/
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const convertDir = path.join(studioDir, "..", "convert");
const outDir = path.join(studioDir, "public", "grammars");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const levels = {};
for (const entry of await readdir(convertDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const versions = {};
	for (const file of await readdir(path.join(convertDir, entry.name))) {
		const match = file.match(/^v(\d+)\.json$/);
		if (!match) continue;
		await mkdir(path.join(outDir, entry.name), { recursive: true });
		await cp(path.join(convertDir, entry.name, file), path.join(outDir, entry.name, file));
		versions[match[1]] = `${entry.name}/v${match[1]}.json`;
	}
	if (Object.keys(versions).length > 0) levels[entry.name] = { versions };
}

const manifest = {
	revision: new Date().toISOString(),
	levels
};
await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Registry built: ${Object.keys(levels).join(", ")} -> ${path.relative(studioDir, outDir)}`);
