# @customize/dsh-web-search-tinyfish

TinyFish-backed search and fetch providers for the DeepSeek Harness web
capability seam (`ctx.web`), mirroring `@deepseek-ai/dsh-web-search-exa` and
`@customize/dsh-web-search-keenable`.

- **Search** — `GET https://api.search.tinyfish.ai`, ranked JSON results with
  titles, snippets, and URLs, optimized for LLM consumption. Free at any wallet
  balance (30 requests/min).
- **Fetch** — `POST https://api.fetch.tinyfish.ai`, renders the page in a real
  Chromium and returns clean extracted text (markdown / HTML / JSON). Free at
  any wallet balance (150 URLs/min).

Both calls require an `X-API-Key` header — TinyFish has **no keyless/public
endpoint**, unlike Keenable.

## Install

```powershell
plugin_manager action=install_bundle target=E:\programData\dsh\project\dsh-web-search-tinyfish
```

The bundle inserts the `web-search-tinyfish` plugin row. Pin the providers in
your profile patch (`cordis.patch.yml`) once installed:

```yaml
- id: web
  config:
    searchProvider: tinyfish
    fetchProvider: tinyfish
```

Host plugin changes take effect only after a Harness restart.

## Configuration

Create a key at <https://agent.tinyfish.ai/api-keys> and either put it in the
plugin config `apiKey` field or export it as `TINYFISH_API_KEY` (read through
the launch-environment layers: process env, project `.env`, `$DSH_HOME/.env`).

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | `TINYFISH_API_KEY` env | TinyFish API key. Required — without it `available()` is `false`. |
| `searchBaseURL` | `https://api.search.tinyfish.ai` | Search endpoint base. |
| `fetchBaseURL` | `https://api.fetch.tinyfish.ai` | Fetch endpoint base (a different host from search). |
| `purpose` | — | Optional statement of *why* you search; improves result quality. Max 2000 chars. |
| `location` | — | Country code for geo-targeted results (e.g. `US`, `CN`). |
| `language` | — | Result language code (e.g. `en`, `zh`). |
| `includeDomains` | — | Comma-separated domains to restrict results to. |
| `excludeDomains` | — | Comma-separated domains to exclude from results. |
| `domainType` | `web` | `web`, `news`, or `research_paper`. |
| `recencyMinutes` | — | Freshness window in minutes (1…5256000). Cannot combine with `afterDate`/`beforeDate`. |
| `afterDate` | — | Lower date bound, `YYYY-MM-DD`. |
| `beforeDate` | — | Upper date bound, `YYYY-MM-DD` (≥ `afterDate`). |
| `pubYearMin` / `pubYearMax` | — | Publication-year bounds (0…9999); `research_paper` only. |
| `page` | — | Result page number, 0-based, max 10. |
| `format` | `markdown` | Fetch output format: `markdown`, `html`, or `json`. |
| `maxChars` | `50000` | Total-character cap applied to a fetched page before returning it. |
| `ttl` | `0` | Cache freshness in seconds: `0` = always live; positive = accept cache younger than N seconds. |
| `perUrlTimeoutMs` | `60000` | Per-URL timeout budget forwarded to TinyFish (1…110000). |

## Behavior notes

- `maxResults` from the search request is **not** a TinyFish parameter: one
  response page is server-sized, so the provider passes the request through and
  the seam truncates `sources[]` and sets `truncated`. Raise `page` or rely on
  the web tool's own bound when you need more than one page.
- A fetch maps to `statusCode: 200` on success because TinyFish's envelope
  carries no origin status code. Per-URL failures (404, bot blocks, timeouts)
  arrive in `errors[]` next to an HTTP 200 and surface as `WebError` with
  `WEB_PROVIDER_ERROR` (`WEB_INVALID_URL` for `invalid_url` /
  `invalid_redirect_url`).
- `format: "html"` decodes to body kind `html`; `markdown` and `json`
  (stringified document tree) decode to `text`.
- Private IPs, localhost, and cloud metadata endpoints are rejected by
  TinyFish itself (per-URL `invalid_url`), matching the local fetcher's policy.
- Redirects are not followed by the provider (`redirect: "error"`); TinyFish
  follows them browser-side and reports the final URL as `final_url`.

## Limitations

- Requires an API key at all times; there is no free-anonymous mode.
- Search has no result-count control, so one call returns one server-sized
  page (10 results in practice).
- Highlight extraction is beta and per-account; this plugin never sends it.
- Conditional requests (`if_none_match`) are not exposed; `ttl` covers cache
  freshness needs.
