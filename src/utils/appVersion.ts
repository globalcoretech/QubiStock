import { useState, useEffect } from "react";

let cachedVersion = "v0.1.2";

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
