import React from "react";
import { Switch, Route } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import Login from "@/pages/login";
import Jobs from "@/pages/jobs";
import JobDetail from "@/pages/job-detail";
import Profile from "@/pages/profile";
import Discover from "@/pages/discover";
import Website from "@/pages/website";
const NotFound = () => <div className="p-10 text-center text-xl font-serif text-muted-foreground">Page not found</div>;

import { useAuthStatus } from "@/hooks/use-api";
import { Loader2 } from "lucide-react";

export function AppRouter() {
  const { data: auth, isLoading } = useAuthStatus();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!auth?.authenticated) {
    return <Login />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Jobs} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/jobs/:id" component={JobDetail} />
        <Route path="/profile" component={Profile} />
        <Route path="/discover" component={Discover} />
        <Route path="/website" component={Website} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}