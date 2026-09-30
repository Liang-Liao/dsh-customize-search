---
description: "ctx.web 的 TinyFish 搜索与抓取提供方：如何以 TinyFish 挂载网页搜索与 Chromium 渲染的 markdown 抓取，获得逐 URL 错误上报与本地精确截断。"
kind: "package-reference"
---

# @customize/dsh-web-search-tinyfish

[English](README.md) | 中文

## 概述

`dsh-web-search-tinyfish` 让 harness 通过 TinyFish 搜索并读取网页：`GET https://api.search.tinyfish.ai` 返回带标题、摘要、URL 的排序结果，面向 LLM 消费优化；`POST https://api.fetch.tinyfish.ai` 用真实 Chromium 渲染页面后返回干净的正文，格式为 markdown、HTML 或 JSON。适合已持有 TinyFish API 密钥的部署——每次调用都需要密钥（`X-API-Key`），与 Keenable 不同，TinyFish 没有免密钥公共端点。两项能力在任意钱包余额下免费，受各端点限流约束（搜索 30 次/分钟，抓取 150 个 URL/分钟）。面向模型的 `web_search` 与 `web_fetch` 工具由 `dsh-tool-web` 提供。

## 目录

- [使用本包](#使用本包)
- [了解实现](#了解实现)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)

-----

<a id="使用本包"></a>
## 使用本包

在已加载 web 服务的组合中挂载本提供方；它以 `tinyfish` 身份同时注册**搜索**与**抓取**两个提供方，因此当它们是各自能力下唯一可用的后端时，`ctx.web.search()` 与 `ctx.web.fetch()` 会自动选中——也可以用 `searchProvider: tinyfish` 和 `fetchProvider: tinyfish` 显式固定。

### 何时选择它

当部署已持有 TinyFish API 密钥（在 <https://agent.tinyfish.ai/api-keys> 创建），并希望用同一凭据同时获得 TinyFish 的排序检索与真实浏览器渲染的抓取时选择该后端。没有密钥时两个提供方保持注册但报告不可用，web seam 会把该能力视为未配置，而不是让每次调用都失败；端点基址无法解析、输出格式不受支持或数值越界时，能力同样不可用。

### 最小配置

加载 web 服务与本提供方；API 密钥回退到启动环境中的 `$TINYFISH_API_KEY`，其余设置均有安全默认值。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@customize/dsh-web-search-tinyfish'
  config:
    apiKey: !!js process.env.TINYFISH_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$TINYFISH_API_KEY` | TinyFish API 密钥；为空或缺失时两个提供方都不可用 |
| `searchBaseURL` | `https://api.search.tinyfish.ai` | 搜索端点基址；无法解析的值使搜索提供方不可用 |
| `fetchBaseURL` | `https://api.fetch.tinyfish.ai` | 抓取端点基址（与搜索不同域） |
| `purpose` | （不设置） | 可选，说明搜索*目的*，作为 TinyFish 的 `purpose` 发送；可提升结果质量，最长 2000 字符 |
| `location` | （不设置） | 地域国家代码（如 `US`、`CN`） |
| `language` | （不设置） | 结果语言代码（如 `en`、`zh`） |
| `includeDomains` | （不设置） | 逗号分隔，限定结果域名 |
| `excludeDomains` | （不设置） | 逗号分隔，排除结果域名 |
| `domainType` | （不设置） | `web`、`news` 或 `research_paper` |
| `recencyMinutes` | （不设置） | 时效窗口（分钟，1…5256000）；不可与 `afterDate`/`beforeDate` 同时使用 |
| `afterDate` | （不设置） | 起始日期，`YYYY-MM-DD` |
| `beforeDate` | （不设置） | 截止日期，`YYYY-MM-DD`（不早于 `afterDate`） |
| `pubYearMin` / `pubYearMax` | （不设置） | 发表年份范围（0…9999），仅 `research_paper` |
| `page` | （不设置） | 默认结果页码，从 0 开始，最大 10 |
| `format` | `markdown` | 抓取输出格式：`markdown`、`html` 或 `json` |
| `maxChars` | `50000` | 返回前对页面正文施加的字符上限 |
| `ttl` | `0` | 缓存新鲜度（秒）：`0` = 总是实时抓取；正数 = 接受 N 秒内的缓存 |
| `perUrlTimeoutMs` | `60000` | 转发给 TinyFish 的单 URL 超时预算（1…110000） |

### 搜索返回什么

每个 TinyFish 结果映射为一个 `WebSearchSource`：`url`、`title` 与 `snippet`。上文的搜索过滤项（`purpose`、`location`、`language`、域名过滤、日期边界、`domainType`、`page`）都是部署级配置，不是请求参数。请求里的 `maxResults` **不是** TinyFish 的参数：单次响应页大小由服务端决定（实际约 10 条），因此提供方原样透传，由 seam 截断 `sources[]` 并设置 `truncated`——需要更多时调大配置的 `page`。

### 抓取返回什么

每次 TinyFish 抓取映射为一个 `WebFetchResult`：提取内容放在 `body` 下（`markdown` 与 `json`——字符串化文档树——解码为 `text` 类型，`html` 解码为 `html` 类型），URL 取响应 envelope 的 `url`（缺失时回退为请求 URL），`statusCode` 为 `200`，因为 TinyFish 的 envelope 不携带目标页面状态码。`content` 由提供方自己裁到 `maxChars`，只有真正裁过才置 `truncated`。HTTP 层不跟随重定向（`redirect: "error"`）；TinyFish 在浏览器侧跟随，并通过 `final_url` 返回最终地址。

### 失败与恢复

检索由 TinyFish 执行，因此页面级问题按 URL 呈现：404、反爬拦截、超时，以及私网地址或 localhost 目标（由 TinyFish 侧以 `invalid_url` 拒绝，与本地抓取器策略一致）会出现在 HTTP 200 旁边的 `errors[]` 里，并以 `WebError` 的 `WEB_PROVIDER_ERROR` 暴露（`invalid_url` / `invalid_redirect_url` 为 `WEB_INVALID_URL`）。调用方按错误码路由；面向模型的工具会在自己的错误包装下向模型呈现故障。

-----

<a id="了解实现"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节说明提供方背后的设计决策；可观测行为已在[使用本包](#使用本包)完整覆盖。

### 设计理念

- **只做真实浏览器提取。** `fetch()` 始终经由 TinyFish 的 Chromium 渲染——提供方从不在本地抓取——因此重 JS 页面也能干净提取，TinyFish 无法触达的页面按单 URL 呈现，不会污染整个结果。
- **搜索过滤是部署级配置。** 各项搜索过滤是插件配置而非请求参数，让提供方中立的 web seam 不掺杂 TinyFish 特有的查询字段。
- **本地精确截断。** TinyFish 的响应上限是软性的，因此提供方自己把内容裁到 `maxChars`，然后才设置 `truncated`。

### 源码地图

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：配置模式、环境变量回退、提供方注册，以及两个提供方的完整实现（单文件、无需构建） |

### 请求与映射流程

`search()` 以各项部署过滤为查询参数、密钥为 `X-API-Key` 头，GET 配置的搜索端点；`fetch()` 以 `format`、`ttl`、`per_url_timeout_ms` POST 目标 URL。两个调用都在不接触 `Location` 目标的情况下拒绝 HTTP 重定向。搜索 envelope 逐字段映射为 `WebSearchSource` 条目；抓取 envelope 按 `format` 解码、裁到 `maxChars`，并把逐 URL 失败收集进 `errors[]`。

</details>

-----

<a id="模型体验"></a>
## 模型体验

间接地，通过 `dsh-tool-web`：`web_search` 保留本提供方的 URL、标题与摘要或其确切失败信息；`web_fetch` 保留页面 markdown 文本或同形状的抓取版失败信息。

#### KV Cache 影响

无直接失效；具名消费方拥有任何请求前缀变更。

## 已知限制与待办

<a id="已知限制与待办"></a>

这些限制定义了本提供方不适用的场景，均为当前包约束。

- **任何调用都必须有密钥**——没有免密钥或匿名模式；缺少凭据时两个提供方都报告不可用。
- **搜索没有结果数量控制**——一次调用返回一页服务端固定大小的结果（实际约 10 条）；`maxResults` 由 seam 的截断兑现，而非 TinyFish。
- **不发送 Highlights**——摘要高亮是 beta 功能且按账号开通，本插件省略该参数。
- **未暴露条件请求**——`if_none_match` 不可用；缓存新鲜度用 `ttl` 控制。
