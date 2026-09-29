import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
/**
 * `TinyFishSearchProvider`: a `WebSearchProvider` backed by the TinyFish search
 * API (`GET https://api.search.tinyfish.ai`). TinyFish has no result-count
 * parameter — one page is server-sized — so `maxResults` passes through to the
 * seam, which truncates on the way back. Results map straight to
 * `WebSearchSource`; entries without a non-blank `snippet` are dropped and
 * `content` is omitted because TinyFish returns no generated answer.
 * @module @customize/dsh-web-search-tinyfish/provider
 */
/** Stable id both providers register under (unique per capability kind). */
const TINYFISH_PROVIDER_ID = "tinyfish";
/** Default TinyFish search endpoint base; every request is a `GET` against it. */
const TINYFISH_DEFAULT_SEARCH_BASE_URL = "https://api.search.tinyfish.ai";
/** Default TinyFish fetch endpoint base; every request is a `POST` against it. */
const TINYFISH_DEFAULT_FETCH_BASE_URL = "https://api.fetch.tinyfish.ai";
/** Default output format for fetched pages; TinyFish recommends markdown for LLMs. */
const TINYFISH_DEFAULT_FORMAT = "markdown";
/** Default total-character cap applied to a fetched page before returning it. */
const TINYFISH_DEFAULT_MAX_CHARS = 50000;
/**
 * Default cache-freshness preference (`ttl`) in seconds. `0` forces a live
 * fetch; this provider replaces the local HTTP fetcher, which always reads the
 * live source, so it defaults to `0`.
 */
const TINYFISH_DEFAULT_TTL = 0;
/** Default per-URL wall-clock budget forwarded as `per_url_timeout_ms`. */
const TINYFISH_DEFAULT_PER_URL_TIMEOUT_MS = 60000;
/** TinyFish's accepted `per_url_timeout_ms` upper bound (the backend cap). */
const TINYFISH_MAX_PER_URL_TIMEOUT_MS = 110000;
/** TinyFish's accepted `recency_minutes` bounds (1 minute .. 10 years). */
const TINYFISH_MIN_RECENCY_MINUTES = 1;
const TINYFISH_MAX_RECENCY_MINUTES = 5256000;
/** TinyFish's accepted `page` upper bound (zero-based pagination). */
const TINYFISH_MAX_PAGE = 10;
/** Attribution header sent on every request. */
const USER_AGENT = "dsh-web-search-tinyfish/1.0.2";
/**
 * Return the first non-blank string among `values`, or `undefined`.
 *
 * TinyFish's publication date field is named differently across result kinds
 * (news and web results carry a date, academic ones use year fields), so the
 * mapping treats every known spelling as a candidate and blank text as absent.
 */
function firstNonBlank(...values) {
	for (const value of values) {
		if (value != null && value.trim().length > 0) return value;
	}
	return void 0;
}
/**
 * Map one TinyFish search result to a normalized source, or `undefined` when it
 * carries no portable snippet (an entry with no non-blank `snippet` is dropped —
 * the seam has no other field to derive a snippet from, and inventing one would
 * lie).
 *
 * @param result - one entry of TinyFish's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank `snippet`.
 */
function mapTinyFishResult(result) {
	const snippet = firstNonBlank(result.snippet);
	if (snippet === void 0) return void 0;
	return {
		url: result.url,
		...result.title != null && result.title.length > 0 ? { title: result.title } : {},
		snippet,
		...firstNonBlank(result.published_date, result.published_at, result.date, result.publishedDate) !== void 0 ? { publishedAt: firstNonBlank(result.published_date, result.published_at, result.date, result.publishedDate) } : {}
	};
}
/**
 * Map a TinyFish search response envelope to a normalized search result.
 *
 * TinyFish answers with no `content`, so the result omits it; the seam truncates
 * `sources[]` to the request's `maxResults` and owns the `truncated` flag,
 * because TinyFish's API has no result-count parameter to apply at the request
 * layer.
 *
 * @param response - the parsed `GET https://api.search.tinyfish.ai` body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapTinyFishResult}).
 */
function mapTinyFishResponse(response) {
	const results = Array.isArray(response?.results) ? response.results : [];
	return {
		sources: results.map(mapTinyFishResult).filter((source) => source !== void 0),
		truncated: false
	};
}
/**
 * Map a TinyFish fetch response envelope to a normalized fetch result, or
 * `undefined` when it carries no usable text.
 *
 * TinyFish renders the page in a real browser and returns cleaned content in
 * the requested `format`: `markdown`/`json` decode to `text`, `html` to `html`.
 * The envelope carries no target-page status code, so a successful call maps to
 * `200` — an unreachable, blocked, or unextractable page surfaces in
 * `errors[]` instead ({@link findTinyFishFetchError}). TinyFish applies no
 * character cap of its own, so the provider slices `text` to `maxChars` — the
 * same discipline the local HTTP fetcher applies — and flags `truncated` only
 * when it actually cut.
 *
 * @param response - the parsed `POST https://api.fetch.tinyfish.ai` body.
 * @param requestUrl - the URL the request asked for, used when the envelope
 *   carries none.
 * @param maxChars - the total-character cap applied before returning.
 * @param format - the `format` the request sent, which decides the body kind.
 * @returns the normalized fetch result, or `undefined` when the matching result
 *   entry has no `text`.
 */
function mapTinyFishFetch(response, requestUrl, maxChars, format) {
	const results = Array.isArray(response?.results) ? response.results : [];
	const entry = results.find((result) => result?.url === requestUrl) ?? results[0];
	const text = entry?.text;
	if (text == null) return void 0;
	const raw = typeof text === "string" ? text : JSON.stringify(text);
	const truncated = raw.length > maxChars;
	return {
		url: entry?.final_url != null && entry.final_url.length > 0 ? entry.final_url : entry?.url != null && entry.url.length > 0 ? entry.url : requestUrl,
		statusCode: 200,
		body: {
			kind: format === "html" ? "html" : "text",
			content: truncated ? raw.slice(0, maxChars) : raw
		},
		truncated
	};
}
/**
 * Find the per-URL failure entry for this request, if any.
 *
 * TinyFish reports per-URL failures (timeouts, bot blocks, 404s) in `errors[]`
 * alongside an HTTP 200, so a transport-level success does not mean the page
 * was fetched. One URL is sent per request, so the entry matching the requested
 * URL is preferred, with a lone entry as the fallback.
 *
 * @param response - the parsed `POST https://api.fetch.tinyfish.ai` body.
 * @param requestUrl - the URL the request asked for.
 * @returns the matching `errors[]` entry, or `undefined` when the page fetched.
 */
function findTinyFishFetchError(response, requestUrl) {
	const errors = Array.isArray(response?.errors) ? response.errors : [];
	if (errors.length === 0) return void 0;
	return errors.find((error) => error?.url === requestUrl) ?? errors[0];
}
/**
 * Describe one per-URL failure entry as a `WebError`.
 *
 * `invalid_url`/`invalid_redirect_url` are request-shape rejections (private
 * IPs, bad schemes) and map to `WEB_INVALID_URL`; every other code —
 * `target_http_error`, `page_not_found`, `timeout`, `bot_blocked`, … — is a
 * provider failure.
 */
function fetchErrorFromEntry(entry) {
	const code = typeof entry?.error === "string" && entry.error.length > 0 ? entry.error : "unknown_error";
	const status = typeof entry?.status === "number" ? entry.status : void 0;
	const message = `TinyFish fetch failed for ${entry?.url ?? "the requested URL"} (${code}${status !== void 0 ? `, HTTP ${status}` : ""})`;
	if (code === "invalid_url" || code === "invalid_redirect_url") {
		return new WebError(message, "WEB_INVALID_URL");
	}
	return new WebError(message, "WEB_PROVIDER_ERROR");
}
/**
 * Describe a non-2xx TinyFish response as one message, best effort.
 *
 * The body is read once as text so both the JSON error envelope and a
 * plain-text failure stay readable; an aborted read surfaces as `WEB_ABORTED`
 * like every other cancellation in this package.
 */
async function describeTinyFishError(response) {
	const fallback = `TinyFish API error (HTTP ${response.status})`;
	let text;
	try {
		text = await response.text();
	} catch (error) {
		if (isAbortError(error)) throw new WebError("TinyFish request aborted", "WEB_ABORTED", { cause: error });
		return fallback;
	}
	const trimmed = text.trim();
	if (trimmed.length === 0) return fallback;
	try {
		const parsed = JSON.parse(trimmed);
		const detail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
		if (typeof detail === "string" && detail.length > 0) return detail;
	} catch {
	}
	return trimmed;
}
/**
 * Parse and policy-check one fetch request URL before any network call.
 *
 * Only http(s) URLs reach TinyFish; anything else is a request-shape error,
 * not a provider failure.
 */
function parseFetchUrl(input) {
	if (!URL.canParse(input)) throw new WebError(`invalid URL: ${input}`, "WEB_INVALID_URL");
	const url = new URL(input);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, "WEB_INVALID_URL");
	}
	return url;
}
/** The TinyFish-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
var TinyFishSearchProvider = class {
	options;
	id = "tinyfish";
	constructor(options) {
		this.options = options;
	}
	available() {
		return this.hasCredentials() && isValidBaseUrl(this.options.searchBaseURL);
	}
	async search(request, signal) {
		const url = new URL(this.options.searchBaseURL);
		url.searchParams.set("query", request.query);
		if (this.options.purpose !== void 0) url.searchParams.set("purpose", this.options.purpose);
		if (this.options.location !== void 0) url.searchParams.set("location", this.options.location);
		if (this.options.language !== void 0) url.searchParams.set("language", this.options.language);
		if (this.options.includeDomains !== void 0) url.searchParams.set("include_domains", this.options.includeDomains);
		if (this.options.excludeDomains !== void 0) url.searchParams.set("exclude_domains", this.options.excludeDomains);
		if (this.options.domainType !== void 0) url.searchParams.set("domain_type", this.options.domainType);
		if (this.options.recencyMinutes !== void 0) url.searchParams.set("recency_minutes", String(this.options.recencyMinutes));
		if (this.options.afterDate !== void 0) url.searchParams.set("after_date", this.options.afterDate);
		if (this.options.beforeDate !== void 0) url.searchParams.set("before_date", this.options.beforeDate);
		if (this.options.pubYearMin !== void 0) url.searchParams.set("pub_year_min", String(this.options.pubYearMin));
		if (this.options.pubYearMax !== void 0) url.searchParams.set("pub_year_max", String(this.options.pubYearMax));
		if (this.options.page !== void 0) url.searchParams.set("page", String(this.options.page));
		let response;
		try {
			response = await fetch(url, {
				method: "GET",
				redirect: "error",
				headers: this.headers(),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (isAbortError(error)) throw new WebError("TinyFish search aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`TinyFish search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			throw new WebError(await describeTinyFishError(response), "WEB_PROVIDER_ERROR");
		}
		try {
			return mapTinyFishResponse(await response.json());
		} catch (error) {
			if (isAbortError(error)) throw new WebError("TinyFish search aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`TinyFish returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
	/** True when an API key is configured; TinyFish has no keyless endpoint. */
	hasCredentials() {
		return this.options.apiKey.length > 0;
	}
	/** Request headers; every TinyFish call carries the API key. */
	headers() {
		return {
			"x-api-key": this.options.apiKey,
			accept: "application/json",
			"user-agent": USER_AGENT
		};
	}
};
/** The TinyFish-backed fetch provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
var TinyFishFetchProvider = class {
	options;
	id = "tinyfish";
	constructor(options) {
		this.options = options;
	}
	available() {
		return this.hasCredentials() && isValidBaseUrl(this.options.fetchBaseURL) && isSupportedFormat(this.options.format) && isPositiveInteger(this.options.maxChars) && isNonNegativeInteger(this.options.ttl) && (this.options.perUrlTimeoutMs === void 0 || isPositiveInteger(this.options.perUrlTimeoutMs) && this.options.perUrlTimeoutMs <= 110000);
	}
	async fetch(request, signal) {
		const target = parseFetchUrl(request.url);
		const requestUrl = target.toString();
		let response;
		try {
			response = await fetch(this.options.fetchBaseURL, {
				method: "POST",
				redirect: "error",
				headers: this.headers(),
				body: JSON.stringify({
					urls: [requestUrl],
					format: this.options.format,
					ttl: this.options.ttl,
					per_url_timeout_ms: this.options.perUrlTimeoutMs
				}),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (isAbortError(error)) throw new WebError("TinyFish fetch aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`TinyFish fetch request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			throw new WebError(await describeTinyFishError(response), "WEB_PROVIDER_ERROR");
		}
		let payload;
		try {
			payload = await response.json();
		} catch (error) {
			if (isAbortError(error)) throw new WebError("TinyFish fetch aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`TinyFish returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		const failure = findTinyFishFetchError(payload, requestUrl);
		if (failure !== void 0) throw fetchErrorFromEntry(failure);
		const result = mapTinyFishFetch(payload, requestUrl, this.options.maxChars, this.options.format);
		if (result === void 0) throw new WebError("TinyFish returned no content for the requested URL", "WEB_PROVIDER_ERROR");
		return result;
	}
	/** True when an API key is configured; TinyFish has no keyless endpoint. */
	hasCredentials() {
		return this.options.apiKey.length > 0;
	}
	/** Request headers; every TinyFish call carries the API key. */
	headers() {
		return {
			"x-api-key": this.options.apiKey,
			"content-type": "application/json",
			accept: "application/json",
			"user-agent": USER_AGENT
		};
	}
};
/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL) {
	return URL.canParse(baseURL);
}
/** True for a whole number greater than zero. */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
/** True for a whole number greater than or equal to zero (TinyFish's `ttl`). */
function isNonNegativeInteger(value) {
	return Number.isInteger(value) && value >= 0;
}
/** True for one of TinyFish's accepted `format` values. */
function isSupportedFormat(format) {
	return format === "markdown" || format === "html" || format === "json";
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/**
 * TinyFish-backed `ctx.web` plugin. It registers a search provider and a fetch
 * provider into the web seam without owning the service; both share the same
 * credential resolution (`TINYFISH_API_KEY`) and the same two endpoint bases,
 * which are configurable because TinyFish serves search and fetch from
 * different hosts.
 *
 * @module @customize/dsh-web-search-tinyfish
 */
/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-tinyfish";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	apiKey: z.string(),
	searchBaseURL: z.string(),
	fetchBaseURL: z.string(),
	purpose: z.string(),
	location: z.string(),
	language: z.string(),
	includeDomains: z.string(),
	excludeDomains: z.string(),
	domainType: z.union([
		"web",
		"news",
		"research_paper"
	]),
	recencyMinutes: z.number().step(1).min(1).max(5256000),
	afterDate: z.string(),
	beforeDate: z.string(),
	pubYearMin: z.number().step(1).min(0).max(9999),
	pubYearMax: z.number().step(1).min(0).max(9999),
	page: z.number().step(1).min(0).max(10),
	format: z.union([
		"markdown",
		"html",
		"json"
	]),
	maxChars: z.number().step(1).min(1).default(50000),
	ttl: z.number().step(1).min(0).default(0),
	perUrlTimeoutMs: z.number().step(1).min(1).max(110000).default(60000)
});
/**
 * Register the TinyFish search and fetch providers with `ctx.web`.
 *
 * Every TinyFish call needs an API key, resolved from `apiKey` or the
 * `TINYFISH_API_KEY` launch-environment variable; without one both providers
 * stay registered but report `available() === false`, and the seam treats the
 * capability as unconfigured instead of failing every call.
 */
function apply(ctx, config) {
	const shared = {
		apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get("TINYFISH_API_KEY")?.value ?? "",
		searchBaseURL: config.searchBaseURL ?? "https://api.search.tinyfish.ai",
		fetchBaseURL: config.fetchBaseURL ?? "https://api.fetch.tinyfish.ai"
	};
	ctx.web.registerSearchProvider(new TinyFishSearchProvider({
		...shared,
		...config.purpose !== void 0 ? { purpose: config.purpose } : {},
		...config.location !== void 0 ? { location: config.location } : {},
		...config.language !== void 0 ? { language: config.language } : {},
		...config.includeDomains !== void 0 ? { includeDomains: config.includeDomains } : {},
		...config.excludeDomains !== void 0 ? { excludeDomains: config.excludeDomains } : {},
		...config.domainType !== void 0 ? { domainType: config.domainType } : {},
		...config.recencyMinutes !== void 0 ? { recencyMinutes: config.recencyMinutes } : {},
		...config.afterDate !== void 0 ? { afterDate: config.afterDate } : {},
		...config.beforeDate !== void 0 ? { beforeDate: config.beforeDate } : {},
		...config.pubYearMin !== void 0 ? { pubYearMin: config.pubYearMin } : {},
		...config.pubYearMax !== void 0 ? { pubYearMax: config.pubYearMax } : {},
		...config.page !== void 0 ? { page: config.page } : {}
	}));
	ctx.web.registerFetchProvider(new TinyFishFetchProvider({
		...shared,
		format: config.format ?? "markdown",
		maxChars: config.maxChars ?? 50000,
		ttl: config.ttl ?? 0,
		perUrlTimeoutMs: config.perUrlTimeoutMs ?? 60000
	}));
}
export { Config, TINYFISH_DEFAULT_FETCH_BASE_URL, TINYFISH_DEFAULT_FORMAT, TINYFISH_DEFAULT_MAX_CHARS, TINYFISH_DEFAULT_PER_URL_TIMEOUT_MS, TINYFISH_DEFAULT_SEARCH_BASE_URL, TINYFISH_DEFAULT_TTL, TINYFISH_MAX_PAGE, TINYFISH_MAX_PER_URL_TIMEOUT_MS, TINYFISH_MAX_RECENCY_MINUTES, TINYFISH_MIN_RECENCY_MINUTES, TINYFISH_PROVIDER_ID, TinyFishFetchProvider, TinyFishSearchProvider, apply, inject, name };
