import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fullProviderString } from "./shared/blacklist";
import { blacklistSettings } from "./shared/blacklist";
import {
  applyFolderDeny,
  forbiddenPathsFor,
  isProviderBlocked,
  matchingRules,
  readRules,
  resolveProject,
} from "./server/blacklist";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(blacklistSettings);

  server.addHook("agent.create.before", async ({ request }, ctx) => {
    const rules = (await readRules(settings)).rules;
    if (!Object.keys(rules).length) return request;
    const cfg: any = (request as any)?.config ?? {};
    const provider: string = cfg.provider ?? "";
    const model: string | null = cfg.model ?? null;
    const cwd: string = cfg.cwd ?? "";
    const paseo: any = (ctx as any)?.paseo;
    const res = await resolveProject(paseo, { workspaceId: (request as any).workspaceId ?? null, cwd });
    const full = fullProviderString(provider, model);
    console.log(
      `[project-model-blacklist] create provider=${full} project=${res.projectId ?? "?"} dir=${res.directory ?? cwd}`,
    );
    const matches = matchingRules(rules, res, cwd);
    if (matches.length && isProviderBlocked(matches, provider, model)) {
      console.log(`[project-model-blacklist] create BLOCKED ${full} project=${res.displayName ?? res.projectId}`);
      throw new Error("modello blacklistato per questo project");
    }
    const forbidden = forbiddenPathsFor(rules, provider, model).filter(
      (p) => !cwd || !p || cwd.replace(/\\/g, "/").toLowerCase() !== p.replace(/\\/g, "/").toLowerCase(),
    );
    if (!forbidden.length) return request;
    return {
      ...request,
      config: {
        ...request.config,
        providerOptions: applyFolderDeny(full, cwd, forbidden, (request.config as any)?.providerOptions),
      },
      env: { ...request.env },
    };
  });

  server.addHook("agent.open.before", async ({ request }, ctx) => {
    const rules = (await readRules(settings)).rules;
    if (!Object.keys(rules).length) return request;
    const req: any = request as any;
    const provider: string = req?.provider ?? "";
    const cwd: string = req?.cwd ?? "";
    const reason: string = req?.reason ?? "";
    const paseo: any = (ctx as any)?.paseo;
    // open prima della create non ha model nel request: lo legge dall'agente salvato
    const res = await resolveProject(paseo, {
      workspaceId: req?.workspaceId ?? null,
      agentId: req?.agentId ?? null,
      cwd,
      fetchModel: reason !== "create",
    });
    const full = fullProviderString(provider, res.model ?? null);
    console.log(
      `[project-model-blacklist] open(${reason}) provider=${full} project=${res.projectId ?? "?"} dir=${res.directory ?? cwd}`,
    );
    const matches = matchingRules(rules, res, cwd);
    if (matches.length && isProviderBlocked(matches, provider, res.model ?? null)) {
      console.log(`[project-model-blacklist] open BLOCKED ${full} project=${res.displayName ?? res.projectId}`);
      throw new Error("modello blacklistato per questo project");
    }
    const forbidden = forbiddenPathsFor(rules, provider, res.model ?? null);
    if (!forbidden.length) return request;
    return {
      ...request,
      appendSystemPrompt: [
        ...((request as any).appendSystemPrompt ?? []),
        `Vietato leggere/scrivere queste cartelle di altri project: ${forbidden.join(", ")}.`,
      ],
    };
  });

  return () => {};
}
