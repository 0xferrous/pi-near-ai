import {
	createAssistantMessageEventStream,
	openAICompletionsApi,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Api,
	type AssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { BASE_URL, type DiscoveredModels } from "./model-catalog.ts";

type NearInferenceClient = import("@nearai/inference-sdk/node").InferenceClient;
const inferenceClients = new Map<string, NearInferenceClient>();

async function getInferenceClient(apiKey: string): Promise<NearInferenceClient> {
	const cached = inferenceClients.get(apiKey);
	if (cached) return cached;

	const majorVersion = Number(process.versions.node.split(".")[0]);
	if (!Number.isFinite(majorVersion) || majorVersion < 24) {
		throw new Error("NEAR AI E2EE requires Node.js 24 or newer. Run pi inside the project's devenv shell.");
	}

	const { InferenceClient } = await import("@nearai/inference-sdk/node");
	const client = new InferenceClient({ apiKey, baseUrl: BASE_URL, e2ee: true, signingAlgo: "ed25519" });
	inferenceClients.set(apiKey, client);
	return client;
}

function streamError(
	model: Model<Api>,
	errorMessage: string,
	reason: "error" | "aborted" = "error",
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: reason,
		errorMessage,
		timestamp: Date.now(),
	};
	stream.push({ type: "error", reason, error: message });
	stream.end();
	return stream;
}

function streamNearAiE2EE(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		if (!options?.apiKey) throw new Error("Set NEAR_AI_API_KEY to use the NEAR AI E2EE provider.");
		const client = await getInferenceClient(options.apiKey);
		const secureFetch: typeof fetch = async (input, init) => {
			try {
				return await client.fetch(input, init);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") throw error;
				// Return SDK verification failures as HTTP errors so pi-ai preserves
				// the diagnostic instead of reducing them to "Connection error".
				const status = (error as { failure?: { details?: { status?: unknown } } })?.failure?.details?.status;
				const responseStatus = typeof status === "number" && status >= 400 && status < 600 ? status : 502;
				const message = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: { message } }), {
					status: responseStatus,
					headers: { "Content-Type": "application/json" },
				});
			}
		};
		const innerStream = openAICompletionsApi().streamSimple(model as Model<"openai-completions">, context, {
			...options,
			// InferenceClient verifies Gateway/model evidence, encrypts supported
			// request fields, and decrypts/authenticates encrypted response fields.
			fetch: secureFetch,
		});
		const bufferedEvents: AssistantMessageEvent[] = [];
		let completionId: string | undefined;
		for await (const event of innerStream) {
			if (event.type === "error") {
				const failed = streamError(model, event.error.errorMessage ?? "NEAR AI inference failed.", event.reason);
				for await (const failedEvent of failed) stream.push(failedEvent);
				stream.end();
				return;
			}
			const snapshot = structuredClone(event);
			bufferedEvents.push(snapshot);
			if (event.type === "done") completionId = event.message.responseId;
		}
		if (!completionId) throw new Error("NEAR AI response has no completion ID; refusing to return an unverified response.");

		// Hold text and tool calls until the SDK verifies the signature over the
		// exact response bytes captured before E2EE decryption.
		await client.verifyResponse(completionId);
		for (const event of bufferedEvents) stream.push(event);
		stream.end();
	})().catch(async (error: unknown) => {
		const failed = streamError(model, error instanceof Error ? error.message : String(error));
		for await (const event of failed) stream.push(event);
		stream.end();
	});

	return stream;
}

export function createNearAiStream(discovered: DiscoveredModels) {
	return function streamNearAi(
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream {
		const apiId = discovered.apiIds.get(model.id);
		if (!apiId) {
			return streamError(
				model,
				`Could not determine a supported privacy route for ${model.id} from the NEAR AI model catalog; refusing to send the request.`,
			);
		}
		const apiModel = { ...model, id: apiId };
		if (discovered.secureIds.has(model.id)) {
			return streamNearAiE2EE(apiModel, context, options);
		}
		if (discovered.incognitoIds.has(model.id)) {
			return openAICompletionsApi().streamSimple(apiModel as Model<"openai-completions">, context, options);
		}
		return streamError(
			model,
			`Could not determine a supported privacy route for ${model.id} from the NEAR AI model catalog; refusing to send the request.`,
		);
	};
}
