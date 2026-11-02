import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Helper to convert snake_case to camelCase
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Helper to convert camelCase to snake_case
function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

interface RustParam {
  name: string;
  type: string;
  isOption: boolean;
}

interface ArgDetail {
  key: string;
  value: string;
}

interface FrontendInvoke {
  file: string;
  line: number;
  cmdName: string;
  argKeys: string[];
  args: ArgDetail[];
  hasSpread: boolean;
}

describe("Invoke Guard: Rust commands and Frontend invoke contracts", () => {
  const rootDir = path.resolve(__dirname, "..", "..");
  const mainRsPath = path.join(rootDir, "src-tauri", "src", "main.rs");
  const commandsRsPath = path.join(rootDir, "src-tauri", "src", "commands.rs");

  // 1. Parse registered commands in main.rs
  const mainRsContent = fs.readFileSync(mainRsPath, "utf-8");
  const handlerMatch = mainRsContent.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  expect(handlerMatch, "tauri::generate_handler! must exist in main.rs").toBeTruthy();

  const registeredCommands = new Set(
    (handlerMatch ? handlerMatch[1] : "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^commands::/, ""))
  );

  // 2. Parse command parameter signatures in Rust
  const rustFiles = [commandsRsPath];
  const commandParams = new Map<string, Set<string>>();
  const commandSignatures = new Map<string, RustParam[]>();

  for (const rf of rustFiles) {
    if (!fs.existsSync(rf)) continue;
    const content = fs.readFileSync(rf, "utf-8");
    const cmdRegex =
      /#\[command\]\s*(?:#\[[^\]]+\]\s*)*pub\s+fn\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:->\s*[^{]+)?\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = cmdRegex.exec(content)) !== null) {
      const fnName = m[1];
      const rawArgs = m[2].trim();
      const paramsSet = new Set<string>();
      const paramsList: RustParam[] = [];

      if (rawArgs.length > 0) {
        let depth = 0;
        let current = "";
        const parts: string[] = [];
        for (const ch of rawArgs) {
          if (ch === "<" || ch === "(") depth++;
          else if (ch === ">" || ch === ")") depth--;
          if (ch === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        if (current.trim()) parts.push(current.trim());

        for (const p of parts) {
          const colonIdx = p.indexOf(":");
          if (colonIdx !== -1) {
            const pName = p.substring(0, colonIdx).trim().replace(/^mut\s+/, "");
            const pType = p.substring(colonIdx + 1).trim();
            if (pType !== "AppHandle" && !pType.startsWith("State<")) {
              const isOption = pType.startsWith("Option<");
              paramsSet.add(pName);
              paramsSet.add(snakeToCamel(pName));
              paramsSet.add(camelToSnake(pName));
              paramsList.push({ name: pName, type: pType, isOption });
            }
          }
        }
      }
      commandParams.set(fnName, paramsSet);
      commandSignatures.set(fnName, paramsList);
    }
  }

  // 3. Collect frontend invoke calls
  function getFrontendFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFrontendFiles(fullPath));
      } else if (
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.includes(".test.") &&
        !file.includes("mockInvoke")
      ) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const frontendFiles = getFrontendFiles(path.join(rootDir, "src"));
  const frontendInvokes: FrontendInvoke[] = [];

  for (const f of frontendFiles) {
    const rel = path.relative(rootDir, f).replace(/\\/g, "/");
    const content = fs.readFileSync(f, "utf-8");
    const regex = /\binvoke(?:\s*<[^>]+>)?\s*\(\s*(['"][a-zA-Z0-9_]+['"])/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const cmdName = match[1].replace(/['"]/g, "");
      const startIdx = match.index;
      const line = content.substring(0, startIdx).split("\n").length;

      // Extract matching invoke(...) call
      let depth = 0;
      let callStr = "";
      let foundStart = false;
      for (let i = startIdx; i < content.length; i++) {
        const ch = content[i];
        if (ch === "(") {
          depth++;
          foundStart = true;
        } else if (ch === ")") {
          depth--;
          if (foundStart && depth === 0) {
            callStr = content.substring(startIdx, i + 1);
            break;
          }
        }
      }

      const firstComma = callStr.indexOf(",");
      const argKeys: string[] = [];
      const args: ArgDetail[] = [];
      let hasSpread = false;

      if (firstComma !== -1) {
        const argObjStr = callStr.substring(firstComma + 1, callStr.length - 1).trim();
        if (argObjStr.startsWith("{")) {
          const inner = argObjStr.slice(1, -1);
          let innerDepth = 0;
          let cur = "";
          const items: string[] = [];
          for (const c of inner) {
            if (c === "{" || c === "[" || c === "(") innerDepth++;
            else if (c === "}" || c === "]" || c === ")") innerDepth--;
            if (c === "," && innerDepth === 0) {
              items.push(cur.trim());
              cur = "";
            } else {
              cur += c;
            }
          }
          if (cur.trim()) items.push(cur.trim());

          for (const it of items) {
            const colonIdx = it.indexOf(":");
            let key = "";
            let val = "";
            if (colonIdx !== -1) {
              key = it.substring(0, colonIdx).trim().replace(/['"]/g, "");
              val = it.substring(colonIdx + 1).trim();
            } else {
              const trimmed = it.trim();
              if (trimmed.startsWith("...")) {
                hasSpread = true;
              } else if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
                key = trimmed;
                val = trimmed;
              }
            }
            if (key) {
              argKeys.push(key);
              args.push({ key, value: val });
            }
          }
        }
      }

      frontendInvokes.push({
        file: rel,
        line,
        cmdName,
        argKeys,
        args,
        hasSpread,
      });
    }
  }

  it("ensures every frontend invoke targets a registered command in main.rs", () => {
    const missingInMain: string[] = [];
    for (const inv of frontendInvokes) {
      if (!registeredCommands.has(inv.cmdName)) {
        missingInMain.push(`${inv.file}:${inv.line} -> invoke("${inv.cmdName}")`);
      }
    }
    expect(
      missingInMain,
      `Frontend invokes commands that are not registered in main.rs: \n${missingInMain.join("\n")}`
    ).toEqual([]);
  });

  it("ensures every argument key passed in frontend invoke exists in the Rust command signature", () => {
    const mismatchedArgs: string[] = [];

    for (const inv of frontendInvokes) {
      const allowedParams = commandParams.get(inv.cmdName);
      if (!allowedParams) continue; // Checked in first test

      for (const k of inv.argKeys) {
        if (
          !allowedParams.has(k) &&
          !allowedParams.has(camelToSnake(k)) &&
          !allowedParams.has(snakeToCamel(k))
        ) {
          mismatchedArgs.push(
            `${inv.file}:${inv.line} invokes "${inv.cmdName}" with unknown argument "${k}" (valid: ${Array.from(allowedParams).join(", ")})`
          );
        }
      }
    }

    expect(
      mismatchedArgs,
      `Frontend passes argument keys that do not exist in Rust commands: \n${mismatchedArgs.join("\n")}`
    ).toEqual([]);
  });

  it("ensures frontend invoke does not omit any required (non-Option) Rust parameter", () => {
    const missingRequired: string[] = [];

    for (const inv of frontendInvokes) {
      const rustParams = commandSignatures.get(inv.cmdName);
      if (!rustParams) continue;

      const passedKeys = new Set(inv.argKeys);

      for (const p of rustParams) {
        if (!p.isOption) {
          const matches =
            passedKeys.has(p.name) ||
            passedKeys.has(snakeToCamel(p.name)) ||
            passedKeys.has("payload") ||
            inv.hasSpread;

          if (!matches) {
            missingRequired.push(
              `${inv.file}:${inv.line} calls "${inv.cmdName}" without required parameter "${p.name}: ${p.type}"`
            );
          }
        }
      }
    }

    expect(
      missingRequired,
      `Frontend invoke calls missing required parameters: \n${missingRequired.join("\n")}`
    ).toEqual([]);
  });

  it("ensures frontend invoke does not pass null or undefined for non-Option Rust parameters", () => {
    const nullViolations: string[] = [];

    for (const inv of frontendInvokes) {
      const rustParams = commandSignatures.get(inv.cmdName);
      if (!rustParams) continue;

      for (const arg of inv.args) {
        const matchingParam = rustParams.find(
          (p) => p.name === arg.key || snakeToCamel(p.name) === arg.key
        );

        if (matchingParam && !matchingParam.isOption) {
          const isNullOrUndefined = arg.value === "null" || arg.value === "undefined";
          if (isNullOrUndefined) {
            nullViolations.push(
              `${inv.file}:${inv.line} passes "${arg.value}" for non-Option Rust parameter "${matchingParam.name}: ${matchingParam.type}" in command "${inv.cmdName}"`
            );
          }
        }
      }
    }

    expect(
      nullViolations,
      `Frontend passes null/undefined to non-Option Rust parameters: \n${nullViolations.join("\n")}`
    ).toEqual([]);
  });

  describe("Tauri Capabilities & Permissions Guard", () => {
    const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
    const capabilitiesDir = path.join(rootDir, "src-tauri", "capabilities");

    it("verifies capabilities files exist, match real window labels, and grant required permissions for all frontend Tauri JS APIs", () => {
      // 1. Read real window labels from tauri.conf.json
      expect(fs.existsSync(tauriConfPath), "tauri.conf.json must exist").toBe(true);
      const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
      const configWindows: string[] = (tauriConf.app?.windows || []).map((w: any) => w.label);
      expect(configWindows.length, "at least one window must be configured in tauri.conf.json").toBeGreaterThan(0);

      // 2. Read capabilities directory
      expect(fs.existsSync(capabilitiesDir), "src-tauri/capabilities directory must exist").toBe(true);
      const capFiles = fs.readdirSync(capabilitiesDir).filter((f) => f.endsWith(".json"));
      expect(capFiles.length, "at least one capability JSON file must exist in src-tauri/capabilities").toBeGreaterThan(0);

      const grantedPermissions = new Set<string>();
      const windowLabelMismatches: string[] = [];

      for (const cf of capFiles) {
        const capPath = path.join(capabilitiesDir, cf);
        const cap = JSON.parse(fs.readFileSync(capPath, "utf-8"));

        // Validate window labels
        const capWindows: string[] = cap.windows || [];
        const matchesRealWindow = capWindows.some(
          (cw) => cw === "*" || configWindows.includes(cw)
        );
        if (!matchesRealWindow) {
          windowLabelMismatches.push(
            `${cf} targets windows [${capWindows.join(", ")}], but none match real window labels [${configWindows.join(", ")}]`
          );
        }

        for (const p of cap.permissions || []) {
          const permStr = typeof p === "string" ? p : p.identifier;
          if (permStr) grantedPermissions.add(permStr);
        }
      }

      expect(
        windowLabelMismatches,
        `Capability window labels must match real windows from tauri.conf.json: \n${windowLabelMismatches.join("\n")}`
      ).toEqual([]);

      // 3. Helper to check if a permission is satisfied by grantedPermissions
      const isPermitted = (prefix: string, specificAllow: string): boolean => {
        return (
          grantedPermissions.has(`${prefix}:default`) ||
          grantedPermissions.has(`${prefix}:*`) ||
          grantedPermissions.has(`${prefix}:${specificAllow}`) ||
          grantedPermissions.has("core:default")
        );
      };

      // 4. Scan frontend code for Event, Window, and Plugin APIs
      const permissionViolations: string[] = [];

      for (const f of frontendFiles) {
        const rel = path.relative(rootDir, f).replace(/\\/g, "/");
        const content = fs.readFileSync(f, "utf-8");
        const lines = content.split("\n");

        lines.forEach((lineText, idx) => {
          const lineNum = idx + 1;

          // Event API checks: listen, once, emit, unlisten
          const hasEventImport =
            lineText.includes("@tauri-apps/api/event") ||
            content.includes("@tauri-apps/api/event");

          if (hasEventImport) {
            const eventCalls = ["listen", "once", "emit", "unlisten"];
            for (const call of eventCalls) {
              const regex = new RegExp(`\\b${call}\\s*\\(`, "g");
              if (regex.test(lineText)) {
                const specific = `allow-${call}`;
                if (!isPermitted("core:event", specific)) {
                  permissionViolations.push(
                    `${rel}:${lineNum} uses event.${call}() without matching capability permission (requires 'core:event:default' or 'core:event:${specific}')`
                  );
                }
              }
            }
          }

          // Window API checks: imports from @tauri-apps/api/window or webviewWindow
          const hasWindowImport =
            lineText.includes("@tauri-apps/api/window") ||
            lineText.includes("@tauri-apps/api/webviewWindow");

          if (hasWindowImport) {
            const windowCalls = [
              "close",
              "destroy",
              "hide",
              "show",
              "setFocus",
              "minimize",
              "maximize",
              "unminimize",
              "onCloseRequested",
            ];
            for (const call of windowCalls) {
              const regex = new RegExp(`\\b${call}\\s*\\(`, "g");
              if (regex.test(lineText)) {
                const specific = `allow-${camelToSnake(call).replace(/_/g, "-")}`;
                if (!isPermitted("core:window", specific)) {
                  permissionViolations.push(
                    `${rel}:${lineNum} uses window.${call}() without matching capability permission (requires 'core:window:default' or 'core:window:${specific}')`
                  );
                }
              }
            }
          }

          // Plugin import checks: @tauri-apps/plugin-<name>
          const pluginMatch = lineText.match(/@tauri-apps\/plugin-([a-zA-Z0-9_-]+)/);
          if (pluginMatch) {
            const pluginName = pluginMatch[1];
            const hasPluginPerm =
              grantedPermissions.has(`${pluginName}:default`) ||
              grantedPermissions.has(`${pluginName}:*`) ||
              Array.from(grantedPermissions).some((p) => p.startsWith(`${pluginName}:`));

            if (!hasPluginPerm) {
              permissionViolations.push(
                `${rel}:${lineNum} imports '@tauri-apps/plugin-${pluginName}' without matching capability permission '${pluginName}:default'`
              );
            }
          }
        });
      }

      expect(
        permissionViolations,
        `Frontend uses Tauri APIs without required capabilities permissions: \n${permissionViolations.join("\n")}`
      ).toEqual([]);
    });
  });
});
