import { defineConfig } from "vite";

/*base "./" : le build fonctionne depuis n'importe quel sous-dossier statique
  (le futur serveur de grammaires peut aussi servir le studio).*/
export default defineConfig({
	base: "./",
	build: {
		outDir: "dist",
		chunkSizeWarningLimit: 6000
	}
});
