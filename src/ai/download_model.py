import sys
import os
from whisper_config import apply_whisper_environment, load_whisper_config

import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s', stream=sys.stderr)

try:
    from faster_whisper import WhisperModel
    config = load_whisper_config()
    apply_whisper_environment(config)
    logging.info(f"Downloading faster-whisper '{config['model']}' model into {config['cache_dir']}...")
    model = None
    try:
        model = WhisperModel(
            config["model"], device=config["device"], compute_type=config["compute_type"],
            cpu_threads=1, num_workers=1
        )
    except Exception as e:
        logging.warning(f"Failed download with compute_type='{config['compute_type']}' ({e}). Retrying with 'float32'...")
        try:
            model = WhisperModel(config["model"], device=config["device"], compute_type="float32", cpu_threads=1, num_workers=1)
        except Exception as e2:
            logging.warning(f"Failed download with compute_type='float32' ({e2}). Retrying with auto...")
            model = WhisperModel(config["model"], device=config["device"], cpu_threads=1, num_workers=1)
    logging.info("Download complete.")
except ImportError:
    logging.warning("faster-whisper not installed. Skipping model download for development preview.")
