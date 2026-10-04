// The little month/day tile beside an event's title. Both lines are read
// in the EVENT's zone (lib/time.ts), so a dinner on the 22nd in Oakland
// says 22 even to a guest whose own calendar already says the 23rd.

import { eventBadge } from "../lib/time";

interface Props {
  startsAtMs: number;
  tz: string;
}

export function DateBadge({ startsAtMs, tz }: Props) {
  const { month, day } = eventBadge(startsAtMs, tz);
  return (
    <div className="datebadge">
      <div className="datebadge-m">{month}</div>
      <div className="datebadge-d">{day}</div>
    </div>
  );
}
