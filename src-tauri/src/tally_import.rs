use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Sha256, Digest};
use std::fs;
use std::path::Path;
use chrono::Local;
use thiserror::Error;

use encoding_rs::UTF_16LE;

#[derive(Error, Debug)]
pub enum ImportError {
    #[error("Database error: {0}")]
    DbError(#[from] rusqlite::Error),
    #[error("XML parsing error: {0}")]
    XmlError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Duplicate file import (Hash match)")]
    DuplicateFile,
    #[error("Unit mismatch or missing mapping for: {0}")]
    UnitMismatch(String),
}

impl From<roxmltree::Error> for ImportError {
    fn from(err: roxmltree::Error) -> Self {
        ImportError::XmlError(err.to_string())
    }
}

pub fn decode_tally_xml(bytes: &[u8]) -> String {
    let raw = if bytes.starts_with(b"\xff\xfe") || (bytes.len() > 1 && bytes[1] == 0) {
        let (cow, _, _) = UTF_16LE.decode(bytes);
        cow.into_owned()
    } else if bytes.starts_with(b"\xef\xbb\xbf") {
        String::from_utf8_lossy(&bytes[3..]).into_owned()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    let mut s = raw;
    if s.starts_with('\u{feff}') {
        s.remove(0); // Remove BOM if present
    }
    // Remove invalid control characters like &#4;
    s.replace("&#4;", "")
}

#[derive(Debug, Serialize, Default)]
pub struct PreviewReport {
    pub total_items: usize,
    pub total_parties: usize,
    pub total_vouchers: usize,
    pub new_items: usize,
    pub new_parties: usize,
    pub new_vouchers: usize,
    pub new_godowns: usize,
    pub new_units: usize,
    pub skipped_ledgers: usize,
    pub errors: Vec<String>,
}

pub fn is_party_ledger(parent: &str, name: &str) -> Option<&'static str> {
    let lower_name = name.to_lowercase();
    let lower_name = lower_name.trim();
    let lower_parent = parent.to_lowercase();
    let lower_parent = lower_parent.trim();

    // Skip accounting and standard system ledgers
    if lower_name == "cash"
        || lower_name == "cash account"
        || lower_name == "cash-in-hand"
        || lower_name == "profit & loss a/c"
        || lower_name == "profit & loss"
        || lower_name == "purchase"
        || lower_name == "purchases"
        || lower_name == "purchase account"
        || lower_name == "purchases account"
        || lower_name == "sales"
        || lower_name == "sale"
        || lower_name == "sales account"
        || lower_name == "round off"
        || lower_name == "cgst"
        || lower_name == "sgst"
        || lower_name == "igst"
        || lower_name.starts_with("input ")
        || lower_name.starts_with("output ")
    {
        return None;
    }

    // Must belong to Sundry Creditors or Sundry Debtors (or any sub-group containing creditor/debtor)
    if lower_parent.contains("creditor") {
        Some("supplier")
    } else if lower_parent.contains("debtor") {
        Some("customer")
    } else {
        None
    }
}

pub fn get_parent_name(node: roxmltree::Node) -> String {
    for child in node.children() {
        if child.has_tag_name("PARENT") {
            if let Some(attr) = child.attribute("NAME") {
                return attr.to_string();
            }
            if let Some(t) = child.text() {
                return t.to_string();
            }
        }
    }
    if let Some(attr) = node.attribute("PARENT") {
        return attr.to_string();
    }
    String::new()
}

fn calculate_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn check_duplicate_file(conn: &Connection, hash: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM import_log WHERE hash = ?1 AND status = 'Success'",
        params![hash],
        |row| row.get(0)
    )?;
    Ok(count > 0)
}

fn backup_db(db_path: &str) -> std::io::Result<()> {
    let original = Path::new(db_path);
    if original.exists() {
        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let backup = original.with_extension(format!("{}.bak", timestamp));
        let _ = fs::copy(original, backup);
    }
    Ok(())
}

fn parse_qty_and_unit(qty_str: &str) -> (f64, String) {
    let parts: Vec<&str> = qty_str.trim().split_whitespace().collect();
    if parts.len() >= 2 {
        let q = parts[0].parse().unwrap_or(0.0);
        let u = parts[1].to_string();
        (q, u)
    } else if parts.len() == 1 {
        (parts[0].parse().unwrap_or(0.0), "nos".to_string())
    } else {
        (0.0, "nos".to_string())
    }
}

// "box of 12 pcs" -> Some(("box", 12000, "pcs")) -> (main, factor_milli, sub)
fn parse_compound_unit(unit_str: &str) -> Option<(String, i64, String)> {
    let lower = unit_str.to_lowercase();
    if lower.contains(" of ") {
        let parts: Vec<&str> = lower.split(" of ").collect();
        if parts.len() == 2 {
            let main_unit = parts[0].trim().to_string();
            let sub_parts: Vec<&str> = parts[1].trim().split_whitespace().collect();
            if sub_parts.len() == 2 {
                let factor = sub_parts[0].parse::<f64>().unwrap_or(1.0);
                let factor_milli = (factor * 1000.0).round() as i64;
                let sub_unit = sub_parts[1].trim().to_string();
                return Some((main_unit, factor_milli, sub_unit));
            }
        }
    }
    None
}

fn get_name(node: roxmltree::Node) -> String {
    if let Some(attr) = node.attribute("NAME") {
        return attr.to_string();
    }
    for child in node.children() {
        if child.has_tag_name("NAME") {
            if let Some(text) = child.text() {
                return text.to_string();
            }
        }
    }
    String::new()
}

fn get_text<'a>(node: roxmltree::Node<'a, 'a>, tag: &str) -> Option<&'a str> {
    if let Some(attr) = node.attribute(tag) {
        return Some(attr);
    }
    for child in node.children() {
        if child.has_tag_name(tag) {
            return child.text();
        }
    }
    None
}

pub fn preview_import(conn: &Connection, xml_content: &str) -> std::result::Result<PreviewReport, ImportError> {
    let hash = calculate_hash(xml_content);
    if check_duplicate_file(conn, &hash)? {
        return Err(ImportError::DuplicateFile);
    }

    let doc = roxmltree::Document::parse(xml_content)?;
    let mut report = PreviewReport::default();

    for node in doc.descendants() {
        if node.has_tag_name("TALLYMESSAGE") {
            for child in node.children().filter(|n| n.is_element()) {
                match child.tag_name().name() {
                "LEDGER" => {
                    let name = get_name(child);
                    if name.is_empty() {
                        report.errors.push("Skipped Ledger: Missing Name".to_string());
                        continue;
                    }
                    let parent = get_parent_name(child);
                    if is_party_ledger(&parent, &name).is_none() {
                        report.skipped_ledgers += 1;
                        continue;
                    }
                    report.total_parties += 1;
                    let guid = get_text(child, "GUID").unwrap_or("");
                    let exists: bool = conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = ?1 OR guid = ?2)",
                        params![name, guid],
                        |row| row.get(0)
                    ).unwrap_or(false);
                    if !exists { report.new_parties += 1; }
                }
                "GODOWN" => {
                    let name = get_name(child);
                    if name.is_empty() { continue; }
                    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM godowns WHERE name = ?1)", params![name], |row| row.get(0)).unwrap_or(false);
                    if !exists { report.new_godowns += 1; }
                }
                "UNIT" => {
                    let name = get_name(child);
                    if name.is_empty() { continue; }
                    if parse_compound_unit(&name).is_some() {
                        report.new_units += 1;
                    }
                }
                "STOCKITEM" => {
                    let name = get_name(child);
                    if name.is_empty() {
                        report.errors.push("Skipped StockItem: Missing Name".to_string());
                        continue;
                    }
                    report.total_items += 1;
                    let guid = get_text(child, "GUID").unwrap_or("");
                    let exists: bool = conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM items WHERE name = ?1 OR guid = ?2)",
                        params![name, guid],
                        |row| row.get(0)
                    ).unwrap_or(false);
                    if !exists { report.new_items += 1; }
                }
                "VOUCHER" => {
                    let vch_type = get_text(child, "VOUCHERTYPENAME")
                        .or_else(|| child.attribute("VCHTYPE"))
                        .unwrap_or("");
                    let date = get_text(child, "DATE").unwrap_or("");
                    let party = get_text(child, "PARTYLEDGERNAME").unwrap_or("");
                    let reference = get_text(child, "REFERENCE").unwrap_or("");
                    
                    if date.is_empty() || party.is_empty() {
                        report.errors.push(format!("Skipped Voucher: Missing Date or Party (Ref: {})", reference));
                        continue;
                    }
                    report.total_vouchers += 1;
                    let table = if vch_type.eq_ignore_ascii_case("purchase") { "purchases" } else { "sales" };
                    let guid = get_text(child, "GUID").unwrap_or("");
                    let inv_no = if reference.is_empty() { date } else { reference };
                    
                    let exists: bool = conn.query_row(
                        &format!("SELECT EXISTS(SELECT 1 FROM {} WHERE guid = ?1 OR invoice_no = ?2)", table),
                        params![guid, inv_no],
                        |row| row.get(0)
                    ).unwrap_or(false);
                    if !exists { report.new_vouchers += 1; }
                    
                    // Inventory entries list
                    for entry_node in child.children().filter(|n| n.has_tag_name("ALLINVENTORYENTRIES.LIST")) {
                        let item_name = get_text(entry_node, "STOCKITEMNAME").unwrap_or("");
                        if item_name.is_empty() { continue; }
                        let item_exists: bool = conn.query_row(
                            "SELECT EXISTS(SELECT 1 FROM items WHERE name = ?1)",
                            params![item_name],
                            |row| row.get(0)
                        ).unwrap_or(false);
                        if !item_exists {
                            report.errors.push(format!("Voucher has missing item: {}", item_name));
                        }
                    }
                }
                _ => {} // Ignore unknown tags
                }
            }
        }
    }
    
    Ok(report)
}

pub fn confirm_import(conn: &mut Connection, db_path: &str, xml_content: &str, file_name: &str) -> std::result::Result<(), ImportError> {
    let hash = calculate_hash(xml_content);
    if check_duplicate_file(conn, &hash)? {
        return Err(ImportError::DuplicateFile);
    }
    let _ = crate::backup::backup_db_before_import(conn, db_path);
    backup_db(db_path)?;
    let doc = roxmltree::Document::parse(xml_content)?;
    
    let tx = conn.transaction()?;
    let date_str = Local::now().to_rfc3339();
    
    for node in doc.descendants() {
        if node.has_tag_name("TALLYMESSAGE") {
            for child in node.children().filter(|n| n.is_element()) {
                match child.tag_name().name() {
                "LEDGER" => {
                    let name = get_name(child);
                    if name.is_empty() { continue; }
                    let parent = get_parent_name(child);
                    let p_type = match is_party_ledger(&parent, &name) {
                        Some(t) => t,
                        None => continue,
                    };
                    let guid = get_text(child, "GUID").unwrap_or("");
                    
                    if let Err(e) = tx.execute(
                        "INSERT INTO parties (name, type, guid) VALUES (?1, ?2, ?3)
                         ON CONFLICT(guid) DO UPDATE SET name=excluded.name, type=excluded.type",
                        params![name, p_type, guid]
                    ) {
                        println!("Failed to insert ledger {}: {}", name, e);
                    }
                }
                "GODOWN" => {
                    let name = get_name(child);
                    if name.is_empty() { continue; }
                    let _ = tx.execute("INSERT OR IGNORE INTO godowns (name) VALUES (?1)", params![name]);
                }
                "STOCKITEM" => {
                    let name = get_name(child);
                    if name.is_empty() { continue; }
                    let raw_base = get_text(child, "BASEUNITS").unwrap_or("nos");
                    
                    let mut final_base_unit = raw_base.to_string();
                    let mut compound_opt = None;
                    
                    if let Some((main, factor, sub)) = parse_compound_unit(raw_base) {
                        final_base_unit = sub.clone();
                        compound_opt = Some((main, factor, sub));
                    }
                    
                    let hsn_code = get_text(child, "HSNCODE").unwrap_or("");
                    let gst_str = get_text(child, "GSTRATE").unwrap_or("0");
                    let gst_rate = (gst_str.parse::<f64>().unwrap_or(0.0) * 1000.0) as i64;
                    let guid = get_text(child, "GUID").unwrap_or("");
                    
                    if let Err(e) = tx.execute(
                        "INSERT INTO items (name, base_unit, hsn, gst_rate, guid) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(guid) DO UPDATE SET name=excluded.name, base_unit=excluded.base_unit",
                        params![name, final_base_unit, hsn_code, gst_rate, guid]
                    ) {
                        println!("Failed to insert item {}: {}", name, e);
                        continue;
                    }
                    
                    if let Some((main, factor, _sub)) = compound_opt {
                        if let Ok(item_id) = tx.query_row::<i64, _, _>("SELECT id FROM items WHERE guid = ?1 OR name = ?2", params![guid, name], |row| row.get(0)) {
                            let _ = tx.execute(
                                "INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (?1, ?2, ?3)
                                 ON CONFLICT DO NOTHING",
                                params![item_id, main, factor]
                            );
                        }
                    }
                }
                "VOUCHER" => {
                    let vch_type = get_text(child, "VOUCHERTYPENAME")
                        .or_else(|| child.attribute("VCHTYPE"))
                        .unwrap_or("");
                    let date = get_text(child, "DATE").unwrap_or("");
                    let party_name = get_text(child, "PARTYLEDGERNAME").unwrap_or("");
                    if date.is_empty() || party_name.is_empty() { continue; }

                    let is_purchase = vch_type.eq_ignore_ascii_case("purchase");
                    let party_id: i64 = match tx.query_row("SELECT id FROM parties WHERE name = ?1", params![party_name], |row| row.get(0)) {
                        Ok(id) => id,
                        Err(_) => continue,
                    };
                    
                    let reference = get_text(child, "REFERENCE").unwrap_or("");
                    let invoice_no = if reference.is_empty() { date } else { reference };
                    let guid = get_text(child, "GUID").unwrap_or("");

                    if is_purchase {
                        let _ = tx.execute(
                            "INSERT INTO purchases (invoice_no, guid, date, supplier_id) VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT DO NOTHING",
                            params![invoice_no, guid, date, party_id]
                        );
                        for entry_node in child.children().filter(|n| n.has_tag_name("ALLINVENTORYENTRIES.LIST")) {
                            let item_name = get_text(entry_node, "STOCKITEMNAME").unwrap_or("");
                            if item_name.is_empty() { continue; }
                            let item_id: i64 = match tx.query_row("SELECT id FROM items WHERE name = ?1", params![item_name], |row| row.get(0)) {
                                Ok(id) => id,
                                Err(_) => continue,
                            };
                            
                            let billed_qty = get_text(entry_node, "BILLEDQTY").unwrap_or("");
                            let (qty_f64, unit) = parse_qty_and_unit(billed_qty);
                            
                            let base_unit: String = tx.query_row("SELECT base_unit FROM items WHERE id = ?1", params![item_id], |row| row.get(0)).unwrap_or_default();
                            if !base_unit.is_empty() && unit != base_unit && unit != "nos" {
                                let unit_exists: bool = tx.query_row(
                                    "SELECT EXISTS(SELECT 1 FROM item_units WHERE item_id = ?1 AND unit_name = ?2)",
                                    params![item_id, &unit],
                                    |row| row.get(0)
                                ).unwrap_or(false);
                                if !unit_exists {
                                    return Err(ImportError::UnitMismatch(format!("Item '{}' has unmapped unit '{}'", item_name, unit)));
                                }
                            }

                            let qty_milli = (qty_f64 * 1000.0).round() as i64;
                            let rate_str = get_text(entry_node, "RATE").unwrap_or("0");
                            let rate_val = rate_str.split('/').next().unwrap_or("0");
                            let rate_paise = (rate_val.parse::<f64>().unwrap_or(0.0) * 100.0).round() as i64;
                            
                            let amount_str = get_text(entry_node, "AMOUNT").unwrap_or("0");
                            let amount_paise = (amount_str.parse::<f64>().unwrap_or(0.0).abs() * 100.0).round() as i64;

                            let _ = tx.execute(
                                "INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                params![invoice_no, item_id, qty_milli, unit, rate_paise, amount_paise]
                            );
                        }
                    } else {
                        let _ = tx.execute(
                            "INSERT INTO sales (invoice_no, guid, date, customer_id) VALUES (?1, ?2, ?3, ?4)
                             ON CONFLICT DO NOTHING",
                            params![invoice_no, guid, date, party_id]
                        );
                        for entry_node in child.children().filter(|n| n.has_tag_name("ALLINVENTORYENTRIES.LIST")) {
                            let item_name = get_text(entry_node, "STOCKITEMNAME").unwrap_or("");
                            if item_name.is_empty() { continue; }
                            let item_id: i64 = match tx.query_row("SELECT id FROM items WHERE name = ?1", params![item_name], |row| row.get(0)) {
                                Ok(id) => id,
                                Err(_) => continue,
                            };

                            let billed_qty = get_text(entry_node, "BILLEDQTY").unwrap_or("");
                            let (qty_f64, unit) = parse_qty_and_unit(billed_qty);

                            let base_unit: String = tx.query_row("SELECT base_unit FROM items WHERE id = ?1", params![item_id], |row| row.get(0)).unwrap_or_default();
                            if !base_unit.is_empty() && unit != base_unit && unit != "nos" {
                                let unit_exists: bool = tx.query_row(
                                    "SELECT EXISTS(SELECT 1 FROM item_units WHERE item_id = ?1 AND unit_name = ?2)",
                                    params![item_id, &unit],
                                    |row| row.get(0)
                                ).unwrap_or(false);
                                if !unit_exists {
                                    return Err(ImportError::UnitMismatch(format!("Item '{}' has unmapped unit '{}'", item_name, unit)));
                                }
                            }

                            let qty_milli = (qty_f64 * 1000.0).round() as i64;
                            let rate_str = get_text(entry_node, "RATE").unwrap_or("0");
                            let rate_val = rate_str.split('/').next().unwrap_or("0");
                            let rate_paise = (rate_val.parse::<f64>().unwrap_or(0.0) * 100.0).round() as i64;
                            let amount_str = get_text(entry_node, "AMOUNT").unwrap_or("0");
                            let amount_paise = (amount_str.parse::<f64>().unwrap_or(0.0).abs() * 100.0).round() as i64;

                            let _ = tx.execute(
                                "INSERT INTO sale_lines (invoice_no, item_id, qty, unit, rate, taxable) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                params![invoice_no, item_id, qty_milli, unit, rate_paise, amount_paise]
                            );
                        }
                    }
                }
                _ => {}
                }
            }
        }
    }
    
    // Log success
    tx.execute(
        "INSERT INTO import_log (file_name, hash, date, status, counts) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![file_name, hash, date_str, "Success", "Items/Parties imported"]
    )?;
    
    tx.commit()?;
    Ok(())
}
