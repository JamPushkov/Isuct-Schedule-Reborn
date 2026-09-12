"use client";

import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";

interface Status {
  currentParity: "I" | "II";
  semesterStart: string;
  telegramConfigured: boolean;
}

export function WeekStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const parity = status?.currentParity;
  const parityLabel =
    parity === "I" ? "I неделя (нечётная)" : parity === "II" ? "II неделя (чётная)" : "—";

  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs shadow-sm">
      <CalendarDays className="h-3.5 w-3.5 text-emerald-600" />
      <span className="text-muted-foreground">Текущая неделя:</span>
      <span className="font-semibold text-foreground">
        {loading ? (
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
        ) : (
          parityLabel
        )}
      </span>
      <button
        onClick={load}
        className="text-muted-foreground transition hover:text-foreground"
        aria-label="Обновить"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
