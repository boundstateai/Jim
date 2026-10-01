import useActivity from './useActivity.js';
import ActivityPanel from './ActivityPanel.jsx';
import { apiHeaders } from './apiAuth.js';
import './activity.css';

// Mounted inside LoginGate and outside the study views so navigation keeps tracking.
export function ActivityTracker({ course }) {
  const activity = useActivity(course, true, apiHeaders);
  return <div className="activity-tracker">
    <ActivityPanel activity={activity} />
    <p className="activity-note">Automatic app time is separate from the paid study timer below. Use Start study timer to record allowance time.</p>
  </div>;
}
