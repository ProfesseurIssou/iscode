/*Test de fumée du studio build (dist/) : charge l'app dans Chromium headless,
	vérifie l'absence d'erreurs JS, le rendu des 3 vues, et prend des captures.
	Lancement : node scripts/smoke.mjs (nécessite vite preview --port 4173)*/
import { chromium } from "playwright-core";
import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
const chromiumDir = readdirSync(playwrightCache).find((name) => /^chromium-\d+$/.test(name));
if (!chromiumDir) throw new Error("Chromium Playwright introuvable dans " + playwrightCache);
const executablePath = path.join(playwrightCache, chromiumDir, "chrome-win64", "chrome.exe");

const errors = [];
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("dialog", (dialog) => void dialog.accept());   /*confirmations de chargement de template*/
page.on("console", (message) => {
	if (message.type() === "error") errors.push("console: " + message.text());
});
page.on("pageerror", (error) => errors.push("pageerror: " + String(error)));

mkdirSync(path.join(studioDir, "smoke"), { recursive: true });

async function check(label, condition) {
	if (!condition) errors.push("check failed: " + label);
	console.log((condition ? "OK    " : "FAIL  ") + label);
}

/*--- Vue Translate ---*/
await page.goto("http://localhost:4173/#/translate", { waitUntil: "networkidle" });
await page.waitForSelector(".monaco-editor", { timeout: 15000 });
await page.waitForFunction(() => {
	const status = document.querySelector("#status");
	return status && status.textContent && !status.textContent.includes("Registry unavailable");
}, null, { timeout: 10000 });

const levelOptions = await page.locator("#level-select option").allTextContents();
await check("vue Translate : niveaux chargés depuis le registry", levelOptions.join(",").includes("isc0") && levelOptions.join(",").includes("isc1"));

const status = await page.locator("#status").textContent();
await check("vue Translate : traduction exécutée (" + (status || "").trim() + ")", /→/.test(status || "") && !/error/i.test(status || ""));

const outputText = await page.evaluate(() => {
	const lines = Array.from(document.querySelectorAll(".pane")).map((pane) => {
		const model = pane.querySelectorAll(".view-lines .view-line");
		return model.length;
	});
	return lines;
});
await check("vue Translate : les deux éditeurs ont du contenu", outputText.length >= 2 && outputText[0] > 0 && outputText[1] > 0);
await page.screenshot({ path: path.join(studioDir, "smoke", "translate.png") });

/*--- Vue Languages ---*/
await page.goto("http://localhost:4173/#/languages", { waitUntil: "networkidle" });
await page.waitForSelector(".level-card", { timeout: 10000 });
const cards = await page.locator(".level-card").count();
const chainText = await page.locator(".chain").first().textContent();
await check("vue Languages : " + cards + " cartes de niveaux", cards >= 2);
await check("vue Languages : chaîne isc1 → isc0 affichée", (chainText || "").includes("isc0"));
await page.screenshot({ path: path.join(studioDir, "smoke", "languages.png") });

/*--- Vue Language Studio ---*/
await page.goto("http://localhost:4173/#/studio", { waitUntil: "networkidle" });
await page.waitForFunction(() => {
	const status = document.querySelector("#grammar-status");
	return status && status.textContent && status.textContent.includes("instructions");
}, null, { timeout: 10000 });
const grammarStatus = await page.locator("#grammar-status").textContent();
await check("vue Studio : grammaire draft chargée (" + (grammarStatus || "").trim().slice(0, 60) + ")", /instructions/.test(grammarStatus || ""));
await page.waitForSelector("#studio-tabs .tab", { timeout: 10000 });
const tabs = await page.locator("#studio-tabs .tab").allTextContents();
await check("vue Studio : onglets de sortie présents (" + tabs.join(", ") + ")", tabs.filter((t) => /AST|Issues/.test(t)).length === 2);

/*--- Formulaire de grammaire (mode par défaut) ---*/
const instCards = await page.locator(".gf-inst").count();
await check("vue Studio : formulaire par défaut, " + instCards + " carte(s) instruction", instCards >= 1);
const addButtons = await page.locator(".gf-section .gf-add").count();
await check("vue Studio : boutons d'ajout présents (" + addButtons + ")", addButtons >= 3);

/*Ajout d'un token via le formulaire -> le pipeline live repart sans erreur*/
await page.locator(".gf-section .gf-add").first().click();
await page.waitForTimeout(600);
const statusAfterForm = await page.locator("#grammar-status").textContent();
await check("vue Studio : édition formulaire -> pipeline relancé", /instructions/.test(statusAfterForm || ""));

/*Bascule JSON <-> Form*/
await page.locator("#mode-json").click();
await page.locator("#mode-form").click();
await page.waitForTimeout(400);
const instCardsAfter = await page.locator(".gf-inst").count();
await check("vue Studio : bascule Form/JSON sans casse", instCardsAfter === instCards + 0 || instCardsAfter >= 1);

/*Template isc1 : la cible ISCode_0 rend via isc0 -> bloc d'info au lieu d'entrées inutilisées,
  et 'render via' est une liste des niveaux disponibles*/
await page.selectOption("#template-select", "isc1");
await page.locator("#load-template").click();
await page.waitForTimeout(700);
const infoCount = await page.locator(".gf-info").count();
await check("vue Studio : cible 'render via' -> info explicite (" + infoCount + " bloc)", infoCount >= 1);
const viaSelect = await page.locator(".gf-row-target select").first().textContent();
await check("vue Studio : 'render via' en liste de niveaux (" + (viaSelect || "").trim().slice(0, 40) + ")", (viaSelect || "").includes("isc0"));
const disabledValues = await page.locator(".gf-row-ast input:disabled").count();
await check("vue Studio : champ valeur grisé quand une capture est sélectionnée (" + disabledValues + ")", disabledValues >= 2);

/*Régression du cache de regex : casser la regex du token numbers via le formulaire
  -> un marqueur d'erreur apparaît dans l'exemple ; restaurer -> il disparaît SANS rechargement*/
const numbersRow = await page.evaluate(() => {
	const names = Array.from(document.querySelectorAll(".gf-row-token .gf-name"));
	return names.findIndex((node) => node.value === "numbers");
});
if (numbersRow < 0) {
	errors.push("check failed: ligne du token numbers introuvable");
} else {
	const regexInput = page.locator(".gf-row-token").nth(numbersRow).locator("input").nth(1);
	const redBefore = await page.locator("#example-editor .squiggly-error").count();
	await regexInput.fill("zzz");
	await page.waitForTimeout(800);
	const redBroken = await page.locator("#example-editor .squiggly-error").count();
	await regexInput.fill("[0-9]{1,}");
	await page.waitForTimeout(800);
	const redRestored = await page.locator("#example-editor .squiggly-error").count();
	await check("vue Studio : erreur apparaît puis disparaît sans rechargement (cache regex)",
		redBefore === 0 && redBroken > 0 && redRestored === 0);
}
await page.screenshot({ path: path.join(studioDir, "smoke", "studio-form.png") });

await browser.close();

console.log("");
if (errors.length > 0) {
	console.log("ERREURS DÉTECTÉES :");
	for (const error of errors) console.log("  " + error);
	process.exit(1);
}
console.log("SMOKE OK — aucune erreur");
