
import fs from 'fs';

export function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
}

export function generateSRT(chunks) {
    let srt = '';
    chunks.forEach((chunk, index) => {
        let start = chunk.timestamp[0];
        let end = chunk.timestamp[1] || start + 2; 
        srt += `${index + 1}\n`;
        srt += `${formatTime(start)} --> ${formatTime(end)}\n`;
        srt += `${chunk.text.trim()}\n\n`;
    });
    return srt;
}

export function cleanupFiles(files) {
    files.forEach(f => {
        if (f && fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch (e) { console.error('Failed to cleanup', f, e.message); }
        }
    });
}
