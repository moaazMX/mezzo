export function formatDeadline(deadlineAt: string, language: 'ar' | 'en'): string {
  const date = new Date(deadlineAt);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (language === 'ar') {
    let dayStr = '';
    if (isToday) dayStr = 'اليوم';
    else if (isTomorrow) dayStr = 'غداً';
    else {
      dayStr = date.toLocaleDateString('ar-EG', { weekday: 'long' });
    }
    return `${dayStr} الساعة ${timeStr}`;
  } else {
    let dayStr = '';
    if (isToday) dayStr = 'Today';
    else if (isTomorrow) dayStr = 'Tomorrow';
    else {
      dayStr = date.toLocaleDateString('en-US', { weekday: 'long' });
    }
    return `${dayStr} at ${timeStr}`;
  }
}
