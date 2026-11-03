import { parseOrganizationSettings } from '@fg/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { addDays, toDbDate } from './tz';

/** Working days between two dates (inclusive), using the organization's working days and holidays. */
export async function countWorkingDays(prisma: PrismaService, organizationId: string, start: string, end: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const workingDays = parseOrganizationSettings(org.settings).attendance.workingDays;
  const holidays = await prisma.holiday.findMany({ where: { organizationId, date: { gte: toDbDate(start), lte: toDbDate(end) } } });
  const off = new Set(holidays.filter((h) => h.type === 'MANDATORY' || h.type === 'COMPANY').map((h) => h.date.toISOString().slice(0, 10)));
  const special = new Set(holidays.filter((h) => h.type === 'SPECIAL_WORKING_DAY').map((h) => h.date.toISOString().slice(0, 10)));
  let n = 0;
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = toDbDate(d).getUTCDay();
    if (special.has(d) || (workingDays.includes(wd) && !off.has(d))) {
      n++;
      dates.push(d);
    }
    if (n > 400) break;
  }
  return { days: n, dates };
}
