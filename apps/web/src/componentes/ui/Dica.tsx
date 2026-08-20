import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { unir_classes } from "../../lib/unir-classes";

export function ProvedorDica({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
      {children}
    </Tooltip.Provider>
  );
}

export function Dica({
  texto,
  children,
  className,
}: {
  texto: string;
  children: ReactNode;
  className?: string;
}) {
  if (!texto.trim()) return children;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={unir_classes(
            "z-50 max-w-sm rounded-lg border border-borda bg-superficie-alta px-2.5 py-1.5 text-xs leading-snug break-words text-texto shadow-lg",
            className,
          )}
        >
          {texto}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
