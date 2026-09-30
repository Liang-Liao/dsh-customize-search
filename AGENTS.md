# AGENTS.md

面向在本仓库开发的开发者和编码代理；插件的使用说明见 [README.md](README.md)。

## 仓库结构

- 根 `package.json` 仅作仓库占位，不是 dsh bundle。
- `dsh-web-search-keenable/`、`dsh-web-search-tinyfish/` 各自是完整、自包含的 dsh bundle 包（无构建步骤，纯 ESM），以 `ctx.web` 提供方形式注册搜索 + 抓取两个能力，结构对齐官方 `@deepseek-ai/dsh-web-search-exa`。
- 各子目录的 `README.md` / `README.zh.md` 是面向用户的配置文档，改动插件行为后要同步更新。

## 版本兼容性约定

两个插件的 `peerDependencies` 对 `@deepseek-ai/dsh-web` 和 `@deepseek-ai/dsh-launch-environment` 使用 `>=0.2.0-rc.1` 范围而非官方包的精确钉版本——代价是失去 dsh 逐发行版重新验证的安全机制，换来 dsh 升级（如 rc.1 → rc.2）不会因 peer 不满足而被静默跳过。若追求与官方一致的安全姿态，可改回精确钉法，但每次 dsh 升级都需要发版。

## 修改与发布流程

1. 编辑对应子目录下的文件；
2. `git commit` 并 `git push` 到本仓库 main；
3. 更新本地安装的插件——**直接重跑 `add` 安装命令无效**：pnpm 发现 profile 的 lockfile 中该 spec 未变化时会跳过重新解析，会话内插件管理器随后报 `ambiguous-install`。用 `update` 让分支 spec 重新解析到 main 最新提交（manifest 中的 spec 保持不变，以后仍可用同样方式继续更新）：

```powershell
dsh plugin --profile web update @customize/dsh-web-search-keenable
dsh plugin --profile web update @customize/dsh-web-search-tinyfish
```

不带包名的 `dsh plugin --profile web update` 会重解析全部依赖，两个插件可一次更新。更新后的代码在**下次启动 Harness 时生效**。

## 固定版本 / 回退（commit 与 tag spec）

需要把 profile 固定到某个提交或版本时，用带 commit / tag 的 spec 安装（pnpm 的多个参数用 `&` 连接，不要写两个 `#`；`&` 是 shell 保留字符，**整个 spec 要用引号包起来**，PowerShell 裸写会直接报语法错误）：

```powershell
# 固定到某个提交
dsh plugin --profile web add "github:Liang-Liao/dsh-customize-search#b29e678b28fd4081913a514c451a894f732705db&path:dsh-web-search-keenable"
```

这种形式会把 profile manifest 里的 spec 改成指定提交并强制 pnpm 解析过去；此后 spec 固定，`update` 不会跟随 main 前进；解除固定则重新 `add` 分支 spec。

### 用 tag 发版

tag 指向哪个提交，就安装哪个提交的代码。先打 tag 并推送：

```powershell
git tag -a v1.0.2 -m "v1.0.2"
git push origin v1.0.2
```

然后可用两种形式（同样注意引号）：

```powershell
# 固定 tag：update 永远停在该 tag 指向的版本；升级需打新 tag 后重新 add
dsh plugin --profile web add "github:Liang-Liao/dsh-customize-search#v1.0.2&path:dsh-web-search-tinyfish"

# semver 范围：以后打了新 tag（如 v1.0.3），update 会自动升到匹配范围的最新 tag，不跟随 main 上未发版的提交
dsh plugin --profile web add "github:Liang-Liao/dsh-customize-search#semver:^1.0.2&path:dsh-web-search-tinyfish"
```

想"跟随发版"推荐 semver 形式：每次发版只需打 tag 推送，本地跑 `update` 即可升级。

两个子包也可以**各自独立打 tag**（如 `tinyfish-v1.1.0`、`keenable-v1.0.3`，tag 名随意，分别指向各自子包发版的提交），再用固定 tag 形式分别安装；两个插件可在同一 profile 里各自停在不同版本。

注意 `#semver:` 选择器只认纯版本命名的 tag（`v1.2.3`、`1.2.3`），带前缀的 tag（如 `tinyfish-v1.1.0`）它无法解析；而且它按**仓库级**选提交——两个插件都用 `#semver:` 时共享同一套 `v*` 版本线（同步发版），只是各取自己的子目录。要按子包独立发版，就用前缀 tag + 固定 tag 形式。
