// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod inventory;
mod tally_import;
mod invoice;
mod commands;

#[cfg(test)]
mod tests;

fn main() {
    // Database initialization will happen here in production
    // let db_conn = db::init_db("inventory.db").expect("Failed to initialize DB");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::init_db_cmd,
            commands::preview_tally_import_cmd,
            commands::confirm_tally_import_cmd,
            commands::cleanup_accounting_parties_cmd,
            commands::get_stock_list_cmd,
            commands::get_items_cmd,
            commands::add_item_cmd,
            commands::add_item_unit_cmd,
            commands::add_ledger_entry_cmd,
            commands::get_godowns_cmd,
            commands::get_parties_cmd,
            commands::add_party_cmd,
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
            commands::get_low_stock_items_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
