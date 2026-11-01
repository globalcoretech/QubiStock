use rusqlite::{Connection, Result, params, OptionalExtension};

// 1. Multi-unit conversion to base unit
pub fn get_qty_in_base_unit(conn: &Connection, item_id: i64, qty_milli: i64, unit_name: &str) -> Result<i64> {
    // Check if the given unit is the base unit itself
    let base_unit: String = conn.query_row(
        "SELECT base_unit FROM items WHERE id = ?1",
        params![item_id],
        |row| row.get(0),
    )?;

    if base_unit.eq_ignore_ascii_case(unit_name) {
        return Ok(qty_milli);
    }

    // Look up conversion factor (in milli-units, e.g. 50_000 for 50)
    let factor: Option<i64> = conn.query_row(
        "SELECT factor_to_base FROM item_units WHERE item_id = ?1 AND LOWER(unit_name) = LOWER(?2)",
        params![item_id, unit_name],
        |row| row.get(0),
    ).optional()?;

    match factor {
        Some(f) => {
            // factor is in milli-units.
            // if factor is 50,000 (meaning 50 base units per unit)
            // qty_milli * factor / 1000
            Ok((qty_milli * f) / 1000)
        },
        None => Err(rusqlite::Error::QueryReturnedNoRows)
    }
}

// 2. Append stock ledger
pub fn add_stock_ledger_entry(
    conn: &Connection, 
    date: &str, 
    item_id: i64, 
    godown_id: i64, 
    qty_base_milli: i64, 
    entry_type: &str, 
    ref_id: Option<&str>, 
    linked_id: Option<i64>,
    party_id: Option<i64>, 
    batch: Option<&str>
) -> Result<i64> {
    conn.execute(
        "INSERT INTO stock_ledger (date, item_id, godown_id, qty_base, type, ref_id, linked_id, party_id, batch)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![date, item_id, godown_id, qty_base_milli, entry_type, ref_id, linked_id, party_id, batch],
    )?;
    Ok(conn.last_insert_rowid())
}

// 4. Stock Reversal Function
pub fn reverse_stock_ledger_entry(
    conn: &Connection,
    original_id: i64,
    date: &str,
    new_ref_id: &str
) -> Result<i64> {
    // Check if already reversed
    let already_reversed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM stock_ledger WHERE linked_id = ?1 AND type = 'reversal')",
        params![original_id],
        |row| row.get(0)
    )?;
    
    if already_reversed {
        return Err(rusqlite::Error::InvalidParameterName(
            "Already reversed".to_string()
        ));
    }

    // Fetch the original entry
    let (item_id, godown_id, orig_qty_base, _orig_type, party_id, batch): (i64, i64, i64, String, Option<i64>, Option<String>) = conn.query_row(
        "SELECT item_id, godown_id, qty_base, type, party_id, batch FROM stock_ledger WHERE id = ?1",
        params![original_id],
        |row| Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?
        ))
    )?;

    // Calculate reversed qty
    let reversed_qty = -orig_qty_base;
    let entry_type = "reversal";

    // Insert reversal
    add_stock_ledger_entry(
        conn,
        date,
        item_id,
        godown_id,
        reversed_qty,
        entry_type,
        Some(new_ref_id),
        Some(original_id),
        party_id,
        batch.as_deref()
    )
}

// 3. Weighted Average Cost Logic (in paise per base milli-unit... wait, cost per base unit)
// cost per base unit (paise/base_unit) = total_paise / (total_milli_units / 1000)
// To keep precision, we can return i64 paise per 1 whole base unit.
pub fn calculate_weighted_average_cost(conn: &Connection, item_id: i64) -> Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT pl.qty, pl.unit, pl.taxable 
         FROM purchase_lines pl 
         WHERE pl.item_id = ?1"
    )?;

    let purchase_iter = stmt.query_map(params![item_id], |row| {
        Ok((
            row.get::<_, i64>(0)?, // qty (milli)
            row.get::<_, String>(1)?, // unit
            row.get::<_, i64>(2)?, // taxable (paise)
        ))
    })?;

    let mut total_value = 0; // paise
    let mut total_base_qty_milli = 0;

    for p in purchase_iter {
        let (qty, unit, taxable) = p?;
        let base_qty_milli = get_qty_in_base_unit(conn, item_id, qty, &unit)?;
        
        total_value += taxable;
        total_base_qty_milli += base_qty_milli;
    }

    if total_base_qty_milli == 0 {
        return Ok(0);
    }

    // Return cost in paise per 1 whole base unit
    // total_value / (total_base_qty_milli / 1000.0) -> total_value * 1000 / total_base_qty_milli
    Ok((total_value * 1000) / total_base_qty_milli)
}
