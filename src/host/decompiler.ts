/**
 * Decompiler support: when a logged class has no source file in the
 * workspace, resolve its `.class` bytes — from compiled output, a project
 * dependency jar, or the local Maven repository — and decompile them with
 * CFR. The CFR jar is downloaded once into `~/.dsh/cfr.jar`; decompiled
 * sources are cached under `<workspace>/.dsh/decompiled/` keyed by a hash
 * of the class source, so they refresh when the dependency changes.
 * @module dsh-better-sidebar-starter/host/decompiler
 */

import { readFile, writeFile, mkdir, readdir, stat, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, basename, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** One parsed ZIP central-directory record. */
interface ZipEntryMeta {
  name: string
  method: number // 0 = stored, 8 = deflate
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

const ZIP_EOCD = 0x06054b50
const ZIP_CD = 0x02014b50
const ZIP_LOCAL = 0x04034b50

/** Walk a directory tree collecting *.jar paths (bounded depth/count). */
export async function walkJars(root: string, opts: { depth?: number; cap?: number } = {}): Promise<string[]> {
  const { depth = 8, cap = 500 } = opts
  const out: string[] = []
  const skipped = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.gradle', '.cache', '.dsh'])
  const stack: Array<{ dir: string; d: number }> = [{ dir: root, d: 0 }]
  while (stack.length > 0 && out.length < cap) {
    const { dir, d } = stack.pop()!
    if (d > depth) continue
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!skipped.has(e.name)) stack.push({ dir: full, d: d + 1 })
      } else if (e.isFile() && e.name.endsWith('.jar')) {
        out.push(full)
        if (out.length >= cap) return out
      }
    }
  }
  return out
}

/** Parse a jar's central directory into entry metadata (lightweight — only
 *  the tail + central directory are read, entry data is not touched). */
async function listZipEntries(jarPath: string): Promise<ZipEntryMeta[]> {
  const fd = await open(jarPath, 'r')
  try {
    const size = (await fd.stat()).size
    if (size < 22) return []

    // Locate the End-Of-Central-Directory record in the last 64 KiB.
    const tailLen = Math.min(size, 65557)
    const tail = Buffer.alloc(tailLen)
    await fd.read(tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === ZIP_EOCD) { eocd = i; break }
    }
    if (eocd < 0) return []

    const cdOffset = tail.readUInt32LE(eocd + 16)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const totalEntries = tail.readUInt16LE(eocd + 10)
    if (cdOffset + cdSize > size || totalEntries > 200_000) return []

    const cd = Buffer.alloc(cdSize)
    await fd.read(cd, 0, cdSize, cdOffset)
    const entries: ZipEntryMeta[] = []
    let pos = 0
    for (let n = 0; n < totalEntries && pos + 46 <= cdSize; n++) {
      if (cd.readUInt32LE(pos) !== ZIP_CD) break
      const method = cd.readUInt16LE(pos + 10)
      const compressedSize = cd.readUInt32LE(pos + 20)
      const uncompressedSize = cd.readUInt32LE(pos + 24)
      const nameLen = cd.readUInt16LE(pos + 28)
      const extraLen = cd.readUInt16LE(pos + 30)
      const commentLen = cd.readUInt16LE(pos + 32)
      const localOffset = cd.readUInt32LE(pos + 42)
      const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen)
      entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
      pos += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    await fd.close()
  }
}

/** Extract one entry's bytes from a jar (stored or deflate). */
async function readZipEntry(jarPath: string, meta: ZipEntryMeta): Promise<Buffer> {
  const fd = await open(jarPath, 'r')
  try {
    const header = Buffer.alloc(30)
    await fd.read(header, 0, 30, meta.localOffset)
    if (header.readUInt32LE(0) !== ZIP_LOCAL) throw new Error(`bad local header for ${meta.name}`)
    const nameLen = header.readUInt16LE(26)
    const extraLen = header.readUInt16LE(28)
    const dataStart = meta.localOffset + 30 + nameLen + extraLen
    const raw = Buffer.alloc(meta.compressedSize)
    await fd.read(raw, 0, meta.compressedSize, dataStart)
    if (meta.method === 0) return raw
    if (meta.method === 8) return inflateRawSync(raw)
    throw new Error(`unsupported zip method ${meta.method} in ${basename(jarPath)}`)
  } finally {
    await fd.close()
  }
}

/** Look for `classRelPath` (e.g. "com/example/Foo.class") inside one jar. */
async function classBytesFromJar(jarPath: string, classRelPath: string): Promise<Buffer | null> {
  try {
    const entries = await listZipEntries(jarPath)
    const hit = entries.find((e) => e.name === classRelPath)
    if (hit === undefined) return null
    return await readZipEntry(jarPath, hit)
  } catch {
    return null
  }
}

/** Concurrent mapper with in-flight cap; keeps the event loop cooperative. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Search a list of jars for a class. Returns the jar path + bytes, or null.
 */
export async function findClassInJars(jars: string[], classRelPath: string): Promise<{ jar: string; bytes: Buffer } | null> {
  const results = await mapLimit(jars, 10, async (jar) => {
    const bytes = await classBytesFromJar(jar, classRelPath)
    return bytes !== null ? { jar, bytes } : null
  })
  return results.find((r) => r !== null) ?? null
}

/** In-process cache of known jar locations to avoid re-scanning the local
 *  repository on every click within one host session. */
let localRepoJars: string[] | null = null

export function resetLocalRepoCache(): void {
  localRepoJars = null
}

/** Locate the local Maven + Gradle repositories (the user-global jars). */
async function userRepoJars(): Promise<string[]> {
  if (localRepoJars !== null) return localRepoJars
  const roots: string[] = []
  const m2 = join(os.homedir(), '.m2', 'repository')
  const gradle = join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1')
  for (const r of [m2, gradle]) {
    try {
      await stat(r)
      roots.push(r)
    } catch {
      /* repo absent */
    }
  }
  const jars: string[] = []
  for (const root of roots) {
    jars.push(...await walkJars(root, { depth: 24, cap: 20000 }))
  }
  localRepoJars = jars
  return jars
}

// ---- Persistent repo class-prefix index ----
// Speeds up "which jar owns this class" across host restarts: instead of
// scanning the m2 package subtree on every cold click (or all 6k+ jars on
// a full fallback), load a disk index that maps package prefixes → jars.
// The index is built once in the background after the first lookup that
// found no disk index; while it builds, the old subtree/full scans still
// serve queries, and once written every later session loads it in ms.
interface M2JarIndexEntry {
  p: string // jar absolute path
  m: number // mtimeMs at index time
  s: number // size at index time
  pre: string[] // up to 8 most-frequent package prefixes
}
interface M2ClassIndex {
  v: 1
  scannedAt: number
  jars: M2JarIndexEntry[]
}
type M2Lookup = Map<string, Array<{ jar: string; m: number; s: number }>>

const M2_INDEX_VERSION = 1 as const
const M2_INDEX_FILE = (): string => join(os.homedir(), '.dsh', 'm2-index.json')

let m2Lookup: M2Lookup | null = null
let m2IndexTried = false
let m2BuildStarted = false

function buildM2Lookup(jars: M2JarIndexEntry[]): M2Lookup {
  const map: M2Lookup = new Map()
  for (const j of jars) {
    for (const pre of j.pre) {
      const list = map.get(pre)
      if (list === undefined) map.set(pre, [{ jar: j.p, m: j.m, s: j.s }])
      else list.push({ jar: j.p, m: j.m, s: j.s })
    }
  }
  return map
}

/** Most frequent package prefixes of a jar's .class entries (bounded). */
function prefixesOf(entries: ZipEntryMeta[]): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    if (!e.name.endsWith('.class')) continue
    const parts = dirname(e.name).split('/').filter(Boolean)
    if (parts.length === 0) continue
    const p = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
    counts.set(p, (counts.get(p) ?? 0) + 1)
    if (counts.size > 64) break // memory bound for huge jars
  }
  if (counts.size === 0) return []
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p)
}

/** Load the disk index (once). Returns null when absent/corrupt. */
async function loadM2Index(): Promise<M2Lookup | null> {
  try {
    const raw = await readFile(M2_INDEX_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as M2ClassIndex
    if (parsed.v !== M2_INDEX_VERSION || !Array.isArray(parsed.jars)) return null
    return buildM2Lookup(parsed.jars)
  } catch {
    return null
  }
}

/** Build the index in the background and persist it. */
async function buildM2Index(): Promise<void> {
  if (m2BuildStarted) return
  m2BuildStarted = true
  try {
    const jars = await userRepoJars()
    const entries = await mapLimit(jars, 8, async (jar): Promise<M2JarIndexEntry | null> => {
      try {
        const [st, zip] = await Promise.all([stat(jar), listZipEntries(jar)])
        return { p: jar, m: st.mtimeMs, s: st.size, pre: prefixesOf(zip) }
      } catch {
        return null
      }
    })
    const clean = entries.filter((e): e is M2JarIndexEntry => e !== null && e.pre.length > 0)
    m2Lookup = buildM2Lookup(clean)
    try {
      await mkdir(dirname(M2_INDEX_FILE()), { recursive: true })
      const idx: M2ClassIndex = { v: M2_INDEX_VERSION, scannedAt: Date.now(), jars: clean }
      await writeFile(M2_INDEX_FILE(), JSON.stringify(idx), 'utf8')
    } catch { /* index persistence is best-effort */ }
  } catch { /* index build failure must not break lookups */ }
}

/** Get the prefix index: disk index when available, otherwise kick a
 *  background build and return null (caller falls back to direct scans). */
async function getM2Index(): Promise<M2Lookup | null> {
  if (m2Lookup !== null) return m2Lookup
  if (!m2IndexTried) {
    m2IndexTried = true
    const loaded = await loadM2Index()
    if (loaded !== null) {
      m2Lookup = loaded
      return m2Lookup
    }
  }
  void buildM2Index()
  return null
}

/**
 * Search the user-global dependency repositories for a class (path key,
 * e.g. "org/springframework/orm/SessionFactory.class").
 *
 * Inside one session the prefix index (memory or disk-backed) answers in
 * milliseconds; on the very first cold startup while the index is still
 * being built we fall back to the package-subtree scans (group prefix
 * acceleration), then to a full(ish) scan whose jar list is cached.
 */
export async function findClassInUserRepos(classRelPath: string): Promise<{ jar: string; bytes: Buffer } | null> {
  const m2 = join(os.homedir(), '.m2', 'repository')
  const pkgDirs = dirname(classRelPath).split('/').filter(Boolean)

  // 1) Prefix index (normal fast path).
  const idx = await getM2Index()
  if (idx !== null) {
    const prefixes = pkgDirs.length >= 2
      ? [`${pkgDirs[0]}/${pkgDirs[1]}`, pkgDirs[0]]
      : pkgDirs.length === 1
        ? [pkgDirs[0]]
        : []
    for (const prefix of prefixes) {
      const hits = idx.get(prefix)
      if (hits === undefined || hits.length === 0) continue
      const live: string[] = []
      for (const h of hits.slice(0, 5)) {
        try {
          const st = await stat(h.jar)
          if (st.mtimeMs === h.m && st.size === h.s) live.push(h.jar)
        } catch { /* jar disappeared */ }
      }
      if (live.length === 0) continue
      const hit = await findClassInJars(live, classRelPath)
      if (hit !== null) return hit
    }
  }

  // 2) Package-prefix subtree scan: narrower prefixes are tried on miss.
  for (let i = pkgDirs.length; i >= 1; i--) {
    const prefix = pkgDirs.slice(0, i).join(sep)
    const candidates = await walkJars(join(m2, prefix), { depth: 8, cap: 800 })
    if (candidates.length === 0) continue
    const hit = await findClassInJars(candidates, classRelPath)
    if (hit !== null) return hit
  }

  // 3) Full-repo fallback (jar list cached in-process; the first lookup
  //    after a host restart may take a while on a cold OS cache).
  const jars = await userRepoJars()
  return await findClassInJars(jars, classRelPath)
}

// ---- CFR (decompiler) management ----

function cfrCachePath(): string {
  return join(os.homedir(), '.dsh', 'cfr.jar')
}

/** Resolve the java executable (JAVA_HOME first, then PATH). */
function resolveJavaExecutable(): string | null {
  const home = process.env.JAVA_HOME?.trim()
  if (home) {
    const exe = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (existsSync(exe)) return exe
  }
  return 'java'
}

/** Ensure the CFR decompiler jar exists locally (downloads once if absent). */
export async function ensureCfrJar(): Promise<string | null> {
  const cache = cfrCachePath()
  try {
    await stat(cache)
    return cache
  } catch {
    /* missing — download */
  }
  const url = 'https://repo1.maven.org/maven2/org/benf/cfr/0.152/cfr-0.152.jar'
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const bytes = Buffer.from(await resp.arrayBuffer())
    await mkdir(dirname(cache), { recursive: true })
    await writeFile(cache, bytes)
    return cache
  } catch {
    return null
  }
}

/**
 * Decompile class bytes with CFR. `simpleName` is the class's simple name.
 * Returns the Java source text, or null on failure.
 */
export async function decompileClassBytes(bytes: Buffer, simpleName: string): Promise<string | null> {
  const javaExe = resolveJavaExecutable()
  if (javaExe === null) return null
  const cfrJar = await ensureCfrJar()
  if (cfrJar === null) return null

  const tmpDir = join(os.tmpdir(), 'dsh-starter-decomp')
  await mkdir(tmpDir, { recursive: true })
  const tmpClass = join(tmpDir, `${simpleName.replace(/[^A-Za-z0-9_$]/g, '_')}.class`)
  await writeFile(tmpClass, bytes)

  try {
    const { stdout } = await execFileAsync(javaExe, ['-Dfile.encoding=UTF-8', '-jar', cfrJar, tmpClass], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    })
    return stdout.trim() === '' ? null : stdout
  } catch {
    return null
  }
}

/** Fingerprint of a class source (path + mtime + size → short hash). */
async function sourceFingerprint(path: string, extra: string): Promise<string> {
  try {
    const s = await stat(path)
    return createHash('sha1').update(`${path}|${s.mtimeMs}|${s.size}|${extra}`).digest('hex').slice(0, 12)
  } catch {
    return createHash('sha1').update(`${path}|${extra}|${Date.now()}`).digest('hex').slice(0, 12)
  }
}

/**
 * Cached decompile pipeline: resolves class bytes (project jar or user
 * repo), fingerprints the source, reuses `<ws>/.dsh/decompiled/*.java`
 * when unchanged, otherwise runs CFR and writes the decompiled source.
 * Returns the .java path or null.
 */
export async function decompileClassToFile(
  workspace: string,
  classRelPath: string,
  source: { kind: 'file'; path: string } | { kind: 'jar'; jar: string; bytes: Buffer },
): Promise<string | null> {
  const simpleName = basename(classRelPath).replace(/\.class$/, '')
  const pkgDir = dirname(classRelPath)

  const fp = source.kind === 'file'
    ? await sourceFingerprint(source.path, '')
    : await sourceFingerprint(source.jar, `jar`)

  const outDir = join(workspace, '.dsh', 'decompiled', pkgDir)
  const outFile = join(outDir, `${simpleName}.${fp}.java`)
  const plain = join(outDir, `${simpleName}.java`)
  try {
    await stat(outFile)
    // Cached hit — make sure the convenience plain copy exists as well.
    try {
      await stat(plain)
    } catch {
      await mkdir(outDir, { recursive: true })
      await writeFile(plain, await readFile(outFile), 'utf8')
    }
    return plain
  } catch {
    /* decompile below */
  }

  const bytes = source.kind === 'file' ? await readFile(source.path) : source.bytes
  const text = await decompileClassBytes(bytes, simpleName)
  if (text === null) return null

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, text, 'utf8')
  // Also write the user-facing name without the fingerprint (symlink-less
  // duplicate) so the editor title reads naturally.
  try {
    await writeFile(plain, text, 'utf8')
  } catch {
    /* optional convenience copy */
  }
  return plain
}

/** Collect the module's public helpers for tests. */
export const _internal = { listZipEntries, readZipEntry, walkJars }