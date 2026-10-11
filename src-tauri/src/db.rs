use rusqlite::{Connection, Result};

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    
    // Enable WAL mode for better concurrency and safety (as per TRD 4.1)
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // Enforce foreign keys
    conn.pragma_update(None, "foreign_keys", "ON")?;
    
    run_migrations(&conn)?;
    
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guid TEXT UNIQUE,
            name TEXT NOT NULL,
            category TEXT,
            hsn TEXT,
            gst_rate INTEGER, -- milli-percent (e.g. 5000 = 5.0%)
            base_unit TEXT NOT NULL
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
            gstin TEXT,
            phone TEXT
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
            user TEXT NOT NULL,
            action TEXT NOT NULL,
            table_name TEXT NOT NULL,
            record TEXT NOT NULL,
            time TEXT NOT NULL
        );
        "
    )?;

    // Safely apply column migrations if running on existing database file
    let _ = conn.execute("ALTER TABLE parties ADD COLUMN category TEXT NOT NULL DEFAULT 'unregistered'", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE purchases ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN paid_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sale_lines ADD COLUMN cost_paise INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE party_ledger ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'cash'", []);
    let _ = conn.execute("ALTER TABLE party_ledger ADD COLUMN remark TEXT", []);

    // Create Default "Cash Sale (Walk-in)" party if not exists
    let _ = conn.execute(
        "INSERT OR IGNORE INTO parties (id, name, type, category) VALUES (1, 'Cash Sale (Walk-in)', 'both', 'unregistered')",
        []
    );

    Ok(())
}
