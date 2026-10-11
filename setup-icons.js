import fs from 'fs';
import path from 'path';

async function downloadIcon() {
    const dir = path.join(process.cwd(), 'src-tauri', 'icons');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const iconUrl = 'https://raw.githubusercontent.com/tauri-apps/tauri/dev/core/tauri/scripts/icon.ico';
    
    console.log('Downloading default Tauri icon.ico...');
    const response = await fetch(iconUrl);
    const buffer = await response.arrayBuffer();
    
    fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.from(buffer));
    console.log('Successfully saved to src-tauri/icons/icon.ico!');
}

downloadIcon();
