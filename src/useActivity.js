import { useEffect, useState } from 'react';
import { createActivityOutbox } from './activityOutbox.js';
import { activeSlice, dailyTotals, IDLE_MS, unionRanges } from './activity.js';

export default function useActivity(course, enabled, headers) {
  const [activity,setActivity]=useState({days:{},active:false,status:'Loading time…'});
  useEffect(() => {
    if (!enabled) return;
    const prefix=`jim-activity-${course}:`;
    let remote=[], previous=Date.now(), lastInput=0;
    let focused=document.hasFocus() && !document.hidden, busy=false, alive=true, storageOK=true;
    let status='Loading time…';
    const read = k => { try { return JSON.parse(localStorage.getItem(k)||'[]'); } catch { return []; } };
    remote=read(`jim-activity-cache-${course}`);
    const write = (k,ranges) => { try { if(ranges.length) localStorage.setItem(k,JSON.stringify(ranges)); else localStorage.removeItem(k); storageOK=true; } catch { storageOK=false; } };
    // Access the storage property inside the outbox's guarded operations too:
    // some browsers throw even when obtaining localStorage.
    const storage={
      get length(){return window.localStorage.length;},
      key:i=>window.localStorage.key(i),
      getItem:k=>window.localStorage.getItem(k),
      setItem:(k,v)=>window.localStorage.setItem(k,v),
      removeItem:k=>window.localStorage.removeItem(k),
    };
    const outbox=createActivityOutbox(storage,prefix,()=>crypto.randomUUID(),ok=>{storageOK=ok;});
    const pending = () => outbox.snapshot(Date.now()-89*86400000);
    const publish = () => {
      if(!alive) return;
      const now=Date.now();
      setActivity({days:dailyTotals(unionRanges(remote,...pending().values())),active:focused && now-lastInput<IDLE_MS,status:storageOK ? status : 'Storage unavailable · keep this tab open'});
    };
    const sample = () => {
      const now=Date.now();
      const slice=activeSlice(previous,now,lastInput,focused);
      previous=now;
      if(slice.length) {outbox.append(slice); status=navigator.onLine ? 'Time saved on this device · sync pending' : 'Offline · time saved on this device';}
      publish();
    };
    const sync = async (keepalive=false) => {
      if(busy || !navigator.onLine) {if(!navigator.onLine) {status='Offline · time saved on this device'; publish();} return;}
      busy=true;
      const cutoff=Date.now()-89*86400000;
      const entries=outbox.snapshot(cutoff);
      // Bounded batches also keep unload requests below browser keepalive limits.
      const ranges=unionRanges(...entries.values()).flatMap(([a,b]) => {
        const parts=[];
        for(let at=a;at<b;at+=86400000) parts.push([at,Math.min(b,at+86400000)]);
        return parts;
      }).slice(0,500);
      try {
        const response=await fetch(`/api/activity?course=${encodeURIComponent(course)}`,ranges.length ? {method:'POST',headers:headers({'Content-Type':'application/json'}),body:JSON.stringify({ranges}),keepalive} : {headers:headers(),keepalive});
        if(!response.ok) throw new Error('sync');
        const data=await response.json();
        if(!Array.isArray(data.ranges)) throw new Error('response');
        remote=unionRanges(remote,data.ranges).filter(r=>r[1]>=Date.now()-33*86400000);
        write(`jim-activity-cache-${course}`,remote);
        outbox.acknowledge(entries,ranges,cutoff);
        status=unionRanges(...pending().values()).length ? 'Time saved on this device · sync pending' : 'Time synced across devices';
      } catch {status='Time saved on this device · sync pending';}
      finally {busy=false; publish();}
    };
    const input = event => {
      if(!event.isTrusted || document.hidden || !document.hasFocus()) return;
      const now=Date.now(), resuming=!focused || now-lastInput>=IDLE_MS;
      if(resuming || now-previous>=1000) sample();
      focused=true; lastInput=now;
      if(resuming) publish();
    };
    const visibility = event => {
      sample(); focused=event?.type !== 'blur' && !document.hidden && document.hasFocus();
      // Returning to the app starts a new active window; background time stays excluded.
      lastInput=focused ? Date.now() : 0; previous=Date.now(); publish();
      if(!focused) void sync(true); else void sync();
    };
    const hide=()=>{sample(); focused=false; lastInput=0; void sync(true);};
    const online=()=>void sync();
    const handleStorage=()=>publish();
    const events=['pointerdown','keydown','touchstart','wheel','scroll'];
    for(const name of events) window.addEventListener(name,input,{passive:true,capture:true});
    window.addEventListener('focus',visibility); window.addEventListener('blur',visibility);
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pageshow',visibility); window.addEventListener('pagehide',hide); window.addEventListener('online',online); window.addEventListener('storage',handleStorage);
    const tick=setInterval(sample,5000), upload=setInterval(()=>{if(!document.hidden && document.hasFocus()) void sync();},60000);
    void sync();
    return ()=>{
      sample(); alive=false; clearInterval(tick); clearInterval(upload);
      for(const name of events) window.removeEventListener(name,input,true);
      window.removeEventListener('focus',visibility); window.removeEventListener('blur',visibility);
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('pageshow',visibility); window.removeEventListener('pagehide',hide); window.removeEventListener('online',online); window.removeEventListener('storage',handleStorage);
    };
  },[course,enabled,headers]);
  return activity;
}

