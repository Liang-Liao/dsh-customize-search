---
description: "The Keenable-backed search and fetch providers for ctx.web: how deployments mount vendor-native web search and markdown retrieval with portable snippets, publication dates, and a keyless public fallback."
kind: "package-reference"
---

# @customize/dsh-web-search-keenable

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-keenable`, the harness searches and reads the web through [Keenable](https://keenable.ai): ranked results with portable snippets and publication dates from `/v1/search`, and page content as markdown from `/v1/fetch`. Choose it when a deployment wants Keenable's `pro`/`realtime` retrieval — with a `KEENABLE_API_KEY` both call the keyed endpoints, and without one they transparently fall back to the keyless public endpoints. Keenable returns no generated answer, so search results carry no `content` — only citeable sources. A result with neither a non-blank `snippet` nor a non-blank `description` is dropped, so a call can return fewer sources than requested. The model-facing `web_search` and `web_fetch` tools live in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers the `keenable` search **and** fetch providers, so `ctx.web.search()` and `ctx.web.fetch()` resolve them when they are the only usable backends — or pin them with `searchProvider: keenable` and `fetchProvider: keenable`. This profile pins both, so Keenable fully replaces the local HTTP fetcher.

### When to choose it

Choose this backend when a deployment holds a Keenable API key and wants Keenable's ranked retrieval and markdown extraction under one credential. Both capabilities are keyless out of the box: without a key they call `/v1/search/public` and `/v1/fetch/public` (rate limited per IP, no credits), and with `KEENABLE_API_KEY` they call `/v1/search` and `/v1/fetch`. Either capability is unavailable — and every call fails with a structured error — when neither a key nor an application title is configured, or when the endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$KEENABLE_API_KEY` from the launch environment, and all other settings have safe defaults.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@customize/dsh-web-search-keenable'
  config:
    apiKey: !!js process.env.KEENABLE_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$KEENABLE_API_KEY` | Keenable API key; empty or absent uses the keyless public endpoints, which then require `appTitle` |
| `baseURL` | `https://api.keenable.ai` | Endpoint base; `/v1/search` or `/v1/fetch` (keyed) and their `/public` twins (keyless) are appended. An unparseable value makes both providers unavailable |
| `mode` | `pro` | Search retrieval mode sent as Keenable's `mode`: `pro` (deeper retrieval) or `realtime` (fastest) |
| `appTitle` | `$KEENABLE_APP_TITLE`, else `deepseek-harness` | Application name sent as the `X-Keenable-Title` header on keyless calls; Keenable rejects the public endpoints without it |
| `site` | (unset) | Restrict search results to one site, sent as Keenable's `site` (e.g. `techcrunch.com`) |
| `maxResults` | (unset) | Default search result count when a request carries no `maxResults`; Keenable accepts 1–50, and a larger value is clamped to 50 |
| `snippetMaxLength` | (unset) | Maximum search snippet length in characters, sent as Keenable's `snippet_max_length`; must be between 180 and 10000 |
| `maxChars` | `50000` | Maximum fetched content length in characters, sent as Keenable's `max_chars`; longer content is truncated |
| `live` | `true` | Fetch the page live from the source (`live=true`) instead of Keenable's indexed copy. The default matches the local HTTP fetcher this provider replaces; the indexed copy fails for URLs Keenable has not indexed |

### What a search returns

Each Keenable result maps to a `WebSearchSource`: `url`, `title`, the first non-blank of `snippet` then `description` as `snippet`, and `published_at` as `publishedAt`; a result with neither field has no portable snippet and is dropped. A request's `maxResults` wins over the configured `maxResults` default and is sent to Keenable as a cost and latency optimization — the final bound is enforced by the service, which truncates and flags. Keenable returns no generated answer, so the result carries no `content`.

### What a fetch returns

Each Keenable fetch maps to a `WebFetchResult`: the page as markdown under `body.kind: 'text'`, the envelope's `url` (falling back to the request URL), and `statusCode: 200`. Keenable's `max_chars` is a soft cap — it may return somewhat more than asked — so the provider slices `content` to `maxChars` itself and sets `truncated` only when it actually cut. The envelope carries no target-page status code, so an unreachable or unextractable page surfaces as a Keenable API error (`WEB_PROVIDER_ERROR`) rather than a non-200 result. Only http(s) request URLs reach the API; anything else fails locally as `WEB_INVALID_URL`.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR` with the response's `error`/`message` detail when present; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Callers route on the code; the model-facing tools surface failures to the model under their own error wrappers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the providers; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package is a thin adapter over Keenable's API with three deliberate rules:

- **Portable snippets only.** A source gains a `snippet` only from a real `snippet`/`description` field; inventing one from other fields would make the seam lie, so snippet-less results are dropped entirely.
- **No invented answers.** Keenable returns no generated answer, so search `content` is omitted rather than fabricating provider prose the model might trust.
- **Live by default for fetch.** The indexed copy is cheaper but fails on unindexed URLs; because this provider replaces the local live HTTP fetcher, `live` defaults to `true` and the cheaper path stays one config field away.

### Source map

| File | Role |
|---|---|
| `index.js` | Plugin entry: config schema, environment fallback, provider registration, and both providers in one build-free module |

### Request and mapping flow

`search()` posts the query, retrieval mode, and optional result count, snippet length, and site filter to the keyed or keyless operation with `redirect: 'error'`, so a redirect fails the request without contacting the target. `fetch()` GETs the keyed or keyless operation with the URL, `max_chars`, and `live` as query parameters. Both parsed envelopes are mapped field by field, and both classify an abort — a `DOMException` named `AbortError` — as `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`: `web_search` retains this provider's `maxResults`-bounded URLs, titles, snippets, and publication dates or its exact `Keenable search aborted`, `Keenable search request failed: <error>`, and `Keenable returned an unprocessable response body: <error>` failures; `web_fetch` retains the page as markdown text or the fetch-flavored equivalents of the same failures.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **A search result with no non-blank `snippet` or `description` is dropped entirely** — there is no portable snippet to map, so fewer sources than requested can return.
- **Fetch surface is a subset of the local fetcher** — no redirect following, byte caps, charset decoding, or private-address policy: Keenable performs the retrieval, so those checks belong to Keenable, and a non-200 origin page surfaces as a provider error rather than a status-coded result.
- **Fetch truncation is provider-enforced** — `content` is sliced to `maxChars` because Keenable's `max_chars` is a soft cap; `truncated` is exact, not inferred.
- **Only `mode`/`site`/`maxResults`/`snippetMaxLength`/`maxChars`/`live` are exposed** — Keenable's date filters (`published_after`, `acquired_before`, …), point-in-time `query_time`, and the fetch `prompt` extraction instruction wait on provider-neutral service fields in the web seam.
- **The keyless public endpoints are a shared pool** — without an API key, calls are rate limited per IP (1,000 requests/hour, 10 requests/second) and carry no usage metadata; set `KEENABLE_API_KEY` for production volume.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
