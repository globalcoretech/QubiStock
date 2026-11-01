use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditLogEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

pub fn write_audit(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    before_json: Option<&str>,
    after_json: Option<&str>,
    reason: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, before_json, after_json, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![entity_type, entity_id, action, before_json, after_json, reason, now],
    ).map_err(|e| format!("Failed to write audit log: {}", e))?;
    Ok(())
}

pub fn get_audit_logs_inner(
    conn: &Connection,
    entity_type: Option<&str>,
    entity_id: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<AuditLogEntry>, String> {
    let lim = limit.unwrap_or(200);
    let mut sql = "SELECT id, COALESCE(entity_type, ''), COALESCE(entity_id, ''), action, before_json, after_json, reason, COALESCE(created_at, '') FROM audit_log WHERE 1=1".to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(et) = entity_type {
        if !et.trim().is_empty() {
            sql.push_str(" AND entity_type = ?");
            params_vec.push(Box::new(et.to_string()));
        }
    }
    if let Some(eid) = entity_id {
        if !eid.trim().is_empty() {
            sql.push_str(" AND entity_id = ?");
            params_vec.push(Box::new(eid.to_string()));
        }
    }

    sql.push_str(" ORDER BY id DESC LIMIT ?");
    params_vec.push(Box::new(lim));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(AuditLogEntry {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            action: row.get(3)?,
            before_json: row.get(4)?,
            after_json: row.get(5)?,
            reason: row.get(6)?,
            created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn check_period_lock(conn: &Connection, tx_date: &str) -> Result<(), String> {
    let locked_until: Option<String> = conn.query_row(
        "SELECT books_locked_until FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    ).unwrap_or(None);

    if let Some(ref lock_date) = locked_until {
        let lock_trimmed = lock_date.trim();
        let tx_trimmed = tx_date.trim();
        if !lock_trimmed.is_empty() && !tx_trimmed.is_empty() && tx_trimmed <= lock_trimmed {
            return Err(format!(
                "यह लेनदेन बंद अवधि ({}) का है और इसमें बदलाव की अनुमति नहीं है। / Books are locked up to {}. Editing or cancelling transactions on or before this date is not allowed.",
                lock_trimmed, lock_trimmed
            ));
        }
    }
    Ok(())
}
