// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod db;
pub mod audit;
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let data_dir = app.path().app_data_dir().unwrap_or_default();
            let db_path = data_dir.join("inventory.db");
            let _ = backup::check_and_apply_pending_restore(&db_path.to_string_lossy());

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
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = backup::auto_backup(window.app_handle(), "app close");
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
            commands::alter_payment_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
