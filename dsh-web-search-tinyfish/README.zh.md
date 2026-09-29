# @customize/dsh-web-search-tinyfish

基于 TinyFish 的搜索与抓取提供方，接入 DeepSeek Harness 的 web 能力
（`ctx.web`），与 `@deepseek-ai/dsh-web-search-exa`、`@customize/dsh-web-search-keenable`
结构一致。

- **搜索** — `GET https://api.search.tinyfish.ai`，返回带标题、摘要、URL 的
  排序 JSON 结果，面向 LLM 消费优化。任意钱包余额免费（30 次/分钟）。
- **抓取** — `POST https://api.fetch.tinyfish.ai`，用真实 Chromium 渲染页面后
  返回干净的正文（markdown / HTML / JSON）。任意钱包余额免费（150 个 URL/分钟）。

两次调用都需要 `X-API-Key` 请求头 —— TinyFish **没有免密钥的公开端点**（这点与
Keenable 不同）。

## 安装

```powershell
plugin_manager action=install_bundle target=E:\programData\dsh\project\dsh-web-search-tinyfish
```

bundle 会插入 `web-search-tinyfish` 插件行。安装后在 profile 的
`cordis.patch.yml` 中固定使用：

```yaml
- id: web
  config:
    searchProvider: tinyfish
    fetchProvider: tinyfish
```

宿主插件改动需要重启 Harness 后生效。

## 配置

在 <https://agent.tinyfish.ai/api-keys> 创建密钥，填入插件配置的
`apiKey` 字段，或设置 `TINYFISH_API_KEY` 环境变量（经 launch-environment
分层读取：进程环境变量、项目 `.env`、`$DSH_HOME/.env`）。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | 环境变量 `TINYFISH_API_KEY` | TinyFish API 密钥。必填 —— 缺失时 `available()` 为 `false`。 |
| `searchBaseURL` | `https://api.search.tinyfish.ai` | 搜索端点。 |
| `fetchBaseURL` | `https://api.fetch.tinyfish.ai` | 抓取端点（与搜索不同域）。 |
| `purpose` | — | 可选，说明搜索目的，可提升结果质量。最长 2000 字符。 |
| `location` | — | 地域国家代码（如 `US`、`CN`）。 |
| `language` | — | 结果语言代码（如 `en`、`zh`）。 |
| `includeDomains` | — | 逗号分隔，限定结果域名。 |
| `excludeDomains` | — | 逗号分隔，排除结果域名。 |
| `domainType` | `web` | `web`、`news` 或 `research_paper`。 |
| `recencyMinutes` | — | 时效窗口（分钟，1…5256000）。不可与 `afterDate`/`beforeDate` 同时使用。 |
| `afterDate` | — | 起始日期，`YYYY-MM-DD`。 |
| `beforeDate` | — | 截止日期，`YYYY-MM-DD`（不早于 `afterDate`）。 |
| `pubYearMin` / `pubYearMax` | — | 发表年份范围（0…9999），仅 `research_paper`。 |
| `page` | — | 结果页码，从 0 开始，最大 10。 |
| `format` | `markdown` | 抓取输出格式：`markdown`、`html` 或 `json`。 |
| `maxChars` | `50000` | 返回前对页面正文施加的字符上限。 |
| `ttl` | `0` | 缓存新鲜度（秒）：`0` = 总是实时抓取；正数 = 接受 N 秒内的缓存。 |
| `perUrlTimeoutMs` | `60000` | 转发给 TinyFish 的单 URL 超时预算（1…110000）。 |

## 行为说明

- 搜索请求里的 `maxResults` **不是** TinyFish 的参数：单次响应页大小由服务端
  决定，因此提供方原样透传，由 seam 截断 `sources[]` 并设置 `truncated`。
  需要翻页时调大 `page`。
- 抓取成功时映射为 `statusCode: 200`，因为 TinyFish 响应不携带原始站点状态码。
  单 URL 失败（404、反爬拦截、超时）会出现在 HTTP 200 旁边的 `errors[]` 里，
  以 `WebError` 抛出，代码为 `WEB_PROVIDER_ERROR`（`invalid_url` /
  `invalid_redirect_url` 为 `WEB_INVALID_URL`）。
- `format: "html"` 解码为 `html` 类型的 body；`markdown` 与 `json`
  （字符串化文档树）解码为 `text` 类型。
- 私网 IP、localhost、云元数据端点由 TinyFish 侧拒绝（单 URL `invalid_url`），
  与本地抓取器的策略一致。
- 提供方不跟随重定向（`redirect: "error"`）；TinyFish 在浏览器侧跟随，并通过
  `final_url` 返回最终地址。

## 限制

- 任何调用都必须有 API 密钥，没有匿名免费模式。
- 搜索没有结果数量参数，一次调用返回一页服务端固定大小的结果（实际约 10 条）。
- Highlights 摘要是 beta 功能、按账号开通，本插件不发送该参数。
- 条件请求（`if_none_match`）未暴露；缓存新鲜度用 `ttl` 控制。
