use rusqlite::{Connection, Result};

pub fn configure_connection(conn: &Connection) -> Result<()> {
    // 1. Enable WAL mode for concurrency and atomic checkpointing
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // 2. synchronous=FULL ensures power-loss integrity on disk
    conn.pragma_update(None, "synchronous", "FULL")?;
    // 3. Enforce relational foreign keys
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // 4. busy_timeout = 5000 ms to avoid immediate lock errors during concurrent reads/writes
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;
    Ok(())
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    run_migrations(&conn)?;
    Ok(conn)
}

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT UNIQUE,
            name TEXT NOT NULL,
            category TEXT,
            hsn TEXT,
            gst_rate INTEGER, -- milli-percent (e.g. 5000 = 5.0%)
            gst_status TEXT DEFAULT 'not_set', -- 'taxable', 'nil_rated', 'exempt', 'not_set'
            base_unit TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS item_units (
            item_id INTEGER NOT NULL,
            unit_name TEXT NOT NULL,
            factor_to_base INTEGER NOT NULL, -- milli-units
            FOREIGN KEY(item_id) REFERENCES items(id),
            UNIQUE(item_id, unit_name)
        );

        CREATE TABLE IF NOT EXISTS parties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT UNIQUE,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- 'supplier', 'customer', or 'both'
            category TEXT NOT NULL DEFAULT 'unregistered', -- 'regular', 'composition', 'unregistered'
            village TEXT,
            address TEXT,
            phone TEXT,
            gstin TEXT,
            state_code TEXT
        );

        CREATE TABLE IF NOT EXISTS godowns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS purchases (
            invoice_no TEXT PRIMARY KEY,
            guid TEXT UNIQUE,
            date TEXT NOT NULL,
            supplier_id INTEGER NOT NULL,
            payment_mode TEXT NOT NULL DEFAULT 'cash', -- 'cash', 'credit', 'upi_bank'
            paid_amount INTEGER NOT NULL DEFAULT 0, -- paise
            total_amount INTEGER NOT NULL DEFAULT 0, -- paise
            supplier_invoice_no TEXT,
            supplier_invoice_date TEXT,
            status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled'
            FOREIGN KEY(supplier_id) REFERENCES parties(id)
        );

        CREATE TABLE IF NOT EXISTS purchase_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_no TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            qty INTEGER NOT NULL, -- milli-units
            unit TEXT NOT NULL,
            rate INTEGER NOT NULL, -- paise
            taxable INTEGER NOT NULL, -- paise
            cgst INTEGER, -- paise
            sgst INTEGER, -- paise
            igst INTEGER, -- paise
            hsn TEXT,
            gst_rate INTEGER,
            FOREIGN KEY(invoice_no) REFERENCES purchases(invoice_no),
            FOREIGN KEY(item_id) REFERENCES items(id)
        );

        CREATE TABLE IF NOT EXISTS sales (
            invoice_no TEXT PRIMARY KEY,
            guid TEXT UNIQUE,
            date TEXT NOT NULL,
            customer_id INTEGER NOT NULL,
            payment_mode TEXT NOT NULL DEFAULT 'cash', -- 'cash', 'credit', 'upi_bank'
            paid_amount INTEGER NOT NULL DEFAULT 0, -- paise
            total_amount INTEGER NOT NULL DEFAULT 0, -- paise
            status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled'
            FOREIGN KEY(customer_id) REFERENCES parties(id)
        );

        CREATE TABLE IF NOT EXISTS sale_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_no TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            qty INTEGER NOT NULL, -- milli-units
            unit TEXT NOT NULL,
            rate INTEGER NOT NULL, -- paise
            taxable INTEGER NOT NULL, -- paise
            cgst INTEGER, -- paise
            sgst INTEGER, -- paise
            igst INTEGER, -- paise
            cost_paise INTEGER NOT NULL DEFAULT 0, -- snapshotted cost at sale time
            hsn TEXT,
            gst_rate INTEGER,
            FOREIGN KEY(invoice_no) REFERENCES sales(invoice_no),
            FOREIGN KEY(item_id) REFERENCES items(id)
        );

        CREATE TABLE IF NOT EXISTS party_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            party_id INTEGER NOT NULL,
            type TEXT NOT NULL, -- 'purchase', 'sale', 'payment'
            ref_id TEXT, -- invoice_no or voucher reference
            debit INTEGER NOT NULL DEFAULT 0, -- paise
            credit INTEGER NOT NULL DEFAULT 0, -- paise
            payment_mode TEXT NOT NULL DEFAULT 'cash', -- 'cash', 'upi_bank', 'bank'
            remark TEXT,
            FOREIGN KEY(party_id) REFERENCES parties(id)
        );

        CREATE TABLE IF NOT EXISTS stock_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            godown_id INTEGER NOT NULL,
            qty_base INTEGER NOT NULL, -- +/- milli-units in base unit
            type TEXT NOT NULL, -- 'purchase', 'sale', 'transfer', 'adjust', 'reversal'
            ref_id TEXT, -- e.g., invoice_no
            linked_id INTEGER,
            party_id INTEGER,
            batch TEXT,
            FOREIGN KEY(item_id) REFERENCES items(id),
            FOREIGN KEY(godown_id) REFERENCES godowns(id),
            FOREIGN KEY(linked_id) REFERENCES stock_ledger(id)
        );

        -- Enforce append-only on stock_ledger using triggers
        CREATE TRIGGER IF NOT EXISTS prevent_stock_ledger_update
        BEFORE UPDATE ON stock_ledger
        BEGIN
            SELECT RAISE(ABORT, 'stock_ledger is append-only. Updates are not allowed.');
        END;

        CREATE TRIGGER IF NOT EXISTS prevent_stock_ledger_delete
        BEFORE DELETE ON stock_ledger
        BEGIN
            SELECT RAISE(ABORT, 'stock_ledger is append-only. Deletes are not allowed.');
        END;

        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            batch_no TEXT NOT NULL,
            expiry TEXT,
            cost_per_base_unit INTEGER NOT NULL, -- paise
            FOREIGN KEY(item_id) REFERENCES items(id)
        );

        CREATE TABLE IF NOT EXISTS import_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name TEXT NOT NULL,
            hash TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL,
            counts TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL DEFAULT '',
            entity_id TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            reason TEXT,
            created_at TEXT NOT NULL DEFAULT '',
            user_name TEXT
        );

        CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
        BEFORE UPDATE ON audit_log
        BEGIN
            SELECT RAISE(ABORT, 'audit_log is append-only. Updates are not allowed.');
        END;

        CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
        BEFORE DELETE ON audit_log
        BEGIN
            SELECT RAISE(ABORT, 'audit_log is append-only. Deletes are not allowed.');
        END;

        CREATE TABLE IF NOT EXISTS invoice_print_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_no TEXT NOT NULL,
            bill_mode TEXT NOT NULL CHECK (bill_mode IN ('WITH_GST', 'WITHOUT_GST')),
            printed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            shop_name TEXT NOT NULL DEFAULT 'श्री राम कृषि केंद्र',
            gstin TEXT DEFAULT '23AAAAA0000A1Z5',
            state_code TEXT DEFAULT '23',
            phone TEXT DEFAULT '+91 98765 43210',
            address TEXT DEFAULT 'मुख्य बाजार, कृषि उपज मंडी रोड, सीहोर (म.प्र.) - 466001',
            bank_name TEXT DEFAULT 'State Bank of India (भारतीय स्टेट बैंक)',
            bank_account_no TEXT DEFAULT '30291827364',
            bank_ifsc TEXT DEFAULT 'SBIN0001234',
            bank_branch TEXT DEFAULT 'सीहोर मुख्य शाखा (Sehore Main)',
            upi_id TEXT DEFAULT 'ramkrishi@sbi',
            terms_and_conditions TEXT DEFAULT '1. बिका हुआ माल वापस नहीं होगा।
2. खाद-बीज की शुद्धता की गारंटी संबंधित निर्माता कंपनी की होगी।
3. किसी भी विवाद की स्थिति में न्याय क्षेत्र सीहोर होगा।
4. नियत समय के पश्चात भुगतान पर 18% वार्षिक ब्याज देय होगा।',
            signature_text TEXT DEFAULT 'अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)',
            signature_data TEXT DEFAULT '',
            logo_data TEXT DEFAULT '',
            default_bill_format TEXT DEFAULT 'A4',
            bill_language TEXT DEFAULT 'both',
            visible_columns TEXT DEFAULT '{\"hsn\":true,\"unit\":true,\"discount\":true,\"gstRate\":true,\"taxable\":true}',
            fy_prefix TEXT DEFAULT 'KK',
            low_stock_threshold INTEGER DEFAULT 10,
            footer_note TEXT DEFAULT 'बिका हुआ माल वापस नहीं होगा। हमारे यहाँ सभी प्रकार के उन्नत खाद, बीज एवं कीटनाशक उपलब्ध हैं। धन्यवाद!',
            selected_printer TEXT DEFAULT '',
            printer_paper_size TEXT DEFAULT 'A4',
            print_offset_x_mm REAL DEFAULT 0,
            print_offset_y_mm REAL DEFAULT 0,
            print_mode TEXT DEFAULT 'dialog',
            is_gst_registered INTEGER NOT NULL DEFAULT 1,
            is_composition INTEGER NOT NULL DEFAULT 0,
            silent_print_beta INTEGER NOT NULL DEFAULT 0,
            backup_folder TEXT DEFAULT '',
            secondary_backup_folder TEXT DEFAULT '',
            last_backup_time TEXT,
            books_locked_until TEXT,
            security_enabled INTEGER NOT NULL DEFAULT 0,
            auto_lock_minutes INTEGER NOT NULL DEFAULT 10,
            recovery_key_hash TEXT,
            recovery_failed_attempts INTEGER NOT NULL DEFAULT 0,
            recovery_locked_until TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner','staff')),
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS login_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            event TEXT NOT NULL,
            at TEXT NOT NULL
        );

        CREATE TRIGGER IF NOT EXISTS prevent_login_log_update
        BEFORE UPDATE ON login_log
        BEGIN
            SELECT RAISE(ABORT, 'login_log is append-only. Updates are not allowed.');
        END;

        CREATE TRIGGER IF NOT EXISTS prevent_login_log_delete
        BEFORE DELETE ON login_log
        BEGIN
            SELECT RAISE(ABORT, 'login_log is append-only. Deletes are not allowed.');
        END;
        "
    )?;

    // Safely apply column migrations if running on existing database file
    let _ = conn.execute("ALTER TABLE parties ADD COLUMN category TEXT NOT NULL DEFAULT 'unregistered'", []);
    let _ = conn.execute("ALTER TABLE parties ADD COLUMN address TEXT", []);
    let _ = conn.execute("ALTER TABLE parties ADD COLUMN state_code TEXT", []);
    let _ = conn.execute("UPDATE parties SET state_code = SUBSTR(TRIM(gstin), 1, 2) WHERE gstin IS NOT NULL AND TRIM(gstin) <> '' AND state_code IS NULL", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN supplier_invoice_no TEXT", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN supplier_invoice_date TEXT", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'active'", []);
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_supplier_inv ON purchases(supplier_id, supplier_invoice_no) WHERE supplier_invoice_no IS NOT NULL AND supplier_invoice_no <> ''",
        []
    );
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'active'", []);
    let _ = conn.execute("ALTER TABLE sale_lines ADD COLUMN cost_paise INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sale_lines ADD COLUMN hsn TEXT", []);
    let _ = conn.execute("ALTER TABLE sale_lines ADD COLUMN gst_rate INTEGER", []);
    let _ = conn.execute("ALTER TABLE purchase_lines ADD COLUMN hsn TEXT", []);
    let _ = conn.execute("ALTER TABLE purchase_lines ADD COLUMN gst_rate INTEGER", []);
    let _ = conn.execute("ALTER TABLE party_ledger ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE party_ledger ADD COLUMN remark TEXT", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN is_gst_registered INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN is_composition INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN silent_print_beta INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN backup_folder TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN secondary_backup_folder TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN last_backup_time TEXT", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN books_locked_until TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN entity_type TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN entity_id TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN before_json TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN after_json TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN reason TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN created_at TEXT", []);
    let _ = conn.execute("ALTER TABLE audit_log ADD COLUMN user_name TEXT", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN security_enabled INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN auto_lock_minutes INTEGER NOT NULL DEFAULT 10", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN recovery_key_hash TEXT", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN recovery_failed_attempts INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE settings ADD COLUMN recovery_locked_until TEXT", []);
    let _ = conn.execute("ALTER TABLE items ADD COLUMN gst_status TEXT DEFAULT 'not_set'", []);
    let _ = conn.execute("ALTER TABLE items ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("UPDATE items SET gst_status = 'taxable' WHERE (gst_status IS NULL OR gst_status = 'not_set') AND gst_rate > 0", []);
    let _ = conn.execute("UPDATE items SET gst_status = 'nil_rated' WHERE (gst_status IS NULL OR gst_status = 'not_set') AND gst_rate = 0", []);

    // Backfill HSN and GST rate on existing sale_lines and purchase_lines from items where NULL
    let _ = conn.execute("UPDATE sale_lines SET hsn = (SELECT hsn FROM items WHERE items.id = sale_lines.item_id) WHERE hsn IS NULL", []);
    let _ = conn.execute("UPDATE sale_lines SET gst_rate = (SELECT gst_rate FROM items WHERE items.id = sale_lines.item_id) WHERE gst_rate IS NULL", []);
    let _ = conn.execute("UPDATE purchase_lines SET hsn = (SELECT hsn FROM items WHERE items.id = purchase_lines.item_id) WHERE hsn IS NULL", []);
    let _ = conn.execute("UPDATE purchase_lines SET gst_rate = (SELECT gst_rate FROM items WHERE items.id = purchase_lines.item_id) WHERE gst_rate IS NULL", []);

    // Create Default "Cash Sale (Walk-in)" party if not exists
    let _ = conn.execute(
        "INSERT OR IGNORE INTO parties (id, name, type, category) VALUES (1, 'Cash Sale (Walk-in)', 'both', 'unregistered')",
        []
    );

    // Initialize Default Settings row (id = 1) if not exists
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (id) VALUES (1)",
        []
    );

    Ok(())
}
