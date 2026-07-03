import React, { useState, useEffect } from "react";
import { useProfile, useUpdateProfile, useUploadResume } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FileUp, FileText, Download, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export default function Profile() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadResume = useUploadResume();

  const [resumeJson, setResumeJson] = useState("");
  const [styleMapJson, setStyleMapJson] = useState("");
  const [extraAnswersJson, setExtraAnswersJson] = useState("");

  // Keep local state in sync with server state
  useEffect(() => {
    if (profile) {
      setResumeJson(profile.resume_json ? JSON.stringify(profile.resume_json, null, 2) : "{\n  \n}");
      setStyleMapJson(profile.style_map_json ? JSON.stringify(profile.style_map_json, null, 2) : "{\n  \n}");
      setExtraAnswersJson(profile.extra_answers_json ? JSON.stringify(profile.extra_answers_json, null, 2) : "{\n  \n}");
    }
  }, [profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.docx')) {
      toast.error("Invalid file type", { description: "Only .docx files are accepted" });
      return;
    }

    uploadResume.mutate(file, {
      onSuccess: () => {
        toast.success("Resume uploaded successfully");
      },
      onError: (err) => {
        toast.error("Failed to upload resume", { description: err.message });
      }
    });
  };

  const handleSaveJson = (field: 'resume_json' | 'style_map_json' | 'extra_answers_json', value: string) => {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      toast.error("Invalid JSON", { description: `Please check your formatting in the ${field.replace(/_/g, ' ')} field.` });
      return;
    }

    updateProfile.mutate({ [field]: parsed }, {
      onSuccess: () => {
        toast.success("Profile saved");
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10 animate-in fade-in duration-500 max-w-3xl">
      <div>
        <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your core professional details and preferences.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 text-primary rounded-xl">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Base Resume</h3>
            <p className="text-sm text-muted-foreground">Upload your standard .docx resume. This forms the foundation for AI tailoring.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-border">
          <div className="flex-1 w-full bg-muted/30 border border-border rounded-xl p-4 flex items-center justify-between">
            {profile?.resume_filename ? (
              <div className="flex items-center gap-3 truncate pr-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium truncate">{profile.resume_filename}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">No resume uploaded yet</div>
            )}
            
            {profile?.resume_filename && (
              <Button variant="ghost" size="sm" asChild className="shrink-0">
                <a href={api.profile.getResumeUrl()} target="_blank" rel="noreferrer">
                  <Download className="w-4 h-4 mr-2" /> Download
                </a>
              </Button>
            )}
          </div>

          <div className="relative shrink-0 w-full sm:w-auto">
            <input 
              type="file" 
              accept=".docx" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              onChange={handleFileChange}
              disabled={uploadResume.isPending}
            />
            <Button className="w-full rounded-xl" variant={profile?.resume_filename ? "outline" : "default"} disabled={uploadResume.isPending}>
              <FileUp className="w-4 h-4 mr-2" />
              {uploadResume.isPending ? "Uploading..." : profile?.resume_filename ? "Replace File" : "Upload .docx"}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-xl font-serif font-semibold">Structured Data</h3>
        <p className="text-sm text-muted-foreground -mt-4">
          These configurations guide the AI tailoring process. Currently they are edited as raw JSON.
        </p>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-base font-semibold">Professional Details (JSON)</Label>
            <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => handleSaveJson('resume_json', resumeJson)} disabled={updateProfile.isPending}>
              <Save className="w-4 h-4 mr-2" /> Save
            </Button>
          </div>
          <Textarea 
            value={resumeJson} 
            onChange={(e) => setResumeJson(e.target.value)}
            className="font-mono text-sm min-h-[200px] bg-muted/20" 
            placeholder="{}"
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-base font-semibold">Writing Style Map (JSON)</Label>
            <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => handleSaveJson('style_map_json', styleMapJson)} disabled={updateProfile.isPending}>
              <Save className="w-4 h-4 mr-2" /> Save
            </Button>
          </div>
          <Textarea 
            value={styleMapJson} 
            onChange={(e) => setStyleMapJson(e.target.value)}
            className="font-mono text-sm min-h-[200px] bg-muted/20" 
            placeholder="{}"
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-base font-semibold">Extra Answers (JSON)</Label>
            <Button size="sm" variant="secondary" className="rounded-lg" onClick={() => handleSaveJson('extra_answers_json', extraAnswersJson)} disabled={updateProfile.isPending}>
              <Save className="w-4 h-4 mr-2" /> Save
            </Button>
          </div>
          <Textarea 
            value={extraAnswersJson} 
            onChange={(e) => setExtraAnswersJson(e.target.value)}
            className="font-mono text-sm min-h-[200px] bg-muted/20" 
            placeholder="{}"
          />
        </div>
      </div>
    </div>
  );
}