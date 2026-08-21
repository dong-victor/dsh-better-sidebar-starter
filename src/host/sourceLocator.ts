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
  /** Absolute path of the matched source file. */
  path?: string
  /** 1-based resolved line (from the request or method scan). */
  line?: number
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
  const files = await walkJavaFiles(base)
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
      const simpleName = pkgSegs[pkgSegs.length - 1]
      return { ok: false, reason: `未找到 ${simpleName}.java（类名含缩写包名，已按文件名匹配）` }
    }
    return { ok: false, reason: `未找到 ${className} 的源文件（可能在依赖 jar 中）` }
  }

  // File-name lookup (stack frame without a resolvable FQCN, or (Foo.java:45)).
  if (file !== undefined) {
    for (const base of bases) {
      const files = await walkJavaFiles(base)
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
    return { ok: false, reason: `未找到 ${file} 源文件` }
  }

  return { ok: false, reason: '缺少 className 或 file' }
}