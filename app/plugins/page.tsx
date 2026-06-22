import { Box, PackageOpen } from "lucide-react";
import type { CSSProperties } from "react";
import { getInstalledPlugins } from "@/lib/plugins";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function PluginGlyph({ name }: { name: string }) {
  const hue = Array.from(name).reduce(
    (total, character) => total + character.charCodeAt(0),
    0
  ) % 360;

  return (
    <div
      className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 shadow-sm ring-1 ring-black/5"
      style={
        {
          "--plugin-hue": hue,
          "--plugin-hue-alt": (hue + 95) % 360,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,hsl(var(--plugin-hue)_95%_78%/.55),transparent_42%),radial-gradient(circle_at_80%_75%,hsl(var(--plugin-hue-alt)_92%_72%/.45),transparent_45%)]" />
      <div className="relative grid size-6 place-items-center rounded-lg bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
        <Box className="size-4 text-zinc-700" strokeWidth={2.2} />
      </div>
    </div>
  );
}

export default async function PluginsPage() {
  const plugins = await getInstalledPlugins();

  return (
    <div className="flex min-h-full flex-col bg-white">
      <header className="border-b border-black/5 px-8 py-6">
        <div className="mx-auto flex w-full max-w-7xl items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              插件
            </h1>
          </div>
          <div className="rounded-full border border-black/10 bg-zinc-50 px-3 py-1 text-xs text-zinc-500">
            {plugins.length} 个已安装
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto w-full max-w-7xl">
          {plugins.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-20 gap-y-7 md:grid-cols-2">
              {plugins.map((plugin) => (
                <article
                  key={plugin.id}
                  className={cn(
                    "group grid grid-cols-[auto_1fr] gap-3.5 rounded-2xl p-2.5",
                    "transition-colors hover:bg-zinc-50"
                  )}
                >
                  <PluginGlyph name={plugin.name} />
                  <div className="min-w-0 pt-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-zinc-900">
                        {plugin.name}
                      </h2>
                      {plugin.version !== "unknown" ? (
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                          {plugin.version}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-400">
                      {plugin.description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 bg-zinc-50/70 text-center">
              <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <PackageOpen className="size-5 text-zinc-400" />
              </div>
              <h2 className="text-base font-medium text-zinc-900">
                暂无已安装插件
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                未从系统插件清单中读取到插件记录。
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
