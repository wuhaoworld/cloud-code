import "server-only";

import { readFile } from "fs/promises";
import path from "path";

const INSTALLED_PLUGINS_PATH =
  "/Users/wuhao/.claude/plugins/installed_plugins.json";

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, PluginInstall[]>;
}

interface PluginInstall {
  scope?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: {
    name?: string;
    email?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

export interface InstalledPlugin {
  id: string;
  name: string;
  source: string;
  description: string;
  version: string;
  installPath: string;
  scope: string;
  author?: string;
  lastUpdated?: string;
}

function splitPluginId(id: string) {
  const atIndex = id.lastIndexOf("@");

  if (atIndex <= 0) {
    return { name: id, source: "local" };
  }

  return {
    name: id.slice(0, atIndex),
    source: id.slice(atIndex + 1),
  };
}

function pickCurrentInstall(installs: PluginInstall[]) {
  return installs.toSorted((current, next) => {
    const currentTime = Date.parse(current.lastUpdated ?? current.installedAt ?? "");
    const nextTime = Date.parse(next.lastUpdated ?? next.installedAt ?? "");

    return (Number.isNaN(nextTime) ? 0 : nextTime) -
      (Number.isNaN(currentTime) ? 0 : currentTime);
  })[0];
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readManifest(installPath?: string) {
  if (!installPath) {
    return null;
  }

  return readJsonFile<PluginManifest>(
    path.join(installPath, ".claude-plugin", "plugin.json")
  );
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const installedFile = await readJsonFile<InstalledPluginsFile>(
    INSTALLED_PLUGINS_PATH
  );
  const pluginEntries = Object.entries(installedFile?.plugins ?? {});

  const plugins = await Promise.all(
    pluginEntries.map(async ([id, installs]) => {
      const currentInstall = pickCurrentInstall(installs);
      const manifest = await readManifest(currentInstall?.installPath);
      const fallback = splitPluginId(id);

      return {
        id,
        name: manifest?.name ?? fallback.name,
        source: fallback.source,
        description: manifest?.description ?? "暂无插件描述",
        version: manifest?.version ?? currentInstall?.version ?? "unknown",
        installPath: currentInstall?.installPath ?? "",
        scope: currentInstall?.scope ?? "user",
        author: manifest?.author?.name,
        lastUpdated: currentInstall?.lastUpdated,
      } satisfies InstalledPlugin;
    })
  );

  return plugins.sort((current, next) => current.name.localeCompare(next.name));
}
