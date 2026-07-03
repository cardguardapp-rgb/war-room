import { Link, useLocation } from "wouter";
import { Briefcase, Search, User, LogOut } from "lucide-react";
import { useAuthStatus, useLogout } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const logout = useLogout();
  const { data: auth, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="w-12 h-12 rounded-full" />
          <Skeleton className="w-32 h-4" />
        </div>
      </div>
    );
  }

  // If not authenticated, we shouldn't be here (handled by router, but just in case)
  if (!auth?.authenticated) {
    return null;
  }

  const navItems = [
    { href: "/jobs", label: "Jobs", icon: Briefcase },
    { href: "/discover", label: "Discover", icon: Search },
    { href: "/profile", label: "Profile", icon: User },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-sidebar shrink-0 h-screen sticky top-0">
        <div className="p-6">
          <h1 className="text-2xl font-serif font-semibold text-primary">War Room</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0 relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-background sticky top-0 z-10">
          <h1 className="text-xl font-serif font-semibold text-primary">War Room</h1>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="w-5 h-5 text-muted-foreground" />
          </Button>
        </header>
        
        <div className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-background flex justify-around p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center p-2 rounded-xl min-w-[4rem] transition-colors ${
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-6 h-6 mb-1 ${isActive ? "fill-primary/20" : ""}`} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}