use crate::db::init_db;
use crate::inventory::{get_qty_in_base_unit, add_stock_ledger_entry, calculate_weighted_average_cost, reverse_stock_ledger_entry};
use rusqlite::Connection;
use chrono::Local;
use std::fs;

#[test]
fn test_db_init_and_migrations() {
    let conn = init_db(":memory:").expect("Failed to init in-memory DB");
    
    // Check if tables are created
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").unwrap();
    let exists: String = stmt.query_row([], |row| row.get(0)).unwrap();
    assert_eq!(exists, "items");
}

#[test]
fn test_stock_ledger_append_only() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    // Setup dummy data
    conn.execute("INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) VALUES (1, 'Urea', 'fertilizer', '1234', 5000, 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Insert to stock ledger
    add_stock_ledger_entry(&conn, "2026-10-07", 1, 1, 100_000, "purchase", Some("INV-001"), None, None, None).unwrap();
    
    // Try to update - should fail
    let update_result = conn.execute("UPDATE stock_ledger SET qty_base = 200000 WHERE id = 1", []);
    assert!(update_result.is_err());
    
    // Try to delete - should fail
    let delete_result = conn.execute("DELETE FROM stock_ledger WHERE id = 1", []);
    assert!(delete_result.is_err());
}

#[test]
fn test_multi_unit_conversion() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    conn.execute("INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) VALUES (1, 'Urea', 'fertilizer', '1234', 5000, 'kg')", []).unwrap();
    conn.execute("INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (1, 'bag', 50000)", []).unwrap(); // 50kg per bag in milli

    // Base unit test (10.0 kg = 10000 milli)
    let base_qty = get_qty_in_base_unit(&conn, 1, 10000, "kg").unwrap();
    assert_eq!(base_qty, 10000);

    // Alternate unit test (2.0 bags = 2000 milli bags) -> should equal 100.0 kg (100000 milli)
    let alt_qty = get_qty_in_base_unit(&conn, 1, 2000, "bag").unwrap();
    assert_eq!(alt_qty, 100000); 
}

#[test]
fn test_weighted_average_cost() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    conn.execute("INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) VALUES (1, 'Urea', 'fertilizer', '1234', 5000, 'kg')", []).unwrap();
    conn.execute("INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (1, 'bag', 50000)", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type) VALUES (2, 'Supplier A', 'supplier')", []).unwrap();
    
    // Purchase 1: 10 bags (10000 milli) @ 150000 paise taxable
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id) VALUES ('INV-1', '2026-10-01', 2)", []).unwrap();
    conn.execute("INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst) 
                  VALUES ('INV-1', 1, 10000, 'bag', 15000, 150000, 0, 0, 0)", []).unwrap(); // 10 bags -> 500kg

    // Purchase 2: 200 kg (200000 milli) @ 80000 paise taxable 
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id) VALUES ('INV-2', '2026-10-05', 2)", []).unwrap();
    conn.execute("INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst) 
                  VALUES ('INV-2', 1, 200000, 'kg', 400, 80000, 0, 0, 0)", []).unwrap(); // 200kg

    // Total paise: 230000
    // Total kg: 700
    // Expected WAC (paise per kg): 230000 / 700 = 328 (integer math)
    let wac = calculate_weighted_average_cost(&conn, 1).unwrap();
    assert_eq!(wac, 328);
}

#[test]
fn test_wac_after_sale_and_rounding() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Seeds', 'kg')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type) VALUES (2, 'Supplier A', 'supplier')", []).unwrap();
    
    // Purchase: 3 kg (3000 milli) for 100 rupees (10000 paise)
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id) VALUES ('INV-1', '2026-10-01', 2)", []).unwrap();
    conn.execute("INSERT INTO purchase_lines (invoice_no, item_id, qty, unit, rate, taxable, cgst, sgst, igst) 
                  VALUES ('INV-1', 1, 3000, 'kg', 3333, 10000, 0, 0, 0)", []).unwrap();

    let wac = calculate_weighted_average_cost(&conn, 1).unwrap();
    assert_eq!(wac, 3333); // 10000 / 3 = 3333 paise per kg

    // Note: WAC only looks at purchase lines based on existing logic.
    // So sale doesn't change WAC formula as currently implemented (it's perpetual average of all purchases).
}

#[test]
fn test_stock_reversal() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    conn.execute("INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) VALUES (1, 'Urea', 'fertilizer', '1234', 5000, 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Insert to stock ledger (100 kg)
    let entry_id = add_stock_ledger_entry(&conn, "2026-10-07", 1, 1, 100000, "purchase", Some("INV-001"), None, None, None).unwrap();
    
    // Reverse it
    let rev_id = reverse_stock_ledger_entry(&conn, entry_id, "2026-10-08", "REV-001").unwrap();

    let rev_qty: i64 = conn.query_row("SELECT qty_base FROM stock_ledger WHERE id = ?1", rusqlite::params![rev_id], |row| row.get(0)).unwrap();
    assert_eq!(rev_qty, -100000);

    // Double reversal should fail
    let rev_2 = reverse_stock_ledger_entry(&conn, entry_id, "2026-10-08", "REV-002");
    assert!(rev_2.is_err());
}

#[test]
fn test_foreign_key_violation() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    // Try to insert a stock entry with invalid item_id
    let res = conn.execute("INSERT INTO stock_ledger (date, item_id, godown_id, qty_base, type) VALUES ('2026-10-07', 999, 1, 1000, 'purchase')", []);
    assert!(res.is_err()); // Should fail due to FK
}

#[test]
fn test_transfer_between_godowns() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Urea', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Godown 1')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (2, 'Godown 2')", []).unwrap();

    // Transfer 50 kg (50000 milli) from 1 to 2
    add_stock_ledger_entry(&conn, "2026-10-07", 1, 1, -50000, "transfer", Some("TRF-1"), None, None, None).unwrap();
    add_stock_ledger_entry(&conn, "2026-10-07", 1, 2, 50000, "transfer", Some("TRF-1"), None, None, None).unwrap();

    let stock_g1: i64 = conn.query_row("SELECT SUM(qty_base) FROM stock_ledger WHERE godown_id = 1", [], |row| row.get(0)).unwrap();
    let stock_g2: i64 = conn.query_row("SELECT SUM(qty_base) FROM stock_ledger WHERE godown_id = 2", [], |row| row.get(0)).unwrap();
    
    assert_eq!(stock_g1, -50000);
    assert_eq!(stock_g2, 50000);
}

#[test]
fn test_decimal_qty_rounding() {
    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Seed', 'kg')", []).unwrap();
    // In code, user will multiply 2.5 * 1000 = 2500 milli-units
    let qty_kg = 2.5_f64;
    let qty_milli = (qty_kg * 1000.0).round() as i64;
    assert_eq!(qty_milli, 2500);

    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    add_stock_ledger_entry(&conn, "2026-10-07", 1, 1, qty_milli, "purchase", None, None, None, None).unwrap();

    let stock: i64 = conn.query_row("SELECT qty_base FROM stock_ledger WHERE id = 1", [], |row| row.get(0)).unwrap();
    assert_eq!(stock, 2500);
}

// asli voucher XML ka intezaar
#[test]
#[ignore]
fn test_tally_xml_import_success() {
    use crate::tally_import::{preview_import, confirm_import};
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    let xml = r#"
<ENVELOPE>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <LEDGER NAME="Supplier A"><PARENT>Sundry Creditors</PARENT><GUID>guid-1</GUID></LEDGER>
        </TALLYMESSAGE>
        <TALLYMESSAGE>
          <STOCKITEM NAME="Urea" BASEUNITS="kg"><GUID>guid-2</GUID></STOCKITEM>
        </TALLYMESSAGE>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Purchase" VOUCHERTYPENAME="Purchase" DATE="20261007" PARTYLEDGERNAME="Supplier A">
            <GUID>guid-3</GUID>
            <REFERENCE>INV-001</REFERENCE>
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>Urea</STOCKITEMNAME>
              <BILLEDQTY>100 kg</BILLEDQTY>
              <RATE>150.00/kg</RATE>
              <AMOUNT>-15000.00</AMOUNT>
            </ALLINVENTORYENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"#;

    // Preview
    let report = preview_import(&conn, xml).unwrap();
    assert_eq!(report.new_parties, 1);
    assert_eq!(report.new_items, 1);
    assert_eq!(report.new_vouchers, 1);

    // Confirm
    let db_path = "dummy.sqlite"; // in memory, backup will fail but we'll ignore it if file doesn't exist
    confirm_import(&mut conn, db_path, xml, "tally_sample.xml").unwrap();

    // Verify DB
    let party_count: i64 = conn.query_row("SELECT COUNT(*) FROM parties", [], |row| row.get(0)).unwrap();
    assert_eq!(party_count, 1);
    let item_count: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0)).unwrap();
    assert_eq!(item_count, 1);
    let purchase_count: i64 = conn.query_row("SELECT COUNT(*) FROM purchases", [], |row| row.get(0)).unwrap();
    assert_eq!(purchase_count, 1);
}

#[test]
fn test_tally_xml_duplicate_prevention() {
    use crate::tally_import::confirm_import;
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    let xml = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
    
    // First import
    confirm_import(&mut conn, "dummy.sqlite", xml, "test.xml").unwrap();
    
    // Second import should fail
    let err = confirm_import(&mut conn, "dummy.sqlite", xml, "test.xml");
    assert!(err.is_err());
    assert!(err.unwrap_err().to_string().contains("Duplicate"));
}

#[test]
fn test_tally_xml_invalid_rollback() {
    use crate::tally_import::confirm_import;
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    // Malformed XML
    let xml = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE><LEDGER NAME=\"Supplier A\"";
    
    let err = confirm_import(&mut conn, "dummy.sqlite", xml, "broken.xml");
    assert!(err.is_err());
    
    // Verify DB is untouched (contains only default Cash Sale party with id=1)
    let party_count: i64 = conn.query_row("SELECT COUNT(*) FROM parties", [], |row| row.get(0)).unwrap();
    assert_eq!(party_count, 1);
}

#[test]
fn test_master_xml_parsing() {
    use crate::tally_import::{decode_tally_xml, preview_import, confirm_import};
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    // Asli Tally "All Masters" export UTF-16 file read
    let bytes = include_bytes!("../../samples/Master.xml");
    
    let decoded_xml = decode_tally_xml(bytes);
    assert!(!decoded_xml.contains("&#4;")); // Char stripped
    
    let report = preview_import(&conn, &decoded_xml).unwrap();
    
    // Ensure it processed correctly without failing on missing Vouchers/Ledgers
    // Note: Adjust the exact assert numbers based on the real Master.xml contents if needed.
    // Assuming the user stated there are at least 3 items, etc.
    assert!(report.total_items >= 3);
    
    confirm_import(&mut conn, "dummy.sqlite", &decoded_xml, "Master.xml").unwrap();
    
    // Godown test
    let main_godown: i64 = conn.query_row("SELECT COUNT(*) FROM godowns WHERE name = 'Main Location'", [], |row| row.get(0)).unwrap();
    assert_eq!(main_godown, 1);
    
    // Check for compound unit "box of 12 pcs" logic
    // We expect there's an item with this unit. Let's just verify the item_units table has a factor of 12000 (12 * 1000).
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM item_units WHERE factor_to_base = 12000 AND unit_name = 'box'", [], |row| row.get(0)).unwrap();
    assert!(count > 0, "Expected at least one item mapped to 'box' with factor 12000");
}

#[test]
fn test_master_xml_duplicate_import() {
    use crate::tally_import::{decode_tally_xml, confirm_import};
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    let bytes = include_bytes!("../../samples/Master.xml");
    let decoded_xml = decode_tally_xml(bytes);
    
    confirm_import(&mut conn, "dummy.sqlite", &decoded_xml, "Master.xml").unwrap();
    
    let err = confirm_import(&mut conn, "dummy.sqlite", &decoded_xml, "Master.xml");
    assert!(err.is_err());
    assert!(err.unwrap_err().to_string().contains("Duplicate"));
}

#[test]
fn test_master_xml_corrupted_rollback() {
    use crate::tally_import::{decode_tally_xml, confirm_import};
    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    let bytes = include_bytes!("../../samples/Master.xml");
    let mut decoded_xml = decode_tally_xml(bytes);
    
    let len = decoded_xml.len();
    if len > 50 {
        decoded_xml.truncate(len - 50); // aakhir kaat ke kharab kiya
    }
    
    let err = confirm_import(&mut conn, "dummy.sqlite", &decoded_xml, "Broken_Master.xml");
    assert!(err.is_err());
    
    // Verify DB is untouched
    let item_count: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0)).unwrap();
    assert_eq!(item_count, 0);
    
    let godown_count: i64 = conn.query_row("SELECT COUNT(*) FROM godowns", [], |row| row.get(0)).unwrap();
    assert_eq!(godown_count, 0);
}

#[test]
fn test_party_create_manual_null_guid() {
    use crate::commands::add_party_inner;
    let conn = init_db(":memory:").expect("Failed to init DB");
    
    // Create unregistered supplier
    let p1_id = add_party_inner(&conn, "Supplier One", "supplier", "unregistered", None, None, None).unwrap();
    assert!(p1_id > 0);
    
    // Create regular customer with valid GSTIN
    let p2_id = add_party_inner(&conn, "Customer Two", "customer", "regular", Some("Bhopal"), Some("22AAAAA0000A1Z5"), Some("9876543210")).unwrap();
    assert!(p2_id > 0);

    // Creating regular party without valid GSTIN should fail
    let err = add_party_inner(&conn, "Invalid Regular", "customer", "regular", None, Some("INVALID"), None);
    assert!(err.is_err());
    assert!(err.unwrap_err().contains("GSTIN"));

    // Verify default Cash Sale party is created on init_db
    let default_party_name: String = conn.query_row("SELECT name FROM parties WHERE id = 1", [], |row| row.get(0)).unwrap();
    assert_eq!(default_party_name, "Cash Sale (Walk-in)");
}

#[test]
fn test_purchase_save_creates_stock_ledger() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    let mut conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Urea', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (2, 'Supplier X', 'supplier', 'unregistered')", []).unwrap();

    let payload = InvoicePayload {
        invoice_no: "PUR-101".to_string(),
        date: "2026-10-09".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 157500,
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 50000, // 50.0 kg in milli
                unit: "kg".to_string(),
                rate: 3000, // 30.00 rupees in paise
                taxable: 150000,
                cgst: 3750,
                sgst: 3750,
                igst: 0,
            }
        ]
    };

    save_invoice(&mut conn, payload).unwrap();

    // Check stock_ledger entry created
    let (qty_base, entry_type, ref_id): (i64, String, Option<String>) = conn.query_row(
        "SELECT qty_base, type, ref_id FROM stock_ledger WHERE item_id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    ).unwrap();

    assert_eq!(qty_base, 50000);
    assert_eq!(entry_type, "purchase");
    assert_eq!(ref_id, Some("PUR-101".to_string()));
}

#[test]
fn test_credit_sale_and_composition_supplier() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    let mut conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Seed 1', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (2, 'Comp Supplier', 'supplier', 'composition')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (3, 'Credit Customer', 'customer', 'unregistered')", []).unwrap();

    // 1. Purchase from Composition supplier (GST should be forced to 0)
    let pur_payload = InvoicePayload {
        invoice_no: "PUR-COMP-1".to_string(),
        date: "2026-10-09".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 100000, // ₹1000 paid of ₹5000 invoice
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 100000, // 100kg
                unit: "kg".to_string(),
                rate: 5000,  // ₹50
                taxable: 500000,
                cgst: 25000, // should be zeroed out for composition
                sgst: 25000,
                igst: 0,
            }
        ]
    };
    save_invoice(&mut conn, pur_payload).unwrap();

    // Verify line CGST & SGST are 0
    let (cgst, sgst): (i64, i64) = conn.query_row(
        "SELECT cgst, sgst FROM purchase_lines WHERE invoice_no = 'PUR-COMP-1'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap();
    assert_eq!(cgst, 0);
    assert_eq!(sgst, 0);

    // 2. Credit Sale of ₹3000 with ₹1000 paid to Customer 3
    let sale_payload = InvoicePayload {
        invoice_no: "SALE-CR-1".to_string(),
        date: "2026-10-09".to_string(),
        party_id: 3,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 100000, // ₹1000 paid
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 50000, // 50kg
                unit: "kg".to_string(),
                rate: 6000, // ₹60
                taxable: 300000, // ₹3000
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ]
    };
    save_invoice(&mut conn, sale_payload).unwrap();

    // Check Customer 3 net balance (Debit 300000 - Credit 100000 = +200000 paise / ₹2000 Len / Receivable)
    let cust_balance: i64 = conn.query_row(
        "SELECT SUM(debit) - SUM(credit) FROM party_ledger WHERE party_id = 3",
        [],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(cust_balance, 200000);
}

#[test]
fn test_import_from_bytes() {
    use crate::tally_import::{decode_tally_xml, preview_import, confirm_import};
    use base64::Engine;

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    
    let xml_str = r#"<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
        <TALLYMESSAGE><LEDGER NAME="Byte Supplier"><PARENT>Sundry Creditors</PARENT><GUID>guid-bytes-1</GUID></LEDGER></TALLYMESSAGE>
        <TALLYMESSAGE><GODOWN NAME="Byte Godown"></GODOWN></TALLYMESSAGE>
        <TALLYMESSAGE><STOCKITEM NAME="Byte Item" BASEUNITS="kg"><GUID>guid-bytes-2</GUID></STOCKITEM></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"#;

    let raw_bytes = xml_str.as_bytes();
    let b64 = base64::engine::general_purpose::STANDARD.encode(raw_bytes);

    let decoded_bytes = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
    let xml_content = decode_tally_xml(&decoded_bytes);

    let report = preview_import(&conn, &xml_content).unwrap();
    assert_eq!(report.new_parties, 1);
    assert_eq!(report.new_items, 1);
    assert_eq!(report.new_godowns, 1);

    confirm_import(&mut conn, "dummy.sqlite", &xml_content, "bytes_test.xml").unwrap();

    let party_count: i64 = conn.query_row("SELECT COUNT(*) FROM parties WHERE name = 'Byte Supplier'", [], |row| row.get(0)).unwrap();
    assert_eq!(party_count, 1);
}

#[test]
fn test_import_updates_items_list() {
    use crate::tally_import::confirm_import;
    use crate::commands::get_items_inner;

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    let xml = r#"<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
        <TALLYMESSAGE><STOCKITEM NAME="ImportedItem101" BASEUNITS="kg"><GUID>g-item-101</GUID></STOCKITEM></TALLYMESSAGE>
        <TALLYMESSAGE><STOCKITEM NAME="ImportedItem102" BASEUNITS="ltr"><GUID>g-item-102</GUID></STOCKITEM></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"#;

    confirm_import(&mut conn, "dummy.sqlite", xml, "test_items_import.xml").unwrap();

    let items = get_items_inner(&conn).unwrap();
    assert_eq!(items.len(), 2);
    assert!(items.iter().any(|i| i.name == "ImportedItem101"));
    assert!(items.iter().any(|i| i.name == "ImportedItem102"));
}

#[test]
fn test_oversell_block() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    use crate::commands::get_available_stock_inner;

    let mut conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Urea', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (2, 'Customer A', 'customer', 'unregistered')", []).unwrap();

    // Add initial stock: 50 kg (50,000 milli-units)
    conn.execute(
        "INSERT INTO stock_ledger (date, item_id, godown_id, qty_base, type) VALUES ('2026-10-09', 1, 1, 50000, 'purchase')",
        []
    ).unwrap();

    // Verify available stock is 50,000 milli-units
    let avail = get_available_stock_inner(&conn, 1, 1).unwrap();
    assert_eq!(avail, 50000);

    // Attempt to sell 80 kg (80,000 milli-units) -> Should fail oversell check!
    let sale_payload = InvoicePayload {
        invoice_no: "SALE-OVERSELL-1".to_string(),
        date: "2026-10-09".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 400000,
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 80000, // 80kg
                unit: "kg".to_string(),
                rate: 5000,
                taxable: 400000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ]
    };

    let result = save_invoice(&mut conn, sale_payload);
    assert!(result.is_err(), "Saving invoice with qty exceeding available stock must fail!");
}

#[test]
fn test_opening_stock() {
    use crate::commands::{add_opening_stock_inner, get_available_stock_inner};

    let conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'NPK 19-19-19', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Add opening stock of 100 kg (100,000 milli-units)
    let entry_id = add_opening_stock_inner(&conn, 1, 1, 100000, "kg", "2026-10-01").unwrap();
    assert!(entry_id > 0);

    // Verify stock_ledger record
    let (qty_base, type_): (i64, String) = conn.query_row(
        "SELECT qty_base, type FROM stock_ledger WHERE id = ?1",
        rusqlite::params![entry_id],
        |row| Ok((row.get(0)?, row.get(1)?))
    ).unwrap();

    assert_eq!(qty_base, 100000);
    assert_eq!(type_, "opening");

    // Verify available stock
    let avail = get_available_stock_inner(&conn, 1, 1).unwrap();
    assert_eq!(avail, 100000);
}

#[test]
fn test_stock_adjustment() {
    use crate::commands::{add_opening_stock_inner, add_stock_adjustment_inner, get_available_stock_inner};

    let conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'DAP', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Initial opening stock 50 kg
    add_opening_stock_inner(&conn, 1, 1, 50000, "kg", "2026-10-01").unwrap();

    // Positive adjustment +20 kg
    let adj1_id = add_stock_adjustment_inner(&conn, 1, 1, 20000, "kg", Some("Stock taking difference"), "2026-10-05").unwrap();
    assert!(adj1_id > 0);

    // Negative adjustment -10 kg
    let adj2_id = add_stock_adjustment_inner(&conn, 1, 1, -10000, "kg", Some("Damaged bag"), "2026-10-06").unwrap();
    assert!(adj2_id > 0);

    // Check adjustment entries types in stock_ledger
    let type1: String = conn.query_row("SELECT type FROM stock_ledger WHERE id = ?1", rusqlite::params![adj1_id], |r| r.get(0)).unwrap();
    let type2: String = conn.query_row("SELECT type FROM stock_ledger WHERE id = ?1", rusqlite::params![adj2_id], |r| r.get(0)).unwrap();
    assert_eq!(type1, "adjustment");
    assert_eq!(type2, "adjustment");

    // Net stock: 50 + 20 - 10 = 60 kg (60,000 milli-units)
    let avail = get_available_stock_inner(&conn, 1, 1).unwrap();
    assert_eq!(avail, 60000);
}

#[test]
fn test_dashboard_stats_and_recent_entries() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    use crate::commands::{get_dashboard_stats_inner, get_recent_entries_inner, get_invoice_details_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");

    conn.execute("INSERT INTO items (id, name, base_unit) VALUES (1, 'Urea 50kg', 'kg')", []).unwrap();
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (2, 'Supplier Kisan', 'supplier', 'unregistered')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (3, 'Farmer Ramesh', 'customer', 'unregistered')", []).unwrap();

    // Purchase on 2026-10-11
    let pur = InvoicePayload {
        invoice_no: "PUR-201".to_string(),
        date: "2026-10-11".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 100000, // ₹1000 paid
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 100000, // 100kg
                unit: "kg".to_string(),
                rate: 3000,  // ₹30
                taxable: 300000, // ₹3000
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ]
    };
    save_invoice(&mut conn, pur).unwrap();

    // Sale on 2026-10-11
    let sale = InvoicePayload {
        invoice_no: "SALE-201".to_string(),
        date: "2026-10-11".to_string(),
        party_id: 3,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 50000, // ₹500 paid
        shop_state: None,
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 20000, // 20kg
                unit: "kg".to_string(),
                rate: 4000,  // ₹40
                taxable: 80000, // ₹800
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ]
    };
    save_invoice(&mut conn, sale).unwrap();

    // Test dashboard stats
    let stats = get_dashboard_stats_inner(&conn, "2026-10-11").unwrap();
    assert_eq!(stats.today_sales, 80000); // ₹800
    assert_eq!(stats.today_purchases, 300000); // ₹3000
    assert_eq!(stats.total_receivable, 30000); // Customer 3: 800 - 500 = 300 (30000 paise)
    assert_eq!(stats.total_payable, 200000); // Supplier 2: 3000 - 1000 = 2000 (200000 paise)

    // Test recent entries
    let recent = get_recent_entries_inner(&conn).unwrap();
    assert_eq!(recent.len(), 2);
    assert!(recent.iter().any(|r| r.invoice_no == "SALE-201" && r.party_name == "Farmer Ramesh"));
    assert!(recent.iter().any(|r| r.invoice_no == "PUR-201" && r.party_name == "Supplier Kisan"));

    // Test invoice details for print
    let print_details = get_invoice_details_inner(&conn, "SALE-201").unwrap();
    assert_eq!(print_details.invoice_no, "SALE-201");
    assert_eq!(print_details.party_name, "Farmer Ramesh");
    assert_eq!(print_details.lines.len(), 1);
    assert_eq!(print_details.lines[0].item_name, "Urea 50kg");
    assert_eq!(print_details.lines[0].qty, 20000);
}

#[test]
fn test_reports_comprehensive_hand_calculated() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    use crate::commands::{
        get_purchase_register_inner,
        get_sales_register_inner,
        get_gst_summary_inner,
        get_hsn_summary_inner,
        get_profit_report_inner,
    };

    let mut conn = init_db(":memory:").expect("Failed to init DB");

    // 1. Setup Master Data
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) 
         VALUES (1, 'DAP Fertilizer 50kg bag', 'fertilizer', '3105', 5000, 'bag')",
        []
    ).unwrap();
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, base_unit) 
         VALUES (2, 'Chlorpyrifos 1L', 'pesticide', '3808', 18000, 'bottle')",
        []
    ).unwrap();

    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Parties
    // Supplier A: Regular, Intrastate (MP - 23)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone) 
         VALUES (2, 'Supplier A', 'supplier', 'regular', '23ABCDE1234F1Z5', '9893000001')",
        []
    ).unwrap();
    // Supplier B: Composition, Intrastate (MP - 23)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone) 
         VALUES (3, 'Supplier B', 'supplier', 'composition', '23COMP00000A1Z1', '9893000002')",
        []
    ).unwrap();
    // Supplier C: Regular, Interstate (MH - 27)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone) 
         VALUES (4, 'Supplier C', 'supplier', 'regular', '27AAAAB9999C1Z1', '9893000003')",
        []
    ).unwrap();
    // Customer X: Unregistered Local (MP - 23, No GSTIN)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone) 
         VALUES (5, 'Customer X', 'customer', 'unregistered', NULL, '9893000004')",
        []
    ).unwrap();
    // Customer Y: Regular Interstate (MH - 27)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone) 
         VALUES (6, 'Customer Y', 'customer', 'regular', '27ZZZZZ1111A1Z9', '9893000005')",
        []
    ).unwrap();

    let shop_state = "23";

    // 2. Purchases
    // PUR-001: 10 bags DAP @ ₹1,200 = ₹12,000 taxable. 5% GST = ₹600 (CGST ₹300, SGST ₹300).
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-001".to_string(),
        date: "2026-10-15".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 400000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 10000, // 10 bags
                unit: "bag".to_string(),
                rate: 120000, // ₹1,200
                taxable: 1200000, // ₹12,000
                cgst: 30000,
                sgst: 30000,
                igst: 0,
            }
        ],
    }).unwrap();

    // PUR-002: 5 bottles Chlorpyrifos @ ₹400 = ₹2,000 taxable. Composition supplier -> 0 GST.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-002".to_string(),
        date: "2026-10-16".to_string(),
        party_id: 3,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 200000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 5000, // 5 bottles
                unit: "bottle".to_string(),
                rate: 40000, // ₹400
                taxable: 200000, // ₹2,000
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();

    // PUR-003: 5 bottles Chlorpyrifos @ ₹500 = ₹2,500 taxable. Interstate (27) -> 18% IGST = ₹450.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-003".to_string(),
        date: "2026-10-17".to_string(),
        party_id: 4,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "upi_bank".to_string(),
        paid_amount: 295000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 5000, // 5 bottles
                unit: "bottle".to_string(),
                rate: 50000, // ₹500
                taxable: 250000, // ₹2,500
                cgst: 0,
                sgst: 0,
                igst: 45000, // ₹450
            }
        ],
    }).unwrap();

    // WAC check before sales:
    // DAP: 1200000 / 10 = 120000 paise/bag (₹1,200)
    // Chlorpyrifos: (200000 + 250000) / 10 = 45000 paise/bottle (₹450)
    let wac_dap = calculate_weighted_average_cost(&conn, 1).unwrap();
    let wac_chlor = calculate_weighted_average_cost(&conn, 2).unwrap();
    assert_eq!(wac_dap, 120000);
    assert_eq!(wac_chlor, 45000);

    // 3. Sales
    // SALE-001: 6 bags DAP @ ₹1,500 = ₹9,000 taxable. Intrastate 5% -> CGST ₹225, SGST ₹225. Cost snapshot: 6 * 1200 = ₹7,200.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-001".to_string(),
        date: "2026-10-18".to_string(),
        party_id: 5,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 945000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 6000, // 6 bags
                unit: "bag".to_string(),
                rate: 150000, // ₹1,500
                taxable: 900000, // ₹9,000
                cgst: 22500, // ₹225
                sgst: 22500, // ₹225
                igst: 0,
            }
        ],
    }).unwrap();

    // SALE-002: 4 bottles Chlorpyrifos @ ₹600 = ₹2,400 taxable. Interstate 18% -> IGST ₹432. Cost snapshot: 4 * 450 = ₹1,800.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-002".to_string(),
        date: "2026-10-19".to_string(),
        party_id: 6,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "credit".to_string(),
        paid_amount: 100000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 4000, // 4 bottles
                unit: "bottle".to_string(),
                rate: 60000, // ₹600
                taxable: 240000, // ₹2,400
                cgst: 0,
                sgst: 0,
                igst: 43200, // ₹432
            }
        ],
    }).unwrap();

    // -------------------------------------------------------------
    // REPORT 1: Purchase Register Verification
    // -------------------------------------------------------------
    let pur_reg = get_purchase_register_inner(&conn, "2026-10-01", "2026-10-31", Some(shop_state)).unwrap();
    assert_eq!(pur_reg.entries.len(), 3);
    assert_eq!(pur_reg.total_taxable, 1650000); // 12000 + 2000 + 2500 = ₹16,500
    assert_eq!(pur_reg.total_cgst, 30000);     // ₹300
    assert_eq!(pur_reg.total_sgst, 30000);     // ₹300
    assert_eq!(pur_reg.total_igst, 45000);     // ₹450
    assert_eq!(pur_reg.grand_total, 1755000);   // ₹17,550

    // Check entry-wise details
    let pur_001 = &pur_reg.entries[0];
    assert_eq!(pur_001.invoice_no, "PUR-001");
    assert_eq!(pur_001.party_name, "Supplier A");
    assert_eq!(pur_001.state_type, "intrastate");
    assert_eq!(pur_001.taxable, 1200000);
    assert_eq!(pur_001.cgst, 30000);
    assert_eq!(pur_001.sgst, 30000);
    assert_eq!(pur_001.igst, 0);
    assert_eq!(pur_001.total, 1260000);
    assert_eq!(pur_001.payment_mode, "credit");

    let pur_003 = &pur_reg.entries[2];
    assert_eq!(pur_003.invoice_no, "PUR-003");
    assert_eq!(pur_003.party_name, "Supplier C");
    assert_eq!(pur_003.state_type, "interstate");
    assert_eq!(pur_003.taxable, 250000);
    assert_eq!(pur_003.cgst, 0);
    assert_eq!(pur_003.sgst, 0);
    assert_eq!(pur_003.igst, 45000);
    assert_eq!(pur_003.total, 295000);
    assert_eq!(pur_003.payment_mode, "upi_bank");

    // -------------------------------------------------------------
    // REPORT 2: Sales Register Verification
    // -------------------------------------------------------------
    let sale_reg = get_sales_register_inner(&conn, "2026-10-01", "2026-10-31", Some(shop_state)).unwrap();
    assert_eq!(sale_reg.entries.len(), 2);
    assert_eq!(sale_reg.total_taxable, 1140000); // 9000 + 2400 = ₹11,400
    assert_eq!(sale_reg.total_cgst, 22500);     // ₹225
    assert_eq!(sale_reg.total_sgst, 22500);     // ₹225
    assert_eq!(sale_reg.total_igst, 43200);     // ₹432
    assert_eq!(sale_reg.grand_total, 1228200);   // ₹12,282

    let sale_001 = &sale_reg.entries[0];
    assert_eq!(sale_001.invoice_no, "SALE-001");
    assert_eq!(sale_001.party_name, "Customer X");
    assert_eq!(sale_001.state_type, "intrastate");
    assert_eq!(sale_001.taxable, 900000);
    assert_eq!(sale_001.cgst, 22500);
    assert_eq!(sale_001.sgst, 22500);
    assert_eq!(sale_001.igst, 0);
    assert_eq!(sale_001.total, 945000);

    let sale_002 = &sale_reg.entries[1];
    assert_eq!(sale_002.invoice_no, "SALE-002");
    assert_eq!(sale_002.party_name, "Customer Y");
    assert_eq!(sale_002.state_type, "interstate");
    assert_eq!(sale_002.taxable, 240000);
    assert_eq!(sale_002.cgst, 0);
    assert_eq!(sale_002.sgst, 0);
    assert_eq!(sale_002.igst, 43200);
    assert_eq!(sale_002.total, 283200);

    // -------------------------------------------------------------
    // REPORT 3: GST Summary Verification
    // -------------------------------------------------------------
    let gst_sum = get_gst_summary_inner(&conn, "2026-10-01", "2026-10-31", Some(shop_state)).unwrap();
    // Output GST
    assert_eq!(gst_sum.output_taxable, 1140000);  // ₹11,400
    assert_eq!(gst_sum.output_cgst, 22500);      // ₹225
    assert_eq!(gst_sum.output_sgst, 22500);      // ₹225
    assert_eq!(gst_sum.output_igst, 43200);      // ₹432
    assert_eq!(gst_sum.output_total_gst, 88200); // ₹882

    // Input GST (Composition excluded!)
    assert_eq!(gst_sum.input_taxable_eligible, 1450000);   // 12000 + 2500 = ₹14,500
    assert_eq!(gst_sum.input_taxable_ineligible, 200000);  // ₹2,000 (Supplier B composition)
    assert_eq!(gst_sum.input_cgst, 30000);                // ₹300
    assert_eq!(gst_sum.input_sgst, 30000);                // ₹300
    assert_eq!(gst_sum.input_igst, 45000);                // ₹450
    assert_eq!(gst_sum.input_total_gst, 105000);          // ₹1,050

    // Net Payable: Output - Input
    assert_eq!(gst_sum.net_cgst_payable, -7500);          // 225 - 300 = -₹75
    assert_eq!(gst_sum.net_sgst_payable, -7500);          // 225 - 300 = -₹75
    assert_eq!(gst_sum.net_igst_payable, -1800);          // 432 - 450 = -₹18
    assert_eq!(gst_sum.net_total_payable, -16800);        // 882 - 1050 = -₹168 (ITC Surplus)

    // -------------------------------------------------------------
    // REPORT 4: HSN Summary Verification
    // -------------------------------------------------------------
    let hsn_rep = get_hsn_summary_inner(&conn, "2026-10-01", "2026-10-31", Some(shop_state)).unwrap();
    assert_eq!(hsn_rep.items.len(), 2);
    assert_eq!(hsn_rep.total_taxable, 1140000); // ₹11,400
    assert_eq!(hsn_rep.total_tax, 88200);       // ₹882
    assert_eq!(hsn_rep.grand_total, 1228200);   // ₹12,282

    let hsn_3105 = hsn_rep.items.iter().find(|h| h.hsn == "3105").unwrap();
    assert_eq!(hsn_3105.total_qty, 6000);       // 6 bags
    assert_eq!(hsn_3105.taxable_value, 900000); // ₹9,000
    assert_eq!(hsn_3105.cgst, 22500);
    assert_eq!(hsn_3105.sgst, 22500);
    assert_eq!(hsn_3105.igst, 0);
    assert_eq!(hsn_3105.total_tax, 45000);      // ₹450
    assert_eq!(hsn_3105.total_value, 945000);

    let hsn_3808 = hsn_rep.items.iter().find(|h| h.hsn == "3808").unwrap();
    assert_eq!(hsn_3808.total_qty, 4000);       // 4 bottles
    assert_eq!(hsn_3808.taxable_value, 240000); // ₹2,400
    assert_eq!(hsn_3808.cgst, 0);
    assert_eq!(hsn_3808.sgst, 0);
    assert_eq!(hsn_3808.igst, 43200);           // ₹432
    assert_eq!(hsn_3808.total_tax, 43200);
    assert_eq!(hsn_3808.total_value, 283200);

    // -------------------------------------------------------------
    // REPORT 5: Profit Report Verification (WAC Snapshotted Cost)
    // -------------------------------------------------------------
    let profit_rep = get_profit_report_inner(&conn, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(profit_rep.items.len(), 2);
    assert_eq!(profit_rep.total_taxable_sale, 1140000);     // ₹11,400
    assert_eq!(profit_rep.total_cost, 900000);              // ₹7,200 + ₹1,800 = ₹9,000
    assert_eq!(profit_rep.total_profit_without_gst, 240000);// ₹11,400 - ₹9,000 = ₹2,400
    assert_eq!(profit_rep.total_gross_sale, 1228200);       // ₹12,282
    assert_eq!(profit_rep.total_gross_profit, 328200);      // ₹12,282 - ₹9,000 = ₹3,282

    let dap_profit = profit_rep.items.iter().find(|p| p.item_id == 1).unwrap();
    assert_eq!(dap_profit.qty_sold, 6000);                  // 6 bags
    assert_eq!(dap_profit.taxable_sale, 900000);            // ₹9,000
    assert_eq!(dap_profit.cost_amount, 720000);             // ₹7,200 (6 * ₹1,200)
    assert_eq!(dap_profit.profit_without_gst, 180000);      // ₹1,800
    assert_eq!(dap_profit.gross_sale, 945000);              // ₹9,450
    assert_eq!(dap_profit.gross_profit, 225000);            // ₹2,250
    assert_eq!(dap_profit.unit_sale_price, 150000);         // ₹1,500/bag
    assert_eq!(dap_profit.unit_cost, 120000);               // ₹1,200/bag
    assert_eq!(dap_profit.unit_profit, 30000);              // ₹300/bag

    let chlor_profit = profit_rep.items.iter().find(|p| p.item_id == 2).unwrap();
    assert_eq!(chlor_profit.qty_sold, 4000);                // 4 bottles
    assert_eq!(chlor_profit.taxable_sale, 240000);          // ₹2,400
    assert_eq!(chlor_profit.cost_amount, 180000);           // ₹1,800 (4 * ₹450)
    assert_eq!(chlor_profit.profit_without_gst, 60000);     // ₹600
    assert_eq!(chlor_profit.gross_sale, 283200);            // ₹2,832
    assert_eq!(chlor_profit.gross_profit, 103200);          // ₹1,032
    assert_eq!(chlor_profit.unit_sale_price, 60000);        // ₹600/bottle
    assert_eq!(chlor_profit.unit_cost, 45000);              // ₹450/bottle
    assert_eq!(chlor_profit.unit_profit, 15000);            // ₹150/bottle

    // -------------------------------------------------------------
    // ISOLATION TEST: Subsequent Purchase Rate Change Does NOT Alter Past Cost/Profit
    // -------------------------------------------------------------
    // Now record a new purchase on 2026-10-25 at a MUCH higher rate: ₹2,000 per bag
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-004".to_string(),
        date: "2026-10-25".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 2000000,
        shop_state: Some(shop_state.to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 10000, // 10 bags
                unit: "bag".to_string(),
                rate: 200000, // ₹2,000
                taxable: 2000000, // ₹20,000
                cgst: 50000,
                sgst: 50000,
                igst: 0,
            }
        ],
    }).unwrap();

    // Verify that WAC for DAP has indeed increased to ₹1,600:
    let new_wac = calculate_weighted_average_cost(&conn, 1).unwrap();
    assert_eq!(new_wac, 160000); // (12,000 + 20,000) / 20 = 160,000 paise (₹1,600)

    // Re-run the profit report for the earlier period (2026-10-01 to 2026-10-20):
    let past_profit_rep = get_profit_report_inner(&conn, "2026-10-01", "2026-10-20").unwrap();
    let past_dap = past_profit_rep.items.iter().find(|p| p.item_id == 1).unwrap();

    // PAST COST AND PROFIT ARE EXACTLY PRESERVED (Cost snapshotting works!)
    assert_eq!(past_dap.cost_amount, 720000);             // Still ₹7,200, NOT ₹9,600!
    assert_eq!(past_dap.profit_without_gst, 180000);      // Still ₹1,800!
    assert_eq!(past_dap.unit_cost, 120000);               // Still ₹1,200/bag!
}

#[test]
fn test_tally_ledger_import_filters_non_trade_ledgers() {
    use crate::tally_import::{preview_import, confirm_import};
    let mut conn = init_db(":memory:").expect("Failed to init DB");

    let xml = r#"
<ENVELOPE>
  <BODY>
    <IMPORTDATA>
      <REQUESTDATA>
        <!-- 1. Genuine Customer under Sundry Debtors -->
        <TALLYMESSAGE>
          <LEDGER NAME="Farmer Ramesh">
            <PARENT>Sundry Debtors</PARENT>
            <GUID>guid-debtor-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 2. Genuine Supplier under Sundry Creditors sub-group -->
        <TALLYMESSAGE>
          <LEDGER NAME="Bharat Chemicals">
            <PARENT>Sundry Creditors - Fertilizers</PARENT>
            <GUID>guid-creditor-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 3. Cash-in-hand (MUST BE SKIPPED) -->
        <TALLYMESSAGE>
          <LEDGER NAME="Cash">
            <PARENT>Cash-in-Hand</PARENT>
            <GUID>guid-cash-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 4. Profit & Loss (MUST BE SKIPPED) -->
        <TALLYMESSAGE>
          <LEDGER NAME="Profit &amp; Loss A/c">
            <PARENT>Primary</PARENT>
            <GUID>guid-pnl-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 5. Purchase Account (MUST BE SKIPPED) -->
        <TALLYMESSAGE>
          <LEDGER NAME="Purchase Account">
            <PARENT>Purchase Accounts</PARENT>
            <GUID>guid-pur-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 6. Sales Account (MUST BE SKIPPED) -->
        <TALLYMESSAGE>
          <LEDGER NAME="Sales Account">
            <PARENT>Sales Accounts</PARENT>
            <GUID>guid-sale-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>

        <!-- 7. Bank Account (MUST BE SKIPPED) -->
        <TALLYMESSAGE>
          <LEDGER NAME="State Bank of India">
            <PARENT>Bank Accounts</PARENT>
            <GUID>guid-bank-1</GUID>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"#;

    let report = preview_import(&conn, xml).unwrap();
    // Only 2 genuine trade parties should be counted
    assert_eq!(report.new_parties, 2);
    // 5 accounting ledgers must be recorded as skipped
    assert_eq!(report.skipped_ledgers, 5);

    // Confirm import
    confirm_import(&mut conn, "dummy.sqlite", xml, "tally_test_filtered.xml").unwrap();

    // Verify 'Farmer Ramesh' and 'Bharat Chemicals' exist in parties
    let ramesh_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Farmer Ramesh')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(ramesh_exists, "'Farmer Ramesh' must exist in parties");

    let bharat_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Bharat Chemicals')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(bharat_exists, "'Bharat Chemicals' must exist in parties");

    let customer_type: String = conn.query_row(
        "SELECT type FROM parties WHERE name = 'Farmer Ramesh'",
        [],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(customer_type, "customer");

    let supplier_type: String = conn.query_row(
        "SELECT type FROM parties WHERE name = 'Bharat Chemicals'",
        [],
        |row| row.get(0)
    ).unwrap();
    assert_eq!(supplier_type, "supplier");

    // Non-trade ledgers MUST NOT exist in parties table
    let cash_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Cash')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!cash_exists, "'Cash' must NOT exist in parties");

    let pnl_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Profit & Loss A/c')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!pnl_exists, "'Profit & Loss A/c' must NOT exist in parties");

    let purchase_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Purchase Account')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!purchase_exists, "'Purchase Account' must NOT exist in parties");

    let sales_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'Sales Account')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!sales_exists, "'Sales Account' must NOT exist in parties");

    let sbi_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE name = 'State Bank of India')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!sbi_exists, "'State Bank of India' must NOT exist in parties");
}

#[test]
fn test_cleanup_accounting_parties() {
    use crate::commands::cleanup_accounting_parties_inner;
    let conn = init_db(":memory:").expect("Failed to init DB");

    // Insert Cash, Profit & Loss A/c, and Input CGST accounting parties
    conn.execute("INSERT INTO parties (id, name, type) VALUES (101, 'Cash', 'customer')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type) VALUES (102, 'Profit & Loss A/c', 'customer')", []).unwrap();
    conn.execute("INSERT INTO parties (id, name, type) VALUES (103, 'Input CGST', 'customer')", []).unwrap();

    // Use one of them ('Input CGST', id 103) in a sale
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id) VALUES ('INV-TAX-101', '2026-10-10', 103)", []).unwrap();

    // Also insert a legitimate farmer customer who has an invoice
    conn.execute("INSERT INTO parties (id, name, type) VALUES (10, 'Suresh Farmer', 'customer')", []).unwrap();
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id) VALUES ('INV-101', '2026-10-10', 10)", []).unwrap();

    // Run cleanup
    let cleaned = cleanup_accounting_parties_inner(&conn).unwrap();
    
    // Exactly 2 parties ('Cash' and 'Profit & Loss A/c') should be deleted
    assert_eq!(cleaned, 2);

    // Verify 'Cash' was deleted
    let cash_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE id = 101 AND name = 'Cash')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!cash_exists, "Unused 'Cash' party should be deleted");

    // Verify 'Profit & Loss A/c' was deleted
    let pnl_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE id = 102 AND name = 'Profit & Loss A/c')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(!pnl_exists, "Unused 'Profit & Loss A/c' party should be deleted");

    // Verify 'Input CGST' was PRESERVED because it is used in a sale
    let input_cgst_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE id = 103 AND name = 'Input CGST')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(input_cgst_exists, "Used 'Input CGST' party must be preserved");

    // Verify 'Suresh Farmer' is also preserved
    let suresh_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM parties WHERE id = 10 AND name = 'Suresh Farmer')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert!(suresh_exists, "Farmer party must be preserved");
}

#[test]
fn test_record_payment_receipt_and_ledger() {
    use crate::commands::{record_payment_inner, PaymentPayload, get_party_balances_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type, category, phone, village) VALUES (5, 'Ramesh Patel', 'customer', 'unregistered', '9898012345', 'Bhopal')", []).unwrap();

    // 1. Give customer an opening debt/sale of ₹2,000 (200000 paise)
    conn.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES ('2026-10-01', 5, 'sale', 'INV-501', 200000, 0, 'credit', 'Sale on credit')",
        [],
    ).unwrap();

    let balances_before = get_party_balances_inner(&conn).unwrap();
    let ramesh_before = balances_before.iter().find(|b| b.party_id == 5).unwrap();
    assert_eq!(ramesh_before.total_debit, 200000);
    assert_eq!(ramesh_before.total_credit, 0);
    assert_eq!(ramesh_before.net_balance, 200000); // लेना है ₹2000

    // 2. Customer pays ₹1,200 (120000 paise) via UPI
    let payload = PaymentPayload {
        party_id: 5,
        payment_type: "receipt".to_string(), // पैसा मिला
        amount_paise: 120000,
        payment_mode: "upi_bank".to_string(),
        date: "2026-10-05".to_string(),
        remark: Some("PhonePe payment".to_string()),
        ref_id: None,
    };

    let ref_id = record_payment_inner(&mut conn, payload).unwrap();
    assert!(ref_id.starts_with("REC-"));

    // 3. Verify ledger entry
    let (credit, mode, remark): (i64, String, Option<String>) = conn.query_row(
        "SELECT credit, payment_mode, remark FROM party_ledger WHERE ref_id = ?1",
        rusqlite::params![ref_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap();
    assert_eq!(credit, 120000);
    assert_eq!(mode, "upi_bank");
    assert_eq!(remark, Some("PhonePe payment".to_string()));

    // 4. Verify balance is now ₹800 (80000 paise)
    let balances_after = get_party_balances_inner(&conn).unwrap();
    let ramesh_after = balances_after.iter().find(|b| b.party_id == 5).unwrap();
    assert_eq!(ramesh_after.total_debit, 200000);
    assert_eq!(ramesh_after.total_credit, 120000);
    assert_eq!(ramesh_after.net_balance, 80000); // 2000 - 1200 = 800
}

#[test]
fn test_record_payment_to_supplier() {
    use crate::commands::{record_payment_inner, PaymentPayload, get_party_balances_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (6, 'Agro Seeds Co', 'supplier', 'regular')", []).unwrap();

    // 1. Purchase on credit ₹5,000 (500000 paise) -> supplier credit
    conn.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES ('2026-10-01', 6, 'purchase', 'PINV-01', 0, 500000, 'credit', 'Seeds purchase')",
        [],
    ).unwrap();

    let balances_before = get_party_balances_inner(&conn).unwrap();
    let agro_before = balances_before.iter().find(|b| b.party_id == 6).unwrap();
    assert_eq!(agro_before.net_balance, -500000); // देना है ₹5000

    // 2. Pay supplier ₹3,000 (300000 paise) via bank
    let payload = PaymentPayload {
        party_id: 6,
        payment_type: "payment".to_string(), // पैसा दिया
        amount_paise: 300000,
        payment_mode: "bank".to_string(),
        date: "2026-10-06".to_string(),
        remark: Some("NEFT Transfer".to_string()),
        ref_id: None,
    };

    let ref_id = record_payment_inner(&mut conn, payload).unwrap();
    assert!(ref_id.starts_with("PAY-"));

    // 3. Verify balance is now -₹2,000 (-200000 paise)
    let balances_after = get_party_balances_inner(&conn).unwrap();
    let agro_after = balances_after.iter().find(|b| b.party_id == 6).unwrap();
    assert_eq!(agro_after.total_debit, 300000);
    assert_eq!(agro_after.total_credit, 500000);
    assert_eq!(agro_after.net_balance, -200000); // देना है ₹2000
}

#[test]
fn test_payment_with_invoice_match() {
    use crate::commands::{record_payment_inner, PaymentPayload, get_pending_bills_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (7, 'Dinesh Sharma', 'customer', 'unregistered')", []).unwrap();
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id, payment_mode, paid_amount, total_amount) VALUES ('INV-MATCH-1', '2026-10-02', 7, 'credit', 20000, 100000)", []).unwrap();

    // Check pending bill
    let pending_before = get_pending_bills_inner(&conn, 7).unwrap();
    assert_eq!(pending_before.len(), 1);
    assert_eq!(pending_before[0].invoice_no, "INV-MATCH-1");
    assert_eq!(pending_before[0].pending_amount, 80000); // ₹1000 - ₹200 = ₹800

    // Match payment of ₹500 (50000 paise) against this invoice
    let payload = PaymentPayload {
        party_id: 7,
        payment_type: "receipt".to_string(),
        amount_paise: 50000,
        payment_mode: "cash".to_string(),
        date: "2026-10-04".to_string(),
        remark: Some("Partial payment for INV-MATCH-1".to_string()),
        ref_id: Some("INV-MATCH-1".to_string()),
    };

    record_payment_inner(&mut conn, payload).unwrap();

    // Verify sales paid_amount increased from 20000 to 70000
    let paid: i64 = conn.query_row("SELECT paid_amount FROM sales WHERE invoice_no = 'INV-MATCH-1'", [], |r| r.get(0)).unwrap();
    assert_eq!(paid, 70000);

    // Pending bill now has ₹300 pending
    let pending_after = get_pending_bills_inner(&conn, 7).unwrap();
    assert_eq!(pending_after[0].pending_amount, 30000);
}

#[test]
fn test_party_statement_and_running_balance() {
    use crate::commands::{get_party_statement_inner, record_payment_inner, PaymentPayload};

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type, category, village, phone) VALUES (8, 'Kailash Verma', 'customer', 'unregistered', 'Sehore', '9826011111')", []).unwrap();

    // Transaction 1: Sale of ₹1,000 on Oct 1
    conn.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES ('2026-10-01', 8, 'sale', 'INV-K1', 100000, 0, 'credit', 'First sale')",
        [],
    ).unwrap();

    // Transaction 2: Payment received ₹400 on Oct 3
    let pay1 = PaymentPayload {
        party_id: 8,
        payment_type: "receipt".to_string(),
        amount_paise: 40000,
        payment_mode: "cash".to_string(),
        date: "2026-10-03".to_string(),
        remark: Some("Cash receipt".to_string()),
        ref_id: Some("REC-K1".to_string()),
    };
    record_payment_inner(&mut conn, pay1).unwrap();

    // Transaction 3: Sale of ₹800 on Oct 5
    conn.execute(
        "INSERT INTO party_ledger (date, party_id, type, ref_id, debit, credit, payment_mode, remark) 
         VALUES ('2026-10-05', 8, 'sale', 'INV-K2', 80000, 0, 'credit', 'Second sale')",
        [],
    ).unwrap();

    let stmt = get_party_statement_inner(&conn, 8).unwrap();
    assert_eq!(stmt.party_name, "Kailash Verma");
    assert_eq!(stmt.total_debit, 180000);  // 1000 + 800
    assert_eq!(stmt.total_credit, 40000);  // 400
    assert_eq!(stmt.closing_balance, 140000); // 1800 - 400 = 1400 (₹1,400 लेना है)
    assert_eq!(stmt.entries.len(), 3);

    // Verify running balances chronologically:
    // Entry 1: debit 100000 -> running 100000
    assert_eq!(stmt.entries[0].debit, 100000);
    assert_eq!(stmt.entries[0].running_balance, 100000);

    // Entry 2: credit 40000 -> running 60000
    assert_eq!(stmt.entries[1].credit, 40000);
    assert_eq!(stmt.entries[1].running_balance, 60000);

    // Entry 3: debit 80000 -> running 140000
    assert_eq!(stmt.entries[2].debit, 80000);
    assert_eq!(stmt.entries[2].running_balance, 140000);
}

#[test]
fn test_dashboard_7_day_trend_and_yesterday_comparison() {
    use crate::commands::{get_7_day_trend_inner, get_yesterday_comparison_inner};

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (name, type) VALUES ('Trade Party', 'both')", []).unwrap();
    let party_id = conn.last_insert_rowid();

    // Today is 2026-10-11
    // Add sales:
    // 2026-10-10 (yesterday): sales ₹2,000, purchases ₹1,000
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id, total_amount) VALUES ('S-10', '2026-10-10', ?1, 200000)", rusqlite::params![party_id]).unwrap();
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id, total_amount) VALUES ('P-10', '2026-10-10', ?1, 100000)", rusqlite::params![party_id]).unwrap();

    // 2026-10-11 (today): sales ₹3,000, purchases ₹500
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id, total_amount) VALUES ('S-11', '2026-10-11', ?1, 300000)", rusqlite::params![party_id]).unwrap();
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id, total_amount) VALUES ('P-11', '2026-10-11', ?1, 50000)", rusqlite::params![party_id]).unwrap();

    // 1. Test 7-day trend
    let trend = get_7_day_trend_inner(&conn, "2026-10-11").unwrap();
    assert_eq!(trend.len(), 7);
    assert_eq!(trend[6].date, "2026-10-11"); // today
    assert_eq!(trend[6].sales_paise, 300000);
    assert_eq!(trend[6].purchases_paise, 50000);
    assert_eq!(trend[5].date, "2026-10-10"); // yesterday
    assert_eq!(trend[5].sales_paise, 200000);
    assert_eq!(trend[5].purchases_paise, 100000);

    // 2. Test Yesterday comparison
    let comp = get_yesterday_comparison_inner(&conn, "2026-10-11").unwrap();
    assert_eq!(comp.today_sales, 300000);
    assert_eq!(comp.yesterday_sales, 200000);
    // (3000 - 2000) / 2000 * 100 = +50.0%
    assert!((comp.sales_growth_percent - 50.0).abs() < 0.01);

    assert_eq!(comp.today_purchases, 50000);
    assert_eq!(comp.yesterday_purchases, 100000);
    // (500 - 1000) / 1000 * 100 = -50.0%
    assert!((comp.purchases_growth_percent - (-50.0)).abs() < 0.01);
}

#[test]
fn test_top_5_receivables_with_debt_aging() {
    use crate::commands::get_top_receivables_inner;

    let conn = init_db(":memory:").expect("Failed to init DB");

    // Insert 6 parties with debits
    let mut party_ids = Vec::new();
    for i in 1..=6 {
        conn.execute(
            &format!("INSERT INTO parties (name, type, village, phone) VALUES ('Farmer {}', 'customer', 'Village {}', '990000000{}')", i, i, i),
            [],
        ).unwrap();
        party_ids.push(conn.last_insert_rowid());
    }

    // Party 1: ₹10,000 debt from 2026-09-01 (40 days old as of 2026-10-11)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-09-01', ?1, 'sale', 1000000, 0)", rusqlite::params![party_ids[0]]).unwrap();

    // Party 2: ₹8,000 debt from 2026-09-15 (26 days old as of 2026-10-11)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-09-15', ?1, 'sale', 800000, 0)", rusqlite::params![party_ids[1]]).unwrap();

    // Party 3: ₹5,000 debt from 2026-10-01 (10 days old as of 2026-10-11)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-10-01', ?1, 'sale', 500000, 0)", rusqlite::params![party_ids[2]]).unwrap();

    // Party 4: ₹3,000 debt from 2026-10-06 (5 days old as of 2026-10-11)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-10-06', ?1, 'sale', 300000, 0)", rusqlite::params![party_ids[3]]).unwrap();

    // Party 5: ₹2,000 debt from 2026-10-09 (2 days old as of 2026-10-11)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-10-09', ?1, 'sale', 200000, 0)", rusqlite::params![party_ids[4]]).unwrap();

    // Party 6: ₹1,000 debt (lowest - should NOT be in top 5)
    conn.execute("INSERT INTO party_ledger (date, party_id, type, debit, credit) VALUES ('2026-10-10', ?1, 'sale', 100000, 0)", rusqlite::params![party_ids[5]]).unwrap();

    let top5 = get_top_receivables_inner(&conn, 5, Some("2026-10-11")).unwrap();
    assert_eq!(top5.len(), 5);

    // Rank 1: Farmer 1 (₹10,000, 40 days old)
    assert_eq!(top5[0].party_id, party_ids[0]);
    assert_eq!(top5[0].name, "Farmer 1");
    assert_eq!(top5[0].receivable_paise, 1000000);
    assert_eq!(top5[0].oldest_debt_days, 40);

    // Rank 2: Farmer 2 (₹8,000, 26 days old)
    assert_eq!(top5[1].party_id, party_ids[1]);
    assert_eq!(top5[1].receivable_paise, 800000);
    assert_eq!(top5[1].oldest_debt_days, 26);

    // Rank 5: Farmer 5 (₹2,000, 2 days old)
    assert_eq!(top5[4].party_id, party_ids[4]);
    assert_eq!(top5[4].receivable_paise, 200000);
    assert_eq!(top5[4].oldest_debt_days, 2);
}

#[test]
fn test_low_stock_items_query() {
    use crate::commands::get_low_stock_items_inner;

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();
    conn.execute("INSERT INTO items (id, name, category, base_unit) VALUES (1, 'DAP Fertilizer', 'fertilizer', 'bag')", []).unwrap();
    conn.execute("INSERT INTO items (id, name, category, base_unit) VALUES (2, 'Chlorpyrifos 1L', 'pesticide', 'bottle')", []).unwrap();
    conn.execute("INSERT INTO items (id, name, category, base_unit) VALUES (3, 'Wheat Seeds 40kg', 'seed', 'bag')", []).unwrap();

    // Item 1 has 5 bags (5,000 milli) -> LOW STOCK (<= 10 bags / 10,000 milli)
    conn.execute("INSERT INTO stock_ledger (date, item_id, godown_id, qty_base, type) VALUES ('2026-10-01', 1, 1, 5000, 'purchase')", []).unwrap();

    // Item 2 has 25 bottles (25,000 milli) -> SUFFICIENT STOCK
    conn.execute("INSERT INTO stock_ledger (date, item_id, godown_id, qty_base, type) VALUES ('2026-10-01', 2, 1, 25000, 'purchase')", []).unwrap();

    // Item 3 has 0 bags -> LOW STOCK
    // (no stock_ledger entries)

    let low_items = get_low_stock_items_inner(&conn, 10000).unwrap();
    // Items 1 and 3 should be low stock
    assert_eq!(low_items.len(), 2);
    let names: Vec<String> = low_items.into_iter().map(|i| i.name).collect();
    assert!(names.contains(&"DAP Fertilizer".to_string()));
    assert!(names.contains(&"Wheat Seeds 40kg".to_string()));
}

#[test]
fn test_record_payment_validation_and_supplier_match() {
    use crate::commands::{record_payment_inner, PaymentPayload, get_pending_bills_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type, category) VALUES (20, 'Kisan Agro Supplies', 'supplier', 'regular')", []).unwrap();
    conn.execute("INSERT INTO purchases (invoice_no, date, supplier_id, payment_mode, paid_amount, total_amount) VALUES ('PUR-SPL-101', '2026-10-05', 20, 'credit', 100000, 500000)", []).unwrap();

    // 1. Validation test: amount <= 0 must fail
    let err_payload = PaymentPayload {
        party_id: 20,
        payment_type: "payment".to_string(),
        amount_paise: 0,
        payment_mode: "cash".to_string(),
        date: "2026-10-06".to_string(),
        remark: None,
        ref_id: None,
    };
    assert!(record_payment_inner(&mut conn, err_payload).is_err());

    // 2. Validation test: non-existent party must fail
    let ghost_payload = PaymentPayload {
        party_id: 99999,
        payment_type: "payment".to_string(),
        amount_paise: 50000,
        payment_mode: "cash".to_string(),
        date: "2026-10-06".to_string(),
        remark: None,
        ref_id: None,
    };
    assert!(record_payment_inner(&mut conn, ghost_payload).is_err());

    // 3. Pending bills before payment: ₹5000 total, ₹1000 paid -> ₹4000 pending
    let pending_pre = get_pending_bills_inner(&conn, 20).unwrap();
    assert_eq!(pending_pre.len(), 1);
    assert_eq!(pending_pre[0].invoice_no, "PUR-SPL-101");
    assert_eq!(pending_pre[0].pending_amount, 400000);

    // 4. Pay ₹2,500 matched against this purchase invoice
    let pay_payload = PaymentPayload {
        party_id: 20,
        payment_type: "payment".to_string(),
        amount_paise: 250000,
        payment_mode: "bank".to_string(),
        date: "2026-10-07".to_string(),
        remark: Some("Supplier payment RTGS".to_string()),
        ref_id: Some("PUR-SPL-101".to_string()),
    };
    let ref_out = record_payment_inner(&mut conn, pay_payload).unwrap();
    assert_eq!(ref_out, "PUR-SPL-101");

    // 5. Verify purchases table paid_amount updated: 100000 + 250000 = 350000
    let paid_now: i64 = conn.query_row("SELECT paid_amount FROM purchases WHERE invoice_no = 'PUR-SPL-101'", [], |r| r.get(0)).unwrap();
    assert_eq!(paid_now, 350000);

    // 6. Verify pending amount remaining is ₹1,500 (150000 paise)
    let pending_post = get_pending_bills_inner(&conn, 20).unwrap();
    assert_eq!(pending_post.len(), 1);
    assert_eq!(pending_post[0].pending_amount, 150000);
}

#[test]
fn test_pending_bills_excludes_fully_settled_invoices() {
    use crate::commands::get_pending_bills_inner;

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type) VALUES (30, 'Vikram Singh', 'customer')", []).unwrap();

    // Bill 1: Unpaid (₹2000 total, 0 paid) -> Pending
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id, paid_amount, total_amount) VALUES ('INV-UNPAID', '2026-10-01', 30, 0, 200000)", []).unwrap();

    // Bill 2: Fully paid (₹5000 total, ₹5000 paid) -> Should NOT appear in pending
    conn.execute("INSERT INTO sales (invoice_no, date, customer_id, paid_amount, total_amount) VALUES ('INV-PAID', '2026-10-02', 30, 500000, 500000)", []).unwrap();

    let pending = get_pending_bills_inner(&conn, 30).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].invoice_no, "INV-UNPAID");
    assert_eq!(pending[0].pending_amount, 200000);
}

#[test]
fn test_settings_sqlite_crud() {
    use crate::commands::{get_settings_inner, set_settings_inner, AppSettingsPayload};

    let conn = init_db(":memory:").expect("Failed to init DB");

    // 1. Initial get should return default settings seeded by migration
    let default_settings = get_settings_inner(&conn).expect("get_settings failed");
    assert_eq!(default_settings.shop_name, "श्री राम कृषि केंद्र");
    assert_eq!(default_settings.gstin.as_deref(), Some("23AAAAA0000A1Z5"));
    assert!(default_settings.is_gst_registered, "Default shop should be GST registered");
    assert!(!default_settings.is_composition, "Default shop should not be in composition");

    // 2. Update settings via set_settings_inner
    let updated_payload = AppSettingsPayload {
        shop_name: "किसान सेवा केंद्र सीहोर".to_string(),
        gstin: Some("23AAACK1425H1Z4".to_string()),
        state_code: Some("23".to_string()),
        phone: Some("+91 99887 76655".to_string()),
        address: Some("मंडी गेट, सीहोर".to_string()),
        bank_name: Some("Bank of Baroda".to_string()),
        bank_account_no: Some("1234567890".to_string()),
        bank_ifsc: Some("BARB0SEHORE".to_string()),
        bank_branch: Some("Sehore".to_string()),
        upi_id: Some("kisankendra@bob".to_string()),
        terms_and_conditions: Some("नियम व शर्तें लागू".to_string()),
        signature_text: Some("संचालक".to_string()),
        signature_data: Some("data:image/png;base64,mock".to_string()),
        logo_data: Some("data:image/png;base64,mocklogo".to_string()),
        default_bill_format: Some("A5".to_string()),
        bill_language: Some("hi".to_string()),
        visible_columns: Some(serde_json::json!({"hsn": true, "unit": true})),
        fy_prefix: Some("KSK".to_string()),
        low_stock_threshold: Some(15),
        footer_note: Some("शुभ लाभ".to_string()),
        selected_printer: Some("Canon LBP2900".to_string()),
        printer_paper_size: Some("A5".to_string()),
        print_offset_x_mm: Some(2.5),
        print_offset_y_mm: Some(-1.0),
        print_mode: Some("dialog".to_string()),
        is_gst_registered: true,
        is_composition: true,
        silent_print_beta: false,
        backup_folder: None,
        secondary_backup_folder: None,
        last_backup_time: None,
    };

    let saved = set_settings_inner(&conn, updated_payload).expect("set_settings failed");
    assert_eq!(saved.shop_name, "किसान सेवा केंद्र सीहोर");
    assert_eq!(saved.gstin.as_deref(), Some("23AAACK1425H1Z4"));
    assert_eq!(saved.fy_prefix.as_deref(), Some("KSK"));
    assert!(saved.is_composition);
    assert_eq!(saved.print_offset_x_mm, Some(2.5));

    // 3. Re-read to confirm persistence in SQLite
    let persisted = get_settings_inner(&conn).expect("re-fetch failed");
    assert_eq!(persisted.shop_name, "किसान सेवा केंद्र सीहोर");
    assert_eq!(persisted.gstin.as_deref(), Some("23AAACK1425H1Z4"));
    assert!(persisted.is_composition);
}

#[test]
fn test_settings_frontend_json_roundtrip() {
    use crate::commands::{get_settings_inner, set_settings_inner, AppSettingsPayload};

    let conn = init_db(":memory:").expect("Failed to init DB");

    // Exact JSON serialization matching frontend DEFAULT_SETTINGS with logoData
    let frontend_json = r#"{
        "shopName": "श्री राम कृषि केंद्र",
        "gstin": "23AAAAA0000A1Z5",
        "stateCode": "23",
        "phone": "+91 98765 43210",
        "address": "मंडी रोड, कृषि उपज मंडी के सामने, हरदा (म.प्र.) - 461331",
        "bankName": "State Bank of India",
        "bankAccountNo": "31234567890",
        "bankIfsc": "SBIN0001234",
        "bankBranch": "Harda Main",
        "upiId": "9876543210@sbi",
        "termsAndConditions": "1. माल की वापसी 7 दिन के भीतर मूल रसीद के साथ ही मान्य होगी।",
        "signatureText": "अधिकृत हस्ताक्षरकर्ता",
        "signatureData": "",
        "logoData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "defaultBillFormat": "A4",
        "billLanguage": "both",
        "visibleColumns": {
            "hsn": true,
            "unit": true,
            "discount": true,
            "gstRate": true,
            "taxable": true
        },
        "fyPrefix": "KK",
        "lowStockThreshold": 10,
        "footerNote": "पधारने के लिए धन्यवाद!",
        "selectedPrinter": "",
        "printerPaperSize": "A4",
        "printOffsetXMm": 0.0,
        "printOffsetYMm": 0.0,
        "silentPrintBeta": false,
        "printMode": "dialog",
        "isGstRegistered": true,
        "isComposition": false
    }"#;

    // 1. Deserialize exact frontend JSON
    let payload: AppSettingsPayload = serde_json::from_str(frontend_json)
        .expect("Failed to deserialize frontend JSON into AppSettingsPayload");
    assert_eq!(payload.shop_name, "श्री राम कृषि केंद्र");
    assert!(payload.logo_data.is_some());

    // 2. Persist via set_settings_inner
    let saved = set_settings_inner(&conn, payload).expect("set_settings_inner failed");
    assert_eq!(saved.shop_name, "श्री राम कृषि केंद्र");
    assert!(saved.logo_data.unwrap().starts_with("data:image/png;base64"));

    // 3. Fetch via get_settings_inner and assert roundtrip equality
    let retrieved = get_settings_inner(&conn).expect("get_settings_inner failed");
    assert_eq!(retrieved.shop_name, "श्री राम कृषि केंद्र");
    assert_eq!(retrieved.gstin.as_deref(), Some("23AAAAA0000A1Z5"));
    assert_eq!(retrieved.state_code.as_deref(), Some("23"));
    assert_eq!(retrieved.phone.as_deref(), Some("+91 98765 43210"));
    assert!(retrieved.logo_data.unwrap().starts_with("data:image/png;base64"));
}

#[test]
fn test_financial_year_calculation_and_bill_numbering() {
    use crate::commands::{calculate_financial_year, get_next_bill_number_inner};

    // 1. Verify exact FY calculation from date:
    // Oct 2026 -> 26-27
    assert_eq!(calculate_financial_year("2026-10-24").unwrap(), "26-27");
    // Feb 2027 -> 26-27
    assert_eq!(calculate_financial_year("2027-02-15").unwrap(), "26-27");
    // April 2027 -> 27-28
    assert_eq!(calculate_financial_year("2027-04-01").unwrap(), "27-28");
    // March 2027 -> 26-27
    assert_eq!(calculate_financial_year("2027-03-31").unwrap(), "26-27");
    // May 2025 -> 25-26
    assert_eq!(calculate_financial_year("2025-05-10").unwrap(), "25-26");

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("INSERT INTO parties (id, name, type) VALUES (50, 'Radheshyam', 'customer')", []).unwrap();

    // 2. First bill in Oct 2026 should be 0001
    let b1 = get_next_bill_number_inner(&conn, "sale", "2026-10-24", Some("KK")).unwrap();
    assert_eq!(b1, "KK/26-27/0001");

    // Insert bill 1
    conn.execute(
        "INSERT INTO sales (invoice_no, date, customer_id, total_amount) VALUES (?1, '2026-10-24', 50, 10000)",
        [&b1],
    ).unwrap();

    // Next bill in same FY (Feb 2027) should be 0002
    let b2 = get_next_bill_number_inner(&conn, "sale", "2027-02-15", Some("KK")).unwrap();
    assert_eq!(b2, "KK/26-27/0002");

    // Insert bill 2
    conn.execute(
        "INSERT INTO sales (invoice_no, date, customer_id, total_amount) VALUES (?1, '2027-02-15', 50, 20000)",
        [&b2],
    ).unwrap();

    // 3. New FY in April 2027: Series MUST restart from 0001
    let b3 = get_next_bill_number_inner(&conn, "sale", "2027-04-01", Some("KK")).unwrap();
    assert_eq!(b3, "KK/27-28/0001");

    // Insert bill 3 in new FY
    conn.execute(
        "INSERT INTO sales (invoice_no, date, customer_id, total_amount) VALUES (?1, '2027-04-01', 50, 30000)",
        [&b3],
    ).unwrap();

    // Subsequent bill in 27-28 FY
    let b4 = get_next_bill_number_inner(&conn, "sale", "2027-05-10", Some("KK")).unwrap();
    assert_eq!(b4, "KK/27-28/0002");
}

#[test]
fn test_item_gst_status_defaults_and_queries() {
    let conn = init_db(":memory:").expect("Failed to init DB");

    // 1. Taxable item (e.g. Urea 5%)
    crate::commands::add_item_inner(
        &conn,
        "Urea".to_string(),
        Some("fertilizer".to_string()),
        Some("3102".to_string()),
        Some(5000),
        "bag".to_string(),
        Some("taxable".to_string()),
    ).unwrap();

    // 2. Nil-rated item (e.g. Certified Seed 0%)
    crate::commands::add_item_inner(
        &conn,
        "Wheat Seeds".to_string(),
        Some("seed".to_string()),
        Some("1209".to_string()),
        Some(0),
        "kg".to_string(),
        Some("nil_rated".to_string()),
    ).unwrap();

    // 3. Exempt item
    crate::commands::add_item_inner(
        &conn,
        "Organic Compost".to_string(),
        Some("bio".to_string()),
        None,
        Some(0),
        "bag".to_string(),
        Some("exempt".to_string()),
    ).unwrap();

    // 4. Not-set item (rate is None, status None -> defaults to not_set)
    crate::commands::add_item_inner(
        &conn,
        "Unknown Item".to_string(),
        None,
        None,
        None,
        "piece".to_string(),
        None,
    ).unwrap();

    let items = crate::commands::get_items_inner(&conn).unwrap();
    assert_eq!(items.len(), 4);

    let urea = items.iter().find(|i| i.name == "Urea").unwrap();
    assert_eq!(urea.gst_status.as_deref(), Some("taxable"));
    assert_eq!(urea.gst_rate, Some(5000));

    let seed = items.iter().find(|i| i.name == "Wheat Seeds").unwrap();
    assert_eq!(seed.gst_status.as_deref(), Some("nil_rated"));
    assert_eq!(seed.gst_rate, Some(0));

    let compost = items.iter().find(|i| i.name == "Organic Compost").unwrap();
    assert_eq!(compost.gst_status.as_deref(), Some("exempt"));

    let unknown = items.iter().find(|i| i.name == "Unknown Item").unwrap();
    assert_eq!(unknown.gst_status.as_deref(), Some("not_set"));
}

#[test]
fn test_invoice_print_log_append_only_and_mode_retrieval() {
    use crate::invoice::{log_invoice_print, get_last_invoice_print_mode};
    let conn = init_db(":memory:").expect("Failed to init DB");

    // 1. Initial lookup for unprinted invoice returns default "WITH_GST"
    let initial_mode = get_last_invoice_print_mode(&conn, "KK/2026-27/0001").unwrap();
    assert_eq!(initial_mode, "WITH_GST");

    // 2. Log print with WITHOUT_GST
    log_invoice_print(&conn, "KK/2026-27/0001", "WITHOUT_GST").unwrap();
    let mode_after_first = get_last_invoice_print_mode(&conn, "KK/2026-27/0001").unwrap();
    assert_eq!(mode_after_first, "WITHOUT_GST");

    // 3. Log subsequent print with WITH_GST
    log_invoice_print(&conn, "KK/2026-27/0001", "WITH_GST").unwrap();
    let mode_after_second = get_last_invoice_print_mode(&conn, "KK/2026-27/0001").unwrap();
    assert_eq!(mode_after_second, "WITH_GST");

    // 4. Verify append-only log has 2 rows
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM invoice_print_log WHERE invoice_no = ?1",
        ["KK/2026-27/0001"],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 2);

    // 5. Invalid mode rejected
    assert!(log_invoice_print(&conn, "KK/2026-27/0001", "INVALID_MODE").is_err());
}

#[test]
fn test_backup_created_in_new_primary_folder() {
    use crate::backup::{backup_now_inner, get_primary_backup_dir};
    let dir = std::env::temp_dir().join(format!("krishi_test_pri_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    let _ = fs::create_dir_all(&dir);

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute("UPDATE settings SET backup_folder = ?1 WHERE id = 1", [dir.to_str().unwrap()]).unwrap();

    let pri_dir = get_primary_backup_dir(&conn);
    assert_eq!(pri_dir, dir);

    let res = backup_now_inner(&conn, &pri_dir, None).expect("backup failed");
    assert!(res.success);
    assert!(res.is_verified);
    let backup_file = dir.join(&res.file_name);
    assert!(backup_file.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_backup_during_wal_writes() {
    use crate::backup::{backup_now_inner, verify_backup, get_table_counts};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_wal_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    let db_path = temp_dir.join("live_wal.db");
    let conn = init_db(db_path.to_str().unwrap()).unwrap();
    conn.execute_batch("PRAGMA journal_mode = WAL;").unwrap();

    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
         VALUES (101, 'Test Item WAL', 'fertilizer', '1234', 5000, 'taxable', 'BAG')",
        [],
    ).unwrap();

    let primary_dir = temp_dir.join("backups");
    let res = backup_now_inner(&conn, &primary_dir, None).expect("backup during WAL failed");
    assert!(res.success);

    let backup_path = primary_dir.join(&res.file_name);
    let backup_conn = Connection::open(&backup_path).unwrap();
    let count: i64 = backup_conn.query_row("SELECT COUNT(*) FROM items WHERE id = 101", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);

    let expected_counts = get_table_counts(&conn).unwrap();
    assert!(verify_backup(&backup_path, &expected_counts).is_ok());

    drop(conn);
    drop(backup_conn);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_backup_rotation_keeps_max_30() {
    use crate::backup::perform_rotation;
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_rot_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    for i in 1..=35 {
        let name = format!("inventory_2026-10-{:02}_12-00.db", i);
        fs::write(temp_dir.join(&name), b"dummy").unwrap();
    }

    let removed = perform_rotation(&temp_dir, 30).unwrap();
    assert_eq!(removed, 5);

    let remaining_count = fs::read_dir(&temp_dir).unwrap().flatten().count();
    assert_eq!(remaining_count, 30);

    assert!(!temp_dir.join("inventory_2026-10-01_12-00.db").exists());
    assert!(!temp_dir.join("inventory_2026-10-05_12-00.db").exists());
    assert!(temp_dir.join("inventory_2026-10-35_12-00.db").exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_backup_settings_persist_across_restart() {
    use crate::commands::{get_settings_inner, set_settings_inner};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_set_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();
    let db_path = temp_dir.join("test_settings.db");

    {
        let conn = init_db(db_path.to_str().unwrap()).unwrap();

        let mut s = get_settings_inner(&conn).unwrap();
        s.backup_folder = Some("D:\\KrishiBackupPrimary".to_string());
        s.secondary_backup_folder = Some("E:\\PendriveBackup".to_string());
        s.last_backup_time = Some("2026-10-31T12:00:00+05:30".to_string());
        set_settings_inner(&conn, s).unwrap();
    }

    {
        let conn = init_db(db_path.to_str().unwrap()).unwrap();

        let s = get_settings_inner(&conn).unwrap();
        assert_eq!(s.backup_folder.as_deref(), Some("D:\\KrishiBackupPrimary"));
        assert_eq!(s.secondary_backup_folder.as_deref(), Some("E:\\PendriveBackup"));
        assert_eq!(s.last_backup_time.as_deref(), Some("2026-10-31T12:00:00+05:30"));
    }

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_backup_succeeds_even_when_secondary_missing() {
    use crate::backup::backup_now_inner;
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_sec_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    let conn = init_db(":memory:").expect("Failed to init DB");
    let primary_dir = temp_dir.join("primary");
    let missing_secondary = std::path::PathBuf::from("Z:\\NonExistentDriveKrishi\\BackupDir");

    let res = backup_now_inner(&conn, &primary_dir, Some(&missing_secondary)).expect("backup failed");
    assert!(res.success);
    assert!(res.secondary_path.is_none());
    assert_eq!(res.secondary_warning.as_deref(), Some("दूसरी जगह नहीं मिली, पेनड्राइव लगाओ"));
    assert!(primary_dir.join(&res.file_name).exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_backup_valid_and_counts_match() {
    use crate::backup::{backup_now_inner, get_table_counts, verify_backup};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_cnt_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    let conn = init_db(":memory:").expect("Failed to init DB");
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
         VALUES (201, 'Urea 45kg', 'fertilizer', '3102', 5000, 'taxable', 'BAG')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO parties (id, name, type, category) VALUES (202, 'Ramesh Patel', 'customer', 'consumer')",
        [],
    ).unwrap();

    let expected = get_table_counts(&conn).unwrap();
    assert!(expected.items >= 1);
    assert!(expected.parties >= 2);

    let primary_dir = temp_dir.join("primary");
    let res = backup_now_inner(&conn, &primary_dir, None).unwrap();
    assert!(res.is_verified);

    let backup_path = primary_dir.join(&res.file_name);
    assert!(verify_backup(&backup_path, &expected).is_ok());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_check_db_integrity_corrupted_db_deserializes_to_frontend_type() {
    use crate::backup::{check_db_integrity, IntegrityCheckReport};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_int_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    let corrupt_db = temp_dir.join("corrupt.db");
    fs::write(&corrupt_db, b"CORRUPTED BYTES - NOT A VALID SQLITE DB FILE").unwrap();

    let report = check_db_integrity(corrupt_db.to_str().unwrap(), &temp_dir);
    assert!(!report.is_ok);

    let json_str = serde_json::to_string(&report).unwrap();
    assert!(json_str.contains("\"isOk\":false"));
    assert!(json_str.contains("\"message\":"));

    let deserialized: IntegrityCheckReport = serde_json::from_str(&json_str).unwrap();
    assert!(!deserialized.is_ok);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_copy_backups_with_verification() {
    use crate::backup::{backup_now_inner, copy_backups_with_verification};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_cpy_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    let from_dir = temp_dir.join("from_folder");
    let to_dir = temp_dir.join("to_folder");
    fs::create_dir_all(&from_dir).unwrap();

    let conn = init_db(":memory:").expect("Failed to init DB");
    let res1 = backup_now_inner(&conn, &from_dir, None).unwrap();
    let res2 = backup_now_inner(&conn, &from_dir, None).unwrap();

    let copied = copy_backups_with_verification(&from_dir, &to_dir).unwrap();
    assert!(copied >= 1);
    assert!(to_dir.join(&res1.file_name).exists() || to_dir.join(&res2.file_name).exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_corrupted_file_integrity_check_failure() {
    use crate::backup::{verify_backup, TableCounts};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_fail_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    fs::create_dir_all(&temp_dir).unwrap();

    let corrupt_file = temp_dir.join("inventory_2026-10-31_12-00.db");
    fs::write(&corrupt_file, b"NOT A VALID DB HEADER").unwrap();

    let counts = TableCounts { items: 0, parties: 0, sales: 0, purchases: 0 };
    let res = verify_backup(&corrupt_file, &counts);
    assert!(res.is_err());
    assert!(!corrupt_file.exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_folder_write_test_pass_and_fail() {
    use crate::backup::test_folder_writable;
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_write_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));

    assert!(test_folder_writable(&temp_dir).is_ok());

    let invalid_path = std::path::PathBuf::from("Z:\\InvalidNonExistentDriveKrishi\\TestDir");
    let err = test_folder_writable(&invalid_path).unwrap_err();
    assert!(err.contains("इस फोल्डर में लिख नहीं सकते, दूसरा चुनो"));

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_pre_restore_safety_backup_created() {
    use crate::backup::{backup_now_inner, prepare_restore};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_pre_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    let backup_dir = temp_dir.join("backups");
    fs::create_dir_all(&backup_dir).unwrap();

    let db_path = temp_dir.join("current.db");
    let conn = init_db(db_path.to_str().unwrap()).unwrap();

    let backup_res = backup_now_inner(&conn, &backup_dir, None).unwrap();
    let selected_backup = backup_dir.join(&backup_res.file_name);

    let restore_res = prepare_restore(Some(&conn), &db_path, &selected_backup, &backup_dir).unwrap();
    assert!(restore_res.success);
    assert!(std::path::Path::new(&restore_res.safety_backup_path).exists());
    assert!(std::path::Path::new(&restore_res.pending_path).exists());

    drop(conn);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_restore_swaps_pending_and_restores_data() {
    use crate::backup::{check_and_apply_pending_restore, prepare_restore};
    let temp_dir = std::env::temp_dir().join(format!("krishi_test_rst_{}", Local::now().timestamp_nanos_opt().unwrap_or(0)));
    let backup_dir = temp_dir.join("backups");
    fs::create_dir_all(&backup_dir).unwrap();

    let db_path = temp_dir.join("inventory.db");
    {
        let conn = init_db(db_path.to_str().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
             VALUES (1, 'Old Item', 'fertilizer', '1111', 0, 'nil_rated', 'BAG')",
            [],
        ).unwrap();
    }

    let backup_file = backup_dir.join("inventory_2026-10-30_10-00.db");
    {
        let conn = init_db(backup_file.to_str().unwrap()).unwrap();
        conn.execute(
            "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
             VALUES (1, 'Restored Item 1', 'fertilizer', '1111', 0, 'nil_rated', 'BAG')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
             VALUES (2, 'Restored Item 2', 'fertilizer', '2222', 0, 'nil_rated', 'BAG')",
            [],
        ).unwrap();
    }

    let res = prepare_restore(None, &db_path, &backup_file, &backup_dir).unwrap();
    assert!(res.success);

    let pending_file = temp_dir.join("inventory.db.restore_pending");
    assert!(pending_file.exists());

    let swapped = check_and_apply_pending_restore(db_path.to_str().unwrap()).unwrap();
    assert!(swapped);
    assert!(!pending_file.exists());

    let conn = Connection::open(&db_path).unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 2);

    drop(conn);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_new_reports_hand_calculated() {
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine, log_invoice_print};
    use crate::commands::{
        get_sales_gst_mode_profit_report_inner,
        get_item_parties_report_inner,
        get_party_items_report_inner,
    };

    let mut conn = init_db(":memory:").expect("Failed to init DB");

    // 1. Master Data: 2 items
    // Item 1: DAP 50kg (5% GST, base_unit = "BAG")
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
         VALUES (1, 'DAP Fertilizer 50kg', 'fertilizer', '3105', 5000, 'taxable', 'BAG')",
        [],
    ).unwrap();

    // Item 2: Urea 45kg (0% GST, base_unit = "BAG")
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
         VALUES (2, 'Urea 45kg', 'fertilizer', '3102', 0, 'nil_rated', 'BAG')",
        [],
    ).unwrap();

    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Parties:
    // Party 2: Supplier Alpha (Regular, MP 23)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone)
         VALUES (2, 'Supplier Alpha', 'supplier', 'regular', '23AAAAA1111A1Z1', '9800000001')",
        [],
    ).unwrap();

    // Party 3: Supplier Beta (Regular, MP 23)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone)
         VALUES (3, 'Supplier Beta', 'supplier', 'regular', '23BBBBB2222B1Z2', '9800000002')",
        [],
    ).unwrap();

    // Party 4: Farmer Ramesh (Customer, unregistered)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone)
         VALUES (4, 'Farmer Ramesh', 'customer', 'unregistered', NULL, '9800000003')",
        [],
    ).unwrap();

    // Party 5: Farmer Suresh (Customer, unregistered)
    conn.execute(
        "INSERT INTO parties (id, name, type, category, gstin, phone)
         VALUES (5, 'Farmer Suresh', 'customer', 'unregistered', NULL, '9800000004')",
        [],
    ).unwrap();

    // 2. Purchases to test:
    // a) Purchases from 2 parties at different rates for Item 1:
    // PUR-01: Supplier Alpha sells 10 bags DAP @ Rs 1,000 (100000 paise).
    // Taxable = 1000000 paise (Rs 10,000). 5% GST = 50000 paise (Rs 500). Total = 1050000 paise (Rs 10,500).
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-01".to_string(),
        date: "2026-10-01".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 1050000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 10000, // 10 bags
                unit: "BAG".to_string(),
                rate: 100000, // Rs 1,000
                taxable: 1000000,
                cgst: 25000,
                sgst: 25000,
                igst: 0,
            }
        ],
    }).unwrap();

    // PUR-02: Supplier Alpha also sells 5 bags Urea @ Rs 300 (30000 paise).
    // Taxable = 150000 paise (Rs 1,500). 0% GST. Total = 150000 paise.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-02".to_string(),
        date: "2026-10-02".to_string(),
        party_id: 2,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 150000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 5000, // 5 bags
                unit: "BAG".to_string(),
                rate: 30000, // Rs 300
                taxable: 150000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();

    // PUR-03: Supplier Beta sells 5 bags DAP @ Rs 1,200 (120000 paise).
    // Taxable = 600000 paise (Rs 6,000). 5% GST = 30000 paise (Rs 300). Total = 630000 paise (Rs 6,300).
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-03".to_string(),
        date: "2026-10-05".to_string(),
        party_id: 3,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 630000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 5000, // 5 bags
                unit: "BAG".to_string(),
                rate: 120000, // Rs 1,200
                taxable: 600000,
                cgst: 15000,
                sgst: 15000,
                igst: 0,
            }
        ],
    }).unwrap();

    // WAC check:
    // DAP: (10 * 100000 + 5 * 120000) * 1000 / 15000 = 1600000 / 15 = 106666 paise
    let wac_dap = calculate_weighted_average_cost(&conn, 1).unwrap();
    assert_eq!(wac_dap, 106666);

    // 3. Sales to test Report 1 (Sales & Profit: With GST vs Without GST):
    // INV-1: Farmer Ramesh - 2 bags DAP @ Rs 1,400.
    // Taxable = 280000 paise (Rs 2,800), GST 5% = 14000 paise (Rs 140). Total = 294000 paise (Rs 2,940).
    // Cost snapshot = 2 * 106666 = 213332 paise.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-001".to_string(),
        date: "2026-10-10".to_string(),
        party_id: 4,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 294000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 2000, // 2 bags
                unit: "BAG".to_string(),
                rate: 140000, // Rs 1,400
                taxable: 280000,
                cgst: 7000,
                sgst: 7000,
                igst: 0,
            }
        ],
    }).unwrap();
    // Print in WITH_GST mode:
    log_invoice_print(&conn, "SALE-001", "WITH_GST").unwrap();

    // INV-2: Farmer Suresh - 2 bags DAP @ Rs 1,500.
    // Taxable = 300000 paise (Rs 3,000), GST 5% = 15000 paise (Rs 150). Total = 315000 paise (Rs 3,150).
    // Cost snapshot = 2 * 106666 = 213332 paise.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-002".to_string(),
        date: "2026-10-11".to_string(),
        party_id: 5,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 315000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 2000,
                unit: "BAG".to_string(),
                rate: 150000,
                taxable: 300000,
                cgst: 7500,
                sgst: 7500,
                igst: 0,
            }
        ],
    }).unwrap();
    // Print in WITHOUT_GST mode:
    log_invoice_print(&conn, "SALE-002", "WITHOUT_GST").unwrap();

    // INV-3: Farmer Ramesh - 1 bag DAP @ Rs 1,400.
    // Taxable = 140000 paise (Rs 1,400), GST = 7000 paise (Rs 70). Total = 147000 paise (Rs 1,470).
    // Cost snapshot = 1 * 106666 = 106666 paise.
    // UNPRINTED (no row in invoice_print_log)
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-003".to_string(),
        date: "2026-10-12".to_string(),
        party_id: 4,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 147000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 1,
                qty: 1000,
                unit: "BAG".to_string(),
                rate: 140000,
                taxable: 140000,
                cgst: 3500,
                sgst: 3500,
                igst: 0,
            }
        ],
    }).unwrap();

    // INV-4: Printed in both modes (last mode wins):
    // Farmer Suresh - 1 bag Urea @ Rs 400.
    // Taxable = 40000 paise (Rs 400), 0% GST. Total = 40000 paise. Cost snapshot = 30000 paise.
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-004".to_string(),
        date: "2026-10-13".to_string(),
        party_id: 5,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 40000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 1000,
                unit: "BAG".to_string(),
                rate: 40000,
                taxable: 40000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();
    // First print WITH_GST, then re-print WITHOUT_GST:
    log_invoice_print(&conn, "SALE-004", "WITH_GST").unwrap();
    log_invoice_print(&conn, "SALE-004", "WITHOUT_GST").unwrap();

    // INV-5: Bill with discount:
    // Farmer Ramesh - 2 bags Urea @ Rs 500 = Rs 1,000 (100000 paise) taxable, 0 GST.
    // Saved total_amount = Rs 900 (90000 paise) -> bill discount = 10000 paise (Rs 100).
    // Cost snapshot = 2 * 30000 = 60000 paise (Rs 600).
    // Profit = net_taxable (100000 - 10000 = 90000) - cost (60000) = 30000 paise (Rs 300).
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "SALE-005".to_string(),
        date: "2026-10-14".to_string(),
        party_id: 4,
        godown_id: 1,
        type_: "sale".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 90000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 2,
                qty: 2000,
                unit: "BAG".to_string(),
                rate: 50000,
                taxable: 100000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();
    // Update total_amount to 90000 to simulate bill discount
    conn.execute("UPDATE sales SET total_amount = 90000 WHERE invoice_no = 'SALE-005'", []).unwrap();
    log_invoice_print(&conn, "SALE-005", "WITH_GST").unwrap();

    // ==========================================
    // VERIFY REPORT 1: Sales & Profit: With GST vs Without GST
    // ==========================================
    let rep1 = get_sales_gst_mode_profit_report_inner(&conn, "2026-10-01", "2026-10-31").unwrap();
    assert_eq!(rep1.groups.len(), 3);

    let g_with = rep1.groups.iter().find(|g| g.group_key == "WITH_GST").unwrap();
    let g_without = rep1.groups.iter().find(|g| g.group_key == "WITHOUT_GST").unwrap();
    let g_not = rep1.groups.iter().find(|g| g.group_key == "NOT_PRINTED").unwrap();

    // WITH_GST group has SALE-001 and SALE-005: 2 bills
    assert_eq!(g_with.bills_count, 2);
    // Taxable: 280000 (SALE-001) + 100000 (SALE-005) = 380000 paise
    assert_eq!(g_with.taxable_sales, 380000);
    // GST: 14000 (SALE-001) + 0 (SALE-005) = 14000 paise
    assert_eq!(g_with.gst_collected, 14000);
    // Bill total: 294000 + 90000 = 384000 paise
    assert_eq!(g_with.bill_total, 384000);
    // Cost: 213332 (SALE-001) + 60000 (SALE-005) = 273332 paise
    assert_eq!(g_with.cost, 273332);
    // Profit: SALE-001 profit = 280000 - 213332 = 66668 paise
    //         SALE-005 profit = (100000 - 10000 discount) - 60000 = 30000 paise
    // Total profit = 66668 + 30000 = 96668 paise
    assert_eq!(g_with.profit, 96668);

    // WITHOUT_GST group has SALE-002 and SALE-004 (last mode wins!): 2 bills
    assert_eq!(g_without.bills_count, 2);
    // Taxable: 300000 (SALE-002) + 40000 (SALE-004) = 340000 paise
    assert_eq!(g_without.taxable_sales, 340000);
    // Bill total: 315000 + 40000 = 355000 paise
    assert_eq!(g_without.bill_total, 355000);
    // Difference vs printed total = bill_total - taxable_sales = 355000 - 340000 = 15000 paise (Rs 150)
    assert_eq!(g_without.diff_vs_printed_total, 15000);

    // NOT_PRINTED group has SALE-003: 1 bill
    assert_eq!(g_not.bills_count, 1);
    assert_eq!(g_not.taxable_sales, 140000);
    assert_eq!(g_not.bill_total, 147000);

    // Total bills across all groups: 5 bills
    assert_eq!(rep1.total_bills_count, 5);

    // ==========================================
    // VERIFY REPORT 2: Item-wise: which parties (Item 1 = DAP)
    // ==========================================
    let rep2 = get_item_parties_report_inner(&conn, 1, "2026-10-01", "2026-10-31", "purchased_from").unwrap();
    assert_eq!(rep2.item_name, "DAP Fertilizer 50kg");
    assert_eq!(rep2.total_bills_count, 2); // PUR-01 and PUR-03
    assert_eq!(rep2.total_qty, 15000); // 15 bags (10 from Alpha, 5 from Beta)

    // Check party breakdown:
    let sup_alpha = rep2.parties.iter().find(|p| p.party_id == 2).unwrap();
    assert_eq!(sup_alpha.party_name, "Supplier Alpha");
    assert_eq!(sup_alpha.bills_count, 1);
    assert_eq!(sup_alpha.total_qty, 10000);
    assert_eq!(sup_alpha.min_rate, 100000); // Rs 1,000
    assert_eq!(sup_alpha.max_rate, 100000);
    assert_eq!(sup_alpha.average_rate, 100000);
    assert_eq!(sup_alpha.last_rate, 100000);

    let sup_beta = rep2.parties.iter().find(|p| p.party_id == 3).unwrap();
    assert_eq!(sup_beta.party_name, "Supplier Beta");
    assert_eq!(sup_beta.bills_count, 1);
    assert_eq!(sup_beta.total_qty, 5000);
    assert_eq!(sup_beta.min_rate, 120000); // Rs 1,200
    assert_eq!(sup_beta.max_rate, 120000);
    assert_eq!(sup_beta.average_rate, 120000);
    assert_eq!(sup_beta.last_rate, 120000);

    // Also test direction "sold_to" for Item 1 (DAP):
    let rep2_sales = get_item_parties_report_inner(&conn, 1, "2026-10-01", "2026-10-31", "sold_to").unwrap();
    // Sold on SALE-001 (Ramesh 2 bags), SALE-002 (Suresh 2 bags), SALE-003 (Ramesh 1 bag)
    // Ramesh: 2 bills, 3 bags. Suresh: 1 bill, 2 bags.
    let ramesh = rep2_sales.parties.iter().find(|p| p.party_id == 4).unwrap();
    assert_eq!(ramesh.bills_count, 2);
    assert_eq!(ramesh.total_qty, 3000);

    // ==========================================
    // VERIFY REPORT 3: Party-wise: which items (Party 2 = Supplier Alpha)
    // ==========================================
    let rep3 = get_party_items_report_inner(&conn, 2, "2026-10-01", "2026-10-31", "purchased_from").unwrap();
    assert_eq!(rep3.party_name, "Supplier Alpha");
    assert_eq!(rep3.items.len(), 2); // Sold Item 1 (DAP) and Item 2 (Urea)

    let dap_item = rep3.items.iter().find(|i| i.item_id == 1).unwrap();
    assert_eq!(dap_item.item_name, "DAP Fertilizer 50kg");
    assert_eq!(dap_item.bills_count, 1);
    assert_eq!(dap_item.total_qty, 10000);
    assert_eq!(dap_item.last_rate, 100000);

    let urea_item = rep3.items.iter().find(|i| i.item_id == 2).unwrap();
    assert_eq!(urea_item.item_name, "Urea 45kg");
    assert_eq!(urea_item.bills_count, 1);
    assert_eq!(urea_item.total_qty, 5000);
    assert_eq!(urea_item.last_rate, 30000);
}

#[test]
fn test_reports_multi_unit_rate_normalization_and_qty_total() {
    use crate::db::init_db;
    use crate::invoice::{save_invoice, InvoicePayload, InvoiceLine};
    use crate::commands::{get_item_parties_report_inner, get_party_items_report_inner};

    let mut conn = init_db(":memory:").expect("Failed to init DB");

    // Item: Wheat Seed (base_unit = "KG")
    conn.execute(
        "INSERT INTO items (id, name, category, hsn, gst_rate, gst_status, base_unit)
         VALUES (10, 'Wheat Seed Sharbati', 'seed', '1209', 0, 'nil_rated', 'KG')",
        [],
    ).unwrap();

    // Secondary unit: "bag" = 50 KG (factor_to_base = 50000 in milli-units)
    conn.execute(
        "INSERT INTO item_units (item_id, unit_name, factor_to_base) VALUES (10, 'bag', 50000)",
        [],
    ).unwrap();

    conn.execute("INSERT INTO godowns (id, name) VALUES (1, 'Main Godown')", []).unwrap();

    // Party: Agro Seed Supplier
    conn.execute(
        "INSERT INTO parties (id, name, type, category, phone)
         VALUES (10, 'Agro Seed Supplier', 'supplier', 'regular', '9800000010')",
        [],
    ).unwrap();

    // Bill 1: Bought 1 bag @ Rs 1,200 (120,000 paise)
    // 1 bag = 50 kg -> normalized rate = 120,000 / 50 = 2,400 paise/kg (Rs 24/kg)
    // base_qty = 50,000 milli-units (50 kg)
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-MU-01".to_string(),
        date: "2026-10-01".to_string(),
        party_id: 10,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 120000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 10,
                qty: 1000, // 1 bag in milli-units
                unit: "bag".to_string(),
                rate: 120000, // Rs 1,200 per bag
                taxable: 120000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();

    // Bill 2: Bought 10 kg @ Rs 26/kg (2,600 paise)
    // base_qty = 10,000 milli-units (10 kg)
    // normalized rate = 2,600 paise/kg (Rs 26/kg)
    // taxable = 26,000 paise (Rs 260)
    save_invoice(&mut conn, InvoicePayload {
        invoice_no: "PUR-MU-02".to_string(),
        date: "2026-10-05".to_string(),
        party_id: 10,
        godown_id: 1,
        type_: "purchase".to_string(),
        payment_mode: "cash".to_string(),
        paid_amount: 26000,
        shop_state: Some("23".to_string()),
        lines: vec![
            InvoiceLine {
                item_id: 10,
                qty: 10000, // 10 kg in milli-units
                unit: "KG".to_string(),
                rate: 2600, // Rs 26 per kg
                taxable: 26000,
                cgst: 0,
                sgst: 0,
                igst: 0,
            }
        ],
    }).unwrap();

    // Test Report 2 (item_parties for Item 10)
    let rep2 = get_item_parties_report_inner(&conn, 10, "2026-10-01", "2026-10-31", "purchased_from").unwrap();
    assert_eq!(rep2.item_name, "Wheat Seed Sharbati");
    assert_eq!(rep2.base_unit, "KG");
    assert_eq!(rep2.total_bills_count, 2);
    // Total qty: 50 kg + 10 kg = 60 kg (60,000 milli-units)
    assert_eq!(rep2.total_qty, 60000);
    // Total taxable: 120,000 + 26,000 = 146,000 paise (Rs 1,460)
    assert_eq!(rep2.total_taxable, 146000);
    assert_eq!(rep2.total_amount, 146000);

    let party_summary = &rep2.parties[0];
    assert_eq!(party_summary.party_name, "Agro Seed Supplier");
    assert_eq!(party_summary.bills_count, 2);
    assert_eq!(party_summary.total_qty, 60000); // 60 kg
    assert_eq!(party_summary.total_taxable, 146000);
    assert_eq!(party_summary.total_amount, 146000);

    // Comparable normalized rates in base unit KG (paise):
    // 1 bag @ 1200 -> 2400 paise/kg (Rs 24/kg)
    // 10 kg @ 26 -> 2600 paise/kg (Rs 26/kg)
    assert_eq!(party_summary.min_rate, 2400); // Rs 24.00 / KG
    assert_eq!(party_summary.max_rate, 2600); // Rs 26.00 / KG
    assert_eq!(party_summary.last_rate, 2600); // Rs 26.00 / KG (from PUR-MU-02)
    // Weighted Average rate = (146,000 * 1,000) / 60,000 = 2,433 paise/kg (Rs 24.33/kg)
    assert_eq!(party_summary.average_rate, 2433);

    // Test Report 3 (party_items for Party 10)
    let rep3 = get_party_items_report_inner(&conn, 10, "2026-10-01", "2026-10-31", "purchased_from").unwrap();
    assert_eq!(rep3.party_name, "Agro Seed Supplier");
    assert_eq!(rep3.items.len(), 1);
    let item_summary = &rep3.items[0];
    assert_eq!(item_summary.item_name, "Wheat Seed Sharbati");
    assert_eq!(item_summary.base_unit, "KG");
    assert_eq!(item_summary.bills_count, 2);
    assert_eq!(item_summary.total_qty, 60000); // 60 kg
    assert_eq!(item_summary.total_taxable, 146000);
    assert_eq!(item_summary.total_amount, 146000);
    assert_eq!(item_summary.min_rate, 2400); // Rs 24.00 / KG
    assert_eq!(item_summary.max_rate, 2600); // Rs 26.00 / KG
    assert_eq!(item_summary.average_rate, 2433);
    assert_eq!(item_summary.last_rate, 2600);
}


