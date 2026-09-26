import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import {
	formatModelCosts,
	formatPickerCosts,
	privacyLabel,
	PROVIDER_ID,
	sortableCostPerMillion,
	type DiscoveredModels,
} from "./model-catalog.ts";

export function registerNearModelPicker(pi: ExtensionAPI, discovered: DiscoveredModels): void {
	pi.registerCommand("near-model-picker", {
		description: "Browse NEAR AI models by privacy class, cost, and metadata",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			if (discovered.pickerEntries.length === 0) {
				ctx.ui.notify("No NEAR AI catalog models are available.", "warning");
				return;
			}

			const privacyChoice = await ctx.ui.select("Choose NEAR AI model privacy class", [
				"Private TEE",
				"Incognito",
				"All models",
			]);
			if (!privacyChoice) return;
			const categoryEntries = discovered.pickerEntries.filter(({ catalog }) =>
				privacyChoice === "All models" || privacyLabel(catalog) === privacyChoice,
			);
			if (categoryEntries.length === 0) {
				ctx.ui.notify(`No ${privacyChoice} models are available.`, "warning");
				return;
			}

			const format = (value: boolean | string | undefined) => value === undefined ? "unknown" : String(value);
			const entriesById = new Map(categoryEntries.map((entry) => [entry.model.id, entry]));
			const searchableTextById = new Map(categoryEntries.map(({ model, catalog }) => {
				const metadata = catalog.metadata;
				return [
					model.id,
					`${catalog.modelId ?? catalog.id ?? model.id} ${formatModelCosts(catalog)} verifiable ${format(metadata?.verifiable)} attestationSupported ${format(metadata?.attestationSupported)} providerType ${metadata?.providerType ?? "unknown"} ownedBy ${metadata?.ownedBy ?? "unknown"}`,
				] as const;
			}));
			const items: SelectItem[] = categoryEntries.map(({ model, catalog }) => ({
				value: model.id,
				label: catalog.metadata?.modelDisplayName ?? catalog.name ?? catalog.modelDisplayName ?? model.id,
				description: formatPickerCosts(catalog),
			}));

			const selectedId = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) => {
				const container = new Container();
				const input = new Input({ placeholder: "Type to fuzzy-search models…" });
				input.focused = false;
				let searchActive = false;
				let sortBy: "input" | "output" | "name" | undefined;
				let sortDirection: "asc" | "desc" = "asc";
				let selectList: SelectList | undefined;
				const details = new Text("", 1, 0);

				const setSort = (next: "input" | "output" | "name") => {
					if (sortBy === next) sortDirection = sortDirection === "asc" ? "desc" : "asc";
					else {
						sortBy = next;
						sortDirection = "asc";
					}
					rebuild();
					tui.requestRender();
				};

				const rebuild = () => {
					const previousId = selectList?.getSelectedItem()?.value;
					const query = input.getValue().trim();
					let filtered = query
						? fuzzyFilter(items, query, (item) => `${item.label} ${item.value} ${searchableTextById.get(item.value) ?? ""}`)
						: [...items];
					if (sortBy) {
						filtered = [...filtered].sort((left, right) => {
							const leftEntry = entriesById.get(left.value)!;
							const rightEntry = entriesById.get(right.value)!;
							const nameOrder = left.label.localeCompare(right.label);
							if (sortBy === "name") return sortDirection === "asc" ? nameOrder : -nameOrder;
							const field = sortBy === "input" ? "inputCostPerToken" : "outputCostPerToken";
							const leftCost = sortableCostPerMillion(leftEntry.catalog[field]);
							const rightCost = sortableCostPerMillion(rightEntry.catalog[field]);
							if (leftCost === undefined) return rightCost === undefined ? nameOrder : 1;
							if (rightCost === undefined) return -1;
							const costOrder = leftCost - rightCost;
							return costOrder === 0 ? nameOrder : sortDirection === "asc" ? costOrder : -costOrder;
						});
					}
					selectList = new SelectList(filtered, 10, {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("dim", text),
						noMatch: (text) => theme.fg("warning", text),
					});
					const previousIndex = filtered.findIndex((item) => item.value === previousId);
					if (previousIndex >= 0) selectList.setSelectedIndex(previousIndex);

					const updateDetails = (item: SelectItem | null) => {
						const entry = item && entriesById.get(item.value);
						if (!entry) {
							details.setText("No matching models");
							return;
						}
						const metadata = entry.catalog.metadata;
						const apiId = entry.catalog.modelId ?? entry.catalog.id ?? entry.model.id;
						const modelName = metadata?.modelDisplayName ?? entry.catalog.name ?? entry.catalog.modelDisplayName ?? entry.model.id;
						details.setText([
							`${theme.fg("accent", theme.bold(modelName))} ${theme.fg("dim", apiId)}`,
							theme.fg("muted", formatModelCosts(entry.catalog)),
							`verifiable ${format(metadata?.verifiable)} · attestation ${format(metadata?.attestationSupported)}`,
							`provider ${metadata?.providerType ?? "unknown"} · owner ${metadata?.ownedBy ?? "unknown"}`,
						].join("\n"));
					};
					selectList.onSelectionChange = (item) => {
						updateDetails(item);
						tui.requestRender();
					};
					selectList.onSelect = (item) => done(item.value);
					selectList.onCancel = () => done(null);
					updateDetails(selectList.getSelectedItem());

					const sortLabel = sortBy
						? `${sortBy === "name" ? "name" : `${sortBy} cost`} ${sortDirection === "asc" ? "↑" : "↓"}`
						: "catalog order";
					container.clear();
					container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
					container.addChild(new Text(theme.fg("accent", theme.bold(`${privacyChoice} NEAR AI models`))));
					container.addChild(new Text(theme.fg("dim", `Sort: ${sortLabel}`)));
					container.addChild(
						searchActive
							? input
							: new Text(theme.fg("dim", "Press / to search by name, ID, metadata, or cost"), 1, 0),
					);
					container.addChild(selectList);
					container.addChild(details);
					const help = searchActive
						? "search · ↑↓ move · enter select · esc clear/return"
						: "i input · o output · n name (repeat flips) · / search · ↑↓ move · enter select";
					container.addChild(new Text(theme.fg("dim", help)));
					container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
				};

				rebuild();
				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						if (keybindings.matches(data, "tui.select.cancel")) {
							if (searchActive) {
								if (input.getValue()) input.setValue("");
								searchActive = false;
								input.focused = false;
								rebuild();
								tui.requestRender();
							} else {
								done(null);
							}
							return;
						}
						if (
							keybindings.matches(data, "tui.select.up") ||
							keybindings.matches(data, "tui.select.down") ||
							keybindings.matches(data, "tui.select.confirm")
						) {
							selectList?.handleInput(data);
							return;
						}
						if (!searchActive) {
							if (matchesKey(data, "i")) setSort("input");
							else if (matchesKey(data, "o")) setSort("output");
							else if (matchesKey(data, "n")) setSort("name");
							else if (matchesKey(data, "/")) {
								searchActive = true;
								input.focused = true;
								rebuild();
								tui.requestRender();
							}
							return;
						}
						input.handleInput(data);
						rebuild();
						tui.requestRender();
					},
				};
			});
			if (!selectedId) return;

			const selectedEntry = categoryEntries.find(({ model }) => model.id === selectedId);
			if (!selectedEntry) return;
			const model = ctx.modelRegistry.getAll().find(
				(candidate) => candidate.provider === PROVIDER_ID && candidate.id === selectedEntry.model.id,
			);
			if (!model || !(await pi.setModel(model))) {
				ctx.ui.notify("Could not select this model. Check NEAR_AI_API_KEY.", "warning");
				return;
			}
			ctx.ui.notify(`Selected ${selectedEntry.catalog.metadata?.modelDisplayName ?? selectedEntry.model.id}`, "info");
		},
	});
}
