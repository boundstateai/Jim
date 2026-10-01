import { subtractRanges, unionRanges } from './activity.js';

export const ACTIVITY_CHECKPOINT_LIMIT = 64;

// New checkpoints are immutable. Other tabs may acknowledge/delete a checkpoint,
// but can never replace it with a stale snapshot of a growing buffer.
export function createActivityOutbox(storage, prefix, newId, onStorage = () => {}) {
  const immutablePrefix = `${prefix}v2:`;
  const receiptPrefix = `${prefix}ack:`;
  const memory = new Map();
  const read = key => {
    try { return unionRanges(JSON.parse(storage.getItem(key) || '[]')); }
    catch { return []; }
  };
  const write = (key, ranges) => {
    try { storage.setItem(key, JSON.stringify(ranges)); onStorage(true); return true; }
    catch { onStorage(false); return false; }
  };
  const remove = key => {
    memory.delete(key);
    try { storage.removeItem(key); onStorage(true); }
    catch { onStorage(false); }
  };
  const clip = (ranges, cutoff) => unionRanges(ranges)
    .filter(([,end]) => end > cutoff)
    .map(([start,end]) => [Math.max(start,cutoff),end]);
  const storedKeys = () => {
    const keys = [];
    try {
      for (let i=0; i<storage.length; i++) {
        const key=storage.key(i);
        if (key?.startsWith(prefix) && !key.startsWith(receiptPrefix)) keys.push(key);
      }
    } catch { onStorage(false); }
    return keys;
  };
  const compact = () => {
    const keys = storedKeys().filter(key=>key.startsWith(immutablePrefix));
    if (keys.length < ACTIVITY_CHECKPOINT_LIMIT) return;
    const combined = unionRanges(...keys.map(read));
    // Bound each replacement so the API's 500-range batches can fully
    // acknowledge it, even after a long, fragmented offline backlog.
    const pieces = combined.flatMap(([start,end])=>{
      const out=[];
      for(let at=start;at<end;at+=86400000) out.push([at,Math.min(end,at+86400000)]);
      return out;
    });
    const replacements=[];
    for(let i=0;i<pieces.length;i+=128) {
      const replacement=immutablePrefix+newId();
      if(!write(replacement,pieces.slice(i,i+128))) {
        // Keep every source if any replacement fails to become durable.
        for(const key of replacements) remove(key);
        onStorage(false);
        return;
      }
      replacements.push(replacement);
    }
    // Other tabs only delete immutable sources; stale reads cause retries,
    // not loss. New appends have different keys and survive this cleanup.
    for(const key of keys) remove(key);
  };
  return {
    append(ranges) {
      compact();
      const checkpoint = unionRanges(...memory.values(), ranges);
      // Apply the same bounds to recovered memory as to compacted disk data.
      // Splitting long ranges too keeps each record within sync's wire budget.
      const pieces = checkpoint.flatMap(([start,end]) => {
        const out=[];
        for(let at=start;at<end;at+=86400000) out.push([at,Math.min(end,at+86400000)]);
        return out;
      });
      memory.clear();
      let allPersisted = true;
      for(let i=0;i<pieces.length;i+=128) {
        const key = immutablePrefix + newId();
        const chunk = pieces.slice(i,i+128);
        // Fresh keys keep acknowledgements of older snapshots harmless.
        if (!write(key, chunk)) { memory.set(key, chunk); allPersisted = false; }
      }
      if (!allPersisted) onStorage(false);
    },
    snapshot(cutoff) {
      compact();
      const keys = new Set([...storedKeys(), ...memory.keys()]);
      const entries = new Map();
      for (const key of keys) {
        const ranges = memory.get(key) || read(key);
        let retained = clip(ranges, cutoff);
        if (key.startsWith(immutablePrefix)) {
          if (!retained.length) remove(key);
        } else {
          // An older, still-open app can append to this key at any time. Leave
          // it untouched; receipts suppress retries without risking its data.
          retained = subtractRanges(retained, read(receiptPrefix + key));
        }
        if (retained.length) entries.set(key, retained);
      }
      return entries;
    },
    acknowledge(entries, uploaded, cutoff) {
      for (const [key, snapshot] of entries) {
        if (key.startsWith(immutablePrefix)) {
          if (!subtractRanges(snapshot, uploaded).length) remove(key);
        } else {
          // Concurrent receipt updates can at worst cause a harmless retry.
          // They never overwrite or delete the legacy activity itself.
          const receiptKey = receiptPrefix + key;
          write(receiptKey, clip(unionRanges(read(receiptKey), uploaded), cutoff));
        }
      }
    },
  };
}


