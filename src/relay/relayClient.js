// RelayClient contract (informal interface). Implementations:
//   - MockRelay  (chrome.storage.local; guardian approves via the extension popup)
//   - SupabaseRelay (later; remote DB + emailed approval page) - same interface.
// All methods are async.
//
//   submitRequest({ total, items }) -> Promise<string id>   // creates a 'pending' record
//   getRequest(id)                  -> Promise<record|null>  // {id,total,items,status,createdAt}
//   listPending()                   -> Promise<record[]>     // guardian side
//   decide(id, verdict)             -> Promise<void>         // verdict: 'approved' | 'rejected'
//   onChange(cb)                    -> () => void            // cb(recordsMap) on change; returns unsubscribe
//
// status values:
export const RELAY_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };
