/* eslint-disable @typescript-eslint/naming-convention */
import { AstNode, LanguageJson } from "./types";
import { parseExpression, ExprNode } from "./expressions";

type Pass = (nodes: Array<AstNode>) => Array<AstNode>;

/*resolveParams (isc1 -> isc0) : "x = prm2" devient une affectation vers l'adresse de pile correspondante.
Le noeud généré conserve l'origine du noeud source (traçabilité dans les source maps).*/
const resolveParams: Pass = (nodes) => {
    return nodes.map((node) => {
        if (node.op !== "getParams") return node;
        const converted: AstNode = {
            op: "assign",
            dst: node.dst,
            src: "[rsp+8*" + node.index + "]",
            _indent: node._indent || "",
            origin: node.origin
        };
        return converted;
    });
};

/*Construit un noeud généré par une passe. Il hérite de l'origine du noeud source
  (source maps) et, sauf mention contraire, de son indentation (keepIndent=false pour les labels).*/
function makeNode(source: AstNode, op: string, fields: { [key: string]: any }, keepIndent: boolean): AstNode {
    const node: AstNode = { op, origin: source.origin, _indent: keepIndent ? (source._indent || "") : "" };
    for (const key of Object.keys(fields)) node[key] = fields[key];
    return node;
}

/*buildBlocks (isc2) : regroupe les lignes indentées sous leur 'if' et rattache le 'else'.
  Les ifBlock deviennent temporairement imbriqués (then/else) ; lowerIf les remettra à plat.
  Une ligne dont l'indentation est <= celle du 'if' ferme le bloc ; le 'else' doit être
  au même niveau que son 'if'.*/
const buildBlocks: Pass = (nodes) => {
    const result: Array<AstNode> = [];
    const stack: Array<{ block: AstNode; baseIndent: number; inElse: boolean }> = [];

    const currentList = (): Array<AstNode> => {
        if (stack.length === 0) return result;
        const top = stack[stack.length - 1];
        return top.inElse ? (top.block.else as Array<AstNode>) : (top.block.then as Array<AstNode>);
    };

    for (const node of nodes) {
        const indent = (node._indent || "").length;

        if (node.op === "ifBlock") {
            while (stack.length > 0 && stack[stack.length - 1].baseIndent >= indent) stack.pop();
            node.then = [];
            node.else = null;
            currentList().push(node);
            stack.push({ block: node, baseIndent: indent, inElse: false });
            continue;
        }
        if (node.op === "elseMark") {
            const top = stack[stack.length - 1];
            if (!top) throw new Error("ligne " + node.origin.line + " : 'else' sans 'if'");
            if (top.inElse) throw new Error("ligne " + node.origin.line + " : 'else' duplique");
            top.block.else = [];
            top.inElse = true;
            continue;
        }

        while (stack.length > 0 && stack[stack.length - 1].baseIndent >= indent) stack.pop();
        currentList().push(node);
    }
    return result;
};

/*Mnémonique de saut inverse : le saut part vers le else/la fin quand la condition est FAUSSE.
  ">" => sauter si "<=" donc jle, "==" => sauter si différent donc jne...*/
const invertedCompare: { [cmpOp: string]: string } = {
    ">": "jle",
    "<": "jge",
    ">=": "jl",
    "<=": "jg",
    "==": "jne",
    "=": "jne",
    "!=": "je"
};

/*lowerIf (isc2 -> isc0) : remet l'AST à plat en remplaçant chaque ifBlock par sa décomposition :
  comparaison + saut inverse vers le else/la fin + corps + jmp + labels. Récursif : un 'if'
  dans un corps de 'if' est descendu de la même façon. Compteur de labels partagé => uniques.*/
let labelCounter = 0;

function flattenIfs(nodes: Array<AstNode>, out: Array<AstNode>): void {
    for (const node of nodes) {
        if (node.op !== "ifBlock") { out.push(node); continue; }

        const jump = invertedCompare[node.cmpOp];
        if (!jump) throw new Error("ligne " + node.origin.line + " : comparateur inconnu '" + node.cmpOp + "'");

        const labelElse = ".L" + labelCounter;
        labelCounter += 1;
        const hasElse = Array.isArray(node.else);
        const labelEnd = hasElse ? ".L" + (labelCounter++) : labelElse;

        out.push(makeNode(node, "compareExpr", { left: node.left, right: node.right, cmpOp: node.cmpOp }, true));
        out.push(makeNode(node, "jumpIf", { mnemonic: jump, target: labelElse }, true));
        flattenIfs(node.then || [], out);
        if (hasElse) {
            out.push(makeNode(node, "jumpIf", { mnemonic: "jmp", target: labelEnd }, true));
            out.push(makeNode(node, "label", { name: labelElse + ":" }, false));
            flattenIfs(node.else as Array<AstNode>, out);
        }
        out.push(makeNode(node, "label", { name: labelEnd + ":" }, false));
    }
}

const lowerIf: Pass = (nodes) => {
    labelCounter = 0;
    const out: Array<AstNode> = [];
    flattenIfs(nodes, out);
    return out;
};

/*lowerExpressions (isc2 -> isc0) : remplace chaque assignExpr / compareExpr par une séquence
  d'instructions atomiques via un codegen à pile : eval(gauche) -> rax, push, eval(droite) -> rax,
  rbx = rax, pop, opération. Feuilles : registre ou nombre = nu, sinon [variable].*/

function isRegister(value: string): boolean {
    return /^r[a-z0-9]{1,3}$/i.test(value) || /^e[a-z]{2}$/i.test(value);
}
function classifyOperand(value: string): string {
    if (isRegister(value) || /^[0-9]+$/.test(value) || value.charAt(0) === "[") return value;
    return "[" + value + "]";
}

const mathOps: { [exprOp: string]: string } = { "+": "mathAdd", "-": "mathSub", "*": "mathMul", "/": "mathDiv" };

function emitExpression(expr: ExprNode, out: Array<AstNode>, source: AstNode): void {
    if (expr.op === "atom") {
        out.push(makeNode(source, "assign", { dst: "rax", src: classifyOperand(expr.value as string) }, true));
        return;
    }
    const mathOp = mathOps[expr.op];
    if (!mathOp) throw new Error("Opérateur d'expression inconnu : " + expr.op);

    emitExpression(expr.left as ExprNode, out, source);
    out.push(makeNode(source, "push", { value: "rax" }, true));
    emitExpression(expr.right as ExprNode, out, source);
    out.push(makeNode(source, "assign", { dst: "rbx", src: "rax" }, true));
    out.push(makeNode(source, "pop", { value: "rax" }, true));
    out.push(makeNode(source, mathOp, { dst: "rax", src: "rbx" }, true));
}

const lowerExpressions: Pass = (nodes) => {
    const out: Array<AstNode> = [];
    for (const node of nodes) {
        if (node.op === "assignExpr") {
            emitExpression(parseExpression(node.expr), out, node);
            out.push(makeNode(node, "assign", { dst: classifyOperand(node.dst), src: "rax" }, true));
        } else if (node.op === "compareExpr") {
            emitExpression(parseExpression(node.right), out, node);
            out.push(makeNode(node, "assign", { dst: "rbx", src: "rax" }, true));
            emitExpression(parseExpression(node.left), out, node);
            out.push(makeNode(node, "compare", { a: "rax", b: "rbx" }, true));
        } else {
            out.push(node);
        }
    }
    return out;
};

/*Toutes les passes disponibles, référencées par leur nom dans le champ "pipeline" des grammaires*/
export const allPasses: { [name: string]: Pass } = {
    resolveParams,
    buildBlocks,
    lowerIf,
    lowerExpressions
};

/*Applique la pipeline déclarée par la grammaire, dans l'ordre*/
export function run(grammar: LanguageJson, nodes: Array<AstNode>): Array<AstNode> {
    let result = nodes;
    for (const passName of grammar.pipeline || []) {
        const pass = allPasses[passName];
        if (!pass) throw new Error("Pass inconnue : " + passName);
        result = pass(result);
    }
    return result;
}
