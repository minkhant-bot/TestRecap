import fs from 'fs';
import { execSync } from 'child_process';
const text = "Hello everyone. Today we are looking at this amazing test video. It is short but effective. Thank you for watching.";
execSync(`echo "${text}" > script.txt`);
execSync('edge-tts -f script.txt --write-media test_audio.wav');
execSync('ffmpeg -y -f lavfi -i color=c=blue:s=1280x720:d=8 -i test_audio.wav -c:v libx264 -c:a aac -shortest test_video_speech.mp4');
