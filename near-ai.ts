import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createNearAiStream } from "./inference.ts";
import { BASE_URL, discoverModels, PROVIDER_ID } from "./model-catalog.ts";
import { registerNearModelPicker } from "./near-model-picker.ts";

export default async function (pi: ExtensionAPI) {
	const discovered = await discoverModels();

	pi.registerProvider(PROVIDER_ID, {
		name: "NEAR AI Cloud",
		baseUrl: BASE_URL,
		apiKey: "$NEAR_AI_API_KEY",
		api: "openai-completions",
		models: discovered.models,
		streamSimple: createNearAiStream(discovered),
	});

	registerNearModelPicker(pi, discovered);
}
