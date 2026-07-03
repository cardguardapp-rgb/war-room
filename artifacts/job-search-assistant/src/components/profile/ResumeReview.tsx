import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  Trash2,
  Type,
  X,
} from "lucide-react";
import type {
  EducationItem,
  ExperienceItem,
  ResumeSection,
  SectionKind,
  StyleEntry,
  StyleMap,
} from "@/lib/api";
import {
  SECTION_KIND_LABELS,
  SECTION_KIND_ORDER,
  emptySection,
  newEducationItem,
  newExperienceItem,
  reassignSection,
} from "./resumeDraft";

// --- small immutable list helpers ---
const setAt = <T,>(arr: T[], i: number, v: T): T[] =>
  arr.map((x, idx) => (idx === i ? v : x));
const removeAt = <T,>(arr: T[], i: number): T[] =>
  arr.filter((_, idx) => idx !== i);

interface Props {
  sections: ResumeSection[];
  setSections: (updater: (prev: ResumeSection[]) => ResumeSection[]) => void;
  styleMap: StyleMap | null;
  warnings: string[];
  isNew: boolean;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResumeReview({
  sections,
  setSections,
  styleMap,
  warnings,
  isNew,
  saving,
  onConfirm,
  onCancel,
}: Props) {
  const replace = (next: ResumeSection) =>
    setSections((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  const removeSection = (id: string) =>
    setSections((prev) => prev.filter((s) => s.id !== id));
  const changeKind = (id: string, kind: SectionKind) =>
    setSections((prev) =>
      prev.map((s) => (s.id === id ? reassignSection(s, kind) : s)),
    );
  const move = (id: string, dir: -1 | 1) =>
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  const addSection = (kind: SectionKind) =>
    setSections((prev) => [...prev, emptySection(kind)]);

  return (
    <div className="space-y-6 pb-28 animate-in fade-in duration-300 max-w-3xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-semibold text-foreground tracking-tight">
          {isNew ? "Review your resume" : "Edit structured resume"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Check what we pulled out of your document and correct anything that
          isn&rsquo;t right. This becomes the source of truth for tailoring —
          the original file is kept only as a formatting reference.
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            A few things need a look
          </div>
          <ul className="text-sm text-amber-800/90 dark:text-amber-300/90 list-disc pl-5 space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {styleMap && <DetectedFormatting styleMap={styleMap} />}

      <div className="space-y-4">
        {sections.map((sec, idx) => (
          <div
            key={sec.id}
            className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
              <Select
                value={sec.kind}
                onValueChange={(v) => changeKind(sec.id, v as SectionKind)}
              >
                <SelectTrigger className="h-9 w-[190px] rounded-lg bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTION_KIND_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {SECTION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={sec.heading}
                onChange={(e) => replace({ ...sec, heading: e.target.value })}
                placeholder="Section heading"
                className="h-9 flex-1 min-w-[8rem] rounded-lg"
              />
              <div className="flex items-center gap-1 ml-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={idx === 0}
                  onClick={() => move(sec.id, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={idx === sections.length - 1}
                  onClick={() => move(sec.id, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => removeSection(sec.id)}
                  aria-label="Delete section"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="p-4">
              <SectionBody section={sec} onChange={replace} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {SECTION_KIND_ORDER.filter((k) => k !== "contact").map((k) => (
          <Button
            key={k}
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => addSection(k)}
          >
            <Plus className="w-4 h-4 mr-1" /> {SECTION_KIND_LABELS[k]}
          </Button>
        ))}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 border-t border-border bg-background/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] z-30">
        <div className="max-w-3xl mx-auto flex items-center justify-end gap-2 px-1">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={saving} className="rounded-xl">
            <Check className="w-4 h-4 mr-2" />
            {saving ? "Saving…" : "Confirm & save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetectedFormatting({ styleMap }: { styleMap: StyleMap }) {
  const rows: { label: string; entry: StyleEntry }[] = [
    { label: "Name", entry: styleMap.elements.name },
    { label: "Section headings", entry: styleMap.elements.sectionHeading },
    { label: "Job titles", entry: styleMap.elements.jobTitle },
    { label: "Body text", entry: styleMap.elements.body },
    { label: "Bullets", entry: styleMap.elements.bullet },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Type className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Detected formatting</h3>
        <span className="text-xs text-muted-foreground">
          (kept so tailored versions match your original)
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-3 text-sm border border-border rounded-lg px-3 py-2 bg-muted/20"
          >
            <span
              className="w-4 h-4 rounded shrink-0 border border-border"
              style={{ background: r.entry.color ?? "transparent" }}
              title={r.entry.color ?? "inherit"}
            />
            <span className="font-medium w-28 shrink-0">{r.label}</span>
            <span className="text-muted-foreground truncate">
              {r.entry.fontFamily ?? "—"}
              {r.entry.fontSizePt != null ? ` · ${r.entry.fontSizePt}pt` : ""}
              {r.entry.bold ? " · Bold" : ""}
              {r.entry.italic ? " · Italic" : ""}
              {r.entry.color ? ` · ${r.entry.color}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- per-kind body editors ---

function SectionBody({
  section,
  onChange,
}: {
  section: ResumeSection;
  onChange: (next: ResumeSection) => void;
}) {
  switch (section.kind) {
    case "contact":
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name">
              <Input
                value={section.name}
                onChange={(e) => onChange({ ...section, name: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                value={section.email}
                onChange={(e) => onChange({ ...section, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={section.phone}
                onChange={(e) => onChange({ ...section, phone: e.target.value })}
              />
            </Field>
            <Field label="Location">
              <Input
                value={section.location}
                onChange={(e) =>
                  onChange({ ...section, location: e.target.value })
                }
              />
            </Field>
          </div>
          <LineList
            label="Links"
            values={section.links}
            onChange={(links) => onChange({ ...section, links })}
            placeholder="linkedin.com/in/…"
            addLabel="Add link"
          />
          <LineList
            label="Other contact lines"
            values={section.otherLines}
            onChange={(otherLines) => onChange({ ...section, otherLines })}
            addLabel="Add line"
          />
        </div>
      );
    case "summary":
      return (
        <LineList
          label="Summary"
          values={section.paragraphs}
          onChange={(paragraphs) => onChange({ ...section, paragraphs })}
          multiline
          addLabel="Add paragraph"
        />
      );
    case "skills":
      return (
        <LineList
          label="Skills"
          values={section.items}
          onChange={(items) => onChange({ ...section, items })}
          placeholder="e.g. Stakeholder management"
          addLabel="Add skill"
        />
      );
    case "experience":
      return (
        <div className="space-y-4">
          {section.items.map((item, i) => (
            <ExperienceItemEditor
              key={item.id}
              item={item}
              onChange={(next) =>
                onChange({ ...section, items: setAt(section.items, i, next) })
              }
              onRemove={() =>
                onChange({ ...section, items: removeAt(section.items, i) })
              }
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() =>
              onChange({
                ...section,
                items: [...section.items, newExperienceItem()],
              })
            }
          >
            <Plus className="w-4 h-4 mr-1" /> Add role
          </Button>
        </div>
      );
    case "education":
      return (
        <div className="space-y-4">
          {section.items.map((item, i) => (
            <EducationItemEditor
              key={item.id}
              item={item}
              onChange={(next) =>
                onChange({ ...section, items: setAt(section.items, i, next) })
              }
              onRemove={() =>
                onChange({ ...section, items: removeAt(section.items, i) })
              }
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() =>
              onChange({
                ...section,
                items: [...section.items, newEducationItem()],
              })
            }
          >
            <Plus className="w-4 h-4 mr-1" /> Add qualification
          </Button>
        </div>
      );
    case "other":
    default:
      return (
        <div className="space-y-4">
          <LineList
            label="Paragraphs"
            values={section.paragraphs}
            onChange={(paragraphs) => onChange({ ...section, paragraphs })}
            multiline
            addLabel="Add paragraph"
          />
          <LineList
            label="Bullets"
            values={section.bullets}
            onChange={(bullets) => onChange({ ...section, bullets })}
            addLabel="Add bullet"
          />
        </div>
      );
  }
}

function ExperienceItemEditor({
  item,
  onChange,
  onRemove,
}: {
  item: ExperienceItem;
  onChange: (next: ExperienceItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Job title">
          <Input
            value={item.title}
            onChange={(e) => onChange({ ...item, title: e.target.value })}
          />
        </Field>
        <Field label="Company">
          <Input
            value={item.company}
            onChange={(e) => onChange({ ...item, company: e.target.value })}
          />
        </Field>
        <Field label="Dates">
          <Input
            value={item.dates}
            onChange={(e) => onChange({ ...item, dates: e.target.value })}
            placeholder="Feb 2020 – Present"
          />
        </Field>
        <Field label="Location">
          <Input
            value={item.location}
            onChange={(e) => onChange({ ...item, location: e.target.value })}
          />
        </Field>
      </div>
      <LineList
        label="Bullet points"
        values={item.bullets}
        onChange={(bullets) => onChange({ ...item, bullets })}
        multiline
        addLabel="Add bullet"
      />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-4 h-4 mr-1" /> Remove role
        </Button>
      </div>
    </div>
  );
}

function EducationItemEditor({
  item,
  onChange,
  onRemove,
}: {
  item: EducationItem;
  onChange: (next: EducationItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Institution">
          <Input
            value={item.institution}
            onChange={(e) => onChange({ ...item, institution: e.target.value })}
          />
        </Field>
        <Field label="Qualification">
          <Input
            value={item.qualification}
            onChange={(e) =>
              onChange({ ...item, qualification: e.target.value })
            }
          />
        </Field>
        <Field label="Dates">
          <Input
            value={item.dates}
            onChange={(e) => onChange({ ...item, dates: e.target.value })}
          />
        </Field>
        <Field label="Location">
          <Input
            value={item.location}
            onChange={(e) => onChange({ ...item, location: e.target.value })}
          />
        </Field>
      </div>
      <LineList
        label="Details"
        values={item.details}
        onChange={(details) => onChange({ ...item, details })}
        addLabel="Add detail"
      />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-4 h-4 mr-1" /> Remove
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function LineList({
  label,
  values,
  onChange,
  multiline,
  placeholder,
  addLabel,
}: {
  label?: string;
  values: string[];
  onChange: (next: string[]) => void;
  multiline?: boolean;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <div className="space-y-2">
      {label && (
        <Label className="text-xs text-muted-foreground">{label}</Label>
      )}
      {values.map((v, i) => (
        <div key={i} className="flex gap-2 items-start">
          {multiline ? (
            <Textarea
              value={v}
              onChange={(e) => onChange(setAt(values, i, e.target.value))}
              placeholder={placeholder}
              className="min-h-[60px] flex-1"
            />
          ) : (
            <Input
              value={v}
              onChange={(e) => onChange(setAt(values, i, e.target.value))}
              placeholder={placeholder}
              className="flex-1"
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground"
            onClick={() => onChange(removeAt(values, i))}
            aria-label="Remove"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="rounded-lg"
        onClick={() => onChange([...values, ""])}
      >
        <Plus className="w-4 h-4 mr-1" /> {addLabel ?? "Add"}
      </Button>
    </div>
  );
}
