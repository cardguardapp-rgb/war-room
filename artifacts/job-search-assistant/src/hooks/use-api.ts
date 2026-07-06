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

// Upload + parse a resume for review (does NOT commit).
export function useParseResume() {
  return useMutation({
    mutationFn: (file: File) => api.profile.parseResume(file),
  });
}

// Commit a reviewed resume.
export function useConfirmResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.profile.confirmResume>[0]) =>
      api.profile.confirmResume(data),
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

export function useExtractJob() {
  return useMutation({
    mutationFn: (data: Parameters<typeof api.jobs.extract>[0]) => api.jobs.extract(data),
  });
}

export function useTailorStart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.jobs.tailorStart(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.job(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

export function useRecordQa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { question: string; answer: string } }) =>
      api.jobs.recordQa(id, data),
    onSuccess: () => {
      // A new saved answer landed on the profile.
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useTailorFinalize() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.tailorFinalize>[1] }) =>
      api.jobs.tailorFinalize(id, data),
  });
}

export function useTailorRevise() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.tailorRevise>[1] }) =>
      api.jobs.tailorRevise(id, data),
  });
}

export function useTailorApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.tailorApprove>[1] }) =>
      api.jobs.tailorApprove(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.job(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents(id) });
    },
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

export function useRegenerateDocument(jobId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.documents.regenerate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents(jobId) });
    },
  });
}

/** Generate/refresh the fit assessment for an existing job (from its posting). */
export function useAssessJob(jobId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.jobs.assess(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents(jobId) });
    },
  });
}

// Cover letters
export function useCoverLetterStart() {
  return useMutation({ mutationFn: (id: number) => api.jobs.coverLetterStart(id) });
}
export function useCoverLetterFinalize() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.coverLetterFinalize>[1] }) =>
      api.jobs.coverLetterFinalize(id, data),
  });
}
export function useCoverLetterRevise() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.coverLetterRevise>[1] }) =>
      api.jobs.coverLetterRevise(id, data),
  });
}
export function useCoverLetterApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.coverLetterApprove>[1] }) =>
      api.jobs.coverLetterApprove(id, data),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents(id) });
    },
  });
}

// Application questions
export function useQuestionsStart() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { questions: string } }) =>
      api.jobs.questionsStart(id, data),
  });
}
export function useQuestionsFinalize() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.questionsFinalize>[1] }) =>
      api.jobs.questionsFinalize(id, data),
  });
}
export function useQuestionsSave() {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof api.jobs.questionsSave>[1] }) =>
      api.jobs.questionsSave(id, data),
  });
}

// Discover
export function useDiscoverSettings() {
  return useQuery({
    queryKey: ['discover', 'settings'],
    queryFn: () => api.discover.getSettings(),
  });
}

export function useSaveDiscoverSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Parameters<typeof api.discover.updateSettings>[0]) =>
      api.discover.updateSettings(settings),
    onSuccess: (data) => {
      queryClient.setQueryData(['discover', 'settings'], data);
    },
  });
}

export function useDiscoverSearch() {
  return useMutation({
    mutationFn: (override?: Parameters<typeof api.discover.search>[0]) =>
      api.discover.search(override),
  });
}

export function useDismissDiscover() {
  return useMutation({
    mutationFn: (url: string) => api.discover.dismiss(url),
  });
}
