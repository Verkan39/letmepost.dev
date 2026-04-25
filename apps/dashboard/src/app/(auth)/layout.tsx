"use client";

import { motion } from "framer-motion";
import { Logo } from "@/components/app/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex min-h-screen items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md space-y-8"
      >
        <div className="flex flex-col items-center gap-3">
          <Logo size={48} />
          <div className="text-center space-y-1">
            <div className="text-xl font-semibold tracking-tight">
              letmepost.dev
            </div>
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              operator dashboard
            </div>
          </div>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
