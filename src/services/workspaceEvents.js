import { EventEmitter } from 'node:events';

const events = new EventEmitter();
events.setMaxListeners(1000);
let sequence = 0;

export const publishWorkspaceEvent = (jobId, eventType, payload) => {
    const event = {
        eventId: String(++sequence),
        eventType,
        jobId,
        occurredAt: new Date().toISOString(),
        payload
    };
    events.emit(`job:${jobId}`, event);
    events.emit('queue', event);
    return event;
};

export const subscribeToWorkspaceJob = (jobId, listener) => {
    const channel = `job:${jobId}`;
    events.on(channel, listener);
    return () => events.off(channel, listener);
};
