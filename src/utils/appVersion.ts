import { useState, useEffect } from "react";

declare const __APP_VERSION__: string | undefined;

const initialVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "v0.1.3";
let cachedVersion = initialVersion;

export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(cachedVersion);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      import("@tauri-apps/api/app")
        .then(({ getVersion }) => getVersion())
        .then((v) => {
          if (v) {
            const formatted = `v${v}`;
            cachedVersion = formatted;
            setVersion(formatted);
          }
        })
        .catch(() => {});
    }
  }, []);

  return version;
}
