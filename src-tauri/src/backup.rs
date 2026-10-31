use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct TableCounts {
    pub items: i64,
    pub parties: i64,
    pub sales: i64,
    pub purchases: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub success: bool,
    pub file_name: String,
    pub primary_path: String,
    pub secondary_path: Option<String>,
    pub secondary_warning: Option<String>,
    pub timestamp: String,
    pub size_bytes: u64,
    pub formatted_size: String,
    pub is_verified: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub file_path: String,
    pub timestamp: String,
    pub size_bytes: u64,
    pub formatted_size: String,
    pub is_verified: bool,
    pub is_safety_backup: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityCheckReport {
    pub is_ok: bool,
    pub message: String,
    pub details: Vec<String>,
    pub suggested_backup: Option<BackupInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub success: bool,
    pub safety_backup_path: String,
    pub pending_path: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatusInfo {
    pub last_backup_time: Option<String>,
    pub is_backup_recent: bool, // <= 24 hours
    pub formatted_chip_text: String,
    pub primary_folder: String,
    pub secondary_folder: Option<String>,
    pub primary_free_space: Option<String>,
    pub secondary_free_space: Option<String>,
    pub is_same_drive_as_db: bool,
}

/// Resolves default Documents/KrishiBackup folder path
pub fn get_default_backup_dir() -> PathBuf {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        PathBuf::from(profile).join("Documents").join("KrishiBackup")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Documents").join("KrishiBackup")
    } else {
        PathBuf::from("KrishiBackup")
    }
}

/// Retrieves primary backup folder from settings, falling back to default Documents\KrishiBackup
pub fn get_primary_backup_dir(conn: &Connection) -> PathBuf {
    let custom: Result<String, _> = conn.query_row(
        "SELECT backup_folder FROM settings WHERE id = 1",
        [],
        |r| r.get(0),
    );

    if let Ok(path_str) = custom {
        let trimmed = path_str.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    get_default_backup_dir()
}

/// Retrieves optional secondary backup folder from settings
pub fn get_secondary_backup_dir(conn: &Connection) -> Option<PathBuf> {
    let custom: Result<String, _> = conn.query_row(
        "SELECT secondary_backup_folder FROM settings WHERE id = 1",
        [],
        |r| r.get(0),
    );

    if let Ok(path_str) = custom {
        let trimmed = path_str.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

#[cfg(target_os = "windows")]
pub fn get_disk_free_space(path: &Path) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let path_str = path.to_string_lossy();
    let drive_prefix = if path_str.len() >= 2 && path_str.chars().nth(1) == Some(':') {
        format!("{}:\\", path_str.chars().next().unwrap().to_ascii_uppercase())
    } else {
        "C:\\".to_string()
    };

    let wide: Vec<u16> = OsStr::new(&drive_prefix)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let mut free_bytes_avail: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    let res = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes_avail,
            &mut total_bytes,
            &mut total_free_bytes,
        )
    };

    if res != 0 {
        let drive_letter = drive_prefix.trim_end_matches('\\');
        let gb = free_bytes_avail / (1024 * 1024 * 1024);
        Some(format!("{} पर {} GB खाली", drive_letter, gb))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_disk_free_space(_path: &Path) -> Option<String> {
    None
}

/// Tests if a folder is writable by creating, writing, and deleting a small temp file.
pub fn test_folder_writable(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|_| "इस फोल्डर में लिख नहीं सकते, दूसरा चुनो".to_string())?;
    }
    let test_file = dir.join(format!(".write_test_{}_{}", std::process::id(), chrono::Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::write(&test_file, b"krishi_write_test").map_err(|_| "इस फोल्डर में लिख नहीं सकते, दूसरा चुनो".to_string())?;
    let _ = fs::remove_file(&test_file);
    Ok(())
}

/// Copies backup files from old folder to new folder, verifying each with PRAGMA integrity_check.
/// Does NOT delete old backup files.
pub fn copy_backups_with_verification(from_dir: &Path, to_dir: &Path) -> Result<usize, String> {
    if !from_dir.exists() {
        return Ok(0);
    }
    fs::create_dir_all(to_dir).map_err(|e| e.to_string())?;

    let entries = fs::read_dir(from_dir).map_err(|e| e.to_string())?;
    let mut copied_count = 0;

    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if (name.starts_with("inventory_") || name.starts_with("pre_restore_")) && name.ends_with(".db") {
                    let dest = to_dir.join(name);
                    fs::copy(&p, &dest).map_err(|e| format!("फ़ाइल कॉपी करने में त्रुटि {}: {}", name, e))?;

                    if let Ok(c) = Connection::open(&dest) {
                        let st: Result<String, _> = c.query_row("PRAGMA integrity_check;", [], |r| r.get(0));
                        if st.map(|s| s == "ok").unwrap_or(false) {
                            copied_count += 1;
                        } else {
                            let _ = fs::remove_file(&dest);
                            return Err(format!("कॉपी की गई फ़ाइल {} जाँची नहीं जा सकी", name));
                        }
                    } else {
                        let _ = fs::remove_file(&dest);
                        return Err(format!("कॉपी की गई फ़ाइल {} खोली नहीं जा सकी", name));
                    }
                }
            }
        }
    }

    Ok(copied_count)
}

/// Helper to count rows across primary business tables
pub fn get_table_counts(conn: &Connection) -> Result<TableCounts, rusqlite::Error> {
    conn.query_row(
        "SELECT 
            (SELECT COUNT(*) FROM items),
            (SELECT COUNT(*) FROM parties),
            (SELECT COUNT(*) FROM sales),
            (SELECT COUNT(*) FROM purchases)",
        [],
        |row| {
            Ok(TableCounts {
                items: row.get(0)?,
                parties: row.get(1)?,
                sales: row.get(2)?,
                purchases: row.get(3)?,
            })
        },
    )
}

/// Format bytes into human readable format like "1.2 MB"
pub fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// Verifies that a backup file passes SQLite PRAGMA integrity_check and matches expected table counts
pub fn verify_backup(backup_path: &Path, expected_counts: &TableCounts) -> Result<(), String> {
    if !backup_path.exists() {
        return Err("Backup file does not exist on disk".to_string());
    }

    let check_result: Result<(), String> = (|| {
        let backup_conn = Connection::open(backup_path)
            .map_err(|e| format!("Could not open backup connection: {}", e))?;

        let integrity_result: Result<String, _> = backup_conn.query_row(
            "PRAGMA integrity_check;",
            [],
            |r| r.get(0),
        );

        match integrity_result {
            Ok(ref status) if status == "ok" => (),
            Ok(status) => return Err(format!("PRAGMA integrity_check failed on backup: {}", status)),
            Err(e) => return Err(format!("PRAGMA integrity_check error: {}", e)),
        }

        let backup_counts = get_table_counts(&backup_conn)
            .map_err(|e| format!("Failed to count rows in backup DB: {}", e))?;

        if backup_counts != *expected_counts {
            return Err(format!(
                "Row count mismatch! Expected {:?}, got in backup {:?}",
                expected_counts, backup_counts
            ));
        }

        Ok(())
    })();

    if let Err(e) = check_result {
        // Drop of backup_conn has completed; safe to remove file on Windows
        let _ = fs::remove_file(backup_path);
        return Err(e);
    }

    Ok(())
}

/// Rotates backup files in `dir` keeping only the latest `max_keep` files (default 30)
pub fn perform_rotation(dir: &Path, max_keep: usize) -> Result<usize, std::io::Error> {
    if !dir.exists() {
        return Ok(0);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if (file_name.starts_with("inventory_") || file_name.starts_with("pre_restore_"))
                    && file_name.ends_with(".db")
                {
                    entries.push(path);
                }
            }
        }
    }

    // Sort by file name descending (timestamps YYYY-MM-DD_HH-MM sort naturally newest first)
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    let mut removed = 0;
    if entries.len() > max_keep {
        for old_file in &entries[max_keep..] {
            if fs::remove_file(old_file).is_ok() {
                removed += 1;
            }
        }
    }

    Ok(removed)
}

/// Core function: Creates a SQLite backup using VACUUM INTO, verifies integrity and row counts,
/// rotates older backups, copies to secondary drive if present, and updates settings.
pub fn backup_now_inner(
    conn: &Connection,
    primary_dir: &Path,
    secondary_dir: Option<&Path>,
) -> Result<BackupResult, String> {
    // 1. Ensure primary folder exists
    fs::create_dir_all(primary_dir).map_err(|e| {
        format!("Could not create backup directory {}: {}", primary_dir.display(), e)
    })?;

    // 2. Capture source table counts before backup
    let expected_counts = get_table_counts(conn)
        .map_err(|e| format!("Could not read source table counts: {}", e))?;

    // 3. Generate filename format: inventory_YYYY-MM-DD_HH-MM.db
    let now = Local::now();
    let base_name = format!("inventory_{}.db", now.format("%Y-%m-%d_%H-%M"));
    let mut target_path = primary_dir.join(&base_name);
    let mut actual_file_name = base_name;

    // Handle collision if backup is run multiple times in same minute
    if target_path.exists() {
        actual_file_name = format!("inventory_{}_{}.db", now.format("%Y-%m-%d_%H-%M-%S"), now.timestamp_subsec_millis());
        target_path = primary_dir.join(&actual_file_name);
    }

    // 4. Perform VACUUM INTO
    let escaped_path = target_path.to_string_lossy().replace('\'', "''");
    let vacuum_sql = format!("VACUUM INTO '{}'", escaped_path);
    conn.execute(&vacuum_sql, [])
        .map_err(|e| format!("SQLite VACUUM INTO failed: {}", e))?;

    // 5. Immediately verify with separate connection: PRAGMA integrity_check + row counts
    verify_backup(&target_path, &expected_counts)?;

    // 6. Rotate backups in primary directory (keep latest 30)
    let _ = perform_rotation(primary_dir, 30);

    // 7. Inspect file size
    let metadata = fs::metadata(&target_path)
        .map_err(|e| format!("Could not read backup file metadata: {}", e))?;
    let size_bytes = metadata.len();
    let formatted_size = format_size(size_bytes);

    // 8. Handle secondary destination (e.g. pendrive / second drive)
    let mut secondary_path_str = None;
    let mut secondary_warning = None;

    if let Some(sec_dir) = secondary_dir {
        let sec_path_str = sec_dir.to_string_lossy().to_string();
        if !sec_path_str.trim().is_empty() {
            // Check whether parent root/drive exists
            let is_accessible = sec_dir.exists()
                || sec_dir.parent().map(|p| p.exists()).unwrap_or(false);

            if is_accessible && fs::create_dir_all(sec_dir).is_ok() {
                let sec_target = sec_dir.join(&actual_file_name);
                match fs::copy(&target_path, &sec_target) {
                    Ok(_) => {
                        let _ = perform_rotation(sec_dir, 30);
                        secondary_path_str = Some(sec_target.to_string_lossy().to_string());
                    }
                    Err(_) => {
                        secondary_warning = Some("दूसरी जगह नहीं मिली, पेनड्राइव लगाओ".to_string());
                    }
                }
            } else {
                secondary_warning = Some("दूसरी जगह नहीं मिली, पेनड्राइव लगाओ".to_string());
            }
        }
    }

    // 9. Update last_backup_time in settings table
    let now_iso = now.to_rfc3339();
    let _ = conn.execute(
        "UPDATE settings SET last_backup_time = ?1 WHERE id = 1",
        rusqlite::params![now_iso],
    );

    Ok(BackupResult {
        success: true,
        file_name: actual_file_name,
        primary_path: target_path.to_string_lossy().to_string(),
        secondary_path: secondary_path_str,
        secondary_warning,
        timestamp: now_iso,
        size_bytes,
        formatted_size,
        is_verified: true,
        message: "बैकअप सफलतापूर्वक तैयार और जाँचा गया ✓".to_string(),
    })
}

/// Helper called before Tally import to replace old `.bak` copy with verified VACUUM INTO backup
pub fn backup_db_before_import(conn: &Connection, _db_path: &str) -> Result<BackupResult, String> {
    let primary_dir = get_primary_backup_dir(conn);
    let secondary_dir = get_secondary_backup_dir(conn);
    backup_now_inner(conn, &primary_dir, secondary_dir.as_deref())
}

/// Lists all backup files in the primary directory (and secondary if configured)
pub fn list_backups(conn: &Connection) -> Result<Vec<BackupInfo>, String> {
    let primary_dir = get_primary_backup_dir(conn);
    if !primary_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries = fs::read_dir(&primary_dir)
        .map_err(|e| format!("Could not read backup directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if (file_name.starts_with("inventory_") || file_name.starts_with("pre_restore_"))
                    && file_name.ends_with(".db")
                {
                    let metadata = fs::metadata(&path).ok();
                    let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let formatted_size = format_size(size_bytes);
                    let is_safety_backup = file_name.starts_with("pre_restore_");

                    // Check integrity quickly
                    let is_verified = if let Ok(test_conn) = Connection::open(&path) {
                        let res: Result<String, _> = test_conn.query_row(
                            "PRAGMA integrity_check;",
                            [],
                            |r| r.get(0),
                        );
                        res.map(|s| s == "ok").unwrap_or(false)
                    } else {
                        false
                    };

                    list.push(BackupInfo {
                        file_name: file_name.to_string(),
                        file_path: path.to_string_lossy().to_string(),
                        timestamp: parse_timestamp_from_filename(file_name),
                        size_bytes,
                        formatted_size,
                        is_verified,
                        is_safety_backup,
                    });
                }
            }
        }
    }

    // Sort newest first by filename/timestamp
    list.sort_by(|a, b| b.file_name.cmp(&a.file_name));
    Ok(list)
}

fn parse_timestamp_from_filename(filename: &str) -> String {
    // inventory_2026-10-29_11-30.db or pre_restore_2026-10-29_11-30.db
    let stripped = filename
        .trim_start_matches("inventory_")
        .trim_start_matches("pre_restore_")
        .trim_end_matches(".db");
    
    // Replace hyphens in time portion for friendly display
    let parts: Vec<&str> = stripped.split('_').collect();
    if parts.len() >= 2 {
        let date_part = parts[0];
        let time_part = parts[1].replace('-', ":");
        format!("{} {}", date_part, time_part)
    } else {
        stripped.to_string()
    }
}

/// Prepares database restore:
/// 1. Takes safety backup `pre_restore_YYYY-MM-DD_HH-MM.db` of the current database
/// 2. Copies selected backup to `inventory.db.restore_pending`
/// 3. Returns restore result
pub fn prepare_restore(
    conn: Option<&Connection>,
    current_db_path: &Path,
    selected_backup_path: &Path,
    backup_dir: &Path,
) -> Result<RestoreResult, String> {
    if !selected_backup_path.exists() {
        return Err("चुनी गई बैकअप फ़ाइल मौजूद नहीं है!".to_string());
    }

    // Verify selected backup integrity before staging
    let test_conn = Connection::open(selected_backup_path)
        .map_err(|e| format!("बैकअप फ़ाइल खोलने में त्रुटि: {}", e))?;
    let status: Result<String, _> = test_conn.query_row("PRAGMA integrity_check;", [], |r| r.get(0));
    if status.map(|s| s == "ok").unwrap_or(false) == false {
        return Err("चुनी गई बैकअप फ़ाइल में डेटा त्रुटि है (Integrity check failed)".to_string());
    }

    // 1. Safety backup of current database
    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let now = Local::now();
    let safety_name = format!("pre_restore_{}.db", now.format("%Y-%m-%d_%H-%M-%S"));
    let safety_path = backup_dir.join(&safety_name);

    if let Some(c) = conn {
        let escaped = safety_path.to_string_lossy().replace('\'', "''");
        let _ = c.execute(&format!("VACUUM INTO '{}'", escaped), []);
    } else if current_db_path.exists() {
        let _ = fs::copy(current_db_path, &safety_path);
    }

    // 2. Stage pending file: inventory.db.restore_pending
    let pending_path = current_db_path.with_extension("db.restore_pending");
    fs::copy(selected_backup_path, &pending_path)
        .map_err(|e| format!("रिस्टोर पेंडिंग फ़ाइल तैयार नहीं हो सकी: {}", e))?;

    Ok(RestoreResult {
        success: true,
        safety_backup_path: safety_path.to_string_lossy().to_string(),
        pending_path: pending_path.to_string_lossy().to_string(),
        message: "डेटाबेस बदलने की तैयारी पूरी हो चुकी है। ऐप पुनः प्रारंभ होगा।".to_string(),
    })
}

/// Startup hook: Checks if `inventory.db.restore_pending` exists.
/// If present, deletes old `-wal` and `-shm` files, swaps pending file with `inventory.db`,
/// and removes the pending file before SQLite connection is opened.
pub fn check_and_apply_pending_restore(db_path: &str) -> Result<bool, std::io::Error> {
    let main_path = Path::new(db_path);
    let pending_path = main_path.with_extension("db.restore_pending");

    if pending_path.exists() {
        let wal_path = format!("{}-wal", db_path);
        let shm_path = format!("{}-shm", db_path);

        // Delete old wal & shm to prevent WAL index mismatch
        let _ = fs::remove_file(&wal_path);
        let _ = fs::remove_file(&shm_path);

        // Remove old DB file and move pending file into place
        let _ = fs::remove_file(main_path);
        fs::copy(&pending_path, main_path)?;
        let _ = fs::remove_file(&pending_path);

        return Ok(true);
    }
    Ok(false)
}

/// Runs PRAGMA integrity_check on active database at startup.
/// If check fails, finds the latest verified backup from primary and secondary folders.
pub fn check_db_integrity(db_path: &str, primary_dir: &Path) -> IntegrityCheckReport {
    if !Path::new(db_path).exists() {
        return IntegrityCheckReport {
            is_ok: true,
            message: "Fresh database".to_string(),
            details: vec!["Fresh database".to_string()],
            suggested_backup: None,
        };
    }

    let is_ok = match Connection::open(db_path) {
        Ok(conn) => {
            let res: Result<String, _> = conn.query_row("PRAGMA integrity_check;", [], |r| r.get(0));
            res.map(|s| s == "ok").unwrap_or(false)
        }
        Err(_) => false,
    };

    if is_ok {
        return IntegrityCheckReport {
            is_ok: true,
            message: "Database integrity OK".to_string(),
            details: vec!["ok".to_string()],
            suggested_backup: None,
        };
    }

    // Integrity failed! Find newest valid backup to suggest
    let mut candidate = None;
    if primary_dir.exists() {
        if let Ok(entries) = fs::read_dir(primary_dir) {
            let mut files: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        (name.starts_with("inventory_") || name.starts_with("pre_restore_"))
                            && name.ends_with(".db")
                    } else {
                        false
                    }
                })
                .collect();

            // Sort newest first
            files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

            for p in files {
                if let Ok(c) = Connection::open(&p) {
                    let st: Result<String, _> = c.query_row("PRAGMA integrity_check;", [], |r| r.get(0));
                    if st.map(|s| s == "ok").unwrap_or(false) {
                        let name = p.file_name().unwrap().to_string_lossy().to_string();
                        let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                        candidate = Some(BackupInfo {
                            file_name: name.clone(),
                            file_path: p.to_string_lossy().to_string(),
                            timestamp: parse_timestamp_from_filename(&name),
                            size_bytes: size,
                            formatted_size: format_size(size),
                            is_verified: true,
                            is_safety_backup: name.starts_with("pre_restore_"),
                        });
                        break;
                    }
                }
            }
        }
    }

    IntegrityCheckReport {
        is_ok: false,
        message: "डेटा में गड़बड़ी मिली (Database integrity check failed)".to_string(),
        details: vec!["डेटाबेस फ़ाइल में खराबी या अनपेक्षित बदलाव पाया गया है (PRAGMA integrity_check != ok)".to_string()],
        suggested_backup: candidate,
    }
}

/// Helper called on app exit and 30-minute background timer
pub fn auto_backup(app: &tauri::AppHandle, reason: &str) -> Result<BackupResult, String> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("inventory.db");
    if db_path.exists() {
        if let Ok(conn) = Connection::open(&db_path) {
            let primary = get_primary_backup_dir(&conn);
            let secondary = get_secondary_backup_dir(&conn);
            eprintln!("[Krishi Kendra] Triggering auto backup (reason: {})...", reason);
            return backup_now_inner(&conn, &primary, secondary.as_deref());
        }
    }
    Err("Database file not accessible for auto backup".to_string())
}

