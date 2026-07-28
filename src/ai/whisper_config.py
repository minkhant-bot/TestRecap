import os


def _positive_int(value, fallback):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else fallback
    except (TypeError, ValueError):
        return fallback


def load_whisper_config(env=None, cpu_count=None):
    env = os.environ if env is None else env
    detected_cpu_count = max(1, cpu_count or os.cpu_count() or 1)
    safe_thread_limit = min(detected_cpu_count, 4)
    cpu_threads = min(
        _positive_int(env.get("WHISPER_CPU_THREADS"), safe_thread_limit),
        safe_thread_limit,
    )
    num_workers = min(
        _positive_int(env.get("WHISPER_NUM_WORKERS"), 1),
        cpu_threads,
    )
    beam_size = _positive_int(env.get("WHISPER_BEAM_SIZE"), 3)
    cache_dir = os.path.abspath(
        env.get("HF_HOME")
        or os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "huggingface")
    )
    omp_threads = min(
        _positive_int(env.get("OMP_NUM_THREADS"), cpu_threads),
        detected_cpu_count,
    )
    return {
        "model": env.get("WHISPER_MODEL", "small"),
        "device": env.get("WHISPER_DEVICE", "cpu"),
        "compute_type": env.get("WHISPER_COMPUTE_TYPE", "int8"),
        "detected_cpu_count": detected_cpu_count,
        "cpu_threads": cpu_threads,
        "num_workers": num_workers,
        "beam_size": beam_size,
        "omp_num_threads": omp_threads,
        "cache_dir": cache_dir,
    }


def apply_whisper_environment(config):
    os.environ["HF_HOME"] = config["cache_dir"]
    os.environ["OMP_NUM_THREADS"] = str(config["omp_num_threads"])
