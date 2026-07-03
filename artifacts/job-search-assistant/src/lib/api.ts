import { QueryClient } from "@tanstack/react-query";

const BASE_PATH = "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_PATH}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

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
  const response = await fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

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

export type JobStatus = 'New' | 'Tailoring' | 'Ready' | 'Applied';

export interface Job {
  id: number;
  title: string;
  company: string | null;
  source_url: string | null;
  posting_text: string | null;
  status: JobStatus;
  created_at: string;
}

export interface Document {
  id: number;
  job_id: number;
  type: 'resume' | 'cover_letter' | 'cover_letter_plain' | 'cover_note';
  content_json: any;
  docx_path: string | null;
  pdf_path: string | null;
  created_at: string;
}

export interface Profile {
  id: number;
  resume_filename: string | null;
  resume_json: any;
  style_map_json: any;
  extra_answers_json: any;
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
    update: (data: Partial<Pick<Profile, 'resume_json' | 'style_map_json' | 'extra_answers_json'>>) => 
      fetchApi<Profile>("/profile", { method: "PATCH", body: JSON.stringify(data) }),
    uploadResume: (file: File) => {
      const formData = new FormData();
      formData.append("resume", file);
      return fetchMultipart<Profile>("/profile/resume", formData);
    },
    // For download we just use window.open or an anchor tag with credentials include
    getResumeUrl: () => `${BASE_PATH}/profile/resume`,
  },
  jobs: {
    list: () => fetchApi<Job[]>("/jobs"),
    get: (id: number) => fetchApi<Job>(`/jobs/${id}`),
    create: (data: { title: string, company?: string, source_url?: string, posting_text?: string }) => 
      fetchApi<Job>("/jobs", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Pick<Job, 'title' | 'company' | 'source_url' | 'posting_text' | 'status'>>) => 
      fetchApi<Job>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: number) => fetchApi<void>(`/jobs/${id}`, { method: "DELETE" }),
    tailor: (id: number) => fetchApi<{ status: string, message: string }>(`/jobs/${id}/tailor`, { method: "POST" }),
  },
  documents: {
    list: (jobId: number) => fetchApi<Document[]>(`/jobs/${jobId}/documents`),
    generate: (jobId: number, type: Document['type']) => 
      fetchApi<{ status: string, message: string }>(`/jobs/${jobId}/documents/generate`, { method: "POST", body: JSON.stringify({ type }) }),
    getDownloadUrl: (id: number) => `${BASE_PATH}/documents/${id}/download`,
  },
  discover: {
    search: (query?: string) => fetchApi<{ results: any[], message: string }>(`/discover/search${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  }
};
