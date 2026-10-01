// Shared opening-hours logic. Runs unchanged in the browser and in Node (ESM).

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export { DAY_NAMES };

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "21:00" -> "9 PM", "09:30" -> "9:30 AM" */
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Day of week (0-6) and minutes since midnight for `date` in the shop's time zone. */
export function zonedClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { day: WEEKDAY_INDEX[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Returns { isOpen, label, today, closesAt, opensAt } for the given hours table.
 * `hours` maps "0".."6" (Sunday..Saturday) to { open, close } or null.
 */
export function getOpenStatus(hours, timeZone, now = new Date()) {
  const { day, minutes } = zonedClock(now, timeZone);
  const today = hours[day];

  if (today && minutes >= toMinutes(today.open) && minutes < toMinutes(today.close)) {
    return { isOpen: true, today: day, closesAt: today.close, label: `Open now · Closes ${formatTime(today.close)}` };
  }

  if (today && minutes < toMinutes(today.open)) {
    return { isOpen: false, today: day, opensAt: today.open, label: `Closed · Opens ${formatTime(today.open)} today` };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const next = (day + offset) % 7;
    if (hours[next]) {
      const when = offset === 1 ? 'tomorrow' : DAY_NAMES[next];
      return { isOpen: false, today: day, opensAt: hours[next].open, label: `Closed · Opens ${formatTime(hours[next].open)} ${when}` };
    }
  }

  return { isOpen: false, today: day, label: 'Closed' };
}
