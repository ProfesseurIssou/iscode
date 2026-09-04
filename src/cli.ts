/* eslint-disable @typescript-eslint/naming-convention */
/*CLI de traduction ISCode, sans vscode (même pipeline que l'extension) :
  node out/cli.js <fichier.isc0|isc1...> [cible]
Écrit le fichier traduit + sa source map (.map) à côté du fichier source.*/
import * as fs from "fs";
import * as path from "path";
import * as language from "./language";
import * as parser from "./parser";
import * as passes from "./passes";
import * as render from "./render";

/*out/cli.js -> racine du projet (là où se trouve convert/)*/
const extensionPath = path.join(__dirname, "..", "..");

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage : node out/cli.js <fichier.isc0|isc1...> [cible]");
        process.exit(1);
    }

    const sourcePath = path.resolve(args[0]);
    const requestedTarget = args[1];
    const fileName = path.basename(sourcePath);
    const dirName = path.dirname(sourcePath);

    const content = fs.readFileSync(sourcePath, { encoding: "utf8" });
    const resolved = language.resolveForFile(extensionPath, fileName, content);
    console.log("Niveau  : " + resolved.grammar.name + " v" + resolved.grammar.version);
    if (resolved.warning) console.warn("Attention : " + resolved.warning);

    const targetNames = Object.keys(resolved.grammar.availableTranslation);
    let selected = requestedTarget;
    if (!selected && targetNames.length === 1) selected = targetNames[0];
    if (!selected || targetNames.indexOf(selected) < 0) {
        if (selected) console.error("Cible inconnue '" + selected + "'.");
        console.error("Cibles disponibles pour " + resolved.grammar.name + " : " + targetNames.join(", "));
        process.exit(1);
    }
    const targetDef = resolved.grammar.availableTranslation[selected];

    /*PARSE -> PASSES -> RENDU (identique à l'extension)*/
    const parsed = parser.parse(content, resolved.grammar, fileName);
    const nodes = passes.run(resolved.grammar, parsed.nodes);

    let outputGrammar = resolved.grammar;
    if (targetDef.grammar) outputGrammar = language.loadGrammar(extensionPath, targetDef.grammar);

    const result = render.render(nodes, outputGrammar, targetDef.target || selected, { emitHeader: targetDef.emitHeader });

    const outputPath = path.join(dirName, fileName.split(".")[0] + "." + targetDef.extension);
    fs.writeFileSync(outputPath, result.text);
    fs.writeFileSync(outputPath + ".map", JSON.stringify(result.map, null, "    "));

    if (parsed.errors.length > 0) {
        console.warn("Instructions non reconnues (ignorees), lignes : " + parsed.errors.map((error) => String(error.line)).join(", "));
    }
    console.log("Sortie  : " + outputPath);
    console.log("Map     : " + outputPath + ".map");
}

try {
    main();
} catch (error) {
    console.error(String(error));
    process.exit(1);
}
