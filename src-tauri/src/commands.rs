use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, command};
use rusqlite::Connection;
use crate::db::init_db;
use crate::tally_import::{preview_import, confirm_import, PreviewReport, decode_tally_xml};
use crate::inventory::{add_stock_ledger_entry, get_qty_in_base_unit, calculate_weighted_average_cost};

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut data_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    
    data_dir.push("inventory.db");
    Ok(data_dir)
}

fn get_conn(app: &AppHandle) -> Result<Connection, String> {
    let path = get_db_path(app)?;
    init_db(path.to_str().unwrap()).map_err(|e| e.to_string())
}

#[command]
pub fn init_db_cmd(app: AppHandle) -> Result<String, String> {
    let conn = get_conn(&app)?;
    conn.execute("INSERT OR IGNORE INTO godowns (id, name) VALUES (1, 'Main Godown')", []).ok();
    let path = get_db_path(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[command]
pub fn preview_tally_import_cmd(app: AppHandle, xml_base64: String) -> Result<PreviewReport, String> {
    use base64::Engine;
    let conn = get_conn(&app)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&xml_base64)
        .map_err(|e| format!("Invalid base64 encoding: {}", e))?;
    let xml_content = decode_tally_xml(&bytes);
    preview_import(&conn, &xml_content).map_err(|e| e.to_string())
}

#[command]
pub fn confirm_tally_import_cmd(app: AppHandle, xml_base64: String, file_name: String) -> Result<(), String> {
    use base64::Engine;
    let mut conn = get_conn(&app)?;
    let path = get_db_path(&app)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&xml_base64)
        .map_err(|e| format!("Invalid base64 encoding: {}", e))?;
    let xml_content = decode_tally_xml(&bytes);
    confirm_import(&mut conn, path.to_str().unwrap(), &xml_content, &file_name).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StockItem {
    pub id: i64,
    pub name: String,
    pub godown_id: i64,
    pub godown_name: String,
    pub qty_base: i64,
    pub base_unit: String,
    pub last_purchase_rate: i64,
    pub stock_value: i64,
}

pub fn get_stock_list_inner(conn: &Connection) -> Result<Vec<StockItem>, String> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, g.id, g.name, SUM(s.qty_base), i.base_unit
         FROM stock_ledger s
         JOIN items i ON s.item_id = i.id
         JOIN godowns g ON s.godown_id = g.id
         GROUP BY i.id, g.id"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        let item_id: i64 = row.get(0)?;
        let item_name: String = row.get(1)?;
        let godown_id: i64 = row.get(2)?;
        let godown_name: String = row.get(3)?;
        let qty_base: i64 = row.get(4)?;
        let base_unit: String = row.get(5)?;
        Ok((item_id, item_name, godown_id, godown_name, qty_base, base_unit))
    }).map_err(|e| e.to_string())?;
    
    let mut items = Vec::new();
    for row in rows {
        if let Ok((item_id, item_name, godown_id, godown_name, qty_base, base_unit)) = row {
            let last_rate: i64 = conn.query_row(
                "SELECT rate FROM purchase_lines WHERE item_id = ?1 ORDER BY id DESC LIMIT 1",
                rusqlite::params![item_id],
                |r| r.get(0)
            ).unwrap_or(0);
            let stock_value = (qty_base * last_rate) / 1000;
            items.push(StockItem {
                id: item_id,
                name: item_name,
                godown_id,
                godown_name,
                qty_base,
                base_unit,
                last_purchase_rate: last_rate,
                stock_value,
            });
        }
    }
    Ok(items)
}

#[command]
pub fn get_stock_list_cmd(app: AppHandle) -> Result<Vec<StockItem>, String> {
    let conn = get_conn(&app)?;
    get_stock_list_inner(&conn)
}

pub fn get_available_stock_inner(conn: &Connection, item_id: i64, godown_id: i64) -> Result<i64, String> {
    let mut stmt = conn.prepare("SELECT COALESCE(SUM(qty_base), 0) FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2")
        .map_err(|e| e.to_string())?;
    let stock: i64 = stmt.query_row(rusqlite::params![item_id, godown_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(stock)
}

#[command]
pub fn get_available_stock_cmd(app: AppHandle, item_id: i64, godown_id: i64) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    get_available_stock_inner(&conn, item_id, godown_id)
}

pub fn add_opening_stock_inner(
    conn: &Connection,
    item_id: i64,
    godown_id: i64,
    qty: i64,
    unit: &str,
    date: &str
) -> Result<i64, String> {
    let mut factor = 1000i64;
    let base_unit: String = conn.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![item_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if base_unit != unit {
        let f: Option<i64> = conn.query_row(
            "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND unit_name = ?2",
            rusqlite::params![item_id, unit],
            |row| row.get(0)
        ).ok();
        if let Some(f_val) = f {
            factor = f_val;
        }
    }
    let qty_base = (qty * factor) / 1000;
    add_stock_ledger_entry(conn, date, item_id, godown_id, qty_base, "opening", None, None, None, None)
        .map_err(|e| e.to_string())
}

#[command]
pub fn add_opening_stock_cmd(
    app: AppHandle,
    item_id: i64,
    godown_id: i64,
    qty: i64,
    unit: String,
    date: String
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    add_opening_stock_inner(&conn, item_id, godown_id, qty, &unit, &date)
}

pub fn add_stock_adjustment_inner(
    conn: &Connection,
    item_id: i64,
    godown_id: i64,
    qty_change: i64,
    unit: &str,
    reason: Option<&str>,
    date: &str
) -> Result<i64, String> {
    let mut factor = 1000i64;
    let base_unit: String = conn.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![item_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if base_unit != unit {
        let f: Option<i64> = conn.query_row(
            "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND unit_name = ?2",
            rusqlite::params![item_id, unit],
            |row| row.get(0)
        ).ok();
        if let Some(f_val) = f {
            factor = f_val;
        }
    }
    let qty_base = (qty_change * factor) / 1000;
    add_stock_ledger_entry(conn, date, item_id, godown_id, qty_base, "adjustment", reason, None, None, None)
        .map_err(|e| e.to_string())
}

#[command]
pub fn add_stock_adjustment_cmd(
    app: AppHandle,
    item_id: i64,
    godown_id: i64,
    qty_change: i64,
    unit: String,
    reason: Option<String>,
    date: String
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    add_stock_adjustment_inner(&conn, item_id, godown_id, qty_change, &unit, reason.as_deref(), &date)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LastRateInfo {
    pub rate: i64,
    pub date: String,
    pub party_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LastRates {
    pub last_purchase: Option<LastRateInfo>,
    pub last_sale: Option<LastRateInfo>,
}

pub fn get_last_rates_inner(conn: &Connection, item_id: i64) -> Result<LastRates, String> {
    let last_purchase = conn.query_row(
        "SELECT pl.rate, p.date, pr.name
         FROM purchase_lines pl
         JOIN purchases p ON pl.invoice_no = p.invoice_no
         JOIN parties pr ON p.supplier_id = pr.id
         WHERE pl.item_id = ?1
         ORDER BY p.date DESC, pl.id DESC
         LIMIT 1",
        rusqlite::params![item_id],
        |row| Ok(LastRateInfo {
            rate: row.get(0)?,
            date: row.get(1)?,
            party_name: row.get(2)?,
        })
    ).ok();

    let last_sale = conn.query_row(
        "SELECT sl.rate, s.date, pr.name
         FROM sale_lines sl
         JOIN sales s ON sl.invoice_no = s.invoice_no
         JOIN parties pr ON s.customer_id = pr.id
         WHERE sl.item_id = ?1
         ORDER BY s.date DESC, sl.id DESC
         LIMIT 1",
        rusqlite::params![item_id],
        |row| Ok(LastRateInfo {
            rate: row.get(0)?,
            date: row.get(1)?,
            party_name: row.get(2)?,
        })
    ).ok();

    Ok(LastRates { last_purchase, last_sale })
}

#[command]
pub fn get_last_rates_cmd(app: AppHandle, item_id: i64) -> Result<LastRates, String> {
    let conn = get_conn(&app)?;
    get_last_rates_inner(&conn, item_id)
}

#[derive(Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub base_unit: String,
    pub hsn: Option<String>,
    pub gst_rate: Option<i64>,
}

pub fn get_items_inner(conn: &Connection) -> Result<Vec<Item>, String> {
    let mut stmt = conn.prepare("SELECT id, name, base_unit, hsn, gst_rate FROM items").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Item {
            id: row.get(0)?,
            name: row.get(1)?,
            base_unit: row.get(2)?,
            hsn: row.get(3)?,
            gst_rate: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

#[command]
pub fn get_items_cmd(app: AppHandle) -> Result<Vec<Item>, String> {
    let conn = get_conn(&app)?;
    get_items_inner(&conn)
}

pub fn add_item_inner(conn: &Connection, name: String, category: Option<String>, hsn: Option<String>, gst_rate: Option<i64>, base_unit: String) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO items (name, category, hsn, gst_rate, base_unit) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![name, category, hsn, gst_rate, base_unit]
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[command]
pub fn add_item_cmd(app: AppHandle, name: String, category: Option<String>, hsn: Option<String>, gst_rate: Option<i64>, base_unit: String) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    add_item_inner(&conn, name, category, hsn, gst_rate, base_unit)
}

#[command]
pub fn add_ledger_entry_cmd(
    app: AppHandle,
    date: String,
    item_id: i64,
    godown_id: i64,
    qty_base: i64,
    entry_type: String,
    ref_id: Option<String>,
    party_id: Option<i64>
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    add_stock_ledger_entry(&conn, &date, item_id, godown_id, qty_base, &entry_type, ref_id.as_deref(), None, party_id, None)
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct Godown {
    pub id: i64,
    pub name: String,
}

#[command]
pub fn get_godowns_cmd(app: AppHandle) -> Result<Vec<Godown>, String> {
    let conn = get_conn(&app)?;
    let mut stmt = conn.prepare("SELECT id, name FROM godowns").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Godown {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        if let Ok(g) = row {
            items.push(g);
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;
    
    #[test]
    fn test_commands_inner_logic() {
        let conn = init_db(":memory:").unwrap();
        
        let item_id = add_item_inner(&conn, "Urea".to_string(), None, None, Some(5000), "kg".to_string()).unwrap();
        assert_eq!(item_id, 1);
        
        let items = get_items_inner(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Urea");
        
        conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main')", []).unwrap();
        add_stock_ledger_entry(&conn, "2026-10-09", item_id, 1, 100000, "purchase", None, None, None, None).unwrap();
        
        let stock = get_stock_list_inner(&conn).unwrap();
        assert_eq!(stock.len(), 1);
        assert_eq!(stock[0].qty_base, 100000);
    }
}

use crate::invoice::{InvoicePayload, save_invoice};

#[command]
pub fn add_item_unit_cmd(app: AppHandle, item_id: i64, unit_name: String, factor_to_base: i64) -> Result<(), String> {
    let conn = get_conn(&app)?;
    conn.execute(
        "INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (?1, ?2, ?3)",
        rusqlite::params![item_id, unit_name, factor_to_base]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Party {
    pub id: i64,
    pub name: String,
    #[serde(alias = "party_type", alias = "type_")]
    pub party_type: String, // 'supplier', 'customer', or 'both'
    pub category: String,   // 'regular', 'composition', or 'unregistered'
    pub village: Option<String>,
    pub gstin: Option<String>,
    pub phone: Option<String>,
}

pub fn validate_gstin(gstin: &str) -> bool {
    let clean = gstin.trim();
    if clean.len() != 15 {
        return false;
    }
    clean.chars().all(|c| c.is_ascii_alphanumeric())
}

#[command]
pub fn get_parties_cmd(app: AppHandle, party_type: String) -> Result<Vec<Party>, String> {
    let conn = get_conn(&app)?;
    
    let query = match party_type.as_str() {
        "supplier" => "SELECT id, name, type, category, village, gstin, phone FROM parties WHERE type = 'supplier' OR type = 'both'",
        "customer" => "SELECT id, name, type, category, village, gstin, phone FROM parties WHERE type = 'customer' OR type = 'both'",
        _ => "SELECT id, name, type, category, village, gstin, phone FROM parties",
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Party {
            id: row.get(0)?,
            name: row.get(1)?,
            party_type: row.get(2)?,
            category: row.get(3)?,
            village: row.get(4)?,
            gstin: row.get(5)?,
            phone: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        if let Ok(p) = row { items.push(p); }
    }
    Ok(items)
}

pub fn add_party_inner(
    conn: &Connection, 
    name: &str, 
    party_type: &str,
    category: &str,
    village: Option<&str>,
    gstin: Option<&str>,
    phone: Option<&str>
) -> Result<i64, String> {
    let cat = category.to_lowercase();
    let gstin_clean = gstin.map(|g| g.trim().to_uppercase());

    if cat == "regular" {
        match &gstin_clean {
            Some(g) if validate_gstin(g) => {},
            _ => return Err("Valid 15-character GSTIN is required for Regular parties (e.g. 22AAAAA0000A1Z5)".to_string()),
        }
    }

    conn.execute(
        "INSERT INTO parties (name, type, category, village, gstin, phone, guid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
        rusqlite::params![name, party_type, cat, village, gstin_clean, phone]
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[command]
pub fn add_party_cmd(
    app: AppHandle, 
    name: String, 
    party_type: String,
    category: Option<String>,
    village: Option<String>,
    gstin: Option<String>,
    phone: Option<String>
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    let cat = category.unwrap_or_else(|| "unregistered".to_string());
    add_party_inner(&conn, &name, &party_type, &cat, village.as_deref(), gstin.as_deref(), phone.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyBalance {
    pub party_id: i64,
    pub party_name: String,
    pub party_type: String,
    pub category: String,
    pub phone: Option<String>,
    pub village: Option<String>,
    pub total_debit: i64,  // paise
    pub total_credit: i64, // paise
    pub net_balance: i64,  // paise (+ Len / Receivable, - Den / Payable)
}

pub fn get_party_balances_inner(conn: &Connection) -> Result<Vec<PartyBalance>, String> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name, p.type, p.category, p.phone, p.village, 
                COALESCE(SUM(l.debit), 0) as total_debit, 
                COALESCE(SUM(l.credit), 0) as total_credit
         FROM parties p
         LEFT JOIN party_ledger l ON p.id = l.party_id
         GROUP BY p.id, p.name, p.type, p.category, p.phone, p.village"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let deb: i64 = row.get(6)?;
        let cred: i64 = row.get(7)?;
        Ok(PartyBalance {
            party_id: row.get(0)?,
            party_name: row.get(1)?,
            party_type: row.get(2)?,
            category: row.get(3)?,
            phone: row.get(4)?,
            village: row.get(5)?,
            total_debit: deb,
            total_credit: cred,
            net_balance: deb - cred,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        if let Ok(b) = row { list.push(b); }
    }
    Ok(list)
}

#[command]
pub fn get_party_balances_cmd(app: AppHandle) -> Result<Vec<PartyBalance>, String> {
    let conn = get_conn(&app)?;
    get_party_balances_inner(&conn)
}

#[command]
pub fn save_invoice_cmd(app: AppHandle, payload: InvoicePayload) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    save_invoice(&mut conn, payload).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct Movement {
    pub date: String,
    pub qty_base: i64,
    pub type_: String,
    pub ref_id: Option<String>,
}

#[command]
pub fn get_item_movement_cmd(app: AppHandle, item_id: i64, godown_id: Option<i64>) -> Result<Vec<Movement>, String> {
    let conn = get_conn(&app)?;
    let mut items = Vec::new();

    if let Some(gid) = godown_id {
        let mut stmt = conn.prepare("SELECT date, qty_base, type, ref_id FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2 ORDER BY id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![item_id, gid], |row| {
            Ok(Movement {
                date: row.get(0)?,
                qty_base: row.get(1)?,
                type_: row.get(2)?,
                ref_id: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(m) = row { items.push(m); }
        }
    } else {
        let mut stmt = conn.prepare("SELECT date, qty_base, type, ref_id FROM stock_ledger WHERE item_id = ?1 ORDER BY id DESC").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![item_id], |row| {
            Ok(Movement {
                date: row.get(0)?,
                qty_base: row.get(1)?,
                type_: row.get(2)?,
                ref_id: row.get(3)?,
            })
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(m) = row { items.push(m); }
        }
    }

    Ok(items)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DashboardStats {
    pub today_sales: i64,      // paise
    pub today_purchases: i64,  // paise
    pub total_receivable: i64, // paise
    pub total_payable: i64,    // paise
}

pub fn get_dashboard_stats_inner(conn: &Connection, today_date: &str) -> Result<DashboardStats, String> {
    let today_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE date = ?1",
        rusqlite::params![today_date],
        |row| row.get(0)
    ).unwrap_or(0);

    let today_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE date = ?1",
        rusqlite::params![today_date],
        |row| row.get(0)
    ).unwrap_or(0);

    let balances = get_party_balances_inner(conn)?;
    let mut total_receivable = 0i64;
    let mut total_payable = 0i64;
    for b in balances {
        if b.net_balance > 0 {
            total_receivable += b.net_balance;
        } else if b.net_balance < 0 {
            total_payable += -b.net_balance;
        }
    }

    Ok(DashboardStats {
        today_sales,
        today_purchases,
        total_receivable,
        total_payable,
    })
}

#[command]
pub fn get_dashboard_stats_cmd(app: AppHandle, today_date: String) -> Result<DashboardStats, String> {
    let conn = get_conn(&app)?;
    get_dashboard_stats_inner(&conn, &today_date)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RecentEntry {
    pub date: String,
    pub entry_type: String, // "sale" or "purchase"
    pub invoice_no: String,
    pub party_name: String,
    pub amount: i64,        // paise
    pub payment_mode: String,
}

pub fn get_recent_entries_inner(conn: &Connection) -> Result<Vec<RecentEntry>, String> {
    let mut stmt = conn.prepare(
        "SELECT date, 'sale' as entry_type, invoice_no, 
                COALESCE((SELECT name FROM parties WHERE id = customer_id), 'Walk-in') as party_name, 
                total_amount, payment_mode
         FROM sales
         UNION ALL
         SELECT date, 'purchase' as entry_type, invoice_no, 
                COALESCE((SELECT name FROM parties WHERE id = supplier_id), 'Supplier') as party_name, 
                total_amount, payment_mode
         FROM purchases
         ORDER BY date DESC, invoice_no DESC
         LIMIT 5"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(RecentEntry {
            date: row.get(0)?,
            entry_type: row.get(1)?,
            invoice_no: row.get(2)?,
            party_name: row.get(3)?,
            amount: row.get(4)?,
            payment_mode: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        if let Ok(r) = row { list.push(r); }
    }
    Ok(list)
}

#[command]
pub fn get_recent_entries_cmd(app: AppHandle) -> Result<Vec<RecentEntry>, String> {
    let conn = get_conn(&app)?;
    get_recent_entries_inner(&conn)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InvoicePrintLine {
    pub item_name: String,
    pub qty: i64,      // milli
    pub unit: String,
    pub rate: i64,     // paise
    pub taxable: i64,  // paise
    pub gst_amount: i64,// paise
    pub total: i64,    // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InvoicePrintDetails {
    pub invoice_no: String,
    pub date: String,
    pub party_name: String,
    pub party_phone: Option<String>,
    pub party_gstin: Option<String>,
    pub party_village: Option<String>,
    pub payment_mode: String,
    pub paid_amount: i64,
    pub total_amount: i64,
    pub lines: Vec<InvoicePrintLine>,
}

pub fn get_invoice_details_inner(conn: &Connection, invoice_no: &str) -> Result<InvoicePrintDetails, String> {
    let sale_res = conn.query_row(
        "SELECT s.invoice_no, s.date, p.name, p.phone, p.gstin, p.village, s.payment_mode, s.paid_amount, s.total_amount
         FROM sales s
         JOIN parties p ON s.customer_id = p.id
         WHERE s.invoice_no = ?1",
        rusqlite::params![invoice_no],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    );

    if let Ok((inv_no, date, party_name, party_phone, party_gstin, party_village, payment_mode, paid_amount, total_amount)) = sale_res {
        let mut stmt = conn.prepare(
            "SELECT i.name, sl.qty, sl.unit, sl.rate, sl.taxable, (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as gst_amt
             FROM sale_lines sl
             JOIN items i ON sl.item_id = i.id
             WHERE sl.invoice_no = ?1"
        ).map_err(|e| e.to_string())?;

        let line_rows = stmt.query_map(rusqlite::params![invoice_no], |row| {
            let item_name: String = row.get(0)?;
            let qty: i64 = row.get(1)?;
            let unit: String = row.get(2)?;
            let rate: i64 = row.get(3)?;
            let taxable: i64 = row.get(4)?;
            let gst_amt: i64 = row.get(5)?;
            Ok(InvoicePrintLine {
                item_name,
                qty,
                unit,
                rate,
                taxable,
                gst_amount: gst_amt,
                total: taxable + gst_amt,
            })
        }).map_err(|e| e.to_string())?;

        let mut lines = Vec::new();
        for l in line_rows {
            if let Ok(line) = l { lines.push(line); }
        }

        return Ok(InvoicePrintDetails {
            invoice_no: inv_no,
            date,
            party_name,
            party_phone,
            party_gstin,
            party_village,
            payment_mode,
            paid_amount,
            total_amount,
            lines,
        });
    }

    let pur_res = conn.query_row(
        "SELECT p.invoice_no, p.date, pr.name, pr.phone, pr.gstin, pr.village, p.payment_mode, p.paid_amount, p.total_amount
         FROM purchases p
         JOIN parties pr ON p.supplier_id = pr.id
         WHERE p.invoice_no = ?1",
        rusqlite::params![invoice_no],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    );

    if let Ok((inv_no, date, party_name, party_phone, party_gstin, party_village, payment_mode, paid_amount, total_amount)) = pur_res {
        let mut stmt = conn.prepare(
            "SELECT i.name, pl.qty, pl.unit, pl.rate, pl.taxable, (COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)) as gst_amt
             FROM purchase_lines pl
             JOIN items i ON pl.item_id = i.id
             WHERE pl.invoice_no = ?1"
        ).map_err(|e| e.to_string())?;

        let line_rows = stmt.query_map(rusqlite::params![invoice_no], |row| {
            let item_name: String = row.get(0)?;
            let qty: i64 = row.get(1)?;
            let unit: String = row.get(2)?;
            let rate: i64 = row.get(3)?;
            let taxable: i64 = row.get(4)?;
            let gst_amt: i64 = row.get(5)?;
            Ok(InvoicePrintLine {
                item_name,
                qty,
                unit,
                rate,
                taxable,
                gst_amount: gst_amt,
                total: taxable + gst_amt,
            })
        }).map_err(|e| e.to_string())?;

        let mut lines = Vec::new();
        for l in line_rows {
            if let Ok(line) = l { lines.push(line); }
        }

        return Ok(InvoicePrintDetails {
            invoice_no: inv_no,
            date,
            party_name,
            party_phone,
            party_gstin,
            party_village,
            payment_mode,
            paid_amount,
            total_amount,
            lines,
        });
    }

    Err(format!("Invoice '{}' not found", invoice_no))
}

#[command]
pub fn get_invoice_details_cmd(app: AppHandle, invoice_no: String) -> Result<InvoicePrintDetails, String> {
    let conn = get_conn(&app)?;
    get_invoice_details_inner(&conn, &invoice_no)
}

// ============================================================================
// REPORTS MODULE (Purchase/Sales Register, GST Summary, HSN, Profit Report)
// ============================================================================

fn is_interstate_party(party_gstin: Option<&str>, shop_state: Option<&str>) -> bool {
    let shop = shop_state.map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("23");
    if let Some(gst) = party_gstin {
        let g = gst.trim();
        if g.len() >= 2 {
            return &g[..2] != shop;
        }
    }
    false
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegisterEntry {
    pub invoice_no: String,
    pub date: String,
    pub party_name: String,
    pub party_gstin: Option<String>,
    pub state_type: String, // "intrastate" (CGST+SGST) or "interstate" (IGST)
    pub taxable: i64,       // paise
    pub cgst: i64,          // paise
    pub sgst: i64,          // paise
    pub igst: i64,          // paise
    pub total: i64,         // paise
    pub payment_mode: String,
    pub paid_amount: i64,   // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegisterReport {
    pub entries: Vec<RegisterEntry>,
    pub total_taxable: i64,
    pub total_cgst: i64,
    pub total_sgst: i64,
    pub total_igst: i64,
    pub grand_total: i64,
}

pub fn get_purchase_register_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
    shop_state: Option<&str>,
) -> Result<RegisterReport, String> {
    let mut stmt = conn.prepare(
        "SELECT p.invoice_no, p.date, pt.name, pt.gstin, p.payment_mode, p.paid_amount,
                COALESCE(SUM(pl.taxable), 0) as taxable,
                COALESCE(SUM(pl.cgst), 0) as cgst,
                COALESCE(SUM(pl.sgst), 0) as sgst,
                COALESCE(SUM(pl.igst), 0) as igst,
                p.total_amount
         FROM purchases p
         JOIN parties pt ON p.supplier_id = pt.id
         LEFT JOIN purchase_lines pl ON p.invoice_no = pl.invoice_no
         WHERE p.date >= ?1 AND p.date <= ?2
         GROUP BY p.invoice_no
         ORDER BY p.date ASC, p.invoice_no ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
            row.get::<_, i64>(10)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_taxable = 0i64;
    let mut total_cgst = 0i64;
    let mut total_sgst = 0i64;
    let mut total_igst = 0i64;
    let mut grand_total = 0i64;

    for r in rows {
        let (inv_no, date, party_name, party_gstin, payment_mode, paid_amount, taxable, raw_cgst, raw_sgst, raw_igst, total_amt) = r.map_err(|e| e.to_string())?;
        
        let total_tax = raw_cgst + raw_sgst + raw_igst;
        let is_inter = is_interstate_party(party_gstin.as_deref(), shop_state);
        let (cgst, sgst, igst, state_type) = if is_inter {
            (0, 0, total_tax, "interstate".to_string())
        } else {
            let half = total_tax / 2;
            (half, total_tax - half, 0, "intrastate".to_string())
        };

        total_taxable += taxable;
        total_cgst += cgst;
        total_sgst += sgst;
        total_igst += igst;
        grand_total += total_amt;

        entries.push(RegisterEntry {
            invoice_no: inv_no,
            date,
            party_name,
            party_gstin,
            state_type,
            taxable,
            cgst,
            sgst,
            igst,
            total: total_amt,
            payment_mode,
            paid_amount,
        });
    }

    Ok(RegisterReport {
        entries,
        total_taxable,
        total_cgst,
        total_sgst,
        total_igst,
        grand_total,
    })
}

#[command]
pub fn get_purchase_register_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
    shop_state: Option<String>,
) -> Result<RegisterReport, String> {
    let conn = get_conn(&app)?;
    get_purchase_register_inner(&conn, &from_date, &to_date, shop_state.as_deref())
}

pub fn get_sales_register_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
    shop_state: Option<&str>,
) -> Result<RegisterReport, String> {
    let mut stmt = conn.prepare(
        "SELECT s.invoice_no, s.date, pt.name, pt.gstin, s.payment_mode, s.paid_amount,
                COALESCE(SUM(sl.taxable), 0) as taxable,
                COALESCE(SUM(sl.cgst), 0) as cgst,
                COALESCE(SUM(sl.sgst), 0) as sgst,
                COALESCE(SUM(sl.igst), 0) as igst,
                s.total_amount
         FROM sales s
         JOIN parties pt ON s.customer_id = pt.id
         LEFT JOIN sale_lines sl ON s.invoice_no = sl.invoice_no
         WHERE s.date >= ?1 AND s.date <= ?2
         GROUP BY s.invoice_no
         ORDER BY s.date ASC, s.invoice_no ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
            row.get::<_, i64>(10)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_taxable = 0i64;
    let mut total_cgst = 0i64;
    let mut total_sgst = 0i64;
    let mut total_igst = 0i64;
    let mut grand_total = 0i64;

    for r in rows {
        let (inv_no, date, party_name, party_gstin, payment_mode, paid_amount, taxable, raw_cgst, raw_sgst, raw_igst, total_amt) = r.map_err(|e| e.to_string())?;
        
        let total_tax = raw_cgst + raw_sgst + raw_igst;
        let is_inter = is_interstate_party(party_gstin.as_deref(), shop_state);
        let (cgst, sgst, igst, state_type) = if is_inter {
            (0, 0, total_tax, "interstate".to_string())
        } else {
            let half = total_tax / 2;
            (half, total_tax - half, 0, "intrastate".to_string())
        };

        total_taxable += taxable;
        total_cgst += cgst;
        total_sgst += sgst;
        total_igst += igst;
        grand_total += total_amt;

        entries.push(RegisterEntry {
            invoice_no: inv_no,
            date,
            party_name,
            party_gstin,
            state_type,
            taxable,
            cgst,
            sgst,
            igst,
            total: total_amt,
            payment_mode,
            paid_amount,
        });
    }

    Ok(RegisterReport {
        entries,
        total_taxable,
        total_cgst,
        total_sgst,
        total_igst,
        grand_total,
    })
}

#[command]
pub fn get_sales_register_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
    shop_state: Option<String>,
) -> Result<RegisterReport, String> {
    let conn = get_conn(&app)?;
    get_sales_register_inner(&conn, &from_date, &to_date, shop_state.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GstSummaryReport {
    pub output_taxable: i64,          // paise
    pub output_cgst: i64,             // paise
    pub output_sgst: i64,             // paise
    pub output_igst: i64,             // paise
    pub output_total_gst: i64,        // paise
    pub input_taxable_eligible: i64,  // regular suppliers
    pub input_taxable_ineligible: i64,// composition / unregistered suppliers
    pub input_cgst: i64,              // eligible input CGST
    pub input_sgst: i64,              // eligible input SGST
    pub input_igst: i64,              // eligible input IGST
    pub input_total_gst: i64,         // eligible input total GST
    pub net_cgst_payable: i64,        // output_cgst - input_cgst
    pub net_sgst_payable: i64,        // output_sgst - input_sgst
    pub net_igst_payable: i64,        // output_igst - input_igst
    pub net_total_payable: i64,       // output_total_gst - input_total_gst
}

pub fn get_gst_summary_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
    shop_state: Option<&str>,
) -> Result<GstSummaryReport, String> {
    // 1. Output GST from sales
    let mut sales_stmt = conn.prepare(
        "SELECT s.invoice_no, pt.gstin,
                COALESCE(SUM(sl.taxable), 0) as taxable,
                COALESCE(SUM(sl.cgst), 0) as cgst,
                COALESCE(SUM(sl.sgst), 0) as sgst,
                COALESCE(SUM(sl.igst), 0) as igst
         FROM sales s
         JOIN parties pt ON s.customer_id = pt.id
         LEFT JOIN sale_lines sl ON s.invoice_no = sl.invoice_no
         WHERE s.date >= ?1 AND s.date <= ?2
         GROUP BY s.invoice_no"
    ).map_err(|e| e.to_string())?;

    let sale_rows = sales_stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut output_taxable = 0i64;
    let mut output_cgst = 0i64;
    let mut output_sgst = 0i64;
    let mut output_igst = 0i64;

    for r in sale_rows {
        let (_inv, party_gstin, taxable, raw_cgst, raw_sgst, raw_igst) = r.map_err(|e| e.to_string())?;
        output_taxable += taxable;
        let total_tax = raw_cgst + raw_sgst + raw_igst;
        if is_interstate_party(party_gstin.as_deref(), shop_state) {
            output_igst += total_tax;
        } else {
            let half = total_tax / 2;
            output_cgst += half;
            output_sgst += total_tax - half;
        }
    }

    // 2. Input GST from purchases (Composition/unregistered supplier excluded from input GST)
    let mut pur_stmt = conn.prepare(
        "SELECT p.invoice_no, pt.category, pt.gstin,
                COALESCE(SUM(pl.taxable), 0) as taxable,
                COALESCE(SUM(pl.cgst), 0) as cgst,
                COALESCE(SUM(pl.sgst), 0) as sgst,
                COALESCE(SUM(pl.igst), 0) as igst
         FROM purchases p
         JOIN parties pt ON p.supplier_id = pt.id
         LEFT JOIN purchase_lines pl ON p.invoice_no = pl.invoice_no
         WHERE p.date >= ?1 AND p.date <= ?2
         GROUP BY p.invoice_no"
    ).map_err(|e| e.to_string())?;

    let pur_rows = pur_stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut input_taxable_eligible = 0i64;
    let mut input_taxable_ineligible = 0i64;
    let mut input_cgst = 0i64;
    let mut input_sgst = 0i64;
    let mut input_igst = 0i64;

    for r in pur_rows {
        let (_inv, category, party_gstin, taxable, raw_cgst, raw_sgst, raw_igst) = r.map_err(|e| e.to_string())?;
        if category == "regular" {
            input_taxable_eligible += taxable;
            let total_tax = raw_cgst + raw_sgst + raw_igst;
            if is_interstate_party(party_gstin.as_deref(), shop_state) {
                input_igst += total_tax;
            } else {
                let half = total_tax / 2;
                input_cgst += half;
                input_sgst += total_tax - half;
            }
        } else {
            // Composition or unregistered: do not count input GST
            input_taxable_ineligible += taxable;
        }
    }

    let output_total_gst = output_cgst + output_sgst + output_igst;
    let input_total_gst = input_cgst + input_sgst + input_igst;
    let net_cgst_payable = output_cgst - input_cgst;
    let net_sgst_payable = output_sgst - input_sgst;
    let net_igst_payable = output_igst - input_igst;
    let net_total_payable = output_total_gst - input_total_gst;

    Ok(GstSummaryReport {
        output_taxable,
        output_cgst,
        output_sgst,
        output_igst,
        output_total_gst,
        input_taxable_eligible,
        input_taxable_ineligible,
        input_cgst,
        input_sgst,
        input_igst,
        input_total_gst,
        net_cgst_payable,
        net_sgst_payable,
        net_igst_payable,
        net_total_payable,
    })
}

#[command]
pub fn get_gst_summary_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
    shop_state: Option<String>,
) -> Result<GstSummaryReport, String> {
    let conn = get_conn(&app)?;
    get_gst_summary_inner(&conn, &from_date, &to_date, shop_state.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HsnSummaryItem {
    pub hsn: String,
    pub item_names: String,
    pub base_unit: String,
    pub total_qty: i64,        // milli-units in base unit
    pub taxable_value: i64,    // paise
    pub cgst: i64,             // paise
    pub sgst: i64,             // paise
    pub igst: i64,             // paise
    pub total_tax: i64,        // paise
    pub total_value: i64,      // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HsnSummaryReport {
    pub items: Vec<HsnSummaryItem>,
    pub total_taxable: i64,
    pub total_tax: i64,
    pub grand_total: i64,
}

pub fn get_hsn_summary_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
    shop_state: Option<&str>,
) -> Result<HsnSummaryReport, String> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(NULLIF(TRIM(i.hsn), ''), 'अन्य / बिना HSN') as hsn_code,
                i.name, i.base_unit, sl.qty, sl.unit, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as tax_amt,
                pt.gstin, i.id
         FROM sale_lines sl
         JOIN sales s ON sl.invoice_no = s.invoice_no
         JOIN items i ON sl.item_id = i.id
         JOIN parties pt ON s.customer_id = pt.id
         WHERE s.date >= ?1 AND s.date <= ?2
         ORDER BY hsn_code ASC, i.name ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, i64>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    use std::collections::BTreeMap;
    struct HsnAccumulator {
        item_names_set: Vec<String>,
        base_unit: String,
        total_qty: i64,
        taxable_value: i64,
        cgst: i64,
        sgst: i64,
        igst: i64,
        total_tax: i64,
    }

    let mut map: BTreeMap<String, HsnAccumulator> = BTreeMap::new();

    for r in rows {
        let (hsn_code, item_name, base_unit, qty, unit, taxable, tax_amt, party_gstin, item_id) = r.map_err(|e| e.to_string())?;
        let base_qty = get_qty_in_base_unit(conn, item_id, qty, &unit).unwrap_or(qty);
        let is_inter = is_interstate_party(party_gstin.as_deref(), shop_state);
        let (line_cgst, line_sgst, line_igst) = if is_inter {
            (0, 0, tax_amt)
        } else {
            let half = tax_amt / 2;
            (half, tax_amt - half, 0)
        };

        let entry = map.entry(hsn_code).or_insert_with(|| HsnAccumulator {
            item_names_set: Vec::new(),
            base_unit: base_unit.clone(),
            total_qty: 0,
            taxable_value: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            total_tax: 0,
        });

        if !entry.item_names_set.contains(&item_name) {
            entry.item_names_set.push(item_name);
        }
        entry.total_qty += base_qty;
        entry.taxable_value += taxable;
        entry.cgst += line_cgst;
        entry.sgst += line_sgst;
        entry.igst += line_igst;
        entry.total_tax += tax_amt;
    }

    let mut items = Vec::new();
    let mut total_taxable = 0i64;
    let mut total_tax = 0i64;
    let mut grand_total = 0i64;

    for (hsn, acc) in map {
        let total_val = acc.taxable_value + acc.total_tax;
        total_taxable += acc.taxable_value;
        total_tax += acc.total_tax;
        grand_total += total_val;

        items.push(HsnSummaryItem {
            hsn,
            item_names: acc.item_names_set.join(", "),
            base_unit: acc.base_unit,
            total_qty: acc.total_qty,
            taxable_value: acc.taxable_value,
            cgst: acc.cgst,
            sgst: acc.sgst,
            igst: acc.igst,
            total_tax: acc.total_tax,
            total_value: total_val,
        });
    }

    Ok(HsnSummaryReport {
        items,
        total_taxable,
        total_tax,
        grand_total,
    })
}

#[command]
pub fn get_hsn_summary_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
    shop_state: Option<String>,
) -> Result<HsnSummaryReport, String> {
    let conn = get_conn(&app)?;
    get_hsn_summary_inner(&conn, &from_date, &to_date, shop_state.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfitReportItem {
    pub item_id: i64,
    pub item_name: String,
    pub base_unit: String,
    pub qty_sold: i64,             // milli-units in base unit
    pub taxable_sale: i64,         // paise
    pub cost_amount: i64,          // paise (snapshotted cost)
    pub profit_without_gst: i64,   // taxable_sale - cost_amount
    pub gross_sale: i64,           // taxable_sale + tax
    pub gross_profit: i64,         // gross_sale - cost_amount
    pub unit_sale_price: i64,      // paise per 1 base unit
    pub unit_cost: i64,            // paise per 1 base unit
    pub unit_profit: i64,          // paise per 1 base unit
    pub margin_percent: f64,       // (profit_without_gst / taxable_sale) * 100
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfitReport {
    pub items: Vec<ProfitReportItem>,
    pub total_taxable_sale: i64,
    pub total_cost: i64,
    pub total_profit_without_gst: i64,
    pub total_gross_sale: i64,
    pub total_gross_profit: i64,
}

pub fn get_profit_report_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
) -> Result<ProfitReport, String> {
    let mut stmt = conn.prepare(
        "SELECT sl.item_id, i.name, i.base_unit, sl.qty, sl.unit, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as tax_amt,
                sl.cost_paise
         FROM sale_lines sl
         JOIN sales s ON sl.invoice_no = s.invoice_no
         JOIN items i ON sl.item_id = i.id
         WHERE s.date >= ?1 AND s.date <= ?2
         ORDER BY i.name ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![from_date, to_date], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
        ))
    }).map_err(|e| e.to_string())?;

    use std::collections::BTreeMap;
    struct ItemProfitAcc {
        item_name: String,
        base_unit: String,
        qty_sold: i64,
        taxable_sale: i64,
        cost_amount: i64,
        tax_amount: i64,
    }

    let mut map: BTreeMap<i64, ItemProfitAcc> = BTreeMap::new();

    for r in rows {
        let (item_id, item_name, base_unit, qty, unit, taxable, tax_amt, cost_paise) = r.map_err(|e| e.to_string())?;
        let base_qty = get_qty_in_base_unit(conn, item_id, qty, &unit).unwrap_or(qty);
        
        let line_cost = if cost_paise > 0 {
            cost_paise
        } else {
            // Fallback for any legacy rows saved before cost snapshotting
            let wac = calculate_weighted_average_cost(conn, item_id).unwrap_or(0);
            (base_qty * wac) / 1000
        };

        let entry = map.entry(item_id).or_insert_with(|| ItemProfitAcc {
            item_name,
            base_unit,
            qty_sold: 0,
            taxable_sale: 0,
            cost_amount: 0,
            tax_amount: 0,
        });

        entry.qty_sold += base_qty;
        entry.taxable_sale += taxable;
        entry.cost_amount += line_cost;
        entry.tax_amount += tax_amt;
    }

    let mut items = Vec::new();
    let mut total_taxable_sale = 0i64;
    let mut total_cost = 0i64;
    let mut total_profit_without_gst = 0i64;
    let mut total_gross_sale = 0i64;
    let mut total_gross_profit = 0i64;

    for (item_id, acc) in map {
        let profit_without_gst = acc.taxable_sale - acc.cost_amount;
        let gross_sale = acc.taxable_sale + acc.tax_amount;
        let gross_profit = gross_sale - acc.cost_amount;

        let (unit_sale_price, unit_cost, unit_profit) = if acc.qty_sold > 0 {
            let sale_p = (acc.taxable_sale * 1000) / acc.qty_sold;
            let cost_p = (acc.cost_amount * 1000) / acc.qty_sold;
            (sale_p, cost_p, sale_p - cost_p)
        } else {
            (0, 0, 0)
        };

        let margin_percent = if acc.taxable_sale > 0 {
            (profit_without_gst as f64 * 100.0) / acc.taxable_sale as f64
        } else {
            0.0
        };

        total_taxable_sale += acc.taxable_sale;
        total_cost += acc.cost_amount;
        total_profit_without_gst += profit_without_gst;
        total_gross_sale += gross_sale;
        total_gross_profit += gross_profit;

        items.push(ProfitReportItem {
            item_id,
            item_name: acc.item_name,
            base_unit: acc.base_unit,
            qty_sold: acc.qty_sold,
            taxable_sale: acc.taxable_sale,
            cost_amount: acc.cost_amount,
            profit_without_gst,
            gross_sale,
            gross_profit,
            unit_sale_price,
            unit_cost,
            unit_profit,
            margin_percent,
        });
    }

    Ok(ProfitReport {
        items,
        total_taxable_sale,
        total_cost,
        total_profit_without_gst,
        total_gross_sale,
        total_gross_profit,
    })
}

#[command]
pub fn get_profit_report_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
) -> Result<ProfitReport, String> {
    let conn = get_conn(&app)?;
    get_profit_report_inner(&conn, &from_date, &to_date)
}

pub fn cleanup_accounting_parties_inner(conn: &Connection) -> Result<usize, String> {
    let deleted = conn.execute(
        "DELETE FROM parties 
         WHERE (
            LOWER(TRIM(name)) IN (
                'cash', 'cash account', 'cash-in-hand', 
                'profit & loss a/c', 'profit & loss', 
                'purchase', 'purchases', 'purchase account', 'purchases account', 
                'sales', 'sale', 'sales account', 
                'round off', 'cgst', 'sgst', 'igst'
            )
            OR LOWER(TRIM(name)) LIKE 'input %'
            OR LOWER(TRIM(name)) LIKE 'output %'
         )
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.supplier_id = parties.id)
         AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = parties.id)
         AND NOT EXISTS (SELECT 1 FROM party_ledger l WHERE l.party_id = parties.id)",
        [],
    ).map_err(|e| e.to_string())?;

    Ok(deleted)
}

#[command]
pub fn cleanup_accounting_parties_cmd(app: AppHandle) -> Result<usize, String> {
    let conn = get_conn(&app)?;
    cleanup_accounting_parties_inner(&conn)
}

// ==========================================
// PAYMENT VOUCHER ("पैसा मिला / पैसा दिया")
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PaymentPayload {
    pub party_id: i64,
    pub payment_type: String, // "receipt" ("मिला") or "payment" ("दिया")
    pub amount_paise: i64,
    pub payment_mode: String, // "cash", "upi_bank", "bank"
    pub date: String,         // YYYY-MM-DD
    pub remark: Option<String>,
    pub ref_id: Option<String>, // optional invoice_no to match or custom ref
}

pub fn record_payment_inner(conn: &mut Connection, payload: PaymentPayload) -> Result<String, String> {
    if payload.amount_paise <= 0 {
        return Err("Payment amount must be greater than zero".to_string());
    }

    // Verify party exists
    let _party_name: String = conn.query_row(
        "SELECT name FROM parties WHERE id = ?1",
        rusqlite::params![payload.party_id],
        |row| row.get(0)
    ).map_err(|_| format!("Party with id {} not found", payload.party_id))?;

    let is_receipt = payload.payment_type.to_lowercase() == "receipt" 
        || payload.payment_type == "मिला" 
        || payload.payment_type == "credit";

    // Generate reference id if not provided
    let ref_id = match payload.ref_id {
        Some(ref s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            let prefix = if is_receipt { "REC" } else { "PAY" };
            let clean_date = payload.date.replace("-", "");
            format!("{}-{}-{}", prefix, clean_date, payload.party_id)
        }
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mode = if payload.payment_mode.trim().is_empty() {
        "cash".to_string()
    } else {
        payload.payment_mode.trim().to_string()
    };

    let remark_str = payload.remark.as_deref().unwrap_or(if is_receipt {
        "Payment received"
    } else {
        "Payment made"
    });

    if is_receipt {
        // Customer gives money -> Cash/Bank Dr, Customer Cr (credit = amount)
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
             VALUES (?1, ?2, 'payment', ?3, 0, ?4, ?5, ?6)",
            rusqlite::params![payload.date, payload.party_id, ref_id, payload.amount_paise, mode, remark_str],
        ).map_err(|e| e.to_string())?;

        // Optional invoice matching: If ref_id is an existing sale invoice for this customer
        let is_matched_sale: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sales WHERE invoice_no = ?1 AND customer_id = ?2)",
            rusqlite::params![ref_id, payload.party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_matched_sale {
            tx.execute(
                "UPDATE sales SET paid_amount = MIN(total_amount, paid_amount + ?1) WHERE invoice_no = ?2 AND customer_id = ?3",
                rusqlite::params![payload.amount_paise, ref_id, payload.party_id],
            ).map_err(|e| e.to_string())?;
        }
    } else {
        // We pay supplier -> Supplier Dr (debit = amount), Cash/Bank Cr
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
             VALUES (?1, ?2, 'payment', ?3, ?4, 0, ?5, ?6)",
            rusqlite::params![payload.date, payload.party_id, ref_id, payload.amount_paise, mode, remark_str],
        ).map_err(|e| e.to_string())?;

        // Optional invoice matching: If ref_id is an existing purchase invoice for this supplier
        let is_matched_purchase: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1 AND supplier_id = ?2)",
            rusqlite::params![ref_id, payload.party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_matched_purchase {
            tx.execute(
                "UPDATE purchases SET paid_amount = MIN(total_amount, paid_amount + ?1) WHERE invoice_no = ?2 AND supplier_id = ?3",
                rusqlite::params![payload.amount_paise, ref_id, payload.party_id],
            ).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(ref_id)
}

#[command]
pub fn record_payment_cmd(app: AppHandle, payload: PaymentPayload) -> Result<String, String> {
    let mut conn = get_conn(&app)?;
    record_payment_inner(&mut conn, payload)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PendingBill {
    pub invoice_no: String,
    pub date: String,
    pub bill_type: String, // "sale" or "purchase"
    pub total_amount: i64, // paise
    pub paid_amount: i64,  // paise
    pub pending_amount: i64, // paise
}

pub fn get_pending_bills_inner(conn: &Connection, party_id: i64) -> Result<Vec<PendingBill>, String> {
    let mut list = Vec::new();

    // Query sales where customer_id = party_id and paid_amount < total_amount
    let mut stmt1 = conn.prepare(
        "SELECT invoice_no, date, 'sale' as bill_type, total_amount, paid_amount, (total_amount - paid_amount) as pending_amount 
         FROM sales 
         WHERE customer_id = ?1 AND paid_amount < total_amount 
         ORDER BY date ASC, invoice_no ASC"
    ).map_err(|e| e.to_string())?;

    let rows1 = stmt1.query_map(rusqlite::params![party_id], |row| {
        Ok(PendingBill {
            invoice_no: row.get(0)?,
            date: row.get(1)?,
            bill_type: row.get(2)?,
            total_amount: row.get(3)?,
            paid_amount: row.get(4)?,
            pending_amount: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    for r in rows1 {
        if let Ok(b) = r { list.push(b); }
    }

    // Query purchases where supplier_id = party_id and paid_amount < total_amount
    let mut stmt2 = conn.prepare(
        "SELECT invoice_no, date, 'purchase' as bill_type, total_amount, paid_amount, (total_amount - paid_amount) as pending_amount 
         FROM purchases 
         WHERE supplier_id = ?1 AND paid_amount < total_amount 
         ORDER BY date ASC, invoice_no ASC"
    ).map_err(|e| e.to_string())?;

    let rows2 = stmt2.query_map(rusqlite::params![party_id], |row| {
        Ok(PendingBill {
            invoice_no: row.get(0)?,
            date: row.get(1)?,
            bill_type: row.get(2)?,
            total_amount: row.get(3)?,
            paid_amount: row.get(4)?,
            pending_amount: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    for r in rows2 {
        if let Ok(b) = r { list.push(b); }
    }

    Ok(list)
}

#[command]
pub fn get_pending_bills_cmd(app: AppHandle, party_id: i64) -> Result<Vec<PendingBill>, String> {
    let conn = get_conn(&app)?;
    get_pending_bills_inner(&conn, party_id)
}

// ==========================================
// PARTY STATEMENT / ACCOUNT HISTORY
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyStatementItem {
    pub id: i64,
    pub date: String,
    pub entry_type: String, // "sale", "purchase", "payment"
    pub ref_id: Option<String>,
    pub debit: i64,
    pub credit: i64,
    pub payment_mode: String,
    pub remark: Option<String>,
    pub running_balance: i64, // (+ receivable, - payable)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyStatement {
    pub party_id: i64,
    pub party_name: String,
    pub party_type: String,
    pub category: String,
    pub phone: Option<String>,
    pub village: Option<String>,
    pub gstin: Option<String>,
    pub total_debit: i64,
    pub total_credit: i64,
    pub closing_balance: i64, // total_debit - total_credit
    pub entries: Vec<PartyStatementItem>,
}

pub fn get_party_statement_inner(conn: &Connection, party_id: i64) -> Result<PartyStatement, String> {
    let (party_name, party_type, category, phone, village, gstin) = conn.query_row(
        "SELECT name, type, category, phone, village, gstin FROM parties WHERE id = ?1",
        rusqlite::params![party_id],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    ).map_err(|_| format!("Party with id {} not found", party_id))?;

    let mut stmt = conn.prepare(
        "SELECT id, date, type, ref_id, debit, credit, COALESCE(payment_mode, 'cash'), remark 
         FROM party_ledger 
         WHERE party_id = ?1 
         ORDER BY date ASC, id ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![party_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_debit = 0i64;
    let mut total_credit = 0i64;
    let mut running_balance = 0i64;

    for r in rows {
        if let Ok((id, date, entry_type, ref_id, debit, credit, payment_mode, remark)) = r {
            total_debit += debit;
            total_credit += credit;
            running_balance += debit - credit;

            entries.push(PartyStatementItem {
                id,
                date,
                entry_type,
                ref_id,
                debit,
                credit,
                payment_mode,
                remark,
                running_balance,
            });
        }
    }

    Ok(PartyStatement {
        party_id,
        party_name,
        party_type,
        category,
        phone,
        village,
        gstin,
        total_debit,
        total_credit,
        closing_balance: running_balance,
        entries,
    })
}

#[command]
pub fn get_party_statement_cmd(app: AppHandle, party_id: i64) -> Result<PartyStatement, String> {
    let conn = get_conn(&app)?;
    get_party_statement_inner(&conn, party_id)
}

// ==========================================
// DASHBOARD ANALYTICS COMMANDS
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DailyTrend {
    pub date: String,
    pub sales_paise: i64,
    pub purchases_paise: i64,
}

pub fn get_7_day_trend_inner(conn: &Connection, today_date: &str) -> Result<Vec<DailyTrend>, String> {
    use chrono::{NaiveDate, Duration};

    let base_date = NaiveDate::parse_from_str(today_date, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());

    let mut trends = Vec::with_capacity(7);

    for i in (0..7).rev() {
        let current_date = base_date - Duration::days(i);
        let date_str = current_date.format("%Y-%m-%d").to_string();

        let sales_paise: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE date = ?1",
            rusqlite::params![&date_str],
            |row| row.get(0)
        ).unwrap_or(0);

        let purchases_paise: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE date = ?1",
            rusqlite::params![&date_str],
            |row| row.get(0)
        ).unwrap_or(0);

        trends.push(DailyTrend {
            date: date_str,
            sales_paise,
            purchases_paise,
        });
    }

    Ok(trends)
}

#[command]
pub fn get_7_day_trend_cmd(app: AppHandle, today_date: Option<String>) -> Result<Vec<DailyTrend>, String> {
    let conn = get_conn(&app)?;
    let date_str = today_date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    get_7_day_trend_inner(&conn, &date_str)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YesterdayComparison {
    pub today_date: String,
    pub yesterday_date: String,
    pub today_sales: i64,
    pub yesterday_sales: i64,
    pub sales_growth_percent: f64,
    pub today_purchases: i64,
    pub yesterday_purchases: i64,
    pub purchases_growth_percent: f64,
}

pub fn get_yesterday_comparison_inner(conn: &Connection, today_date: &str) -> Result<YesterdayComparison, String> {
    use chrono::{NaiveDate, Duration};

    let base_date = NaiveDate::parse_from_str(today_date, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    let yesterday = base_date - Duration::days(1);

    let today_str = base_date.format("%Y-%m-%d").to_string();
    let yesterday_str = yesterday.format("%Y-%m-%d").to_string();

    let today_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE date = ?1",
        rusqlite::params![&today_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let yesterday_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE date = ?1",
        rusqlite::params![&yesterday_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let today_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE date = ?1",
        rusqlite::params![&today_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let yesterday_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE date = ?1",
        rusqlite::params![&yesterday_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let sales_growth_percent = if yesterday_sales == 0 {
        if today_sales > 0 { 100.0 } else { 0.0 }
    } else {
        ((today_sales - yesterday_sales) as f64 / yesterday_sales as f64) * 100.0
    };

    let purchases_growth_percent = if yesterday_purchases == 0 {
        if today_purchases > 0 { 100.0 } else { 0.0 }
    } else {
        ((today_purchases - yesterday_purchases) as f64 / yesterday_purchases as f64) * 100.0
    };

    Ok(YesterdayComparison {
        today_date: today_str,
        yesterday_date: yesterday_str,
        today_sales,
        yesterday_sales,
        sales_growth_percent,
        today_purchases,
        yesterday_purchases,
        purchases_growth_percent,
    })
}

#[command]
pub fn get_yesterday_comparison_cmd(app: AppHandle, today_date: Option<String>) -> Result<YesterdayComparison, String> {
    let conn = get_conn(&app)?;
    let date_str = today_date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    get_yesterday_comparison_inner(&conn, &date_str)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TopReceivableParty {
    pub party_id: i64,
    pub name: String,
    pub village: Option<String>,
    pub phone: Option<String>,
    pub receivable_paise: i64,
    pub oldest_debt_date: Option<String>,
    pub oldest_debt_days: i64,
}

pub fn get_top_receivables_inner(conn: &Connection, limit: usize, as_of_date: Option<&str>) -> Result<Vec<TopReceivableParty>, String> {
    use chrono::NaiveDate;

    let as_of = match as_of_date {
        Some(s) => NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap_or_else(|_| chrono::Local::now().date_naive()),
        None => chrono::Local::now().date_naive(),
    };

    let balances = get_party_balances_inner(conn)?;
    let mut receivables: Vec<_> = balances.into_iter()
        .filter(|b| b.net_balance > 0)
        .collect();

    // Sort descending by net_balance (highest receivable first)
    receivables.sort_by(|a, b| b.net_balance.cmp(&a.net_balance));

    let top: Vec<_> = receivables.into_iter().take(limit).collect();
    let mut result = Vec::new();

    for p in top {
        // Query oldest debit entry date in party_ledger
        let oldest_date_opt: Option<String> = conn.query_row(
            "SELECT MIN(date) FROM party_ledger WHERE party_id = ?1 AND debit > 0",
            rusqlite::params![p.party_id],
            |row| row.get(0)
        ).unwrap_or(None);

        let oldest_debt_days = match &oldest_date_opt {
            Some(d_str) => {
                if let Ok(d) = NaiveDate::parse_from_str(d_str, "%Y-%m-%d") {
                    (as_of - d).num_days().max(0)
                } else {
                    0
                }
            }
            None => 0,
        };

        result.push(TopReceivableParty {
            party_id: p.party_id,
            name: p.party_name,
            village: p.village,
            phone: p.phone,
            receivable_paise: p.net_balance,
            oldest_debt_date: oldest_date_opt,
            oldest_debt_days,
        });
    }

    Ok(result)
}

#[command]
pub fn get_top_receivables_cmd(app: AppHandle, limit: Option<usize>, as_of_date: Option<String>) -> Result<Vec<TopReceivableParty>, String> {
    let conn = get_conn(&app)?;
    get_top_receivables_inner(&conn, limit.unwrap_or(5), as_of_date.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LowStockItem {
    pub item_id: i64,
    pub name: String,
    pub category: Option<String>,
    pub godown_id: i64,
    pub godown_name: String,
    pub current_stock_milli: i64,
    pub base_unit: String,
    pub threshold_milli: i64,
    pub last_purchase_rate: i64,
}

pub fn get_low_stock_items_inner(conn: &Connection, threshold_milli: i64) -> Result<Vec<LowStockItem>, String> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, i.category, i.base_unit, 
                COALESCE(SUM(s.qty_base), 0) as current_stock_milli
         FROM items i
         LEFT JOIN stock_ledger s ON s.item_id = i.id
         GROUP BY i.id, i.name, i.category, i.base_unit
         HAVING current_stock_milli <= ?1
         ORDER BY current_stock_milli ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![threshold_milli], |row| {
        let item_id: i64 = row.get(0)?;
        let name: String = row.get(1)?;
        let category: Option<String> = row.get(2)?;
        let base_unit: String = row.get(3)?;
        let current_stock_milli: i64 = row.get(4)?;
        Ok((item_id, name, category, base_unit, current_stock_milli))
    }).map_err(|e| e.to_string())?;

    let mut low_items = Vec::new();
    for r in rows {
        if let Ok((item_id, name, category, base_unit, current_stock_milli)) = r {
            let last_rate: i64 = conn.query_row(
                "SELECT rate FROM purchase_lines WHERE item_id = ?1 ORDER BY id DESC LIMIT 1",
                rusqlite::params![item_id],
                |row| row.get(0)
            ).unwrap_or(0);

            low_items.push(LowStockItem {
                item_id,
                name,
                category,
                godown_id: 1,
                godown_name: "Main Godown".to_string(),
                current_stock_milli,
                base_unit,
                threshold_milli,
                last_purchase_rate: last_rate,
            });
        }
    }

    Ok(low_items)
}

#[command]
pub fn get_low_stock_items_cmd(app: AppHandle, threshold_milli: Option<i64>) -> Result<Vec<LowStockItem>, String> {
    let conn = get_conn(&app)?;
    get_low_stock_items_inner(&conn, threshold_milli.unwrap_or(10_000))
}
