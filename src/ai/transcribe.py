import sys
import json
import logging
import os

# Send logging to stderr to prevent stdout corruption
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
os.environ["HF_HOME"] = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "huggingface"))

def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Error: Missing audio file path.\n")
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        sys.stderr.write(f"Error importing faster_whisper: {e}\n")
        sys.exit(1)

    # Load model with fallback compute_types
    model = None
    try:
        model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4, num_workers=2)
    except Exception as e:
        sys.stderr.write(f"Warning: Failed to load model with compute_type='int8': {e}\n")
        try:
            model = WhisperModel("base", device="cpu", compute_type="float32", cpu_threads=4, num_workers=2)
        except Exception as e2:
            sys.stderr.write(f"Warning: Failed to load model with compute_type='float32': {e2}\n")
            try:
                model = WhisperModel("base", device="cpu", cpu_threads=4, num_workers=2)
            except Exception as e3:
                sys.stderr.write(f"Error: Failed to load model with auto compute_type: {e3}\n")
                sys.exit(1)

    try:
        segments, info = model.transcribe(
            audio_path,
            beam_size=3,
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
