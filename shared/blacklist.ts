import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const projectRuleSchema = z.object({
  enabled: z.boolean().default(true),
  // Voci tipo "opencode", "codex", "codex/gpt-5.5". Match esatto su provider o su "provider/model".
  blocked: z.array(z.string()).default([]),
  providerRegex: z.string().default(""),
  modelRegex: z.string().default(""),
  // Cartelle protette di questo project (usate per deny cross-project).
  paths: z.array(z.string()).default([]),
});

export type ProjectRule = z.infer<typeof projectRuleSchema>;

export const blacklistSettings = defineSettings({
  id: "blacklist",
  scope: "host",
  version: 1,
  schema: z.object({
    rules: z.record(z.string(), projectRuleSchema).default({}),
  }),
});

export type BlacklistValues = { rules: Record<string, ProjectRule> };

export function splitProvider(full: string): { provider: string; model: string } {
  const i = full.indexOf("/");
  if (i < 0) return { provider: full, model: "" };
  return { provider: full.slice(0, i), model: full.slice(i + 1) };
}

function safeRegex(source: string): RegExp | null {
  const s = (source ?? "").trim();
  if (!s) return null;
  try {
    return new RegExp(s);
  } catch {
    return null;
  }
}

// ponytail: match per prefisso su blocked, regex solo se valida (fail-open, log nel server)
export function ruleBlocksProvider(rule: ProjectRule, providerFull: string): boolean {
  if (!rule.enabled) return false;
  const full = providerFull.trim();
  if (!full) return false;
  const { provider } = splitProvider(full);
  for (const raw of rule.blocked ?? []) {
    const b = raw.trim();
    if (!b) continue;
    if (b === full || b === provider || full.startsWith(b + "/")) return true;
  }
  const prx = safeRegex(rule.providerRegex);
  if (prx && prx.test(provider)) return true;
  const mrx = safeRegex(rule.modelRegex);
  if (mrx && mrx.test(full)) return true;
  return false;
}

export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function pathStartsWith(cwd: string, base: string): boolean {
  const c = normalizePath(cwd);
  const b = normalizePath(base);
  if (!c || !b) return false;
  return c === b || c.startsWith(b + "/");
}

// provider e model viaggiano separati in AgentSessionConfig: li ricombina.
// Se il daemon passa gia il combinato, lo tiene.
export function fullProviderString(provider: string, model?: string | null): string {
  const p = (provider ?? "").trim();
  const m = (model ?? "").trim();
  if (!p) return m;
  if (!m) return p;
  if (p.includes("/")) return p;
  if (m === p || m.startsWith(p + "/")) return m;
  return `${p}/${m}`;
}

// match sia sul provider singolo che sul combinato: copre config split e combined
export function providerMatchesRule(rule: ProjectRule, provider: string, model?: string | null): boolean {
  const p = (provider ?? "").trim();
  const m = (model ?? "").trim();
  if (!p && !m) return false;
  if (p && ruleBlocksProvider(rule, p)) return true;
  const full = fullProviderString(p, m || null);
  if (full && full !== p && ruleBlocksProvider(rule, full)) return true;
  return false;
}
