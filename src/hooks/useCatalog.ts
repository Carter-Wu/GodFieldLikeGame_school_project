import { useEffect, useState } from "react";
import { loadCatalog, useLocalCatalog, allClasses } from "../model/catalog.ts";
import { supabase, onlineAvailable } from "../online/supabaseClient.ts";
import type { ClassDef } from "../model/classes.ts";

const CATALOG_TIMEOUT_MS = 5000;

export interface CatalogState {
  ready: boolean;
  source: string | null;
  classes: ClassDef[];
}

/** Load the game catalog once (Supabase with local fallback), mirroring main.js. */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ ready: false, source: null, classes: [] });

  useEffect(() => {
    let cancelled = false;
    async function run(): Promise<void> {
      if (!onlineAvailable) {
        useLocalCatalog();
        if (!cancelled) setState({ ready: true, source: "local", classes: allClasses() });
        return;
      }
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${CATALOG_TIMEOUT_MS} ms`)), CATALOG_TIMEOUT_MS)
        );
        await Promise.race([loadCatalog(supabase), timeout]);
        if (!cancelled) setState({ ready: true, source: "supabase", classes: allClasses() });
      } catch (err) {
        console.warn(`[catalog] Couldn't load from Supabase (${(err as Error).message}); using the local copy.`);
        useLocalCatalog();
        if (!cancelled) setState({ ready: true, source: "local", classes: allClasses() });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
