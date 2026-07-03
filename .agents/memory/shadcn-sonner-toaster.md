---
name: shadcn sonner Toaster needs no next-themes
description: The shadcn-generated ui/sonner.tsx wrapper calls next-themes' useTheme(); without a ThemeProvider it throws an unhandled useContext crash and no toasts render.
---

The shadcn/ui scaffold for sonner (`components/ui/sonner.tsx`) imports `useTheme` from `next-themes` to sync toast theme with the app. If the app has no `next-themes` `ThemeProvider` mounted anywhere (common in apps that don't implement dark-mode switching), calling `useTheme()` throws `Cannot read properties of null (reading 'useContext')`, which crashes the `<Toaster>` component with an uncaught error and silently prevents any toast from ever appearing — with no visible error in the UI itself (only in the browser console).

Also watch for having two different Toaster implementations in a shadcn scaffold: `components/ui/toaster.tsx` (Radix-based, paired with `useToast` from `hooks/use-toast.ts`) and `components/ui/sonner.tsx` (sonner-based, paired with `import { toast } from "sonner"`). If pages call `toast()` from `sonner` but `App.tsx` mounts the Radix `<Toaster />` (or vice versa), toasts silently never render — the two systems are unrelated and mounting the wrong one shows no error at all.

**Why:** discovered when clicking a "not implemented yet" action produced no visible toast and the console showed an "Invalid hook call" / `useContext` crash inside `<Toaster>`.

**How to apply:** when using shadcn's sonner Toaster in an app without theme switching, drop the `next-themes` import and hardcode `theme="light"` (or whatever fixed theme fits). Also always double check that the `<Toaster />` mounted in the app root matches the `toast` import used across the pages (both from `"sonner"`, or both from the Radix `use-toast` hook — not mixed).
