const MAX_AUDIT_EVENTS = 500;
const events = [];

export const recordAuditEvent = (type, details = {}) => {
    const safeDetails = Object.fromEntries(
        Object.entries(details).filter(([key]) => !/key|token|credential|secret/i.test(key))
    );
    events.push({ timestamp: new Date().toISOString(), type, details: safeDetails });
    if (events.length > MAX_AUDIT_EVENTS) events.splice(0, events.length - MAX_AUDIT_EVENTS);
};

export const getAuditEvents = (limit = 100) =>
    events.slice(-Math.max(1, Math.min(Number(limit) || 100, MAX_AUDIT_EVENTS))).reverse();
