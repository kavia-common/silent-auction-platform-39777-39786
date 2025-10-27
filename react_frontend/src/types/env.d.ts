declare namespace NodeJS {
  interface ProcessEnv {
    REACT_APP_SUPABASE_URL?: string;
    REACT_APP_SUPABASE_KEY?: string;
    REACT_APP_DEBUG_STORAGE?: string; // "true" to enable temporary debug storage listing
  }
}
