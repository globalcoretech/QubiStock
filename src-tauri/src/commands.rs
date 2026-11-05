use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, command};
use rusqlite::{Connection, OptionalExtension, params};
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

pub fn get_conn(app: &AppHandle) -> Result<Connection, String> {
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
    check_permission_for_command(&app, &conn, "preview_tally_import_cmd")?;
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
    check_permission_for_command(&app, &conn, "confirm_tally_import_cmd")?;
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

pub fn mask_stock_list_for_role(items: &mut [StockItem], role: &str) {
    if role == "staff" {
        for item in items {
            item.last_purchase_rate = 0;
            item.stock_value = 0;
        }
    }
}

#[command]
pub fn get_stock_list_cmd(app: AppHandle) -> Result<Vec<StockItem>, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_stock_list_cmd")?;
    let mut list = get_stock_list_inner(&conn)?;
    if let Some(ref u) = user_opt {
        mask_stock_list_for_role(&mut list, &u.role);
    }
    Ok(list)
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
    if !base_unit.eq_ignore_ascii_case(unit) {
        let f: Option<i64> = conn.query_row(
            "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
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
    check_permission_for_command(&app, &conn, "add_opening_stock_cmd")?;
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
    if !base_unit.eq_ignore_ascii_case(unit) {
        let f: Option<i64> = conn.query_row(
            "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
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
    check_permission_for_command(&app, &conn, "add_stock_adjustment_cmd")?;
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

pub fn mask_last_rates_for_role(rates: &mut LastRates, role: &str) {
    if role == "staff" {
        rates.last_purchase = None;
    }
}

#[command]
pub fn get_last_rates_cmd(app: AppHandle, item_id: i64) -> Result<LastRates, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_last_rates_cmd")?;
    let mut rates = get_last_rates_inner(&conn, item_id)?;
    if let Some(ref u) = user_opt {
        mask_last_rates_for_role(&mut rates, &u.role);
    }
    Ok(rates)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub base_unit: String,
    pub hsn: Option<String>,
    pub gst_rate: Option<i64>,
    pub gst_status: Option<String>,
    #[serde(default = "default_item_active")]
    pub is_active: Option<i64>,
    pub category: Option<String>,
}

fn default_item_active() -> Option<i64> {
    Some(1)
}

pub fn get_items_filtered_inner(conn: &Connection, include_inactive: bool) -> Result<Vec<Item>, String> {
    let sql = if include_inactive {
        "SELECT id, name, base_unit, hsn, gst_rate, COALESCE(gst_status, CASE WHEN gst_rate > 0 THEN 'taxable' WHEN gst_rate = 0 THEN 'nil_rated' ELSE 'not_set' END), COALESCE(is_active, 1), category FROM items ORDER BY name ASC"
    } else {
        "SELECT id, name, base_unit, hsn, gst_rate, COALESCE(gst_status, CASE WHEN gst_rate > 0 THEN 'taxable' WHEN gst_rate = 0 THEN 'nil_rated' ELSE 'not_set' END), COALESCE(is_active, 1), category FROM items WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Item {
            id: row.get(0)?,
            name: row.get(1)?,
            base_unit: row.get(2)?,
            hsn: row.get(3)?,
            gst_rate: row.get(4)?,
            gst_status: row.get(5)?,
            is_active: row.get(6)?,
            category: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

pub fn get_items_inner(conn: &Connection) -> Result<Vec<Item>, String> {
    get_items_filtered_inner(conn, true)
}

#[command]
pub fn get_items_cmd(app: AppHandle, include_inactive: Option<bool>) -> Result<Vec<Item>, String> {
    let conn = get_conn(&app)?;
    get_items_filtered_inner(&conn, include_inactive.unwrap_or(true))
}

pub fn add_item_inner(
    conn: &Connection,
    name: String,
    category: Option<String>,
    hsn: Option<String>,
    gst_rate: Option<i64>,
    base_unit: String,
    gst_status: Option<String>,
) -> Result<i64, String> {
    let effective_status = gst_status.unwrap_or_else(|| {
        match gst_rate {
            Some(r) if r > 0 => "taxable".to_string(),
            Some(r) if r == 0 => "nil_rated".to_string(),
            _ => "not_set".to_string(),
        }
    });
    conn.execute(
        "INSERT INTO items (name, category, hsn, gst_rate, base_unit, gst_status, is_active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
        rusqlite::params![name, category, hsn, gst_rate, base_unit, effective_status]
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[command]
pub fn add_item_cmd(
    app: AppHandle,
    name: String,
    category: Option<String>,
    hsn: Option<String>,
    gst_rate: Option<i64>,
    base_unit: String,
    gst_status: Option<String>,
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    add_item_inner(&conn, name, category, hsn, gst_rate, base_unit, gst_status)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateItemUnitItem {
    pub unit_name: String,
    pub factor_to_base: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateItemPayload {
    pub id: i64,
    pub name: String,
    pub category: Option<String>,
    pub hsn: Option<String>,
    pub gst_rate: Option<i64>,
    pub base_unit: String,
    pub gst_status: Option<String>,
    pub is_active: Option<i64>,
    pub units: Option<Vec<UpdateItemUnitItem>>,
    pub reason: Option<String>,
}

pub fn update_item_with_user(conn: &mut Connection, payload: UpdateItemPayload, user_name: Option<&str>) -> Result<(), String> {
    let name_trimmed = payload.name.trim();
    if name_trimmed.is_empty() {
        return Err("सामान का नाम खाली नहीं हो सकता! / Item name cannot be empty!".to_string());
    }

    // Name uniqueness check (case-insensitive across other items)
    let duplicate_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM items WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1)) AND id <> ?2",
        rusqlite::params![name_trimmed, payload.id],
        |r| r.get(0),
    ).unwrap_or(0);
    if duplicate_count > 0 {
        return Err(format!("इस नाम ({}) का सामान पहले से मौजूद है! / An item with this name already exists!", name_trimmed));
    }

    // GST rate validation: between 0 and 28000 milli-percent
    if let Some(r) = payload.gst_rate {
        if r < 0 || r > 28000 {
            return Err("GST दर 0% से 28% के बीच होनी चाहिए! / GST rate must be between 0% and 28%!".to_string());
        }
    }

    // HSN validation: digits only if provided
    if let Some(ref hsn_str) = payload.hsn {
        let trimmed_hsn = hsn_str.trim();
        if !trimmed_hsn.is_empty() && !trimmed_hsn.chars().all(|c| c.is_ascii_digit()) {
            return Err("HSN कोड में केवल अंक होने चाहिए! / HSN code must contain digits only!".to_string());
        }
    }

    // Fetch existing item for before_json and transaction checks
    let (old_name, old_category, old_hsn, old_gst_rate, old_base_unit, old_gst_status, old_is_active): (String, Option<String>, Option<String>, Option<i64>, String, Option<String>, i64) = conn.query_row(
        "SELECT name, category, hsn, gst_rate, base_unit, gst_status, COALESCE(is_active, 1) FROM items WHERE id = ?1",
        rusqlite::params![payload.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    ).map_err(|e| format!("Item not found: {}", e))?;

    // Check existing transactions
    let tx_count: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM sale_lines WHERE item_id = ?1) +
                (SELECT COUNT(*) FROM purchase_lines WHERE item_id = ?1) +
                (SELECT COUNT(*) FROM stock_ledger WHERE item_id = ?1)",
        rusqlite::params![payload.id],
        |r| r.get(0),
    ).unwrap_or(0);

    let has_transactions = tx_count > 0;

    if has_transactions {
        // Block changing base unit
        if !old_base_unit.trim().eq_ignore_ascii_case(payload.base_unit.trim()) {
            return Err("इस वस्तु में पुराने लेनदेन मौजूद हैं, इसलिए मूल इकाई (Base Unit) नहीं बदली जा सकती। / Item has existing transactions; base unit cannot be changed.".to_string());
        }

        // If units provided, verify that existing conversion factors haven't been altered or deleted
        if let Some(ref new_units) = payload.units {
            let mut stmt = conn.prepare("SELECT unit_name, factor_to_base FROM item_units WHERE item_id = ?1").map_err(|e| e.to_string())?;
            let existing_units = stmt.query_map(rusqlite::params![payload.id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            }).map_err(|e| e.to_string())?;

            for eu in existing_units {
                let (eu_name, eu_factor) = eu.map_err(|e| e.to_string())?;
                let found = new_units.iter().find(|u| u.unit_name.trim().eq_ignore_ascii_case(eu_name.trim()));
                match found {
                    None => {
                        return Err(format!(
                            "इस वस्तु में पुराने लेनदेन मौजूद हैं, इसलिए इकाई '{}' को हटाया नहीं जा सकता! / Unit '{}' cannot be removed because item has transactions.",
                            eu_name, eu_name
                        ));
                    }
                    Some(u) => {
                        if u.factor_to_base != eu_factor {
                            return Err(format!(
                                "पुराने लेनदेन होने के कारण इकाई '{}' का कन्वर्शन फ़ैक्टर बदला नहीं जा सकता! / Conversion factor for unit '{}' cannot be changed because item has transactions.",
                                eu_name, eu_name
                            ));
                        }
                    }
                }
            }
        }
    }

    let before_obj = serde_json::json!({
        "name": old_name,
        "category": old_category,
        "hsn": old_hsn,
        "gst_rate": old_gst_rate,
        "base_unit": old_base_unit,
        "gst_status": old_gst_status,
        "is_active": old_is_active,
    });

    let effective_status = payload.gst_status.clone().unwrap_or_else(|| {
        match payload.gst_rate {
            Some(r) if r > 0 => "taxable".to_string(),
            Some(r) if r == 0 => "nil_rated".to_string(),
            _ => "not_set".to_string(),
        }
    });

    let is_active_val = payload.is_active.unwrap_or(1);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE items SET name = ?1, category = ?2, hsn = ?3, gst_rate = ?4, base_unit = ?5, gst_status = ?6, is_active = ?7 WHERE id = ?8",
        rusqlite::params![
            name_trimmed,
            payload.category,
            payload.hsn.as_ref().map(|s| s.trim()),
            payload.gst_rate,
            payload.base_unit.trim(),
            effective_status,
            is_active_val,
            payload.id
        ],
    ).map_err(|e| e.to_string())?;

    // Update or insert new units if provided
    if let Some(ref new_units) = payload.units {
        for u in new_units {
            tx.execute(
                "INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (?1, ?2, ?3)
                 ON CONFLICT(item_id, unit_name) DO UPDATE SET factor_to_base = ?3",
                rusqlite::params![payload.id, u.unit_name.trim(), u.factor_to_base],
            ).map_err(|e| e.to_string())?;
        }
    }

    let after_obj = serde_json::json!({
        "name": name_trimmed,
        "category": payload.category,
        "hsn": payload.hsn.as_ref().map(|s| s.trim()),
        "gst_rate": payload.gst_rate,
        "base_unit": payload.base_unit.trim(),
        "gst_status": effective_status,
        "is_active": is_active_val,
    });

    crate::audit::write_audit(
        &tx,
        "item",
        &payload.id.to_string(),
        "update",
        Some(&before_obj.to_string()),
        Some(&after_obj.to_string()),
        payload.reason.as_deref(),
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn update_item_inner(conn: &mut Connection, payload: UpdateItemPayload) -> Result<(), String> {
    update_item_with_user(conn, payload, None)
}

#[command]
pub fn update_item_cmd(
    app: AppHandle,
    payload: UpdateItemPayload,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "update_item_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    update_item_with_user(&mut conn, payload, user_name)
}

pub fn delete_item_inner(conn: &mut Connection, item_id: i64) -> Result<(), String> {
    let tx_count: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM sale_lines WHERE item_id = ?1) +
                (SELECT COUNT(*) FROM purchase_lines WHERE item_id = ?1) +
                (SELECT COUNT(*) FROM stock_ledger WHERE item_id = ?1)",
        rusqlite::params![item_id],
        |r| r.get(0),
    ).unwrap_or(0);

    if tx_count > 0 {
        return Err("इस सामान के पुराने लेनदेन मौजूद हैं, इसे हटाया नहीं जा सकता! इसके बजाय इसे निष्क्रिय (Inactive) करें। / Item has existing transactions and cannot be deleted. Please mark it inactive instead.".to_string());
    }

    conn.execute("DELETE FROM item_units WHERE item_id = ?1", rusqlite::params![item_id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM items WHERE id = ?1", rusqlite::params![item_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn delete_item_cmd(app: AppHandle, id: i64) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "delete_item_cmd")?;
    delete_item_inner(&mut conn, id)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ItemUnit {
    pub unit_name: String,
    pub factor_to_base: i64,
}

pub fn get_item_units_inner(conn: &Connection, item_id: i64) -> Result<Vec<ItemUnit>, String> {
    let mut stmt = conn.prepare("SELECT unit_name, factor_to_base FROM item_units WHERE item_id = ?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![item_id], |r| {
        Ok(ItemUnit {
            unit_name: r.get(0)?,
            factor_to_base: r.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

#[command]
pub fn get_item_units_cmd(app: AppHandle, item_id: i64) -> Result<Vec<ItemUnit>, String> {
    let conn = get_conn(&app)?;
    get_item_units_inner(&conn, item_id)
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
        
        let item_id = add_item_inner(&conn, "Urea".to_string(), None, None, Some(5000), "kg".to_string(), Some("taxable".to_string())).unwrap();
        assert_eq!(item_id, 1);
        
        let items = get_items_inner(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Urea");
        assert_eq!(items[0].gst_status.as_deref(), Some("taxable"));
        
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
    pub address: Option<String>,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
}

pub fn validate_gstin(gstin: &str) -> bool {
    let clean = gstin.trim();
    if clean.len() != 15 {
        return false;
    }
    clean.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn get_parties_inner(conn: &Connection, party_type: &str) -> Result<Vec<Party>, String> {
    let query = match party_type {
        "supplier" => "SELECT id, name, type, category, village, address, phone, gstin, state_code FROM parties WHERE type = 'supplier' OR type = 'both' ORDER BY name ASC",
        "customer" => "SELECT id, name, type, category, village, address, phone, gstin, state_code FROM parties WHERE type = 'customer' OR type = 'both' ORDER BY name ASC",
        _ => "SELECT id, name, type, category, village, address, phone, gstin, state_code FROM parties ORDER BY name ASC",
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Party {
            id: row.get(0)?,
            name: row.get(1)?,
            party_type: row.get(2)?,
            category: row.get(3)?,
            village: row.get(4)?,
            address: row.get(5)?,
            phone: row.get(6)?,
            gstin: row.get(7)?,
            state_code: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        if let Ok(p) = row { items.push(p); }
    }
    Ok(items)
}

#[command]
pub fn get_parties_cmd(app: AppHandle, party_type: Option<String>) -> Result<Vec<Party>, String> {
    let conn = get_conn(&app)?;
    get_parties_inner(&conn, party_type.as_deref().unwrap_or(""))
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

    let state_code = gstin_clean.as_ref().and_then(|g| {
        if g.len() >= 2 { Some(g[0..2].to_string()) } else { None }
    });

    conn.execute(
        "INSERT INTO parties (name, type, category, village, gstin, phone, state_code, guid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
        rusqlite::params![name, party_type, cat, village, gstin_clean, phone, state_code]
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
    phone: Option<String>,
    address: Option<String>,
    state_code: Option<String>,
) -> Result<i64, String> {
    let conn = get_conn(&app)?;
    let cat = category.unwrap_or_else(|| "unregistered".to_string());
    let gstin_clean = gstin.map(|g| g.trim().to_uppercase());

    if cat.to_lowercase() == "regular" {
        match &gstin_clean {
            Some(g) if validate_gstin(g) => {},
            _ => return Err("Valid 15-character GSTIN is required for Regular parties (e.g. 22AAAAA0000A1Z5)".to_string()),
        }
    }

    let derived_state = state_code.or_else(|| {
        gstin_clean.as_ref().and_then(|g| if g.len() >= 2 { Some(g[0..2].to_string()) } else { None })
    });

    conn.execute(
        "INSERT INTO parties (name, type, category, village, address, phone, gstin, state_code, guid) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
        rusqlite::params![name, party_type, cat, village, address, phone, gstin_clean, derived_state]
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdatePartyPayload {
    pub id: i64,
    pub name: String,
    #[serde(alias = "party_type", alias = "type_")]
    pub party_type: String, // 'customer', 'supplier', or 'both'
    pub category: String,   // 'regular', 'composition', 'unregistered'
    pub village: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
    pub reason: Option<String>,
}

pub fn update_party_with_user(conn: &mut Connection, payload: UpdatePartyPayload, user_name: Option<&str>) -> Result<(), String> {
    let name_trimmed = payload.name.trim();
    if name_trimmed.is_empty() {
        return Err("पार्टी का नाम खाली नहीं हो सकता! / Party name cannot be empty!".to_string());
    }

    // Default "Cash Sale (Walk-in)" party id 1 cannot be renamed, retyped or deleted
    if payload.id == 1 {
        if name_trimmed != "Cash Sale (Walk-in)" {
            return Err("डिफ़ॉल्ट 'Cash Sale (Walk-in)' पार्टी का नाम नहीं बदला जा सकता! / Default Cash Sale (Walk-in) party cannot be renamed.".to_string());
        }
        if payload.party_type != "both" {
            return Err("डिफ़ॉल्ट 'Cash Sale (Walk-in)' पार्टी का प्रकार केवल 'both' ही रह सकता है! / Default Cash Sale (Walk-in) party type cannot be changed.".to_string());
        }
    }

    // Fetch existing party
    let (old_name, old_type, old_category, old_village, old_address, old_phone, old_gstin, old_state_code): (String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>) = conn.query_row(
        "SELECT name, type, category, village, address, phone, gstin, state_code FROM parties WHERE id = ?1",
        rusqlite::params![payload.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
    ).map_err(|e| format!("Party not found: {}", e))?;

    // Validate type conflicts with existing transactions
    if payload.party_type == "supplier" {
        let sales_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE customer_id = ?1",
            rusqlite::params![payload.id],
            |r| r.get(0),
        ).unwrap_or(0);
        if sales_count > 0 {
            return Err("इस पार्टी के बिक्री बिल (Sales) मौजूद हैं, अतः इसे केवल सप्लायर (Supplier) नहीं बनाया जा सकता! / Party has existing sales; cannot change type to supplier-only.".to_string());
        }
    }

    if payload.party_type == "customer" {
        let pur_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1",
            rusqlite::params![payload.id],
            |r| r.get(0),
        ).unwrap_or(0);
        if pur_count > 0 {
            return Err("इस पार्टी के खरीद बिल (Purchases) मौजूद हैं, अतः इसे केवल ग्राहक (Customer) नहीं बनाया जा सकता! / Party has existing purchases; cannot change type to customer-only.".to_string());
        }
    }

    // GSTIN format and state code
    let clean_gstin = payload.gstin.map(|g| g.trim().to_uppercase()).filter(|g| !g.is_empty());
    let mut auto_state = payload.state_code.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    if let Some(ref g) = clean_gstin {
        if g.len() != 15 || !g.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("GSTIN 15 अक्षरों/अंकों का होना चाहिए! / GSTIN must be 15 alphanumeric characters!".to_string());
        }
        auto_state = Some(g[0..2].to_string());
    }

    let before_obj = serde_json::json!({
        "name": old_name,
        "type": old_type,
        "category": old_category,
        "village": old_village,
        "address": old_address,
        "phone": old_phone,
        "gstin": old_gstin,
        "state_code": old_state_code,
    });

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE parties SET name = ?1, type = ?2, category = ?3, village = ?4, address = ?5, phone = ?6, gstin = ?7, state_code = ?8 WHERE id = ?9",
        rusqlite::params![
            name_trimmed,
            payload.party_type,
            payload.category,
            payload.village.as_ref().map(|s| s.trim()),
            payload.address.as_ref().map(|s| s.trim()),
            payload.phone.as_ref().map(|s| s.trim()),
            clean_gstin,
            auto_state,
            payload.id
        ],
    ).map_err(|e| e.to_string())?;

    let after_obj = serde_json::json!({
        "name": name_trimmed,
        "type": payload.party_type,
        "category": payload.category,
        "village": payload.village.as_ref().map(|s| s.trim()),
        "address": payload.address.as_ref().map(|s| s.trim()),
        "phone": payload.phone.as_ref().map(|s| s.trim()),
        "gstin": clean_gstin,
        "state_code": auto_state,
    });

    crate::audit::write_audit(
        &tx,
        "party",
        &payload.id.to_string(),
        "update",
        Some(&before_obj.to_string()),
        Some(&after_obj.to_string()),
        payload.reason.as_deref(),
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn update_party_inner(conn: &mut Connection, payload: UpdatePartyPayload) -> Result<(), String> {
    update_party_with_user(conn, payload, None)
}

#[command]
pub fn update_party_cmd(
    app: AppHandle,
    payload: UpdatePartyPayload,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "update_party_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    update_party_with_user(&mut conn, payload, user_name)
}

pub fn delete_party_inner(conn: &mut Connection, party_id: i64) -> Result<(), String> {
    if party_id == 1 {
        return Err("डिफ़ॉल्ट 'Cash Sale (Walk-in)' पार्टी को हटाया नहीं जा सकता! / Default Cash Sale (Walk-in) party cannot be deleted.".to_string());
    }

    let tx_count: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM sales WHERE customer_id = ?1) +
                (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1) +
                (SELECT COUNT(*) FROM party_ledger WHERE party_id = ?1)",
        rusqlite::params![party_id],
        |r| r.get(0),
    ).unwrap_or(0);

    if tx_count > 0 {
        return Err("इस पार्टी के पुराने लेनदेन मौजूद हैं, इसे हटाया नहीं जा सकता! / Party has existing transactions and cannot be deleted.".to_string());
    }

    conn.execute("DELETE FROM parties WHERE id = ?1", rusqlite::params![party_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub fn delete_party_cmd(app: AppHandle, id: i64) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "delete_party_cmd")?;
    delete_party_inner(&mut conn, id)
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

pub fn mask_party_balances_for_role(balances: &mut [PartyBalance]) {
    for b in balances.iter_mut() {
        if crate::auth::is_supplier_party_type(&b.party_type) {
            b.total_debit = 0;
            b.total_credit = 0;
            b.net_balance = 0;
        }
    }
}

#[command]
pub fn get_party_balances_cmd(app: AppHandle) -> Result<Vec<PartyBalance>, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_party_balances_cmd")?;
    let mut balances = get_party_balances_inner(&conn)?;
    if let Some(user) = user_opt {
        if crate::auth::should_mask_supplier_data_for_role(&user.role) {
            mask_party_balances_for_role(&mut balances);
        }
    }
    Ok(balances)
}

#[command]
pub fn save_invoice_cmd(app: AppHandle, payload: InvoicePayload) -> Result<(), String> {
    if payload.type_ == "purchase" {
        let s_no = payload.supplier_invoice_no.as_deref().unwrap_or("").trim();
        if s_no.is_empty() {
            return Err("Supplier's invoice number is required / सप्लायर का बिल नंबर आवश्यक है".to_string());
        }
    }
    let mut conn = get_conn(&app)?;
    save_invoice(&mut conn, payload).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Movement {
    pub date: String,
    pub qty_base: i64,
    pub type_: String,
    pub ref_id: Option<String>,
    #[serde(default)]
    pub rate_paise: i64,
    #[serde(default)]
    pub total_amount_paise: i64,
}

pub fn mask_item_movement_for_role(movements: &mut [Movement]) {
    for m in movements.iter_mut() {
        if m.type_.eq_ignore_ascii_case("purchase") {
            m.rate_paise = 0;
            m.total_amount_paise = 0;
        }
    }
}

pub fn get_item_movement_inner(conn: &Connection, item_id: i64, godown_id: Option<i64>) -> Result<Vec<Movement>, String> {
    let mut items = Vec::new();

    let query = if godown_id.is_some() {
        "SELECT sl.date, sl.qty_base, sl.type,
                CASE WHEN sl.type = 'purchase' THEN COALESCE(p.supplier_invoice_no, sl.ref_id) ELSE sl.ref_id END as ref_id,
                COALESCE(CASE WHEN sl.type = 'purchase' THEN pl.rate WHEN sl.type = 'sale' THEN sline.rate ELSE 0 END, 0) as rate_paise,
                COALESCE(CASE WHEN sl.type = 'purchase' THEN pl.taxable + COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)
                              WHEN sl.type = 'sale' THEN sline.taxable + COALESCE(sline.cgst, 0) + COALESCE(sline.sgst, 0) + COALESCE(sline.igst, 0)
                              ELSE 0 END, 0) as total_amount_paise
         FROM stock_ledger sl
         LEFT JOIN purchases p ON sl.ref_id = p.invoice_no AND sl.type = 'purchase'
         LEFT JOIN purchase_lines pl ON sl.ref_id = pl.invoice_no AND sl.item_id = pl.item_id AND sl.type = 'purchase'
         LEFT JOIN sale_lines sline ON sl.ref_id = sline.invoice_no AND sl.item_id = sline.item_id AND sl.type = 'sale'
         WHERE sl.item_id = ?1 AND sl.godown_id = ?2
         ORDER BY sl.id DESC"
    } else {
        "SELECT sl.date, sl.qty_base, sl.type,
                CASE WHEN sl.type = 'purchase' THEN COALESCE(p.supplier_invoice_no, sl.ref_id) ELSE sl.ref_id END as ref_id,
                COALESCE(CASE WHEN sl.type = 'purchase' THEN pl.rate WHEN sl.type = 'sale' THEN sline.rate ELSE 0 END, 0) as rate_paise,
                COALESCE(CASE WHEN sl.type = 'purchase' THEN pl.taxable + COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)
                              WHEN sl.type = 'sale' THEN sline.taxable + COALESCE(sline.cgst, 0) + COALESCE(sline.sgst, 0) + COALESCE(sline.igst, 0)
                              ELSE 0 END, 0) as total_amount_paise
         FROM stock_ledger sl
         LEFT JOIN purchases p ON sl.ref_id = p.invoice_no AND sl.type = 'purchase'
         LEFT JOIN purchase_lines pl ON sl.ref_id = pl.invoice_no AND sl.item_id = pl.item_id AND sl.type = 'purchase'
         LEFT JOIN sale_lines sline ON sl.ref_id = sline.invoice_no AND sl.item_id = sline.item_id AND sl.type = 'sale'
         WHERE sl.item_id = ?1
         ORDER BY sl.id DESC"
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let map_row = |row: &rusqlite::Row| {
        Ok(Movement {
            date: row.get(0)?,
            qty_base: row.get(1)?,
            type_: row.get(2)?,
            ref_id: row.get(3)?,
            rate_paise: row.get(4)?,
            total_amount_paise: row.get(5)?,
        })
    };

    let rows = if let Some(gid) = godown_id {
        stmt.query_map(rusqlite::params![item_id, gid], map_row).map_err(|e| e.to_string())?
    } else {
        stmt.query_map(rusqlite::params![item_id], map_row).map_err(|e| e.to_string())?
    };

    for row in rows {
        if let Ok(m) = row {
            items.push(m);
        }
    }
    Ok(items)
}

#[command]
pub fn get_item_movement_cmd(app: AppHandle, item_id: i64, godown_id: Option<i64>) -> Result<Vec<Movement>, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_item_movement_cmd")?;
    let mut movements = get_item_movement_inner(&conn, item_id, godown_id)?;
    if let Some(user) = user_opt {
        if crate::auth::should_mask_supplier_data_for_role(&user.role) {
            mask_item_movement_for_role(&mut movements);
        }
    }
    Ok(movements)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DashboardStats {
    pub today_sales: i64,      // paise
    pub today_purchases: i64,  // paise
    pub total_receivable: i64, // paise
    pub total_payable: i64,    // paise
}

pub fn get_dashboard_stats_inner(conn: &Connection, today_date: &str) -> Result<DashboardStats, String> {
    let clean_date = today_date.split('T').next().unwrap_or(today_date).trim();
    let today_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
        rusqlite::params![clean_date],
        |row| row.get(0)
    ).unwrap_or(0);

    let today_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
        rusqlite::params![clean_date],
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

pub fn mask_dashboard_stats_for_role(stats: &mut DashboardStats, role: &str) {
    if role == "staff" {
        stats.today_purchases = 0;
        stats.total_payable = 0;
    }
}

#[command]
pub fn get_dashboard_stats_cmd(app: AppHandle, today_date: Option<String>) -> Result<DashboardStats, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_dashboard_stats_cmd")?;
    let date_str = today_date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let mut stats = get_dashboard_stats_inner(&conn, &date_str)?;
    if let Some(ref u) = user_opt {
        mask_dashboard_stats_for_role(&mut stats, &u.role);
    }
    Ok(stats)
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
         WHERE COALESCE(status, 'active') <> 'cancelled'
         UNION ALL
         SELECT date, 'purchase' as entry_type, invoice_no, 
                COALESCE((SELECT name FROM parties WHERE id = supplier_id), 'Supplier') as party_name, 
                total_amount, payment_mode
         FROM purchases
         WHERE COALESCE(status, 'active') <> 'cancelled'
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
    #[serde(default)]
    pub item_id: Option<i64>,
    pub item_name: String,
    #[serde(default)]
    pub hsn: Option<String>,
    pub qty: i64,      // milli
    pub unit: String,
    pub rate: i64,     // paise
    pub taxable: i64,  // paise
    #[serde(default)]
    pub gst_rate: Option<i64>,
    pub gst_amount: i64,// paise
    pub total: i64,    // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InvoicePrintDetails {
    pub invoice_no: String,
    pub date: String,
    pub party_name: String,
    #[serde(default)]
    pub party_id: Option<i64>,
    #[serde(default)]
    pub godown_id: Option<i64>,
    pub party_phone: Option<String>,
    pub party_gstin: Option<String>,
    pub party_village: Option<String>,
    #[serde(default)]
    pub party_address: Option<String>,
    #[serde(default)]
    pub party_state_code: Option<String>,
    pub payment_mode: String,
    pub paid_amount: i64,
    pub total_amount: i64,
    #[serde(default)]
    pub supplier_invoice_no: Option<String>,
    #[serde(default)]
    pub supplier_invoice_date: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    pub lines: Vec<InvoicePrintLine>,
}

pub fn get_invoice_details_inner(conn: &Connection, invoice_no: &str) -> Result<InvoicePrintDetails, String> {
    let clean_inv = invoice_no.trim();
    if clean_inv.is_empty() {
        return Err("Invoice number cannot be empty".to_string());
    }

    let sale_res = conn.query_row(
        "SELECT s.invoice_no, s.date, COALESCE(p.name, 'Customer'), p.phone, p.gstin, p.village,
                s.payment_mode, s.paid_amount, s.total_amount, p.address, p.state_code, s.customer_id, COALESCE(s.status, 'active')
         FROM sales s
         LEFT JOIN parties p ON s.customer_id = p.id
         WHERE TRIM(s.invoice_no) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(s.invoice_no), '/', '-') = REPLACE(?1, '/', '-')
         ORDER BY (TRIM(s.invoice_no) = ?1 COLLATE NOCASE) DESC
         LIMIT 1",
        rusqlite::params![clean_inv],
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
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, String>(12)?,
        ))
    );

    if let Ok((inv_no, date, party_name, party_phone, party_gstin, party_village, payment_mode, paid_amount, total_amount, party_address, party_state_code, customer_id, inv_status)) = sale_res {
        let godown_id: Option<i64> = conn.query_row(
            "SELECT godown_id FROM stock_ledger WHERE ref_id = ?1 LIMIT 1",
            rusqlite::params![&inv_no],
            |r| r.get(0)
        ).ok();

        let mut stmt = conn.prepare(
            "SELECT COALESCE(i.name, 'Item'), sl.qty, sl.unit, sl.rate, sl.taxable, (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as gst_amt,
                    COALESCE(sl.hsn, i.hsn) as line_hsn,
                    COALESCE(sl.gst_rate, i.gst_rate) as line_gst_rate,
                    sl.item_id
             FROM sale_lines sl
             LEFT JOIN items i ON sl.item_id = i.id
             WHERE sl.invoice_no = ?1"
        ).map_err(|e| e.to_string())?;

        let line_rows = stmt.query_map(rusqlite::params![&inv_no], |row| {
            let item_name: String = row.get(0)?;
            let qty: i64 = row.get(1)?;
            let unit: String = row.get(2)?;
            let rate: i64 = row.get(3)?;
            let taxable: i64 = row.get(4)?;
            let gst_amt: i64 = row.get(5)?;
            let line_hsn: Option<String> = row.get(6)?;
            let line_gst_rate: Option<i64> = row.get(7)?;
            let item_id: i64 = row.get(8)?;
            Ok(InvoicePrintLine {
                item_id: Some(item_id),
                item_name,
                hsn: line_hsn,
                qty,
                unit,
                rate,
                taxable,
                gst_rate: line_gst_rate,
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
            party_id: Some(customer_id),
            godown_id,
            party_phone,
            party_gstin,
            party_village,
            party_address,
            party_state_code,
            payment_mode,
            paid_amount,
            total_amount,
            supplier_invoice_no: None,
            supplier_invoice_date: None,
            status: Some(inv_status),
            lines,
        });
    }

    let pur_res = conn.query_row(
        "SELECT p.invoice_no, p.date, COALESCE(pr.name, 'Supplier'), pr.phone, pr.gstin, pr.village,
                p.payment_mode, p.paid_amount, p.total_amount, pr.address, pr.state_code,
                p.supplier_invoice_no, p.supplier_invoice_date, p.supplier_id, COALESCE(p.status, 'active')
         FROM purchases p
         LEFT JOIN parties pr ON p.supplier_id = pr.id
         WHERE TRIM(p.invoice_no) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(p.invoice_no), '/', '-') = REPLACE(?1, '/', '-')
            OR TRIM(COALESCE(p.supplier_invoice_no, '')) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(COALESCE(p.supplier_invoice_no, '')), '/', '-') = REPLACE(?1, '/', '-')
         ORDER BY (TRIM(p.invoice_no) = ?1 COLLATE NOCASE) DESC,
                  (REPLACE(TRIM(p.invoice_no), '/', '-') = REPLACE(?1, '/', '-')) DESC
         LIMIT 1",
        rusqlite::params![clean_inv],
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
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, Option<String>>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, i64>(13)?,
            row.get::<_, String>(14)?,
        ))
    );

    if let Ok((inv_no, date, party_name, party_phone, party_gstin, party_village, payment_mode, paid_amount, total_amount, party_address, party_state_code, supp_inv_no, supp_inv_date, supplier_id, inv_status)) = pur_res {
        let godown_id: Option<i64> = conn.query_row(
            "SELECT godown_id FROM stock_ledger WHERE ref_id = ?1 LIMIT 1",
            rusqlite::params![&inv_no],
            |r| r.get(0)
        ).ok();

        let mut stmt = conn.prepare(
            "SELECT COALESCE(i.name, 'Item'), pl.qty, pl.unit, pl.rate, pl.taxable, (COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)) as gst_amt,
                    COALESCE(pl.hsn, i.hsn) as line_hsn,
                    COALESCE(pl.gst_rate, i.gst_rate) as line_gst_rate,
                    pl.item_id
             FROM purchase_lines pl
             LEFT JOIN items i ON pl.item_id = i.id
             WHERE pl.invoice_no = ?1"
        ).map_err(|e| e.to_string())?;

        let line_rows = stmt.query_map(rusqlite::params![&inv_no], |row| {
            let item_name: String = row.get(0)?;
            let qty: i64 = row.get(1)?;
            let unit: String = row.get(2)?;
            let rate: i64 = row.get(3)?;
            let taxable: i64 = row.get(4)?;
            let gst_amt: i64 = row.get(5)?;
            let line_hsn: Option<String> = row.get(6)?;
            let line_gst_rate: Option<i64> = row.get(7)?;
            let item_id: i64 = row.get(8)?;
            Ok(InvoicePrintLine {
                item_id: Some(item_id),
                item_name,
                hsn: line_hsn,
                qty,
                unit,
                rate,
                taxable,
                gst_rate: line_gst_rate,
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
            party_id: Some(supplier_id),
            godown_id,
            party_phone,
            party_gstin,
            party_village,
            party_address,
            party_state_code,
            payment_mode,
            paid_amount,
            total_amount,
            supplier_invoice_no: supp_inv_no,
            supplier_invoice_date: supp_inv_date,
            status: Some(inv_status),
            lines,
        });
    }

    Err(format!("Invoice '{}' not found", invoice_no))
}

pub fn mask_invoice_details_for_role(details: &mut InvoicePrintDetails, is_purchase: bool, role: &str) {
    if role == "staff" && is_purchase {
        details.paid_amount = 0;
        details.total_amount = 0;
        for line in &mut details.lines {
            line.rate = 0;
            line.taxable = 0;
            line.gst_amount = 0;
            line.total = 0;
        }
    }
}

#[command]
pub fn get_invoice_details_cmd(app: AppHandle, invoice_no: String) -> Result<InvoicePrintDetails, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_invoice_details_cmd")?;
    let mut details = get_invoice_details_inner(&conn, &invoice_no)?;
    if let Some(ref u) = user_opt {
        let is_purchase: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1)",
            rusqlite::params![&invoice_no],
            |r| r.get(0)
        ).unwrap_or(false);
        mask_invoice_details_for_role(&mut details, is_purchase, &u.role);
    }
    Ok(details)
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
    #[serde(default)]
    pub supplier_invoice_no: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
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
                p.total_amount,
                p.supplier_invoice_no,
                COALESCE(p.status, 'active') as status
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
            row.get::<_, Option<String>>(11)?,
            row.get::<_, String>(12)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_taxable = 0i64;
    let mut total_cgst = 0i64;
    let mut total_sgst = 0i64;
    let mut total_igst = 0i64;
    let mut grand_total = 0i64;

    for r in rows {
        let (inv_no, date, party_name, party_gstin, payment_mode, paid_amount, taxable, raw_cgst, raw_sgst, raw_igst, total_amt, supplier_inv, inv_status) = r.map_err(|e| e.to_string())?;
        
        let total_tax = raw_cgst + raw_sgst + raw_igst;
        let is_inter = is_interstate_party(party_gstin.as_deref(), shop_state);
        let (cgst, sgst, igst, state_type) = if is_inter {
            (0, 0, total_tax, "interstate".to_string())
        } else {
            let half = total_tax / 2;
            (half, total_tax - half, 0, "intrastate".to_string())
        };

        if inv_status != "cancelled" {
            total_taxable += taxable;
            total_cgst += cgst;
            total_sgst += sgst;
            total_igst += igst;
            grand_total += total_amt;
        }

        let display_no = supplier_inv.clone().filter(|s| !s.trim().is_empty()).unwrap_or(inv_no);

        entries.push(RegisterEntry {
            invoice_no: display_no,
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
            supplier_invoice_no: supplier_inv,
            status: Some(inv_status),
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

pub fn mask_purchase_register_for_role(report: &mut RegisterReport, role: &str) {
    if role == "staff" {
        report.total_taxable = 0;
        report.total_cgst = 0;
        report.total_sgst = 0;
        report.total_igst = 0;
        report.grand_total = 0;
        for entry in &mut report.entries {
            entry.taxable = 0;
            entry.cgst = 0;
            entry.sgst = 0;
            entry.igst = 0;
            entry.total = 0;
            entry.paid_amount = 0;
        }
    }
}

#[command]
pub fn get_purchase_register_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
    shop_state: Option<String>,
) -> Result<RegisterReport, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_purchase_register_cmd")?;
    let mut report = get_purchase_register_inner(&conn, &from_date, &to_date, shop_state.as_deref())?;
    if let Some(ref u) = user_opt {
        mask_purchase_register_for_role(&mut report, &u.role);
    }
    Ok(report)
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
                s.total_amount,
                COALESCE(s.status, 'active') as status
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
            row.get::<_, String>(11)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_taxable = 0i64;
    let mut total_cgst = 0i64;
    let mut total_sgst = 0i64;
    let mut total_igst = 0i64;
    let mut grand_total = 0i64;

    for r in rows {
        let (inv_no, date, party_name, party_gstin, payment_mode, paid_amount, taxable, raw_cgst, raw_sgst, raw_igst, total_amt, inv_status) = r.map_err(|e| e.to_string())?;
        
        let total_tax = raw_cgst + raw_sgst + raw_igst;
        let is_inter = is_interstate_party(party_gstin.as_deref(), shop_state);
        let (cgst, sgst, igst, state_type) = if is_inter {
            (0, 0, total_tax, "interstate".to_string())
        } else {
            let half = total_tax / 2;
            (half, total_tax - half, 0, "intrastate".to_string())
        };

        if inv_status != "cancelled" {
            total_taxable += taxable;
            total_cgst += cgst;
            total_sgst += sgst;
            total_igst += igst;
            grand_total += total_amt;
        }

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
            supplier_invoice_no: None,
            status: Some(inv_status),
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
         WHERE s.date >= ?1 AND s.date <= ?2 AND COALESCE(s.status, 'active') <> 'cancelled'
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
         WHERE p.date >= ?1 AND p.date <= ?2 AND COALESCE(p.status, 'active') <> 'cancelled'
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
    check_permission_for_command(&app, &conn, "get_gst_summary_cmd")?;
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
        "SELECT COALESCE(NULLIF(TRIM(sl.hsn), ''), NULLIF(TRIM(i.hsn), ''), 'अन्य / बिना HSN') as hsn_code,
                i.name, i.base_unit, sl.qty, sl.unit, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as tax_amt,
                pt.gstin, i.id
         FROM sale_lines sl
         JOIN sales s ON sl.invoice_no = s.invoice_no
         JOIN items i ON sl.item_id = i.id
         JOIN parties pt ON s.customer_id = pt.id
         WHERE s.date >= ?1 AND s.date <= ?2 AND COALESCE(s.status, 'active') <> 'cancelled'
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
    check_permission_for_command(&app, &conn, "get_hsn_summary_cmd")?;
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
         WHERE s.date >= ?1 AND s.date <= ?2 AND COALESCE(s.status, 'active') <> 'cancelled'
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
    check_permission_for_command(&app, &conn, "get_profit_report_cmd")?;
    get_profit_report_inner(&conn, &from_date, &to_date)
}

// ==========================================
// REPORT 1: Sales & Profit: With GST vs Without GST
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SalesGstModeInvoiceItem {
    pub invoice_no: String,
    pub date: String,
    pub party_name: String,
    pub taxable: i64,      // paise
    pub gst: i64,          // paise
    pub total: i64,        // paise (saved total_amount)
    pub cost: i64,         // paise
    pub profit: i64,       // paise (taxable - bill_discount - cost)
    pub printed_mode: String, // "WITH_GST", "WITHOUT_GST", "NOT_PRINTED"
    pub last_printed_time: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SalesGstModeGroupSummary {
    pub group_key: String, // "WITH_GST", "WITHOUT_GST", "NOT_PRINTED"
    pub group_name: String,
    pub bills_count: i64,
    pub taxable_sales: i64,      // paise
    pub gst_collected: i64,      // paise
    pub bill_total: i64,         // paise
    pub cost: i64,               // paise
    pub profit: i64,             // paise
    pub profit_margin_pct: f64,
    pub diff_vs_printed_total: i64, // paise (saved total - taxable for WITHOUT_GST, 0 otherwise)
    pub invoices: Vec<SalesGstModeInvoiceItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SalesGstModeReport {
    pub groups: Vec<SalesGstModeGroupSummary>,
    pub total_bills_count: i64,
    pub total_taxable_sales: i64,
    pub total_gst_collected: i64,
    pub total_bill_amount: i64,
    pub total_cost: i64,
    pub total_profit: i64,
    pub total_profit_margin_pct: f64,
    pub total_diff_vs_printed_total: i64,
}

pub fn get_sales_gst_mode_profit_report_inner(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
) -> Result<SalesGstModeReport, String> {
    // 1. Fetch sales invoices in range along with their latest printed mode
    let mut stmt = conn.prepare(
        "SELECT s.invoice_no, s.date, s.total_amount, pt.name, pl.bill_mode, pl.printed_at
         FROM sales s
         JOIN parties pt ON s.customer_id = pt.id
         LEFT JOIN (
             SELECT l1.invoice_no, l1.bill_mode, l1.printed_at
             FROM invoice_print_log l1
             JOIN (
                 SELECT invoice_no, MAX(id) as max_id
                 FROM invoice_print_log
                 GROUP BY invoice_no
             ) l2 ON l1.id = l2.max_id
         ) pl ON s.invoice_no = pl.invoice_no
         WHERE s.date >= ?1 AND s.date <= ?2 AND COALESCE(s.status, 'active') <> 'cancelled'
         ORDER BY s.date ASC, s.invoice_no ASC"
    ).map_err(|e| e.to_string())?;

    let inv_rows = stmt.query_map(params![from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut line_stmt = conn.prepare(
        "SELECT sl.item_id, sl.qty, sl.unit, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as line_gst,
                sl.cost_paise
         FROM sale_lines sl
         WHERE sl.invoice_no = ?1"
    ).map_err(|e| e.to_string())?;

    let mut with_gst_invoices: Vec<SalesGstModeInvoiceItem> = Vec::new();
    let mut without_gst_invoices: Vec<SalesGstModeInvoiceItem> = Vec::new();
    let mut not_printed_invoices: Vec<SalesGstModeInvoiceItem> = Vec::new();

    for r in inv_rows {
        let (invoice_no, date, saved_total, party_name, bill_mode_opt, printed_at) = r.map_err(|e| e.to_string())?;

        let lines = line_stmt.query_map(params![&invoice_no], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        }).map_err(|e| e.to_string())?;

        let mut inv_taxable: i64 = 0;
        let mut inv_gst: i64 = 0;
        let mut inv_cost: i64 = 0;

        for line_res in lines {
            let (item_id, qty, unit, taxable, line_gst, cost_paise) = line_res.map_err(|e| e.to_string())?;
            let line_cost = if cost_paise > 0 {
                cost_paise
            } else {
                let base_qty = get_qty_in_base_unit(conn, item_id, qty, &unit).unwrap_or(qty);
                let wac = calculate_weighted_average_cost(conn, item_id).unwrap_or(0);
                (base_qty * wac) / 1000
            };

            inv_taxable += taxable;
            inv_gst += line_gst;
            inv_cost += line_cost;
        }

        // Derived discount rule:
        // let diff = (sum taxable + sum gst) - total_amount (paise)
        // If |diff| < 100 paise: billDiscount = 0, roundOff = -diff
        // Else: billDiscount = diff rounded to nearest rupee (diff rounded), remainder is round-off
        let diff_paise = (inv_taxable + inv_gst) - saved_total;
        let bill_discount = if diff_paise.abs() < 100 {
            0
        } else {
            ((diff_paise as f64 / 100.0).round() as i64) * 100
        };
        let net_taxable = inv_taxable - bill_discount;
        let inv_profit = net_taxable - inv_cost;

        let printed_mode = match bill_mode_opt.as_deref() {
            Some("WITH_GST") => "WITH_GST",
            Some("WITHOUT_GST") => "WITHOUT_GST",
            _ => "NOT_PRINTED",
        };

        let item = SalesGstModeInvoiceItem {
            invoice_no,
            date,
            party_name,
            taxable: inv_taxable,
            gst: inv_gst,
            total: saved_total,
            cost: inv_cost,
            profit: inv_profit,
            printed_mode: printed_mode.to_string(),
            last_printed_time: printed_at,
        };

        match printed_mode {
            "WITH_GST" => with_gst_invoices.push(item),
            "WITHOUT_GST" => without_gst_invoices.push(item),
            _ => not_printed_invoices.push(item),
        }
    }

    fn summarize_group(
        key: &str,
        name: &str,
        invoices: Vec<SalesGstModeInvoiceItem>,
    ) -> SalesGstModeGroupSummary {
        let bills_count = invoices.len() as i64;
        let mut taxable_sales: i64 = 0;
        let mut gst_collected: i64 = 0;
        let mut bill_total: i64 = 0;
        let mut cost: i64 = 0;
        let mut profit: i64 = 0;

        for inv in &invoices {
            taxable_sales += inv.taxable;
            gst_collected += inv.gst;
            bill_total += inv.total;
            cost += inv.cost;
            profit += inv.profit;
        }

        let profit_margin_pct = if taxable_sales > 0 {
            (profit as f64 * 100.0) / taxable_sales as f64
        } else {
            0.0
        };

        let diff_vs_printed_total = if key == "WITHOUT_GST" {
            bill_total - taxable_sales
        } else {
            0
        };

        SalesGstModeGroupSummary {
            group_key: key.to_string(),
            group_name: name.to_string(),
            bills_count,
            taxable_sales,
            gst_collected,
            bill_total,
            cost,
            profit,
            profit_margin_pct,
            diff_vs_printed_total,
            invoices,
        }
    }

    let g_with = summarize_group("WITH_GST", "WITH_GST", with_gst_invoices);
    let g_without = summarize_group("WITHOUT_GST", "WITHOUT_GST", without_gst_invoices);
    let g_not = summarize_group("NOT_PRINTED", "NOT_PRINTED", not_printed_invoices);

    let total_bills_count = g_with.bills_count + g_without.bills_count + g_not.bills_count;
    let total_taxable_sales = g_with.taxable_sales + g_without.taxable_sales + g_not.taxable_sales;
    let total_gst_collected = g_with.gst_collected + g_without.gst_collected + g_not.gst_collected;
    let total_bill_amount = g_with.bill_total + g_without.bill_total + g_not.bill_total;
    let total_cost = g_with.cost + g_without.cost + g_not.cost;
    let total_profit = g_with.profit + g_without.profit + g_not.profit;
    let total_diff_vs_printed_total = g_without.diff_vs_printed_total;
    let total_profit_margin_pct = if total_taxable_sales > 0 {
        (total_profit as f64 * 100.0) / total_taxable_sales as f64
    } else {
        0.0
    };

    Ok(SalesGstModeReport {
        groups: vec![g_with, g_without, g_not],
        total_bills_count,
        total_taxable_sales,
        total_gst_collected,
        total_bill_amount,
        total_cost,
        total_profit,
        total_profit_margin_pct,
        total_diff_vs_printed_total,
    })
}

#[command]
pub fn get_sales_gst_mode_profit_report_cmd(
    app: AppHandle,
    from_date: String,
    to_date: String,
) -> Result<SalesGstModeReport, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_sales_gst_mode_profit_report_cmd")?;
    get_sales_gst_mode_profit_report_inner(&conn, &from_date, &to_date)
}

// ==========================================
// REPORT 2: Item-wise: which parties
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ItemPartyBillDetail {
    pub invoice_no: String,
    pub date: String,
    pub qty: i64,          // milli-units in base unit
    pub unit: String,      // base unit
    pub rate: i64,         // paise per base unit
    pub taxable: i64,      // paise
    pub tax_amount: i64,   // paise
    pub total_amount: i64, // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ItemPartySummary {
    pub party_id: i64,
    pub party_name: String,
    pub bills_count: i64,
    pub total_qty: i64,    // milli-units in base unit
    pub unit: String,      // base unit
    pub total_taxable: i64, // paise
    pub total_amount: i64, // paise (including GST)
    pub min_rate: i64,     // paise per base unit
    pub max_rate: i64,     // paise per base unit
    pub average_rate: i64, // paise per base unit
    pub last_rate: i64,    // paise per base unit
    pub last_date: String,
    pub bills: Vec<ItemPartyBillDetail>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ItemPartiesReport {
    pub item_id: i64,
    pub item_name: String,
    pub base_unit: String,
    pub direction: String, // "purchased_from" | "sold_to"
    pub parties: Vec<ItemPartySummary>,
    pub total_bills_count: i64,
    pub total_qty: i64,
    pub total_taxable: i64,
    pub total_amount: i64,
}

pub fn get_item_parties_report_inner(
    conn: &Connection,
    item_id: i64,
    from_date: &str,
    to_date: &str,
    direction: &str,
) -> Result<ItemPartiesReport, String> {
    use std::collections::{BTreeMap, HashSet};

    let (item_name, base_unit): (String, String) = conn.query_row(
        "SELECT name, base_unit FROM items WHERE id = ?1",
        params![item_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|e| format!("Item not found with id {}: {}", item_id, e))?;

    let is_purchase = direction != "sold_to";

    let sql = if is_purchase {
        "SELECT COALESCE(p.supplier_invoice_no, p.invoice_no) as invoice_no, p.date, pt.id as party_id, pt.name as party_name,
                pl.qty, pl.unit, pl.rate, pl.taxable,
                (COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)) as line_tax
         FROM purchases p
         JOIN parties pt ON p.supplier_id = pt.id
         JOIN purchase_lines pl ON p.invoice_no = pl.invoice_no
         WHERE pl.item_id = ?1 AND p.date >= ?2 AND p.date <= ?3 AND COALESCE(p.status, 'active') <> 'cancelled'
         ORDER BY pt.name ASC, p.date DESC, p.invoice_no DESC"
    } else {
        "SELECT s.invoice_no, s.date, pt.id as party_id, pt.name as party_name,
                sl.qty, sl.unit, sl.rate, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as line_tax
         FROM sales s
         JOIN parties pt ON s.customer_id = pt.id
         JOIN sale_lines sl ON s.invoice_no = sl.invoice_no
         WHERE sl.item_id = ?1 AND s.date >= ?2 AND s.date <= ?3 AND COALESCE(s.status, 'active') <> 'cancelled'
         ORDER BY pt.name ASC, s.date DESC, s.invoice_no DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![item_id, from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    struct PartyAccumulator {
        party_name: String,
        distinct_invoices: HashSet<String>,
        total_qty: i64,
        total_taxable: i64,
        total_amount: i64,
        min_rate: i64,
        max_rate: i64,
        last_rate: i64,
        last_date: String,
        bills: Vec<ItemPartyBillDetail>,
    }

    let mut map: BTreeMap<i64, PartyAccumulator> = BTreeMap::new();

    for r in rows {
        let (inv_no, date, party_id, party_name, qty, unit, rate, taxable, line_tax) = r.map_err(|e| e.to_string())?;

        let base_qty = get_qty_in_base_unit(conn, item_id, qty, &unit).unwrap_or(qty);
        let rate_in_base = if unit.eq_ignore_ascii_case(&base_unit) {
            rate
        } else {
            let factor: Option<i64> = conn.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                params![item_id, unit],
                |r| r.get(0),
            ).optional().unwrap_or(None);
            if let Some(f) = factor {
                if f > 0 { (rate * 1000) / f } else { rate }
            } else {
                rate
            }
        };

        let line_total = taxable + line_tax;

        let entry = map.entry(party_id).or_insert_with(|| PartyAccumulator {
            party_name,
            distinct_invoices: HashSet::new(),
            total_qty: 0,
            total_taxable: 0,
            total_amount: 0,
            min_rate: i64::MAX,
            max_rate: i64::MIN,
            last_rate: rate_in_base,
            last_date: date.clone(),
            bills: Vec::new(),
        });

        entry.distinct_invoices.insert(inv_no.clone());
        entry.total_qty += base_qty;
        entry.total_taxable += taxable;
        entry.total_amount += line_total;
        if rate_in_base < entry.min_rate {
            entry.min_rate = rate_in_base;
        }
        if rate_in_base > entry.max_rate {
            entry.max_rate = rate_in_base;
        }

        entry.bills.push(ItemPartyBillDetail {
            invoice_no: inv_no,
            date,
            qty: base_qty,
            unit: base_unit.clone(),
            rate: rate_in_base,
            taxable,
            tax_amount: line_tax,
            total_amount: line_total,
        });
    }

    let mut parties = Vec::new();
    let mut total_bills_count: i64 = 0;
    let mut total_qty: i64 = 0;
    let mut total_taxable: i64 = 0;
    let mut total_amount: i64 = 0;

    for (party_id, acc) in map {
        let bills_count = acc.distinct_invoices.len() as i64;
        total_bills_count += bills_count;
        total_qty += acc.total_qty;
        total_taxable += acc.total_taxable;
        total_amount += acc.total_amount;

        let average_rate = if acc.total_qty > 0 {
            (acc.total_taxable * 1000) / acc.total_qty
        } else {
            0
        };

        let min_rate = if acc.min_rate == i64::MAX { 0 } else { acc.min_rate };
        let max_rate = if acc.max_rate == i64::MIN { 0 } else { acc.max_rate };

        parties.push(ItemPartySummary {
            party_id,
            party_name: acc.party_name,
            bills_count,
            total_qty: acc.total_qty,
            unit: base_unit.clone(),
            total_taxable: acc.total_taxable,
            total_amount: acc.total_amount,
            min_rate,
            max_rate,
            average_rate,
            last_rate: acc.last_rate,
            last_date: acc.last_date,
            bills: acc.bills,
        });
    }

    // Default sort by party_name ASC
    parties.sort_by(|a, b| a.party_name.to_lowercase().cmp(&b.party_name.to_lowercase()));

    Ok(ItemPartiesReport {
        item_id,
        item_name,
        base_unit,
        direction: if is_purchase { "purchased_from".to_string() } else { "sold_to".to_string() },
        parties,
        total_bills_count,
        total_qty,
        total_taxable,
        total_amount,
    })
}

#[command]
pub fn get_item_parties_report_cmd(
    app: AppHandle,
    item_id: i64,
    from_date: String,
    to_date: String,
    direction: String,
) -> Result<ItemPartiesReport, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_item_parties_report_cmd")?;
    get_item_parties_report_inner(&conn, item_id, &from_date, &to_date, &direction)
}

// ==========================================
// REPORT 3: Party-wise: which items
// ==========================================

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyItemBillDetail {
    pub invoice_no: String,
    pub date: String,
    pub qty: i64,          // milli-units in base unit
    pub unit: String,      // base unit
    pub rate: i64,         // paise per base unit
    pub taxable: i64,      // paise
    pub tax_amount: i64,   // paise
    pub total_amount: i64, // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyItemSummary {
    pub item_id: i64,
    pub item_name: String,
    pub base_unit: String,
    pub bills_count: i64,
    pub total_qty: i64,    // milli-units in base unit
    pub total_taxable: i64, // paise
    pub total_amount: i64, // paise (including GST)
    pub min_rate: i64,     // paise per base unit
    pub max_rate: i64,     // paise per base unit
    pub average_rate: i64, // paise per base unit
    pub last_rate: i64,    // paise per base unit
    pub last_date: String,
    pub bills: Vec<PartyItemBillDetail>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PartyItemsReport {
    pub party_id: i64,
    pub party_name: String,
    pub direction: String, // "purchased_from" | "sold_to"
    pub items: Vec<PartyItemSummary>,
    pub total_bills_count: i64,
    pub total_qty: i64,
    pub total_taxable: i64,
    pub total_amount: i64,
}

pub fn get_party_items_report_inner(
    conn: &Connection,
    party_id: i64,
    from_date: &str,
    to_date: &str,
    direction: &str,
) -> Result<PartyItemsReport, String> {
    use std::collections::{BTreeMap, HashSet};

    let party_name: String = conn.query_row(
        "SELECT name FROM parties WHERE id = ?1",
        params![party_id],
        |r| r.get(0),
    ).map_err(|e| format!("Party not found with id {}: {}", party_id, e))?;

    let is_purchase = direction != "sold_to";

    let sql = if is_purchase {
        "SELECT COALESCE(p.supplier_invoice_no, p.invoice_no) as invoice_no, p.date, i.id as item_id, i.name as item_name, i.base_unit,
                pl.qty, pl.unit, pl.rate, pl.taxable,
                (COALESCE(pl.cgst, 0) + COALESCE(pl.sgst, 0) + COALESCE(pl.igst, 0)) as line_tax
         FROM purchases p
         JOIN purchase_lines pl ON p.invoice_no = pl.invoice_no
         JOIN items i ON pl.item_id = i.id
         WHERE p.supplier_id = ?1 AND p.date >= ?2 AND p.date <= ?3 AND COALESCE(p.status, 'active') <> 'cancelled'
         ORDER BY i.name ASC, p.date DESC, p.invoice_no DESC"
    } else {
        "SELECT s.invoice_no, s.date, i.id as item_id, i.name as item_name, i.base_unit,
                sl.qty, sl.unit, sl.rate, sl.taxable,
                (COALESCE(sl.cgst, 0) + COALESCE(sl.sgst, 0) + COALESCE(sl.igst, 0)) as line_tax
         FROM sales s
         JOIN sale_lines sl ON s.invoice_no = sl.invoice_no
         JOIN items i ON sl.item_id = i.id
         WHERE s.customer_id = ?1 AND s.date >= ?2 AND s.date <= ?3 AND COALESCE(s.status, 'active') <> 'cancelled'
         ORDER BY i.name ASC, s.date DESC, s.invoice_no DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![party_id, from_date, to_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
        ))
    }).map_err(|e| e.to_string())?;

    struct ItemAccumulator {
        item_name: String,
        base_unit: String,
        distinct_invoices: HashSet<String>,
        total_qty: i64,
        total_taxable: i64,
        total_amount: i64,
        min_rate: i64,
        max_rate: i64,
        last_rate: i64,
        last_date: String,
        bills: Vec<PartyItemBillDetail>,
    }

    let mut map: BTreeMap<i64, ItemAccumulator> = BTreeMap::new();

    for r in rows {
        let (inv_no, date, item_id, item_name, base_unit, qty, unit, rate, taxable, line_tax) = r.map_err(|e| e.to_string())?;

        let base_qty = get_qty_in_base_unit(conn, item_id, qty, &unit).unwrap_or(qty);
        let rate_in_base = if unit.eq_ignore_ascii_case(&base_unit) {
            rate
        } else {
            let factor: Option<i64> = conn.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                params![item_id, unit],
                |r| r.get(0),
            ).optional().unwrap_or(None);
            if let Some(f) = factor {
                if f > 0 { (rate * 1000) / f } else { rate }
            } else {
                rate
            }
        };

        let line_total = taxable + line_tax;

        let entry = map.entry(item_id).or_insert_with(|| ItemAccumulator {
            item_name,
            base_unit: base_unit.clone(),
            distinct_invoices: HashSet::new(),
            total_qty: 0,
            total_taxable: 0,
            total_amount: 0,
            min_rate: i64::MAX,
            max_rate: i64::MIN,
            last_rate: rate_in_base,
            last_date: date.clone(),
            bills: Vec::new(),
        });

        entry.distinct_invoices.insert(inv_no.clone());
        entry.total_qty += base_qty;
        entry.total_taxable += taxable;
        entry.total_amount += line_total;
        if rate_in_base < entry.min_rate {
            entry.min_rate = rate_in_base;
        }
        if rate_in_base > entry.max_rate {
            entry.max_rate = rate_in_base;
        }

        entry.bills.push(PartyItemBillDetail {
            invoice_no: inv_no,
            date,
            qty: base_qty,
            unit: base_unit,
            rate: rate_in_base,
            taxable,
            tax_amount: line_tax,
            total_amount: line_total,
        });
    }

    let mut items = Vec::new();
    let mut total_bills_count: i64 = 0;
    let mut total_qty: i64 = 0;
    let mut total_taxable: i64 = 0;
    let mut total_amount: i64 = 0;

    for (item_id, acc) in map {
        let bills_count = acc.distinct_invoices.len() as i64;
        total_bills_count += bills_count;
        total_qty += acc.total_qty;
        total_taxable += acc.total_taxable;
        total_amount += acc.total_amount;

        let average_rate = if acc.total_qty > 0 {
            (acc.total_taxable * 1000) / acc.total_qty
        } else {
            0
        };

        let min_rate = if acc.min_rate == i64::MAX { 0 } else { acc.min_rate };
        let max_rate = if acc.max_rate == i64::MIN { 0 } else { acc.max_rate };

        items.push(PartyItemSummary {
            item_id,
            item_name: acc.item_name,
            base_unit: acc.base_unit,
            bills_count,
            total_qty: acc.total_qty,
            total_taxable: acc.total_taxable,
            total_amount: acc.total_amount,
            min_rate,
            max_rate,
            average_rate,
            last_rate: acc.last_rate,
            last_date: acc.last_date,
            bills: acc.bills,
        });
    }

    // Default sort by item_name ASC
    items.sort_by(|a, b| a.item_name.to_lowercase().cmp(&b.item_name.to_lowercase()));

    Ok(PartyItemsReport {
        party_id,
        party_name,
        direction: if is_purchase { "purchased_from".to_string() } else { "sold_to".to_string() },
        items,
        total_bills_count,
        total_qty,
        total_taxable,
        total_amount,
    })
}

#[command]
pub fn get_party_items_report_cmd(
    app: AppHandle,
    party_id: i64,
    from_date: String,
    to_date: String,
    direction: String,
) -> Result<PartyItemsReport, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_party_items_report_cmd")?;
    get_party_items_report_inner(&conn, party_id, &from_date, &to_date, &direction)
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
    check_permission_for_command(&app, &conn, "cleanup_accounting_parties_cmd")?;
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

    // Check period lock
    crate::audit::check_period_lock(conn, &payload.date)?;

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
        let is_cancelled_sale: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sales WHERE invoice_no = ?1 AND customer_id = ?2 AND status = 'cancelled')",
            rusqlite::params![ref_id, payload.party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_cancelled_sale {
            return Err(format!("Cannot record payment against cancelled invoice '{}' / रद्द किए गए बिल के विरुद्ध भुगतान दर्ज नहीं किया जा सकता", ref_id));
        }

        let is_matched_sale: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sales WHERE invoice_no = ?1 AND customer_id = ?2 AND COALESCE(status, 'active') <> 'cancelled')",
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
        let is_cancelled_purchase: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1 AND supplier_id = ?2 AND status = 'cancelled')",
            rusqlite::params![ref_id, payload.party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_cancelled_purchase {
            return Err(format!("Cannot record payment against cancelled invoice '{}' / रद्द किए गए बिल के विरुद्ध भुगतान दर्ज नहीं किया जा सकता", ref_id));
        }

        let is_matched_purchase: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1 AND supplier_id = ?2 AND COALESCE(status, 'active') <> 'cancelled')",
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
    let user_opt = check_permission_for_command(&app, &conn, "record_payment_cmd")?;
    if let Some(user) = user_opt {
        if !crate::auth::can_role_record_payment(&user.role, &payload.payment_type) {
            return Err("सप्लायर को भुगतान (Payment Out) दर्ज करने की अनुमति केवल व्यवस्थापक को है। / Only Owner can record payments to suppliers.".to_string());
        }
    }
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
         WHERE customer_id = ?1 AND paid_amount < total_amount AND COALESCE(status, 'active') <> 'cancelled'
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
         WHERE supplier_id = ?1 AND paid_amount < total_amount AND COALESCE(status, 'active') <> 'cancelled' 
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
    let user_opt = check_permission_for_command(&app, &conn, "get_pending_bills_cmd")?;
    if let Some(user) = user_opt {
        let party_type: String = conn
            .query_row(
                "SELECT type FROM parties WHERE id = ?1",
                rusqlite::params![party_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !crate::auth::can_role_access_pending_bills(&user.role, &party_type) {
            return Err("सप्लायर के बकाया बिल देखने की अनुमति केवल व्यवस्थापक को है। / Access to supplier pending bills is restricted to Owner.".to_string());
        }
    }
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
    #[serde(default)]
    pub is_cancelled: bool,
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
        "SELECT pl.id, pl.date, pl.type, 
                CASE WHEN pl.type = 'purchase' THEN COALESCE(p.supplier_invoice_no, pl.ref_id) ELSE pl.ref_id END as display_ref_id,
                pl.debit, pl.credit, COALESCE(pl.payment_mode, 'cash'), pl.remark,
                EXISTS(SELECT 1 FROM audit_log al WHERE al.entity_type = 'party_ledger' AND al.entity_id = CAST(pl.id AS TEXT) AND al.action = 'cancel') as is_cancelled
         FROM party_ledger pl 
         LEFT JOIN purchases p ON pl.ref_id = p.invoice_no AND pl.type = 'purchase'
         WHERE pl.party_id = ?1 
         ORDER BY pl.date ASC, pl.id ASC"
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
            row.get::<_, bool>(8)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut total_debit = 0i64;
    let mut total_credit = 0i64;
    let mut running_balance = 0i64;

    for r in rows {
        if let Ok((id, date, entry_type, ref_id, debit, credit, payment_mode, remark, is_cancelled)) = r {
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
                is_cancelled,
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
    let user_opt = check_permission_for_command(&app, &conn, "get_party_statement_cmd")?;
    if let Some(user) = user_opt {
        let party_type: String = conn
            .query_row(
                "SELECT type FROM parties WHERE id = ?1",
                rusqlite::params![party_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !crate::auth::can_role_access_party_statement(&user.role, &party_type) {
            return Err("सप्लायर का खाता विवरण देखने की अनुमति केवल व्यवस्थापक को है। / Access to supplier statement is restricted to Owner.".to_string());
        }
    }
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
            "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE date = ?1 AND COALESCE(status, 'active') <> 'cancelled'",
            rusqlite::params![&date_str],
            |row| row.get(0)
        ).unwrap_or(0);

        let purchases_paise: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE date = ?1 AND COALESCE(status, 'active') <> 'cancelled'",
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

pub fn mask_7_day_trend_for_role(trends: &mut [DailyTrend], role: &str) {
    if role == "staff" {
        for t in trends {
            t.purchases_paise = 0;
        }
    }
}

#[command]
pub fn get_7_day_trend_cmd(app: AppHandle, today_date: Option<String>) -> Result<Vec<DailyTrend>, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_7_day_trend_cmd")?;
    let date_str = today_date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let mut trends = get_7_day_trend_inner(&conn, &date_str)?;
    if let Some(ref u) = user_opt {
        mask_7_day_trend_for_role(&mut trends, &u.role);
    }
    Ok(trends)
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

    let clean_today = today_date.split('T').next().unwrap_or(today_date).trim();
    let base_date = NaiveDate::parse_from_str(clean_today, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    let yesterday = base_date - Duration::days(1);

    let today_str = base_date.format("%Y-%m-%d").to_string();
    let yesterday_str = yesterday.format("%Y-%m-%d").to_string();

    let today_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
        rusqlite::params![&today_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let yesterday_sales: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
        rusqlite::params![&yesterday_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let today_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
        rusqlite::params![&today_str],
        |row| row.get(0)
    ).unwrap_or(0);

    let yesterday_purchases: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_amount), 0) FROM purchases WHERE (date = ?1 OR date LIKE (?1 || '%')) AND COALESCE(status, 'active') <> 'cancelled'",
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

pub fn mask_yesterday_comparison_for_role(comp: &mut YesterdayComparison, role: &str) {
    if role == "staff" {
        comp.today_purchases = 0;
        comp.yesterday_purchases = 0;
        comp.purchases_growth_percent = 0.0;
    }
}

#[command]
pub fn get_yesterday_comparison_cmd(app: AppHandle, today_date: Option<String>) -> Result<YesterdayComparison, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_yesterday_comparison_cmd")?;
    let date_str = today_date.unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());
    let mut comp = get_yesterday_comparison_inner(&conn, &date_str)?;
    if let Some(ref u) = user_opt {
        mask_yesterday_comparison_for_role(&mut comp, &u.role);
    }
    Ok(comp)
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
    check_permission_for_command(&app, &conn, "get_top_receivables_cmd")?;
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

pub fn mask_low_stock_for_role(items: &mut [LowStockItem], role: &str) {
    if role == "staff" {
        for item in items {
            item.last_purchase_rate = 0;
        }
    }
}

#[command]
pub fn get_low_stock_items_cmd(app: AppHandle, threshold_milli: Option<i64>) -> Result<Vec<LowStockItem>, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_low_stock_items_cmd")?;
    let mut low_items = get_low_stock_items_inner(&conn, threshold_milli.unwrap_or(10_000))?;
    if let Some(ref u) = user_opt {
        mask_low_stock_for_role(&mut low_items, &u.role);
    }
    Ok(low_items)
}

#[command]
pub fn list_printers() -> Result<Vec<crate::printer::PrinterInfo>, String> {
    crate::printer::list_printers_impl()
}

#[command]
pub fn get_default_printer() -> Result<Option<String>, String> {
    crate::printer::get_default_printer_impl()
}

#[command]
pub fn print_bill(req: crate::printer::PrintBillRequest) -> Result<crate::printer::PrintBillResponse, String> {
    crate::printer::print_bill_impl(req)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsPayload {
    pub shop_name: String,
    pub gstin: Option<String>,
    pub state_code: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub bank_name: Option<String>,
    pub bank_account_no: Option<String>,
    pub bank_ifsc: Option<String>,
    pub bank_branch: Option<String>,
    pub upi_id: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub signature_text: Option<String>,
    #[serde(alias = "signatureUrl")]
    pub signature_data: Option<String>,
    #[serde(alias = "logoUrl")]
    pub logo_data: Option<String>,
    pub default_bill_format: Option<String>,
    pub bill_language: Option<String>,
    pub visible_columns: Option<serde_json::Value>,
    pub fy_prefix: Option<String>,
    pub low_stock_threshold: Option<i64>,
    pub footer_note: Option<String>,
    pub selected_printer: Option<String>,
    pub printer_paper_size: Option<String>,
    pub print_offset_x_mm: Option<f64>,
    pub print_offset_y_mm: Option<f64>,
    pub print_mode: Option<String>,
    #[serde(default = "default_true")]
    pub is_gst_registered: bool,
    #[serde(default)]
    pub is_composition: bool,
    #[serde(default)]
    pub silent_print_beta: bool,
    #[serde(default)]
    pub backup_folder: Option<String>,
    #[serde(default)]
    pub secondary_backup_folder: Option<String>,
    #[serde(default)]
    pub last_backup_time: Option<String>,
    #[serde(default)]
    pub books_locked_until: Option<String>,
}

fn default_true() -> bool {
    true
}

pub fn get_settings_inner(conn: &Connection) -> Result<AppSettingsPayload, String> {
    let mut stmt = conn.prepare(
        "SELECT shop_name, gstin, state_code, phone, address,
                bank_name, bank_account_no, bank_ifsc, bank_branch, upi_id,
                terms_and_conditions, signature_text, signature_data, logo_data,
                default_bill_format, bill_language, visible_columns, fy_prefix,
                low_stock_threshold, footer_note, selected_printer, printer_paper_size,
                print_offset_x_mm, print_offset_y_mm, print_mode,
                is_gst_registered, is_composition, silent_print_beta,
                backup_folder, secondary_backup_folder, last_backup_time,
                books_locked_until
         FROM settings WHERE id = 1 LIMIT 1"
    ).map_err(|e| e.to_string())?;

    stmt.query_row([], |row| {
        let vis_col_str: String = row.get(16)?;
        let visible_columns: Option<serde_json::Value> = serde_json::from_str(&vis_col_str).ok();

        let is_reg: i64 = row.get(25)?;
        let is_comp: i64 = row.get(26)?;
        let silent_b: i64 = row.get(27)?;

        Ok(AppSettingsPayload {
            shop_name: row.get(0)?,
            gstin: row.get(1)?,
            state_code: row.get(2)?,
            phone: row.get(3)?,
            address: row.get(4)?,
            bank_name: row.get(5)?,
            bank_account_no: row.get(6)?,
            bank_ifsc: row.get(7)?,
            bank_branch: row.get(8)?,
            upi_id: row.get(9)?,
            terms_and_conditions: row.get(10)?,
            signature_text: row.get(11)?,
            signature_data: row.get(12)?,
            logo_data: row.get(13)?,
            default_bill_format: row.get(14)?,
            bill_language: row.get(15)?,
            visible_columns,
            fy_prefix: row.get(17)?,
            low_stock_threshold: row.get(18)?,
            footer_note: row.get(19)?,
            selected_printer: row.get(20)?,
            printer_paper_size: row.get(21)?,
            print_offset_x_mm: row.get(22)?,
            print_offset_y_mm: row.get(23)?,
            print_mode: row.get(24)?,
            is_gst_registered: is_reg != 0,
            is_composition: is_comp != 0,
            silent_print_beta: silent_b != 0,
            backup_folder: row.get(28)?,
            secondary_backup_folder: row.get(29)?,
            last_backup_time: row.get(30)?,
            books_locked_until: row.get(31)?,
        })
    }).map_err(|e| e.to_string())
}

pub fn set_settings_inner(conn: &Connection, s: AppSettingsPayload) -> Result<AppSettingsPayload, String> {
    let vis_col_str = s.visible_columns.as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{\"hsn\":true,\"unit\":true,\"discount\":true,\"gstRate\":true,\"taxable\":true}".to_string());

    conn.execute(
        "INSERT INTO settings (
            id, shop_name, gstin, state_code, phone, address,
            bank_name, bank_account_no, bank_ifsc, bank_branch, upi_id,
            terms_and_conditions, signature_text, signature_data, logo_data,
            default_bill_format, bill_language, visible_columns, fy_prefix,
            low_stock_threshold, footer_note, selected_printer, printer_paper_size,
            print_offset_x_mm, print_offset_y_mm, print_mode,
            is_gst_registered, is_composition, silent_print_beta,
            backup_folder, secondary_backup_folder, last_backup_time,
            books_locked_until, updated_at
        ) VALUES (
            1, ?1, ?2, ?3, ?4, ?5,
            ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14,
            ?15, ?16, ?17, ?18,
            ?19, ?20, ?21, ?22,
            ?23, ?24, ?25,
            ?26, ?27, ?28,
            ?29, ?30, ?31,
            ?32, ?33
        )
        ON CONFLICT(id) DO UPDATE SET
            shop_name = excluded.shop_name,
            gstin = excluded.gstin,
            state_code = excluded.state_code,
            phone = excluded.phone,
            address = excluded.address,
            bank_name = excluded.bank_name,
            bank_account_no = excluded.bank_account_no,
            bank_ifsc = excluded.bank_ifsc,
            bank_branch = excluded.bank_branch,
            upi_id = excluded.upi_id,
            terms_and_conditions = excluded.terms_and_conditions,
            signature_text = excluded.signature_text,
            signature_data = excluded.signature_data,
            logo_data = excluded.logo_data,
            default_bill_format = excluded.default_bill_format,
            bill_language = excluded.bill_language,
            visible_columns = excluded.visible_columns,
            fy_prefix = excluded.fy_prefix,
            low_stock_threshold = excluded.low_stock_threshold,
            footer_note = excluded.footer_note,
            selected_printer = excluded.selected_printer,
            printer_paper_size = excluded.printer_paper_size,
            print_offset_x_mm = excluded.print_offset_x_mm,
            print_offset_y_mm = excluded.print_offset_y_mm,
            print_mode = excluded.print_mode,
            is_gst_registered = excluded.is_gst_registered,
            is_composition = excluded.is_composition,
            silent_print_beta = excluded.silent_print_beta,
            backup_folder = excluded.backup_folder,
            secondary_backup_folder = excluded.secondary_backup_folder,
            last_backup_time = excluded.last_backup_time,
            books_locked_until = excluded.books_locked_until,
            updated_at = excluded.updated_at",
        rusqlite::params![
            s.shop_name,
            s.gstin,
            s.state_code,
            s.phone,
            s.address,
            s.bank_name,
            s.bank_account_no,
            s.bank_ifsc,
            s.bank_branch,
            s.upi_id,
            s.terms_and_conditions,
            s.signature_text,
            s.signature_data.unwrap_or_default(),
            s.logo_data.unwrap_or_default(),
            s.default_bill_format.unwrap_or_else(|| "A4".to_string()),
            s.bill_language.unwrap_or_else(|| "both".to_string()),
            vis_col_str,
            s.fy_prefix.unwrap_or_else(|| "KK".to_string()),
            s.low_stock_threshold.unwrap_or(10),
            s.footer_note,
            s.selected_printer.unwrap_or_default(),
            s.printer_paper_size.unwrap_or_else(|| "A4".to_string()),
            s.print_offset_x_mm.unwrap_or(0.0),
            s.print_offset_y_mm.unwrap_or(0.0),
            s.print_mode.unwrap_or_else(|| "dialog".to_string()),
            if s.is_gst_registered { 1 } else { 0 },
            if s.is_composition { 1 } else { 0 },
            if s.silent_print_beta { 1 } else { 0 },
            s.backup_folder.unwrap_or_default(),
            s.secondary_backup_folder.unwrap_or_default(),
            s.last_backup_time,
            s.books_locked_until,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
        ]
    ).map_err(|e| e.to_string())?;

    get_settings_inner(conn)
}

pub fn mask_settings_for_locked_state(settings: &mut AppSettingsPayload) {
    settings.bank_name = None;
    settings.bank_account_no = None;
    settings.bank_ifsc = None;
    settings.bank_branch = None;
    settings.upi_id = None;
    settings.backup_folder = None;
    settings.secondary_backup_folder = None;
}

#[command]
pub fn get_settings_cmd(app: AppHandle) -> Result<AppSettingsPayload, String> {
    let conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "get_settings_cmd")?;
    let is_locked = if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        *state.is_locked.lock().unwrap()
    } else {
        false
    };
    let mut settings = get_settings_inner(&conn)?;
    if user_opt.is_none() || is_locked {
        mask_settings_for_locked_state(&mut settings);
    }
    Ok(settings)
}

#[command]
pub fn set_settings_cmd(app: AppHandle, settings: AppSettingsPayload) -> Result<AppSettingsPayload, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "set_settings_cmd")?;
    set_settings_inner(&conn, settings)
}

#[command]
pub fn get_audit_logs_cmd(
    app: AppHandle,
    entity_type: Option<String>,
    entity_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<crate::audit::AuditLogEntry>, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_audit_logs_cmd")?;
    crate::audit::get_audit_logs_inner(&conn, entity_type.as_deref(), entity_id.as_deref(), limit)
}

pub fn calculate_financial_year(date_str: &str) -> Result<String, String> {
    let clean = date_str.split('T').next().unwrap_or(date_str).trim();
    let parts: Vec<&str> = clean.split('-').collect();
    if parts.len() < 2 {
        return Err(format!("अमान्य तारीख: {}", date_str));
    }
    let year: i32 = parts[0].trim().parse().map_err(|e| format!("अमान्य वर्ष: {}", e))?;
    let month: u32 = parts[1].trim().parse().map_err(|e| format!("अमान्य माह: {}", e))?;

    let (start_year, end_year) = if month < 4 {
        (year - 1, year)
    } else {
        (year, year + 1)
    };

    let start_yy = (start_year.rem_euclid(100)) as u32;
    let end_yy = (end_year.rem_euclid(100)) as u32;

    Ok(format!("{:02}-{:02}", start_yy, end_yy))
}

pub fn get_next_bill_number_inner(
    conn: &Connection,
    bill_type: &str,
    date_str: &str,
    prefix: Option<&str>,
) -> Result<String, String> {
    let fy = calculate_financial_year(date_str)?;
    let clean_prefix = prefix
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .unwrap_or(if bill_type == "purchase" { "PUR" } else { "KK" });

    let pattern = format!("{}/{}/%", clean_prefix, fy);
    let table = if bill_type == "purchase" { "purchases" } else { "sales" };
    let query = format!("SELECT invoice_no FROM {} WHERE invoice_no LIKE ?1", table);

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([&pattern], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;

    let mut max_seq: i64 = 0;
    for r in rows.flatten() {
        let segs: Vec<&str> = r.split('/').collect();
        if segs.len() >= 3 {
            if let Ok(seq) = segs[segs.len() - 1].parse::<i64>() {
                if seq > max_seq {
                    max_seq = seq;
                }
            }
        }
    }

    let next_seq = max_seq + 1;
    Ok(format!("{}/{}/{:04}", clean_prefix, fy, next_seq))
}

#[command]
pub fn get_next_bill_number_cmd(
    app: AppHandle,
    bill_type: String,
    date: String,
    prefix: Option<String>,
) -> Result<String, String> {
    let conn = get_conn(&app)?;
    get_next_bill_number_inner(&conn, &bill_type, &date, prefix.as_deref())
}
#[command]
pub fn log_invoice_print_cmd(app: AppHandle, invoice_no: String, bill_mode: String) -> Result<(), String> {
    let conn = get_conn(&app)?;
    crate::invoice::log_invoice_print(&conn, &invoice_no, &bill_mode)
}

#[command]
pub fn get_last_invoice_print_mode_cmd(app: AppHandle, invoice_no: String) -> Result<String, String> {
    let conn = get_conn(&app)?;
    crate::invoice::get_last_invoice_print_mode(&conn, &invoice_no)
}

#[command]
pub fn backup_now_cmd(app: AppHandle) -> Result<crate::backup::BackupResult, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "backup_now_cmd")?;
    let primary_dir = crate::backup::get_primary_backup_dir(&conn);
    let secondary_dir = crate::backup::get_secondary_backup_dir(&conn);
    crate::backup::backup_now_inner(&conn, &primary_dir, secondary_dir.as_deref())
}

#[command]
pub fn list_backups_cmd(app: AppHandle) -> Result<Vec<crate::backup::BackupInfo>, String> {
    let conn_res = get_conn(&app);
    if let Ok(ref conn) = conn_res {
        check_permission_for_command(&app, conn, "list_backups_cmd")?;
        crate::backup::list_backups(conn)
    } else {
        check_permission_without_conn(&app, "list_backups_cmd")?;
        let default_dir = crate::backup::get_default_backup_dir();
        crate::backup::list_backups_from_dir(&default_dir)
    }
}

#[command]
pub fn get_backup_status_cmd(app: AppHandle) -> Result<crate::backup::BackupStatusInfo, String> {
    use tauri::Manager;
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_backup_status_cmd")?;
    let last_time: Option<String> = conn
        .query_row("SELECT last_backup_time FROM settings WHERE id = 1", [], |r| r.get(0))
        .unwrap_or(None);

    let (is_recent, is_older_than_3_days) = if let Some(ref t) = last_time {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(t) {
            let now = chrono::Local::now();
            let duration = now.signed_duration_since(parsed.with_timezone(&chrono::Local));
            (duration.num_hours() <= 24, duration.num_hours() > 72)
        } else {
            (false, true)
        }
    } else {
        (false, true)
    };

    let chip_text = if is_recent {
        "सुरक्षित ✓".to_string()
    } else if is_older_than_3_days {
        "3 दिन से पुराना!".to_string()
    } else if last_time.is_some() {
        "बैकअप पुराना!".to_string()
    } else {
        "बैकअप कभी नहीं लिया".to_string()
    };

    let primary_dir = crate::backup::get_primary_backup_dir(&conn);
    let secondary_dir = crate::backup::get_secondary_backup_dir(&conn);

    let primary_free = crate::backup::get_disk_free_space(&primary_dir);
    let secondary_free = secondary_dir.as_ref().and_then(|d| crate::backup::get_disk_free_space(d));

    let db_path = app.path().app_data_dir().unwrap_or_default().join("inventory.db");
    let is_same_drive = {
        let db_str = db_path.to_string_lossy().to_ascii_uppercase();
        let pri_str = primary_dir.to_string_lossy().to_ascii_uppercase();
        if db_str.len() >= 2 && pri_str.len() >= 2 && db_str.chars().nth(1) == Some(':') && pri_str.chars().nth(1) == Some(':') {
            db_str.chars().next() == pri_str.chars().next()
        } else {
            true
        }
    };

    Ok(crate::backup::BackupStatusInfo {
        last_backup_time: last_time,
        is_backup_recent: is_recent,
        is_older_than_3_days,
        formatted_chip_text: chip_text,
        primary_folder: primary_dir.to_string_lossy().to_string(),
        secondary_folder: secondary_dir.map(|p| p.to_string_lossy().to_string()),
        primary_free_space: primary_free,
        secondary_free_space: secondary_free,
        is_same_drive_as_db: is_same_drive,
    })
}

#[command]
pub fn prepare_restore_cmd(app: AppHandle, backup_path: String) -> Result<crate::backup::RestoreResult, String> {
    use tauri::Manager;
    let conn_res = get_conn(&app);
    if let Ok(ref conn) = conn_res {
        check_permission_for_command(&app, conn, "prepare_restore_cmd")?;
    } else {
        check_permission_without_conn(&app, "prepare_restore_cmd")?;
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("inventory.db");
    let selected_backup = std::path::PathBuf::from(backup_path);
    let conn = conn_res.ok();
    let backup_dir = conn.as_ref()
        .map(|c| crate::backup::get_primary_backup_dir(c))
        .unwrap_or_else(|| crate::backup::get_default_backup_dir());

    crate::backup::prepare_restore(conn.as_ref(), &db_path, &selected_backup, &backup_dir)
}

#[command]
pub fn check_db_integrity_cmd(app: AppHandle) -> Result<crate::backup::IntegrityCheckReport, String> {
    use tauri::Manager;
    let conn_res = get_conn(&app);
    if let Ok(ref conn) = conn_res {
        check_permission_for_command(&app, conn, "check_db_integrity_cmd")?;
    } else {
        check_permission_without_conn(&app, "check_db_integrity_cmd")?;
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("inventory.db");
    let primary_dir = if let Ok(ref conn) = conn_res {
        crate::backup::get_primary_backup_dir(conn)
    } else {
        crate::backup::get_default_backup_dir()
    };

    Ok(crate::backup::check_db_integrity(&db_path.to_string_lossy(), &primary_dir))
}

#[command]
pub fn open_backup_folder_cmd(app: AppHandle, folder_type: String) -> Result<(), String> {
    let conn = get_conn(&app)?;
    let target_dir = if folder_type == "secondary" {
        crate::backup::get_secondary_backup_dir(&conn)
            .ok_or_else(|| "Secondary backup folder not set".to_string())?
    } else {
        crate::backup::get_primary_backup_dir(&conn)
    };

    if !target_dir.exists() {
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target_dir.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target_dir;
    }
    Ok(())
}

#[command]
pub fn pick_folder_cmd() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new().pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

#[command]
pub fn test_write_folder_cmd(folder_path: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(folder_path);
    crate::backup::test_folder_writable(&path)
}

#[command]
pub fn copy_backups_cmd(from_folder: String, to_folder: String) -> Result<usize, String> {
    let from_dir = std::path::PathBuf::from(from_folder);
    let to_dir = std::path::PathBuf::from(to_folder);
    crate::backup::copy_backups_with_verification(&from_dir, &to_dir)
}

pub fn change_sales_invoice_no_with_user(
    conn: &mut Connection,
    old_no: &str,
    new_no: &str,
    reason: &str,
    user_name: Option<&str>,
) -> Result<(), String> {
    let clean_old = old_no.trim();
    let clean_new = new_no.trim();
    let clean_reason = reason.trim();

    if clean_reason.is_empty() {
        return Err("Reason is required to change invoice number / बिल नंबर बदलने के लिए कारण आवश्यक है".to_string());
    }

    if clean_new.is_empty() {
        return Err("New invoice number is required / नया बिल नंबर आवश्यक है".to_string());
    }
    if clean_new.len() > 16 {
        return Err("Invoice number cannot exceed 16 characters / बिल नंबर 16 अक्षरों से अधिक नहीं हो सकता".to_string());
    }
    if !clean_new.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-') {
        return Err("Invoice number can only contain letters, numbers, '/' and '-' / बिल नंबर में केवल अक्षर, अंक, '/' और '-' हो सकते हैं".to_string());
    }

    // Check if sale exists and get date
    let sale_date: String = conn.query_row(
        "SELECT date FROM sales WHERE invoice_no = ?1",
        rusqlite::params![clean_old],
        |row| row.get(0)
    ).map_err(|_| format!("Sale invoice '{}' not found / बिक्री बिल नहीं मिला", clean_old))?;

    // Check period lock
    crate::audit::check_period_lock(conn, &sale_date)?;

    // If unchanged, nothing to do
    if clean_old.eq_ignore_ascii_case(clean_new) {
        return Ok(());
    }

    // Case-insensitive uniqueness check across sales
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sales WHERE LOWER(invoice_no) = LOWER(?1)",
        rusqlite::params![clean_new],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    if exists > 0 {
        return Err(format!("Invoice number '{}' already exists / बिल नंबर '{}' पहले से मौजूद है", clean_new, clean_new));
    }

    // Execute rename inside one DB transaction with PRAGMA defer_foreign_keys = ON
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;").map_err(|e| e.to_string())?;

    tx.execute("UPDATE sales SET invoice_no = ?1 WHERE invoice_no = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;
    tx.execute("UPDATE sale_lines SET invoice_no = ?1 WHERE invoice_no = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;
    
    // Temporarily disable stock_ledger update trigger to update ref_id, then restore it
    tx.execute("DROP TRIGGER IF EXISTS prevent_stock_ledger_update", []).map_err(|e| e.to_string())?;
    tx.execute("UPDATE stock_ledger SET ref_id = ?1 WHERE ref_id = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS prevent_stock_ledger_update
         BEFORE UPDATE ON stock_ledger
         BEGIN
             SELECT RAISE(ABORT, 'stock_ledger is append-only. Updates are not allowed.');
         END",
        [],
    ).map_err(|e| e.to_string())?;

    tx.execute("UPDATE party_ledger SET ref_id = ?1 WHERE ref_id = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;
    
    let has_payments: i64 = tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'payments'",
        [],
        |row| row.get(0)
    ).unwrap_or(0);
    if has_payments > 0 {
        tx.execute("UPDATE payments SET invoice_no = ?1 WHERE invoice_no = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;
    }

    tx.execute("UPDATE invoice_print_log SET invoice_no = ?1 WHERE invoice_no = ?2", rusqlite::params![clean_new, clean_old]).map_err(|e| e.to_string())?;

    let before_json = serde_json::json!({ "invoice_no": clean_old }).to_string();
    let after_json = serde_json::json!({ "invoice_no": clean_new }).to_string();

    crate::audit::write_audit(
        &tx,
        "sale",
        clean_new,
        "rename_invoice",
        Some(&before_json),
        Some(&after_json),
        Some(clean_reason),
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn change_sales_invoice_no_inner(
    conn: &mut Connection,
    old_no: &str,
    new_no: &str,
    reason: &str,
) -> Result<(), String> {
    change_sales_invoice_no_with_user(conn, old_no, new_no, reason, None)
}

#[command]
pub fn change_sales_invoice_no_cmd(
    app: AppHandle,
    old_no: String,
    new_no: String,
    reason: String,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "change_sales_invoice_no_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    change_sales_invoice_no_with_user(&mut conn, &old_no, &new_no, &reason, user_name)
}

pub fn update_purchase_supplier_invoice_with_user(
    conn: &mut Connection,
    internal_invoice_no: &str,
    supplier_invoice_no: &str,
    supplier_invoice_date: Option<&str>,
    reason: Option<&str>,
    user_name: Option<&str>,
) -> Result<(), String> {
    let clean_internal = internal_invoice_no.trim();
    let clean_supp_no = supplier_invoice_no.trim();

    if clean_supp_no.is_empty() {
        return Err("Supplier invoice number is required / सप्लायर का बिल नंबर आवश्यक है".to_string());
    }
    if clean_supp_no.len() > 30 {
        return Err("Supplier invoice number cannot exceed 30 characters / सप्लायर बिल नंबर 30 अक्षरों से अधिक नहीं हो सकता".to_string());
    }

    let (supplier_id, purchase_date, old_supp_no, old_supp_date): (i64, String, Option<String>, Option<String>) = conn.query_row(
        "SELECT supplier_id, date, supplier_invoice_no, supplier_invoice_date FROM purchases WHERE invoice_no = ?1",
        rusqlite::params![clean_internal],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    ).map_err(|_| format!("Purchase invoice '{}' not found / खरीद बिल नहीं मिला", clean_internal))?;

    // Period lock check
    crate::audit::check_period_lock(conn, &purchase_date)?;

    // Check duplicate supplier_invoice_no for same supplier
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1 AND LOWER(supplier_invoice_no) = LOWER(?2) AND invoice_no <> ?3",
        rusqlite::params![supplier_id, clean_supp_no, clean_internal],
        |row| row.get(0)
    ).map_err(|e| e.to_string())?;

    if exists > 0 {
        return Err("This supplier already has this invoice number / इस सप्लायर का यह बिल नंबर पहले से मौजूद है".to_string());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE purchases SET supplier_invoice_no = ?1, supplier_invoice_date = ?2 WHERE invoice_no = ?3",
        rusqlite::params![clean_supp_no, supplier_invoice_date, clean_internal],
    ).map_err(|e| e.to_string())?;

    let before_json = serde_json::json!({
        "supplier_invoice_no": old_supp_no,
        "supplier_invoice_date": old_supp_date
    }).to_string();
    let after_json = serde_json::json!({
        "supplier_invoice_no": clean_supp_no,
        "supplier_invoice_date": supplier_invoice_date
    }).to_string();

    crate::audit::write_audit(
        &tx,
        "purchase",
        clean_internal,
        "update_supplier_invoice",
        Some(&before_json),
        Some(&after_json),
        reason,
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_purchase_supplier_invoice_inner(
    conn: &mut Connection,
    internal_invoice_no: &str,
    supplier_invoice_no: &str,
    supplier_invoice_date: Option<&str>,
    reason: Option<&str>,
) -> Result<(), String> {
    update_purchase_supplier_invoice_with_user(conn, internal_invoice_no, supplier_invoice_no, supplier_invoice_date, reason, None)
}

#[command]
pub fn update_purchase_supplier_invoice_cmd(
    app: AppHandle,
    internal_invoice_no: String,
    supplier_invoice_no: String,
    supplier_invoice_date: Option<String>,
    reason: Option<String>,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "update_purchase_supplier_invoice_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    update_purchase_supplier_invoice_with_user(&mut conn, &internal_invoice_no, &supplier_invoice_no, supplier_invoice_date.as_deref(), reason.as_deref(), user_name)
}

// ==========================================
// STAGE 4: INVOICE CANCELLATION & ALTERATION
// ==========================================

pub fn cancel_invoice_with_user(conn: &mut Connection, invoice_no: &str, reason: Option<&str>, user_name: Option<&str>) -> Result<(), String> {
    let clean_inv = invoice_no.trim();
    if clean_inv.is_empty() {
        return Err("Invoice number is required / बिल नंबर आवश्यक है".to_string());
    }

    let sale_opt: Option<(String, String, i64, i64, i64, String)> = conn.query_row(
        "SELECT invoice_no, date, customer_id, paid_amount, total_amount, COALESCE(status, 'active')
         FROM sales
         WHERE TRIM(invoice_no) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')
         ORDER BY (TRIM(invoice_no) = ?1 COLLATE NOCASE) DESC
         LIMIT 1",
        rusqlite::params![clean_inv],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
    ).optional().map_err(|e| e.to_string())?;

    let is_sale;
    let inv_date: String;
    let party_id: i64;
    let paid_amount: i64;
    let total_amount: i64;
    let status: String;
    let resolved_inv_no: String;

    if let Some((inv, d, cid, pa, ta, st)) = sale_opt {
        resolved_inv_no = inv;
        is_sale = true;
        inv_date = d;
        party_id = cid;
        paid_amount = pa;
        total_amount = ta;
        status = st;
    } else {
        let pur_opt: Option<(String, String, i64, i64, i64, String)> = conn.query_row(
            "SELECT invoice_no, date, supplier_id, paid_amount, total_amount, COALESCE(status, 'active')
             FROM purchases
             WHERE TRIM(invoice_no) = ?1 COLLATE NOCASE
                OR REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')
                OR TRIM(COALESCE(supplier_invoice_no, '')) = ?1 COLLATE NOCASE
                OR REPLACE(TRIM(COALESCE(supplier_invoice_no, '')), '/', '-') = REPLACE(?1, '/', '-')
             ORDER BY (TRIM(invoice_no) = ?1 COLLATE NOCASE) DESC,
                      (REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')) DESC
             LIMIT 1",
            rusqlite::params![clean_inv],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        ).optional().map_err(|e| e.to_string())?;

        if let Some((inv, d, sid, pa, ta, st)) = pur_opt {
            resolved_inv_no = inv;
            is_sale = false;
            inv_date = d;
            party_id = sid;
            paid_amount = pa;
            total_amount = ta;
            status = st;
        } else {
            return Err(format!("Invoice '{}' not found / बिल नहीं मिला", clean_inv));
        }
    }
    let clean_inv = &resolved_inv_no;

    if status == "cancelled" {
        return Err(format!("Invoice '{}' is already cancelled / बिल पहले से रद्द है", clean_inv));
    }

    // Period lock check
    crate::audit::check_period_lock(conn, &inv_date)?;

    // For purchases: cancelling removes stock. Ensure stock won't drop below zero!
    if !is_sale {
        let mut check_stmt = conn.prepare(
            "SELECT item_id, godown_id, SUM(qty_base)
             FROM stock_ledger
             WHERE ref_id = ?1 AND (type = 'purchase' OR type = 'purchase_alteration')
               AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')
             GROUP BY item_id, godown_id"
        ).map_err(|e| e.to_string())?;

        let pur_stocks = check_stmt.query_map(rusqlite::params![clean_inv], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        }).map_err(|e| e.to_string())?;

        for item_res in pur_stocks {
            let (item_id, godown_id, qty_to_remove) = item_res.map_err(|e| e.to_string())?;
            if qty_to_remove > 0 {
                let current_stock: i64 = conn.query_row(
                    "SELECT COALESCE(SUM(qty_base), 0) FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2",
                    rusqlite::params![item_id, godown_id],
                    |r| r.get(0)
                ).unwrap_or(0);

                if current_stock < qty_to_remove {
                    let item_name: String = conn.query_row(
                        "SELECT name FROM items WHERE id = ?1",
                        rusqlite::params![item_id],
                        |r| r.get(0)
                    ).unwrap_or_else(|_| format!("Item #{}", item_id));

                    let conflicting_sale: Option<String> = conn.query_row(
                        "SELECT sl.ref_id FROM stock_ledger sl WHERE sl.item_id = ?1 AND sl.type = 'sale' ORDER BY sl.id DESC LIMIT 1",
                        rusqlite::params![item_id],
                        |r| r.get(0)
                    ).ok();
                    let sale_info = if let Some(ref s) = conflicting_sale {
                        format!(" due to later sale '{}'", s)
                    } else {
                        String::new()
                    };

                    return Err(format!(
                        "Cannot cancel purchase: item '{}' in godown #{} would have negative stock (Current: {}, Required to cancel: {}){}. Stock is already sold / पर्याप्त स्टॉक नहीं है",
                        item_name, godown_id, current_stock, qty_to_remove, sale_info
                    ));
                }
            }
        }
    }

    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Reverse unreversed stock entries
    let entry_type = if is_sale { "sale" } else { "purchase" };
    let alt_type = format!("{}_alteration", entry_type);
    let mut stock_stmt = tx.prepare(
        "SELECT id FROM stock_ledger 
         WHERE ref_id = ?1 AND (type = ?2 OR type = ?3)
           AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')"
    ).map_err(|e| e.to_string())?;

    let stock_ids: Vec<i64> = stock_stmt.query_map(
        rusqlite::params![clean_inv, entry_type, alt_type],
        |r| r.get(0)
    ).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    drop(stock_stmt);

    for sid in stock_ids {
        crate::inventory::reverse_stock_ledger_entry(&tx, sid, &today_str, clean_inv)
            .map_err(|e| e.to_string())?;
    }

    let reason_note = reason.unwrap_or("Cancelled").trim();
    if is_sale {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, 0, ?4, 'cancel', ?5)",
            rusqlite::params![today_str, party_id, clean_inv, total_amount, format!("Sale cancel: {}", reason_note)],
        ).map_err(|e| e.to_string())?;

        if paid_amount > 0 {
            tx.execute(
                "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
                 VALUES (?1, ?2, 'reversal', ?3, ?4, 0, 'cancel', ?5)",
                rusqlite::params![today_str, party_id, clean_inv, paid_amount, format!("Sale payment refund: {}", reason_note)],
            ).map_err(|e| e.to_string())?;
        }

        tx.execute(
            "UPDATE sales SET status = 'cancelled' WHERE invoice_no = ?1",
            rusqlite::params![clean_inv],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, ?4, 0, 'cancel', ?5)",
            rusqlite::params![today_str, party_id, clean_inv, total_amount, format!("Purchase cancel: {}", reason_note)],
        ).map_err(|e| e.to_string())?;

        if paid_amount > 0 {
            tx.execute(
                "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
                 VALUES (?1, ?2, 'reversal', ?3, 0, ?4, 'cancel', ?5)",
                rusqlite::params![today_str, party_id, clean_inv, paid_amount, format!("Purchase payment refund: {}", reason_note)],
            ).map_err(|e| e.to_string())?;
        }

        tx.execute(
            "UPDATE purchases SET status = 'cancelled' WHERE invoice_no = ?1",
            rusqlite::params![clean_inv],
        ).map_err(|e| e.to_string())?;
    }

    let before_json = serde_json::json!({
        "status": "active",
        "total_amount": total_amount,
        "paid_amount": paid_amount,
        "party_id": party_id,
        "date": inv_date
    }).to_string();

    let after_json = serde_json::json!({
        "status": "cancelled",
        "cancel_date": today_str
    }).to_string();

    crate::audit::write_audit(
        &tx,
        if is_sale { "sale" } else { "purchase" },
        clean_inv,
        "cancel",
        Some(&before_json),
        Some(&after_json),
        reason,
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_invoice_inner(conn: &mut Connection, invoice_no: &str, reason: Option<&str>) -> Result<(), String> {
    cancel_invoice_with_user(conn, invoice_no, reason, None)
}

#[command]
pub fn cancel_invoice_cmd(
    app: AppHandle,
    invoice_no: String,
    reason: Option<String>,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "cancel_invoice_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    cancel_invoice_with_user(&mut conn, &invoice_no, reason.as_deref(), user_name)
}

pub fn alter_sale_with_user(
    conn: &mut Connection,
    current_invoice_no: &str,
    payload: crate::invoice::InvoicePayload,
    reason: Option<&str>,
    user_name: Option<&str>,
) -> Result<String, String> {
    let clean_current = current_invoice_no.trim();
    if clean_current.is_empty() {
        return Err("Current invoice number is required".to_string());
    }

    let (real_inv_no, old_date, old_customer_id, old_payment_mode, old_paid_amount, old_total_amount, old_status): (String, String, i64, String, i64, i64, String) = conn.query_row(
        "SELECT invoice_no, date, customer_id, payment_mode, paid_amount, total_amount, COALESCE(status, 'active')
         FROM sales
         WHERE TRIM(invoice_no) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')
         ORDER BY (TRIM(invoice_no) = ?1 COLLATE NOCASE) DESC
         LIMIT 1",
        rusqlite::params![clean_current],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
    ).map_err(|_| format!("Sale invoice '{}' not found / बिक्री बिल नहीं मिला", clean_current))?;
    let clean_current = &real_inv_no;

    if old_status == "cancelled" {
        return Err("Cannot alter a cancelled invoice / रद्द किए गए बिल में बदलाव नहीं किया जा सकता".to_string());
    }

    // Period lock check
    crate::audit::check_period_lock(conn, &old_date)?;
    crate::audit::check_period_lock(conn, &payload.date)?;

    // FY boundary check
    let old_fy = calculate_financial_year(&old_date)?;
    let new_fy = calculate_financial_year(&payload.date)?;
    if old_fy != new_fy {
        return Err(format!("Cannot change invoice date across financial years ({} -> {}) / वित्तीय वर्ष बदलकर बिल की तारीख नहीं बदली जा सकती", old_fy, new_fy));
    }

    // Check if renaming invoice number as part of alteration
    let mut target_inv_no = clean_current.to_string();
    let requested_no = payload.invoice_no.trim();
    if !requested_no.is_empty() && requested_no != clean_current {
        let rename_reason = reason.unwrap_or("Sale alteration invoice rename");
        change_sales_invoice_no_with_user(conn, clean_current, requested_no, rename_reason, user_name)?;
        target_inv_no = requested_no.to_string();
    }

    // Calculate new lines and tax
    let (_party_category, party_gstin): (String, Option<String>) = conn.query_row(
        "SELECT category, gstin FROM parties WHERE id = ?1",
        rusqlite::params![payload.party_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_else(|_| ("unregistered".to_string(), None));

    let is_interstate = if let Some(ref shop_st) = payload.shop_state {
        let clean_shop = shop_st.trim();
        if let Some(ref gstin) = party_gstin {
            let clean_gst = gstin.trim();
            if clean_gst.len() >= 2 {
                &clean_gst[0..2] != clean_shop
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    let mut grand_total_paise = 0i64;
    let mut processed_lines = Vec::new();

    for mut line in payload.lines {
        if payload.shop_state.is_some() {
            let total_tax = line.cgst + line.sgst + line.igst;
            if total_tax > 0 {
                if is_interstate {
                    line.cgst = 0;
                    line.sgst = 0;
                    line.igst = total_tax;
                } else {
                    let half = total_tax / 2;
                    line.cgst = half;
                    line.sgst = total_tax - half;
                    line.igst = 0;
                }
            }
        }
        let line_total = line.taxable + line.cgst + line.sgst + line.igst;
        grand_total_paise += line_total;
        processed_lines.push(line);
    }

    // Lower bound check: bill total cannot be less than payments already allocated
    if grand_total_paise < old_paid_amount {
        return Err(format!(
            "New bill total (₹{:.2}) cannot be less than already recorded payment (₹{:.2}) / कुल राशि पहले से प्राप्त भुगतान से कम नहीं हो सकती",
            grand_total_paise as f64 / 100.0,
            old_paid_amount as f64 / 100.0
        ));
    }

    // Check stock sufficiency:
    // Available = current_stock + previously_consumed_by_this_sale
    use std::collections::HashMap;
    let mut new_needed: HashMap<(i64, i64), i64> = HashMap::new();
    for line in &processed_lines {
        let mut factor = 1000i64;
        let base_unit: String = conn.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![line.item_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !base_unit.eq_ignore_ascii_case(&line.unit) {
            let f: Option<i64> = conn.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                rusqlite::params![line.item_id, line.unit],
                |row| row.get(0)
            ).ok();
            if let Some(f_val) = f {
                factor = f_val;
            }
        }
        let qty_base = (line.qty * factor) / 1000;
        *new_needed.entry((line.item_id, payload.godown_id)).or_insert(0) += qty_base;
    }

    for (&(item_id, godown_id), &needed_qty) in &new_needed {
        let old_consumed: i64 = conn.query_row(
            "SELECT COALESCE(SUM(-qty_base), 0) FROM stock_ledger 
             WHERE ref_id = ?1 AND item_id = ?2 AND godown_id = ?3 AND (type = 'sale' OR type = 'sale_alteration')
               AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')",
            rusqlite::params![&target_inv_no, item_id, godown_id],
            |r| r.get(0)
        ).unwrap_or(0);

        let current_stock: i64 = conn.query_row(
            "SELECT COALESCE(SUM(qty_base), 0) FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2",
            rusqlite::params![item_id, godown_id],
            |r| r.get(0)
        ).unwrap_or(0);

        let available = current_stock + old_consumed;
        if available < needed_qty {
            let item_name: String = conn.query_row("SELECT name FROM items WHERE id = ?1", rusqlite::params![item_id], |r| r.get(0))
                .unwrap_or_else(|_| format!("Item #{}", item_id));
            return Err(format!(
                "Stock kam hai! Item '{}' in godown #{} needs {}, but only {} available after reverting original bill / पर्याप्त स्टॉक नहीं है",
                item_name, godown_id, needed_qty, available
            ));
        }
    }

    let actual_paid = match payload.payment_mode.as_str() {
        "cash" | "upi_bank" => grand_total_paise,
        _ => old_paid_amount.max(payload.paid_amount).min(grand_total_paise),
    };

    let before_json = serde_json::json!({
        "invoice_no": clean_current,
        "date": old_date,
        "customer_id": old_customer_id,
        "payment_mode": old_payment_mode,
        "paid_amount": old_paid_amount,
        "total_amount": old_total_amount
    }).to_string();

    let after_json = serde_json::json!({
        "invoice_no": target_inv_no,
        "date": payload.date,
        "customer_id": payload.party_id,
        "payment_mode": payload.payment_mode,
        "paid_amount": actual_paid,
        "total_amount": grand_total_paise
    }).to_string();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Reverse old stock ledger entries
    let mut stock_stmt = tx.prepare(
        "SELECT id FROM stock_ledger 
         WHERE ref_id = ?1 AND (type = 'sale' OR type = 'sale_alteration')
           AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')"
    ).map_err(|e| e.to_string())?;

    let stock_ids: Vec<i64> = stock_stmt.query_map(rusqlite::params![&target_inv_no], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stock_stmt);

    for sid in stock_ids {
        crate::inventory::reverse_stock_ledger_entry(&tx, sid, &payload.date, &target_inv_no)
            .map_err(|e| e.to_string())?;
    }

    // 2. Reverse old party ledger entries
    tx.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
         VALUES (?1, ?2, 'reversal', ?3, 0, ?4, 'alter', 'Reversal for sale alteration')",
        rusqlite::params![payload.date, old_customer_id, &target_inv_no, old_total_amount],
    ).map_err(|e| e.to_string())?;

    if old_paid_amount > 0 {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, ?4, 0, 'alter', 'Reversal of paid amount for sale alteration')",
            rusqlite::params![payload.date, old_customer_id, &target_inv_no, old_paid_amount],
        ).map_err(|e| e.to_string())?;
    }

    // 3. Delete old sale lines
    tx.execute("DELETE FROM sale_lines WHERE invoice_no = ?1", rusqlite::params![&target_inv_no])
        .map_err(|e| e.to_string())?;

    // 4. Insert new lines & stock entries
    for line in processed_lines {
        let mut factor = 1000i64;
        let base_unit: String = tx.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![line.item_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !base_unit.eq_ignore_ascii_case(&line.unit) {
            let f: Option<i64> = tx.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                rusqlite::params![line.item_id, line.unit],
                |row| row.get(0)
            ).ok();
            if let Some(f_val) = f {
                factor = f_val;
            }
        }
        let qty_base = (line.qty * factor) / 1000;

        let (item_hsn, item_gst_rate): (Option<String>, Option<i64>) = tx.query_row(
            "SELECT hsn, gst_rate FROM items WHERE id = ?1",
            rusqlite::params![line.item_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap_or((None, None));

        let wac = crate::inventory::calculate_weighted_average_cost(&tx, line.item_id).unwrap_or(0);
        let cost_paise = (qty_base * wac) / 1000;

        tx.execute(
            "INSERT INTO sale_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst, cost_paise, hsn, gst_rate) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![&target_inv_no, line.item_id, line.qty, line.unit, line.rate, line.taxable, line.cgst, line.sgst, line.igst, cost_paise, item_hsn, item_gst_rate]
        ).map_err(|e| e.to_string())?;

        crate::inventory::add_stock_ledger_entry(
            &tx,
            &payload.date,
            line.item_id,
            payload.godown_id,
            -qty_base,
            "sale",
            Some(&target_inv_no),
            None,
            Some(payload.party_id),
            None
        ).map_err(|e| e.to_string())?;
    }

    // 5. Update sales header
    tx.execute(
        "UPDATE sales SET date = ?1, customer_id = ?2, payment_mode = ?3, paid_amount = ?4, total_amount = ?5 WHERE invoice_no = ?6",
        rusqlite::params![payload.date, payload.party_id, payload.payment_mode, actual_paid, grand_total_paise, &target_inv_no],
    ).map_err(|e| e.to_string())?;

    // 6. Insert new party ledger entries
    tx.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES (?1, ?2, 'sale', ?3, ?4, 0, ?5, 'Altered sale invoice')",
        rusqlite::params![payload.date, payload.party_id, &target_inv_no, grand_total_paise, payload.payment_mode],
    ).map_err(|e| e.to_string())?;

    if actual_paid > 0 {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
             VALUES (?1, ?2, 'payment', ?3, 0, ?4, ?5, 'Altered invoice payment')",
            rusqlite::params![payload.date, payload.party_id, &target_inv_no, actual_paid, payload.payment_mode],
        ).map_err(|e| e.to_string())?;
    }

    // 7. Write audit log
    crate::audit::write_audit(
        &tx,
        "sale",
        &target_inv_no,
        "alter",
        Some(&before_json),
        Some(&after_json),
        reason,
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(target_inv_no)
}

pub fn alter_sale_inner(
    conn: &mut Connection,
    current_invoice_no: &str,
    payload: crate::invoice::InvoicePayload,
    reason: Option<&str>,
) -> Result<String, String> {
    alter_sale_with_user(conn, current_invoice_no, payload, reason, None)
}

#[command]
pub fn alter_sale_cmd(
    app: AppHandle,
    invoice_no: String,
    payload: crate::invoice::InvoicePayload,
    reason: Option<String>,
) -> Result<String, String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "alter_sale_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    alter_sale_with_user(&mut conn, &invoice_no, payload, reason.as_deref(), user_name)
}

pub fn alter_purchase_with_user(
    conn: &mut Connection,
    current_invoice_no: &str,
    payload: crate::invoice::InvoicePayload,
    reason: Option<&str>,
    user_name: Option<&str>,
) -> Result<String, String> {
    let clean_current = current_invoice_no.trim();
    if clean_current.is_empty() {
        return Err("Current invoice number is required".to_string());
    }

    let (real_inv_no, old_date, old_supplier_id, old_payment_mode, old_paid_amount, old_total_amount, old_supp_no, old_supp_date, old_status): (String, String, i64, String, i64, i64, Option<String>, Option<String>, String) = conn.query_row(
        "SELECT invoice_no, date, supplier_id, payment_mode, paid_amount, total_amount, supplier_invoice_no, supplier_invoice_date, COALESCE(status, 'active')
         FROM purchases
         WHERE TRIM(invoice_no) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')
            OR TRIM(COALESCE(supplier_invoice_no, '')) = ?1 COLLATE NOCASE
            OR REPLACE(TRIM(COALESCE(supplier_invoice_no, '')), '/', '-') = REPLACE(?1, '/', '-')
         ORDER BY (TRIM(invoice_no) = ?1 COLLATE NOCASE) DESC,
                  (REPLACE(TRIM(invoice_no), '/', '-') = REPLACE(?1, '/', '-')) DESC
         LIMIT 1",
        rusqlite::params![clean_current],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?))
    ).map_err(|_| format!("Purchase invoice '{}' not found / खरीद बिल नहीं मिला", clean_current))?;
    let clean_current = &real_inv_no;

    if old_status == "cancelled" {
        return Err("Cannot alter a cancelled invoice / रद्द किए गए बिल में बदलाव नहीं किया जा सकता".to_string());
    }

    // Period lock check
    crate::audit::check_period_lock(conn, &old_date)?;
    crate::audit::check_period_lock(conn, &payload.date)?;

    // FY boundary check
    let old_fy = calculate_financial_year(&old_date)?;
    let new_fy = calculate_financial_year(&payload.date)?;
    if old_fy != new_fy {
        return Err(format!("Cannot change invoice date across financial years ({} -> {}) / वित्तीय वर्ष बदलकर बिल की तारीख नहीं बदली जा सकती", old_fy, new_fy));
    }

    // Check duplicate supplier_invoice_no if supplied
    if let Some(ref supp_no) = payload.supplier_invoice_no {
        let clean_supp = supp_no.trim();
        if !clean_supp.is_empty() {
            if clean_supp.len() > 30 {
                return Err("Supplier invoice number cannot exceed 30 characters / सप्लायर बिल नंबर 30 अक्षरों से अधिक नहीं हो सकता".to_string());
            }
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1 AND LOWER(supplier_invoice_no) = LOWER(?2) AND invoice_no <> ?3",
                rusqlite::params![payload.party_id, clean_supp, clean_current],
                |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if exists > 0 {
                return Err("This supplier already has this invoice number / इस सप्लायर का यह बिल नंबर पहले से मौजूद है".to_string());
            }
        }
    }

    let (party_category, party_gstin): (String, Option<String>) = conn.query_row(
        "SELECT category, gstin FROM parties WHERE id = ?1",
        rusqlite::params![payload.party_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_else(|_| ("unregistered".to_string(), None));

    let is_composition_supplier = party_category == "composition";
    let is_interstate = if let Some(ref shop_st) = payload.shop_state {
        let clean_shop = shop_st.trim();
        if let Some(ref gstin) = party_gstin {
            let clean_gst = gstin.trim();
            if clean_gst.len() >= 2 {
                &clean_gst[0..2] != clean_shop
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    let mut grand_total_paise = 0i64;
    let mut processed_lines = Vec::new();

    for mut line in payload.lines {
        if is_composition_supplier {
            line.cgst = 0;
            line.sgst = 0;
            line.igst = 0;
        } else if payload.shop_state.is_some() {
            let total_tax = line.cgst + line.sgst + line.igst;
            if total_tax > 0 {
                if is_interstate {
                    line.cgst = 0;
                    line.sgst = 0;
                    line.igst = total_tax;
                } else {
                    let half = total_tax / 2;
                    line.cgst = half;
                    line.sgst = total_tax - half;
                    line.igst = 0;
                }
            }
        }
        let line_total = line.taxable + line.cgst + line.sgst + line.igst;
        grand_total_paise += line_total;
        processed_lines.push(line);
    }

    if grand_total_paise < old_paid_amount {
        return Err(format!(
            "New bill total (₹{:.2}) cannot be less than already recorded payment (₹{:.2}) / कुल राशि पहले से किए गए भुगतान से कम नहीं हो सकती",
            grand_total_paise as f64 / 100.0,
            old_paid_amount as f64 / 100.0
        ));
    }

    // Check stock reduction:
    // If new purchase qty < old purchase qty, ensure current stock doesn't drop below zero
    use std::collections::HashMap;
    let mut new_added: HashMap<(i64, i64), i64> = HashMap::new();
    for line in &processed_lines {
        let mut factor = 1000i64;
        let base_unit: String = conn.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![line.item_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !base_unit.eq_ignore_ascii_case(&line.unit) {
            let f: Option<i64> = conn.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                rusqlite::params![line.item_id, line.unit],
                |row| row.get(0)
            ).ok();
            if let Some(f_val) = f {
                factor = f_val;
            }
        }
        let qty_base = (line.qty * factor) / 1000;
        *new_added.entry((line.item_id, payload.godown_id)).or_insert(0) += qty_base;
    }

    // Check all items previously added by this purchase
    let old_items: Vec<(i64, i64, i64)> = {
        let mut old_stmt = conn.prepare(
            "SELECT item_id, godown_id, SUM(qty_base) FROM stock_ledger 
             WHERE ref_id = ?1 AND (type = 'purchase' OR type = 'purchase_alteration')
               AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')
             GROUP BY item_id, godown_id"
        ).map_err(|e| e.to_string())?;

        let rows = old_stmt.query_map(rusqlite::params![clean_current], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        rows
    };

    for (item_id, godown_id, old_qty) in old_items {
        let new_qty = new_added.get(&(item_id, godown_id)).copied().unwrap_or(0);
        if new_qty < old_qty {
            let reduction = old_qty - new_qty;
            let current_stock: i64 = conn.query_row(
                "SELECT COALESCE(SUM(qty_base), 0) FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2",
                rusqlite::params![item_id, godown_id],
                |r| r.get(0)
            ).unwrap_or(0);

            if current_stock < reduction {
                let item_name: String = conn.query_row("SELECT name FROM items WHERE id = ?1", rusqlite::params![item_id], |r| r.get(0))
                    .unwrap_or_else(|_| format!("Item #{}", item_id));
                let conflicting_sale: Option<String> = conn.query_row(
                    "SELECT sl.ref_id FROM stock_ledger sl WHERE sl.item_id = ?1 AND sl.type = 'sale' ORDER BY sl.id DESC LIMIT 1",
                    rusqlite::params![item_id],
                    |r| r.get(0)
                ).ok();
                let sale_info = if let Some(ref s) = conflicting_sale {
                    format!(" due to later sale '{}'", s)
                } else {
                    String::new()
                };
                return Err(format!(
                    "Cannot reduce purchase qty for item '{}': current stock ({}) is less than reduction ({}){}. Stock is already sold / पर्याप्त स्टॉक नहीं है",
                    item_name, current_stock, reduction, sale_info
                ));
            }
        }
    }

    let actual_paid = match payload.payment_mode.as_str() {
        "cash" | "upi_bank" => grand_total_paise,
        _ => old_paid_amount.max(payload.paid_amount).min(grand_total_paise),
    };

    let before_json = serde_json::json!({
        "invoice_no": clean_current,
        "date": old_date,
        "supplier_id": old_supplier_id,
        "payment_mode": old_payment_mode,
        "paid_amount": old_paid_amount,
        "total_amount": old_total_amount,
        "supplier_invoice_no": old_supp_no,
        "supplier_invoice_date": old_supp_date
    }).to_string();

    let after_json = serde_json::json!({
        "invoice_no": clean_current,
        "date": payload.date,
        "supplier_id": payload.party_id,
        "payment_mode": payload.payment_mode,
        "paid_amount": actual_paid,
        "total_amount": grand_total_paise,
        "supplier_invoice_no": payload.supplier_invoice_no,
        "supplier_invoice_date": payload.supplier_invoice_date
    }).to_string();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Reverse old stock ledger entries
    let mut stock_stmt = tx.prepare(
        "SELECT id FROM stock_ledger 
         WHERE ref_id = ?1 AND (type = 'purchase' OR type = 'purchase_alteration')
           AND id NOT IN (SELECT linked_id FROM stock_ledger WHERE linked_id IS NOT NULL AND type = 'reversal')"
    ).map_err(|e| e.to_string())?;

    let stock_ids: Vec<i64> = stock_stmt.query_map(rusqlite::params![clean_current], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stock_stmt);

    for sid in stock_ids {
        crate::inventory::reverse_stock_ledger_entry(&tx, sid, &payload.date, clean_current)
            .map_err(|e| e.to_string())?;
    }

    // 2. Reverse old party ledger entries
    tx.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
         VALUES (?1, ?2, 'reversal', ?3, ?4, 0, 'alter', 'Reversal for purchase alteration')",
        rusqlite::params![payload.date, old_supplier_id, clean_current, old_total_amount],
    ).map_err(|e| e.to_string())?;

    if old_paid_amount > 0 {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, 0, ?4, 'alter', 'Reversal of paid amount for purchase alteration')",
            rusqlite::params![payload.date, old_supplier_id, clean_current, old_paid_amount],
        ).map_err(|e| e.to_string())?;
    }

    // 3. Delete old purchase lines
    tx.execute("DELETE FROM purchase_lines WHERE invoice_no = ?1", rusqlite::params![clean_current])
        .map_err(|e| e.to_string())?;

    // 4. Insert new lines & stock entries
    for line in processed_lines {
        let mut factor = 1000i64;
        let base_unit: String = tx.query_row("SELECT base_unit FROM items WHERE id = ?1", rusqlite::params![line.item_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !base_unit.eq_ignore_ascii_case(&line.unit) {
            let f: Option<i64> = tx.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                rusqlite::params![line.item_id, line.unit],
                |row| row.get(0)
            ).ok();
            if let Some(f_val) = f {
                factor = f_val;
            }
        }
        let qty_base = (line.qty * factor) / 1000;

        let (item_hsn, item_gst_rate): (Option<String>, Option<i64>) = tx.query_row(
            "SELECT hsn, gst_rate FROM items WHERE id = ?1",
            rusqlite::params![line.item_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap_or((None, None));

        tx.execute(
            "INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst, hsn, gst_rate) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![clean_current, line.item_id, line.qty, line.unit, line.rate, line.taxable, line.cgst, line.sgst, line.igst, item_hsn, item_gst_rate]
        ).map_err(|e| e.to_string())?;

        crate::inventory::add_stock_ledger_entry(
            &tx,
            &payload.date,
            line.item_id,
            payload.godown_id,
            qty_base,
            "purchase",
            Some(clean_current),
            None,
            Some(payload.party_id),
            None
        ).map_err(|e| e.to_string())?;
    }

    // 5. Update purchases header
    let supp_no = payload.supplier_invoice_no.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let supp_date = payload.supplier_invoice_date.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    tx.execute(
        "UPDATE purchases SET date = ?1, supplier_id = ?2, payment_mode = ?3, paid_amount = ?4, total_amount = ?5, supplier_invoice_no = ?6, supplier_invoice_date = ?7 WHERE invoice_no = ?8",
        rusqlite::params![payload.date, payload.party_id, payload.payment_mode, actual_paid, grand_total_paise, supp_no, supp_date, clean_current],
    ).map_err(|e| e.to_string())?;

    // 6. Insert new party ledger entries
    tx.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES (?1, ?2, 'purchase', ?3, 0, ?4, ?5, 'Altered purchase invoice')",
        rusqlite::params![payload.date, payload.party_id, clean_current, grand_total_paise, payload.payment_mode],
    ).map_err(|e| e.to_string())?;

    if actual_paid > 0 {
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
             VALUES (?1, ?2, 'payment', ?3, ?4, 0, ?5, 'Altered invoice payment')",
            rusqlite::params![payload.date, payload.party_id, clean_current, actual_paid, payload.payment_mode],
        ).map_err(|e| e.to_string())?;
    }

    // 7. Write audit log
    crate::audit::write_audit(
        &tx,
        "purchase",
        clean_current,
        "alter",
        Some(&before_json),
        Some(&after_json),
        reason,
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(clean_current.to_string())
}

pub fn alter_purchase_inner(
    conn: &mut Connection,
    current_invoice_no: &str,
    payload: crate::invoice::InvoicePayload,
    reason: Option<&str>,
) -> Result<String, String> {
    alter_purchase_with_user(conn, current_invoice_no, payload, reason, None)
}

#[command]
pub fn alter_purchase_cmd(
    app: AppHandle,
    invoice_no: String,
    payload: crate::invoice::InvoicePayload,
    reason: Option<String>,
) -> Result<String, String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "alter_purchase_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    alter_purchase_with_user(&mut conn, &invoice_no, payload, reason.as_deref(), user_name)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AlterPaymentPayload {
    pub ledger_id: i64,
    pub date: String,
    pub amount_paise: i64,
    pub payment_mode: String,
    pub remark: Option<String>,
    pub ref_id: Option<String>,
    pub reason: Option<String>,
}

pub fn alter_payment_with_user(conn: &mut Connection, payload: AlterPaymentPayload, user_name: Option<&str>) -> Result<(), String> {
    if payload.amount_paise <= 0 {
        return Err("Payment amount must be greater than zero".to_string());
    }

    let (party_id, old_date, old_debit, old_credit, old_ref_id, old_mode, old_remark): (i64, String, i64, i64, String, String, Option<String>) = conn.query_row(
        "SELECT party_id, date, debit, credit, ref_id, payment_mode, remark FROM party_ledger WHERE id = ?1 AND type = 'payment'",
        rusqlite::params![payload.ledger_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
    ).map_err(|_| format!("Payment ledger entry #{} not found / भुगतान प्रविष्टि नहीं मिली", payload.ledger_id))?;

    let is_cancelled: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM audit_log WHERE entity_type = 'party_ledger' AND entity_id = ?1 AND action = 'cancel')",
        rusqlite::params![payload.ledger_id.to_string()],
        |r| r.get(0)
    ).unwrap_or(false);

    if is_cancelled {
        return Err(format!("Payment #{} is cancelled and cannot be altered / रद्द किया गया भुगतान संशोधित नहीं किया जा सकता", payload.ledger_id));
    }

    // Period lock check
    crate::audit::check_period_lock(conn, &old_date)?;
    crate::audit::check_period_lock(conn, &payload.date)?;

    let is_receipt = old_credit > 0;
    let old_amount = if is_receipt { old_credit } else { old_debit };

    let before_json = serde_json::json!({
        "id": payload.ledger_id,
        "party_id": party_id,
        "date": old_date,
        "amount_paise": old_amount,
        "payment_mode": old_mode,
        "ref_id": old_ref_id,
        "remark": old_remark
    }).to_string();

    let new_mode = if payload.payment_mode.trim().is_empty() { "cash" } else { payload.payment_mode.trim() };
    let new_ref = payload.ref_id.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or(&old_ref_id);

    // If new_ref is a cancelled invoice, reject alteration
    let is_cancelled_sale: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sales WHERE invoice_no = ?1 AND customer_id = ?2 AND status = 'cancelled')",
        rusqlite::params![new_ref, party_id],
        |row| row.get(0)
    ).unwrap_or(false);

    if is_cancelled_sale {
        return Err(format!("Cannot match payment to cancelled invoice '{}' / रद्द किए गए बिल से भुगतान लिंक नहीं किया जा सकता", new_ref));
    }

    let is_cancelled_purchase: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1 AND supplier_id = ?2 AND status = 'cancelled')",
        rusqlite::params![new_ref, party_id],
        |row| row.get(0)
    ).unwrap_or(false);

    if is_cancelled_purchase {
        return Err(format!("Cannot match payment to cancelled invoice '{}' / रद्द किए गए बिल से भुगतान लिंक नहीं किया जा सकता", new_ref));
    }

    let after_json = serde_json::json!({
        "id": payload.ledger_id,
        "party_id": party_id,
        "date": payload.date,
        "amount_paise": payload.amount_paise,
        "payment_mode": new_mode,
        "ref_id": new_ref,
        "remark": payload.remark
    }).to_string();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Undo old payment amount on matched invoice
    if is_receipt {
        tx.execute(
            "UPDATE sales SET paid_amount = MAX(0, paid_amount - ?1) WHERE invoice_no = ?2 AND customer_id = ?3",
            rusqlite::params![old_amount, &old_ref_id, party_id],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "UPDATE purchases SET paid_amount = MAX(0, paid_amount - ?1) WHERE invoice_no = ?2 AND supplier_id = ?3",
            rusqlite::params![old_amount, &old_ref_id, party_id],
        ).map_err(|e| e.to_string())?;
    }

    // Update party_ledger row
    let (new_debit, new_credit) = if is_receipt { (0, payload.amount_paise) } else { (payload.amount_paise, 0) };
    let final_remark = payload.remark.as_deref().or(old_remark.as_deref()).unwrap_or("");

    tx.execute(
        "UPDATE party_ledger SET date = ?1, debit = ?2, credit = ?3, payment_mode = ?4, ref_id = ?5, remark = ?6 WHERE id = ?7",
        rusqlite::params![payload.date, new_debit, new_credit, new_mode, new_ref, final_remark, payload.ledger_id],
    ).map_err(|e| e.to_string())?;

    // Apply new payment amount on matched invoice if exists
    if is_receipt {
        let is_matched: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sales WHERE invoice_no = ?1 AND customer_id = ?2)",
            rusqlite::params![new_ref, party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_matched {
            tx.execute(
                "UPDATE sales SET paid_amount = MIN(total_amount, paid_amount + ?1) WHERE invoice_no = ?2 AND customer_id = ?3",
                rusqlite::params![payload.amount_paise, new_ref, party_id],
            ).map_err(|e| e.to_string())?;
        }
    } else {
        let is_matched: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM purchases WHERE invoice_no = ?1 AND supplier_id = ?2)",
            rusqlite::params![new_ref, party_id],
            |row| row.get(0)
        ).unwrap_or(false);

        if is_matched {
            tx.execute(
                "UPDATE purchases SET paid_amount = MIN(total_amount, paid_amount + ?1) WHERE invoice_no = ?2 AND supplier_id = ?3",
                rusqlite::params![payload.amount_paise, new_ref, party_id],
            ).map_err(|e| e.to_string())?;
        }
    }

    crate::audit::write_audit(
        &tx,
        "party_ledger",
        &payload.ledger_id.to_string(),
        "alter",
        Some(&before_json),
        Some(&after_json),
        payload.reason.as_deref(),
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn alter_payment_inner(conn: &mut Connection, payload: AlterPaymentPayload) -> Result<(), String> {
    alter_payment_with_user(conn, payload, None)
}

#[command]
pub fn alter_payment_cmd(
    app: AppHandle,
    payload: AlterPaymentPayload,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "alter_payment_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    alter_payment_with_user(&mut conn, payload, user_name)
}

pub fn cancel_payment_with_user(conn: &mut Connection, ledger_id: i64, reason: Option<&str>, user_name: Option<&str>) -> Result<(), String> {
    let (party_id, old_date, old_debit, old_credit, old_ref_id, old_mode, old_remark): (i64, String, i64, i64, String, String, Option<String>) = conn.query_row(
        "SELECT party_id, date, debit, credit, ref_id, payment_mode, remark FROM party_ledger WHERE id = ?1 AND type = 'payment'",
        rusqlite::params![ledger_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
    ).map_err(|_| format!("Payment ledger entry #{} not found / भुगतान प्रविष्टि नहीं मिली", ledger_id))?;

    let is_cancelled: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM audit_log WHERE entity_type = 'party_ledger' AND entity_id = ?1 AND action = 'cancel')",
        rusqlite::params![ledger_id.to_string()],
        |r| r.get(0)
    ).unwrap_or(false);

    if is_cancelled {
        return Err(format!("Payment #{} is already cancelled / यह भुगतान पहले से रद्द है", ledger_id));
    }

    crate::audit::check_period_lock(conn, &old_date)?;

    let is_receipt = old_credit > 0;
    let old_amount = if is_receipt { old_credit } else { old_debit };

    let before_json = serde_json::json!({
        "id": ledger_id,
        "party_id": party_id,
        "date": old_date,
        "amount_paise": old_amount,
        "payment_mode": old_mode,
        "ref_id": old_ref_id,
        "remark": old_remark
    }).to_string();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Undo old payment amount on matched invoice
    if is_receipt {
        tx.execute(
            "UPDATE sales SET paid_amount = MAX(0, paid_amount - ?1) WHERE invoice_no = ?2 AND customer_id = ?3",
            rusqlite::params![old_amount, &old_ref_id, party_id],
        ).map_err(|e| e.to_string())?;
    } else {
        tx.execute(
            "UPDATE purchases SET paid_amount = MAX(0, paid_amount - ?1) WHERE invoice_no = ?2 AND supplier_id = ?3",
            rusqlite::params![old_amount, &old_ref_id, party_id],
        ).map_err(|e| e.to_string())?;
    }

    // Insert reversal into party_ledger
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let reason_str = reason.unwrap_or("Payment cancelled").trim();
    if is_receipt {
        // Receipt reversal: debit party
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, ?4, 0, 'cancel', ?5)",
            rusqlite::params![today_str, party_id, old_ref_id, old_amount, format!("Cancel payment: {}", reason_str)],
        ).map_err(|e| e.to_string())?;
    } else {
        // Payment made reversal: credit party
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark)
             VALUES (?1, ?2, 'reversal', ?3, 0, ?4, 'cancel', ?5)",
            rusqlite::params![today_str, party_id, old_ref_id, old_amount, format!("Cancel payment: {}", reason_str)],
        ).map_err(|e| e.to_string())?;
    }

    crate::audit::write_audit(
        &tx,
        "party_ledger",
        &ledger_id.to_string(),
        "cancel",
        Some(&before_json),
        None,
        reason,
        user_name,
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_payment_inner(conn: &mut Connection, ledger_id: i64, reason: Option<&str>) -> Result<(), String> {
    cancel_payment_with_user(conn, ledger_id, reason, None)
}

#[command]
pub fn cancel_payment_cmd(
    app: AppHandle,
    ledger_id: i64,
    reason: Option<String>,
) -> Result<(), String> {
    let mut conn = get_conn(&app)?;
    let user_opt = check_permission_for_command(&app, &conn, "cancel_payment_cmd")?;
    let user_name = user_opt.as_ref().map(|u| u.name.as_str());
    cancel_payment_with_user(&mut conn, ledger_id, reason.as_deref(), user_name)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbSafetyInfo {
    pub db_path: String,
    pub journal_mode: String,
    pub synchronous: String,
    pub foreign_keys: bool,
    pub busy_timeout: i64,
    pub is_synced_folder: bool,
    pub is_removable: bool,
    pub sync_warning: Option<String>,
}

#[cfg(windows)]
fn check_is_removable_drive(path_str: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    extern "system" {
        fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
    }
    if path_str.len() >= 2 && path_str.chars().nth(1) == Some(':') {
        let root = format!("{}\\", &path_str[0..2]);
        let wide: Vec<u16> = OsStr::new(&root).encode_wide().chain(Some(0)).collect();
        unsafe {
            let dt = GetDriveTypeW(wide.as_ptr());
            // DRIVE_REMOVABLE = 2, DRIVE_REMOTE = 4
            dt == 2 || dt == 4
        }
    } else {
        false
    }
}

#[cfg(not(windows))]
fn check_is_removable_drive(_path_str: &str) -> bool {
    false
}

fn path_has_cloud_keywords(path_str: &str) -> bool {
    let lower = path_str.to_lowercase();
    let cloud_sync_keywords = [
        "onedrive",
        "dropbox",
        "google drive",
        "googledrive",
        "icloud",
        "nextcloud",
        "box sync",
        "\\box\\",
        "/box/",
    ];
    cloud_sync_keywords.iter().any(|k| lower.contains(k))
}

pub fn get_db_safety_info_inner(
    conn: &Connection,
    db_path_str: &str,
    primary_backup_str: Option<&str>,
) -> Result<DbSafetyInfo, String> {
    let j_mode: String = conn.query_row("PRAGMA journal_mode;", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let sync_mode: String = conn.query_row("PRAGMA synchronous;", [], |r| {
        let val: i64 = r.get(0)?;
        let name = match val {
            0 => "OFF",
            1 => "NORMAL",
            2 => "FULL",
            3 => "EXTRA",
            _ => "UNKNOWN",
        };
        Ok(name.to_string())
    }).map_err(|e| e.to_string())?;

    let fk_val: i64 = conn.query_row("PRAGMA foreign_keys;", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let foreign_keys = fk_val == 1;

    let busy_timeout: i64 = conn.query_row("PRAGMA busy_timeout;", [], |r| r.get(0))
        .unwrap_or(0);

    let is_db_synced = path_has_cloud_keywords(db_path_str);
    let is_bak_synced = primary_backup_str.map(path_has_cloud_keywords).unwrap_or(false);
    let is_synced_folder = is_db_synced || is_bak_synced;

    let is_db_removable = check_is_removable_drive(db_path_str);
    let is_bak_removable = primary_backup_str.map(check_is_removable_drive).unwrap_or(false);
    let is_removable = is_db_removable || is_bak_removable;

    let sync_warning = if is_synced_folder {
        Some("डेटाबेस या बैकअप फ़ोल्डर क्लाउड-सिंक (OneDrive/Dropbox/Drive) फ़ोल्डर में स्थित है। इससे फ़ाइल लॉकिंग व डेटा करप्शन का जोखिम रहता है। / Database or backup folder is inside a cloud-synced folder, risking SQLite file locking and corruption.".to_string())
    } else if is_removable {
        Some("डेटाबेस या प्राथमिक बैकअप पेनड्राइव या रिमूवेबल ड्राइव पर स्थित है। ड्राइव अचानक निकलने पर डेटा हानि का जोखिम रहता है। / Database or primary backup is on a removable drive, which risks corruption if disconnected.".to_string())
    } else {
        None
    };

    Ok(DbSafetyInfo {
        db_path: db_path_str.to_string(),
        journal_mode: j_mode,
        synchronous: sync_mode,
        foreign_keys,
        busy_timeout,
        is_synced_folder,
        is_removable,
        sync_warning,
    })
}

#[command]
pub fn get_db_safety_info_cmd(app: AppHandle) -> Result<DbSafetyInfo, String> {
    let conn = get_conn(&app)?;
    let path = get_db_path(&app)?;
    let primary_dir = crate::backup::get_primary_backup_dir(&conn);
    get_db_safety_info_inner(&conn, &path.to_string_lossy(), Some(&primary_dir.to_string_lossy()))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StartupHealthInfo {
    pub healthy: bool,
    pub corruption_detected: bool,
}

#[command]
pub fn get_startup_health_cmd(app: AppHandle) -> Result<StartupHealthInfo, String> {
    let corruption_detected = if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        state.startup_corruption_detected.load(std::sync::atomic::Ordering::SeqCst)
    } else {
        crate::auth::is_startup_corruption_detected()
    };

    Ok(StartupHealthInfo {
        healthy: !corruption_detected,
        corruption_detected,
    })
}

pub fn run_wal_checkpoint_truncate(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn.prepare("PRAGMA wal_checkpoint(TRUNCATE);").map_err(|e| e.to_string())?;
    let res: Result<(i64, i64, i64), _> = stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)));
    match res {
        Ok((busy, log_frames, checkpointed_frames)) => {
            Ok(format!("Checkpoint TRUNCATE complete (busy={}, log={}, checkpointed={})", busy, log_frames, checkpointed_frames))
        }
        Err(e) => Err(format!("wal_checkpoint failed: {}", e)),
    }
}

pub static EXIT_REQUEST_ACKNOWLEDGED: AtomicBool = AtomicBool::new(false);

#[command]
pub fn acknowledge_exit_request_cmd() -> Result<(), String> {
    EXIT_REQUEST_ACKNOWLEDGED.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn safe_exit_fallback_helper(
    conn: Option<&Connection>,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    eprintln!("[Krishi Kendra] Executing safe-exit fallback helper...");

    // 1. Flush WAL to main database file with TRUNCATE
    if let Some(c) = conn {
        if let Err(e) = run_wal_checkpoint_truncate(c) {
            eprintln!("[Krishi Kendra] Fallback WAL checkpoint warning: {}", e);
        }
    }

    // 2. Try verified exit backup with 5-second hard limit (never blocks exit)
    if let Some(a) = app {
        let _ = crate::backup::auto_backup_with_timeout(
            a,
            "safe exit fallback",
            std::time::Duration::from_secs(5),
        );
        a.exit(0);
    }

    Ok(())
}

#[command]
pub fn safe_exit_app_cmd(app: AppHandle) -> Result<(), String> {
    eprintln!("[Krishi Kendra] Initiating safe exit...");

    // 1. Flush WAL to main database file
    if let Ok(conn) = get_conn(&app) {
        if let Err(e) = run_wal_checkpoint_truncate(&conn) {
            eprintln!("[Krishi Kendra] WAL checkpoint on exit warning: {}", e);
        }
    }

    // 2. Trigger auto backup with 5-second hard limit (never blocks exit)
    let _ = crate::backup::auto_backup_with_timeout(&app, "safe exit", std::time::Duration::from_secs(5));

    // 3. Exit process cleanly
    app.exit(0);
    Ok(())
}

#[command]
#[allow(dead_code)]
pub fn graceful_exit_cmd(app: AppHandle) -> Result<(), String> {
    safe_exit_app_cmd(app)
}

// ==================== AUTH & SECURITY COMMANDS ====================

#[allow(dead_code)]
pub fn get_app_session_user(app: &AppHandle) -> Option<crate::auth::SessionUser> {
    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        state.current_user.lock().unwrap().clone()
    } else {
        None
    }
}

pub fn check_permission_for_command(
    app: &AppHandle,
    conn: &Connection,
    command_name: &str,
) -> Result<Option<crate::auth::SessionUser>, String> {
    let security_enabled: bool = conn
        .query_row(
            "SELECT COALESCE(security_enabled, 0) FROM settings WHERE id = 1",
            [],
            |r| {
                let s: i64 = r.get(0)?;
                Ok(s != 0)
            },
        )
        .unwrap_or(false);

    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        let session_opt = state.current_user.lock().unwrap().clone();
        let is_locked = *state.is_locked.lock().unwrap();
        let corruption_detected = state.startup_corruption_detected.load(std::sync::atomic::Ordering::SeqCst);
        let res = crate::auth::check_command_permission_ext(
            security_enabled,
            session_opt.as_ref(),
            is_locked,
            command_name,
            corruption_detected,
        )?;
        Ok(res)
    } else {
        let corruption_detected = crate::auth::is_startup_corruption_detected();
        let res = crate::auth::check_command_permission_ext(
            security_enabled,
            None,
            false,
            command_name,
            corruption_detected,
        )?;
        Ok(res)
    }
}

pub fn check_permission_without_conn(
    app: &AppHandle,
    command_name: &str,
) -> Result<Option<crate::auth::SessionUser>, String> {
    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        let session_opt = state.current_user.lock().unwrap().clone();
        let is_locked = *state.is_locked.lock().unwrap();
        let corruption_detected = state.startup_corruption_detected.load(std::sync::atomic::Ordering::SeqCst);
        crate::auth::check_command_permission_ext(
            true,
            session_opt.as_ref(),
            is_locked,
            command_name,
            corruption_detected,
        )
    } else {
        let corruption_detected = crate::auth::is_startup_corruption_detected();
        crate::auth::check_command_permission_ext(
            true,
            None,
            false,
            command_name,
            corruption_detected,
        )
    }
}

#[command]
pub fn get_security_status_cmd(app: AppHandle) -> Result<crate::auth::SecurityStatus, String> {
    let conn = get_conn(&app)?;
    let auth_state = app.try_state::<crate::auth::AuthState>();
    crate::auth::get_security_status_inner(&conn, auth_state.as_deref())
}

pub fn create_owner_initial_inner(
    conn: &mut Connection,
    name: &str,
    password: &str,
) -> Result<(crate::auth::UserInfo, String), String> {
    let user_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    if user_count > 0 {
        return Err("व्यवस्थापक खाता पहले से मौजूद है। / Owner account already exists.".to_string());
    }

    let recovery_key = crate::auth::generate_recovery_key();
    let recovery_key_hash = crate::auth::hash_password(&recovery_key)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let owner = crate::auth::create_user_inner(&tx, name, "owner", password)?;

    tx.execute(
        "UPDATE settings SET security_enabled = 1, recovery_key_hash = ?1, recovery_failed_attempts = 0, recovery_locked_until = NULL WHERE id = 1",
        rusqlite::params![recovery_key_hash],
    )
    .map_err(|e| e.to_string())?;

    crate::auth::log_login_event(&tx, &owner.name, "login")?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok((owner, recovery_key))
}

pub fn skip_security_setup_inner(conn: &Connection) -> Result<(), String> {
    let (user_count, security_enabled): (i64, i64) = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM users), COALESCE(security_enabled, 0) FROM settings WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0));
    if user_count > 0 || security_enabled != 0 {
        return Err("सुरक्षा पहले से सक्रिय है या यूज़र मौजूद हैं। / Security is already enabled or users exist.".to_string());
    }

    conn.execute("UPDATE settings SET security_enabled = 0 WHERE id = 1", [])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub fn create_owner_initial_cmd(
    app: AppHandle,
    name: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let mut conn = get_conn(&app)?;
    let (owner, recovery_key) = create_owner_initial_inner(&mut conn, &name, &password)?;

    let session_user = crate::auth::SessionUser {
        id: owner.id,
        name: owner.name.clone(),
        role: "owner".to_string(),
    };

    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        *state.current_user.lock().unwrap() = Some(session_user);
        *state.is_locked.lock().unwrap() = false;
    }

    Ok(serde_json::json!({
        "user": owner,
        "recovery_key": recovery_key
    }))
}

#[command]
pub fn skip_security_setup_cmd(app: AppHandle) -> Result<(), String> {
    let conn = get_conn(&app)?;
    skip_security_setup_inner(&conn)?;

    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        *state.current_user.lock().unwrap() = Some(crate::auth::SessionUser {
            id: 0,
            name: "व्यवस्थापक (Owner)".to_string(),
            role: "owner".to_string(),
        });
        *state.is_locked.lock().unwrap() = false;
    }

    Ok(())
}

#[command]
pub fn login_cmd(app: AppHandle, name: String, password: String) -> Result<crate::auth::UserInfo, String> {
    let conn = get_conn(&app)?;
    let session = crate::auth::verify_and_login_user(&conn, &name, &password)?;

    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        *state.current_user.lock().unwrap() = Some(session.clone());
        *state.is_locked.lock().unwrap() = false;
    }

    let user_info = conn.query_row(
        "SELECT id, name, role, is_active, failed_attempts, locked_until, created_at FROM users WHERE id = ?1",
        rusqlite::params![session.id],
        |r| {
            let active_int: i64 = r.get(3)?;
            Ok(crate::auth::UserInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                is_active: active_int != 0,
                failed_attempts: r.get(4)?,
                locked_until: r.get(5)?,
                created_at: r.get(6)?,
            })
        }
    ).map_err(|e| e.to_string())?;

    Ok(user_info)
}

#[command]
pub fn logout_cmd(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        let prev_user = state.current_user.lock().unwrap().take();
        *state.is_locked.lock().unwrap() = false;
        if let Some(u) = prev_user {
            if let Ok(conn) = get_conn(&app) {
                let _ = crate::auth::log_login_event(&conn, &u.name, "logout");
            }
        }
    }
    Ok(())
}

#[command]
pub fn lock_session_cmd(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        let current_user = state.current_user.lock().unwrap().clone();
        if let Some(u) = current_user {
            *state.is_locked.lock().unwrap() = true;
            if let Ok(conn) = get_conn(&app) {
                let _ = crate::auth::log_login_event(&conn, &u.name, "lock");
            }
            Ok(())
        } else {
            Err("कोई सक्रिय सत्र नहीं है / No active session".to_string())
        }
    } else {
        Ok(())
    }
}

#[command]
pub fn unlock_session_cmd(app: AppHandle, password: String) -> Result<crate::auth::UserInfo, String> {
    let conn = get_conn(&app)?;
    let locked_user = if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        state.current_user.lock().unwrap().clone()
    } else {
        None
    };

    let user = match locked_user {
        Some(u) => u,
        None => return Err("कोई सक्रिय सत्र नहीं है / No active session".to_string()),
    };

    let session = crate::auth::verify_and_login_user(&conn, &user.name, &password)?;

    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        *state.current_user.lock().unwrap() = Some(session.clone());
        *state.is_locked.lock().unwrap() = false;
    }
    let _ = crate::auth::log_login_event(&conn, &user.name, "unlock");

    let user_info = conn.query_row(
        "SELECT id, name, role, is_active, failed_attempts, locked_until, created_at FROM users WHERE id = ?1",
        rusqlite::params![session.id],
        |r| {
            let active_int: i64 = r.get(3)?;
            Ok(crate::auth::UserInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                is_active: active_int != 0,
                failed_attempts: r.get(4)?,
                locked_until: r.get(5)?,
                created_at: r.get(6)?,
            })
        }
    ).map_err(|e| e.to_string())?;

    Ok(user_info)
}

#[command]
pub fn get_current_user_cmd(app: AppHandle) -> Result<Option<crate::auth::SessionUser>, String> {
    if let Some(state) = app.try_state::<crate::auth::AuthState>() {
        let user = state.current_user.lock().unwrap().clone();
        Ok(user)
    } else {
        Ok(Some(crate::auth::SessionUser {
            id: 0,
            name: "व्यवस्थापक (Owner)".to_string(),
            role: "owner".to_string(),
        }))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryResetResult {
    pub new_recovery_key: String,
    pub owner_name: String,
}

#[command]
pub fn reset_owner_with_recovery_key_cmd(
    app: AppHandle,
    recovery_key: String,
    new_password: String,
) -> Result<RecoveryResetResult, String> {
    let mut conn = get_conn(&app)?;
    let owner_name: String = conn.query_row(
        "SELECT name FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1",
        [],
        |r| r.get(0),
    ).unwrap_or_else(|_| "Owner".to_string());
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let new_rec_key = crate::auth::reset_owner_with_recovery_key_inner(&tx, &recovery_key, &new_password)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(RecoveryResetResult {
        new_recovery_key: new_rec_key,
        owner_name,
    })
}

#[command]
pub fn get_users_cmd(app: AppHandle) -> Result<Vec<crate::auth::UserInfo>, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_users_cmd")?;
    crate::auth::get_users_inner(&conn)
}

#[command]
pub fn create_user_cmd(
    app: AppHandle,
    name: String,
    role: String,
    password: String,
) -> Result<crate::auth::UserInfo, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "create_user_cmd")?;
    crate::auth::create_user_inner(&conn, &name, &role, &password)
}

#[command]
pub fn update_user_status_cmd(
    app: AppHandle,
    user_id: i64,
    is_active: bool,
    role: String,
) -> Result<(), String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "update_user_status_cmd")?;
    crate::auth::update_user_status_inner(&conn, user_id, is_active, &role)
}

#[command]
pub fn reset_user_password_cmd(
    app: AppHandle,
    user_id: i64,
    new_password: String,
) -> Result<String, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "reset_user_password_cmd")?;
    crate::auth::reset_user_password_inner(&conn, user_id, &new_password)
}

#[command]
pub fn change_own_password_cmd(
    app: AppHandle,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let conn = get_conn(&app)?;
    let user = check_permission_for_command(&app, &conn, "change_own_password_cmd")?;
    let uid = match user {
        Some(u) => u.id,
        None => return Err("कृपया पहले लॉगिन करें / Login required".to_string()),
    };
    crate::auth::change_own_password_inner(&conn, uid, &old_password, &new_password)
}

#[command]
pub fn get_login_logs_cmd(app: AppHandle, limit: Option<i64>) -> Result<Vec<crate::auth::LoginLogEntry>, String> {
    let conn = get_conn(&app)?;
    check_permission_for_command(&app, &conn, "get_login_logs_cmd")?;
    crate::auth::get_login_logs_inner(&conn, limit)
}




