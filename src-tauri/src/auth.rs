use argon2::{
    password_hash::{
        rand_core::OsRng,
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionUser {
    pub id: i64,
    pub name: String,
    pub role: String, // "owner" | "staff"
}

pub const MAX_FAILED_LOGIN_ATTEMPTS: i64 = 5;
pub const LOCKOUT_DURATION_MINUTES: i64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub name: String,
    pub role: String, // "owner" | "staff"
    pub is_active: bool,
    #[serde(skip_serializing, default)]
    pub failed_attempts: i64,
    pub locked_until: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginLogEntry {
    pub id: i64,
    pub user_name: String,
    pub event: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityStatus {
    pub security_enabled: bool,
    pub has_users: bool,
    pub auto_lock_minutes: i64,
    pub current_user: Option<SessionUser>,
    pub is_locked: bool,
}

pub static STARTUP_CORRUPTION_DETECTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn is_startup_corruption_detected() -> bool {
    STARTUP_CORRUPTION_DETECTED.load(std::sync::atomic::Ordering::SeqCst)
}

pub fn set_startup_corruption_detected(val: bool) {
    STARTUP_CORRUPTION_DETECTED.store(val, std::sync::atomic::Ordering::SeqCst);
}

#[derive(Default)]
pub struct AuthState {
    pub current_user: std::sync::Mutex<Option<SessionUser>>,
    pub is_locked: std::sync::Mutex<bool>,
    pub startup_corruption_detected: std::sync::atomic::AtomicBool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MinimumRole {
    Public,
    Staff,
    Owner,
}

impl std::fmt::Display for MinimumRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MinimumRole::Public => write!(f, "Public"),
            MinimumRole::Staff => write!(f, "Staff"),
            MinimumRole::Owner => write!(f, "Owner"),
        }
    }
}

pub fn hash_password(password: &str) -> std::result::Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?
        .to_string();
    Ok(password_hash)
}

pub fn verify_password(password: &str, hash_str: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash_str) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

pub fn generate_recovery_key() -> String {
    use rand_core::RngCore;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = OsRng;
    let mut parts = Vec::new();
    for _ in 0..4 {
        let mut block = String::new();
        for _ in 0..4 {
            let idx = (rng.next_u32() as usize) % CHARSET.len();
            block.push(CHARSET[idx] as char);
        }
        parts.push(block);
    }
    format!("RK-{}", parts.join("-"))
}

pub fn log_login_event(conn: &Connection, user_name: &str, event: &str) -> std::result::Result<(), String> {
    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO login_log (user_name, event, at) VALUES (?1, ?2, ?3)",
        params![user_name, event, now],
    )
    .map_err(|e| format!("Failed to record login log: {}", e))?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandPermission {
    pub name: &'static str,
    pub min_role: MinimumRole,
    pub allowed_while_locked: bool,
    pub masked_for_staff: bool,
}

pub const PERMISSION_TABLE: &[CommandPermission] = &[
    // Public / Unauthenticated commands (10)
    CommandPermission { name: "init_db_cmd", min_role: MinimumRole::Public, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_security_status_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "create_owner_initial_cmd", min_role: MinimumRole::Public, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "skip_security_setup_cmd", min_role: MinimumRole::Public, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "login_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "unlock_session_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "reset_owner_with_recovery_key_cmd", min_role: MinimumRole::Public, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_db_safety_info_cmd", min_role: MinimumRole::Public, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "acknowledge_exit_request_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "safe_exit_app_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "get_startup_health_cmd", min_role: MinimumRole::Public, allowed_while_locked: true, masked_for_staff: false },

    // Staff & Owner commands (37)
    CommandPermission { name: "get_current_user_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "logout_cmd", min_role: MinimumRole::Staff, allowed_while_locked: true, masked_for_staff: false },
    CommandPermission { name: "lock_session_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "change_own_password_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_dashboard_stats_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_7_day_trend_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_yesterday_comparison_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_top_receivables_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_low_stock_items_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_recent_entries_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_stock_list_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_available_stock_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_items_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_item_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_item_units_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_item_unit_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_godowns_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_parties_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_party_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "save_invoice_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "record_payment_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_invoice_details_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_last_rates_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_pending_bills_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_party_statement_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_party_balances_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_item_movement_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_purchase_register_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: true },
    CommandPermission { name: "get_sales_register_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_next_bill_number_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "list_printers", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_default_printer", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "print_bill", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "log_invoice_print_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_last_invoice_print_mode_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_backup_status_cmd", min_role: MinimumRole::Staff, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_settings_cmd", min_role: MinimumRole::Staff, allowed_while_locked: true, masked_for_staff: false },

    // Owner Only commands (38)
    CommandPermission { name: "preview_tally_import_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "confirm_tally_import_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "cleanup_accounting_parties_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "update_item_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "delete_item_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_ledger_entry_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "update_party_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "delete_party_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_opening_stock_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "add_stock_adjustment_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_gst_summary_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_hsn_summary_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_profit_report_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "set_settings_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "backup_now_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "list_backups_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "prepare_restore_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "check_db_integrity_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "open_backup_folder_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "pick_folder_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "test_write_folder_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "copy_backups_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_sales_gst_mode_profit_report_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_item_parties_report_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_party_items_report_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_audit_logs_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "change_sales_invoice_no_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "update_purchase_supplier_invoice_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "cancel_invoice_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "alter_sale_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "alter_purchase_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "alter_payment_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "cancel_payment_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_users_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "create_user_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "update_user_status_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "reset_user_password_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
    CommandPermission { name: "get_login_logs_cmd", min_role: MinimumRole::Owner, allowed_while_locked: false, masked_for_staff: false },
];

pub const PERMISSION_MATRIX: &[(&str, MinimumRole)] = &[
    // Public / Unauthenticated (10)
    ("init_db_cmd", MinimumRole::Public),
    ("get_security_status_cmd", MinimumRole::Public),
    ("create_owner_initial_cmd", MinimumRole::Public),
    ("skip_security_setup_cmd", MinimumRole::Public),
    ("login_cmd", MinimumRole::Public),
    ("unlock_session_cmd", MinimumRole::Public),
    ("reset_owner_with_recovery_key_cmd", MinimumRole::Public),
    ("get_db_safety_info_cmd", MinimumRole::Public),
    ("acknowledge_exit_request_cmd", MinimumRole::Public),
    ("safe_exit_app_cmd", MinimumRole::Public),
    ("get_startup_health_cmd", MinimumRole::Public),

    // Staff & Owner (37)
    ("get_current_user_cmd", MinimumRole::Staff),
    ("logout_cmd", MinimumRole::Staff),
    ("lock_session_cmd", MinimumRole::Staff),
    ("change_own_password_cmd", MinimumRole::Staff),
    ("get_dashboard_stats_cmd", MinimumRole::Staff),
    ("get_7_day_trend_cmd", MinimumRole::Staff),
    ("get_yesterday_comparison_cmd", MinimumRole::Staff),
    ("get_top_receivables_cmd", MinimumRole::Staff),
    ("get_low_stock_items_cmd", MinimumRole::Staff),
    ("get_recent_entries_cmd", MinimumRole::Staff),
    ("get_stock_list_cmd", MinimumRole::Staff),
    ("get_available_stock_cmd", MinimumRole::Staff),
    ("get_items_cmd", MinimumRole::Staff),
    ("add_item_cmd", MinimumRole::Staff),
    ("get_item_units_cmd", MinimumRole::Staff),
    ("add_item_unit_cmd", MinimumRole::Staff),
    ("get_godowns_cmd", MinimumRole::Staff),
    ("get_parties_cmd", MinimumRole::Staff),
    ("add_party_cmd", MinimumRole::Staff),
    ("save_invoice_cmd", MinimumRole::Staff),
    ("record_payment_cmd", MinimumRole::Staff),
    ("get_invoice_details_cmd", MinimumRole::Staff),
    ("get_last_rates_cmd", MinimumRole::Staff),
    ("get_pending_bills_cmd", MinimumRole::Staff),
    ("get_party_statement_cmd", MinimumRole::Staff),
    ("get_party_balances_cmd", MinimumRole::Staff),
    ("get_item_movement_cmd", MinimumRole::Staff),
    ("get_purchase_register_cmd", MinimumRole::Staff),
    ("get_sales_register_cmd", MinimumRole::Staff),
    ("get_next_bill_number_cmd", MinimumRole::Staff),
    ("list_printers", MinimumRole::Staff),
    ("get_default_printer", MinimumRole::Staff),
    ("print_bill", MinimumRole::Staff),
    ("log_invoice_print_cmd", MinimumRole::Staff),
    ("get_last_invoice_print_mode_cmd", MinimumRole::Staff),
    ("get_backup_status_cmd", MinimumRole::Staff),
    ("get_settings_cmd", MinimumRole::Staff),

    // Owner Only (38)
    ("preview_tally_import_cmd", MinimumRole::Owner),
    ("confirm_tally_import_cmd", MinimumRole::Owner),
    ("cleanup_accounting_parties_cmd", MinimumRole::Owner),
    ("update_item_cmd", MinimumRole::Owner),
    ("delete_item_cmd", MinimumRole::Owner),
    ("add_ledger_entry_cmd", MinimumRole::Owner),
    ("update_party_cmd", MinimumRole::Owner),
    ("delete_party_cmd", MinimumRole::Owner),
    ("add_opening_stock_cmd", MinimumRole::Owner),
    ("add_stock_adjustment_cmd", MinimumRole::Owner),
    ("get_gst_summary_cmd", MinimumRole::Owner),
    ("get_hsn_summary_cmd", MinimumRole::Owner),
    ("get_profit_report_cmd", MinimumRole::Owner),
    ("set_settings_cmd", MinimumRole::Owner),
    ("backup_now_cmd", MinimumRole::Owner),
    ("list_backups_cmd", MinimumRole::Owner),
    ("prepare_restore_cmd", MinimumRole::Owner),
    ("check_db_integrity_cmd", MinimumRole::Owner),
    ("open_backup_folder_cmd", MinimumRole::Owner),
    ("pick_folder_cmd", MinimumRole::Owner),
    ("test_write_folder_cmd", MinimumRole::Owner),
    ("copy_backups_cmd", MinimumRole::Owner),
    ("get_sales_gst_mode_profit_report_cmd", MinimumRole::Owner),
    ("get_item_parties_report_cmd", MinimumRole::Owner),
    ("get_party_items_report_cmd", MinimumRole::Owner),
    ("get_audit_logs_cmd", MinimumRole::Owner),
    ("change_sales_invoice_no_cmd", MinimumRole::Owner),
    ("update_purchase_supplier_invoice_cmd", MinimumRole::Owner),
    ("cancel_invoice_cmd", MinimumRole::Owner),
    ("alter_sale_cmd", MinimumRole::Owner),
    ("alter_purchase_cmd", MinimumRole::Owner),
    ("alter_payment_cmd", MinimumRole::Owner),
    ("cancel_payment_cmd", MinimumRole::Owner),
    ("get_users_cmd", MinimumRole::Owner),
    ("create_user_cmd", MinimumRole::Owner),
    ("update_user_status_cmd", MinimumRole::Owner),
    ("reset_user_password_cmd", MinimumRole::Owner),
    ("get_login_logs_cmd", MinimumRole::Owner),
];

pub fn is_command_allowed_while_locked(command: &str) -> bool {
    for perm in PERMISSION_TABLE {
        if perm.name == command {
            return perm.allowed_while_locked;
        }
    }
    false
}

pub fn is_command_masked_for_staff(command: &str) -> bool {
    for perm in PERMISSION_TABLE {
        if perm.name == command {
            return perm.masked_for_staff;
        }
    }
    false
}

pub fn get_command_explicit_role(command: &str) -> Option<MinimumRole> {
    for perm in PERMISSION_TABLE {
        if perm.name == command {
            return Some(perm.min_role);
        }
    }
    None
}

pub fn get_command_minimum_role(command: &str) -> MinimumRole {
    get_command_explicit_role(command).unwrap_or(MinimumRole::Owner)
}

pub fn check_command_permission(
    security_enabled: bool,
    session: Option<&SessionUser>,
    is_locked: bool,
    command: &str,
) -> std::result::Result<Option<SessionUser>, String> {
    check_command_permission_ext(
        security_enabled,
        session,
        is_locked,
        command,
        is_startup_corruption_detected(),
    )
}

pub fn check_command_permission_ext(
    security_enabled: bool,
    session: Option<&SessionUser>,
    is_locked: bool,
    command: &str,
    startup_corruption_detected: bool,
) -> std::result::Result<Option<SessionUser>, String> {
    if !security_enabled {
        return Ok(Some(SessionUser {
            id: 0,
            name: "व्यवस्थापक (Owner)".to_string(),
            role: "owner".to_string(),
        }));
    }

    // Special recovery path: If startup quick_check failed and there is no session,
    // allow the recovery screen commands:
    if session.is_none() && startup_corruption_detected {
        if command == "check_db_integrity_cmd"
            || command == "list_backups_cmd"
            || command == "prepare_restore_cmd"
        {
            return Ok(None);
        }
    }

    let is_allowed_locked = is_command_allowed_while_locked(command);

    if is_locked {
        if !is_allowed_locked {
            return Err("ऐप लॉक है। कृपया पहले अनलॉक करें। / App is locked. Please unlock first.".to_string());
        }
    }

    let min_role = get_command_minimum_role(command);
    if min_role == MinimumRole::Public {
        return Ok(session.cloned());
    }

    let user = match session {
        Some(u) => u,
        None => {
            if is_allowed_locked {
                return Ok(None);
            }
            return Err("कृपया पहले लॉगिन करें / Login required".to_string());
        }
    };

    match min_role {
        MinimumRole::Public | MinimumRole::Staff => Ok(Some(user.clone())),
        MinimumRole::Owner => {
            if user.role == "owner" {
                Ok(Some(user.clone()))
            } else {
                Err("Is kaam ki anumati nahi hai. / इस काम की अनुमति केवल व्यवस्थापक (Owner) को है।".to_string())
            }
        }
    }
}

pub fn get_security_status_inner(
    conn: &Connection,
    auth_state: Option<&AuthState>,
) -> std::result::Result<SecurityStatus, String> {
    let has_users: bool = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| {
            let count: i64 = r.get(0)?;
            Ok(count > 0)
        })
        .unwrap_or(false);

    let (security_enabled, auto_lock_minutes): (bool, i64) = conn
        .query_row(
            "SELECT COALESCE(security_enabled, 0), COALESCE(auto_lock_minutes, 10) FROM settings WHERE id = 1",
            [],
            |r| {
                let sec: i64 = r.get(0)?;
                let lock: i64 = r.get(1)?;
                Ok((sec != 0, lock))
            },
        )
        .unwrap_or((false, 10));

    let (current_user, is_locked) = if let Some(state) = auth_state {
        let user = state.current_user.lock().unwrap().clone();
        let locked = *state.is_locked.lock().unwrap();
        (user, locked)
    } else {
        (None, false)
    };

    Ok(SecurityStatus {
        security_enabled,
        has_users,
        auto_lock_minutes,
        current_user,
        is_locked,
    })
}

pub fn get_users_inner(conn: &Connection) -> std::result::Result<Vec<UserInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, role, is_active, failed_attempts, locked_until, created_at
             FROM users ORDER BY role ASC, name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let is_active_int: i64 = row.get(3)?;
            Ok(UserInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                role: row.get(2)?,
                is_active: is_active_int != 0,
                failed_attempts: row.get(4)?,
                locked_until: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn create_user_inner(
    conn: &Connection,
    name: &str,
    role: &str,
    password: &str,
) -> std::result::Result<UserInfo, String> {
    let trimmed_name = name.trim();
    if trimmed_name.len() < 2 {
        return Err("यूज़रनेम कम से कम 2 अक्षरों का होना चाहिए। / Username must be at least 2 characters.".to_string());
    }
    if role != "owner" && role != "staff" {
        return Err("भूमिका (Role) केवल 'owner' या 'staff' हो सकती है।".to_string());
    }
    if password.len() < 6 {
        return Err("पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / Password must be at least 6 characters.".to_string());
    }

    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM users WHERE LOWER(name) = LOWER(?1)",
            params![trimmed_name],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if existing > 0 {
        return Err(format!("'{}' नाम का यूज़र पहले से मौजूद है। / User already exists.", trimmed_name));
    }

    let password_hash = hash_password(password)?;
    let now = chrono::Local::now().to_rfc3339();

    conn.execute(
        "INSERT INTO users (name, role, password_hash, is_active, failed_attempts, locked_until, created_at)
         VALUES (?1, ?2, ?3, 1, 0, NULL, ?4)",
        params![trimmed_name, role, password_hash, now],
    )
    .map_err(|e| format!("Failed to create user: {}", e))?;

    let id = conn.last_insert_rowid();
    Ok(UserInfo {
        id,
        name: trimmed_name.to_string(),
        role: role.to_string(),
        is_active: true,
        failed_attempts: 0,
        locked_until: None,
        created_at: now,
    })
}

pub fn update_user_status_inner(
    conn: &Connection,
    user_id: i64,
    is_active: bool,
    role: &str,
) -> std::result::Result<(), String> {
    if role != "owner" && role != "staff" {
        return Err("अमान्य भूमिका / Invalid role".to_string());
    }

    let current_info: Option<(String, String, bool)> = conn
        .query_row(
            "SELECT name, role, is_active FROM users WHERE id = ?1",
            params![user_id],
            |r| {
                let name: String = r.get(0)?;
                let current_role: String = r.get(1)?;
                let active: i64 = r.get(2)?;
                Ok((name, current_role, active != 0))
            },
        )
        .ok();

    let (_name, current_role, _curr_active) = match current_info {
        Some(info) => info,
        None => return Err("यूज़र नहीं मिला / User not found".to_string()),
    };

    // Last Active Owner Protection: Cannot disable or demote the last active owner!
    if current_role == "owner" && (!is_active || role != "owner") {
        let active_owner_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if active_owner_count <= 1 {
            return Err("अंतिम सक्रिय व्यवस्थापक (Last Active Owner) को अक्षम या बदला नहीं जा सकता। / The last active Owner cannot be disabled or demoted.".to_string());
        }
    }

    conn.execute(
        "UPDATE users SET is_active = ?1, role = ?2 WHERE id = ?3",
        params![if is_active { 1 } else { 0 }, role, user_id],
    )
    .map_err(|e| format!("Failed to update user status: {}", e))?;

    Ok(())
}

pub fn reset_user_password_inner(
    conn: &Connection,
    user_id: i64,
    new_password: &str,
) -> std::result::Result<String, String> {
    if new_password.len() < 6 {
        return Err("पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / Password must be at least 6 characters.".to_string());
    }

    let user_name: String = conn
        .query_row("SELECT name FROM users WHERE id = ?1", params![user_id], |r| r.get(0))
        .map_err(|_| "यूज़र नहीं मिला / User not found".to_string())?;

    let password_hash = hash_password(new_password)?;
    conn.execute(
        "UPDATE users SET password_hash = ?1, failed_attempts = 0, locked_until = NULL WHERE id = ?2",
        params![password_hash, user_id],
    )
    .map_err(|e| format!("Failed to reset password: {}", e))?;

    let _ = log_login_event(conn, &user_name, "password_change");
    Ok(user_name)
}

pub fn change_own_password_inner(
    conn: &Connection,
    user_id: i64,
    old_password: &str,
    new_password: &str,
) -> std::result::Result<(), String> {
    if new_password.len() < 6 {
        return Err("नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / New password must be at least 6 characters.".to_string());
    }

    let (user_name, current_hash): (String, String) = conn
        .query_row(
            "SELECT name, password_hash FROM users WHERE id = ?1",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "यूज़र नहीं मिला / User not found".to_string())?;

    if !verify_password(old_password, &current_hash) {
        return Err("वर्तमान पासवर्ड गलत है। / Current password is incorrect.".to_string());
    }

    let new_hash = hash_password(new_password)?;
    conn.execute(
        "UPDATE users SET password_hash = ?1, failed_attempts = 0, locked_until = NULL WHERE id = ?2",
        params![new_hash, user_id],
    )
    .map_err(|e| format!("Failed to change password: {}", e))?;

    let _ = log_login_event(conn, &user_name, "password_change");
    Ok(())
}

pub fn verify_and_login_user(
    conn: &Connection,
    name: &str,
    password: &str,
) -> std::result::Result<SessionUser, String> {
    let trimmed = name.trim();
    let row_data: Option<(i64, String, String, String, bool, i64, Option<String>)> = conn
        .query_row(
            "SELECT id, name, role, password_hash, is_active, failed_attempts, locked_until
             FROM users WHERE LOWER(name) = LOWER(?1)",
            params![trimmed],
            |r| {
                let id: i64 = r.get(0)?;
                let uname: String = r.get(1)?;
                let role: String = r.get(2)?;
                let hash: String = r.get(3)?;
                let active_int: i64 = r.get(4)?;
                let failed: i64 = r.get(5)?;
                let locked: Option<String> = r.get(6)?;
                Ok((id, uname, role, hash, active_int != 0, failed, locked))
            },
        )
        .ok();

    let (id, uname, role, hash, is_active, mut failed_attempts, locked_until) = match row_data {
        Some(data) => data,
        None => {
            return Err("गलत यूज़रनेम या पासवर्ड। / Invalid username or password.".to_string());
        }
    };

    if !is_active {
        return Err("यह खाता निष्क्रिय (Disabled) है। कृपया व्यवस्थापक से संपर्क करें। / Account is disabled.".to_string());
    }

    let now = chrono::Local::now();

    // Check lock status
    if let Some(ref until_str) = locked_until {
        if let Ok(until_dt) = chrono::DateTime::parse_from_rfc3339(until_str) {
            let until_local = until_dt.with_timezone(&chrono::Local);
            if now < until_local {
                let remaining_secs = (until_local - now).num_seconds();
                let mins = (remaining_secs + 59) / 60;
                return Err(format!(
                    "{} गलत प्रयासों के कारण यह खाता लॉक है। कृपया {} मिनट बाद प्रयास करें। / Account is locked for {} more minute(s).",
                    MAX_FAILED_LOGIN_ATTEMPTS, mins, mins
                ));
            } else {
                // Lock expired
                failed_attempts = 0;
                let _ = conn.execute(
                    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?1",
                    params![id],
                );
            }
        }
    }

    // Verify Password
    if verify_password(password, &hash) {
        // Success
        let _ = conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?1",
            params![id],
        );
        let _ = log_login_event(conn, &uname, "login");
        Ok(SessionUser {
            id,
            name: uname,
            role,
        })
    } else {
        // Failure
        let new_failed = failed_attempts + 1;
        let _ = log_login_event(conn, &uname, "failed_attempt");

        if new_failed >= MAX_FAILED_LOGIN_ATTEMPTS {
            let lock_until = (now + chrono::Duration::minutes(LOCKOUT_DURATION_MINUTES)).to_rfc3339();
            let _ = conn.execute(
                "UPDATE users SET failed_attempts = ?1, locked_until = ?2 WHERE id = ?3",
                params![new_failed, lock_until, id],
            );
            let _ = log_login_event(conn, &uname, "lock");
            Err(format!(
                "पासवर्ड गलत है। {} गलत प्रयासों के कारण यह खाता {} मिनट के लिए लॉक कर दिया गया है। / Account locked for {} minutes due to {} failed attempts.",
                MAX_FAILED_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES, LOCKOUT_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS
            ))
        } else {
            let _ = conn.execute(
                "UPDATE users SET failed_attempts = ?1 WHERE id = ?2",
                params![new_failed, id],
            );
            let remaining = MAX_FAILED_LOGIN_ATTEMPTS - new_failed;
            Err(format!(
                "पासवर्ड गलत है। (शेष प्रयास: {}) / Incorrect password. Attempts remaining: {}.",
                remaining, remaining
            ))
        }
    }
}

pub fn reset_owner_with_recovery_key_inner(
    conn: &Connection,
    recovery_key: &str,
    new_owner_password: &str,
) -> std::result::Result<String, String> {
    if new_owner_password.len() < 6 {
        return Err("नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / Password must be at least 6 characters.".to_string());
    }

    let owner_info: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, name FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let (owner_id, owner_name) = match owner_info {
        Some(info) => info,
        None => return Err("कोई व्यवस्थापक यूज़र नहीं मिला। / No Owner found.".to_string()),
    };

    let (stored_key_hash, mut failed_attempts, locked_until): (Option<String>, i64, Option<String>) = conn
        .query_row(
            "SELECT recovery_key_hash, COALESCE(recovery_failed_attempts, 0), recovery_locked_until FROM settings WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((None, 0, None));

    let hash = match stored_key_hash {
        Some(h) if !h.trim().is_empty() => h,
        _ => return Err("कोई रिकवरी कुंजी कॉन्फ़िगर नहीं है। / No recovery key configured.".to_string()),
    };

    let now = chrono::Local::now();

    // Check rate-limit lock status (5 wrong keys -> 5 minutes lockout)
    if let Some(ref until_str) = locked_until {
        if let Ok(until_dt) = chrono::DateTime::parse_from_rfc3339(until_str) {
            let until_local = until_dt.with_timezone(&chrono::Local);
            if now < until_local {
                let remaining_secs = (until_local - now).num_seconds();
                let mins = (remaining_secs + 59) / 60;
                return Err(format!(
                    "{} गलत प्रयासों के कारण रिकवरी कुंजी लॉक है। कृपया {} मिनट बाद प्रयास करें। / Recovery key is locked for {} more minute(s).",
                    MAX_FAILED_LOGIN_ATTEMPTS, mins, mins
                ));
            } else {
                failed_attempts = 0;
                let _ = conn.execute(
                    "UPDATE settings SET recovery_failed_attempts = 0, recovery_locked_until = NULL WHERE id = 1",
                    [],
                );
            }
        }
    }

    let cleaned_entered = recovery_key.trim();
    if !verify_password(cleaned_entered, &hash) {
        let new_failed = failed_attempts + 1;
        let _ = log_login_event(conn, &owner_name, "recovery_failed_attempt");

        if new_failed >= MAX_FAILED_LOGIN_ATTEMPTS {
            let lock_until = (now + chrono::Duration::minutes(LOCKOUT_DURATION_MINUTES)).to_rfc3339();
            let _ = conn.execute(
                "UPDATE settings SET recovery_failed_attempts = ?1, recovery_locked_until = ?2 WHERE id = 1",
                params![new_failed, lock_until],
            );
            let _ = log_login_event(conn, &owner_name, "recovery_lock");
            return Err(format!(
                "रिकवरी कुंजी गलत है। {} गलत प्रयासों के कारण रिकवरी {} मिनट के लिए लॉक कर दी गई है। / Recovery key locked for {} minutes due to {} failed attempts.",
                MAX_FAILED_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MINUTES, LOCKOUT_DURATION_MINUTES, MAX_FAILED_LOGIN_ATTEMPTS
            ));
        } else {
            let _ = conn.execute(
                "UPDATE settings SET recovery_failed_attempts = ?1 WHERE id = 1",
                params![new_failed],
            );
            let remaining = MAX_FAILED_LOGIN_ATTEMPTS - new_failed;
            return Err(format!(
                "अमान्य रिकवरी कुंजी! (शेष प्रयास: {}) / Invalid recovery key. Attempts remaining: {}.",
                remaining, remaining
            ));
        }
    }

    // Success! Single-use: Old recovery key is replaced with brand new key
    let new_rec_key = generate_recovery_key();
    let new_rec_hash = hash_password(&new_rec_key)?;
    let new_pw_hash = hash_password(new_owner_password)?;

    conn.execute(
        "UPDATE settings SET recovery_key_hash = ?1, recovery_failed_attempts = 0, recovery_locked_until = NULL WHERE id = 1",
        params![new_rec_hash],
    )
    .map_err(|e| format!("Failed to update recovery key hash: {}", e))?;

    conn.execute(
        "UPDATE users SET password_hash = ?1, failed_attempts = 0, locked_until = NULL WHERE id = ?2",
        params![new_pw_hash, owner_id],
    )
    .map_err(|e| format!("Failed to update owner password: {}", e))?;

    let _ = log_login_event(conn, &owner_name, "recovery_use");

    Ok(new_rec_key)
}

// ============================================================================
// STAFF AND SUPPLIER DATA ACCESS POLICY
// Default policy: Staff may view customer balances & statements, but supplier
// financial details (balances, statements, pending supplier bills, purchase rates)
// and outward supplier payments are restricted to Owner.
// ============================================================================

pub fn is_supplier_party_type(party_type: &str) -> bool {
    let t = party_type.trim().to_lowercase();
    t == "supplier" || t == "सप्लायर" || t == "vendor"
}

pub fn can_role_access_party_statement(role: &str, party_type: &str) -> bool {
    if role == "owner" {
        return true;
    }
    !is_supplier_party_type(party_type)
}

pub fn can_role_access_pending_bills(role: &str, party_type: &str) -> bool {
    if role == "owner" {
        return true;
    }
    !is_supplier_party_type(party_type)
}

pub fn can_role_record_payment(role: &str, payment_type: &str) -> bool {
    if role == "owner" {
        return true;
    }
    let p = payment_type.trim().to_lowercase();
    p != "payment"
}

pub fn should_mask_supplier_data_for_role(role: &str) -> bool {
    role != "owner"
}

pub fn get_login_logs_inner(conn: &Connection, limit: Option<i64>) -> std::result::Result<Vec<LoginLogEntry>, String> {
    let lim = limit.unwrap_or(200);
    let mut stmt = conn
        .prepare("SELECT id, user_name, event, at FROM login_log ORDER BY id DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![lim], |row| {
            Ok(LoginLogEntry {
                id: row.get(0)?,
                user_name: row.get(1)?,
                event: row.get(2)?,
                at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}
