import { ChevronRight, PackageOpen } from "lucide-react";
import Link from "next/link";
import { PluginGlyph } from "@/components/plugins/plugin-glyph";
import { getInstalledPlugins } from "@/lib/plugins";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PluginsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const plugins = await getInstalledPlugins();
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const disabledPlugins = plugins.filter((plugin) => !plugin.enabled);

  return (
    <div className="flex min-h-full flex-col bg-white">
      <header className="border-b border-black/5 px-8 py-6">
        <div className="mx-auto flex w-full max-w-7xl items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              插件
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto w-full max-w-7xl">
          {plugins.length > 0 ? (
            <div className="space-y-10">
              <PluginSection title="已启用" plugins={enabledPlugins} workspace={workspace} />
              <PluginSection title="未启用" plugins={disabledPlugins} workspace={workspace} muted />
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

function PluginSection({
  title,
  plugins,
  workspace,
  muted = false,
}: {
  title: string;
  plugins: Awaited<ReturnType<typeof getInstalledPlugins>>;
  workspace: string;
  muted?: boolean;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        <div className="rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-xs text-zinc-500">
          {plugins.length} 个
        </div>
      </div>

      {plugins.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-20 gap-y-7 md:grid-cols-2">
          {plugins.map((plugin) => (
            <Link
              key={plugin.id}
              href={`/${workspace}/plugins/${encodeURIComponent(plugin.id)}`}
              className={cn(
                "group relative grid grid-cols-[auto_1fr] gap-3.5 rounded-2xl p-2.5",
                "cursor-default transition-colors hover:bg-zinc-50",
                muted && "opacity-70 hover:opacity-100"
              )}
            >
              <PluginGlyph name={plugin.name} />
              <div className="min-w-0 pt-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-900">
                    {plugin.name}
                  </h3>
                  {plugin.version !== "unknown" ? (
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      {plugin.version}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 pr-6 text-sm leading-5 text-zinc-400">
                  {plugin.description}
                </p>
              </div>
              <ChevronRight className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-8 text-sm text-zinc-400">
          暂无{title}插件。
        </div>
      )}
    </section>
  );
}
