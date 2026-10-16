import { useEffect, useRef, useState } from "react";
import { useLogin, useAuthStatus } from "@/hooks/use-api";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const PIN_PATTERN = /^\d{6,8}$/;

function formatWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Login() {
  const [pin, setPin] = useState("");
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const login = useLogin();
  const { data: auth, isLoading: authLoading } = useAuthStatus();

  // If already authenticated, redirect
  useEffect(() => {
    if (auth?.authenticated) {
      setLocation("/jobs");
    }
  }, [auth, setLocation]);

  const waitSeconds = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = waitSeconds > 0;

  // Tick the countdown while locked, then hand focus back to the field.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        window.clearInterval(timer);
        inputRef.current?.focus();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  if (authLoading || auth?.authenticated) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin) || locked) return;

    login.mutate(pin, {
      onSuccess: () => {
        setLocation("/jobs");
      },
      onError: (err) => {
        setPin("");
        if (err instanceof ApiError && err.status === 429) {
          const seconds = Number(err.data.retry_after_seconds) || 30;
          const t = Date.now();
          setNow(t);
          setLockedUntil(t + seconds * 1000);
          toast.error("Too many incorrect PINs");
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          toast.error("Incorrect PIN", { description: "Please try again." });
        } else {
          toast.error(err.message);
        }
        inputRef.current?.focus();
      },
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background shapes */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-chart-2/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm flex flex-col items-center relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-8 shadow-sm">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <path d="M7 7h10"/>
            <path d="M7 12h10"/>
            <path d="M7 17h10"/>
          </svg>
        </div>

        <h1 className="text-3xl font-serif font-semibold text-center mb-2">Welcome back</h1>
        <p className="text-muted-foreground text-center mb-10">Enter your PIN to access your war room.</p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col items-center gap-8">
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            aria-label="PIN"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            autoFocus
            disabled={login.isPending || locked}
            className="h-16 md:h-16 text-center text-3xl md:text-3xl tracking-[0.5em] border-2 border-border rounded-xl bg-card shadow-sm focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20"
          />

          <Button
            type="submit"
            size="lg"
            className="w-full h-14 text-lg rounded-xl shadow-md"
            disabled={!PIN_PATTERN.test(pin) || login.isPending || locked}
          >
            {login.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : locked ? (
              `Try again in ${formatWait(waitSeconds)}`
            ) : (
              "Enter"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
