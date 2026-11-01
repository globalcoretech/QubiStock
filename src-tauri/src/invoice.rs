use serde::{Deserialize, Serialize};
use rusqlite::{Connection, Result, params, OptionalExtension};
use crate::inventory::{add_stock_ledger_entry, calculate_weighted_average_cost};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InvoiceLine {
    #[serde(alias = "itemId")]
    pub item_id: i64,
    pub qty: i64,      // milli-units
    pub unit: String,
    pub rate: i64,     // paise
    pub taxable: i64,  // paise
    pub cgst: i64,     // paise
    pub sgst: i64,     // paise
    pub igst: i64,     // paise
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InvoicePayload {
    #[serde(alias = "invoiceNo")]
    pub invoice_no: String,
    pub date: String,
    #[serde(alias = "partyId")]
    pub party_id: i64,
    #[serde(alias = "godownId")]
    pub godown_id: i64,
    #[serde(alias = "type")]
    pub type_: String, // "purchase" or "sale"
    #[serde(alias = "paymentMode", default = "default_payment_mode")]
    pub payment_mode: String, // "cash", "credit", "upi_bank"
    #[serde(alias = "paidAmount", default)]
    pub paid_amount: i64, // paise
    #[serde(alias = "shopState", default)]
    pub shop_state: Option<String>,
    #[serde(alias = "supplierInvoiceNo", default)]
    pub supplier_invoice_no: Option<String>,
    #[serde(alias = "supplierInvoiceDate", default)]
    pub supplier_invoice_date: Option<String>,
    pub lines: Vec<InvoiceLine>,
}

impl Default for InvoicePayload {
    fn default() -> Self {
        Self {
            invoice_no: String::new(),
            date: String::new(),
            party_id: 0,
            godown_id: 0,
            type_: "sale".to_string(),
            payment_mode: "cash".to_string(),
            paid_amount: 0,
            shop_state: None,
            supplier_invoice_no: None,
            supplier_invoice_date: None,
            lines: Vec::new(),
        }
    }
}

fn default_payment_mode() -> String {
    "cash".to_string()
}

pub fn save_invoice(conn: &mut Connection, payload: InvoicePayload) -> Result<()> {
    // 0. Check period lock
    crate::audit::check_period_lock(conn, &payload.date)
        .map_err(|e| rusqlite::Error::InvalidParameterName(e))?;

    let is_sale = payload.type_ == "sale";

    // 0b. Validate Sales invoice_no or Purchase supplier_invoice_no
    if is_sale {
        let clean_no = payload.invoice_no.trim();
        if clean_no.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName("Invoice number is required / बिल नंबर आवश्यक है".to_string()));
        }
        if clean_no.len() > 16 {
            return Err(rusqlite::Error::InvalidParameterName("Invoice number cannot exceed 16 characters / बिल नंबर 16 अक्षरों से अधिक नहीं हो सकता".to_string()));
        }
        if !clean_no.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-') {
            return Err(rusqlite::Error::InvalidParameterName("Invoice number can only contain letters, numbers, '/' and '-' / बिल नंबर में केवल अक्षर, अंक, '/' और '-' हो सकते हैं".to_string()));
        }
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sales WHERE LOWER(invoice_no) = LOWER(?1)",
            params![clean_no],
            |row| row.get(0),
        )?;
        if exists > 0 {
            return Err(rusqlite::Error::InvalidParameterName(format!("Invoice number '{}' already exists / बिल नंबर '{}' पहले से मौजूद है", clean_no, clean_no)));
        }
    } else if let Some(ref supp_no) = payload.supplier_invoice_no {
        let clean_supp = supp_no.trim();
        if !clean_supp.is_empty() {
            if clean_supp.len() > 30 {
                return Err(rusqlite::Error::InvalidParameterName("Supplier invoice number cannot exceed 30 characters / सप्लायर बिल नंबर 30 अक्षरों से अधिक नहीं हो सकता".to_string()));
            }
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM purchases WHERE supplier_id = ?1 AND LOWER(supplier_invoice_no) = LOWER(?2)",
                params![payload.party_id, clean_supp],
                |row| row.get(0),
            )?;
            if exists > 0 {
                return Err(rusqlite::Error::InvalidParameterName("This supplier already has this invoice number / इस सप्लायर का यह बिल नंबर पहले से मौजूद है".to_string()));
            }
        }
    }

    let tx = conn.transaction()?;

    // 1. Check Party details (category, gstin)
    let (party_category, party_gstin): (String, Option<String>) = tx.query_row(
        "SELECT category, gstin FROM parties WHERE id = ?1",
        params![payload.party_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap_or_else(|_| ("unregistered".to_string(), None));

    let is_composition_supplier = !is_sale && party_category == "composition";

    // 2. State-based tax determination if shop_state is provided
    let is_interstate = if let Some(ref shop_st) = payload.shop_state {
        let clean_shop = shop_st.trim();
        if let Some(ref gstin) = party_gstin {
            let clean_gst = gstin.trim();
            if clean_gst.len() >= 2 {
                let party_state = &clean_gst[0..2];
                party_state != clean_shop
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    // 3. Calculate Total Amount & Process Lines
    let mut grand_total_paise = 0i64;
    let mut processed_lines = Vec::new();

    for mut line in payload.lines {
        if is_composition_supplier {
            // Composition supplier: no GST breakdown, input GST not counted
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

    // Determine actual paid amount
    let actual_paid_paise = match payload.payment_mode.as_str() {
        "cash" | "upi_bank" => grand_total_paise,
        "credit" => payload.paid_amount.clamp(0, grand_total_paise),
        _ => payload.paid_amount.clamp(0, grand_total_paise),
    };

    // 4. Insert Purchase or Sale Header
    if is_sale {
        tx.execute(
            "INSERT INTO sales (invoice_no, date, customer_id, payment_mode, paid_amount, total_amount) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![payload.invoice_no.trim(), payload.date, payload.party_id, payload.payment_mode, actual_paid_paise, grand_total_paise],
        )?;
    } else {
        let supp_no = payload.supplier_invoice_no.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
        let supp_date = payload.supplier_invoice_date.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
        tx.execute(
            "INSERT INTO purchases (invoice_no, date, supplier_id, payment_mode, paid_amount, total_amount, supplier_invoice_no, supplier_invoice_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![payload.invoice_no.trim(), payload.date, payload.party_id, payload.payment_mode, actual_paid_paise, grand_total_paise, supp_no, supp_date],
        )?;
    }

    // 5. Insert Lines & Stock Ledger
    for line in processed_lines {
        let mut factor = 1000i64; // 1 base unit
        let base_unit: String = tx.query_row("SELECT base_unit FROM items WHERE id = ?1", params![line.item_id], |row| row.get(0))?;
        if !base_unit.eq_ignore_ascii_case(&line.unit) {
            let f: Option<i64> = tx.query_row(
                "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
                params![line.item_id, line.unit],
                |row| row.get(0)
            ).ok();
            if let Some(f_val) = f {
                factor = f_val;
            }
        }
        
        let qty_base = (line.qty * factor) / 1000;

        let (item_hsn, item_gst_rate): (Option<String>, Option<i64>) = tx.query_row(
            "SELECT hsn, gst_rate FROM items WHERE id = ?1",
            params![line.item_id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap_or((None, None));

        if is_sale {
            // Check stock logic
            let mut stmt = tx.prepare("SELECT COALESCE(SUM(qty_base), 0) FROM stock_ledger WHERE item_id = ?1 AND godown_id = ?2")?;
            let current_stock: i64 = stmt.query_row(params![line.item_id, payload.godown_id], |row| row.get(0))?;
            if current_stock < qty_base {
                return Err(rusqlite::Error::InvalidParameterName("Stock kam hai!".to_string()));
            }

            // Snapshot Weighted Average Cost at the time of sale
            let wac = calculate_weighted_average_cost(&tx, line.item_id).unwrap_or(0);
            let cost_paise = (qty_base * wac) / 1000;

            tx.execute(
                "INSERT INTO sale_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst, cost_paise, hsn, gst_rate) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![payload.invoice_no.trim(), line.item_id, line.qty, line.unit, line.rate, line.taxable, line.cgst, line.sgst, line.igst, cost_paise, item_hsn, item_gst_rate]
            )?;
        } else {
            tx.execute(
                "INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst, hsn, gst_rate) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![payload.invoice_no.trim(), line.item_id, line.qty, line.unit, line.rate, line.taxable, line.cgst, line.sgst, line.igst, item_hsn, item_gst_rate]
            )?;
        }

        let signed_qty = if is_sale { -qty_base } else { qty_base };
        let entry_type = if is_sale { "sale" } else { "purchase" };

        add_stock_ledger_entry(
            &tx,
            &payload.date,
            line.item_id,
            payload.godown_id,
            signed_qty,
            entry_type,
            Some(payload.invoice_no.trim()),
            None,
            Some(payload.party_id),
            None
        )?;
    }

    // 6. Insert Party Financial Ledger Entry
    if is_sale {
        // Sale invoice -> Customer Debit (Receivable)
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) VALUES (?1, ?2, 'sale', ?3, ?4, 0, ?5, 'Sale invoice')",
            params![payload.date, payload.party_id, payload.invoice_no.trim(), grand_total_paise, payload.payment_mode],
        )?;
        // If paid amount > 0 -> Customer Credit (Payment Received)
        if actual_paid_paise > 0 {
            tx.execute(
                "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) VALUES (?1, ?2, 'payment', ?3, 0, ?4, ?5, 'Invoice payment')",
                params![payload.date, payload.party_id, payload.invoice_no.trim(), actual_paid_paise, payload.payment_mode],
            )?;
        }
    } else {
        // Purchase invoice -> Supplier Credit (Payable)
        tx.execute(
            "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) VALUES (?1, ?2, 'purchase', ?3, 0, ?4, ?5, 'Purchase invoice')",
            params![payload.date, payload.party_id, payload.invoice_no.trim(), grand_total_paise, payload.payment_mode],
        )?;
        // If paid amount > 0 -> Supplier Debit (Payment Paid)
        if actual_paid_paise > 0 {
            tx.execute(
                "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) VALUES (?1, ?2, 'payment', ?3, ?4, 0, ?5, 'Invoice payment')",
                params![payload.date, payload.party_id, payload.invoice_no.trim(), actual_paid_paise, payload.payment_mode],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn log_invoice_print(conn: &Connection, invoice_no: &str, bill_mode: &str) -> std::result::Result<(), String> {
    if bill_mode != "WITH_GST" && bill_mode != "WITHOUT_GST" {
        return Err(format!("Invalid bill_mode: {}. Must be WITH_GST or WITHOUT_GST", bill_mode));
    }
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO invoice_print_log (invoice_no, bill_mode, printed_at) VALUES (?1, ?2, ?3)",
        params![invoice_no, bill_mode, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_last_invoice_print_mode(conn: &Connection, invoice_no: &str) -> std::result::Result<String, String> {
    let mode: Option<String> = conn.query_row(
        "SELECT bill_mode FROM invoice_print_log WHERE invoice_no = ?1 ORDER BY id DESC LIMIT 1",
        params![invoice_no],
        |r| r.get(0),
    ).optional().map_err(|e| e.to_string())?;

    Ok(mode.unwrap_or_else(|| "WITH_GST".to_string()))
}
