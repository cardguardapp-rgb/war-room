import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { api, type SseEvent } from "@/lib/api";

// DEV ONLY — rendered behind import.meta.env.DEV, and its API route doesn't
// exist in production. Sends one question to the coach's model and to
// AI_MODEL_CHAT_COMPARE side by side (same prompt, same saved history) so Amy
// can judge whether the faster model still sounds like the coach. Not saved.

type LaneId = "current" | "compare";

interface Lane {
  text: string;
  model?: string;
  firstWordMs?: number | null;
  totalMs?: number;
  cacheReadTokens?: number;
  error?: string;
  done: boolean;
}

const EMPTY_LANE: Lane = { text: "", done: false };

function seconds(ms: number | null | undefined): string {
  return ms == null ? "–" : `${(ms / 1000).toFixed(1)}s`;
}

function LaneCard({ title, lane }: { title: string; lane: Lane }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold">{title}</span>
        <span className="font-mono text-muted-foreground truncate">{lane.model ?? ""}</span>
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        first word {seconds(lane.firstWordMs)} · total {seconds(lane.totalMs)}
        {lane.cacheReadTokens != null && ` · cache read ${lane.cacheReadTokens}`}
      </div>
      {lane.error ? (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{lane.error}</span>
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap break-words">
          {lane.text || (!lane.done && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />)}
        </div>
      )}
    </div>
  );
}

export function ChatCompare({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Record<LaneId, Lane> | null>(null);

  const update = (id: LaneId, patch: (l: Lane) => Partial<Lane>) =>
    setLanes((prev) => (prev ? { ...prev, [id]: { ...prev[id], ...patch(prev[id]) } } : prev));

  const onEvent = ({ event, data }: SseEvent) => {
    const id = data.lane as LaneId;
    if (event === "text") update(id, (l) => ({ text: l.text + data.text }));
    else if (event === "lane_done") {
      update(id, () => ({
        done: true,
        model: data.model,
        firstWordMs: data.firstWordMs,
        totalMs: data.totalMs,
        cacheReadTokens: data.cacheReadTokens,
      }));
    } else if (event === "lane_error") {
      update(id, () => ({ done: true, model: data.model, error: data.error }));
    }
  };

  const run = async () => {
    const message = input.trim();
    if (!message || running) return;
    setRunning(true);
    setError(null);
    setLanes({ current: { ...EMPTY_LANE }, compare: { ...EMPTY_LANE } });
    try {
      await api.jobs.chatCompare(jobId, message, onEvent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-amber-400/70 p-3 space-y-3">
      <label className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Switch checked={open} onCheckedChange={setOpen} aria-label="Compare models" />
        Compare models (dev)
      </label>
      {open && (
        <>
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void run();
                }
              }}
              placeholder="Same question to both models…"
              className="min-h-[52px] max-h-40 resize-none"
              disabled={running}
            />
            <Button
              onClick={() => void run()}
              disabled={running || !input.trim()}
              className="rounded-xl shrink-0 h-[52px] px-4"
              aria-label="Compare"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          {lanes && (
            <div className="grid gap-3 md:grid-cols-2">
              <LaneCard title="Current coach" lane={lanes.current} />
              <LaneCard title="Faster model" lane={lanes.compare} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
