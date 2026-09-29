# dsh-customize-search

两个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）网页能力插件，都以 `ctx.web` 提供方形式注册，结构和官方 `@deepseek-ai/dsh-web-search-exa` 一致，每个插件都同时提供**搜索**和**抓取**两个能力。

> two dsh web-capability plugins (Keenable and TinyFish), each registering a search and a fetch provider into the `ctx.web` seam, mirroring the shipped `@deepseek-ai/dsh-web-search-exa`.

| 子包 | 能力 | 后端 | 密钥 |
|---|---|---|---|
| [dsh-web-search-keenable](dsh-web-search-keenable) | `web_search` + `web_fetch` | Keenable `/v1/search`、`/v1/fetch` | 可无密钥（公共端点限流），有 `KEENABLE_API_KEY` 更好 |
| [dsh-web-search-tinyfish](dsh-web-search-tinyfish) | `web_search` + `web_fetch` | TinyFish `api.search.tinyfish.ai`、`api.fetch.tinyfish.ai` | **必须** `TINYFISH_API_KEY`（[申请地址](https://agent.tinyfish.ai/api-keys)） |

## 安装

仓库里的两个插件**互相独立**，可以只装其中一个，也可以两个都装。安装命令（按需执行，也可两条都执行）：

```powershell
# 只装 Keenable
dsh plugin --profile web add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-keenable

# 只装 TinyFish
dsh plugin --profile web add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-tinyfish
```

`#path:` 后面的子目录决定安装哪一个插件；`github:用户名/仓库名` 也可以写成完整仓库地址 `https://github.com/Liang-Liao/dsh-customize-search`。

在 Harness 会话内（对话中的插件管理工具）则用等价的安装形式：

```text
plugin_manager action=install_bundle target=github:Liang-Liao/dsh-customize-search#path:dsh-web-search-keenable
plugin_manager action=install_bundle target=github:Liang-Liao/dsh-customize-search#path:dsh-web-search-tinyfish
```

安装后需要**重启 Harness** 生效（宿主不会热加载新安装的 bundle）。

### 固定使用哪个提供方

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
├── README.md                   # 本说明
└── package.json                # 仅作仓库占位，不是 dsh bundle
```

每个子目录都是完整、自包含的 dsh bundle 包（无构建步骤，纯 ESM），各自的 `README.md` / `README.zh.md` 有完整的配置字段说明。

## 本地修改与发布

插件包是纯源码、免构建的。修改流程：

1. 编辑对应子目录下的文件；
2. `git commit` 并 `git push` 到本仓库；
3. 重新执行对应插件的安装命令即可更新（pnpm 会按 git 引用重新拉取最新提交，无需先卸载）：

```powershell
dsh plugin --profile web add github:Liang-Liao/dsh-customize-search#path:dsh-web-search-keenable
```

更新后同样需要重启 Harness 生效。

## License

[MIT](LICENSE)
