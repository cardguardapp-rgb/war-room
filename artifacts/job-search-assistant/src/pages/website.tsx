import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useWebsite, useSaveWebsite, useDraftWebsite, useWriteWebsiteField } from "@/hooks/use-api";
import { api, type WebsiteConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Globe,
  Sparkles,
  Loader2,
  Save,
  Download,
  ExternalLink,
  Plus,
  Trash2,
  AlertTriangle,
  Rocket,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

const SECTION_LABELS: { key: keyof WebsiteConfig["sections"]; label: string }[] = [
  { key: "about", label: "About" },
  { key: "experience", label: "Experience" },
  { key: "skills", label: "Skills" },
  { key: "education", label: "Education" },
  { key: "contact", label: "Contact" },
];

export default function Website() {
  const { data, isLoading } = useWebsite();
  const save = useSaveWebsite();
  const draft = useDraftWebsite();

  const [form, setForm] = useState<WebsiteConfig | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  // Seed the form once the saved config arrives.
  useEffect(() => {
    if (data?.config && !form) setForm(data.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const hasResume = data?.has_resume ?? false;

  const set = (patch: Partial<WebsiteConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setSection = (key: keyof WebsiteConfig["sections"], val: boolean) =>
    setForm((f) => (f ? { ...f, sections: { ...f.sections, [key]: val } } : f));

  const doSave = (): Promise<void> => {
    if (!form) return Promise.resolve();
    return new Promise((resolve) => {
      save.mutate(form, {
        onSuccess: (res) => {
          setForm(res.config);
          setPreviewKey((k) => k + 1);
          toast.success("Website saved");
          resolve();
        },
        onError: (err) => {
          toast.error("Couldn't save", { description: err.message });
          resolve();
        },
      });
    });
  };

  const runDraft = () => {
    draft.mutate(undefined, {
      onSuccess: (d) =>
        set({
          headline: d.headline || form?.headline || "",
          tagline: d.tagline || form?.tagline || "",
          bio: d.bio || form?.bio || "",
          about: d.about || form?.about || "",
        }),
      onError: (err) => toast.error("Couldn't draft copy", { description: err.message }),
    });
  };

  const saveThen = async (action: () => void) => {
    await doSave();
    action();
  };

  if (isLoading || !form) {
    return (
      <div className="max-w-3xl mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5 pb-24">
      <div className="flex items-center gap-2">
        <Globe className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-serif font-semibold">Personal website</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Build a professional website from your resume, then download it and publish it anywhere
        (with your own domain). Update your details here and re-download any time.
      </p>

      {!hasResume && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Add and confirm your resume on the{" "}
            <Link href="/profile" className="underline font-medium">Profile page</Link> first — the
            site is generated from it.
          </span>
        </div>
      )}

      {/* Basics */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Basics</h3>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={runDraft}
            disabled={draft.isPending || !hasResume}
          >
            {draft.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Drafting…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-1.5" /> Draft headline &amp; bio with AI
              </>
            )}
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Display name">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Site title (browser tab)">
            <Input value={form.siteTitle} onChange={(e) => set({ siteTitle: e.target.value })} />
          </Field>
          <Field label="Headline">
            <Input
              value={form.headline}
              onChange={(e) => set({ headline: e.target.value })}
              placeholder="e.g. Head of Product"
            />
            <AiAssist field="headline" current={form.headline} onResult={(t) => set({ headline: t })} />
          </Field>
          <Field label="Tagline">
            <Input
              value={form.tagline}
              onChange={(e) => set({ tagline: e.target.value })}
              placeholder="One short line under the headline"
            />
            <AiAssist field="tagline" current={form.tagline} onResult={(t) => set({ tagline: t })} />
          </Field>
          <Field label="Accent colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.accent}
                onChange={(e) => set({ accent: e.target.value })}
                className="h-10 w-14 rounded-md border border-border bg-card cursor-pointer"
                aria-label="Accent colour"
              />
              <Input value={form.accent} onChange={(e) => set({ accent: e.target.value })} className="font-mono" />
            </div>
          </Field>
        </div>
        <Field label="Short bio (home page)">
          <Textarea value={form.bio} onChange={(e) => set({ bio: e.target.value })} className="min-h-[90px]" />
          <AiAssist field="bio" current={form.bio} onResult={(t) => set({ bio: t })} />
        </Field>
        <Field label="About (longer — separate paragraphs with a blank line)">
          <Textarea value={form.about} onChange={(e) => set({ about: e.target.value })} className="min-h-[130px]" />
          <AiAssist field="about" current={form.about} onResult={(t) => set({ about: t })} />
        </Field>
      </div>

      {/* Sections */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
        <h3 className="font-semibold">Pages to include</h3>
        <div className="flex flex-wrap gap-2">
          {SECTION_LABELS.map(({ key, label }) => {
            const on = form.sections[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key, !on)}
                className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Home is always included. Others pull from your resume.</p>
      </div>

      {/* Contact */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="font-semibold">Contact &amp; links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm mt-6">
            <input
              type="checkbox"
              checked={form.showPhone}
              onChange={(e) => set({ showPhone: e.target.checked })}
              className="h-4 w-4"
            />
            Show phone number publicly
          </label>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Links (LinkedIn, portfolio, etc.)</Label>
          {form.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={l.label}
                onChange={(e) =>
                  set({ links: form.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })
                }
                placeholder="Label"
                className="w-1/3"
              />
              <Input
                value={l.url}
                onChange={(e) =>
                  set({ links: form.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })
                }
                placeholder="https://…"
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                onClick={() => set({ links: form.links.filter((_, j) => j !== i) })}
                aria-label="Remove link"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => set({ links: [...form.links, { label: "", url: "" }] })}
          >
            <Plus className="w-4 h-4 mr-1.5" /> Add link
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={doSave} disabled={save.isPending} className="rounded-xl">
          {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Save
        </Button>
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={!hasResume || save.isPending}
          onClick={() => saveThen(() => window.open(api.website.previewUrl("index"), "_blank"))}
        >
          <ExternalLink className="w-4 h-4 mr-2" /> Save &amp; preview
        </Button>
        <Button
          variant="outline"
          className="rounded-xl"
          disabled={!hasResume || save.isPending}
          onClick={() => saveThen(() => window.open(api.website.exportUrl(), "_blank"))}
        >
          <Download className="w-4 h-4 mr-2" /> Download site (.zip)
        </Button>
      </div>

      {/* Live preview */}
      {hasResume && (
        <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="px-3 py-2 text-xs text-muted-foreground">Preview (reflects your last save)</div>
          <iframe
            key={previewKey}
            title="Website preview"
            src={`${api.website.previewUrl("index")}&v=${previewKey}`}
            className="w-full h-[520px] rounded-xl border border-border bg-white"
          />
        </div>
      )}

      {/* Deploy guide */}
      <div className="rounded-2xl border border-border bg-muted/30 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Publish it (with your own domain)</h3>
        </div>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
          <li>Click <strong>Download site (.zip)</strong> above and unzip it.</li>
          <li>
            Go to{" "}
            <a href="https://app.netlify.com/drop" target="_blank" rel="noreferrer" className="underline">
              Netlify Drop
            </a>{" "}
            (or Cloudflare Pages → “Direct upload”) and <strong>drag the unzipped folder</strong> onto the page.
            You'll get a live URL instantly.
          </li>
          <li>
            Buy your domain (e.g. via Cloudflare or Namecheap), then in the host's <strong>Domains</strong>{" "}
            settings add it and follow the DNS steps — HTTPS is automatic.
          </li>
          <li>Updated your details? Re-download and drag the new folder on again.</li>
        </ol>
        <p className="text-xs text-muted-foreground/80">
          A <code>README.txt</code> with these steps is included in the download.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

const SUGGESTIONS: Record<string, string[]> = {
  headline: ["More specific", "Add my industry", "Simpler / shorter"],
  tagline: ["Make it punchier", "More personal", "Focus on my impact"],
  bio: ["More concise", "Warmer tone", "Emphasise leadership", "Add a personal touch"],
  about: ["Tell my career story", "More formal", "Highlight achievements", "Make it shorter"],
};

/** Inline AI writing helper for one website text field. */
function AiAssist({
  field,
  current,
  onResult,
}: {
  field: "headline" | "tagline" | "bio" | "about";
  current: string;
  onResult: (text: string) => void;
}) {
  const write = useWriteWebsiteField();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  const run = (instr: string) => {
    write.mutate(
      { field, current, instruction: instr },
      {
        onSuccess: (d) => {
          if (d.text) onResult(d.text);
          setInstruction("");
        },
        onError: (err) => toast.error("Couldn't write that", { description: err.message }),
      },
    );
  };

  return (
    <div className="pt-1">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <Wand2 className="w-3.5 h-3.5" /> {current ? "Improve with AI" : "Write with AI"}
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS[field].map((s) => (
              <button
                key={s}
                type="button"
                disabled={write.isPending}
                onClick={() => run(s)}
                className="text-xs rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  run(instruction);
                }
              }}
              placeholder={current ? "How should I change it? (optional)" : "Any direction? (optional)"}
              disabled={write.isPending}
              className="h-9 text-sm"
            />
            <Button size="sm" className="rounded-lg shrink-0 h-9" onClick={() => run(instruction)} disabled={write.isPending}>
              {write.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-lg shrink-0 h-9 text-muted-foreground"
              onClick={() => setOpen(false)}
              disabled={write.isPending}
            >
              Close
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/80">
            Grounded in your resume — pick a suggestion or type your own instruction.
          </p>
        </div>
      )}
    </div>
  );
}
