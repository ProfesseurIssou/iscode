/* eslint-disable @typescript-eslint/naming-convention */
/*Tests du pipeline ISCode (parse -> passes -> rendu), sans dépendance vscode.
  Lancement : npm run test:pipeline*/
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as language from "../language";
import * as parser from "../parser";
import * as passes from "../passes";
import * as render from "../render";
import { parseExpression } from "../expressions";

/*out/test -> racine du projet*/
const rootPath = path.join(__dirname, "..", "..");

/*Lit un fichier attendu en normalisant les fins de ligne (un clone Windows avec
  core.autocrlf=true extrait les fichiers en CRLF ; le rendu du pipeline, lui, produit du LF).*/
function readExpected(...parts: Array<string>): string {
    return fs.readFileSync(path.join(rootPath, ...parts), { encoding: "utf8" }).replace(/\r\n/g, "\n");
}

function check(name: string, fn: () => void) {
    try {
        fn();
        console.log("OK    " + name);
    } catch (error) {
        console.error("FAIL  " + name);
        console.error(error);
        process.exitCode = 1;
    }
}

check("lecture de l'en-tete meta", () => {
    const header = language.parseHeader("#! iscode-level: isc1\n#! iscode-version: 1\n\nfunc main\n");
    assert.strictEqual(header.level, "isc1");
    assert.strictEqual(header.version, 1);

    const empty = language.parseHeader("mode 64\n");
    assert.strictEqual(empty.level, undefined);
    assert.strictEqual(empty.version, undefined);
});

check("resolution de grammaire : header, fallback, version inconnue", () => {
    const resolved = language.resolveForFile(rootPath, "main.isc0", "#! iscode-level: isc0\n#! iscode-version: 1\nmode 64\n");
    assert.strictEqual(resolved.grammar.name, "isc0");
    assert.strictEqual(resolved.grammar.version, 1);
    assert.strictEqual(resolved.warning, undefined);

    /*Sans en-tete : niveau = extension du fichier, version = la plus recente*/
    const fallback = language.resolveForFile(rootPath, "main.isc0", "mode 64\n");
    assert.strictEqual(fallback.grammar.name, "isc0");
    assert.strictEqual(fallback.grammar.version, 1);

    /*Version inconnue : avertissement + version la plus recente*/
    const unknown = language.resolveForFile(rootPath, "main.isc0", "#! iscode-version: 99\nmode 64\n");
    assert.strictEqual(unknown.grammar.version, 1);
    assert.ok(unknown.warning);

    assert.throws(() => language.resolveForFile(rootPath, "main.txt", "rien"));
});

check("token manquant : erreur explicite (ancien bug TypeTen)", () => {
    const broken = JSON.parse(JSON.stringify(language.loadGrammar(rootPath, "isc0", 1)));
    broken.instructions.defineTen.syntax = ["indentation", "TokenQuiNexistePas"];
    assert.throws(() => parser.parse("ten x 5\n", broken, "x.isc0"), /Token manquant/);
});

check("isc0 -> nasm : rendu complet + source map", () => {
    const content = fs.readFileSync(path.join(rootPath, "samples", "main.isc0"), { encoding: "utf8" });
    const resolved = language.resolveForFile(rootPath, "main.isc0", content);
    const parsed = parser.parse(content, resolved.grammar, "main.isc0");
    assert.deepStrictEqual(parsed.errors, [], "toutes les lignes doivent etre reconnues");

    const nodes = passes.run(resolved.grammar, parsed.nodes);
    const result = render.render(nodes, resolved.grammar, "nasm_x86_x64");

    const expected = readExpected("samples", "expected", "main.isc0.nasm");
    assert.strictEqual(result.text, expected);

    /*Source map : "msg db 'Hello'" (ligne 7 de la sortie) vient de la ligne 9 du source,
      "call print" (ligne 16) vient du "print msg" (ligne 18),
      la routine generee (ligne 21) vient du "include print" (ligne 17).*/
    assert.strictEqual(result.map["7"].line, 9);
    assert.strictEqual(result.map["7"].file, "main.isc0");
    assert.strictEqual(result.map["16"].line, 18);
    assert.strictEqual(result.map["21"].line, 17);
    /*Une seule routine malgre le passage dans la passe/zone tail*/
    const occurrences = result.text.match(/^print:/gm);
    assert.strictEqual(occurrences ? occurrences.length : 0, 1);
});

check("isc1 -> isc0 : passe resolveParams + header emis + source map", () => {
    const content = fs.readFileSync(path.join(rootPath, "samples", "main.isc1"), { encoding: "utf8" });
    const resolved = language.resolveForFile(rootPath, "main.isc1", content);
    const parsed = parser.parse(content, resolved.grammar, "main.isc1");
    assert.deepStrictEqual(parsed.errors, [], "toutes les lignes doivent etre reconnues");

    const nodes = passes.run(resolved.grammar, parsed.nodes);
    const lastAssign = nodes[nodes.length - 2]; /*le fichier finit par \n : dernier noeud = ligne vide*/
    assert.strictEqual(lastAssign.op, "assign");
    assert.strictEqual(lastAssign.src, "[rsp+8*2]");
    /*Le noeud genere conserve l'origine de sa ligne source*/
    assert.strictEqual(lastAssign.origin.line, 6);

    const isc0 = language.loadGrammar(rootPath, "isc0");
    const result = render.render(nodes, isc0, "isc0", { emitHeader: true });

    const expected = readExpected("samples", "expected", "main.isc1.isc0");
    assert.strictEqual(result.text, expected);

    /*Le fichier genere est re-traduisible : son header est resolu sans erreur ni avertissement*/
    const regenerated = language.resolveForFile(rootPath, "main.isc0", result.text);
    assert.strictEqual(regenerated.grammar.version, 1);
    assert.strictEqual(regenerated.warning, undefined);

    assert.strictEqual(result.map["6"].line, 5);
    assert.strictEqual(result.map["7"].line, 6);
});

check("lignes non reconnues : collectees, la traduction continue", () => {
    const grammar = language.loadGrammar(rootPath, "isc0", 1);
    const parsed = parser.parse("mode 64\n??? 123\n", grammar, "x.isc0");
    assert.strictEqual(parsed.errors.length, 1);
    assert.strictEqual(parsed.errors[0].line, 2);
    assert.strictEqual(parsed.nodes.length, 2); /*"mode 64" + ligne vide finale*/
});

check("op sans rendu pour la cible : erreur explicite", () => {
    const grammar = language.loadGrammar(rootPath, "isc1", 1);
    const parsed = parser.parse("rax = prm1\n", grammar, "x.isc1");
    /*Sans passer par la pipeline resolveParams, getParams n'a pas de rendu*/
    assert.throws(() => render.render(parsed.nodes, grammar, "ISCode_0"), /Pas de rendu/);
});

check("parser d'expressions : priorites, parentheses, moins unaire", () => {
    const parensFirst = parseExpression("(2 + 3) * 4");
    assert.strictEqual(parensFirst.op, "*");
    assert.strictEqual(parensFirst.left!.op, "+");
    assert.strictEqual(parensFirst.right!.op, "atom");
    assert.strictEqual(parensFirst.right!.value, "4");

    const precedence = parseExpression("2 + 3 * 4");
    assert.strictEqual(precedence.op, "+");
    assert.strictEqual(precedence.right!.op, "*");

    const twoParens = parseExpression("(2 + 3) * (4 - 1)");
    assert.strictEqual(twoParens.op, "*");
    assert.strictEqual(twoParens.left!.op, "+");
    assert.strictEqual(twoParens.right!.op, "-");

    const unary = parseExpression("-x + 2");
    assert.strictEqual(unary.op, "+");
    assert.strictEqual(unary.left!.op, "-"); /*moins unaire = 0 - x*/
    assert.strictEqual(unary.left!.right!.value, "x");

    assert.throws(() => parseExpression("(2 + 3"), /Parenthese/);
    assert.throws(() => parseExpression("2 +"), /incomplete/);
    assert.throws(() => parseExpression("2 @ 3"), /invalide/);
});

check("isc2 -> isc0 : if/else + expressions, puis chaîne complète vers nasm", () => {
    const content = fs.readFileSync(path.join(rootPath, "samples", "main.isc2"), { encoding: "utf8" });
    const resolved = language.resolveForFile(rootPath, "main.isc2", content);
    assert.strictEqual(resolved.grammar.name, "isc2");
    const parsed = parser.parse(content, resolved.grammar, "main.isc2");
    assert.deepStrictEqual(parsed.errors, [], "toutes les lignes doivent etre reconnues");

    const nodes = passes.run(resolved.grammar, parsed.nodes);

    const isc0 = language.loadGrammar(rootPath, "isc0");
    const result = render.render(nodes, isc0, "isc0", { emitHeader: true });
    const expected = readExpected("samples", "expected", "main.isc2.isc0");
    assert.strictEqual(result.text, expected);

    /*Le isc0 généré est un vrai fichier isc0 : il repasse entierement dans le pipeline*/
    const regenerated = parser.parse(result.text, isc0, "main.isc0");
    assert.deepStrictEqual(regenerated.errors, [], "le isc0 genere doit etre re-parsable");
    const nasm = render.render(passes.run(isc0, regenerated.nodes), isc0, "nasm_x86_x64");
    assert.ok(nasm.text.indexOf("add rax,rbx") >= 0, "add manquant");
    assert.ok(nasm.text.indexOf("imul rax,rbx") >= 0, "imul manquant");
    assert.ok(nasm.text.indexOf("cmp rax,rbx") >= 0, "cmp manquant");
    assert.ok(nasm.text.indexOf("jle .L0") >= 0, "saut conditionnel manquant");
    assert.ok(nasm.text.indexOf(".L1:") >= 0, "label de fin manquant");
    assert.strictEqual((nasm.text.match(/^print:/gm) || []).length, 1, "une seule routine print");
});

check("isc2 : else sans if et comparateur inconnu sont rejetés", () => {
    const grammar = language.loadGrammar(rootPath, "isc2", 1);

    const bad = parser.parse("  else\n", grammar, "x.isc2");
    assert.throws(() => passes.run(grammar, bad.nodes), /'else' sans 'if'/);

    const unknownCmp = parser.parse("if x <> 1\n  rax = 1\n", grammar, "x.isc2");
    assert.ok(unknownCmp.errors.length > 0, "'<>' ne doit pas matcher ifBlock");
});

console.log(process.exitCode ? "TESTS EN ECHEC" : "TOUS LES TESTS PASSENT");
