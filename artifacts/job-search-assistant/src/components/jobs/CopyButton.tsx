import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path (needs a secure context — Replit is https).
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  // Legacy fallback for older mobile Safari / non-secure contexts.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = "Copy text",
  className,
  size = "sm",
  variant = "outline",
}: {
  text: string;
  label?: string;
  className?: string;
  size?: "sm" | "default" | "icon";
  variant?: "outline" | "secondary" | "ghost";
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={onClick} className={className}>
      {copied ? (
        <>
          <Check className="w-4 h-4 mr-1.5 text-emerald-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="w-4 h-4 mr-1.5" /> {label}
        </>
      )}
    </Button>
  );
}
