import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useProfile, useJobChat, useJobChatHistory, useClearJobChat } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageCircle,
  Send,
  Loader2,
  AlertTriangle,
  Sparkles,
  RotateCcw,
  Paperclip,
  FileText,
  ImageIcon,
  X,
} from "lucide-react";
import type { Job, ChatMessage, ChatAttachment } from "@/lib/api";

const STARTERS = [
  "Am I a strong fit for this role?",
  "How should I position my experience for this?",
  "What interview questions should I prepare for?",
  "What are my biggest gaps for this role, and how do I address them?",
];

const ACCEPT = "image/*,.pdf,.docx,.txt,.md,.csv";
const MAX_FILES = 5;

/** Best-effort kind for the optimistic bubble (the server decides for real). */
function kindOf(file: File): ChatAttachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
    return "document";
  return "text";
}

function AttachmentChips({ attachments }: { attachments: ChatAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {attachments.map((a, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-background/20 border border-current/20 px-1.5 py-0.5 text-[11px] max-w-[180px]"
        >
          {a.kind === "image" ? (
            <ImageIcon className="w-3 h-3 shrink-0" />
          ) : (
            <FileText className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{a.name}</span>
        </span>
      ))}
    </div>
  );
}

export function RoleChat({ job }: { job: Job }) {
  const { data: profile } = useProfile();
  const chat = useJobChat(job.id);
  const history = useJobChatHistory(job.id);
  const clearChat = useClearJobChat(job.id);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  // Seed from the saved transcript once, when it first loads.
  useEffect(() => {
    if (!seeded.current && history.data) {
      setMessages(history.data.messages ?? []);
      seeded.current = true;
    }
  }, [history.data]);

  const hasResume = !!profile?.resume_json?.sections?.length;
  const hasPosting = !!job.posting_text?.trim();
  const disabled = !hasResume || !hasPosting;

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  const send = (text: string) => {
    const content = text.trim();
    const sending = files;
    if ((!content && sending.length === 0) || chat.isPending || disabled) return;
    setError(null);
    // Optimistic user turn; the server returns the authoritative transcript.
    setMessages((m) => [
      ...m,
      {
        role: "user",
        content,
        ...(sending.length
          ? {
              attachments: sending.map((f) => ({
                name: f.name,
                kind: kindOf(f),
                mediaType: f.type,
              })),
            }
          : {}),
      },
    ]);
    setInput("");
    setFiles([]);
    chat.mutate(
      { message: content, files: sending },
      {
        onSuccess: (res) => setMessages(res.messages),
        onError: (err) => {
          // Drop the unanswered turn and hand the question + files back.
          setMessages((m) => m.slice(0, -1));
          setInput(content);
          setFiles(sending);
          setError(err.message);
        },
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Ask for advice on this role</h3>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg text-muted-foreground"
            onClick={() => {
              setMessages([]);
              setError(null);
              clearChat.mutate();
            }}
          >
            <RotateCcw className="w-4 h-4 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Chat with your recruiter/coach about this specific role — fit, positioning, interview prep,
        gaps, whether to apply. Grounded in this posting and your resume; it won't invent experience
        you don't have. <strong className="font-medium text-foreground">Attach files</strong> (a
        screenshot, position description, interview invite, assessment brief — image, PDF, .docx,
        .txt, .md or .csv) and they'll be read as context for your question.
      </p>

      {!hasResume && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Add your resume on the{" "}
            <Link href="/profile" className="underline font-medium">Profile page</Link> first so the
            advice is grounded in your real experience.
          </span>
        </div>
      )}
      {hasResume && !hasPosting && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Add this job's posting text (edit the job) so the advice can be role-specific.</span>
        </div>
      )}

      {(messages.length > 0 || chat.isPending) && (
        <div
          ref={scrollRef}
          className="max-h-[420px] overflow-y-auto space-y-3 rounded-xl border border-border bg-muted/10 p-3"
        >
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card border border-border rounded-bl-md"
                }`}
              >
                {m.content}
                {m.attachments && m.attachments.length > 0 && (
                  <AttachmentChips attachments={m.attachments} />
                )}
              </div>
            </div>
          ))}
          {chat.isPending && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-card border border-border px-3.5 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
              </div>
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && !disabled && (
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={chat.isPending}
              className="text-left text-xs rounded-full border border-border bg-background px-3 py-2 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              <Sparkles className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Files staged for the next question */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs max-w-[220px]"
            >
              {f.type.startsWith("image/") ? (
                <ImageIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <label
          htmlFor="chat-files"
          aria-label="Attach a file"
          className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-border bg-background transition-colors ${
            disabled || chat.isPending
              ? "opacity-50 pointer-events-none"
              : "cursor-pointer hover:border-primary/40 hover:text-primary"
          }`}
        >
          <Paperclip className="w-4 h-4" />
          <input
            id="chat-files"
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            disabled={disabled || chat.isPending}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
              e.target.value = "";
            }}
          />
        </label>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Add your resume and this job's posting first…" : "Ask anything about this role…"}
          className="min-h-[52px] max-h-40 resize-none"
          disabled={disabled || chat.isPending}
        />
        <Button
          onClick={() => send(input)}
          disabled={disabled || chat.isPending || (!input.trim() && files.length === 0)}
          className="rounded-xl shrink-0 h-[52px] px-4"
          aria-label="Send"
        >
          {chat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground/70">
        This chat and its attachments are saved for this role — they stay here when you come back, remain
        in context for follow-up questions, and help tailor your future resumes, cover letters and
        application answers. Use “New chat” to clear it.
      </p>
    </div>
  );
}
