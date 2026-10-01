import { duration, studyDay } from './activity.js';
export function ActivityBadge({activity}) {
  return <div className="activity-badge" aria-label="Active study time">{activity.active ? '● Active' : 'Ⅱ Paused'} · {duration(activity.days[studyDay(Date.now())])} today</div>;
}
export default function ActivityPanel({activity}) {
  const now=Date.now();
  const today=studyDay(now);
  const dates=Array.from({length:30},(_,i)=>new Date(Date.parse(`${today}T12:00:00Z`)-i*86400000).toISOString().slice(0,10));
  const week=dates.slice(0,7).reduce((sum,day)=>sum+(activity.days[day]||0),0);
  return <section className="activity-panel" aria-label="Study time">
    <div className="activity-summary"><div><div className="activity-eyebrow">ACTIVE APP TIME</div><h2>{duration(activity.days[dates[0]])} <span>today</span></h2></div><div><ActivityBadge activity={activity}/><p>Last 7 days: {duration(week)}</p></div></div>
    <p className="activity-note">Pauses when you leave the app or after 90 seconds without interaction. Time on paper may be missed. This measures app use, not mastery.</p>
    <details><summary>Daily history · Central time</summary><div className="activity-days">{dates.map(day=><div key={day}><span>{day===dates[0] ? 'Today' : day}</span><span>{duration(activity.days[day])}</span></div>)}</div></details>
    <p className="activity-note" role="status">{activity.status} · Tracking starts with this update.</p>
  </section>;
}

