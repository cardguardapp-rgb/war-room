import type {
  EducationItem,
  ExperienceItem,
  ResumeSection,
  SectionKind,
} from "@/lib/api";

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  contact: "Contact",
  summary: "Professional summary",
  experience: "Work experience",
  education: "Education",
  skills: "Skills",
  other: "Other",
};

export const SECTION_KIND_ORDER: SectionKind[] = [
  "contact",
  "summary",
  "experience",
  "education",
  "skills",
  "other",
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

export function newExperienceItem(): ExperienceItem {
  return {
    id: uid("exp"),
    title: "",
    company: "",
    dates: "",
    location: "",
    bullets: [],
  };
}

export function newEducationItem(): EducationItem {
  return {
    id: uid("edu"),
    institution: "",
    qualification: "",
    dates: "",
    location: "",
    details: [],
  };
}

/**
 * Flatten any section down to plain text lines so it can be re-typed as a
 * different kind without losing content.
 */
export function flattenSection(sec: ResumeSection): string[] {
  switch (sec.kind) {
    case "contact":
      return [
        sec.name,
        sec.email,
        sec.phone,
        sec.location,
        ...sec.links,
        ...sec.otherLines,
      ].filter(Boolean);
    case "summary":
      return [...sec.paragraphs];
    case "experience":
      return sec.items.flatMap((it) => [
        [it.title, it.company, it.dates, it.location].filter(Boolean).join(" | "),
        ...it.bullets,
      ]);
    case "education":
      return sec.items.flatMap((it) => [
        [it.institution, it.qualification, it.dates, it.location]
          .filter(Boolean)
          .join(" | "),
        ...it.details,
      ]);
    case "skills":
      return [...sec.items];
    case "other":
      return [...sec.paragraphs, ...sec.bullets];
    default:
      return [];
  }
}

/** Build a section of the requested kind from plain text lines. Lossless. */
export function buildSectionOfKind(
  kind: SectionKind,
  id: string,
  heading: string,
  lines: string[],
): ResumeSection {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  switch (kind) {
    case "contact": {
      const email = clean.find((l) => EMAIL_RE.test(l)) ?? "";
      const phone =
        clean.find((l) => PHONE_RE.test(l) && !EMAIL_RE.test(l)) ?? "";
      const used = new Set([email, phone].filter(Boolean));
      return {
        id,
        kind: "contact",
        heading: heading || "Contact",
        name: clean[0] ?? "",
        email: email ? EMAIL_RE.exec(email)![0] : "",
        phone,
        location: "",
        links: [],
        otherLines: clean.slice(1).filter((l) => !used.has(l)),
      };
    }
    case "summary":
      return { id, kind: "summary", heading, paragraphs: clean };
    case "experience":
      return {
        id,
        kind: "experience",
        heading,
        items:
          clean.length > 0
            ? [
                {
                  ...newExperienceItem(),
                  title: clean[0] ?? "",
                  bullets: clean.slice(1),
                },
              ]
            : [],
      };
    case "education":
      return {
        id,
        kind: "education",
        heading,
        items:
          clean.length > 0
            ? [
                {
                  ...newEducationItem(),
                  institution: clean[0] ?? "",
                  details: clean.slice(1),
                },
              ]
            : [],
      };
    case "skills":
      return { id, kind: "skills", heading, items: clean };
    case "other":
    default:
      return { id, kind: "other", heading, paragraphs: clean, bullets: [] };
  }
}

/** Reassign a section to a different kind, preserving its text. */
export function reassignSection(
  sec: ResumeSection,
  kind: SectionKind,
): ResumeSection {
  if (sec.kind === kind) return sec;
  return buildSectionOfKind(kind, sec.id, sec.heading, flattenSection(sec));
}

export function emptySection(kind: SectionKind): ResumeSection {
  return buildSectionOfKind(
    kind,
    uid("sec"),
    kind === "contact" ? "Contact" : SECTION_KIND_LABELS[kind],
    [],
  );
}
