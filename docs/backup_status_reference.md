# Krishi Kendra Inventory - Backup Status Reference

**Source File:** [`src-tauri/src/backup.rs`](file:///e:/Inventory%20Management/krishi-kendra-inventory/src-tauri/src/backup.rs#L59-L76)  
**Date Added:** 2026-10-30  
**Purpose:** Rust Backend aur Frontend ke beech Backup status aur directory info ka contract.

---

## 1. Rust Definition (`src-tauri/src/backup.rs`)

```rust
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
    } else {
        PathBuf::from("./KrishiBackup")
    }
}
```

---

## 2. Fields Explanation (विवरण)

| Rust Field (snake_case) | Frontend JSON Key (camelCase) | Type | विवरण (Description) |
| :--- | :--- | :--- | :--- |
| `last_backup_time` | `lastBackupTime` | `string \| null` | Aakhiri backup ka timestamp (e.g. ISO string ya formatted date). Agar koi backup nahi hai to `null`. |
| `is_backup_recent` | `isBackupRecent` | `boolean` | Kya pichhle 24 ghante ke andar backup liya gaya hai (`true`/`false`). |
| `formatted_chip_text` | `formattedChipText` | `string` | Top bar / status chip par dikhane wala Hindi status text (jaise: `"सुरक्षित: आज 11:30 AM"` ya `"चेतावनी: बैकअप पुराना है"`). |
| `primary_folder` | `primaryFolder` | `string` | Mukhya backup directory ka poora path (by default: `C:\Users\<User>\Documents\KrishiBackup`). |
| `secondary_folder` | `secondaryFolder` | `string \| null` | Dusri jagah / Pen drive / External drive ka backup folder path. Agar set nahi hai to `null`. |
| `primary_free_space` | `primaryFreeSpace` | `string \| null` | Mukhya disk me bachi hui khali jagah (jaise: `"45.2 GB खाली"`). |
| `secondary_free_space` | `secondaryFreeSpace` | `string \| null` | Secondary drive me bachi hui khali jagah. |
| `is_same_drive_as_db` | `isSameDriveAsDb` | `boolean` | Kya backup folder usi drive par hai jahan database hai (agar `true` ho to warning dikhai ja sakti hai ki pendrive/dusri drive me bhi backup rakhein). |

---

## 3. Frontend TypeScript Equivalent Interface

Agar frontend me type define ya match karna ho:

```typescript
export interface BackupStatusInfo {
  lastBackupTime: string | null;
  isBackupRecent: boolean;
  formattedChipText: string;
  primaryFolder: string;
  secondaryFolder: string | null;
  primaryFreeSpace: string | null;
  secondaryFreeSpace: string | null;
  isSameDriveAsDb: boolean;
}
```

---

## 4. Default Backup Folder Rule (`get_default_backup_dir`)
- Windows environment me `USERPROFILE` environment variable se user ka `Documents` folder nikalta hai:
  - Path: `%USERPROFILE%\Documents\KrishiBackup`
- Agar kisi karan se variable na mile, to fallback `./KrishiBackup` use hota hai.
