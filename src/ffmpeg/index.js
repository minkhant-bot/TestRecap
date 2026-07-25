
import fs from 'fs';
import { spawn } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import _ffmpegPath from 'ffmpeg-static';
import { execSync } from 'child_process';
let ffmpegPath = _ffmpegPath;
try { execSync('ffmpeg -version'); ffmpegPath = 'ffmpeg'; } catch (e) {}
import ffprobePath from 'ffprobe-static';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);


const safeWriteCache = (cachePath, data) => {
    if (!cachePath) return;
    const tmpPath = cachePath + '.tmp';
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, cachePath);
    } catch(e) {
        console.warn('[FFmpeg] Failed to write cache safely:', e.message);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
};

export const getDuration = (file) => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
        if (err) return reject(err);
        resolve(meta.format.duration);
    });
});

export const getAudioDetails = (file) => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
        if (err) return resolve({ codec: 'unknown', sampleRate: 0, channels: 0 });
        let aStream = null;
        if (meta.streams) {
            aStream = meta.streams.find(s => s.codec_type === 'audio');
        }
        if (aStream) {
            resolve({ codec: aStream.codec_name, sampleRate: aStream.sample_rate, channels: aStream.channels });
        } else {
            resolve({ codec: 'none', sampleRate: 0, channels: 0 });
        }
    });
});

export const getStreamsDuration = (file) => new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
        if (err) return reject(err);
        let vDur = 0;
        let aDur = 0;
        let formatDur = 0;
        let hasVideo = false;
        let hasAudio = false;
            
        if (meta.format && meta.format.duration !== undefined && meta.format.duration !== 'N/A') {
            const parsedFormatDur = parseFloat(meta.format.duration);
            if (Number.isFinite(parsedFormatDur)) {
                formatDur = parsedFormatDur;
            }
        }
            
        if (meta.streams) {
            meta.streams.forEach(s => {
                if (s.codec_type === 'video') {
                    hasVideo = true;
                    if (s.duration && s.duration !== 'N/A') {
                        const parsed = parseFloat(s.duration);
                        if (Number.isFinite(parsed)) vDur = parsed;
                    }
                }
                if (s.codec_type === 'audio') {
                    hasAudio = true;
                    if (s.duration && s.duration !== 'N/A') {
                        const parsed = parseFloat(s.duration);
                        if (Number.isFinite(parsed)) aDur = parsed;
                    }
                }
            });
        }
            
        resolve({
            hasVideo,
            hasAudio,
            videoDuration: vDur,
            audioDuration: aDur,
            formatDuration: formatDur,
            videoSource: vDur > 0 ? 'stream' : (formatDur > 0 ? 'format' : 'unknown'),
            audioSource: aDur > 0 ? 'stream' : (formatDur > 0 ? 'format' : 'unknown'),
            effectiveVideoDuration: vDur > 0 ? vDur : formatDur,
            effectiveAudioDuration: aDur > 0 ? aDur : formatDur
        });
    });
});

export const extractWav = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(outputPath))
      .on('error', err => reject(err))
      .save(outputPath);
  });
};

export const detectScenes = async (videoPath, cachePath) => {
    if (cachePath && fs.existsSync(cachePath)) {
        console.log('Loading scenes from cache:', cachePath);
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }

    const scenes = [];
    await new Promise((resolve, reject) => {
        // Lowered threshold to 0.2 for better sensitivity in dark, action, anime and drama scenes
        const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const child = spawn(ffmpegPath, [
          '-y',
          '-i', videoPath,
          '-filter:v', "select='gt(scene,0.2)',showinfo",
          '-f', 'null',
          nullDevice
        ], {
          stdio: ['ignore', 'ignore', 'pipe']
        });

        let buffer = '';
        child.stderr.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last incomplete line in buffer
          
          const regex = /pts_time:([0-9.]+)/;
          for (const line of lines) {
            const match = line.match(regex);
            if (match) {
              scenes.push(parseFloat(match[1]));
            }
          }
        });

        child.on('close', (code) => {
            
          if (buffer) {
            const match = buffer.match(/pts_time:([0-9.]+)/);
            if (match) {
              scenes.push(parseFloat(match[1]));
            }
          }
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpeg scene detection exited with code ${code}`));
          }
        });

        child.on('error', reject);
    });
    
    if (scenes.length === 0 || scenes[0] !== 0) {
        scenes.unshift(0);
    }
    
    if (cachePath) {
        fs.writeFileSync(cachePath, JSON.stringify(scenes));
    }
    return scenes;
};

export const runFFmpeg = (args, cwd, onProgress, timeoutMs = 600000) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(cwd)) {
            return reject(new Error(`CWD does not exist: ${cwd}`));
        }
        console.log(`[FFmpeg] Running (cwd=${cwd}): ${args[0]} ... (${args.length} args)`);
        const child = spawn(ffmpegPath, args, { cwd });
        
        let timeoutTimer = null;
        let isDone = false;

        const cleanup = () => {
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const safeResolve = () => {
            if (isDone) return;
            isDone = true;
            cleanup();
            resolve();
        };

        const safeReject = (err) => {
            if (isDone) return;
            isDone = true;
            cleanup();
            reject(err);
        };
        
        if (timeoutMs) {
            timeoutTimer = setTimeout(() => {
                console.error(`[FFmpeg] Timeout reached (${timeoutMs}ms), killing process...`);
                child.kill('SIGKILL');
                safeReject(new Error(`FFmpeg timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
        }
        
        let duration = 0;
        let lastErrorOutput = '';
        
        child.stderr.on('data', (data) => {
            const str = data.toString();
            lastErrorOutput += str;
            if (onProgress) {
                // Parse duration for progress
                const durMatch = str.match(/Duration: ([0-9]{2}):([0-9]{2}):([0-9]{2}\.[0-9]+)/);
                if (durMatch) {
                    duration = (parseInt(durMatch[1]) * 3600) + (parseInt(durMatch[2]) * 60) + parseFloat(durMatch[3]);
                }
                const timeMatch = str.match(/time=([0-9]{2}):([0-9]{2}):([0-9]{2}\.[0-9]+)/);
                if (timeMatch && duration > 0) {
                    const time = (parseInt(timeMatch[1]) * 3600) + (parseInt(timeMatch[2]) * 60) + parseFloat(timeMatch[3]);
                    const progress = Math.min(100, Math.max(0, (time / duration) * 100));
                    onProgress(progress);
                }
            }
        });

        child.on('close', (code, signal) => {
            if (code === 0) {
                safeResolve();
            } else if (code === null) {
                console.error(`[FFmpeg] Process killed with signal ${signal}. Error: ${lastErrorOutput}`);
                safeReject(new Error(`FFmpeg was killed with signal ${signal}. Log: ${lastErrorOutput}`));
            } else {
                console.error(`[FFmpeg] Failed with code ${code}. Error: ${lastErrorOutput}`);
                safeReject(new Error(`FFmpeg exited with code ${code}. Log: ${lastErrorOutput}`));
            }
        });

        child.on('error', (err) => {
            console.error(`[FFmpeg] Process error:`, err);
            safeReject(err);
        });
    });
};
