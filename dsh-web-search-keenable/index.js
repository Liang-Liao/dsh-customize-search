import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
/**
 * `KeenableSearchProvider`: a `WebSearchProvider` backed by the Keenable search
 * API (`POST /v1/search`, or the keyless `POST /v1/search/public` when no API
 * key is configured). It maps the first non-blank of `snippet` then
 * `description` to `snippet`, maps `published_at` to `publishedAt`, drops
 * entries without a portable snippet, and omits `content` because Keenable
 * returns no generated answer.
 * @module @customize/dsh-web-search-keenable/provider
 */
/** Stable id this provider registers under. */
const KEENABLE_PROVIDER_ID = "keenable";
/** Default Keenable endpoint base; `/v1/search` is the keyed operation. */
const KEENABLE_DEFAULT_BASE_URL = "https://api.keenable.ai";
/** The keyed search operation appended to the base URL. */
const KEENABLE_SEARCH_PATH = "/v1/search";
/** The keyless search operation; requires the `X-Keenable-Title` header. */
const KEENABLE_PUBLIC_SEARCH_PATH = "/v1/search/public";
/** The keyed fetch operation appended to the base URL. */
const KEENABLE_FETCH_PATH = "/v1/fetch";
/** The keyless fetch operation; requires the `X-Keenable-Title` header. */
const KEENABLE_PUBLIC_FETCH_PATH = "/v1/fetch/public";
/** Default retrieval mode: deeper retrieval. */
const KEENABLE_DEFAULT_MODE = "pro";
/** Application name sent on keyless calls; Keenable rejects the public endpoints without it. */
const KEENABLE_DEFAULT_APP_TITLE = "deepseek-harness";
/** Default `max_chars` per fetched page (Keenable's own default). */
const KEENABLE_DEFAULT_MAX_CHARS = 50000;
/**
 * Whether a fetch pulls the live source (Keenable's `live=true`) instead of
 * the indexed copy. Defaults to `true` because this provider replaces the
 * local HTTP fetcher, which always reads the live source; the indexed copy
 * fails for URLs Keenable has not indexed.
 */
const KEENABLE_DEFAULT_LIVE = true;
/** Keenable's accepted `snippet_max_length` bounds (characters). */
const KEENABLE_MIN_SNIPPET_LENGTH = 180;
const KEENABLE_MAX_SNIPPET_LENGTH = 10000;
/** Keenable's accepted `max_results` upper bound; the seam still caps on return. */
const KEENABLE_MAX_RESULTS = 50;
/** Attribution header sent on every request. */
const USER_AGENT = "dsh-web-search-keenable/1.0.2";
/**
 * Return the first non-blank string among `values`, or `undefined`.
 *
 * Keenable results may carry only one of `snippet` or `description`, and either
 * may be present but blank, so the mapping treats blank text as absent.
 */
function firstNonBlank(...values) {
	for (const value of values) {
		if (value != null && value.trim().length > 0) return value;
	}
	return void 0;
}
/**
 * Map one Keenable result to a normalized source, or `undefined` when it
 * carries no portable snippet (an entry with neither a non-blank `snippet` nor
 * a non-blank `description` is dropped — the seam has no other field to derive
 * a snippet from, and inventing one would lie).
 *
 * @param result - one entry of Keenable's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank `snippet`/`description`.
 */
function mapKeenableResult(result) {
	const snippet = firstNonBlank(result.snippet, result.description);
	if (snippet === void 0) return void 0;
	return {
		url: result.url,
		...result.title != null && result.title.length > 0 ? { title: result.title } : {},
		snippet,
		...result.published_at != null && result.published_at.length > 0 ? { publishedAt: result.published_at } : {}
	};
}
/**
 * Map a Keenable response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` (or `/v1/search/public`) body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapKeenableResult}).
 */
function mapKeenableResponse(response) {
	return {
		sources: (response.results ?? []).map(mapKeenableResult).filter((source) => source !== void 0),
		truncated: false
	};
}
/**
 * Map a Keenable fetch response envelope to a normalized fetch result.
 *
 * Keenable returns the page as markdown, which the seam classifies as `text`.
 * The envelope carries no target-page status code, so a successful call maps to
 * `200` — an unreachable or unextractable page surfaces as a Keenable API
 * error instead. Keenable's `max_chars` is a soft cap (it may return somewhat
 * more), so the provider slices `content` to `maxChars` itself — the same
 * discipline the local HTTP fetcher applies — and flags `truncated` only when
 * it actually cut.
 *
 * @param response - the parsed `GET /v1/fetch` (or `/v1/fetch/public`) body.
 * @param requestUrl - the URL the request asked for, used when the envelope
 *   carries none.
 * @param maxChars - the `max_chars` the request sent, for truncation inference.
 * @returns the normalized fetch result.
 */
function mapKeenableFetch(response, requestUrl, maxChars) {
	const raw = response.content ?? "";
	const truncated = maxChars !== void 0 && raw.length > maxChars;
	return {
		url: response.url != null && response.url.length > 0 ? response.url : requestUrl,
		statusCode: 200,
		body: {
			kind: "text",
			content: truncated ? raw.slice(0, maxChars) : raw
		},
		truncated
	};
}
/**
 * Describe a non-2xx Keenable response as one message, best effort.
 *
 * The body is read once as text so both the `{ error, message }` JSON envelope
 * and a plain-text failure stay readable; an aborted read surfaces as
 * `WEB_ABORTED` like every other cancellation in this package.
 */
async function describeKeenableError(response) {
	const fallback = `Keenable API error (HTTP ${response.status})`;
	let text;
	try {
		text = await response.text();
	} catch (error) {
		if (isAbortError(error)) throw new WebError("Keenable request aborted", "WEB_ABORTED", { cause: error });
		return fallback;
	}
	const trimmed = text.trim();
	if (trimmed.length === 0) return fallback;
	try {
		const parsed = JSON.parse(trimmed);
		const detail = parsed?.error ?? parsed?.message;
		if (detail != null && detail.length > 0) return detail;
	} catch {
	}
	return trimmed;
}
/**
 * Parse and policy-check one fetch request URL before any network call.
 *
 * Only http(s) URLs reach Keenable; anything else is a request-shape error,
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
/** The Keenable-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
var KeenableSearchProvider = class {
	options;
	id = "keenable";
	constructor(options) {
		this.options = options;
	}
	available() {
		return this.hasCredentials() && isValidBaseUrl(this.options.baseURL) && (this.options.maxResults === void 0 || isPositiveInteger(this.options.maxResults)) && (this.options.snippetMaxLength === void 0 || isValidSnippetLength(this.options.snippetMaxLength));
	}
	async search(request, signal) {
		const keyed = this.options.apiKey.length > 0;
		const requested = request.maxResults ?? this.options.maxResults;
		const maxResults = requested === void 0 ? void 0 : clampResultCount(requested);
		let response;
		try {
			response = await fetch(`${this.options.baseURL}${keyed ? KEENABLE_SEARCH_PATH : KEENABLE_PUBLIC_SEARCH_PATH}`, {
				method: "POST",
				redirect: "error",
				headers: this.headers(keyed),
				body: JSON.stringify({
					query: request.query,
					mode: this.options.mode,
					...maxResults !== void 0 ? { max_results: maxResults } : {},
					...this.options.snippetMaxLength !== void 0 ? { snippet_max_length: this.options.snippetMaxLength } : {},
					...this.options.site !== void 0 ? { site: this.options.site } : {}
				}),
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (isAbortError(error)) throw new WebError("Keenable search aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`Keenable search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			throw new WebError(await describeKeenableError(response), "WEB_PROVIDER_ERROR");
		}
		try {
			return mapKeenableResponse(await response.json());
		} catch (error) {
			if (isAbortError(error)) throw new WebError("Keenable search aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`Keenable returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
	/** True when a keyed or keyless (titled) call can be sent. */
	hasCredentials() {
		const keyed = this.options.apiKey.length > 0;
		return keyed || this.options.appTitle.length > 0;
	}
	/** Request headers for the keyed or keyless operation. */
	headers(keyed) {
		return {
			...keyed ? { "x-api-key": this.options.apiKey } : { "x-keenable-title": this.options.appTitle },
			"content-type": "application/json",
			accept: "application/json",
			"user-agent": USER_AGENT
		};
	}
};
/** The Keenable-backed fetch provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
var KeenableFetchProvider = class {
	options;
	id = "keenable";
	constructor(options) {
		this.options = options;
	}
	available() {
		const keyed = this.options.apiKey.length > 0;
		if (!keyed && this.options.appTitle.length === 0) return false;
		return isValidBaseUrl(this.options.baseURL) && isPositiveInteger(this.options.maxChars);
	}
	async fetch(request, signal) {
		const target = parseFetchUrl(request.url);
		const keyed = this.options.apiKey.length > 0;
		const url = new URL(`${this.options.baseURL}${keyed ? KEENABLE_FETCH_PATH : KEENABLE_PUBLIC_FETCH_PATH}`);
		url.searchParams.set("url", target.toString());
		url.searchParams.set("max_chars", String(this.options.maxChars));
		url.searchParams.set("live", String(this.options.live));
		let response;
		try {
			response = await fetch(url, {
				method: "GET",
				redirect: "error",
				headers: {
					...keyed ? { "x-api-key": this.options.apiKey } : { "x-keenable-title": this.options.appTitle },
					accept: "application/json",
					"user-agent": USER_AGENT
				},
				...signal !== void 0 ? { signal } : {}
			});
		} catch (error) {
			if (isAbortError(error)) throw new WebError("Keenable fetch aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`Keenable fetch request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			throw new WebError(await describeKeenableError(response), "WEB_PROVIDER_ERROR");
		}
		try {
			return mapKeenableFetch(await response.json(), target.toString(), this.options.maxChars);
		} catch (error) {
			if (isAbortError(error)) throw new WebError("Keenable fetch aborted", "WEB_ABORTED", { cause: error });
			throw new WebError(`Keenable returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
		}
	}
};
/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL) {
	return URL.canParse(baseURL);
}
/** True for a result-count control Keenable accepts (a positive whole number). */
function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}
/** True for a `snippet_max_length` within Keenable's accepted bounds. */
function isValidSnippetLength(value) {
	return Number.isInteger(value) && value >= 180 && value <= 10000;
}
/** Clamp a requested result count into Keenable's accepted 1..50 range. */
function clampResultCount(value) {
	return Math.min(50, Math.max(1, Math.round(value)));
}
/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/**
 * Keenable-backed `ctx.web` plugin. It registers a search provider and a fetch
 * provider into the web seam without owning the service; both share the same
 * credential resolution (key, or app title for the keyless endpoints).
 *
 * @module @customize/dsh-web-search-keenable
 */
/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-keenable";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	apiKey: z.string(),
	baseURL: z.string(),
	mode: z.union([
		"pro",
		"realtime"
	]),
	appTitle: z.string(),
	site: z.string(),
	maxResults: z.number().step(1).min(1).max(50),
	snippetMaxLength: z.number().step(1).min(180).max(10000),
	maxChars: z.number().step(1).min(1).default(50000),
	live: z.boolean().default(true)
});
/**
 * Register the Keenable search and fetch providers with `ctx.web`.
 *
 * With a key both call the keyed endpoints; without one they call the keyless
 * public endpoints, which need `appTitle` (defaulting to
 * `$KEENABLE_APP_TITLE`, then a constant) for their `X-Keenable-Title` header.
 */
function apply(ctx, config) {
	const shared = {
		apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get("KEENABLE_API_KEY")?.value ?? "",
		baseURL: config.baseURL ?? "https://api.keenable.ai",
		appTitle: config.appTitle ?? launchEnvironmentOf(ctx).get("KEENABLE_APP_TITLE")?.value ?? "deepseek-harness"
	};
	ctx.web.registerSearchProvider(new KeenableSearchProvider({
		...shared,
		mode: config.mode ?? "pro",
		...config.maxResults !== void 0 ? { maxResults: config.maxResults } : {},
		...config.snippetMaxLength !== void 0 ? { snippetMaxLength: config.snippetMaxLength } : {},
		...config.site !== void 0 ? { site: config.site } : {}
	}));
	ctx.web.registerFetchProvider(new KeenableFetchProvider({
		...shared,
		maxChars: config.maxChars ?? 50000,
		live: config.live ?? true
	}));
}
export { Config, KEENABLE_DEFAULT_APP_TITLE, KEENABLE_DEFAULT_BASE_URL, KEENABLE_DEFAULT_LIVE, KEENABLE_DEFAULT_MAX_CHARS, KEENABLE_DEFAULT_MODE, KEENABLE_FETCH_PATH, KEENABLE_MAX_RESULTS, KEENABLE_PROVIDER_ID, KEENABLE_PUBLIC_FETCH_PATH, KEENABLE_PUBLIC_SEARCH_PATH, KEENABLE_SEARCH_PATH, KeenableFetchProvider, KeenableSearchProvider, apply, inject, name };
