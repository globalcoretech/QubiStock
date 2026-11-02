// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod db;
pub mod audit;
pub mod auth;
mod inventory;
mod tally_import;
mod invoice;
mod commands;
mod printer;
pub mod backup;

#[cfg(test)]
mod tests;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            app.manage(auth::AuthState::default());
            let data_dir = app.path().app_data_dir().unwrap_or_default();
            let db_path = data_dir.join("inventory.db");
            let _ = backup::check_and_apply_pending_restore(&db_path.to_string_lossy());

            // Daily first-launch backup check
            let handle_launch = app.handle().clone();
            let db_path_clone = db_path.clone();
            std::thread::spawn(move || {
                if let Ok(conn) = rusqlite::Connection::open(&db_path_clone) {
                    let _ = db::configure_connection(&conn);
                    let last_time: Option<String> = conn
                        .query_row("SELECT last_backup_time FROM settings WHERE id = 1", [], |r| r.get(0))
                        .unwrap_or(None);
                    let should_daily_backup = match last_time {
                        None => true,
                        Some(t) => {
                            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&t) {
                                let today = chrono::Local::now().date_naive();
                                parsed.with_timezone(&chrono::Local).date_naive() < today
                            } else {
                                true
                            }
                        }
                    };
                    if should_daily_backup {
                        let _ = backup::auto_backup(&handle_launch, "daily first launch");
                    }
                }
            });

            // 30-minute background auto-backup timer
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(30 * 60));
                    let _ = backup::auto_backup(&handle, "30-minute interval");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Emitter;
                api.prevent_close();
                crate::commands::EXIT_REQUEST_ACKNOWLEDGED.store(false, std::sync::atomic::Ordering::SeqCst);
                let _ = window.emit("request-app-exit", ());

                // Safe-exit fallback: if the close-request listener cannot be registered or frontend does not answer within 3 seconds,
                // Rust must NOT leave the window stuck: run PRAGMA wal_checkpoint(TRUNCATE), try verified backup (5s limit), and exit.
                let app_handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !crate::commands::EXIT_REQUEST_ACKNOWLEDGED.load(std::sync::atomic::Ordering::SeqCst) {
                        eprintln!("[Krishi Kendra] Frontend did not answer CloseRequested within 3s; executing safe-exit fallback...");
                        if let Ok(conn) = crate::commands::get_conn(&app_handle) {
                            let _ = crate::commands::safe_exit_fallback_helper(Some(&conn), Some(&app_handle));
                        } else {
                            let _ = crate::commands::safe_exit_fallback_helper(None, Some(&app_handle));
                        }
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_db_cmd,
            commands::preview_tally_import_cmd,
            commands::confirm_tally_import_cmd,
            commands::cleanup_accounting_parties_cmd,
            commands::get_stock_list_cmd,
            commands::get_items_cmd,
            commands::add_item_cmd,
            commands::update_item_cmd,
            commands::delete_item_cmd,
            commands::get_item_units_cmd,
            commands::add_item_unit_cmd,
            commands::add_ledger_entry_cmd,
            commands::get_godowns_cmd,
            commands::get_parties_cmd,
            commands::add_party_cmd,
            commands::update_party_cmd,
            commands::delete_party_cmd,
            commands::save_invoice_cmd,
            commands::get_item_movement_cmd,
            commands::get_party_balances_cmd,
            commands::get_available_stock_cmd,
            commands::add_opening_stock_cmd,
            commands::add_stock_adjustment_cmd,
            commands::get_last_rates_cmd,
            commands::get_dashboard_stats_cmd,
            commands::get_recent_entries_cmd,
            commands::get_invoice_details_cmd,
            commands::get_purchase_register_cmd,
            commands::get_sales_register_cmd,
            commands::get_gst_summary_cmd,
            commands::get_hsn_summary_cmd,
            commands::get_profit_report_cmd,
            commands::record_payment_cmd,
            commands::get_pending_bills_cmd,
            commands::get_party_statement_cmd,
            commands::get_7_day_trend_cmd,
            commands::get_yesterday_comparison_cmd,
            commands::get_top_receivables_cmd,
            commands::get_low_stock_items_cmd,
            commands::list_printers,
            commands::get_default_printer,
            commands::print_bill,
            commands::get_settings_cmd,
            commands::set_settings_cmd,
            commands::get_next_bill_number_cmd,
            commands::log_invoice_print_cmd,
            commands::get_last_invoice_print_mode_cmd,
            commands::backup_now_cmd,
            commands::list_backups_cmd,
            commands::prepare_restore_cmd,
            commands::check_db_integrity_cmd,
            commands::open_backup_folder_cmd,
            commands::get_backup_status_cmd,
            commands::pick_folder_cmd,
            commands::test_write_folder_cmd,
            commands::copy_backups_cmd,
            commands::get_sales_gst_mode_profit_report_cmd,
            commands::get_item_parties_report_cmd,
            commands::get_party_items_report_cmd,
            commands::get_audit_logs_cmd,
            commands::change_sales_invoice_no_cmd,
            commands::update_purchase_supplier_invoice_cmd,
            commands::cancel_invoice_cmd,
            commands::alter_sale_cmd,
            commands::alter_purchase_cmd,
            commands::alter_payment_cmd,
            commands::cancel_payment_cmd,
            commands::get_db_safety_info_cmd,
            commands::graceful_exit_cmd,
            commands::get_security_status_cmd,
            commands::create_owner_initial_cmd,
            commands::skip_security_setup_cmd,
            commands::login_cmd,
            commands::logout_cmd,
            commands::lock_session_cmd,
            commands::unlock_session_cmd,
            commands::get_current_user_cmd,
            commands::reset_owner_with_recovery_key_cmd,
            commands::get_users_cmd,
            commands::create_user_cmd,
            commands::update_user_status_cmd,
            commands::reset_user_password_cmd,
            commands::change_own_password_cmd,
            commands::get_login_logs_cmd,
            commands::acknowledge_exit_request_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
