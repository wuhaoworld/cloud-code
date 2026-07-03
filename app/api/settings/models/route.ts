import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

interface ModelOption {
  name: string;
  id: string;
}

export async function GET() {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    const env = settings.env ?? {};

    const models: ModelOption[] = [];
    const seen = new Set<string>();

    const definitions: Array<{
      idKey: string;
      nameKey?: string;
    }> = [
      {
        idKey: "ANTHROPIC_DEFAULT_SONNET_MODEL",
        nameKey: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
      },
      {
        idKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        nameKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
      },
      {
        idKey: "ANTHROPIC_DEFAULT_OPUS_MODEL",
        nameKey: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
      },
      {
        idKey: "ANTHROPIC_MODEL",
      },
    ];

    for (const { idKey, nameKey } of definitions) {
      const id = env[idKey];
      if (!id || seen.has(id)) continue;

      const name = nameKey ? env[nameKey] || id : id;
      seen.add(id);
      if (name && id) {
        models.push({ name, id });
      }
    }

    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
