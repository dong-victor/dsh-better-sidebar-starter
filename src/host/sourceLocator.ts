/**
 * Source locator: resolves a logged Java class name (or stack-frame file +
 * line / method) to an absolute source file path. Search space is the
 * config's working directory (the run's `cwd`) first, falling back to the
 * session's workspace root. Full FQCNs resolve by package path under the
 * common source roots; logback-abbreviated names (c.f.l.s.i.Foo) and bare
 * file names resolve by trailing simple class name over a bounded scan.
 * Optionally resolves a method name to its definition line.
 * @module dsh-better-sidebar-starter/host/sourceLocator
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, basename, sep, normalize, isAbsolute } from 'node:path'
import {
  findClassInJars,
  findClassInUserRepos,
  walkJars,
  decompileClassToFile,
} from './decompiler.ts'

/** Input of a locate request (at least one of className/file is required). */
export interface LocateRequest {
  className?: string
  /** Source file base name, e.g. UserService.java. */
  file?: string
  method?: string
  line?: number
  /** Absolute search root (the run config's working directory); optional. */
  root?: string
}

/** Output of a locate request. */
export interface LocateResult {
  ok: boolean
  /** Absolute path of the matched source file (.java, or decompiled output). */
  path?: string
  /** 1-based resolved line (from the request or method scan). */
  line?: number
  /** When true the path is decompiled bytecode, not an original source file. */
  decompiled?: boolean
  reason?: string
}

/** Directories never worth scanning (build/tooling artifacts). */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'target', '.idea', '.gradle', '.mvn',
  'build', 'dist', 'out', 'bin', 'obj', '.next', '.nuxt', '.vite', '.turbo',
  'coverage', 'logs', '.cache', '.dsh', '.trellis', 'public', 'resources',
])

const MAX_DEPTH = 22
const MAX_FILES = 30000
const MAX_DIRS = 10000
const JAVA_EXT = '.java'

/** How long a directory-walk result is reused before a refresh (ms). */
const WALK_TTL_MS = 60_000

/** Directories skipped while scanning bytecode: unlike the .java walk, we
 *  KEEP build output dirs (target/classes, build/classes, out, bin) because
 *  compiled classes live there. */
const SKIP_CLASS_DIRS = new Set([...SKIP_DIRS].filter((d) => !['target', 'build', 'out', 'bin', 'obj'].includes(d)))

/** Escape a string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Candidate source roots: the workspace itself + common src layouts. */
function sourceRoots(base: string): string[] {
  return [
    base,
    join(base, 'src', 'main', 'java'),
    join(base, 'src', 'test', 'java'),
  ]
}

async function exists(p: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((m) => m.access(p))
    return true
  } catch {
    return false
  }
}

/** A caller-supplied root is honored only when it lives inside the workspace. */
function sanitizeRoot(workspace: string, root: string | undefined): string | undefined {
  if (root === undefined || root === '') return undefined
  if (!isAbsolute(root)) return undefined
  const ws = normalize(workspace)
  const r = normalize(root)
  const rel = relative(ws, r)
  if (rel === '') return r
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return r
}

/** Depth-first bounded walk collecting all .java paths. */
async function walkJavaFiles(base: string): Promise<string[]> {
  const out: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }]
  let dirsSeen = 0
  let filesSeen = 0
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!
    if (dirsSeen >= MAX_DIRS) break
    dirsSeen++
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) {
          stack.push({ dir: full, depth: depth + 1 })
        }
      } else if (entry.isFile() && entry.name.endsWith(JAVA_EXT)) {
        filesSeen++
        if (filesSeen <= MAX_FILES) out.push(full)
      }
    }
  }
  return out
}

// ---- Walk caches ----
// A single locate click walks the whole source tree (and possibly the class
// tree) several times; large projects take seconds per walk. Reuse results
// within a short TTL — the log-click locate flow runs in bursts, and source
// edits are rare mid-session. Concurrent callers share the in-flight walk.

interface WalkCacheEntry<T> {
  ts: number
  files: T | null
  inflight: Promise<T> | null
}

const javaWalkCache = new Map<string, WalkCacheEntry<string[]>>()
const classWalkCache = new Map<string, WalkCacheEntry<string[]>>()

function cachedWalk<T>(cache: Map<string, WalkCacheEntry<T>>, base: string, doWalk: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const entry = cache.get(base)
  if (entry !== undefined && entry.files !== null && now - entry.ts < WALK_TTL_MS) {
    return Promise.resolve(entry.files)
  }
  if (entry !== undefined && entry.inflight !== null) {
    return entry.inflight
  }
  const p = doWalk().then((files) => {
    cache.set(base, { ts: Date.now(), files, inflight: null })
    return files
  })
  cache.set(base, { ts: now, files: null, inflight: p })
  return p
}

function walkJavaFilesCached(base: string): Promise<string[]> {
  return cachedWalk<string[]>(javaWalkCache, base, () => walkJavaFiles(base))
}

/** Bounded walk collecting all .class paths. Waits for cache entry via the
 *  general cachedWalk helper (the walk itself is defined below). */
function walkClassFilesCached(base: string): Promise<string[]> {
  return cachedWalk<string[]>(classWalkCache, base, () => walkClassFiles(base))
}

/** Score a candidate file for a class name: src-root bonus + longest
 *  trailing package-segment overlap with the FQCN (+ path brevity). */
function scoreClassName(absPath: string, base: string, className: string, isAbbrev: boolean): number {
  const rel = relative(base, absPath).split(sep).join('/')
  const pathSegs = rel.split('/').slice(0, -1) // dirs only
  const pkgSegs = className.split('.').slice(0, -1) // package only
  let overlap = 0
  let i = pathSegs.length - 1
  let j = pkgSegs.length - 1
  while (i >= 0 && j >= 0 && pathSegs[i] === pkgSegs[j]) {
    overlap++
    i--
    j--
  }
  let score = overlap * 10
  if (rel.includes('/src/main/java/')) score += 50
  else if (rel.includes('/src/test/java/')) score += 40
  score += Math.max(0, 12 - pathSegs.length)
  if (isAbbrev) score += 20 // abbreviation: the file-name match alone counts
  return score
}

/** Score a candidate file for a base file name (prefer src roots + short paths). */
function scoreFileName(absPath: string, base: string): number {
  const rel = relative(base, absPath).split(sep).join('/')
  let score = 0
  if (rel.includes('/src/main/java/')) score += 50
  else if (rel.includes('/src/test/java/')) score += 40
  score += Math.max(0, 15 - rel.split('/').length)
  return score
}

/** Find the definition line of a Java method (1-based; null when not found). */
export function findMethodLine(content: string, method: string): number | null {
  const re = new RegExp(`\\b${escapeRe(method)}\\s*\\(`)
  const lines = content.split('\n')
  let pending: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    if (re.test(t)) {
      // Body opens on this line — covers single-line bodies like
      // `public String getUser(Long id) { return "x"; }` too.
      if (t.includes('{')) return i + 1
      // Signature continues on following lines.
      if (pending === null) pending = i + 1
      continue
    }
    // A pending multi-line signature closes at the line containing '{'.
    if (pending !== null && t.includes('{')) return pending
    if (pending !== null && t.length > 0) pending = null
  }
  return pending
}

/** Resolve the final line: the given line wins; otherwise scan for the method. */
async function resolveLine(path: string, method: string | undefined, line: number | undefined): Promise<number | undefined> {
  if (typeof line === 'number' && Number.isInteger(line) && line > 0) return line
  if (method === undefined || method === '' || method === '<init>' || method === '<clinit>') return undefined
  try {
    const content = await readFile(path, 'utf8')
    return findMethodLine(content, method) ?? undefined
  } catch {
    return undefined
  }
}

/** Bounded walk collecting all .class paths (build output dirs kept). */
async function walkClassFiles(base: string, cap = 20000): Promise<string[]> {
  const out: string[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }]
  let dirsSeen = 0
  while (stack.length > 0 && out.length < cap) {
    const { dir, depth } = stack.pop()!
    if (dirsSeen >= MAX_DIRS) break
    dirsSeen++
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_CLASS_DIRS.has(entry.name)) {
          stack.push({ dir: full, depth: depth + 1 })
        }
      } else if (entry.isFile() && entry.name.endsWith('.class')) {
        out.push(full)
        if (out.length >= cap) return out
      }
    }
  }
  return out
}

/** Common compiled-output roots under a base directory. */
function bytecodeRoots(base: string): string[] {
  return [
    join(base, 'target', 'classes'),
    join(base, 'build', 'classes', 'java', 'main'),
    join(base, 'build', 'classes'),
    join(base, 'out'),
    join(base, 'bin'),
  ]
}

/** Locate a .class file for a class name inside one base directory. */
async function findClassBytecode(base: string, className: string): Promise<string | undefined> {
  const pkgSegs = className.split('.')
  const simpleName = pkgSegs[pkgSegs.length - 1]
  const rel = `${pkgSegs.join('/')}.class`
  for (const root of bytecodeRoots(base)) {
    const candidate = join(root, rel)
    if (await exists(candidate)) return candidate
  }
  // Walk, filtered by the trailing simple class name (handles weird layouts).
  const classes = await walkClassFilesCached(base)
  const wanted = `${simpleName}.class`
  for (const c of classes) {
    if (basename(c) === wanted) return c
  }
  return undefined
}

/** Deduplicate an array of absolute paths preserving order. */
function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * Decompile fallback: no `.java` source was found, so resolve the class
 * bytecode (compiled output → project dependency jars → user-local Maven /
 * Gradle repo), decompile it with CFR and return the generated .java path.
 */
async function locateByBytecode(
  workspace: string,
  bases: string[],
  className: string,
  method: string | undefined,
  line: number | undefined,
): Promise<LocateResult> {
  const pkgSegs = className.split('.')
  const simpleName = pkgSegs[pkgSegs.length - 1]
  const rel = `${pkgSegs.join('/')}.class`

  // JDK built-in packages are never in the workspace or local repos; a
  // lookup can only burn seconds scanning for nothing. Fail fast with a
  // clear message for the common java.*/javax.*/jdk.*/sun.* stack frames.
  const first = pkgSegs[0] ?? ''
  if (
    first === 'java' || first === 'javax' || first === 'jdk' || first === 'sun' ||
    first === 'com.sun' || first === 'org.w3c' || first === 'org.xml' || first === 'groovy'
  ) {
    return { ok: false, reason: `${simpleName} 是 JDK/内置包类，无项目内源码` }
  }

  // 1) Compiled output inside the search bases.
  for (const base of bases) {
    const classPath = await findClassBytecode(base, className)
    if (classPath !== undefined) {
      const out = await decompileClassToFile(workspace, rel, { kind: 'file', path: classPath })
      if (out !== null) return { ok: true, path: out, decompiled: true, line: await resolveLine(out, method, line) }
    }
  }

  // 2) Dependency jars inside the search bases (target/*.jar, lib/*.jar, …).
  const jars: string[] = []
  for (const base of bases) jars.push(...await walkJars(base, { depth: 8, cap: 1000 }))
  const hit = await findClassInJars(uniquePaths(jars), rel)
  if (hit !== null) {
    const out = await decompileClassToFile(workspace, rel, { kind: 'jar', jar: hit.jar, bytes: hit.bytes })
    if (out !== null) return { ok: true, path: out, decompiled: true, line: await resolveLine(out, method, line) }
  }

  // 3) The user-global Maven / Gradle repository (may take a moment on the
  //    first lookup, then it is cached for the host session).
  const repoHit = await findClassInUserRepos(rel)
  if (repoHit !== null) {
    const out = await decompileClassToFile(workspace, rel, { kind: 'jar', jar: repoHit.jar, bytes: repoHit.bytes })
    if (out !== null) return { ok: true, path: out, decompiled: true, line: await resolveLine(out, method, line) }
  }

  return { ok: false, reason: `未找到 ${simpleName} 的源码或字节码（工作空间与本地仓库均无）` }
}

/** Search one base directory for a class file: exact package path first,
 *  then a bounded walk filtered by the trailing simple class name. */
async function findClassFile(base: string, className: string): Promise<string | undefined> {
  const pkgSegs = className.split('.')
  const simpleName = pkgSegs[pkgSegs.length - 1]
  const isAbbrev = pkgSegs.some((s) => s.length <= 1)

  // 1) Exact package-path lookup under the common source roots.
  const rel = `${pkgSegs.join('/')}${JAVA_EXT}`
  for (const root of sourceRoots(base)) {
    const candidate = join(root, rel)
    if (await exists(candidate)) return candidate
  }

  // 2) Bounded scan, filtered by file name, scored by package overlap.
  const files = await walkJavaFilesCached(base)
  let best: { path: string; score: number } | null = null
  for (const f of files) {
    if (basename(f) !== `${simpleName}${JAVA_EXT}`) continue
    const score = scoreClassName(f, base, className, isAbbrev)
    if (best === null || score > best.score) best = { path: f, score }
  }
  return best?.path
}

/**
 * Resolve a class/method/line reference to a source file. Searches the
 * run config's working directory (`req.root`) first, then the session
 * workspace root.
 */
export async function locateSource(workspace: string, req: LocateRequest): Promise<LocateResult> {
  const { className, file, method, line } = req
  const root = sanitizeRoot(workspace, req.root)
  const bases = root !== undefined && root !== normalize(workspace) ? [root, workspace] : [workspace]

  if (className !== undefined) {
    const pkgSegs = className.split('.')
    for (const base of bases) {
      const found = await findClassFile(base, className)
      if (found !== undefined) {
        return { ok: true, path: found, line: await resolveLine(found, method, line) }
      }
    }
    if (pkgSegs.length > 1 && pkgSegs.some((s) => s.length <= 1)) {
      // Abbreviation handled by file-name matching above; fall through to
      // bytecode resolution using the trailing simple class name.
    }
    return await locateByBytecode(workspace, bases, className, method, line)
  }

  // File-name lookup (stack frame without a resolvable FQCN, or (Foo.java:45)).
  if (file !== undefined) {
    for (const base of bases) {
      const files = await walkJavaFilesCached(base)
      let best: { path: string; score: number } | null = null
      for (const f of files) {
        if (basename(f) !== file) continue
        const score = scoreFileName(f, base)
        if (best === null || score > best.score) best = { path: f, score }
      }
      if (best !== null) {
        return { ok: true, path: best.path, line: await resolveLine(best.path, method, line) }
      }
    }
    // No source: try decompiling the matching compiled class (file name only,
    // no package context — matches the simple class name in build output).
    const clsBase = file.replace(/\.java$/i, '')
    for (const base of bases) {
      const classes = await walkClassFilesCached(base)
      for (const c of classes) {
        if (basename(c) !== `${clsBase}.class`) continue
        const rel = relative(base, c).split(sep).join('/')
        const out = await decompileClassToFile(workspace, rel, { kind: 'file', path: c })
        if (out !== null) return { ok: true, path: out, decompiled: true, line: await resolveLine(out, method, line) }
      }
    }
    return { ok: false, reason: `未找到 ${file} 源文件（也无对应字节码）` }
  }

  return { ok: false, reason: '缺少 className 或 file' }
}