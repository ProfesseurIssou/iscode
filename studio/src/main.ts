import { monaco, defineTheme } from "./monaco";
import { HttpRegistryProvider } from "./core/provider";
import { createTranslateView } from "./views/translate";
import { createLanguagesView } from "./views/languages";
import { createStudioView } from "./views/studio";
import type { View, ViewFactory } from "./views/view";

defineTheme();

const provider = new HttpRegistryProvider();

/*Badge d'état du registry dans la barre du haut*/
const badge = document.getElementById("registry-status")!;

function updateBadge(): void {
	const status = provider.status;
	if (status.source === "unloaded") {
		badge.textContent = "registry unavailable";
		badge.classList.add("error");
	} else {
		badge.textContent = "registry: " + status.source + (status.revision ? " · " + status.revision.slice(0, 10) : "");
		badge.classList.remove("error");
	}
	badge.title = status.baseUrl + (status.lastError ? "\n" + status.lastError : "");
}

provider.subscribe(updateBadge);
updateBadge();

const views: Record<string, ViewFactory> = {
	translate: createTranslateView,
	languages: createLanguagesView,
	studio: createStudioView
};

const app = document.getElementById("app")!;
let current: View | undefined;

function route(): void {
	const name = location.hash.replace(/^#\//, "") || "translate";
	const factory = views[name] || views.translate;

	if (current && current.unmount) current.unmount();
	app.replaceChildren();
	document.querySelectorAll("#nav a").forEach((node) => {
		node.classList.toggle("active", (node as HTMLElement).dataset.view === name);
	});

	current = factory({ provider });
	void current.mount(app);
}

window.addEventListener("hashchange", route);
route();
