import useActivity from './useActivity.js';
import ActivityPanel from './ActivityPanel.jsx';
import { apiHeaders } from './apiAuth.js';
import './activity.css';

// Mounted inside LoginGate and outside the study views so navigation keeps tracking.
export function ActivityTracker({ course }) {
  const activity = useActivity(course, true, apiHeaders);
  return <div className="activity-tracker">
    <ActivityPanel activity={activity} />
  </div>;
}
