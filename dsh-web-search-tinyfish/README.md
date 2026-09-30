---
description: "The TinyFish-backed search and fetch providers for ctx.web: how deployments mount TinyFish web search and Chromium-rendered markdown retrieval with per-URL error reporting and exact local truncation."
kind: "package-reference"
---

# @customize/dsh-web-search-tinyfish

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-tinyfish`, the harness searches and reads the web through TinyFish: `GET https://api.search.tinyfish.ai` returns ranked results with titles, snippets, and URLs optimized for LLM consumption, and `POST https://api.fetch.tinyfish.ai` renders the page in a real Chromium and returns clean extracted text as markdown, HTML, or JSON. Choose it when a deployment holds a TinyFish API key — every call requires one (`X-API-Key`), and unlike Keenable there is no keyless public endpoint. Both capabilities are free at any wallet balance under per-endpoint rate limits (30 requests/min for search, 150 URLs/min for fetch). The model-facing `web_search` and `web_fetch` tools live in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers the `tinyfish` search **and** fetch providers, so `ctx.web.search()` and `ctx.web.fetch()` resolve them when they are the only usable backends — or pin them with `searchProvider: tinyfish` and `fetchProvider: tinyfish`.

### When to choose it

Choose this backend when a deployment holds a TinyFish API key (create one at <https://agent.tinyfish.ai/api-keys>) and wants TinyFish's ranked search plus real-browser rendering for fetch under one credential. Without a key both providers stay registered but report unavailable, and the seam treats the capability as unconfigured instead of failing every call; the capability is likewise unavailable when an endpoint base does not parse, the output format is unsupported, or the numeric bounds are violated.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$TINYFISH_API_KEY` from the launch environment, and all other settings have safe defaults.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@customize/dsh-web-search-tinyfish'
  config:
    apiKey: !!js process.env.TINYFISH_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$TINYFISH_API_KEY` | TinyFish API key; empty or absent makes both providers unavailable |
| `searchBaseURL` | `https://api.search.tinyfish.ai` | Search endpoint base; an unparseable value makes the search provider unavailable |
| `fetchBaseURL` | `https://api.fetch.tinyfish.ai` | Fetch endpoint base (a different host from search) |
| `purpose` | (unset) | Optional statement of *why* you search, sent as TinyFish's `purpose`; improves result quality, max 2000 chars |
| `location` | (unset) | Country code for geo-targeted results (e.g. `US`, `CN`) |
| `language` | (unset) | Result language code (e.g. `en`, `zh`) |
| `includeDomains` | (unset) | Comma-separated domains to restrict results to |
| `excludeDomains` | (unset) | Comma-separated domains to exclude from results |
| `domainType` | (unset) | `web`, `news`, or `research_paper` |
| `recencyMinutes` | (unset) | Freshness window in minutes (1…5256000); cannot combine with `afterDate`/`beforeDate` |
| `afterDate` | (unset) | Lower date bound, `YYYY-MM-DD` |
| `beforeDate` | (unset) | Upper date bound, `YYYY-MM-DD` (≥ `afterDate`) |
| `pubYearMin` / `pubYearMax` | (unset) | Publication-year bounds (0…9999); `research_paper` only |
| `page` | (unset) | Default result page number, zero-based, max 10 |
| `format` | `markdown` | Fetch output format: `markdown`, `html`, or `json` |
| `maxChars` | `50000` | Total-character cap applied to a fetched page before returning it |
| `ttl` | `0` | Cache freshness in seconds: `0` = always live; positive = accept cache younger than N seconds |
| `perUrlTimeoutMs` | `60000` | Per-URL timeout budget forwarded to TinyFish (1…110000) |

### What a search returns

Each TinyFish result maps to a `WebSearchSource`: `url`, `title`, and `snippet`. The search filters above (`purpose`, `location`, `language`, domain filters, date bounds, `domainType`, `page`) are deployment configuration, not request parameters. A request's `maxResults` is **not** a TinyFish parameter: one response page is server-sized (10 results in practice), so the provider passes the request through and the seam truncates `sources[]` and sets `truncated` — raise the configured `page` for more.

### What a fetch returns

Each TinyFish fetch maps to a `WebFetchResult`: the extracted content under `body` (`markdown` and `json` — a stringified document tree — decode to kind `text`, `html` to kind `html`), the envelope's `url` (falling back to the request URL), and `statusCode: 200`, because TinyFish's envelope carries no target-page status code. The provider slices `content` to `maxChars` itself and sets `truncated` only when it actually cut. Redirects are not followed at the HTTP level (`redirect: "error"`); TinyFish follows them browser-side and reports the final URL as `final_url`.

### Failures and recovery

TinyFish performs the retrieval, so page-level problems surface per URL: 404s, bot blocks, timeouts, and private-address or localhost targets (rejected by TinyFish itself as `invalid_url`, matching the local fetcher's policy) arrive in `errors[]` next to an HTTP 200, and surface as `WebError` `WEB_PROVIDER_ERROR` (`WEB_INVALID_URL` for `invalid_url` / `invalid_redirect_url`). Callers route on the code; the model-facing tools surface failures to the model under their own error wrappers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the providers; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Real-browser extraction only.** `fetch()` always goes through TinyFish's Chromium rendering — the provider never fetches locally — so JS-heavy pages extract cleanly, and pages TinyFish cannot reach surface per-URL instead of poisoning the result.
- **Deployment-scoped search filters.** The search filters are plugin configuration rather than request parameters, keeping the provider-neutral web seam free of TinyFish-specific query fields.
- **Exact local truncation.** TinyFish's response caps are soft, so the provider slices content to `maxChars` itself and only then sets `truncated`.

### Source map

| File | Role |
|---|---|
| `index.js` | Plugin entry: config schema, environment fallback, provider registration, and both providers in one build-free module |

### Request and mapping flow

`search()` GETs the configured search endpoint with the deployment's filters as query parameters and the key as `X-API-Key`; `fetch()` POSTs the target URL with `format`, `ttl`, and `per_url_timeout_ms`. Both calls reject HTTP redirects without contacting a `Location` target. The search envelope maps field by field into `WebSearchSource` entries; the fetch envelope decodes per `format`, slices to `maxChars`, and collects per-URL failures into `errors[]`.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`: `web_search` retains this provider's URLs, titles, and snippets or its exact failures; `web_fetch` retains the page as markdown text or the fetch-flavored equivalents of the same failures.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **A key is required at all times** — there is no keyless or anonymous mode; without credentials both providers report unavailable.
- **Search has no result-count control** — one call returns one server-sized page (10 results in practice); `maxResults` is honored by the seam's truncation, not by TinyFish.
- **Highlights are never sent** — highlight extraction is beta and per-account; this plugin omits the parameter.
- **Conditional requests are not exposed** — `if_none_match` is unavailable; `ttl` covers cache-freshness needs.
