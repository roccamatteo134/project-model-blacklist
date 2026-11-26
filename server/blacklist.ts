import {
  pathStartsWith,
  providerMatchesRule,
  type BlacklistValues,
  type ProjectRule,
} from "../shared/blacklist";

export type ResolvedProject = {
  projectId?: string;
  displayName?: string;
  rootPath?: string;
  directory?: string;
  model?: string | null;
};

export async function readRules(settings: { read(): Promise<any> }): Promise<BlacklistValues> {
  try {
    const cur = await settings.read();
    if (cur?.status === "ready") return cur.values as BlacklistValues;
  } catch (e) {
    console.error("[project-model-blacklist] settings.read failed", e);
  }
  return { rules: {} };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const to = new Promise<T>((res) => {
    t = setTimeout(() => res(fallback), ms);
  });
  return Promise.race([p, to]).finally(() => {
    if (t) clearTimeout(t);
  });
}

type ProjectDescriptor = { projectId: string; displayName?: string; customName?: string | null; rootPath?: string };

let projectsCache: { at: number; map: Map<string, ProjectDescriptor> } | null = null;

async function getProjectsMap(paseo: any): Promise<Map<string, ProjectDescriptor>> {
  if (paseo && projectsCache && Date.now() - projectsCache.at < 60_000) return projectsCache.map;
  const map = new Map<string, ProjectDescriptor>();
  try {
    const res = await withTimeout(paseo.projects.list(), 8000, null);
    const entries = Array.isArray(res) ? res : ((res as any)?.projects ?? (res as any)?.entries ?? []);
    for (const p of entries) {
      const id = p?.projectId ?? p?.id;
      if (!id) continue;
      map.set(String(id), {
        projectId: String(id),
        displayName: p?.projectCustomName ?? p?.projectDisplayName ?? p?.name,
        customName: p?.projectCustomName ?? null,
        rootPath: p?.projectRootPath ?? p?.path,
      });
    }
  } catch (e) {
    console.error("[project-model-blacklist] projects.list failed", e);
  }
  projectsCache = { at: Date.now(), map };
  return map;
}

// Risoluzione robusta: workspace refresh → agent refresh (project + model) →
// match cwd contro rootPath dei project noti. Key regola = projectId, ma matcha
// anche displayName (es. "KeyWeb" digitato a mano) e rootPath.
export async function resolveProject(
  paseo: any,
  opts: { workspaceId?: string | null; agentId?: string | null; cwd?: string; fetchModel?: boolean },
): Promise<ResolvedProject> {
  const out: ResolvedProject = { directory: opts.cwd };
  if (!paseo) return out;
  if (opts.workspaceId) {
    try {
      const snap: any = await withTimeout(paseo.workspaces.ref(opts.workspaceId).refresh(), 5000, null);
      const ws = snap?.workspace ?? snap;
      out.projectId = ws?.projectId ?? snap?.projectId ?? out.projectId;
      out.displayName = ws?.projectDisplayName ?? ws?.projectCustomName ?? out.displayName;
      out.directory = ws?.directory ?? ws?.cwd ?? out.directory;
    } catch (e) {
      console.error("[project-model-blacklist] workspace refresh failed", e);
    }
  }
  if (opts.agentId) {
    try {
      const res: any = await withTimeout(paseo.agents.ref(opts.agentId).refresh(), 5000, null);
      const ag = res?.agent ?? res;
      out.projectId = res?.project?.projectId ?? ag?.projectId ?? out.projectId;
      out.displayName = res?.project?.projectDisplayName ?? res?.project?.projectCustomName ?? out.displayName;
      out.rootPath = res?.project?.projectRootPath ?? out.rootPath;
      out.directory = ag?.cwd ?? ag?.workspace?.directory ?? out.directory;
      if (opts.fetchModel) out.model = ag?.model ?? ag?.config?.model ?? null;
    } catch (e) {
      console.error("[project-model-blacklist] agent refresh failed", e);
    }
  }
  try {
    const map = await getProjectsMap(paseo);
    const known = out.projectId ? map.get(out.projectId) : undefined;
    if (known) {
      out.displayName = out.displayName ?? known.displayName ?? known.customName ?? undefined;
      out.rootPath = out.rootPath ?? known.rootPath;
    }
    if (!out.projectId && out.directory) {
      for (const d of map.values()) {
        if (d.rootPath && pathStartsWith(out.directory, d.rootPath)) {
          out.projectId = d.projectId;
          out.displayName = d.displayName ?? d.customName ?? out.displayName;
          out.rootPath = d.rootPath;
          break;
        }
      }
    }
  } catch (e) {
    console.error("[project-model-blacklist] project map failed", e);
  }
  return out;
}

function keyMatchesProject(key: string, res: ResolvedProject): boolean {
  const k = key.trim();
  if (!k) return false;
  if (res.projectId && k === res.projectId) return true;
  const kl = k.toLowerCase();
  if (res.displayName && kl === res.displayName.toLowerCase()) return true;
  if (res.rootPath && (pathStartsWith(res.rootPath, k) || pathStartsWith(k, res.rootPath))) return true;
  // legacy: la key stessa e un path che contiene il cwd
  if (res.directory && pathStartsWith(res.directory, k)) return true;
  return false;
}

// Regole del project corrente: key === projectId/displayName/rootPath
// oppure una paths della regola contiene directory/cwd.
export function matchingRules(
  rules: BlacklistValues["rules"],
  res: ResolvedProject,
  cwd: string,
): Array<[string, ProjectRule]> {
  const out: Array<[string, ProjectRule]> = [];
  const dir = res.directory ?? cwd;
  for (const [key, rule] of Object.entries(rules ?? {})) {
    if (!(rule as ProjectRule)?.enabled) continue;
    if (keyMatchesProject(key, res)) {
      out.push([key, rule as ProjectRule]);
      continue;
    }
    for (const p of (rule as ProjectRule).paths ?? []) {
      if (p && dir && pathStartsWith(dir, p)) {
        out.push([key, rule as ProjectRule]);
        break;
      }
      if (p && cwd && pathStartsWith(cwd, p)) {
        out.push([key, rule as ProjectRule]);
        break;
      }
    }
  }
  return out;
}

export function isProviderBlocked(
  matches: Array<[string, ProjectRule]>,
  provider: string,
  model?: string | null,
): boolean {
  return matches.some(([, rule]) => providerMatchesRule(rule, provider, model));
}

// Tutte le paths protette dove questo provider/model e bannato (deny cross-project).
export function forbiddenPathsFor(
  rules: BlacklistValues["rules"],
  provider: string,
  model?: string | null,
): string[] {
  const set = new Map<string, string>();
  for (const rule of Object.values(rules ?? {})) {
    if (!(rule as ProjectRule)?.enabled) continue;
    if (!providerMatchesRule(rule as ProjectRule, provider, model)) continue;
    for (const p of (rule as ProjectRule).paths ?? []) {
      const t = (p ?? "").trim();
      if (t) set.set(t.toLowerCase(), t);
    }
  }
  return [...set.values()];
}

function denyMap(paths: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const p of paths) {
    const win = p.replace(/\\/g, "/");
    m[`${win}/**`] = "deny";
    m[`${win}**`] = "deny";
  }
  return m;
}

function asObject(v: unknown): Record<string, any> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  return null;
}

// ponytail: un solo punto di merge per provider, niente astrazioni per ogni tool
export function applyFolderDeny(providerFull: string, cwd: string, forbidden: string[], existing: any): any {
  if (!forbidden.length) return existing;
  const isOpenCode = providerFull === "opencode" || providerFull.startsWith("opencode/");
  const isClaude = providerFull === "claude" || providerFull.startsWith("claude/");
  const isCodex = providerFull === "codex" || providerFull.startsWith("codex/");
  const base = asObject(existing) ?? {};

  if (isOpenCode) {
    const perm = asObject(base.permission) ?? {};
    const deny = denyMap(forbidden);
    const mergeTarget = (v: unknown) => ({ ...deny, ...(asObject(v) ?? {}) });
    return {
      ...base,
      permission: {
        ...perm,
        read: mergeTarget(perm.read),
        edit: mergeTarget(perm.edit),
        glob: mergeTarget(perm.glob),
        grep: mergeTarget(perm.grep),
        list: mergeTarget(perm.list),
        // best-effort su bash: i pattern OpenCode matchano il comando
        bash: { ...Object.fromEntries(forbidden.map((p) => [`*${p}*`, "deny"] as const)), ...(asObject(perm.bash) ?? {}) },
      },
    };
  }
  if (isClaude) {
    const sandbox = asObject(base.sandbox) ?? {};
    const fs = asObject(sandbox.filesystem) ?? {};
    const prev = Array.isArray(fs.denyRead) ? fs.denyRead : [];
    return { ...base, sandbox: { ...sandbox, enabled: true, filesystem: { ...fs, denyRead: [...prev, ...forbidden] } } };
  }
  if (isCodex) {
    const roots = cwd ? [cwd] : [];
    const prev = asObject(base.sandbox_workspace_write) ?? {};
    return { ...base, sandbox_mode: "workspace-write", sandbox_workspace_write: { ...prev, writable_roots: roots } };
  }
  return existing;
}
