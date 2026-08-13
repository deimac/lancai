/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL: string;
  /** Liga conectores sandbox do Open Finance no widget. Padrão: desligado. */
  readonly VITE_OPEN_FINANCE_INCLUDE_SANDBOX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
