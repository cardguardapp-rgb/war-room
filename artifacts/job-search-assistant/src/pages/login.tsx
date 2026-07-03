import { useEffect, useState } from "react";
import { useLogin, useAuthStatus } from "@/hooks/use-api";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [pin, setPin] = useState("");
  const [, setLocation] = useLocation();
  const login = useLogin();
  const { data: auth, isLoading: authLoading } = useAuthStatus();

  // If already authenticated, redirect
  useEffect(() => {
    if (auth?.authenticated) {
      setLocation("/jobs");
    }
  }, [auth, setLocation]);

  if (authLoading || auth?.authenticated) {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) return;

    login.mutate(pin, {
      onSuccess: () => {
        setLocation("/jobs");
      },
      onError: () => {
        toast.error("Incorrect PIN", {
          description: "Please try again."
        });
        setPin("");
      }
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
          <InputOTP
            maxLength={4}
            value={pin}
            onChange={setPin}
            autoFocus
            disabled={login.isPending}
          >
            <InputOTPGroup className="gap-4">
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="w-14 h-16 text-2xl border-2 border-border rounded-xl bg-card shadow-sm data-[active=true]:border-primary data-[active=true]:ring-4 data-[active=true]:ring-primary/20 transition-all"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          <Button 
            type="submit" 
            size="lg" 
            className="w-full h-14 text-lg rounded-xl shadow-md"
            disabled={pin.length !== 4 || login.isPending}
          >
            {login.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              "Enter"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}