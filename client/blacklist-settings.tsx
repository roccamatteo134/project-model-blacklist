import { usePaseo, useSettings, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { blacklistSettings } from "../shared/blacklist";
import { strings } from "./strings";

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

type ProjectEntry = { id: string; name?: string; directory?: string };
type ProviderGroup = { provider: string; models: string[] };

// ponytail: validazione sintattica, la verifica esistenza resta al daemon negli hook
function isValidPath(p: string): boolean {
  const t = (p ?? "").trim();
  if (!t || t.length > 32767) return false;
  // eslint-disable-next-line no-control-regex
  if (/[<>\"|?*\x00-\x1F]/.test(t)) return false;
  return /^[A-Za-z]:[\\/]/.test(t) || /^\\\\/.test(t) || /^\//.test(t);
}

function projectLabel(p: ProjectEntry): string {
  return p.name ?? p.id;
}

export function BlacklistSettings({ theme, layout }: PluginSurfaceProps) {
  const { t } = useTranslation(strings);
  const settings = useSettings(blacklistSettings);
  const paseo = usePaseo();
  const [targets, setTargets] = useState<string[]>([]);
  const [blockedModels, setBlockedModels] = useState<string[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [pathDraft, setPathDraft] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);

  const projectsQuery = useQuery({
    queryKey: ["blacklist-projects"],
    queryFn: async (): Promise<ProjectEntry[]> => {
      const api: any = paseo as any;
      try {
        const res = await api.projects.list();
        const entries = Array.isArray(res) ? res : (res?.projects ?? res?.entries ?? []);
        const out: ProjectEntry[] = [];
        for (const p of entries) {
          const id = p?.projectId ?? p?.id;
          if (id) out.push({ id: String(id), name: p.projectCustomName ?? p.projectDisplayName ?? p.name ?? p.title, directory: p.projectRootPath ?? p.path ?? p.directory ?? p.cwd });
        }
        if (out.length > 0) return out;
      } catch {
        // fallback sotto
      }
      const res = await api.workspaces.list({ page: { limit: 100 } });
      const entries = Array.isArray(res) ? res : (res?.entries ?? []);
      const seen = new Map<string, ProjectEntry>();
      for (const w of entries) {
        const pid = w?.projectId ?? w?.project?.id;
        if (!pid || seen.has(String(pid))) continue;
        seen.set(String(pid), { id: String(pid), name: w?.projectName ?? w?.project?.name, directory: w?.directory ?? w?.cwd });
      }
      return [...seen.values()];
    },
    staleTime: 30_000,
  });

  // ponytail: un solo snapshot provider, niente listModels per provider
  const modelsQuery = useQuery({
    queryKey: ["blacklist-models"],
    queryFn: async (): Promise<ProviderGroup[]> => {
      const api: any = paseo as any;
      const res = await api.providers.snapshot();
      const entries = Array.isArray(res) ? res : (res?.entries ?? []);
      const groups = new Map<string, Set<string>>();
      for (const e of entries) {
        const pid = e?.provider ?? e?.id;
        if (!pid || e?.status === "unavailable" || e?.status === "error") continue;
        const id = String(pid);
        if (!groups.has(id)) groups.set(id, new Set());
        const models = e?.models ?? [];
        for (const m of models) {
          const mid = typeof m === "string" ? m : (m?.id ?? m?.model);
          if (mid) groups.get(id)!.add(`${id}/${mid}`);
        }
      }
      return [...groups.entries()].map(([provider, set]) => ({ provider, models: [...set].sort() })).sort((a, b) => a.provider.localeCompare(b.provider));
    },
    staleTime: 60_000,
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, padding: layout.compact ? 16 : 24, backgroundColor: theme.colors.surface0, gap: 12 },
      title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "700" as const },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.surface2 },
      chipActive: { backgroundColor: theme.colors.accent },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      dropdown: { borderRadius: 8, backgroundColor: theme.colors.surface2, paddingVertical: 10, paddingHorizontal: 12 },
      saveBtn: { borderRadius: 8, backgroundColor: theme.colors.accent, paddingVertical: 10, paddingHorizontal: 16 },
      saveText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      ghostBtn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.colors.surface2 },
      providerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 10 },
      modelRow: { paddingVertical: 10, paddingLeft: 28 },
    }),
    [theme, layout.compact],
  );

  if (settings.status === "loading") {
    return (
      <View style={styles.screen}>
        <Text style={styles.muted}>{t("loading")}</Text>
      </View>
    );
  }
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>{t("unreadable")}</Text>
      </View>
    );
  }

  const rules = settings.values.rules ?? {};
  const projects = projectsQuery.data ?? [];
  const groups = modelsQuery.data ?? [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  function toggle(list: string[], id: string, set: (v: string[]) => void) {
    setMsg("");
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function toggleExpanded(provider: string) {
    setExpanded(expanded.includes(provider) ? expanded.filter((x) => x !== provider) : [...expanded, provider]);
  }

  function groupSelected(g: ProviderGroup): boolean {
    if (blockedModels.includes(g.provider)) return true;
    return g.models.length > 0 && g.models.every((m) => blockedModels.includes(m));
  }

  function toggleProvider(g: ProviderGroup) {
    setMsg("");
    if (groupSelected(g)) {
      setBlockedModels(blockedModels.filter((x) => x !== g.provider && !g.models.includes(x)));
    } else {
      // ponytail: provider intero = solo id provider, copre anche i modelli futuri
      setBlockedModels([...blockedModels.filter((x) => !g.models.includes(x)), g.provider]);
    }
  }

  function loadRule(key: string) {
    const r = rules[key];
    if (!r) return;
    setTargets([key]);
    setBlockedModels(r.blocked ?? []);
    setPaths(r.paths ?? []);
    setPathDraft("");
    setEnabled(r.enabled ?? true);
    setMsg("");
  }

  function commitPath() {
    const p = pathDraft.trim();
    if (!p) return;
    if (!isValidPath(p)) {
      setMsg(t("invalidPath"));
      return;
    }
    setMsg("");
    if (!paths.includes(p)) setPaths([...paths, p]);
    setPathDraft("");
  }

  function removePath(p: string) {
    setPaths(paths.filter((x) => x !== p));
  }

  // ponytail: un save cicla sui project selezionati e fa append, mai overwrite
  async function save() {
    if (targets.length === 0) {
      setMsg(t("selectProjectFirst"));
      return;
    }
    if (blockedModels.length === 0) {
      setMsg(t("selectModelFirst"));
      return;
    }
    const next = { ...rules };
    for (const pid of targets) {
      const prev = next[pid] ?? { enabled: true, blocked: [], providerRegex: "", modelRegex: "", paths: [] };
      next[pid] = {
        enabled,
        blocked: union(prev.blocked ?? [], blockedModels),
        providerRegex: prev.providerRegex ?? "",
        modelRegex: prev.modelRegex ?? "",
        paths: union(prev.paths ?? [], paths),
      };
    }
    const ok = await settings.save({ rules: next }, (settings as any).revision);
    setMsg(ok ? t("appended", { count: targets.length }) : t("saveFailed"));
  }

  async function removeSelected() {
    if (targets.length === 0) return;
    const next = { ...rules };
    for (const pid of targets) delete next[pid];
    const ok = await settings.save({ rules: next }, (settings as any).revision);
    setMsg(ok ? t("removed", { count: targets.length }) : t("removeFailed"));
    if (ok) setTargets([]);
  }

  const targetSummary = targets.length === 0 ? t("selectProject") : targets.map((id) => projectById.get(id)?.name ?? id).join(", ");
  // ponytail: provider intero (id nudo o tutti i modelli) collassa nel recap
  const modelSummary = (() => {
    if (blockedModels.length === 0) return t("selectModels");
    const selected = new Set(blockedModels);
    const parts: string[] = [];
    for (const g of groups) {
      if (!selected.has(g.provider) && !g.models.some((m) => selected.has(m))) continue;
      if (selected.has(g.provider) || (g.models.length > 0 && g.models.every((m) => selected.has(m)))) {
        parts.push(g.provider);
      } else {
        for (const m of g.models) if (selected.has(m)) parts.push(m);
      }
      selected.delete(g.provider);
      for (const m of g.models) selected.delete(m);
    }
    for (const x of blockedModels) if (selected.has(x)) parts.push(x);
    return parts.length > 0 ? parts.join(", ") : t("selectModels");
  })();

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t("title")}</Text>

      <SettingsSection title={t("savedRules")}>
        <View style={styles.row}>
          {Object.keys(rules).length === 0 ? <Text style={styles.muted}>{t("noRules")}</Text> : null}
          {Object.entries(rules).map(([k, r]) => (
            <Pressable key={k} accessibilityRole="button" style={[styles.chip, targets.includes(k) ? styles.chipActive : null]} onPress={() => loadRule(k)}>
              <Text style={styles.text}>{`${projectById.get(k)?.name ?? k} (${t("modelsCount", { count: (r.blocked ?? []).length })})`}</Text>
            </Pressable>
          ))}
        </View>
      </SettingsSection>

      <SettingsSection title={t("rule")}>
        <SettingsCard>
          <SettingsRow label={t("project")}>
            <Pressable accessibilityRole="button" style={styles.dropdown} onPress={() => setProjectOpen(true)}>
              <Text style={styles.text} numberOfLines={2}>{projectsQuery.isLoading ? t("loadingProjects") : targetSummary}</Text>
            </Pressable>
          </SettingsRow>
          <SettingsRow label={t("models")}>
            <Pressable accessibilityRole="button" style={styles.dropdown} onPress={() => setModelOpen(true)}>
              <Text style={styles.text} numberOfLines={2}>{modelsQuery.isLoading ? t("loadingModels") : modelSummary}</Text>
            </Pressable>
          </SettingsRow>
          <SettingsRow label={t("paths")}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={pathDraft}
                onChangeText={setPathDraft}
                placeholder={t("pathPlaceholder")}
                placeholderTextColor={theme.colors.foregroundMuted}
                onSubmitEditing={commitPath}
                style={{ flex: 1, color: theme.colors.foreground, backgroundColor: theme.colors.surface2, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12 }}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={t("addPath")} style={styles.chip} onPress={commitPath}>
                <Text style={styles.text}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>{paths.length === 0 ? t("noPaths") : t("pathsCount", { count: paths.length })}</Text>
            {paths.length > 0 ? (
              <View style={styles.row}>
                {paths.map((p) => (
                  <Pressable key={p} accessibilityRole="button" style={styles.chip} onPress={() => removePath(p)}>
                    <Text style={styles.text}>{`${p} ×`}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </SettingsRow>
          <SettingsSwitch label={t("enabled")} value={enabled} onValueChange={setEnabled} />
        </SettingsCard>
      </SettingsSection>

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable accessibilityRole="button" style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveText}>{t("save")}</Text>
        </Pressable>
        {targets.length > 0 ? (
          <Pressable accessibilityRole="button" style={styles.ghostBtn} onPress={removeSelected}>
            <Text style={styles.text}>{t("removeSelected")}</Text>
          </Pressable>
        ) : null}
      </View>
      {msg ? <Text style={styles.muted}>{msg}</Text> : null}

      <Modal title={t("selectProject")} open={projectOpen} onOpenChange={setProjectOpen}>
        <Modal.Content>
          <ScrollView>
            {projects.map((p) => (
              <Pressable key={p.id} accessibilityRole="checkbox" onPress={() => toggle(targets, p.id, setTargets)} style={{ paddingVertical: 10 }}>
                <Text style={styles.text}>{`${targets.includes(p.id) ? "☑" : "☐"} ${projectLabel(p)}`}</Text>
                {p.directory ? <Text style={styles.muted}>{p.directory}</Text> : null}
              </Pressable>
            ))}
            {projects.length === 0 && !projectsQuery.isLoading ? <Text style={styles.muted}>{t("noProjects")}</Text> : null}
          </ScrollView>
        </Modal.Content>
      </Modal>

      <Modal title={t("selectModels")} open={modelOpen} onOpenChange={setModelOpen}>
        <Modal.Content>
          <ScrollView>
            {groups.map((g) => {
              const open = expanded.includes(g.provider);
              return (
                <View key={g.provider}>
                  <View style={styles.providerRow}>
                    <Pressable accessibilityRole="checkbox" style={{ flex: 1 }} onPress={() => toggleProvider(g)}>
                      <Text style={styles.text}>{`${groupSelected(g) ? "☑" : "☐"} ${g.provider}`}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={g.provider} style={styles.chip} onPress={() => toggleExpanded(g.provider)}>
                      <Text style={styles.text}>{open ? "▾" : "▸"}</Text>
                    </Pressable>
                  </View>
                  {open
                    ? g.models.map((m) => (
                        <Pressable key={m} accessibilityRole="checkbox" onPress={() => toggle(blockedModels, m, setBlockedModels)} style={styles.modelRow}>
                          <Text style={styles.text}>{`${blockedModels.includes(m) ? "☑" : "☐"} ${m}`}</Text>
                        </Pressable>
                      ))
                    : null}
                </View>
              );
            })}
            {groups.length === 0 && !modelsQuery.isLoading ? <Text style={styles.muted}>{t("noProviders")}</Text> : null}
          </ScrollView>
        </Modal.Content>
      </Modal>
    </View>
  );
}
