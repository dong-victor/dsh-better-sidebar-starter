/**
 * Agent tool surface for the starter plugin: exposes the service-runner
 * (run-config CRUD + process lifecycle + logs) to the chat agent as native
 * dsh tools, so the user can drive service startup from conversation and the
 * agent can scan a workspace, generate/edit run instructions and start/stop
 * services with full log visibility.
 *
 * Registered on `ctx.tools` with plain object literals (structural face — no
 * runtime dependency on @deepseek-ai/dsh-tools), plus a system-prompt
 * guidance section. All tools share the same configStore + ProcessManager
 * singletons the sidebar panel uses, so the UI keeps showing everything the
 * agent touches (and vice versa).
 * @module dsh-better-sidebar-starter/host/agentTools
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, isAbsolute, resolve, basename } from 'node:path'
import type { PluginContext, PluginToolDefinition } from './context.ts'
import { readConfigs, upsertConfig, deleteConfig, stampLastRun, type RunConfig, type RunConfigType } from './configStore.ts'
import { ProcessManager, type RunInstance } from './processManager.ts'

/** Order of the guidance section within the tool-guidance band. */
const SECTION_ORDER = 150

const TOOL_PREFIX = 'starter_'

/** Directories skipped by the project scanner. */
const SCAN_SKIP = new Set([
  'node_modules', '.git', '.svn', '.hg', 'target', 'build', 'dist', 'out', 'bin',
  '.idea', '.gradle', '.mvn', '.next', '.nuxt', '.vite', '.cache', '.dsh', '.trellis',
  'coverage', 'logs', '.gitlab', '.github',
])

/** One project root found by the scanner with a suggested run config. */
export interface ScanProject {
  name: string
  /** Absolute path of the project root (use as the config's cwd). */
  cwd: string
  type: RunConfigType
  /** Suggested command (may be empty → agent asks/fills it). */
  command: string
  hints: string[]
}

function textBlock(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }]
}

/** Validate the workspace argument. */
function requireWorkspace(args: Record<string, unknown>): string {
  const ws = typeof args.workspace === 'string' ? args.workspace.trim() : ''
  if (ws === '') throw new Error('workspace (绝对路径) 是必填参数')
  if (!isAbsolute(ws)) throw new Error(`workspace 必须是绝对路径: ${ws}`)
  if (!existsSync(ws)) throw new Error(`workspace 不存在: ${ws}`)
  return ws
}

/**
 * Scan a workspace for runnable projects (pom.xml / package.json /
 * gradle / python markers) and return suggested run configs.
 */
async function scanProjects(workspace: string, maxDepth: number): Promise<ScanProject[]> {
  const found: ScanProject[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: workspace, depth: 0 }]
  let dirsSeen = 0
  while (stack.length > 0 && dirsSeen < 8000) {
    const { dir, depth } = stack.pop()!
    dirsSeen++
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const names = new Set(entries.map((e) => e.name))
    const isProject = ['pom.xml', 'package.json', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pyproject.toml', 'requirements.txt', 'setup.py', 'manage.py'].some((n) => names.has(n))
    if (isProject && dir !== workspace) {
      const proj = await describeProject(dir, names)
      if (proj !== null) found.push(proj)
      if (found.length >= 60) break
      continue // do not descend into a nested project
    }
    if (depth >= maxDepth) continue
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue
      if (SCAN_SKIP.has(e.name)) continue
      stack.push({ dir: join(dir, e.name), depth: depth + 1 })
    }
  }
  return found
}

/** Inspect one project directory and derive the suggested run config. */
async function describeProject(dir: string, names: Set<string>): Promise<ScanProject | null> {
  const hints: string[] = []
  const name = basename(dir)
  let type: RunConfigType = 'custom'
  let command = ''

  if (names.has('pom.xml')) {
    type = 'springboot'
    command = 'mvn spring-boot:run'
    hints.push('检测到 Maven 项目（pom.xml）')
    try {
      const pom = await readFile(join(dir, 'pom.xml'), 'utf8')
      if (/spring-boot-maven-plugin/.test(pom)) hints.push('包含 spring-boot-maven-plugin，可用 mvn spring-boot:run')
      else hints.push('通用 Maven 工程：可用 mvn compile / mvn spring-boot:run（如含 Spring Boot 插件）')
    } catch { /* unreadable — keep defaults */ }
  } else if (names.has('package.json')) {
    type = 'npm'
    hints.push('检测到 Node 项目（package.json）')
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts ?? {}
      if (typeof scripts.dev === 'string') command = 'npm run dev'
      else if (typeof scripts.start === 'string') command = 'npm start'
      else if (typeof scripts.serve === 'string') command = 'npm run serve'
      else {
        const first = Object.keys(scripts)[0]
        command = first !== undefined ? `npm run ${first}` : 'npm start'
      }
      hints.push(`package.json scripts: ${Object.keys(scripts).slice(0, 8).join(', ') || '(无)'}`)
    } catch { command = 'npm start' }
  } else if (names.has('build.gradle') || names.has('build.gradle.kts')) {
    type = 'custom'
    command = 'gradle bootRun'
    hints.push('检测到 Gradle 项目，如为 Spring Boot 可用 gradle bootRun；否则用 gradle run')
  } else {
    type = 'python'
    hints.push('检测到 Python 项目')
    let py: 'flask' | 'django' | 'fastapi' | 'plain' = 'plain'
    try {
      if (names.has('manage.py')) py = 'django'
      else if (names.has('requirements.txt') || names.has('pyproject.toml')) {
        const req = await readFile(
          names.has('requirements.txt') ? join(dir, 'requirements.txt') : join(dir, 'pyproject.toml'),
          'utf8',
        )
        if (/fastapi|uvicorn/i.test(req)) py = 'fastapi'
        else if (/flask/i.test(req)) py = 'flask'
        else if (/django/i.test(req)) py = 'django'
      }
    } catch { /* ignore */ }
    if (py === 'django') command = 'python manage.py runserver'
    else if (py === 'fastapi') command = 'python -m uvicorn main:app --reload'
    else if (py === 'flask') command = 'python app.py'
    else {
      command = 'python main.py'
      hints.push('未识别到 Web 框架入口，请人工确认启动命令（如 uvicorn/flask/django）')
    }
    hints.push(`Python 类型: ${py}`)
  }

  return { name, cwd: dir, type, command: command.trim(), hints }
}

/**
 * Resolve a config's working directory exactly like the run route does:
 * `.` → workspace root; relative → resolved against workspace; absolute → as-is.
 */
async function resolveConfigCwd(config: RunConfig, workspace: string): Promise<string> {
  if (config.cwd === '' || config.cwd === '.') return workspace
  return isAbsolute(config.cwd) ? config.cwd : resolve(workspace, config.cwd)
}

/** Turn a RunConfig into a plain serializable object for tool output. */
function plainConfig(c: RunConfig): Record<string, unknown> {
  return { ...c }
}

/** Start a service from a config id (mirrors the /run route). */
async function startService(kernels: ProcessManager, workspace: string, configId: string, globalEnv?: Record<string, string>): Promise<RunInstance> {
  const configs = await readConfigs(workspace)
  const config = configs.find((c) => c.id === configId)
  if (config === undefined) throw new Error(`config not found: ${configId}`)
  const configCwd = await resolveConfigCwd(config, workspace)
  if (!existsSync(configCwd)) throw new Error(`config cwd 不存在: ${configCwd}`)
  await stampLastRun(workspace, config.id)
  // Logs always land under the session workspace root (<workspace>/logs/),
  // never under the config's own working directory.
  return kernels.spawnConfig(config, configCwd, globalEnv ?? {}, workspace)
}

/** Register every tool and the guidance section; returns the disposer. */
export function registerAgentTools(ctx: PluginContext, kernels: ProcessManager): () => void {
  const disposers: Array<() => void> = []

  const def = (d: PluginToolDefinition): void => {
    if (ctx.tools === undefined) return
    disposers.push(ctx.tools.register(d))
  }

  const renderInstance = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => {
    const v = value as { ok?: boolean; error?: string; instance?: RunInstance; stopped?: boolean; reason?: string }
    if (v.error !== undefined) return textBlock(`错误：${v.error}`)
    if (v.instance !== undefined) {
      const inst = v.instance
      return textBlock(`已启动服务 ${inst.configName}（实例 ${inst.id}），状态：${inst.status}，PID：${inst.pid}，工作目录：${inst.cwd}`)
    }
    if (v.ok === true) return textBlock('操作成功')
    return textBlock(JSON.stringify(value))
  }

  // ---- scan_projects ----
  def({
    name: `${TOOL_PREFIX}scan_projects`,
    description:
      '扫描工作空间中的可运行项目（识别 pom.xml / package.json / build.gradle / Python 工程），返回推荐启动指令 ' +
      '（type/command/cwd），供后续用 starter_create_config 生成运行配置。' +
      'Triggers: 扫描项目, 生成启动指令, 有哪些可以启动的服务/项目, 自动识别项目类型.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workspace'],
      properties: {
        workspace: { type: 'string', description: '要扫描的工作空间绝对路径（项目根目录）' },
        depth: { type: 'number', description: '递归扫描深度（默认 8）', default: 8 },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          projects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {}, cwd: {}, type: {}, command: {}, hints: { type: 'array', items: {} },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const v = value as { projects?: ScanProject[] }
        const projects = v.projects ?? []
        if (projects.length === 0) return textBlock('未在工作空间中发现可识别项目（pom.xml/package.json/gradle/python）。')
        const lines = projects.map((p, i) =>
          `${i + 1}. ${p.name}  类型=${p.type}  命令=${p.command || '(待定)'}\n   cwd=${p.cwd}\n   提示: ${p.hints.join('；') || '无'}`,
        )
        return textBlock(`发现 ${projects.length} 个可运行项目：\n${lines.join('\n')}\n\n可用 starter_create_config(workspace, name, type, command, cwd) 生成运行配置。`)
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const projects = await scanProjects(workspace, typeof args.depth === 'number' ? Math.min(Math.max(1, args.depth), 16) : 8)
      return { projects }
    },
  })

  // ---- configs list / get / create / update / delete ----
  def({
    name: `${TOOL_PREFIX}list_configs`,
    description: '列出工作空间保存的全部运行配置（启动指令）。Triggers: 查看运行配置/启动指令列表, 有哪些配置.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['workspace'],
      properties: { workspace: { type: 'string', description: '工作空间绝对路径' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { configs: { type: 'array', items: {} } } },
      render: (_args, value) => {
        const v = value as { configs?: RunConfig[] }
        const configs = v.configs ?? []
        if (configs.length === 0) return textBlock('尚未保存运行配置。可先用 starter_scan_projects 扫描项目并生成。')
        const lines = configs.map((c) => `- [${c.id}] ${c.name}  (${c.type})  ${c.command || '(空)'}  cwd=${c.cwd}${c.lastRunAt !== null ? '  最近运行:' + new Date(c.lastRunAt).toLocaleString() : ''}`)
        return textBlock(`共 ${configs.length} 个运行配置：\n${lines.join('\n')}`)
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      return { configs: (await readConfigs(workspace)).map(plainConfig) }
    },
  })

  def({
    name: `${TOOL_PREFIX}get_config`,
    description: '获取单个运行配置的完整详情（含 env/jvmArgs/args/runtime）。Triggers: 查看配置详情.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['workspace', 'configId'],
      properties: {
        workspace: { type: 'string', description: '工作空间绝对路径' },
        configId: { type: 'string', description: '运行配置 id' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: { config: {} } }, render: (_a, v) => textBlock(JSON.stringify(v, null, 2)) },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const configId = typeof args.configId === 'string' ? args.configId : ''
      const configs = await readConfigs(workspace)
      const config = configs.find((c) => c.id === configId)
      if (config === undefined) throw new Error(`config not found: ${configId}`)
      return { config: plainConfig(config) }
    },
  })

  def({
    name: `${TOOL_PREFIX}create_config`,
    description:
      '在工作空间新建一个运行配置（启动指令）。type 支持 npm/springboot/python/custom；command 为启动命令；' +
      'cwd 相对工作空间（默认 .）或绝对路径；springboot 可带 jvmArgs（JVM 参数）与 args（程序参数）。' +
      'Triggers: 生成启动指令/运行配置, 添加配置, 保存启动命令.',
    parameters: {
      type: 'object', additionalProperties: true, required: ['workspace', 'name'],
      properties: {
        workspace: { type: 'string', description: '工作空间绝对路径' },
        name: { type: 'string', description: '配置名称（建议含项目名，如 cassiopeia-ap）' },
        type: { type: 'string', enum: ['npm', 'springboot', 'python', 'custom'], default: 'custom' },
        command: { type: 'string', description: '启动命令，直接写命令名（如 npm run dev / mvn spring-boot:run / python main.py），不要写 node/npm/python/mvn 的绝对路径——运行环境已注入 PATH' },
        cwd: { type: 'string', description: '工作目录，相对工作空间或绝对路径，默认 .' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: '环境变量键值' },
        jvmArgs: { type: 'string', description: 'JVM 参数（springboot），如 -Xmx512m -Dspring.profiles.active=dev' },
        args: { type: 'string', description: '程序参数（追加在命令后）' },
        runtime: { type: 'object', additionalProperties: { type: 'string' }, description: 'Java/Node/Python/Maven 路径覆盖: {java,node,python,mvn}' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { config: {} } },
      render: (_args, value) => {
        const v = value as { config?: RunConfig }
        if (v.config === undefined) return textBlock(JSON.stringify(value))
        return textBlock(`已创建配置 [${v.config.id}] ${v.config.name}（${v.config.type}）\n命令: ${v.config.command || '(空)'}\ncwd: ${v.config.cwd}`)
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (name === '') throw new Error('name 是必填参数')
      const config = await upsertConfig(workspace, {
        name,
        type: (args.type as RunConfigType) ?? 'custom',
        command: typeof args.command === 'string' ? args.command : '',
        cwd: typeof args.cwd === 'string' ? args.cwd : '.',
        env: typeof args.env === 'object' && args.env !== null ? args.env as Record<string, string> : {},
        jvmArgs: typeof args.jvmArgs === 'string' ? args.jvmArgs : '',
        args: typeof args.args === 'string' ? args.args : '',
        runtime: typeof args.runtime === 'object' && args.runtime !== null ? args.runtime as RunConfig['runtime'] : undefined,
      })
      return { config: plainConfig(config) }
    },
  })

  def({
    name: `${TOOL_PREFIX}update_config`,
    description: '编辑一个已有运行配置（按 configId 更新字段，未提供的字段保持原值）。Triggers: 修改/编辑启动指令, 改配置, 更新运行命令.',
    parameters: {
      type: 'object', additionalProperties: true, required: ['workspace', 'configId'],
      properties: {
        workspace: { type: 'string', description: '工作空间绝对路径' },
        configId: { type: 'string', description: '要编辑的运行配置 id' },
        name: { type: 'string' },
        type: { type: 'string', enum: ['npm', 'springboot', 'python', 'custom'] },
        command: { type: 'string' },
        cwd: { type: 'string' },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        jvmArgs: { type: 'string' },
        args: { type: 'string' },
        runtime: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { config: {} } },
      render: (_args, value) => {
        const v = value as { config?: RunConfig }
        if (v.config === undefined) return textBlock(JSON.stringify(value))
        return textBlock(`已更新配置 [${v.config.id}] ${v.config.name}（${v.config.type}）\n命令: ${v.config.command || '(空)'}\ncwd: ${v.config.cwd}`)
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const configId = typeof args.configId === 'string' ? args.configId : ''
      if (configId === '') throw new Error('configId 是必填参数')
      const input: Record<string, unknown> = { id: configId }
      for (const key of ['name', 'type', 'command', 'cwd', 'env', 'jvmArgs', 'args', 'runtime'] as const) {
        if (args[key] !== undefined) input[key] = args[key]
      }
      const config = await upsertConfig(workspace, input as Parameters<typeof upsertConfig>[1])
      return { config: plainConfig(config) }
    },
  })

  def({
    name: `${TOOL_PREFIX}delete_config`,
    description: '删除一个运行配置；若该配置有正在运行的服务实例会一并停止。Triggers: 删除配置/启动指令.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['workspace', 'configId'],
      properties: {
        workspace: { type: 'string', description: '工作空间绝对路径' },
        configId: { type: 'string', description: '要删除的运行配置 id' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' }, removed: { type: 'boolean' } } },
      render: (_args, value) => {
        const v = value as { removed?: boolean }
        return textBlock(v.removed === true ? '配置已删除（相关运行中的实例已停止）' : '配置不存在（可能已删除）')
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const configId = typeof args.configId === 'string' ? args.configId : ''
      const removed = await deleteConfig(workspace, configId)
      for (const inst of kernels.listInstances()) {
        if (inst.configId === configId && inst.status === 'running') kernels.stop(inst.id)
      }
      return { ok: true, removed }
    },
  })

  // ---- service lifecycle ----
  def({
    name: `${TOOL_PREFIX}list_instances`,
    description: '列出当前全部服务实例（运行中/已退出），含状态、PID、启动时间、所属配置。Triggers: 服务状态, 哪些服务在跑, 进程监控.',
    parameters: {
      type: 'object', additionalProperties: false, properties: {},
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { instances: { type: 'array', items: {} } } },
      render: (_args, value) => {
        const v = value as { instances?: RunInstance[] }
        const instances = v.instances ?? []
        if (instances.length === 0) return textBlock('当前没有服务实例。')
        const lines = instances.map((i) =>
          `- [${i.id}] ${i.configName}  状态=${i.status}  PID=${i.pid}  cwd=${i.cwd}` +
          (i.exitedAt !== null ? `  退出码=${i.exitCode ?? '?'} @${new Date(i.exitedAt).toLocaleString()}` : ''),
        )
        return textBlock(`当前 ${instances.length} 个服务实例：\n${lines.join('\n')}\n\n用 starter_get_logs(instanceId) 查看日志，starter_stop_service 停止。`)
      },
    },
    async execute() {
      return { instances: kernels.listInstances() }
    },
  })

  def({
    name: `${TOOL_PREFIX}start_service`,
    description:
      '启动一个服务：按运行配置（configId）拉起子进程，日志进入共享缓冲（侧边栏「服务管理」面板同步可见）。' +
      'Triggers: 启动服务/应用, 跑起来, 启动 xx 配置, 用 xx 配置启动.',
    parameters: {
      type: 'object', additionalProperties: true, required: ['workspace', 'configId'],
      properties: {
        workspace: { type: 'string', description: '保存该配置的工作空间绝对路径' },
        configId: { type: 'string', description: '运行配置 id（先 starter_list_configs 查看）' },
        globalEnv: { type: 'object', additionalProperties: { type: 'string' }, description: '附加全局环境变量' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: { ok: {}, instance: {}, error: { type: 'string' } },
      },
      render: renderInstance,
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const configId = typeof args.configId === 'string' ? args.configId : ''
      if (configId === '') throw new Error('configId 是必填参数')
      try {
        const instance = await startService(kernels, workspace, configId,
          typeof args.globalEnv === 'object' && args.globalEnv !== null ? args.globalEnv as Record<string, string> : undefined)
        return { ok: true, instance }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  def({
    name: `${TOOL_PREFIX}stop_service`,
    description: '停止一个正在运行的服务实例（按 instanceId，先 starter_list_instances 查看）。Triggers: 停止服务/应用, 关掉服务.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['instanceId'],
      properties: { instanceId: { type: 'string', description: '服务实例 id' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: {}, stopped: {}, reason: { type: 'string' } } },
      render: (_args, value) => {
        const v = value as { stopped?: boolean; reason?: string }
        return textBlock(v.stopped === true ? '服务已停止' : (v.reason ?? '未找到对应实例'))
      },
    },
    async execute(args) {
      const instanceId = typeof args.instanceId === 'string' ? args.instanceId : ''
      if (instanceId === '') throw new Error('instanceId 是必填参数')
      const stopped = kernels.stop(instanceId)
      return { ok: true, stopped, ...(stopped ? {} : { reason: '实例不存在或已退出' }) }
    },
  })

  def({
    name: `${TOOL_PREFIX}restart_service`,
    description: '重启服务：停止该配置当前运行中的实例并重新启动（按 configId）。Triggers: 重启服务, 重新启动, 重启 xx.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['workspace', 'configId'],
      properties: {
        workspace: { type: 'string', description: '保存该配置的工作空间绝对路径' },
        configId: { type: 'string', description: '运行配置 id' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: { ok: {}, instance: {}, error: { type: 'string' } },
      },
      render: renderInstance,
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const configId = typeof args.configId === 'string' ? args.configId : ''
      if (configId === '') throw new Error('configId 是必填参数')
      for (const inst of kernels.listInstances()) {
        if (inst.configId === configId && inst.status === 'running') kernels.stop(inst.id)
      }
      try {
        const instance = await startService(kernels, workspace, configId)
        return { ok: true, instance }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  // ---- logs ----
  def({
    name: `${TOOL_PREFIX}get_logs`,
    description:
      '读取服务实例的日志（与侧边栏「服务管理」面板同一份实时缓冲）。' +
      '参数 tail 表示返回末尾多少条（默认 200，最大 2000）；sinceTs 为毫秒时间戳则只返回该时间之后的日志。' +
      'Triggers: 查看服务日志, 日志输出, 程序报错了看日志, 服务输出, 看运行情况.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['instanceId'],
      properties: {
        instanceId: { type: 'string', description: '服务实例 id' },
        tail: { type: 'number', description: '返回末尾多少条日志（默认 200）' },
        sinceTs: { type: 'number', description: '只返回 ts >= sinceTs（毫秒）的日志' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: {
          instanceId: { type: 'string' },
          total: { type: 'number' },
          logs: {
            type: 'array',
            items: {
              type: 'object',
              properties: { ts: {}, stream: {}, text: {} },
            },
          },
          running: { type: 'boolean' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as { logs?: Array<{ ts: number; stream: string; text: string }>; instanceId?: string; total?: number; error?: string; running?: boolean }
        if (v.error !== undefined) return textBlock(`错误：${v.error}`)
        const logs = v.logs ?? []
        if (logs.length === 0) return textBlock(`实例 ${v.instanceId ?? ''} 暂无日志。`)
        const status = v.running === false ? '（已退出）' : ''
        const line = logs.map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.stream === 'stderr' ? 'ERR ' : 'OUT '}${l.text.replace(/\n+$/, '')}`).join('\n')
        return textBlock(`实例 ${v.instanceId}${status} 共 ${v.total ?? logs.length} 条（显示末尾 ${logs.length} 条）：\n${line}`)
      },
    },
    async execute(args) {
      const instanceId = typeof args.instanceId === 'string' ? args.instanceId : ''
      if (instanceId === '') throw new Error('instanceId 是必填参数')
      const instance = kernels.getInstance(instanceId)
      if (instance === undefined) {
        throw new Error(`instance not found: ${instanceId}（实例已清理，可用 starter_log_history 查看该工作空间的持久化历史日志）`)
      }
      const logs = kernels.getLogs(instanceId)
      const sinceTs = typeof args.sinceTs === 'number' ? args.sinceTs : undefined
      const tail = typeof args.tail === 'number' ? Math.min(Math.max(1, args.tail), 2000) : 200
      let filtered = sinceTs !== undefined ? logs.filter((l) => l.ts >= sinceTs) : logs
      const total = filtered.length
      if (filtered.length > tail) filtered = filtered.slice(filtered.length - tail)
      return { instanceId, total, logs: filtered, running: instance.status === 'running' }
    },
  })

  // ---- persistent log history ----
  def({
    name: `${TOOL_PREFIX}log_history`,
    description:
      '查看工作空间下的持久化运行日志（workspace/logs/*.log，每次启动都会落盘、永久保留；即使启动失败、实例被清理或 dsh 重启后也能查到）。' +
      '不传 file 时列出历史日志文件（新的在前）；传 file（或文件名）读取对应日志内容（tail 可限制条数）。' +
      'Triggers: 查看历史日志, 上一次启动日志, 启动失败的日志, 日志找不到了, 实例已清理.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['workspace'],
      properties: {
        workspace: { type: 'string', description: '工作空间绝对路径' },
        file: { type: 'string', description: '日志文件绝对路径或 logs/ 下的文件名（可选）' },
        tail: { type: 'number', description: '读取时返回末尾多少条（默认 500，最大 5000）' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: {
          files: { type: 'array', items: { type: 'object', properties: { file: {}, name: {}, mtime: {}, size: {} } } },
          file: { type: 'string' },
          logs: { type: 'array', items: { type: 'object', properties: { ts: {}, stream: {}, text: {} } } },
          total: { type: 'number' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const v = value as {
          files?: Array<{ file: string; name: string; mtime: number; size: number }>
          logs?: Array<{ ts: number; stream: string; text: string }>
          file?: string
          total?: number
          error?: string
        }
        if (v.error !== undefined) return textBlock(`错误：${v.error}`)
        if (v.files !== undefined) {
          if (v.files.length === 0) return textBlock('该工作空间暂无历史运行日志（workspace/logs 为空）。')
          const lines = v.files.map((f, i) => `${i + 1}. ${f.name}  （${new Date(f.mtime).toLocaleString()}，${(f.size / 1024).toFixed(1)} KB）\n   ${f.file}`)
          return textBlock(`共 ${v.files.length} 个历史日志：\n${lines.join('\n')}\n\n用 starter_log_history(workspace, file) 读取内容。`)
        }
        if (v.logs !== undefined) {
          const logs = v.logs
          if (logs.length === 0) return textBlock(`日志文件 ${v.file ?? ''} 为空。`)
          const lines = logs.map((l) => `[${new Date(l.ts).toLocaleString()}] ${l.stream === 'stderr' ? 'ERR ' : l.stream === 'meta' ? 'RUN ' : 'OUT '}${l.text.replace(/\n+$/, '')}`)
          return textBlock(`日志文件 ${v.file}（共 ${v.total ?? logs.length} 条，显示末尾 ${logs.length} 条）：\n${lines.join('\n')}`)
        }
        return textBlock(JSON.stringify(value))
      },
    },
    async execute(args) {
      const workspace = requireWorkspace(args)
      const fileParam = typeof args.file === 'string' && args.file.trim() !== '' ? args.file.trim() : undefined
      const tail = typeof args.tail === 'number' ? Math.min(Math.max(1, args.tail), 5000) : 500
      const { listLogFiles, readLogFile } = await import('./processManager.ts')
      if (fileParam === undefined) {
        const files = await listLogFiles(workspace)
        return { files }
      }
      // Resolve the file: absolute path, or a file name under logs/.
      const roots = [workspace, join(workspace, 'logs'), join(workspace, '.dsh', 'logs')]
      let abs = ''
      if (isAbsolute(fileParam)) {
        abs = fileParam
      } else {
        for (const r of roots) {
          const candidate = join(r, basename(fileParam))
          if (existsSync(candidate)) { abs = candidate; break }
        }
      }
      if (abs === '' || !existsSync(abs)) throw new Error(`日志文件不存在: ${fileParam}`)
      const logs = await readLogFile(abs, tail)
      return { file: abs, total: logs.length, logs }
    },
  })

  // ---- guidance ----
  let disposeGuidance: (() => void) | undefined
  if (ctx.systemPrompt !== undefined) {
    const text = () => buildGuidanceText()
    try {
      disposeGuidance = ctx.systemPrompt.section({ name: 'plugin:dsh-better-sidebar-starter', order: SECTION_ORDER, text })
    } catch { disposeGuidance = undefined }
    if (disposeGuidance !== undefined) disposers.push(disposeGuidance)
  }

  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* already disposed */ }
    }
  }
}

/** Model-facing guidance: presence, capability, proactive rule. */
export function buildGuidanceText(): string {
  return (
    '本机已安装 @dong-victor/dsh-better-sidebar-starter 插件的「服务管理」agent 工具（dsh 原生注入，非 MCP）：' +
    '工具前缀 starter_，覆盖 扫描项目(starter_scan_projects 识别 pom.xml/package.json/gradle/python 并推荐启动指令) → ' +
    '配置管理(starter_list_configs / get_config / create_config / update_config / delete_config) → ' +
    '服务生命周期(starter_start_service / stop_service / restart_service / list_instances) → ' +
    '日志(starter_get_logs 与侧边栏「服务管理」面板同一份实时日志缓冲，可 tail/sinceTs 参数；' +
      'starter_log_history 查看 workspace/logs 下持久化历史日志——每次启动都落盘、永久保留，启动失败/实例清理/dsh 重启都能查到)。' +
    '运行配置持久化在工作空间的 .dsh/run-configs.json，与侧边栏面板数据完全一致：agent 创建/编辑的配置面板立即可见，' +
    'agent 启动的服务实例面板同样可以停止/查看日志。' +
    '重要：启动命令一律写短命令（npm run dev / npm start / python main.py / mvn spring-boot:run），' +
    '不要写 node/npm/python/mvn 的绝对路径——插件已把工具链目录注入 PATH，短命令即可解析。' +
    '主动调用规则：当用户要求「扫描工作空间项目 / 生成或编辑启动指令 / 启动/停止/重启服务 / 查看服务日志 / 列出运行配置或服务状态」时，' +
    '应主动使用 starter_* 工具完成，不要等待用户指定工具名；workspace 参数传当前工作空间绝对路径（如 C:\\Users\\dongz\\.dsh\\workspace\\<项目>）。'
  )
}