import "server-only";

import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const INSTALLED_PLUGINS_PATH = path.join(
  os.homedir(),
  ".claude",
  "plugins",
  "installed_plugins.json"
);
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, PluginInstall[]>;
}

interface ClaudeSettingsFile {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
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
  displayName?: string;
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
  skills?: string | string[];
  commands?: string | string[];
}

interface SkillManifest {
  name?: string;
  description?: string;
}

interface ResolvedContentPath {
  path: string;
  isDirectoryCollection: boolean;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  displayName: string;
  source: string;
  description: string;
  version: string;
  installPath: string;
  scope: string;
  author?: string;
  homepage?: string;
  repository?: string;
  lastUpdated?: string;
  enabled: boolean;
}

export interface PluginSkill {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface PluginCommand {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface PluginMcpServer {
  id: string;
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  toolTitles: string[];
}

type McpServerConfig = {
  command?: unknown;
  args?: unknown;
  type?: unknown;
  url?: unknown;
  _meta?: {
    ideToolTitles?: unknown;
  };
};

type McpConfigFile =
  | Record<string, McpServerConfig | unknown>
  | {
      mcpServers?: Record<string, McpServerConfig | unknown>;
    };

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

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function getEnabledPlugins(): Promise<Record<string, boolean>> {
  const settings = await readJsonFile<ClaudeSettingsFile>(CLAUDE_SETTINGS_PATH);

  return settings?.enabledPlugins ?? {};
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const settings =
    (await readJsonFile<ClaudeSettingsFile>(CLAUDE_SETTINGS_PATH)) ?? {};

  settings.enabledPlugins = {
    ...(settings.enabledPlugins ?? {}),
    [id]: enabled,
  };

  await writeJsonFile(CLAUDE_SETTINGS_PATH, settings);

  return settings.enabledPlugins;
}

async function readManifest(installPath?: string) {
  if (!installPath) {
    return null;
  }

  return readJsonFile<PluginManifest>(
    path.join(installPath, ".claude-plugin", "plugin.json")
  );
}

function hasDirectorySuffix(pathValue: string): boolean {
  return pathValue.endsWith("/") || pathValue.endsWith("\\");
}

function parsePathConfig(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

async function resolvePluginContentPaths(
  plugin: InstalledPlugin,
  field: "skills" | "commands",
  fallbackDirName: string
): Promise<ResolvedContentPath[]> {
  const manifest = await readManifest(plugin.installPath);

  if (manifest && Object.hasOwn(manifest, field)) {
    const configured = parsePathConfig(manifest[field]);

    return configured.map((configuredPath) => ({
      path: path.resolve(plugin.installPath, configuredPath),
      isDirectoryCollection: hasDirectorySuffix(configuredPath),
    }));
  }

  return [
    {
      path: path.join(plugin.installPath, fallbackDirName),
      isDirectoryCollection: true,
    },
  ];
}

async function readSkillMetadataFromFile(
  filePath: string,
  fallbackName: string
): Promise<PluginSkill | null> {
  const skillFile = await readFile(filePath, "utf8").catch(() => "");

  if (!skillFile) {
    return null;
  }

  const manifest = parseSkillFrontmatter(skillFile);
  const skillDisplayPath =
    path.basename(filePath).toUpperCase() === "SKILL.MD"
      ? path.dirname(filePath)
      : filePath;

  return {
    id: fallbackName,
    name: manifest.name ?? fallbackName,
    description: manifest.description ?? "暂无 Skill 描述",
    path: skillDisplayPath,
  };
}

async function readSkillFromPath(skillPath: string): Promise<PluginSkill | null> {
  const skillStat = await stat(skillPath).catch(() => null);

  if (!skillStat) {
    return null;
  }

  if (skillStat.isDirectory()) {
    const skillName = path.basename(skillPath);

    return readSkillMetadataFromFile(
      path.join(skillPath, "SKILL.md"),
      skillName
    );
  }

  if (skillStat.isFile()) {
    const fileName = path.basename(skillPath);
    const skillName =
      fileName.toUpperCase() === "SKILL.MD"
        ? path.basename(path.dirname(skillPath))
        : fileName.replace(path.extname(fileName), "");

    return readSkillMetadataFromFile(skillPath, skillName);
  }

  return null;
}

async function readCommandMetadataFromFile(
  filePath: string,
  fallbackName: string
): Promise<PluginCommand | null> {
  const content = await readFile(filePath, "utf8").catch(() => "");

  if (!content) {
    return null;
  }

  const manifest = parseSkillFrontmatter(content);

  return {
    id: fallbackName,
    name: manifest.name ?? fallbackName,
    description: manifest.description ?? "暂无命令描述",
    path: filePath,
  };
}

async function readCommandFromPath(commandPath: string): Promise<PluginCommand | null> {
  const commandStat = await stat(commandPath).catch(() => null);

  if (!commandStat) {
    return null;
  }

  if (commandStat.isFile()) {
    const commandName = path.basename(commandPath).replace(path.extname(commandPath), "");

    return readCommandMetadataFromFile(commandPath, commandName);
  }

  if (commandStat.isDirectory()) {
    const defaultFile = path.join(commandPath, "README.md");
    const defaultCommand = await readCommandMetadataFromFile(
      defaultFile,
      path.basename(commandPath)
    );

    if (defaultCommand) {
      return defaultCommand;
    }

    const entries = await readdir(commandPath, { withFileTypes: true }).catch(() => []);
    const firstMd = entries.find(
      (entry) => entry.isFile() && entry.name.endsWith(".md")
    );

    if (!firstMd) {
      return null;
    }

    const filePath = path.join(commandPath, firstMd.name);
    const commandName = firstMd.name.replace(/\.md$/, "");

    return readCommandMetadataFromFile(filePath, commandName);
  }

  return null;
}

function parseSkillFrontmatter(content: string): SkillManifest {
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    return {};
  }

  return match[1].split("\n").reduce<SkillManifest>((manifest, line) => {
    const separatorIndex = line.indexOf(":");

    if (separatorIndex <= 0) {
      return manifest;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['\"]|['\"]$/g, "");

    if (key === "name") {
      manifest.name = value;
    }

    if (key === "description") {
      manifest.description = value;
    }

    return manifest;
  }, {});
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const [installedFile, enabledPlugins] = await Promise.all([
    readJsonFile<InstalledPluginsFile>(INSTALLED_PLUGINS_PATH),
    getEnabledPlugins(),
  ]);
  const pluginEntries = Object.entries(installedFile?.plugins ?? {});

  const plugins = await Promise.all(
    pluginEntries.map(async ([id, installs]) => {
      const currentInstall = pickCurrentInstall(installs);
      const manifest = await readManifest(currentInstall?.installPath);
      const fallback = splitPluginId(id);

      return {
        id,
        name: manifest?.name ?? fallback.name,
        displayName: manifest?.displayName ?? manifest?.name ?? fallback.name,
        source: fallback.source,
        description: manifest?.description ?? "暂无插件描述",
        version: manifest?.version ?? currentInstall?.version ?? "unknown",
        installPath: currentInstall?.installPath ?? "",
        scope: currentInstall?.scope ?? "user",
        author: manifest?.author?.name,
        homepage: manifest?.homepage,
        repository: manifest?.repository,
        lastUpdated: currentInstall?.lastUpdated,
        enabled: enabledPlugins[id] === true,
      } satisfies InstalledPlugin;
    })
  );

  return plugins.sort((current, next) => current.name.localeCompare(next.name));
}

export async function getInstalledPlugin(id: string) {
  const plugins = await getInstalledPlugins();

  return plugins.find((plugin) => plugin.id === id) ?? null;
}

export async function getPluginSkills(plugin: InstalledPlugin): Promise<PluginSkill[]> {
  if (!plugin.installPath) {
    return [];
  }

  const skillsPaths = await resolvePluginContentPaths(plugin, "skills", "skills");

  try {
    const skills = await Promise.all(
      skillsPaths.map(async (skillsPathConfig) => {
        if (skillsPathConfig.isDirectoryCollection) {
          const entries = await readdir(skillsPathConfig.path, {
            withFileTypes: true,
          }).catch(() => []);
          const skillDirs = entries.filter((entry) => entry.isDirectory());

          const skillItems = await Promise.all(
            skillDirs.map((entry) =>
              readSkillFromPath(path.join(skillsPathConfig.path, entry.name))
            )
          );

          return skillItems.filter((item): item is PluginSkill => item !== null);
        }

        const singleSkill = await readSkillFromPath(skillsPathConfig.path);

        return singleSkill ? [singleSkill] : [];
      })
    );

    return Array.from(new Map(skills.flat().map((skill) => [skill.path, skill])).values())
      .sort((current, next) => current.name.localeCompare(next.name));
  } catch {
    return [];
  }
}

export async function getPluginCommands(plugin: InstalledPlugin): Promise<PluginCommand[]> {
  if (!plugin.installPath) {
    return [];
  }

  const commandsPaths = await resolvePluginContentPaths(
    plugin,
    "commands",
    "commands"
  );

  try {
    const commands = await Promise.all(
      commandsPaths.map(async (commandPathConfig) => {
        if (commandPathConfig.isDirectoryCollection) {
          const entries = await readdir(commandPathConfig.path, {
            withFileTypes: true,
          }).catch(() => []);
          const commandFiles = entries.filter(
            (entry) => entry.isFile() && entry.name.endsWith(".md")
          );

          const commandItems = await Promise.all(
            commandFiles.map((entry) =>
              readCommandFromPath(path.join(commandPathConfig.path, entry.name))
            )
          );

          return commandItems.filter((item): item is PluginCommand => item !== null);
        }

        const singleCommand = await readCommandFromPath(commandPathConfig.path);

        return singleCommand ? [singleCommand] : [];
      })
    );

    return Array.from(
      new Map(commands.flat().map((command) => [command.path, command])).values()
    )
      .sort((current, next) => current.name.localeCompare(next.name));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMcpServer(id: string, config: unknown): PluginMcpServer | null {
  if (!isRecord(config)) {
    return null;
  }

  const meta = isRecord(config._meta) ? config._meta : null;
  const ideToolTitles = isRecord(meta?.ideToolTitles)
    ? meta.ideToolTitles
    : null;
  const toolTitles = ideToolTitles
    ? Object.values(ideToolTitles).filter(
        (title): title is string => typeof title === "string"
      )
    : [];

  return {
    id,
    command: typeof config.command === "string" ? config.command : undefined,
    args: Array.isArray(config.args)
      ? config.args.filter((arg): arg is string => typeof arg === "string")
      : undefined,
    type: typeof config.type === "string" ? config.type : undefined,
    url: typeof config.url === "string" ? config.url : undefined,
    toolTitles,
  };
}

export async function getPluginMcpServers(
  plugin: InstalledPlugin
): Promise<PluginMcpServer[]> {
  if (!plugin.installPath) {
    return [];
  }

  const mcpConfig = await readJsonFile<McpConfigFile>(
    path.join(plugin.installPath, ".mcp.json")
  );

  if (!mcpConfig || !isRecord(mcpConfig)) {
    return [];
  }

  const serverEntries = isRecord(mcpConfig.mcpServers)
    ? Object.entries(mcpConfig.mcpServers)
    : Object.entries(mcpConfig);

  return serverEntries
    .map(([id, config]) => normalizeMcpServer(id, config))
    .filter((server): server is PluginMcpServer => server !== null)
    .sort((current, next) => current.id.localeCompare(next.id));
}
