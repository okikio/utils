/**
 * Select where application state, queued items, or workflow progress is saved.
 *
 * A snapshot store retains a value. A queue store retains logical items. A workflow store retains jobs,
 * progress, and receipts needed for recovery. These have different contracts, so select the focused
 * adapter for the required behavior.
 *
 * The root imports no database driver. Applications choose the concrete adapter and own any borrowed
 * database pool.
 *
 * @module
 */
export type { Queue, QueueClaim, QueueRef, QueueStats } from '@okikio/scheduler/queue';
export type { ClientStore, ExecutionStore } from '@okikio/workflow';
