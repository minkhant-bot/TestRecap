import sys
import os

# Set Hugging Face cache directory to a local folder in our project root
os.environ["HF_HOME"] = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "huggingface"))

import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s', stream=sys.stderr)

try:
    from faster_whisper import WhisperModel
    # NOTE: must match the model name used in transcribe.py ("base"), otherwise
    # the pre-download at build time is wasted and the server will try to
    # download the model again at runtime (breaking offline/production use).
    logging.info(f"Downloading faster-whisper 'base' model into {os.environ['HF_HOME']}...")
    model = None
    try:
        model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=1, num_workers=1)
    except Exception as e:
        logging.warning(f"Failed download with compute_type='int8' ({e}). Retrying with 'float32'...")
        try:
            model = WhisperModel("base", device="cpu", compute_type="float32", cpu_threads=1, num_workers=1)
        except Exception as e2:
            logging.warning(f"Failed download with compute_type='float32' ({e2}). Retrying with auto...")
            model = WhisperModel("base", device="cpu", cpu_threads=1, num_workers=1)
    logging.info("Download complete.")
except ImportError:
    logging.warning("faster-whisper not installed. Skipping model download for development preview.")
