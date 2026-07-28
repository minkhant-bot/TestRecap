import sys
import json
import logging
import os
from whisper_config import apply_whisper_environment, load_whisper_config

# Send logging to stderr to prevent stdout corruption
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)

def main():
    config = load_whisper_config()
    apply_whisper_environment(config)
    if len(sys.argv) == 2 and sys.argv[1] == "--print-config":
        sys.stdout.write(json.dumps(config) + "\n")
        return
    if len(sys.argv) < 2:
        sys.stderr.write("Error: Missing audio file path.\n")
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        sys.stderr.write(f"Error importing faster_whisper: {e}\n")
        sys.exit(1)

    sys.stderr.write(
        "Faster-Whisper config: "
        f"model={config['model']} device={config['device']} "
        f"compute_type={config['compute_type']} detected_cpu_count={config['detected_cpu_count']} "
        f"cpu_threads={config['cpu_threads']} num_workers={config['num_workers']} "
        f"beam_size={config['beam_size']} cache_dir={config['cache_dir']}\n"
    )

    # Load model with the configured compute type and the verified CPU fallback behavior.
    model = None
    try:
        model = WhisperModel(
            config["model"], device=config["device"], compute_type=config["compute_type"],
            cpu_threads=config["cpu_threads"], num_workers=config["num_workers"]
        )
    except Exception as e:
        sys.stderr.write(f"Warning: Failed to load model with compute_type='{config['compute_type']}': {e}\n")
        try:
            model = WhisperModel(
                config["model"], device=config["device"], compute_type="float32",
                cpu_threads=config["cpu_threads"], num_workers=config["num_workers"]
            )
        except Exception as e2:
            sys.stderr.write(f"Warning: Failed to load model with compute_type='float32': {e2}\n")
            try:
                model = WhisperModel(
                    config["model"], device=config["device"],
                    cpu_threads=config["cpu_threads"], num_workers=config["num_workers"]
                )
            except Exception as e3:
                sys.stderr.write(f"Error: Failed to load model with auto compute_type: {e3}\n")
                sys.exit(1)

    try:
        segments, info = model.transcribe(
            audio_path,
            beam_size=config["beam_size"],
            word_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=True
        )

        results = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                results.append({
                    "timestamp": [segment.start, segment.end],
                    "text": text
                })
        
        # Write exact JSON to stdout
        sys.stdout.write(json.dumps(results) + "\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stderr.write(f"Error during transcription: {e}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
