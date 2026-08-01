import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const chaveAnonima = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !chaveAnonima) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configuradas — o login não vai funcionar até preencher o .env do apps/web.",
  );
}

export const clienteSupabase = createClient(url ?? "", chaveAnonima ?? "");
