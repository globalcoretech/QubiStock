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

  // 2. Parse command parameter names in Rust
  const rustFiles = [commandsRsPath];
  const commandParams = new Map<string, Set<string>>();

  for (const rf of rustFiles) {
    if (!fs.existsSync(rf)) continue;
    const content = fs.readFileSync(rf, "utf-8");
    const cmdRegex =
      /#\[command\]\s*(?:#\[[^\]]+\]\s*)*pub\s+fn\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:->\s*[^{]+)?\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = cmdRegex.exec(content)) !== null) {
      const fnName = m[1];
      const rawArgs = m[2].trim();
      const params = new Set<string>();

      if (rawArgs.length > 0) {
        let depth = 0;
        let current = "";
        const parts: string[] = [];
        for (const ch of rawArgs) {
          if (ch === "<") depth++;
          else if (ch === ">") depth--;
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
            const pName = p.substring(0, colonIdx).trim();
            const pType = p.substring(colonIdx + 1).trim();
            if (pType !== "AppHandle" && !pType.startsWith("State<")) {
              params.add(pName);
              params.add(snakeToCamel(pName));
              params.add(camelToSnake(pName));
            }
          }
        }
      }
      commandParams.set(fnName, params);
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
  interface FrontendInvoke {
    file: string;
    line: number;
    cmdName: string;
    argKeys: string[];
  }
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
            if (colonIdx !== -1) {
              key = it.substring(0, colonIdx).trim().replace(/['"]/g, "");
            } else {
              const trimmed = it.trim();
              if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
                key = trimmed;
              }
            }
            if (key && !key.startsWith("...")) {
              argKeys.push(key);
            }
          }
        }
      }

      frontendInvokes.push({
        file: rel,
        line,
        cmdName,
        argKeys,
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
        // Rust commands that accept a wrapped payload allow `payload`
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
});
