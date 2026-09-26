import type { Model } from "@earendil-works/pi-ai/compat";

export const PROVIDER_ID = "near-ai";
export const BASE_URL = "https://cloud-api.near.ai/v1";
const CATALOG_URL = `${BASE_URL}/model/list`;
const FALLBACK_MODEL_ID = "z-ai/glm-5.3-flash";

export interface CatalogCost {
	amount: number;
	scale: number;
	currency?: string;
}

export interface CatalogModel {
	id?: string;
	modelId?: string;
	name?: string;
	modelDisplayName?: string;
	inputCostPerToken?: CatalogCost | number;
	outputCostPerToken?: CatalogCost | number;
	cacheReadCostPerToken?: CatalogCost | number;
	cacheWriteCostPerToken?: CatalogCost | number;
	costPerImage?: CatalogCost | number;
	metadata?: {
		contextLength?: number;
		maxOutputLength?: number;
		modelDisplayName?: string;
		verifiable?: boolean;
		attestationSupported?: boolean;
		providerType?: string;
		ownedBy?: string;
		architecture?: { inputModalities?: string[]; outputModalities?: string[] };
		supportedFeatures?: string[];
	};
}

interface CatalogResponse {
	models?: CatalogModel[];
	data?: CatalogModel[];
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function costPerMillion(value: CatalogCost | number | undefined): number {
	if (typeof value === "number") return finiteNumber(value) ?? 0;
	if (!value || value.currency && value.currency !== "USD") return 0;
	const amount = finiteNumber(value.amount);
	const scale = finiteNumber(value.scale);
	if (amount === undefined || scale === undefined) return 0;
	return amount * 10 ** -scale * 1_000_000;
}

export function sortableCostPerMillion(value: CatalogCost | number | undefined): number | undefined {
	if (typeof value === "number") {
		const amount = finiteNumber(value);
		return amount === undefined ? undefined : amount * 1_000_000;
	}
	if (!value || (value.currency && value.currency !== "USD")) return undefined;
	const amount = finiteNumber(value.amount);
	const scale = finiteNumber(value.scale);
	if (amount === undefined || scale === undefined) return undefined;
	return amount * 10 ** -scale * 1_000_000;
}

function formatAmount(value: number): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function formatCostPerMillion(value: CatalogCost | number | undefined): string {
	if (value === undefined) return "n/a";
	if (typeof value === "number") {
		const amount = finiteNumber(value);
		return amount === undefined ? "n/a" : `$${formatAmount(amount * 1_000_000)}/M tokens`;
	}
	const amount = finiteNumber(value.amount);
	const scale = finiteNumber(value.scale);
	if (amount === undefined || scale === undefined) return "n/a";
	const currency = value.currency ?? "USD";
	const prefix = currency === "USD" ? "$" : `${currency} `;
	return `${prefix}${formatAmount(amount * 10 ** -scale * 1_000_000)}/M tokens`;
}

function formatCostPerImage(value: CatalogCost | number | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") {
		const amount = finiteNumber(value);
		return amount === undefined ? undefined : `$${formatAmount(amount)}/image`;
	}
	const amount = finiteNumber(value.amount);
	const scale = finiteNumber(value.scale);
	if (amount === undefined || scale === undefined) return undefined;
	const currency = value.currency ?? "USD";
	const prefix = currency === "USD" ? "$" : `${currency} `;
	return `${prefix}${formatAmount(amount * 10 ** -scale)}/image`;
}

export function formatPickerCosts(model: CatalogModel): string {
	const shortRate = (value: CatalogCost | number | undefined) => {
		const rate = formatCostPerMillion(value);
		return rate === "n/a" ? rate : rate.replace("/M tokens", "/M");
	};
	return `in ${shortRate(model.inputCostPerToken)} · out ${shortRate(model.outputCostPerToken)}`;
}

export function formatModelCosts(model: CatalogModel): string {
	const costs = [
		`input ${formatCostPerMillion(model.inputCostPerToken)}`,
		`output ${formatCostPerMillion(model.outputCostPerToken)}`,
	];
	if (model.cacheReadCostPerToken !== undefined) {
		costs.push(`cache read ${formatCostPerMillion(model.cacheReadCostPerToken)}`);
	}
	if (model.cacheWriteCostPerToken !== undefined) {
		costs.push(`cache write ${formatCostPerMillion(model.cacheWriteCostPerToken)}`);
	}
	const imageCost = formatCostPerImage(model.costPerImage);
	if (imageCost) costs.push(`image ${imageCost}`);
	return costs.join(" · ");
}

function supportsE2EE(model: CatalogModel): boolean {
	return model.metadata?.verifiable === true && model.metadata?.attestationSupported === true;
}

export function privacyLabel(model: CatalogModel): "Private TEE" | "Incognito" {
	return supportsE2EE(model) ? "Private TEE" : "Incognito";
}

function toPiModel(model: CatalogModel) {
	const id = model.id ?? model.modelId;
	if (!id) return undefined;
	const metadata = model.metadata;
	const architecture = metadata?.architecture;
	const inputModalities = architecture?.inputModalities ?? [];
	const outputModalities = architecture?.outputModalities ?? [];
	// The catalog includes embeddings, rerankers, image generators, and other
	// non-chat models. pi's OpenAI chat-completions adapter needs text output.
	if (inputModalities.length > 0 && !inputModalities.includes("text")) return undefined;
	if (outputModalities.length > 0 && !outputModalities.includes("text")) return undefined;

	const displayName = metadata?.modelDisplayName ?? model.name ?? model.modelDisplayName ?? id;
	const privacy = privacyLabel(model);

	return {
		// Pi's built-in /model picker renders model IDs in its rows, not `name`.
		// Keep a tagged Pi-side ID and map it back before making the API request.
		id: `${id} [${privacy}]`,
		name: `${displayName} (${privacy})`,
		reasoning: metadata?.supportedFeatures?.includes("reasoning") ?? false,
		input: inputModalities.includes("image") ? (["text", "image"] as ("text" | "image")[]) : (["text"] as ("text" | "image")[]),
		cost: {
			input: costPerMillion(model.inputCostPerToken),
			output: costPerMillion(model.outputCostPerToken),
			cacheRead: costPerMillion(model.cacheReadCostPerToken),
			cacheWrite: costPerMillion(model.cacheWriteCostPerToken),
		},
		contextWindow: metadata?.contextLength ?? 128_000,
		maxTokens: metadata?.maxOutputLength ?? 8_192,
	};
}

export type PiModelConfig = NonNullable<ReturnType<typeof toPiModel>>;

export interface PickerEntry {
	model: PiModelConfig;
	catalog: CatalogModel;
}

export interface DiscoveredModels {
	models: PiModelConfig[];
	secureIds: Set<string>;
	incognitoIds: Set<string>;
	apiIds: Map<string, string>;
	pickerEntries: PickerEntry[];
}

function fallbackModels(): PiModelConfig[] {
	return [toPiModel({ id: FALLBACK_MODEL_ID })!];
}

export async function discoverModels(): Promise<DiscoveredModels> {
	try {
		// This catalog endpoint is public; unlike inference calls it needs no API key.
		const response = await fetch(CATALOG_URL);
		if (!response.ok) throw new Error(`catalog returned HTTP ${response.status}`);

		const payload = (await response.json()) as CatalogResponse | CatalogModel[];
		const entries = Array.isArray(payload) ? payload : (payload.models ?? payload.data ?? []);
		const models: PiModelConfig[] = [];
		const secureIds = new Set<string>();
		const incognitoIds = new Set<string>();
		const apiIds = new Map<string, string>();
		const pickerEntries: PickerEntry[] = [];
		for (const entry of entries) {
			const apiId = entry.id ?? entry.modelId;
			const model = toPiModel(entry);
			if (!model || !apiId) continue;
			models.push(model);
			pickerEntries.push({ model, catalog: entry });
			apiIds.set(model.id, apiId);
			if (privacyLabel(entry) === "Private TEE" && supportsE2EE(entry)) secureIds.add(model.id);
			if (privacyLabel(entry) === "Incognito") incognitoIds.add(model.id);
		}
		if (models.length === 0) throw new Error("catalog contained no chat models");
		return { models, secureIds, incognitoIds, apiIds, pickerEntries };
	} catch (error) {
		console.warn(
			`[near-ai] Model discovery failed; using ${FALLBACK_MODEL_ID}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {
			models: fallbackModels(),
			secureIds: new Set<string>(),
			incognitoIds: new Set<string>(),
			apiIds: new Map<string, string>(),
			pickerEntries: [],
		};
	}
}
