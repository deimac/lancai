import { forwardRef, type InputHTMLAttributes } from "react";
import { formatar_valor_digitacao } from "../../lib/mascara-valor";
import { Campo } from "./Campo";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "inputMode" | "type"> & {
  value: string;
  onChange: (valorMascarado: string) => void;
};

export const CampoValor = forwardRef<HTMLInputElement, Props>(function CampoValor(
  { value, onChange, ...props },
  ref,
) {
  return (
    <Campo
      ref={ref}
      {...props}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(formatar_valor_digitacao(e.target.value))}
    />
  );
});
