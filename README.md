# @dong-victor/dsh-better-sidebar-starter

dsh-better-sidebar 的运行配置插件：模仿 IntelliJ IDEA 运行/调试配置（Run/Debug Configurations），支持 npm/springboot/python/custom 命令执行、历史保存、快捷启动、实时日志查看。

## 功能

- **运行配置管理**：创建、编辑、删除运行配置，持久化到工作区 `.dsh/run-configs.json`
- **快捷启动**：一键启动命令，支持多实例并行运行
- **实时日志**：WebSocket 实时推送 stdout/stderr，ANSI 彩色渲染
- **IDEA 服务面板式布局**：左侧 1/3 配置树（按类型分组）+ 右侧 2/3 日志流
- **进程管理**：跨平台进程树杀死（Windows taskkill /T，Unix process group kill）

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

或手动同步 `lib/` + `dsh.plugin.json` + `cordis.patch.yml` 到 profile node_modules。

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
