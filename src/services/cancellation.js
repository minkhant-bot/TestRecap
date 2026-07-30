export const createAbortError = (message = 'Processing interrupted.') =>
    Object.assign(new Error(message), { name: 'AbortError', code: 'ABORT_ERR' });

export const isAbortError = error =>
    error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

export const throwIfAborted = signal => {
    if (signal?.aborted) throw createAbortError();
};

export const waitWithSignal = (milliseconds, signal) => new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(createAbortError());
    };
    function done() {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
});
