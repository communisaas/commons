const hiddenFullTableRead = (query: { collect: () => unknown }) => query.collect();

export const recurringEntry = (query: { collect: () => unknown }) => hiddenFullTableRead(query);
