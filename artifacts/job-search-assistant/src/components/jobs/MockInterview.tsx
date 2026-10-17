import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  useStartMock,
  useMockNext,
  useMockAnswer,
  useFinishMock,
  useDeleteMock,
} from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  Keyboard,
  Loader2,
  Mic,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import type { Document, Job, MockInterview as Session, MockTurn } from "@/lib/api";
import { startTranscriber, type LiveTranscript, type Transcriber } from "@/lib/speech";
import { canSpeak, coachVoice, speak, stopSpeaking } from "@/lib/voice";

const COUNTS = ["3", "5", "8"];
const EMPTY_LIVE: LiveTranscript = { final: "", partial: "" };

function asSession(content: unknown): Session {
  const c = (content ?? {}) as Partial<Session>;
  return {
    version: 1,
    status: c.status === "finished" ? "finished" : "in_progress",
    started_at: c.started_at ?? "",
    finished_at: c.finished_at ?? null,
    plan: Array.isArray(c.plan) ? c.plan : [],
    turns: Array.isArray(c.turns) ? c.turns : [],
  };
}

/** Mirrors mockStage on the server. */
function stageOf(s: Session): "ask" | "answer" | "done" {
  if (s.status === "finished") return "done";
  const last = s.turns[s.turns.length - 1];
  if (last && !last.feedback) return "answer";
  return s.turns.length < s.plan.length ? "ask" : "done";
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : format(d, "d MMM yyyy, h:mm a");
}

function CoachBubble({ index, text, onReplay }: { index: number; text: React.ReactNode; onReplay?: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
        Q{index + 1}
      </span>
      <div className="min-w-0 flex-1 text-base font-medium leading-relaxed break-words">{text}</div>
      {onReplay && canSpeak && (
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:h-8 md:w-8 shrink-0 text-muted-foreground"
          onClick={onReplay}
          aria-label="Read the question aloud"
        >
          <Volume2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

function AnswerBlock({ text, seconds, words }: { text: string; seconds: number | null; words: number | null }) {
  const meta = [seconds !== null ? clock(seconds) : "Typed", words !== null ? `${words} words` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1">
      <div className="text-xs font-medium text-muted-foreground">Your answer · {meta}</div>
      <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

function FeedbackBlock({ text }: { text: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </div>
  );
}

function DoneTurn({ index, turn }: { index: number; turn: MockTurn }) {
  return (
    <div className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <CoachBubble index={index} text={turn.asked} onReplay={() => void speak(turn.asked)} />
      {turn.answer && <AnswerBlock text={turn.answer} seconds={turn.answer_seconds} words={turn.answer_words} />}
      {turn.feedback && <FeedbackBlock text={turn.feedback} />}
    </div>
  );
}

function MockSession({
  job,
  doc,
  autoAsk,
  onClose,
}: {
  job: Job;
  doc: Document;
  autoAsk: boolean;
  onClose: () => void;
}) {
  const session = asSession(doc.content_json);
  const stage = stageOf(session);
  const next = useMockNext(job.id);
  const answer = useMockAnswer(job.id);
  const finish = useFinishMock(job.id);

  // The coach's question or feedback as it streams in.
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [live, setLive] = useState<LiveTranscript>(EMPTY_LIVE);
  const [elapsed, setElapsed] = useState(0);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  // The answer being sent; kept so a failed send can be retried.
  const [unsent, setUnsent] = useState<{ answer: string; seconds: number | null } | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const transcriber = useRef<Transcriber | null>(null);
  const startedAt = useRef(0);
  const autoAsked = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const busy = next.isPending || answer.isPending || finish.isPending;
  const current = stage === "answer" ? session.turns[session.turns.length - 1] : null;
  const currentIndex = Math.min(session.turns.length - (stage === "answer" ? 1 : 0), session.plan.length - 1);

  useEffect(() => {
    coachVoice().then((v) => setVoiceName(v ? `${v.name} (${v.lang})` : null));
    return () => {
      transcriber.current?.cancel();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 500);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [session.turns.length, stage, recording, answer.isPending, next.isPending]);

  const ask = () => {
    setError(null);
    setStreamText("");
    next.mutate(
      { docId: doc.id, onText: (piece) => setStreamText((s) => (s ?? "") + piece) },
      {
        onSuccess: (saved) => {
          setStreamText(null);
          const s = asSession(saved.content_json);
          const asked = s.turns[s.turns.length - 1]?.asked;
          if (asked) void speak(asked);
        },
        onError: (err) => {
          setStreamText(null);
          setError(err.message);
        },
      },
    );
  };

  // A freshly started session asks its first question straight away.
  useEffect(() => {
    if (autoAsk && !autoAsked.current && stage === "ask") {
      autoAsked.current = true;
      ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (text: string, seconds: number | null) => {
    setUnsent({ answer: text, seconds });
    setError(null);
    setStreamText("");
    answer.mutate(
      { docId: doc.id, answer: text, seconds, onText: (piece) => setStreamText((s) => (s ?? "") + piece) },
      {
        onSuccess: () => {
          setStreamText(null);
          setUnsent(null);
          setTyped("");
          setTyping(false);
          setLive(EMPTY_LIVE);
        },
        onError: (err) => {
          setStreamText(null);
          setError(err.message);
        },
      },
    );
  };

  const beginAnswer = async () => {
    stopSpeaking();
    setError(null);
    setUnsent(null);
    setLive(EMPTY_LIVE);
    setStarting(true);
    try {
      transcriber.current = await startTranscriber({
        onUpdate: setLive,
        // The connection dropped: keep what was heard and let it be finished by typing.
        onDrop: (message) => {
          const t = transcriber.current;
          transcriber.current = null;
          setRecording(false);
          setError(message);
          void t?.stop().then((text) => {
            setTyped(text);
            setTyping(true);
          });
        },
      });
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the microphone.");
    } finally {
      setStarting(false);
    }
  };

  const endAnswer = async () => {
    const t = transcriber.current;
    if (!t) return;
    transcriber.current = null;
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    setRecording(false);
    setStopping(true);
    const text = await t.stop();
    setStopping(false);
    if (!text.trim()) {
      setError("Nothing was picked up. Check the microphone and try again.");
      return;
    }
    submit(text, seconds);
  };

  const cancelAnswer = () => {
    transcriber.current?.cancel();
    transcriber.current = null;
    setRecording(false);
    setLive(EMPTY_LIVE);
  };

  const close = () => {
    cancelAnswer();
    stopSpeaking();
    onClose();
  };

  const finished = session.status === "finished";
  const answered = session.turns.filter((t) => t.feedback).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={close} disabled={recording}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Sessions
          </Button>
          <span className="text-sm font-medium">
            {finished
              ? `${answered} of ${session.plan.length} answered`
              : `Question ${currentIndex + 1} of ${session.plan.length}`}
          </span>
          {canSpeak && (
            <InfoTip label="Voice">Questions are read in {voiceName ?? "the browser's default voice"}.</InfoTip>
          )}
        </div>
        {!finished && (
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => {
              cancelAnswer();
              stopSpeaking();
              finish.mutate(doc.id, { onError: (err) => setError(err.message) });
            }}
            disabled={busy || starting || stopping}
          >
            End session
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {session.turns.map((turn, i) =>
          turn.feedback ? <DoneTurn key={i} index={i} turn={turn} /> : null,
        )}

        {/* The coach putting the next question */}
        {next.isPending && (
          <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
            <CoachBubble
              index={session.turns.length}
              text={
                streamText ? (
                  streamText
                ) : (
                  <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                  </span>
                )
              }
            />
          </div>
        )}

        {/* The question waiting for an answer */}
        {current && !next.isPending && (
          <div className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
            <CoachBubble
              index={session.turns.length - 1}
              text={current.asked}
              onReplay={recording || answer.isPending ? undefined : () => void speak(current.asked)}
            />

            {answer.isPending && unsent ? (
              <>
                <AnswerBlock
                  text={unsent.answer}
                  seconds={unsent.seconds}
                  words={unsent.answer.split(/\s+/).filter(Boolean).length}
                />
                <FeedbackBlock
                  text={
                    streamText || (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                      </span>
                    )
                  }
                />
              </>
            ) : recording || stopping ? (
              <div className="space-y-3">
                <div className="min-h-[120px] max-h-[320px] overflow-y-auto rounded-xl border border-border bg-muted/20 p-3 text-base leading-relaxed break-words">
                  {live.final || live.partial ? (
                    <>
                      {live.final}
                      {live.final && live.partial ? " " : ""}
                      <span className="text-muted-foreground">{live.partial}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Listening…</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground mr-auto">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
                    {clock(elapsed)}
                  </span>
                  <Button variant="ghost" onClick={cancelAnswer} disabled={stopping} className="rounded-lg">
                    <X className="w-4 h-4 mr-1.5" /> Discard
                  </Button>
                  <Button onClick={() => void endAnswer()} disabled={stopping} className="rounded-lg">
                    {stopping ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4 mr-1.5" />
                    )}
                    Done
                  </Button>
                </div>
              </div>
            ) : typing ? (
              <div className="space-y-2">
                <Textarea
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="min-h-[140px]"
                  placeholder="Your answer…"
                  autoFocus
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" className="rounded-lg" onClick={() => setTyping(false)}>
                    <Mic className="w-4 h-4 mr-1.5" /> Speak instead
                  </Button>
                  <Button className="rounded-lg" disabled={!typed.trim()} onClick={() => submit(typed.trim(), null)}>
                    Send answer
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void beginAnswer()} disabled={starting} className="rounded-xl h-12 px-5">
                  {starting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mic className="w-4 h-4 mr-2" />}
                  {starting ? "Starting…" : "Answer"}
                </Button>
                {unsent && (
                  <Button variant="outline" className="rounded-xl h-12" onClick={() => submit(unsent.answer, unsent.seconds)}>
                    Try again
                  </Button>
                )}
                <Button variant="ghost" className="rounded-xl h-12 text-muted-foreground" onClick={() => setTyping(true)}>
                  <Keyboard className="w-4 h-4 mr-2" /> Type instead
                </Button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {stage === "ask" && !next.isPending && (
          <Button onClick={ask} disabled={busy} className="rounded-xl h-12 px-5">
            {session.turns.length === 0 ? "First question" : "Next question"}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}

        {stage === "done" && (
          <p className="text-sm text-muted-foreground">
            {finished && session.finished_at ? `Finished ${when(session.finished_at)}` : "All questions answered."}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export function MockInterview({
  job,
  prepDoc,
  sessions,
}: {
  job: Job;
  prepDoc?: Document;
  sessions: Document[];
}) {
  const start = useStartMock(job.id);
  const remove = useDeleteMock(job.id);
  const [count, setCount] = useState("5");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [justStarted, setJustStarted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Document | null>(null);

  const prepQuestions = (prepDoc?.content_json as { questions?: unknown[] } | undefined)?.questions;
  const hasQuestions = Array.isArray(prepQuestions) && prepQuestions.length > 0;
  const active = sessions.find((d) => d.id === activeId);

  const begin = () => {
    setError(null);
    start.mutate(Number(count), {
      onSuccess: (doc) => {
        setJustStarted(doc.id);
        setActiveId(doc.id);
      },
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Mic className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">Mock interview</h3>
        <InfoTip>
          The coach asks questions from your prep pack aloud, transcribes your spoken answer live, then gives
          feedback on structure, specificity, length and story choice. Uses your microphone.
        </InfoTip>
      </div>

      {active ? (
        <MockSession
          key={active.id}
          job={job}
          doc={active}
          autoAsk={justStarted === active.id}
          onClose={() => {
            setActiveId(null);
            setJustStarted(null);
          }}
        />
      ) : (
        <>
          {!hasQuestions ? (
            <p className="text-sm text-muted-foreground">Generate the interview prep pack first.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger className="w-[150px] h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c} questions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={begin} disabled={start.isPending} className="rounded-xl h-12 px-5">
                {start.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mic className="w-4 h-4 mr-2" />}
                Start
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {sessions.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {sessions.map((d) => {
                const s = asSession(d.content_json);
                const done = s.turns.filter((t) => t.feedback).length;
                const finished = s.status === "finished";
                return (
                  <li key={d.id} className="flex items-center gap-2 p-2 pl-3">
                    <button
                      type="button"
                      onClick={() => setActiveId(d.id)}
                      className="min-w-0 flex-1 text-left py-1.5 rounded-lg hover:text-primary"
                    >
                      <div className="text-sm font-medium truncate">{when(s.started_at)}</div>
                      <div className="text-xs text-muted-foreground">
                        {done} of {s.plan.length} answered · {finished ? "Finished" : "In progress"}
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 md:h-9 md:w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(d)}
                      aria-label="Delete this session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this mock interview?</AlertDialogTitle>
            <AlertDialogDescription>Its questions, answers and feedback will be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) remove.mutate(deleting.id, { onError: (err) => setError(err.message) });
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
