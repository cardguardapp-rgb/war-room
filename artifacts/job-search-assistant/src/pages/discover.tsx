import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Compass, Loader2 } from "lucide-react";
import { useDiscoverSearch } from "@/hooks/use-api";

export default function Discover() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  
  const { data, isLoading, isFetching } = useDiscoverSearch(searchTerm);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(query);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-serif font-semibold text-foreground tracking-tight">Discover</h1>
        <p className="text-muted-foreground mt-1 text-sm">Find new opportunities that match your profile.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, skill, or company..." 
            className="pl-10 h-12 text-base rounded-xl bg-card border-border shadow-sm"
          />
        </div>
        <Button type="submit" className="h-12 px-6 rounded-xl shrink-0" disabled={isFetching}>
          {isFetching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
        </Button>
      </form>

      <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mb-6 relative">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping [animation-duration:3s]" />
          <Compass className="w-10 h-10 text-primary" />
        </div>
        
        <h2 className="text-2xl font-serif font-semibold mb-3">Discovery is coming soon</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-8 text-balance">
          We're building an intelligent search engine that finds roles tailored perfectly to your base resume and style map.
        </p>
        
        {data?.message && (
          <div className="inline-block px-4 py-2 bg-muted rounded-lg text-sm text-muted-foreground">
            API says: {data.message}
          </div>
        )}
      </div>
    </div>
  );
}