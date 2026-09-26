# NEAR AI Cloud provider for pi

A pi extension that discovers NEAR AI Cloud models and registers one `near-ai`
provider.

## Setup

Authenticate with either an environment variable:

```sh
export NEAR_AI_API_KEY="sk-..."
```

or, after loading the extension, use `/login near-ai` in pi and choose the API
key option. Pi stores that credential in its local `auth.json`.

Load the extension from the Node 24 development environment:

```sh
devenv shell
npm install
pi -e /path/to/pi-near-ai/near-ai.ts
```

Use `/model` to choose a model. The picker ID includes `(Private TEE)` when both
`verifiable` and `attestationSupported` are true; other catalog models are
labeled `(Incognito)`. `/near-model-picker` first asks whether to browse
Private TEE, Incognito, or all models. In the picker, `i` sorts by input cost,
`o` by output cost, and `n` by name; pressing the same key again reverses the
sort. Press `/` to fuzzy-search by model name, ID, metadata, or cost. Use arrow
keys and Enter to select; Escape exits search or cancels the picker.

The selected model shows input/output cost per million tokens, cache rates and
image pricing when listed, alongside `verifiable`, `attestationSupported`,
`providerType`, and `ownedBy`. Selecting a result switches to that model.

The extension fetches the public catalog from
`https://cloud-api.near.ai/v1/model/list`; discovery does not need an API key.
Inference does. If discovery fails, a fallback model is listed, but requests
fail closed because its privacy route could not be established.

## Development

Run the TypeScript check inside the development environment:

```sh
devenv shell
npm install
npm run check
```

The inference SDK requires Node.js 24 or newer.

## Code layout

- `near-ai.ts`: provider setup and module wiring.
- `model-catalog.ts`: catalog discovery, model metadata, privacy labels, and
  catalog-derived costs.
- `inference.ts`: HTTPS/E2EE routing and response-signature verification.
- `near-model-picker.ts`: privacy selection, fuzzy search, and sorting UI.

## Privacy and verification

Private TEE models use NEAR's SDK to verify Gateway/model evidence, encrypt
supported request fields, decrypt responses, and verify the completion response
signature. The extension buffers text and tool calls until signature
verification succeeds, so E2EE responses are not streamed to pi. Verification
failure returns an error without exposing the unverified output.

Incognito models use HTTPS through NEAR AI Cloud and are processed by the
listed external provider. The route is intended to keep the requester's
identity private from that provider; the provider still processes the prompt
content. The catalog flags, not the model name, determine whether the E2EE
path is used.
