import { QueryClient } from "@tanstack/react-query";

const BASE_PATH = "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// A network failure (offline, DNS, dropped connection) rejects fetch with a
// TypeError — turn it into a readable ApiError so the UI can show + retry it.
function networkError(): ApiError {
  return new ApiError(
    0,
    navigator.onLine === false
      ? "You appear to be offline. Check your connection and try again."
      : "Couldn't reach the server. Check your connection and try again.",
  );
}

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
    });
  } catch {
    throw networkError();
  }

  if (!response.ok) {
    let message = "An error occurred";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (e) {
      // Ignore
    }

    // Redirect to login on 401
    if (response.status === 401 && window.location.pathname !== "/") {
      window.location.href = "/";
    }

    throw new ApiError(response.status, message);
  }

  // 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// Multipart specific fetch
async function fetchMultipart<T>(path: string, formData: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_PATH}${path}`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
  } catch {
    throw networkError();
  }

  if (!response.ok) {
    let message = "An error occurred";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (e) {
      // Ignore
    }

    if (response.status === 401 && window.location.pathname !== "/") {
      window.location.href = "/";
    }

    throw new ApiError(response.status, message);
  }

  return response.json();
}

export type JobStatus =
  | 'New'
  | 'Tailoring'
  | 'Ready'
  | 'Applied'
  | 'Interview'
  | 'Offer'
  | 'Rejected'
  | 'Not Applying';
export type WorkArrangement = 'office' | 'hybrid' | 'remote' | 'unknown';

export interface Job {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  work_arrangement: string | null;
  source_url: string | null;
  posting_text: string | null;
  status: JobStatus;
  created_at: string;
  /** Overall fit 1–10 from the saved assessment (list view only); null if none. */
  fit_score?: number | null;
  /** One-line note on what drives the fit score; null if none. */
  fit_note?: string | null;
}

export interface ExtractResponse {
  fetch_failed?: boolean;
  message?: string;
  title?: string;
  company?: string;
  location?: string;
  work_arrangement?: WorkArrangement;
  summary?: string;
  flags?: string[];
  fit_score?: number;
  fit_note?: string;
  posting_text?: string;
  source_url?: string;
}

/** Persisted fit assessment for a job (shown on Job Detail). */
export interface JobAssessment {
  fit_score: number;
  fit_note: string;
  summary: string;
  flags: string[];
}

/** A file the candidate attached to a chat turn (client-safe view). */
export interface ChatAttachment {
  name: string;
  kind: 'image' | 'document' | 'text';
  mediaType: string;
}

/** A single turn in the role-advice chat. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
}

export interface WebsiteLink {
  label: string;
  url: string;
}

/** Config for the generated personal website (mirrors api-server/src/lib/siteBuild.ts). */
export interface WebsiteConfig {
  siteTitle: string;
  name: string;
  headline: string;
  tagline: string;
  bio: string;
  about: string;
  accent: string;
  email: string;
  phone: string;
  location: string;
  showPhone: boolean;
  links: WebsiteLink[];
  sections: {
    about: boolean;
    experience: boolean;
    education: boolean;
    skills: boolean;
    contact: boolean;
  };
}

export interface ClarifyingQuestion {
  question: string;
  why: string;
  affects: string;
}

export interface RecruiterFeedback {
  rejection_risks: string[];
  ats_gaps: string[];
  overall: string;
}

export interface TailorResult {
  proposed_resume: ResumeJson;
  clarifying_questions: ClarifyingQuestion[];
  recruiter_feedback: RecruiterFeedback;
}

export interface CoverLetterFull {
  salutation: string;
  re: string;
  body: string;
}

export interface CoverLetterResult {
  clarifying_questions: ClarifyingQuestion[];
  full: CoverLetterFull;
  short: string;
}

export interface DraftedAnswer {
  question: string;
  answer: string;
}

export interface AppQuestionsResult {
  clarifying_questions: ClarifyingQuestion[];
  answers: DraftedAnswer[];
}

export interface Document {
  id: number;
  job_id: number;
  type: 'resume' | 'cover_letter' | 'cover_letter_plain' | 'cover_note' | 'assessment' | 'chat';
  content_json: any;
  docx_object_key: string | null;
  pdf_object_key: string | null;
  created_at: string;
}

// --- Discover ----------------------------------------------------------

export type MatchVerdict = 'yes' | 'no' | 'unsure';

export interface DiscoverSettings {
  roleTitles: string[];
  officeRegion: string;
  remoteRule: string;
  exclusions: string[];
  extraKeywords: string;
}

export interface DiscoverResult {
  url: string;
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  seniority_match: MatchVerdict;
  location_match: MatchVerdict;
  fit_score: number;
  fit_note: string;
  posted: string;
  reason: string;
}

export interface DiscoverSearchResponse {
  results: DiscoverResult[];
  counts: { raw: number; dropped_non_postings: number; screened: number; kept: number };
  note: string;
}

// --- Structured resume model (mirrors api-server/src/lib/resumeParser.ts) ---

export type SectionKind =
  | "contact"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "other";

export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  dates: string;
  location: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  qualification: string;
  dates: string;
  location: string;
  details: string[];
}

export type ResumeSection =
  | {
      id: string;
      kind: "contact";
      heading: string;
      name: string;
      email: string;
      phone: string;
      location: string;
      links: string[];
      otherLines: string[];
    }
  | { id: string; kind: "summary"; heading: string; paragraphs: string[] }
  | { id: string; kind: "experience"; heading: string; items: ExperienceItem[] }
  | { id: string; kind: "education"; heading: string; items: EducationItem[] }
  | { id: string; kind: "skills"; heading: string; items: string[] }
  | {
      id: string;
      kind: "other";
      heading: string;
      paragraphs: string[];
      bullets: string[];
    };

export interface ResumeJson {
  version: 1;
  sections: ResumeSection[];
}

export interface StyleEntry {
  fontFamily: string | null;
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  color: string | null;
}

export interface StyleMap {
  version: 1;
  defaults: {
    fontFamily: string | null;
    fontSizePt: number | null;
    color: string | null;
  };
  elements: {
    name: StyleEntry;
    sectionHeading: StyleEntry;
    jobTitle: StyleEntry;
    body: StyleEntry;
    bullet: StyleEntry;
  };
}

export interface ExtraAnswer {
  id: string;
  question: string;
  answer: string;
}

export interface ParsedResume {
  filename: string;
  resume_json: ResumeJson;
  style_map_json: StyleMap;
  warnings: string[];
}

export interface Profile {
  id: number;
  resume_filename: string | null;
  resume_json: ResumeJson | null;
  style_map_json: StyleMap | null;
  extra_answers_json: ExtraAnswer[] | null;
  extra_context: string | null;
  updated_at: string;
}

export const api = {
  auth: {
    status: () => fetchApi<{ authenticated: boolean }>("/auth/status"),
    login: (pin: string) => fetchApi<{ authenticated: true }>("/auth/login", { method: "POST", body: JSON.stringify({ pin }) }),
    logout: () => fetchApi<{ authenticated: false }>("/auth/logout", { method: "POST" }),
  },
  profile: {
    get: () => fetchApi<Profile | null>("/profile"),
    update: (data: Partial<Pick<Profile, 'resume_json' | 'style_map_json' | 'extra_answers_json' | 'extra_context'>>) =>
      fetchApi<Profile>("/profile", { method: "PATCH", body: JSON.stringify(data) }),
    // Upload + parse, WITHOUT committing. Returns the structure for review.
    parseResume: (file: File) => {
      const formData = new FormData();
      formData.append("resume", file);
      return fetchMultipart<ParsedResume>("/profile/resume/parse", formData);
    },
    // Commit a reviewed (possibly corrected) resume.
    confirmResume: (data: { filename: string; resume_json: ResumeJson; style_map_json: StyleMap }) =>
      fetchApi<Profile>("/profile/resume", { method: "PUT", body: JSON.stringify(data) }),
    // Download the original .docx (formatting reference).
    getResumeUrl: () => `${BASE_PATH}/profile/resume`,
    // Download a full backup (SQLite + generated docs) as a .zip.
    getExportUrl: () => `${BASE_PATH}/profile/export`,
  },
  jobs: {
    list: () => fetchApi<Job[]>("/jobs"),
    get: (id: number) => fetchApi<Job>(`/jobs/${id}`),
    extract: (data: { url?: string; posting_text?: string }) =>
      fetchApi<ExtractResponse>("/jobs/extract", { method: "POST", body: JSON.stringify(data) }),
    extractImage: (files: File[]) => {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      return fetchMultipart<ExtractResponse>("/jobs/extract-image", fd);
    },
    create: (data: { title: string; company?: string; location?: string; work_arrangement?: WorkArrangement; source_url?: string; posting_text?: string; brief?: boolean; assessment?: JobAssessment }) =>
      fetchApi<Job>("/jobs", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Pick<Job, 'title' | 'company' | 'location' | 'work_arrangement' | 'source_url' | 'posting_text' | 'status'>>) =>
      fetchApi<Job>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi<void>(`/jobs/${id}`, { method: "DELETE" }),
    assess: (id: number) => fetchApi<Document>(`/jobs/${id}/assess`, { method: "POST" }),
    // Multipart: the server owns the transcript, so we send only the new
    // question plus any attached files, and get the full transcript back.
    chat: (id: number, message: string, files: File[] = []) => {
      const fd = new FormData();
      fd.append("message", message);
      files.forEach((f) => fd.append("files", f));
      return fetchMultipart<{ reply: string; messages: ChatMessage[] }>(`/jobs/${id}/chat`, fd);
    },
    getChat: (id: number) => fetchApi<{ messages: ChatMessage[] }>(`/jobs/${id}/chat`),
    clearChat: (id: number) => fetchApi<void>(`/jobs/${id}/chat`, { method: "DELETE" }),
    // Tailoring flow
    tailorStart: (id: number) => fetchApi<TailorResult>(`/jobs/${id}/tailor`, { method: "POST" }),
    recordQa: (id: number, data: { question: string; answer: string }) =>
      fetchApi<{ extra_answers: unknown[] }>(`/jobs/${id}/qa`, { method: "POST", body: JSON.stringify(data) }),
    tailorFinalize: (id: number, data: { answers: { question: string; answer: string }[]; current_resume: ResumeJson }) =>
      fetchApi<TailorResult>(`/jobs/${id}/tailor/finalize`, { method: "POST", body: JSON.stringify(data) }),
    tailorRevise: (id: number, data: { proposed_resume: ResumeJson; edit_request: string }) =>
      fetchApi<TailorResult>(`/jobs/${id}/tailor/revise`, { method: "POST", body: JSON.stringify(data) }),
    tailorApprove: (id: number, data: { proposed_resume: ResumeJson }) =>
      fetchApi<Document>(`/jobs/${id}/tailor/approve`, { method: "POST", body: JSON.stringify(data) }),
    // Cover letters
    coverLetterStart: (id: number) => fetchApi<CoverLetterResult>(`/jobs/${id}/cover-letters`, { method: "POST" }),
    coverLetterFinalize: (id: number, data: { answers: { question: string; answer: string }[]; current: CoverLetterResult }) =>
      fetchApi<CoverLetterResult>(`/jobs/${id}/cover-letters/finalize`, { method: "POST", body: JSON.stringify(data) }),
    coverLetterRevise: (id: number, data: { current: CoverLetterResult; edit_request: string }) =>
      fetchApi<CoverLetterResult>(`/jobs/${id}/cover-letters/revise`, { method: "POST", body: JSON.stringify(data) }),
    coverLetterApprove: (id: number, data: { full: CoverLetterFull; short: string }) =>
      fetchApi<{ documents: Document[] }>(`/jobs/${id}/cover-letters/approve`, { method: "POST", body: JSON.stringify(data) }),
    // Application questions
    questionsStart: (id: number, data: { questions: string }) =>
      fetchApi<AppQuestionsResult>(`/jobs/${id}/questions`, { method: "POST", body: JSON.stringify(data) }),
    questionsFinalize: (id: number, data: { questions: string; answers: { question: string; answer: string }[] }) =>
      fetchApi<AppQuestionsResult>(`/jobs/${id}/questions/finalize`, { method: "POST", body: JSON.stringify(data) }),
    questionsSave: (id: number, data: { answers: { question: string; answer: string }[] }) =>
      fetchApi<{ saved: number }>(`/jobs/${id}/questions/save`, { method: "POST", body: JSON.stringify(data) }),
  },
  documents: {
    list: (jobId: number) => fetchApi<Document[]>(`/jobs/${jobId}/documents`),
    getDownloadUrl: (id: number, format: "docx" | "pdf") => `${BASE_PATH}/documents/${id}/download/${format}`,
    regenerate: (id: number) => fetchApi<Document>(`/documents/${id}/regenerate`, { method: "POST" }),
  },
  discover: {
    getSettings: () => fetchApi<DiscoverSettings>("/discover/settings"),
    updateSettings: (settings: DiscoverSettings) =>
      fetchApi<DiscoverSettings>("/discover/settings", { method: "PUT", body: JSON.stringify(settings) }),
    // Runs the whole pipeline using the saved settings (or an inline override).
    search: (override?: DiscoverSettings) =>
      fetchApi<DiscoverSearchResponse>("/discover/search", {
        method: "POST",
        body: JSON.stringify(override ?? {}),
      }),
    dismiss: (url: string) =>
      fetchApi<{ dismissed: true }>("/discover/dismiss", { method: "POST", body: JSON.stringify({ url }) }),
  },

  website: {
    get: () => fetchApi<{ config: WebsiteConfig; has_resume: boolean }>("/website"),
    save: (config: WebsiteConfig) =>
      fetchApi<{ config: WebsiteConfig }>("/website", { method: "PUT", body: JSON.stringify({ config }) }),
    draft: () =>
      fetchApi<{ headline: string; tagline: string; bio: string; about: string }>("/website/draft", {
        method: "POST",
      }),
    write: (field: string, current: string, instruction: string) =>
      fetchApi<{ text: string }>("/website/write", {
        method: "POST",
        body: JSON.stringify({ field, current, instruction }),
      }),
    exportUrl: () => `${BASE_PATH}/website/export`,
    previewUrl: (page = "index") => `${BASE_PATH}/website/preview?page=${encodeURIComponent(page)}`,
  },
};
