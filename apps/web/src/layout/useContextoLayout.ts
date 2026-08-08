import { useOutletContext } from "react-router-dom";
import type { ContextoLayout } from "./LayoutAutenticado";

export function useContextoLayout(): ContextoLayout | undefined {
  return useOutletContext<ContextoLayout | undefined>();
}
