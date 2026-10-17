import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The (i) tooltip — the only place help text goes. A popover rather than a
 * Radix tooltip so it opens on tap as well as click.
 */
export function InfoTip({ children, label = "More information" }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-11 w-11 md:h-7 md:w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 max-w-[calc(100vw-2rem)] text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}
