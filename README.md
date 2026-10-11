# QubiStock - Desktop Inventory App

A fast, offline-first desktop inventory and billing application designed for agricultural retail centers (Krishi Kendra), fertilizer, seed, and pesticide merchants. Built with **Tauri v2 + React + TypeScript + Rust + SQLite**.

---

## Getting Started / Kaise Chalana Hai

### Prerequisites
- Node.js (v18+)
- Rust & Cargo (`rustc --version`)

### Setup & Run
```bash
# 1. Install frontend dependencies
npm install

# 2. Run in development mode (Tauri Desktop App)
npm run tauri dev

# Or run frontend only in browser
npm run dev
```

---

## Running Tests / Tests Kaise Chalayein

Backend logic tests are written in Rust. Run them inside `src-tauri`:

```bash
cd src-tauri
cargo test
```

---

## Folder Structure

```text
krishi-kendra-inventory/
├── src/                # Frontend React 18 + TypeScript application
│   ├── components/     # UI components (Sidebar, modals, selects)
│   ├── views/          # Views (Dashboard, Sale, Purchase, Payment, Stock, etc.)
│   ├── demo/           # In-memory mock layer & demo datasets
│   └── types.ts        # Shared TypeScript data types & contracts
├── src-tauri/          # Backend Rust codebase (Tauri v2 + SQLite)
│   ├── src/            # Rust source files (commands, db, inventory, invoice)
│   ├── Cargo.toml      # Rust dependencies and package configuration
│   └── icons/          # Application desktop icons
├── samples/            # Sample XML import files (Master.xml)
├── scripts/            # Automation scripts (Playwright screenshots)
└── screenshots/        # High-resolution UI screenshots (Hindi & English)
```

---

## Demo Mode & Screenshots

The app includes an in-memory mock IPC layer for demonstrations and headless client screenshots without touching the local database:

- **Web Demo:** `http://localhost:5173/?demo=1` or `VITE_DEMO=1`
- **Screenshots:**
  ```bash
  npm install -D playwright
  npx playwright install chromium
  npm run screenshots
  ```
