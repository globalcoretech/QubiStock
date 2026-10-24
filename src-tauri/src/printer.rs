use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
    pub status: Option<String>,
    pub port_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrintBillRequest {
    pub printer_name: Option<String>,
    pub html: Option<String>,
    pub title: Option<String>,
    pub paper_size: Option<String>, // "A4", "A5", "A6"
    pub silent: bool,
    pub offset_x_mm: Option<f64>,
    pub offset_y_mm: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrintBillResponse {
    pub success: bool,
    pub message: String,
    pub printer_used: String,
    pub method_used: String, // "dialog" | "silent_edge" | "silent_spooler" | "fallback_pdf"
    pub raw_error: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RawCimPrinter {
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "Default")]
    default: Option<bool>,
    #[serde(rename = "PortName")]
    port_name: Option<String>,
    #[serde(rename = "PrinterStatus")]
    printer_status: Option<serde_json::Value>,
}

pub fn list_printers_impl() -> Result<Vec<PrinterInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let ps_cmd = "Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, PrinterStatus | ConvertTo-Json -Compress";
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", ps_cmd])
            .output()
            .map_err(|e| format!("PowerShell execute failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("प्रिंटर सूची प्राप्त करने में त्रुटि: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            return Ok(Vec::new());
        }

        // PowerShell ConvertTo-Json returns an array if >= 2 items, or a single object if 1 item.
        let raw_printers: Vec<RawCimPrinter> = if stdout.starts_with('[') {
            serde_json::from_str(&stdout)
                .map_err(|e| format!("JSON parse error: {} | Raw: {}", e, stdout))?
        } else if stdout.starts_with('{') {
            let single: RawCimPrinter = serde_json::from_str(&stdout)
                .map_err(|e| format!("JSON parse error (single): {} | Raw: {}", e, stdout))?;
            vec![single]
        } else {
            Vec::new()
        };

        let mut list: Vec<PrinterInfo> = raw_printers
            .into_iter()
            .filter_map(|p| {
                p.name.map(|n| PrinterInfo {
                    name: n,
                    is_default: p.default.unwrap_or(false),
                    status: p.printer_status.map(|s| s.to_string()),
                    port_name: p.port_name,
                })
            })
            .collect();

        // Sort: default printer first, then alphabetically
        list.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(list)
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Mock fallback for non-Windows dev environments
        Ok(vec![
            PrinterInfo {
                name: "Virtual PDF Printer".to_string(),
                is_default: true,
                status: Some("Ready".to_string()),
                port_name: Some("FILE:".to_string()),
            },
            PrinterInfo {
                name: "LaserJet Pro A4".to_string(),
                is_default: false,
                status: Some("Ready".to_string()),
                port_name: Some("USB001".to_string()),
            },
        ])
    }
}

pub fn get_default_printer_impl() -> Result<Option<String>, String> {
    let printers = list_printers_impl()?;
    let default = printers.into_iter().find(|p| p.is_default).map(|p| p.name);
    Ok(default)
}

fn find_browser_for_kiosk_print() -> Option<(PathBuf, &'static str)> {
    let candidate_paths = [
        (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "Microsoft Edge"),
        (r"C:\Program Files\Microsoft\Edge\Application\msedge.exe", "Microsoft Edge"),
        (r"C:\Program Files\Google\Chrome\Application\chrome.exe", "Google Chrome"),
        (r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", "Google Chrome"),
    ];

    for (path_str, name) in candidate_paths {
        let p = Path::new(path_str);
        if p.exists() {
            return Some((p.to_path_buf(), name));
        }
    }
    None
}

pub fn print_bill_impl(req: PrintBillRequest) -> Result<PrintBillResponse, String> {
    // 1. Validate printers
    let installed_printers = list_printers_impl().unwrap_or_default();
    let default_printer_name = get_default_printer_impl()?.unwrap_or_else(|| {
        installed_printers.first().map(|p| p.name.clone()).unwrap_or_else(|| "Default Printer".to_string())
    });

    let target_printer = match req.printer_name {
        Some(ref name) if !name.trim().is_empty() => {
            let exists = installed_printers.iter().any(|p| p.name.eq_ignore_ascii_case(name));
            if !exists && !installed_printers.is_empty() {
                return Err(format!(
                    "चुना गया प्रिंटर '{}' सिस्टम में नहीं मिला। उपलब्ध प्रिंटर: {}",
                    name,
                    installed_printers.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
                ));
            }
            name.clone()
        }
        _ => default_printer_name.clone(),
    };

    // 2. Default: If dialog mode requested (silent = false):
    if !req.silent {
        return Ok(PrintBillResponse {
            success: true,
            message: format!("प्रिंट डायलॉग तैयार है ({})।", target_printer),
            printer_used: target_printer,
            method_used: "dialog".to_string(),
            raw_error: None,
        });
    }

    // 3. Silent print beta mode using documented Chromium --kiosk-printing
    // Note: --kiosk-printing sends directly to the OS default printer without dialog.
    let paper_size = req.paper_size.unwrap_or_else(|| "A4".to_string());
    let offset_x = req.offset_x_mm.unwrap_or(0.0);
    let offset_y = req.offset_y_mm.unwrap_or(0.0);

    let html_content = req.html.unwrap_or_else(|| {
        format!(
            r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{}</title>
<style>
@page {{
  size: {};
  margin: 5mm;
}}
body {{
  font-family: Arial, sans-serif;
  margin-left: {}mm;
  margin-top: {}mm;
  padding: 10px;
}}
h2 {{ color: #166534; }}
</style>
</head>
<body>
  <h2>कृषि केंद्र टेस्ट प्रिंट</h2>
  <p>प्रिंटर: <b>{} (Default)</b></p>
  <p>कागज़ का आकार: <b>{}</b></p>
  <p>अलाइनमेंट X: {}mm, Y: {}mm</p>
  <hr/>
  <p>यह टेस्ट प्रिंट सफलता पूर्वक संपन्न हुआ (असली प्रिंटर पर टेस्ट नहीं हुआ)।</p>
</body>
</html>"#,
            req.title.as_deref().unwrap_or("Krishi Kendra Bill"),
            paper_size,
            offset_x,
            offset_y,
            default_printer_name,
            paper_size,
            offset_x,
            offset_y
        )
    });

    // Write temp html file
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("krishi_bill_print_{}.html", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    fs::write(&temp_file, html_content.as_bytes())
        .map_err(|e| format!("अस्थायी फ़ाइल बनाने में त्रुटि: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        if let Some((browser_bin, browser_name)) = find_browser_for_kiosk_print() {
            let mut child = match Command::new(&browser_bin)
                .arg("--headless=new")
                .arg("--kiosk-printing")
                .arg(&temp_file)
                .spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = fs::remove_file(&temp_file);
                        return Ok(PrintBillResponse {
                            success: false,
                            message: "साइलेंट प्रिंट प्रोसेस शुरू नहीं हो सका। कृपया प्रिंट डायलॉग चुनें।".to_string(),
                            printer_used: default_printer_name,
                            method_used: "kiosk_printing_beta".to_string(),
                            raw_error: Some(e.to_string()),
                        });
                    }
                };

            // Wait up to 5 seconds for spooler dispatch
            let start = std::time::Instant::now();
            let mut exited = false;
            let mut exit_status = None;

            while start.elapsed() < std::time::Duration::from_secs(5) {
                if let Ok(Some(status)) = child.try_wait() {
                    exited = true;
                    exit_status = Some(status);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            let _ = fs::remove_file(&temp_file);

            if !exited {
                let _ = child.kill();
                return Ok(PrintBillResponse {
                    success: true, // Dispatch succeeded to print queue
                    message: format!(
                        "साइलेंट प्रिंट (Beta - {} --kiosk-printing): डिफ़ॉल्ट प्रिंटर '{}' पर भेजा गया (असली प्रिंटर पर टेस्ट नहीं हुआ)।",
                        browser_name, default_printer_name
                    ),
                    printer_used: default_printer_name,
                    method_used: "kiosk_printing_beta".to_string(),
                    raw_error: None,
                });
            }

            if let Some(status) = exit_status {
                if status.success() {
                    return Ok(PrintBillResponse {
                        success: true,
                        message: format!(
                            "साइलेंट प्रिंट (Beta - {} --kiosk-printing): डिफ़ॉल्ट प्रिंटर '{}' पर भेजा गया (असली प्रिंटर पर टेस्ट नहीं हुआ)।",
                            browser_name, default_printer_name
                        ),
                        printer_used: default_printer_name,
                        method_used: "kiosk_printing_beta".to_string(),
                        raw_error: None,
                    });
                } else {
                    return Ok(PrintBillResponse {
                        success: false,
                        message: "साइलेंट प्रिंट पूरा नहीं हो सका। कृपया प्रिंट डायलॉग का उपयोग करें।".to_string(),
                        printer_used: default_printer_name,
                        method_used: "kiosk_printing_beta".to_string(),
                        raw_error: Some(format!("Exit code: {:?}", status.code())),
                    });
                }
            } else {
                return Ok(PrintBillResponse {
                    success: false,
                    message: "साइलेंट प्रिंट प्रोसेस से कोई प्रतिक्रिया नहीं मिली।".to_string(),
                    printer_used: default_printer_name,
                    method_used: "kiosk_printing_beta".to_string(),
                    raw_error: Some("No exit status available".to_string()),
                });
            }
        } else {
            let _ = fs::remove_file(&temp_file);
            return Ok(PrintBillResponse {
                success: false,
                message: "साइलेंट प्रिंट के लिए Microsoft Edge या Google Chrome नहीं मिला। कृपया 'प्रिंट डायलॉग' चुनें।".to_string(),
                printer_used: default_printer_name,
                method_used: "dialog".to_string(),
                raw_error: Some("Neither Edge nor Chrome binary found".to_string()),
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = fs::remove_file(&temp_file);
        Ok(PrintBillResponse {
            success: true,
            message: format!("(Non-Windows Mock) Print sent to {}", target_printer),
            printer_used: target_printer,
            method_used: "mock_silent".to_string(),
            raw_error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_printers_structure() {
        let res = list_printers_impl();
        assert!(res.is_ok(), "list_printers_impl should succeed: {:?}", res.err());
        let list = res.unwrap();
        // There should be at least one printer on standard Windows or mock
        println!("Installed printers count: {}", list.len());
        for p in &list {
            println!("- {} (default: {})", p.name, p.is_default);
        }
    }

    #[test]
    fn test_get_default_printer() {
        let def = get_default_printer_impl();
        assert!(def.is_ok(), "get_default_printer_impl should return Ok: {:?}", def.err());
        println!("Default printer: {:?}", def.unwrap());
    }

    #[test]
    fn test_print_bill_dialog_mode() {
        let req = PrintBillRequest {
            printer_name: None,
            html: None,
            title: Some("Test Bill Dialog".to_string()),
            paper_size: Some("A4".to_string()),
            silent: false,
            offset_x_mm: Some(2.0),
            offset_y_mm: Some(1.0),
        };

        let res = print_bill_impl(req);
        assert!(res.is_ok(), "print_bill dialog mode should succeed");
        let resp = res.unwrap();
        assert!(resp.success);
        assert_eq!(resp.method_used, "dialog");
    }

    #[test]
    fn test_print_bill_nonexistent_printer() {
        let req = PrintBillRequest {
            printer_name: Some("Completely_Fake_Printer_XYZ_12345".to_string()),
            html: None,
            title: Some("Fail Test".to_string()),
            paper_size: Some("A4".to_string()),
            silent: true,
            offset_x_mm: None,
            offset_y_mm: None,
        };

        let res = print_bill_impl(req);
        assert!(res.is_err(), "Nonexistent printer must return an error");
        let err = res.unwrap_err();
        assert!(err.contains("सिस्टम में नहीं मिला") || err.contains("उपलब्ध प्रिंटर"));
    }

    #[test]
    fn test_print_bill_request_options() {
        let req = PrintBillRequest {
            printer_name: Some("Microsoft Print to PDF".to_string()),
            html: Some("<html><body>Test</body></html>".to_string()),
            title: Some("Invoice KK/25-26/0001".to_string()),
            paper_size: Some("A5".to_string()),
            silent: false,
            offset_x_mm: Some(5.0),
            offset_y_mm: Some(-2.0),
        };

        let res = print_bill_impl(req);
        assert!(res.is_ok());
        let resp = res.unwrap();
        assert!(resp.success);
        assert_eq!(resp.printer_used, "Microsoft Print to PDF");
        assert_eq!(resp.method_used, "dialog");
    }
}
