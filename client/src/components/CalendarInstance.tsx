import { useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { CalendarOptions } from '@fullcalendar/core';
import type { ViewKind } from '../types';

interface Props extends CalendarOptions {
  date: Date;
  viewKind: ViewKind;
}

export function CalendarInstance({ date, viewKind, ...options }: Props) {
  const ref = useRef<FullCalendar>(null);
  const targetView =
    viewKind === 'day' ? 'timeGridDay' : viewKind === 'week' ? 'timeGridWeek' : 'dayGridMonth';

  useEffect(() => {
    const api = ref.current?.getApi();
    if (api) api.gotoDate(date);
  }, [date]);

  useEffect(() => {
    const api = ref.current?.getApi();
    if (api && api.view.type !== targetView) api.changeView(targetView);
  }, [targetView]);

  return <FullCalendar ref={ref} {...options} initialView={targetView} initialDate={date} />;
}
