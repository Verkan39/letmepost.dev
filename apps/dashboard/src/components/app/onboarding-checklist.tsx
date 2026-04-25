"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CaretDown, CheckCircle, Circle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export type ChecklistStep = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  body: React.ReactNode;
};

/**
 * First-run checklist. One bordered card with divided rows; only one row
 * expands at a time. Body opens with a height + opacity + blur transition.
 * The default-open row is the first incomplete step — completed steps stay
 * collapsed unless the user clicks them.
 */
export function OnboardingChecklist({ steps }: { steps: ChecklistStep[] }) {
  const firstIncomplete = steps.findIndex((s) => !s.done);
  const [open, setOpen] = useState<string>(
    firstIncomplete >= 0 ? steps[firstIncomplete].id : "",
  );

  // Auto-advance: when a step transitions from done:false → done:true,
  // collapse it and open the next incomplete one. Tracks per-id done state
  // so adding/reordering steps doesn't misfire.
  const prevDone = useRef<Record<string, boolean>>(
    Object.fromEntries(steps.map((s) => [s.id, s.done])),
  );
  const doneKey = steps.map((s) => `${s.id}:${s.done}`).join("|");
  useEffect(() => {
    for (const s of steps) {
      const was = prevDone.current[s.id];
      if (was === false && s.done) {
        const idx = steps.findIndex((x) => x.id === s.id);
        const next = steps.slice(idx + 1).find((x) => !x.done);
        setOpen(next ? next.id : "");
        break;
      }
    }
    prevDone.current = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneKey]);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;

  return (
    <div className="bg-card ring-1 ring-foreground/15">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
        <h2 className="text-sm font-semibold">Get set up</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {completed} / {total}
        </span>
      </div>
      <div className="divide-y divide-foreground/10">
        {steps.map((step) => (
          <ChecklistItem
            key={step.id}
            step={step}
            isOpen={open === step.id}
            onToggle={() =>
              setOpen((prev) => (prev === step.id ? "" : step.id))
            }
          />
        ))}
      </div>
    </div>
  );
}

function ChecklistItem({
  step,
  isOpen,
  onToggle,
}: {
  step: ChecklistStep;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        {step.done ? (
          <CheckCircle
            weight="fill"
            className="size-4 text-primary shrink-0"
          />
        ) : (
          <Circle className="size-4 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-sm font-medium",
              step.done && "text-muted-foreground line-through",
            )}
          >
            {step.title}
          </div>
          {!step.done ? (
            <div className="text-xs text-muted-foreground truncate">
              {step.description}
            </div>
          ) : null}
        </div>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="text-muted-foreground"
        >
          <CaretDown className="size-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0, filter: "blur(6px)" }}
            animate={{
              height: "auto",
              opacity: 1,
              filter: "blur(0px)",
              transition: {
                height: { duration: 0.32, ease: EASE_OUT },
                opacity: { duration: 0.28, delay: 0.04, ease: EASE_OUT },
                filter: { duration: 0.28, delay: 0.04, ease: EASE_OUT },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              filter: "blur(6px)",
              transition: {
                height: { duration: 0.24, ease: EASE_OUT },
                opacity: { duration: 0.18, ease: EASE_OUT },
                filter: { duration: 0.18, ease: EASE_OUT },
              },
            }}
            style={{ overflow: "hidden", willChange: "filter, opacity" }}
          >
            <div className="px-4 pb-4 pt-1">{step.body}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
