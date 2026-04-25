"use client";

import { motion, type Variants } from "framer-motion";
import { usePathname } from "next/navigation";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* Animations are blur-driven (filter: blur 6→0px) layered with a small
   y-offset and opacity. The blur sells "incoming" content without the
   janky transform-only feel; opacity-only would read as a flat fade. */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.32, ease: EASE_OUT },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0, filter: "blur(6px)" },
  show: {
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.26, ease: EASE_OUT },
  },
};

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};

/**
 * Page-level fade+blur on route change. No AnimatePresence — the previous
 * tree had `mode="wait"` + `display: contents`, and `contents` strips the
 * element from layout which breaks transform/filter rendering, producing
 * the flicker. Re-keying on pathname re-mounts the wrapper with an enter
 * animation; the outgoing page is replaced instantly, the incoming one
 * blurs in. No exit phase, no overlap, no flash.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      style={{ willChange: "filter, opacity, transform" }}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={fadeUp}
      transition={{ duration: 0.32, ease: EASE_OUT, delay }}
      className={className}
      style={{ willChange: "filter, opacity, transform" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={staggerParent}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={className}
      style={{ willChange: "filter, opacity, transform" }}
    >
      {children}
    </motion.div>
  );
}
