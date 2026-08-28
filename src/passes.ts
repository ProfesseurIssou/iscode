/* eslint-disable @typescript-eslint/naming-convention */
import { AstNode, LanguageJson } from "./types";

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

/*Toutes les passes disponibles, référencées par leur nom dans le champ "pipeline" des grammaires*/
export const allPasses: { [name: string]: Pass } = {
    resolveParams
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
