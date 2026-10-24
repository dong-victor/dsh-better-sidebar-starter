# @dong-victor/dsh-better-sidebar-starter

dsh-better-sidebar 的运行配置插件：模仿 IntelliJ IDEA 运行/调试配置（Run/Debug Configurations），支持 npm/springboot/python/custom 命令执行、历史保存、快捷启动、实时日志查看。

## 功能

- **运行配置管理**：创建、编辑、删除运行配置，持久化到工作区 `.dsh/run-configs.json`
- **快捷启动**：一键启动命令，支持多实例并行运行
- **实时日志**：WebSocket 实时推送 stdout/stderr，ANSI 彩色渲染
- **IDEA 服务面板式布局**：左侧 1/3 配置树（按类型分组）+ 右侧 2/3 日志流
- **进程管理**：跨平台进程树杀死（Windows taskkill /T，Unix process group kill）
- **跨平台命令解析**：命令串在两端都交给系统 shell（Windows `cmd.exe /d /s /c`，
  POSIX `/bin/sh -c`），因此 `npm run dev -- --host 0.0.0.0` 这类带空格的命令可用

## 配置类型

| 类型 | 默认命令 | 说明 |
|------|---------|------|
| npm | `npm run dev` | Node.js 前端项目 |
| springboot | `mvn spring-boot:run` | Spring Boot 后端项目 |
| python | `python main.py` | Python 脚本 |
| custom | (空) | 自定义命令 |

## 构建

```bash
pnpm install
pnpm run build
```

产物：
- `lib/index.js` — Host 端 ESM（HTTP 路由 + WebSocket + 进程管理）
- `lib/client.js` — Client 端 CJS bundle（React UI，注册 sidebar tab）

## 安装到 dsh profile

```bash
dsh plugin --profile <name> add @dong-victor/dsh-better-sidebar-starter
```

本地改动验证走打包安装，不要手改 profile 的 `node_modules`：

```bash
npm pack
# 在 profile 的 package.json 里把依赖指向 tarball，然后
dsh plugin --profile <name> install
# 重启 dsh，让 host 与 client 两半都重新加载
```

注意 pnpm 会按 tarball 内容哈希复用缓存，**同名 tarball 重新打包不会被识别**，
每次重新构建后要把 `package.json` / `dsh.plugin.json` 的版本号一起加一。

## 运行时兼容

Host 端的 `inject` 只用各版本都存在的服务：`webServer`、`sessions`、`tools`、
`systemPrompt`。

- **不要注入 `webRuntime`**：dsh 0.2.0-rc.2 提供该服务，0.2.1-rc.2 已移除
  （改由 `webStartup` + `connection` 承担）。cordis 的注入未满足会让插件
  保持 inactive，表现为整块 host 半消失：`/api/dsh-better-sidebar-starter/*`
  全部 404（面板里选目录报 `fs-dirs .: 404`），client 半也就不会挂载、样式不注入。
- `/api` 网关（`connection` 服务）**也不进 inject**，而是用 `ctx.get('connection')`
  惰性读取：拿到 `trustedHosts` 就按同一套 Host/Origin 规则放行，拿不到就退回
  仅允许 loopback。这样服务被改名或移除时只降级校验，不会让插件整体失效。
- client 半在 `apply()` 里就注入样式表，因为齿轮弹窗中的设置面板可能先于
  「服务」Tab 渲染。
- 目录选择器只接受绝对路径：起始目录取 host 的 `detect-env` 返回的主目录，
  失败时退回绝对形式的会话 cwd，绝不把相对路径 `'.'` 发给 `fs-dirs`。
  配置编辑弹窗里的目录树同理——会话 cwd 不是绝对路径时给出提示并让用户直接
  填绝对路径；那里的「工作空间根目录」行仍保留 `'.'` 这一**语义值**（host 起服务
  时会把它解析成会话工作区），只是这个值不会传给 `fs-dirs`。

## 架构

```
Host (Node.js)                    Client (Browser)
┌──────────────────┐              ┌──────────────────┐
│ configStore.ts   │  REST API    │ ServicesTab.tsx  │
│ processManager.ts│←────────────→│ ConfigTree.tsx   │
│ routes.ts        │  WebSocket   │ LogView.tsx      │
│ fence.ts / gate  │              │ ConfigDetail.tsx │
└──────────────────┘              └──────────────────┘
```

## License

MIT
