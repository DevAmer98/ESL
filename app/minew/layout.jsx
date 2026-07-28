"use client";
// Toast context for the whole Minew section (stores list + per-store console).
import { ToastProvider } from "@/components/ui";

export default function MinewSectionLayout({ children }) {
  return <ToastProvider>{children}</ToastProvider>;
}
