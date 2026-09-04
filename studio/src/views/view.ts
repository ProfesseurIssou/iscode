import type { GrammarProvider } from "../core/provider";

export interface ViewContext {
	provider: GrammarProvider
}

export interface View {
	mount(container: HTMLElement): void | Promise<void>;
	unmount?(): void;
}

export type ViewFactory = (ctx: ViewContext) => View;

/*Petit assistant de création DOM*/
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}
