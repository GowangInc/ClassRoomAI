# Connecting your own AI provider

Provider connections belong to this ClassRoomAI installation. An administrator connects an account or key; teachers select that connection in their Spaces. Students do not need provider accounts. Usage and billing belong to the connected provider account.

## Quick setup

1. Open **Providers** and choose a **Provider preset**.
2. Choose a credential source:
   - **API key:** create a key in the provider's own account dashboard and paste it here. It is encrypted on the server, never returned to the browser.
   - **Existing macOS Keychain key:** select an existing supported entry. ClassRoomAI reads it server-side; it does not create, alter or copy Keychain entries.
   - **Sign in to provider (OAuth):** available for OpenRouter and a configured Google Gemini OAuth client. Complete the provider's own authorization screen yourself.
3. Click **Fetch available models**, then choose a model. You can also enter its exact identifier manually.
4. Click **Save connection**, then **Test connection**. OAuth sign-in saves the connection when authorization completes; fetch its models and test it afterwards.
5. Select the saved provider in your Space before previewing or launching.

A catalogue lists model identifiers, not your entitlement to use them. Test the chosen model: credits, plan limits, modality support and API compatibility still apply.

## Defaults and token budgets

Configured DeepSeek is preferred for new Spaces, and the connection editor starts from its preset. DeepSeek defaults are **32,000 output tokens / 240,000 context characters**. These are application budgets, not model maxima: [DeepSeek documents](https://api-docs.deepseek.com/quick_start/pricing) a 1M-token context and up to 384K output for `deepseek-flash`. Context characters are not tokens. The output budget is a ceiling, not a required response length.

Other providers default to 16,384 output tokens / 60,000 context characters. The app accepts up to 128,000 output tokens / 2,000,000 context characters; the selected provider/model may impose lower limits. Explicit stored budgets are never silently raised.

Use **Token limits** in the Space editor to change the selected connection without discarding the draft, or edit its **Advanced connection settings** under Providers. Only administrators can save these installation-wide budgets. Incomplete structured responses still fail explicitly; no partial design or replacement response is applied.


## Presets

| Provider | API base URL | Initial model example |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-5` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.5-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| OpenCode Zen | `https://opencode.ai/zen/v1` | `glm-5.3-flash` |
| OpenCode Go | `https://opencode.ai/zen/go/v1` | `glm-5.3-flash` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` |
| Together AI | `https://api.together.ai/v1` | `MiniMaxAI/MiniMax-M3` |

DeepSeek, Moonshot/Kimi, Z.ai, BigModel, Ollama and LM Studio are also available as presets. Examples can change or require a particular plan; use discovery and the connection test rather than assuming availability.

**OpenCode means its Zen/Go hosted APIs**, not launching the OpenCode CLI on your computer. Use the raw API model identifier, such as `glm-5.3-flash`, not the CLI reference `opencode-go/glm-5.3-flash`. These presets use the Chat Completions API. OpenCode's catalogue also includes other API families; a listed Responses-only model does not become Chat-Completions compatible merely by selecting it.

## A provider without a preset

1. Choose **Custom endpoint…**. **Advanced connection settings** opens.
2. Enter a display name and the API **base URL** from the provider's documentation. Enter the base, not the complete generation endpoint: `https://provider.example/v1`, not `https://provider.example/v1/chat/completions`.
3. Choose the provider's API format:
   - `openai`: OpenAI-compatible Chat Completions, with `Authorization: Bearer …`.
   - `anthropic`: Anthropic Messages, with `x-api-key`.
   - `gemini`: Google Generative Language `generateContent`, with an API key, or the separately configured Google OAuth flow.
4. Enter the key, fetch models or enter an exact model identifier, save, then test.

An arbitrary REST endpoint, consumer chatbot login or Responses-only API is not one of these formats. Do not paste your account password, browser cookies or access tokens into the API-key field.

Remote endpoints must use HTTPS. Plain HTTP is accepted only for approved local/private model servers. URL-embedded credentials, redirects, query strings and fragments are refused. If you move an existing connection to a different endpoint or API format, enter its key again; a stored credential cannot be silently sent to another destination.

An existing Keychain or OAuth credential is restricted to its provider's direct endpoint. Choose an explicit new credential source for another service.

### Local models

Start Ollama or LM Studio independently, then choose its preset. A keyless local server can leave the key field blank. A preset does not install, download or start a model. Choose a model actually loaded by your local server.

### Advanced options

Most users only need provider, credentials and model. The advanced section also contains display name, API format, base URL, optional image model, maximum output tokens and maximum context characters.

A short chat output limit may be too small for a full Space design or task assessment. An incomplete structured response fails explicitly. Increase the output limit or shorten the requested design; no partial result is silently substituted. Vision assessment requires a model that accepts the supplied images.

## Provider OAuth

### OpenRouter

Choose the OpenRouter preset, then **Sign in to provider (OAuth)** and **Sign in with OpenRouter**. OpenRouter asks you to authorize an application-controlled API key. ClassRoomAI uses S256 PKCE and a one-shot, browser/session-bound callback, and stores the issued key encrypted.

OpenRouter issues a persistent API key, not a refresh-token grant. It still uses your OpenRouter plan and credits; it does not consume a ChatGPT or Claude consumer subscription.

### Google Gemini: server setup required

Register **your own** Google Cloud OAuth client. ClassRoomAI does not borrow Google's CLI client or import credentials from another application.

1. Create/select a Google Cloud project and enable the **Generative Language API**.
2. Configure the OAuth consent screen and permitted test users or organizational audience.
3. Create an OAuth client appropriate for your deployment. For a web application, register the exact callback below, replacing the origin with your configured `BASE_URL`:

   `http://127.0.0.1:9272/api/provider-oauth/callback`

4. Supply these server environment variables using your private credential storage, then restart ClassRoomAI:

   | Variable | Meaning |
   | --- | --- |
   | `GEMINI_OAUTH_CLIENT_ID` | Your registered OAuth client ID |
   | `GEMINI_OAUTH_CLIENT_SECRET` | Its client secret; server-only |
   | `GEMINI_OAUTH_PROJECT_ID` | Project used for API enablement, quota and billing |

5. Open Providers at that exact configured origin and choose **Sign in with Google for Gemini**. Approve the requested API scopes yourself.

Do not put real secrets in this synced source directory or commit them. The login requests Google's documented `cloud-platform` and `generative-language.retriever` scopes, not merely identity sign-in. The account needs the appropriate project permissions, quota and billing. Google app verification and organization policy may restrict who can authorize.

Access and refresh tokens are encrypted. Expiring access tokens renew server-side; concurrent requests share one refresh. A revoked grant or changed OAuth client/project requires signing in again. Google login is unavailable until the server configuration is present.

### Callback and disconnect rules

Provider login needs an HTTPS `BASE_URL` or an HTTP loopback address on the host computer. A plain LAN address is not an OAuth callback origin. The browser must be able to reach the configured origin; opening the app from another hostname does not move its callback.

Unfinished login flows expire after ten minutes and do not survive a server restart. Signing out or changing the administrator session, or editing the target connection during login, prevents credential replacement.

**Disconnect OAuth locally** removes the credential from ClassRoomAI, not from the provider account, and does not delete Spaces or work. Provider-side revocation is a separate action in the provider's own account settings. Reconnect with another explicit sign-in.

## Common failures

- **Authentication rejected:** the key or grant is invalid, expired or revoked. Replace the key or sign in again.
- **Insufficient credits / rate limit:** change your provider plan, credits or selected model. Model discovery can succeed even when generation is blocked.
- **No compatible model catalogue:** enter a documented model ID manually, then test it.
- **Unsupported API / model family:** use a compatible Chat Completions, Messages or Gemini endpoint/model; changing a URL alone does not translate protocols.
- **Task monitoring unavailable:** check the connection, model capabilities and request limits. Review student work directly; an unavailable check is not an all-clear.

Automatic task/safeguarding assessment sends conversation and saved-work context to the chosen provider and adds model usage. Review school privacy requirements and provider terms before using real student records. Alerts and completion estimates are AI advisory judgments, not grades, verified identities or certified safeguarding.

## Protocol references

- [OpenRouter OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)
- [Google Gemini OAuth setup](https://ai.google.dev/gemini-api/docs/oauth)
- [OpenCode Zen live model catalogue](https://opencode.ai/zen/v1/models)
- [OpenCode Go live model catalogue](https://opencode.ai/zen/go/v1/models)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Mistral Chat API](https://docs.mistral.ai/api)
- [Together OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility)
