/* eslint-disable @typescript-eslint/naming-convention */

/*Parser d'expressions arithmétiques : priorités (* / sur + -), parenthèses, moins unaire.
  Utilisé par les passes de lowering pour déplier les calculs en instructions atomiques.
  Indépendant de vscode et des grammaires.*/

/*Arbre d'expression :
  - feuille : { op: "atom", value: "x" } (nombre, registre ou variable, classification au lowering)
  - binaire : { op: "+" | "-" | "*" | "/", left, right }
  Le moins unaire est décomposé en soustraction : -x => 0 - x*/
export interface ExprNode {
    op: string,
    value?: string,
    left?: ExprNode,
    right?: ExprNode
}

interface Token {
    kind: "number" | "ident" | "op" | "paren",
    text: string
}

function tokenize(source: string): Array<Token> {
    const tokens: Array<Token> = [];
    let i = 0;
    while (i < source.length) {
        const c = source.charAt(i);
        if (c === " " || c === "\t") { i += 1; continue; }
        if (c === "(" || c === ")") { tokens.push({ kind: "paren", text: c }); i += 1; continue; }
        if ("+-*/".indexOf(c) >= 0) { tokens.push({ kind: "op", text: c }); i += 1; continue; }
        if (c >= "0" && c <= "9") {
            let j = i;
            while (j < source.length && source.charAt(j) >= "0" && source.charAt(j) <= "9") j += 1;
            tokens.push({ kind: "number", text: source.substring(i, j) });
            i = j;
            continue;
        }
        if (/[a-zA-Z_]/.test(c)) {
            let j = i;
            while (j < source.length && /[a-zA-Z0-9_]/.test(source.charAt(j))) j += 1;
            tokens.push({ kind: "ident", text: source.substring(i, j) });
            i = j;
            continue;
        }
        throw new Error("Caractere invalide dans l'expression '" + source + "' : '" + c + "'");
    }
    return tokens;
}

export function parseExpression(source: string): ExprNode {
    const tokens = tokenize(source);
    let pos = 0;

    const peek = (): Token | null => (pos < tokens.length ? tokens[pos] : null);

    /*addSub -> mulDiv (('+'|'-') mulDiv)**/
    const parseAddSub = (): ExprNode => {
        let left = parseMulDiv();
        for (;;) {
            const token = peek();
            if (!token || token.kind !== "op" || (token.text !== "+" && token.text !== "-")) break;
            pos += 1;
            left = { op: token.text, left, right: parseMulDiv() };
        }
        return left;
    };

    /*mulDiv -> unary (('*'|'/') unary)* */
    const parseMulDiv = (): ExprNode => {
        let left = parseUnary();
        for (;;) {
            const token = peek();
            if (!token || token.kind !== "op" || (token.text !== "*" && token.text !== "/")) break;
            pos += 1;
            left = { op: token.text, left, right: parseUnary() };
        }
        return left;
    };

    /*unary -> '-' unary | atom (le moins unaire devient 0 - x)*/
    const parseUnary = (): ExprNode => {
        const token = peek();
        if (token && token.kind === "op" && token.text === "-") {
            pos += 1;
            return { op: "-", left: { op: "atom", value: "0" }, right: parseUnary() };
        }
        return parseAtom();
    };

    /*atom -> nombre | identifiant | '(' addSub ')'*/
    const parseAtom = (): ExprNode => {
        const token = peek();
        if (!token) throw new Error("Expression incomplete : '" + source + "'");
        pos += 1;
        if (token.kind === "number" || token.kind === "ident") return { op: "atom", value: token.text };
        if (token.kind === "paren" && token.text === "(") {
            const inner = parseAddSub();
            const closing = peek();
            if (!closing || closing.kind !== "paren" || closing.text !== ")") {
                throw new Error("Parenthese fermante manquante dans : '" + source + "'");
            }
            pos += 1;
            return inner;
        }
        throw new Error("Element inattendu '" + token.text + "' dans : '" + source + "'");
    };

    const tree = parseAddSub();
    if (pos < tokens.length) throw new Error("Element inattendu '" + tokens[pos].text + "' dans : '" + source + "'");
    return tree;
}
