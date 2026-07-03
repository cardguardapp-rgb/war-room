import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, Job, Profile } from "@/lib/api";

// Keys
export const queryKeys = {
  authStatus: ['auth', 'status'] as const,
  profile: ['profile'] as const,
  jobs: ['jobs'] as const,
  job: (id: number) => ['jobs', id] as const,
  documents: (jobId: number) => ['jobs', jobId, 'documents'] as const,
};

// Auth Hooks
export function useAuthStatus() {
  return useQuery({
    queryKey: queryKeys.authStatus,
    queryFn: () => api.auth.status(),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pin: string) => api.auth.login(pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.authStatus });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/";
    },
  });
}

// Profile Hooks
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => api.profile.get(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.profile.update>[0]) => api.profile.update(data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile, data);
    },
  });
}

export function useUploadResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.profile.uploadResume(file),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile, data);
    },
  });
}

// Jobs Hooks
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => api.jobs.list(),
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: queryKeys.job(id),
    queryFn: () => api.jobs.get(id),
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.jobs.create>[0]) => api.jobs.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number, data: Parameters<typeof api.jobs.update>[1] }) => api.jobs.update(id, data),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.job(data.id), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

export function useDeleteJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.jobs.delete(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
      queryClient.removeQueries({ queryKey: queryKeys.job(id) });
    },
  });
}

export function useTailorJob() {
  return useMutation({
    mutationFn: (id: number) => api.jobs.tailor(id),
  });
}

// Documents Hooks
export function useDocuments(jobId: number) {
  return useQuery({
    queryKey: queryKeys.documents(jobId),
    queryFn: () => api.documents.list(jobId),
    enabled: !!jobId,
  });
}

export function useGenerateDocument() {
  return useMutation({
    mutationFn: ({ jobId, type }: { jobId: number, type: 'resume' | 'cover_letter' | 'cover_letter_plain' | 'cover_note' }) => 
      api.documents.generate(jobId, type),
  });
}

export function useDiscoverSearch(query: string = "") {
  return useQuery({
    queryKey: ['discover', query],
    queryFn: () => api.discover.search(query),
  });
}
