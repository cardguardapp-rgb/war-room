import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** A slim banner shown whenever the browser reports it's offline. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-amber-950 text-sm font-medium px-4 py-2 flex items-center justify-center gap-2 shadow-md pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      You're offline — changes won't save until you reconnect.
    </div>
  );
}
