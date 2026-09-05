/*Arbre de transitions entre niveaux de langage : construction du graphe depuis le
	provider de grammaires (niveaux, cibles de traduction, sorties fichiers) et layout
	en lignes (niveaux sources en haut, sorties en bas). Pur et testable sans DOM.*/

import type { GrammarProvider } from "./provider";
import type { LanguageJson, TargetDef } from "../../../src/types";

export interface TransitionLevelNode {
	kind: "level",
	level: string,
	versions: Array<number>,
	isDraft: boolean,
	missing?: boolean          /*cible d'une arête mais absente du provider*/
}
export interface TransitionOutputNode {
	kind: "output",
	output: string             /*ex ".nasm"*/
}
export type TransitionNode = TransitionLevelNode | TransitionOutputNode;

export interface TransitionEdge {
	from: string,              /*niveau source*/
	to: string,                /*niveau cible, ou sortie (".nasm")*/
	toKind: "level" | "output",
	label: string,             /*nom(s) de la/des cible(s) de traduction*/
	emitHeader?: boolean
}
export interface TransitionGraph {
	nodes: Array<TransitionNode>,
	edges: Array<TransitionEdge>
}

/*Construit le graphe : un noeud par niveau disponible (+ niveaux cibles manquants et
	sorties fichiers), une arête par cible de traduction (fusionnée si plusieurs cibles
	pointent au même endroit). Les niveaux dont la grammaire est illisible sont ignorés.*/
export function buildTransitionGraph(provider: GrammarProvider): TransitionGraph {
	const nodes: Array<TransitionNode> = [];
	const edges: Array<TransitionEdge> = [];
	const levelSet = new Set<string>();
	const outputSet = new Set<string>();

	const pushEdge = (edge: TransitionEdge): void => {
		const existing = edges.find((e) => e.from === edge.from && e.to === edge.to);
		if (existing) existing.label += " / " + edge.label;
		else edges.push(edge);
	};

	for (const level of provider.listLevels()) {
		let grammar: LanguageJson;
		try {
			grammar = provider.loadGrammar(level);
		} catch {
			continue;
		}
		levelSet.add(level);
		nodes.push({ kind: "level", level, versions: provider.listVersions(level), isDraft: provider.isDraft(level) });

		for (const [name, def] of Object.entries(grammar.availableTranslation || {})) {
			const targetDef = def as TargetDef;
			if (targetDef.grammar) {
				pushEdge({ from: level, to: targetDef.grammar, toKind: "level", label: name, emitHeader: targetDef.emitHeader });
			} else {
				const to = "." + targetDef.extension;
				outputSet.add(to);
				pushEdge({ from: level, to, toKind: "output", label: name, emitHeader: targetDef.emitHeader });
			}
		}
	}

	for (const edge of edges) {
		if (edge.toKind === "level" && !levelSet.has(edge.to)) {
			levelSet.add(edge.to);
			nodes.push({ kind: "level", level: edge.to, versions: [], isDraft: false, missing: true });
		}
	}
	for (const output of outputSet) nodes.push({ kind: "output", output });

	return { nodes, edges };
}

/* ---------- Layout ---------- */

export interface LayoutBox {
	key: string,
	node: TransitionNode,
	row: number,
	col: number,
	x: number, y: number, w: number, h: number
}
export interface LayoutEdge {
	edge: TransitionEdge,
	label: string,
	x1: number, y1: number,          /*bas du box source*/
	x2: number, y2: number           /*haut du box cible*/
}
export interface TransitionLayout {
	boxes: Array<LayoutBox>,
	edges: Array<LayoutEdge>,
	width: number,
	height: number
}

const BOX_W = 150;
const BOX_H = 46;
const GAP_X = 56;
const GAP_Y = 92;
const MARGIN = 20;

/*Placement en lignes : un niveau est placé selon la longueur du plus long chemin qui le
	sépare d'une sortie (les sources totales sont en haut, les sorties sur la dernière
	ligne) ; les lignes sont centrées. Les cycles sont ignorés (pas de boucle infinie).*/
export function layoutTransitionGraph(graph: TransitionGraph): TransitionLayout {
	const depthOf = new Map<string, number>();

	const depth = (level: string, path: Set<string>): number => {
		const known = depthOf.get(level);
		if (known !== undefined) return known;
		if (path.has(level)) return 0;
		path.add(level);
		let best = 0;
		for (const edge of graph.edges) {
			if (edge.from === level && edge.toKind === "level") {
				best = Math.max(best, 1 + depth(edge.to, path));
			}
		}
		path.delete(level);
		depthOf.set(level, best);
		return best;
	};

	for (const node of graph.nodes) {
		if (node.kind === "level") depth(node.level, new Set());
	}
	const maxDepth = Math.max(0, ...Array.from(depthOf.values()));

	const rows: Array<Array<{ key: string; node: TransitionNode }>> = [];
	for (const node of graph.nodes) {
		const key = node.kind === "level" ? node.level : node.output;
		const row = node.kind === "level" ? maxDepth - (depthOf.get(node.level) || 0) : maxDepth + 1;
		while (rows.length <= row) rows.push([]);
		rows[row].push({ key, node });
	}

	const totalRows = rows.length;
	const totalCols = Math.max(1, ...rows.map((row) => row.length));

	const boxes: Array<LayoutBox> = [];
	const boxByKey = new Map<string, LayoutBox>();
	rows.forEach((rowNodes, row) => {
		const offset = (totalCols - rowNodes.length) / 2;
		rowNodes.forEach((draft, col) => {
			const box: LayoutBox = {
				key: draft.key,
				node: draft.node,
				row,
				col: col + offset,
				x: MARGIN + (col + offset) * (BOX_W + GAP_X),
				y: MARGIN + row * (BOX_H + GAP_Y),
				w: BOX_W,
				h: BOX_H
			};
			boxes.push(box);
			boxByKey.set(draft.key, box);
		});
	});

	const edges: Array<LayoutEdge> = graph.edges.map((edge) => {
		const from = boxByKey.get(edge.from);
		const to = boxByKey.get(edge.to);
		return {
			edge,
			label: edge.label,
			x1: from ? from.x + from.w / 2 : 0,
			y1: from ? from.y + from.h : 0,
			x2: to ? to.x + to.w / 2 : 0,
			y2: to ? to.y : 0
		};
	});

	return {
		boxes,
		edges,
		width: MARGIN * 2 + totalCols * (BOX_W + GAP_X) - GAP_X,
		height: MARGIN * 2 + totalRows * (BOX_H + GAP_Y) - GAP_Y
	};
}
