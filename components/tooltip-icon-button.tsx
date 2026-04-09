"use client";

import { Button, type ButtonProps } from "@heroui/react";
import { ButtonHTMLAttributes, forwardRef } from "react";
import { Slot } from "radix-ui";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TooltipVariant = "default" | "outline" | "ghost" | "light" | "solid";
type TooltipSize = "default" | "sm" | "icon" | "icon-sm";

export type TooltipIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color" | "size" | "value"> & {
  variant?: TooltipVariant;
  size?: TooltipSize;
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", className, variant = "ghost", size = "icon", ...rest }, ref) => {
  const mappedVariant: ButtonProps["variant"] =
    variant === "outline" ? "outline" : variant === "default" || variant === "solid" ? "primary" : variant === "light" ? "secondary" : variant;
  const mappedSize: ButtonProps["size"] = size === "sm" || size === "icon-sm" ? "sm" : "md";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={mappedVariant}
            size={mappedSize}
            {...(rest as any)}
            className={cn("aui-button-icon min-w-0 size-8 p-1", className)}
            ref={ref}
            isIconOnly
          />
        }
      >
        <Slot.Slottable>{children}</Slot.Slottable>
        <span className="aui-sr-only sr-only">{tooltip}</span>
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
