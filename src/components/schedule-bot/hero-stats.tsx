"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Users, Eye } from "lucide-react";

interface PopularEntry {
  type: string;
  id: string;
  name: string;
  count: number;
}

export function HeroStats() {
  const [stats, setStats] = useState<PopularEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/stats/popular?limit=20");
        const data = await res.json();
        if (active) setStats(data.results || []);
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const totalViews = stats.reduce((s, e) => s + e.count, 0);
  const uniqueGroups = new Set(
    stats.filter((e) => e.type === "group").map((e) => e.id),
  ).size;
  const topGroup = stats.find((e) => e.type === "group");

  if (loading) {
    return (
      <div className="flex gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 w-28 animate-pulse rounded-xl bg-muted/50"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-3.5 py-2 shadow-sm backdrop-blur">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Eye className="h-4 w-4" />
        </div>
        <div>
          <div className="text-base font-bold tabular-nums leading-none">
            {totalViews}
          </div>
          <div className="text-[10px] text-muted-foreground">просмотров</div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-3.5 py-2 shadow-sm backdrop-blur">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <Users className="h-4 w-4" />
        </div>
        <div>
          <div className="text-base font-bold tabular-nums leading-none">
            {uniqueGroups || "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">групп</div>
        </div>
      </div>

      {topGroup && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-3.5 py-2 shadow-sm backdrop-blur">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <div className="text-base font-bold leading-none">
              {topGroup.name}
            </div>
            <div className="text-[10px] text-muted-foreground">
              топ-группа · {topGroup.count} запр.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
