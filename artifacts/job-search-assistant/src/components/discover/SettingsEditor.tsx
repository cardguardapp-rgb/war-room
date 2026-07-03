import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X, Save, Loader2, RotateCcw } from "lucide-react";
import type { DiscoverSettings } from "@/lib/api";

const DEFAULTS: DiscoverSettings = {
  roleTitles: [
    "Head of Product",
    "Director of Product",
    "Product Director",
    "VP Product",
    "Group Product Manager",
    "Chief Product Officer",
  ],
  officeRegion: "Between the Gold Coast and Brisbane, Queensland, Australia",
  remoteRule: "Full-time remote work from anywhere in Australia",
  exclusions: [
    "Junior or mid-level product manager roles",
    "Contract-only roles shorter than 6 months",
    "Roles requiring relocation",
  ],
  extraKeywords: "",
};

function ListEditor({
  label,
  hint,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const set = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(e) => set(i, e.target.value)}
              className="h-10"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:h-9 md:w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
              aria-label="Remove"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" className="rounded-lg" onClick={add}>
        <Plus className="w-4 h-4 mr-1.5" /> Add
      </Button>
    </div>
  );
}

export function SettingsEditor({
  settings,
  saving,
  onSave,
}: {
  settings: DiscoverSettings;
  saving: boolean;
  onSave: (s: DiscoverSettings) => void;
}) {
  const [draft, setDraft] = useState<DiscoverSettings>(settings);

  // Re-sync when the saved settings change (e.g. after load/save).
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const set = (patch: Partial<DiscoverSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const clean = (s: DiscoverSettings): DiscoverSettings => ({
    ...s,
    roleTitles: s.roleTitles.map((t) => t.trim()).filter(Boolean),
    exclusions: s.exclusions.map((t) => t.trim()).filter(Boolean),
    officeRegion: s.officeRegion.trim(),
    remoteRule: s.remoteRule.trim(),
    extraKeywords: s.extraKeywords.trim(),
  });

  return (
    <div className="space-y-6">
      <ListEditor
        label="Role level"
        hint="Titles / seniority to search for (also matched to equivalent levels by the AI)."
        items={draft.roleTitles}
        placeholder="e.g. Head of Product"
        onChange={(roleTitles) => set({ roleTitles })}
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Office / hybrid roles must be located</Label>
        <Input
          value={draft.officeRegion}
          onChange={(e) => set({ officeRegion: e.target.value })}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Otherwise the role must allow</Label>
        <Input
          value={draft.remoteRule}
          onChange={(e) => set({ remoteRule: e.target.value })}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">
          Remote roles are kept only when they explicitly allow this.
        </p>
      </div>

      <ListEditor
        label="Exclude"
        hint="Kinds of roles to screen out."
        items={draft.exclusions}
        placeholder="e.g. Contract-only roles under 6 months"
        onChange={(exclusions) => set({ exclusions })}
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium">Extra keywords (optional)</Label>
        <Input
          value={draft.extraKeywords}
          placeholder="e.g. SaaS, fintech"
          onChange={(e) => set({ extraKeywords: e.target.value })}
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">Appended to every search query.</p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(DEFAULTS)}
          className="text-muted-foreground"
        >
          <RotateCcw className="w-4 h-4 mr-1.5" /> Reset to defaults
        </Button>
        <Button onClick={() => onSave(clean(draft))} disabled={saving} className="rounded-xl">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-1.5" /> Save parameters
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
