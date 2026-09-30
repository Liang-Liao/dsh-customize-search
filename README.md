# dsh-customize-search

两个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）网页能力插件，都以 `ctx.web` 提供方形式注册，结构和官方 `@deepseek-ai/dsh-web-search-exa` 一致，每个插件都同时提供**搜索**和**抓取**两个能力。

> two dsh web-capability plugins (Keenable and TinyFish), each registering a search and a fetch provider into the `ctx.web` seam, mirroring the shipped `@deepseek-ai/dsh-web-search-exa`.

| 子包 | 能力 | 后端 | 密钥 |
|---|---|---|---|
| [dsh-web-search-keenable](dsh-web-search-keenable) | `web_search` + `web_fetch` | Keenable `/v1/search`、`/v1/fetch` | 可无密钥（公共端点限流），有 `KEENABLE_API_KEY` 更好 |
| [dsh-web-search-tinyfish](dsh-web-search-tinyfish) | `web_search` + `web_fetch` | TinyFish `api.search.tinyfish.ai`、`api.fetch.tinyfish.ai` | **必须** `TINYFISH_API_KEY`（[申请地址](https://agent.tinyfish.ai/api-keys)） |

## 安装

命令里的 `--profile <name>` 决定插件装进哪个 profile：`web`（Web GUI）或 `desktop`（桌面客户端）。**两个 profile 互相独立**（各有各的 manifest 和 lockfile），装了 web 不会自动装到 desktop，需要的话两边分别执行。

仓库里的两个插件也**互相独立**，可以只装其中一个，也可以两个都装：

```powershell
# 只装 Keenable（web profile）
dsh plugin --profile web add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-keenable

# 只装 TinyFish（web profile）
dsh plugin --profile web add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-tinyfish

# desktop profile 同理，把 web 换成 desktop 即可
dsh plugin --profile desktop add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-keenable
dsh plugin --profile desktop add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-tinyfish
```

`#path:` 后面的子目录决定安装哪一个插件；`github:用户名/仓库名` 也可以写成完整仓库地址 `https://github.com/Liang-Liao/dsh-customize-search`。

## 升级

插件以分支 spec 安装，升级即让 pnpm 重新解析到仓库 main 的最新提交：

```powershell
# 更新单个插件（web profile）
dsh plugin --profile web update @customize/dsh-web-search-keenable
dsh plugin --profile web update @customize/dsh-web-search-tinyfish

# 不带包名则一次更新全部
dsh plugin --profile web update

# desktop profile 同理
dsh plugin --profile desktop update
```

web 与 desktop 需要各自执行升级。更新后的代码在**下次启动 Harness 时生效**。

> **不要用重跑 `add` 的方式升级**：spec 未变化时 pnpm 会跳过重新解析，升级请用 `update`。固定到历史版本、tag 安装等进阶用法见 [AGENTS.md](AGENTS.md)。

## 固定使用哪个提供方

在 profile 的 `cordis.patch.yml` 中指定，搜索和抓取可以分别选择（混搭亦可）：

```yaml
- id: web
  config:
    searchProvider: keenable   # 或 tinyfish
    fetchProvider: keenable    # 或 tinyfish
```

不指定的情况下，`ctx.web` 会自动选用各自能力下已注册且可用的提供方。

## 目录结构

```text
.
├── dsh-web-search-keenable/    # Keenable 提供方（搜索 + 抓取）
├── dsh-web-search-tinyfish/    # TinyFish 提供方（搜索 + 抓取）
├── LICENSE                     # MIT
├── README.md                   # 使用说明
└── package.json                # 仅作仓库占位，不是 dsh bundle
```

每个子目录都是完整、自包含的 dsh bundle 包（无构建步骤，纯 ESM），各自的 `README.md` / `README.zh.md` 有完整的配置字段说明。

## License

[MIT](LICENSE)
