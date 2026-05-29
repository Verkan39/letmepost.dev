"use client";

import * as React from "react";
import {
  CaretLeft,
  CaretRight,
  CaretDoubleLeft,
  CaretDoubleRight,
} from "@phosphor-icons/react";
import { DayPicker, type DayPickerProps } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";

export type CalendarProps = DayPickerProps;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 [--rdp-accent-color:var(--color-primary)]", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "space-y-3",
        month_caption: "flex items-center justify-center pt-1 relative",
        caption_label: "text-sm font-semibold",
        nav: "flex items-center gap-1 absolute right-0 top-1",
        button_previous:
          "inline-flex items-center justify-center size-6 rounded hover:bg-muted/60 transition-colors disabled:opacity-30",
        button_next:
          "inline-flex items-center justify-center size-6 rounded hover:bg-muted/60 transition-colors disabled:opacity-30",
        month_grid: "w-full border-collapse mt-2",
        weekdays: "flex",
        weekday:
          "text-muted-foreground w-9 font-normal text-[0.7rem] uppercase tracking-wide",
        week: "flex w-full mt-1",
        day: "size-9 text-center text-sm p-0 relative",
        day_button:
          "size-9 inline-flex items-center justify-center rounded hover:bg-muted/60 transition-colors aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:hover:bg-primary",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary focus:bg-primary",
        today: "font-semibold text-primary",
        outside: "text-muted-foreground/40",
        disabled: "text-muted-foreground/40 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...iconProps }) => {
          const map = {
            left: CaretLeft,
            right: CaretRight,
            up: CaretDoubleLeft,
            down: CaretDoubleRight,
          } as const;
          const Icon = map[orientation ?? "right"];
          return <Icon {...iconProps} className="size-4" />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
