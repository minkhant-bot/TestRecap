import crypto from 'crypto';
import fs from 'fs';
import { createAbortError, throwIfAborted } from '../services/cancellation.js';

const escapeXml = (text) => text.replace(/[<>&"']/g, char => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
}[char]));

export class EdgeTtsEmptyAudioError extends Error {
    constructor(diagnostics) {
        super('Edge TTS completed without audio payload');
        this.name = 'EdgeTtsEmptyAudioError';
        this.diagnostics = diagnostics;
    }
}

export const synthesizeEdgeTts = async (client, text, audioPath, { signal } = {}) => {
    throwIfAborted(signal);
    const socket = await client._connectWebSocket();
    if (signal?.aborted) {
        try { socket.terminate(); } catch { }
        throw createAbortError('Text-to-speech interrupted.');
    }
    return new Promise((resolve, reject) => {
        const audioStream = fs.createWriteStream(audioPath);
        const subtitles = [];
        const diagnostics = {
            audioFrameCount: 0,
            receivedBytes: 0,
            closeCode: null,
            closeReason: '',
            serviceResponses: []
        };
        let turnEnded = false;
        let streamFinished = false;
        let socketClosed = false;
        let pendingError = null;
        let settled = false;

        const finish = () => {
            if (settled || !streamFinished || !socketClosed) return;
            settled = true;
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
            if (pendingError) {
                pendingError.diagnostics ||= diagnostics;
                reject(pendingError);
            } else {
                resolve(diagnostics);
            }
        };

        const closeSocket = () => {
            try {
                if (socket.readyState < 2) socket.close();
                else if (socket.readyState === 3) socketClosed = true;
            } catch (error) {
                pendingError ||= error;
                socketClosed = true;
            }
        };
        const onAbort = () => {
            pendingError ||= createAbortError('Text-to-speech interrupted.');
            if (!streamFinished) audioStream.end();
            try { socket.terminate(); } catch (_) { closeSocket(); }
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        audioStream.on('error', error => {
            pendingError ||= error;
            streamFinished = true;
            closeSocket();
            finish();
        });
        audioStream.on('finish', () => {
            streamFinished = true;
            if (!pendingError && diagnostics.receivedBytes === 0) {
                pendingError = new EdgeTtsEmptyAudioError(diagnostics);
            }
            if (!pendingError && client.saveSubtitles) {
                try {
                    client._saveSubFile(subtitles, text, audioPath);
                } catch (error) {
                    pendingError = error;
                }
            }
            closeSocket();
            finish();
        });

        socket.on('message', (data, isBinary) => {
            if (isBinary) {
                const separator = Buffer.from('Path:audio\r\n');
                const separatorIndex = data.indexOf(separator);
                if (separatorIndex < 0) return;
                const audioData = data.subarray(separatorIndex + separator.length);
                if (audioData.length > 0) {
                    diagnostics.audioFrameCount += 1;
                    diagnostics.receivedBytes += audioData.length;
                    audioStream.write(audioData);
                }
                return;
            }

            const message = data.toString();
            if (message.includes('Path:turn.end')) {
                turnEnded = true;
                audioStream.end();
                return;
            }
            if (message.includes('Path:audio.metadata')) {
                const splitTexts = message.split('\r\n');
                try {
                    const metadata = JSON.parse(splitTexts[splitTexts.length - 1]);
                    metadata.Metadata.forEach(element => subtitles.push({
                        part: element.Data.text.Text,
                        start: Math.floor(element.Data.Offset / 10000),
                        end: Math.floor((element.Data.Offset + element.Data.Duration) / 10000)
                    }));
                } catch (error) {
                    diagnostics.serviceResponses.push(`metadata-parse-error: ${error.message}`);
                }
                return;
            }
            diagnostics.serviceResponses.push(message.slice(0, 2000));
        });

        socket.on('error', error => {
            pendingError ||= error;
            if (!streamFinished) audioStream.end();
        });
        socket.on('close', (code, reason) => {
            diagnostics.closeCode = code;
            diagnostics.closeReason = reason?.toString?.() || '';
            socketClosed = true;
            if (!turnEnded && !pendingError) {
                pendingError = new Error('Edge TTS WebSocket closed before turn.end');
            }
            if (!streamFinished) audioStream.end();
            finish();
        });

        const timeout = setTimeout(() => {
            pendingError ||= new Error('Edge TTS timeout');
            if (!streamFinished) audioStream.end();
            try { socket.terminate(); } catch (_) { closeSocket(); }
        }, client.timeout);

        const requestId = crypto.randomBytes(16).toString('hex');
        socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
            `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${client.lang}">` +
            `<voice name="${client.voice}"><prosody rate="${client.rate}" pitch="${client.pitch}" volume="${client.volume}">` +
            `${escapeXml(text)}</prosody></voice></speak>`);
    });
};

export const formatEdgeTtsDiagnostics = ({ blockIndex, attempt, diagnostics }) => JSON.stringify({
    blockIndex,
    attempt,
    audioFrameCount: diagnostics?.audioFrameCount ?? 0,
    receivedBytes: diagnostics?.receivedBytes ?? 0,
    closeCode: diagnostics?.closeCode ?? null,
    closeReason: diagnostics?.closeReason ?? '',
    serviceResponse: diagnostics?.serviceResponses?.join(' | ') || ''
});
