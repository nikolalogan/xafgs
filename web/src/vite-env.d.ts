/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIFY_STUDIO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

