use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportPdfRequest {
    pub html: String,
    pub invoice_no: String,
    pub customer_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ExportPdfResponse {
    pub success: bool,
    pub message: String,
    pub pdf_path: String,
    pub filename: String,
    pub directory: String,
}

pub fn get_invoices_directory() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let docs = Path::new(&profile).join("Documents").join("Krishi Kendra Invoices");
            if let Err(e) = fs::create_dir_all(&docs) {
                eprintln!("[Krishi Kendra] Failed to create Documents invoice dir: {}", e);
            } else {
                return docs;
            }
        }
    }

    let temp = std::env::temp_dir().join("Krishi Kendra Invoices");
    let _ = fs::create_dir_all(&temp);
    temp
}

fn find_browser_for_pdf() -> Option<PathBuf> {
    let candidate_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];

    for path_str in candidate_paths {
        let p = Path::new(path_str);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    None
}

pub fn export_invoice_pdf_impl(req: ExportPdfRequest) -> Result<ExportPdfResponse, String> {
    // 1. Sanitize filename
    let safe_invoice = req.invoice_no
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");

    let safe_customer = req.customer_name
        .map(|n| {
            let cleaned = n.trim().replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', ' '], "_");
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("_{cleaned}")
            }
        })
        .unwrap_or_default();

    let filename = format!("{safe_invoice}{safe_customer}.pdf");
    let target_dir = get_invoices_directory();
    let pdf_path = target_dir.join(&filename);

    // 2. Write temp HTML file
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_html_file = temp_dir.join(format!("krishi_invoice_{timestamp}.html"));

    fs::write(&temp_html_file, req.html.as_bytes())
        .map_err(|e| format!("अस्थायी HTML फ़ाइल बनाने में त्रुटि: {e}"))?;

    // 3. Find Edge / Chrome to generate PDF
    #[cfg(target_os = "windows")]
    {
        let browser_path = find_browser_for_pdf()
            .ok_or_else(|| "PDF बनाने के लिए Microsoft Edge या Chrome नहीं मिला।".to_string())?;

        let file_url = format!("file:///{}", temp_html_file.to_string_lossy().replace('\\', "/"));
        let print_arg = format!("--print-to-pdf={}", pdf_path.to_string_lossy());

        let output = Command::new(&browser_path)
            .args([
                "--headless",
                "--disable-gpu",
                "--no-pdf-header-footer",
                &print_arg,
                &file_url,
            ])
            .output()
            .map_err(|e| format!("PDF इंजन चलाने में त्रुटि: {e}"))?;

        let _ = fs::remove_file(&temp_html_file);

        if !pdf_path.exists() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PDF फ़ाइल नहीं बन सकी: {stderr}"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = fs::remove_file(&temp_html_file);
        fs::write(&pdf_path, b"%PDF-1.4 Mock Invoice PDF Content")
            .map_err(|e| format!("Mock PDF error: {e}"))?;
    }

    Ok(ExportPdfResponse {
        success: true,
        message: "बिल का PDF सफलतापूर्वक तैयार हुआ।".to_string(),
        pdf_path: pdf_path.to_string_lossy().to_string(),
        filename,
        directory: target_dir.to_string_lossy().to_string(),
    })
}

pub fn open_file_in_explorer_impl(path_str: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let p = Path::new(path_str);
        if p.exists() {
            if p.is_file() {
                Command::new("explorer")
                    .args(["/select,", path_str])
                    .spawn()
                    .map_err(|e| format!("Explorer error: {e}"))?;
            } else {
                Command::new("explorer")
                    .arg(path_str)
                    .spawn()
                    .map_err(|e| format!("Explorer error: {e}"))?;
            }
        } else {
            let parent = p.parent().unwrap_or(p);
            Command::new("explorer")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Explorer error: {e}"))?;
        }
    }
    Ok(())
}

pub fn open_external_url_impl(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map_err(|e| format!("URL error: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invoices_directory_exists() {
        let dir = get_invoices_directory();
        assert!(dir.exists(), "Invoices directory must exist");
    }

    #[test]
    fn test_export_invoice_pdf_mock() {
        let req = ExportPdfRequest {
            html: "<html><body><h1>Bill INV-001</h1></body></html>".to_string(),
            invoice_no: "INV/2026/001".to_string(),
            customer_name: Some("Ramesh Patel".to_string()),
        };
        let res = export_invoice_pdf_impl(req);
        assert!(res.is_ok(), "Export PDF should succeed: {:?}", res.err());
        let val = res.unwrap();
        assert!(val.success);
        assert!(val.filename.contains("INV_2026_001_Ramesh_Patel.pdf"));
        assert!(Path::new(&val.pdf_path).exists());
        // Clean up
        let _ = fs::remove_file(&val.pdf_path);
    }
}
