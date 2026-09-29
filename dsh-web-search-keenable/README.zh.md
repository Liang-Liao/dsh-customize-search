---
description: "ctx.web 的 Keenable 搜索与抓取提供方：如何以厂商原生方式挂载网页搜索与 markdown 抓取，获得可移植摘要、发布时间，以及无密钥的公共回退端点。"
kind: "package-reference"
---

# @customize/dsh-web-search-keenable

[English](README.md) | 中文

## 概述

`dsh-web-search-keenable` 让 harness 通过 [Keenable](https://keenable.ai) 搜索并读取网页：`/v1/search` 返回带可移植摘要与发布时间的排序结果，`/v1/fetch` 返回页面的 markdown 内容。适合希望把两项能力收敛到同一套 Keenable 凭据的部署：配置了 `KEENABLE_API_KEY` 时走带鉴权端点，没有密钥时自动回退到免密钥公共端点。Keenable 不返回生成的回答，因此搜索结果只包含可引用的来源，没有 `content`。既无有效 `snippet` 也无有效 `description` 的搜索结果会被丢弃，因此一次搜索返回的来源数可能少于请求数。面向模型的 `web_search` 与 `web_fetch` 工具由 `dsh-tool-web` 提供。

## 目录

- [使用本包](#使用本包)
- [了解实现](#了解实现)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)

-----

<a id="使用本包"></a>
## 使用本包

在已加载 web 服务的组合中挂载本提供方；它以 `keenable` 身份同时注册**搜索**与**抓取**两个提供方，因此当它们是各自能力下唯一可用的后端时，`ctx.web.search()` 与 `ctx.web.fetch()` 会自动选中——也可以用 `searchProvider: keenable` 和 `fetchProvider: keenable` 显式固定。本 profile 两者都已固定，Keenable 因此完整替代本地 HTTP 抓取器。

### 何时选择它

当部署希望用一套 Keenable 凭据同时获得排序检索与 markdown 提取时选择该后端。两项能力开箱即无密钥：没有密钥时调用 `/v1/search/public` 与 `/v1/fetch/public`（按 IP 限流、不消耗额度），有 `KEENABLE_API_KEY` 时调用 `/v1/search` 与 `/v1/fetch`。当密钥与应用名都未配置、或端点基址无法解析时，对应能力不可用——此时每次调用都会失败并返回结构化错误。

### 最小配置

加载 web 服务与本提供方；API 密钥回退到启动环境中的 `$KEENABLE_API_KEY`，其余设置均有安全默认值。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@customize/dsh-web-search-keenable'
  config:
    apiKey: !!js process.env.KEENABLE_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$KEENABLE_API_KEY` | Keenable API 密钥；为空或缺失时使用免密钥公共端点，此时需要 `appTitle` |
| `baseURL` | `https://api.keenable.ai` | 端点基址；追加 `/v1/search` 或 `/v1/fetch`（带密钥）及其 `/public` 孪生端点（无密钥）。无法解析的值使两个提供方都不可用 |
| `mode` | `pro` | 搜索检索模式，作为 Keenable 的 `mode` 发送：`pro`（更深检索）或 `realtime`（最快） |
| `appTitle` | `$KEENABLE_APP_TITLE`，否则 `deepseek-harness` | 免密钥调用时 `X-Keenable-Title` 头的应用名；公共端点缺少它会被拒绝 |
| `site` | （不设置） | 将搜索结果限制在单个站点，作为 Keenable 的 `site` 发送（如 `techcrunch.com`） |
| `maxResults` | （不设置） | 请求未带 `maxResults` 时的默认搜索结果数；Keenable 接受 1–50，更大的值会被裁剪到 50 |
| `snippetMaxLength` | （不设置） | 搜索摘要最大字符数，作为 Keenable 的 `snippet_max_length` 发送；必须在 180 到 10000 之间 |
| `maxChars` | `50000` | 抓取内容最大字符数，作为 Keenable 的 `max_chars` 发送；更长内容会被截断 |
| `live` | `true` | 从源站实时抓取页面（`live=true`），而非 Keenable 的索引副本。默认值与被替代的本地 HTTP 抓取器一致（始终读实时源）；索引副本对 Keenable 未收录的 URL 会直接失败 |

### 搜索返回什么

每个 Keenable 搜索结果映射为一个 `WebSearchSource`：`url`、`title`、`snippet` 与 `description` 中第一个非空内容作为 `snippet`、`published_at` 作为 `publishedAt`；两者都没有便携摘要的结果会被丢弃。请求的 `maxResults` 优先于配置的 `maxResults` 默认值，并作为成本与延迟优化发送给 Keenable——最终上限由服务在返回时截断并标记。Keenable 不返回生成的回答，因此结果不带 `content`。

### 抓取返回什么

每次 Keenable 抓取映射为一个 `WebFetchResult`：页面 markdown 放在 `body.kind: 'text'` 下，URL 取响应 envelope 的 `url`（缺失时回退为请求 URL），`statusCode` 为 `200`。Keenable 的 `max_chars` 是软上限（可能略多返回），因此由提供方自己把 `content` 裁到 `maxChars`，只有真正裁过才置 `truncated`。envelope 不携带目标页面的状态码，因此抓不到或提取失败的页面以 Keenable API 错误（`WEB_PROVIDER_ERROR`）呈现，而不是一个非 200 的结果。只有 http(s) 请求 URL 会发给 API，其余在本地即失败（`WEB_INVALID_URL`）。

### 失败与恢复

提供方故障——HTTP 错误、网络失败、无法解析或形状不符的响应体——以 `WebError` 的 `WEB_PROVIDER_ERROR` 暴露，并在响应携带 `error`/`message` 时带上细节；请求被中止时以 `WEB_ABORTED` 暴露。HTTP 重定向在接触 `Location` 目标之前即被拒绝，同样以 `WEB_PROVIDER_ERROR` 暴露。调用方按错误码路由；面向模型的工具会在自己的错误包装下向模型呈现故障。

-----

<a id="了解实现"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节说明提供方背后的设计决策；可观测行为已在[使用本包](#使用本包)完整覆盖。

### 设计理念

本包是对 Keenable API 的薄适配，有三条刻意遵守的规则：

- **只映射真实摘要。** 来源的 `snippet` 只能来自真实的 `snippet`/`description` 字段；从其他字段编造摘要会让 seam 说谎，因此无摘要的结果整体丢弃。
- **不编造回答。** Keenable 不返回生成的回答，因此省略搜索的 `content`，而不是虚构模型可能信赖的提供方文字。
- **抓取默认实时。** 索引副本更便宜，但对未收录的 URL 会失败；由于本提供方替代的是始终读实时源的本地抓取器，`live` 默认 `true`，更便宜的路径只差一个配置字段。

### 源文件

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：配置模式、环境变量回退、提供方注册，以及两个提供方的完整实现（单文件、无需构建） |

### 请求与映射流程

`search()` 以 `redirect: 'error'` 向带密钥或无密钥操作发送查询、检索模式以及可选的结果数、摘要长度与站点过滤，使重定向在不接触目标的情况下失败。`fetch()` 以查询参数形式向带密钥或无密钥操作 GET 发送 URL、`max_chars` 与 `live`。两个响应 envelope 都逐字段映射；中止——名为 `AbortError` 的 `DOMException`——映射为 `WEB_ABORTED`，其余一切变为 `WEB_PROVIDER_ERROR`。

</details>

-----

<a id="模型体验"></a>
## 模型体验

间接地，通过 `dsh-tool-web`：`web_search` 保留本提供方受 `maxResults` 约束的 URL、标题、摘要与发布时间，或 `Keenable search aborted`、`Keenable search request failed: <error>`、`Keenable returned an unprocessable response body: <error>` 等确切失败信息；`web_fetch` 保留页面 markdown 文本或同形状的抓取版失败信息。

#### KV Cache 影响

无直接失效；具名消费方拥有任何请求前缀变更。

## 已知限制与待办

<a id="已知限制与待办"></a>

这些限制定义了本提供方不适用的场景，均为当前包约束。

- **无有效 `snippet` 与 `description` 的搜索结果被整体丢弃**——没有可映射的便携摘要，因此返回数可能少于请求数。
- **抓取能力是本地抓取器的子集**——不跟随重定向、没有字节上限、字符集解码与私网地址策略：检索由 Keenable 执行，这些检查归属 Keenable；源站非 200 页面会以提供方错误呈现，而不是带状态码的结果。
- **抓取截断由提供方强制执行**——`content` 会被裁到 `maxChars`（Keenable 的 `max_chars` 只是软上限），`truncated` 是精确值而非推断值。
- **仅暴露 `mode`/`site`/`maxResults`/`snippetMaxLength`/`maxChars`/`live`**——Keenable 的日期过滤（`published_after`、`acquired_before` 等）、时点检索 `query_time` 与抓取的 `prompt` 提取指令，需要 web seam 先提供提供方中立的服务字段。
- **免密钥公共端点是共享池**——没有 API 密钥时调用按 IP 限流（每小时 1,000 次、每秒 10 次）且不带用量元数据；生产用量请设置 `KEENABLE_API_KEY`。
- **中止分类基于错误形状**——只有名为 `AbortError` 的 `DOMException` 映射为 `WEB_ABORTED`；携带自定义原因的中止（如 `dsh-timeout` 的 `TimeoutReason`）会以 `WEB_PROVIDER_ERROR` 暴露。
