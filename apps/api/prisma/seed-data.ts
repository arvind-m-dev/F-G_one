/**
 * Static demo content for the development seed: people, departments, holidays, chat scripts and announcements.
 * Kept apart from seed.ts so the generators there stay readable. Everything here is fictional.
 *
 * Browser tests (apps/web/e2e) rely on: the four demo logins and their names, Kabir Singh and Tara Joshi,
 * the Engineering department, #general, the Rohan ↔ Ananya direct message, employee@ having no attendance
 * today and no correction requests, and no leave for employee@ three to five weeks ahead.
 */

export type Style = 'office' | 'hybrid' | 'remote' | 'field';

export type Person = {
  first: string;
  last: string;
  email: string;
  role: 'administrator' | 'hr_admin' | 'manager' | 'employee';
  superAdmin?: boolean;
  dept: string;
  title: string;
  manager?: string;
  joined: string;
  birthday?: string;
  presence?: string;
  statusText?: string;
  color: string;
  /** Where they usually work from. */
  style?: Style;
  /** Works 21:00 to 06:00 (US customer hours). */
  night?: boolean;
  /** Share of days they arrive after the grace period. */
  lateRate?: number;
  status?: 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';
  /** For deactivated and suspended accounts: how many days ago that happened. */
  statusDaysAgo?: number;
  phone?: string;
  pronouns?: string;
};

export const DEPARTMENTS = [
  { name: 'Engineering', color: '#6366f1', description: 'Product engineering and platform' },
  { name: 'Quality Assurance', color: '#14b8a6', description: 'Testing and release quality' },
  { name: 'Human Resources', color: '#ec4899', description: 'People operations' },
  { name: 'Design', color: '#f59e0b', description: 'Product and brand design' },
  { name: 'Sales & Marketing', color: '#0ea5e9', description: 'Growth, partnerships and brand' },
  { name: 'Management', color: '#8b5cf6', description: 'Leadership team' },
  { name: 'Finance', color: '#10b981', description: 'Accounts, payroll and expenses' },
  { name: 'Operations', color: '#64748b', description: 'Office, IT support and facilities' },
  { name: 'Customer Success', color: '#f43f5e', description: 'Onboarding, support and renewals' },
  { name: 'Product', color: '#a855f7', description: 'Roadmap, discovery and analytics' },
];

/** Department → email of its head. */
export const DEPARTMENT_HEADS: Record<string, string> = {
  Engineering: 'manager@futuristglobal.com',
  'Human Resources': 'hr@futuristglobal.com',
  'Quality Assurance': 'sneha.kulkarni@futuristglobal.com',
  Design: 'dev.malhotra@futuristglobal.com',
  'Sales & Marketing': 'nikhil.bansal@futuristglobal.com',
  Management: 'vivek.anand@futuristglobal.com',
  Finance: 'suresh.iyengar@futuristglobal.com',
  Operations: 'farhan.qureshi@futuristglobal.com',
  'Customer Success': 'divya.menon@futuristglobal.com',
  Product: 'shreya.ghosh@futuristglobal.com',
};

/** Month and day of (today + offset) in the given year, for birthdays and anniversaries that fall near today. */
export function relDate(daysFromToday: number, year: number) {
  const d = new Date(Date.now() + daysFromToday * 86400_000);
  return `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** A date `days` ago (join dates of recent hires). */
const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

export const DEMO_EMAILS = ['admin@futuristglobal.com', 'hr@futuristglobal.com', 'manager@futuristglobal.com', 'employee@futuristglobal.com'];

/** The first 16 are the original demo people (employee codes FG1001–FG1016 stay stable). */
export const PEOPLE: Person[] = [
  { first: 'Aarav', last: 'Mehta', email: 'admin@futuristglobal.com', role: 'administrator', superAdmin: true, dept: 'Management', title: 'Chief Technology Officer', manager: 'vivek.anand@futuristglobal.com', joined: '2019-04-01', birthday: '1984-02-11', color: '#8b5cf6', presence: 'working', statusText: 'Planning Q1 roadmap', style: 'hybrid', lateRate: 0.05 },
  { first: 'Priya', last: 'Sharma', email: 'hr@futuristglobal.com', role: 'hr_admin', dept: 'Human Resources', title: 'HR Manager', manager: 'admin@futuristglobal.com', joined: '2020-07-15', birthday: relDate(3, 1991), color: '#ec4899', presence: 'in_office', style: 'office', lateRate: 0.03, pronouns: 'she/her' },
  { first: 'Rohan', last: 'Verma', email: 'manager@futuristglobal.com', role: 'manager', dept: 'Engineering', title: 'Engineering Manager', manager: 'admin@futuristglobal.com', joined: relDate(5, 2021), birthday: '1988-08-19', color: '#0ea5e9', presence: 'meeting', statusText: 'Sprint planning', style: 'hybrid', lateRate: 0.08 },
  { first: 'Ananya', last: 'Iyer', email: 'employee@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Senior Frontend Engineer', manager: 'manager@futuristglobal.com', joined: '2022-02-01', birthday: relDate(0, 1996), color: '#14b8a6', presence: 'focus', statusText: 'Deep work until 3pm', style: 'hybrid', lateRate: 0.1, pronouns: 'she/her' },
  { first: 'Kabir', last: 'Singh', email: 'kabir.singh@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Backend Engineer', manager: 'manager@futuristglobal.com', joined: '2023-06-12', birthday: '1995-12-02', color: '#22c55e', presence: 'wfh', style: 'remote', lateRate: 0.15 },
  { first: 'Meera', last: 'Nair', email: 'meera.nair@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'DevOps Engineer', manager: 'manager@futuristglobal.com', joined: '2021-11-08', birthday: '1993-03-27', color: '#f59e0b', presence: 'available', style: 'hybrid', lateRate: 0.05 },
  { first: 'Vikram', last: 'Rao', email: 'vikram.rao@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Full-Stack Engineer', manager: 'manager@futuristglobal.com', joined: '2024-01-22', birthday: '1997-07-09', color: '#ef4444', presence: 'lunch', style: 'office', lateRate: 0.3 },
  { first: 'Sneha', last: 'Kulkarni', email: 'sneha.kulkarni@futuristglobal.com', role: 'manager', dept: 'Quality Assurance', title: 'QA Lead', manager: 'admin@futuristglobal.com', joined: '2020-09-30', birthday: '1990-05-14', color: '#14b8a6', presence: 'available', style: 'office', lateRate: 0.04 },
  { first: 'Arjun', last: 'Patel', email: 'arjun.patel@futuristglobal.com', role: 'employee', dept: 'Quality Assurance', title: 'QA Engineer', manager: 'sneha.kulkarni@futuristglobal.com', joined: '2023-03-01', birthday: relDate(9, 1998), color: '#6366f1', presence: 'short_break', style: 'office', lateRate: 0.2 },
  { first: 'Isha', last: 'Gupta', email: 'isha.gupta@futuristglobal.com', role: 'employee', dept: 'Quality Assurance', title: 'Automation Engineer', manager: 'sneha.kulkarni@futuristglobal.com', joined: relDate(11, 2022), birthday: '1996-10-30', color: '#ec4899', presence: 'available', style: 'hybrid', lateRate: 0.06 },
  { first: 'Dev', last: 'Malhotra', email: 'dev.malhotra@futuristglobal.com', role: 'manager', dept: 'Design', title: 'Design Lead', manager: 'admin@futuristglobal.com', joined: '2021-05-17', birthday: '1989-01-23', color: '#f59e0b', presence: 'busy', statusText: 'Client review', style: 'hybrid', lateRate: 0.12 },
  { first: 'Tara', last: 'Joshi', email: 'tara.joshi@futuristglobal.com', role: 'employee', dept: 'Design', title: 'Product Designer', manager: 'dev.malhotra@futuristglobal.com', joined: '2024-08-05', birthday: '1998-06-18', color: '#8b5cf6', presence: 'available', style: 'hybrid', lateRate: 0.1 },
  { first: 'Nikhil', last: 'Bansal', email: 'nikhil.bansal@futuristglobal.com', role: 'manager', dept: 'Sales & Marketing', title: 'Head of Growth', manager: 'vivek.anand@futuristglobal.com', joined: '2020-01-06', birthday: '1987-09-05', color: '#0ea5e9', presence: 'stepped_out', style: 'field', lateRate: 0.1 },
  { first: 'Zara', last: 'Khan', email: 'zara.khan@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Marketing Specialist', manager: 'nikhil.bansal@futuristglobal.com', joined: '2025-02-10', birthday: '1999-04-21', color: '#22c55e', presence: 'available', style: 'hybrid', lateRate: 0.12 },
  { first: 'Rahul', last: 'Desai', email: 'rahul.desai@futuristglobal.com', role: 'employee', dept: 'Human Resources', title: 'Talent Acquisition', manager: 'hr@futuristglobal.com', joined: '2023-10-02', birthday: '1994-11-12', color: '#ef4444', presence: 'dnd', statusText: 'Interviews back-to-back', style: 'office', lateRate: 0.07 },
  { first: 'Neha', last: 'Reddy', email: 'neha.reddy@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Mobile Engineer', manager: 'manager@futuristglobal.com', joined: relDate(2, 2023), birthday: '1997-02-28', color: '#6366f1', presence: 'away', style: 'hybrid', lateRate: 0.09 },

  // Leadership
  { first: 'Vivek', last: 'Anand', email: 'vivek.anand@futuristglobal.com', role: 'manager', dept: 'Management', title: 'Chief Executive Officer', joined: '2018-06-01', birthday: '1979-12-08', color: '#8b5cf6', presence: 'meeting', statusText: 'Board meeting', style: 'field', lateRate: 0.05, phone: '+91 98200 10001' },
  // Engineering, second level under Rohan
  { first: 'Siddharth', last: 'Agarwal', email: 'siddharth.agarwal@futuristglobal.com', role: 'manager', dept: 'Engineering', title: 'Staff Engineer, Platform', manager: 'manager@futuristglobal.com', joined: '2020-03-16', birthday: '1990-07-31', color: '#0ea5e9', presence: 'available', style: 'hybrid', lateRate: 0.08 },
  { first: 'Pranav', last: 'Hegde', email: 'pranav.hegde@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Backend Engineer', manager: 'siddharth.agarwal@futuristglobal.com', joined: '2024-04-08', birthday: relDate(6, 1996), color: '#22c55e', presence: 'focus', style: 'remote', lateRate: 0.18 },
  { first: 'Rhea', last: "D'Souza", email: 'rhea.dsouza@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Frontend Engineer', manager: 'siddharth.agarwal@futuristglobal.com', joined: ago(41), birthday: '2000-01-17', color: '#ec4899', presence: 'available', style: 'office', lateRate: 0.05, pronouns: 'she/her' },
  { first: 'Yash', last: 'Tiwari', email: 'yash.tiwari@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Software Engineering Intern', manager: 'siddharth.agarwal@futuristglobal.com', joined: ago(12), birthday: '2003-05-02', color: '#f59e0b', presence: 'available', style: 'office', lateRate: 0.25 },
  { first: 'Omkar', last: 'Pawar', email: 'omkar.pawar@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Site Reliability Engineer', manager: 'manager@futuristglobal.com', joined: '2022-09-19', birthday: '1992-08-08', color: '#64748b', presence: 'wfh', style: 'remote', lateRate: 0.1 },
  { first: 'Nisha', last: 'Arora', email: 'nisha.arora@futuristglobal.com', role: 'employee', dept: 'Engineering', title: 'Frontend Engineer', manager: 'manager@futuristglobal.com', joined: '2022-05-09', birthday: '1995-03-03', color: '#a855f7', status: 'DEACTIVATED', statusDaysAgo: 24, style: 'hybrid', lateRate: 0.1 },
  // Quality Assurance
  { first: 'Rajat', last: 'Sinha', email: 'rajat.sinha@futuristglobal.com', role: 'employee', dept: 'Quality Assurance', title: 'QA Engineer', manager: 'sneha.kulkarni@futuristglobal.com', joined: '2024-11-11', birthday: '1997-09-25', color: '#0ea5e9', presence: 'available', style: 'office', lateRate: 0.14 },
  // Design
  { first: 'Kriti', last: 'Malik', email: 'kriti.malik@futuristglobal.com', role: 'employee', dept: 'Design', title: 'UX Researcher', manager: 'dev.malhotra@futuristglobal.com', joined: '2023-01-09', birthday: '1994-12-19', color: '#f43f5e', presence: 'stepped_out', statusText: 'User interviews', style: 'field', lateRate: 0.06 },
  { first: 'Sameer', last: 'Naqvi', email: 'sameer.naqvi@futuristglobal.com', role: 'employee', dept: 'Design', title: 'Visual Designer', manager: 'dev.malhotra@futuristglobal.com', joined: '2025-06-02', birthday: '1998-02-14', color: '#14b8a6', presence: 'available', style: 'hybrid', lateRate: 0.2 },
  // Sales & Marketing
  { first: 'Mehul', last: 'Shah', email: 'mehul.shah@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Account Executive', manager: 'nikhil.bansal@futuristglobal.com', joined: '2022-07-25', birthday: '1991-06-06', color: '#f59e0b', presence: 'busy', statusText: 'At a client demo', style: 'field', lateRate: 0.1 },
  { first: 'Tanya', last: 'Bhatia', email: 'tanya.bhatia@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Content Strategist', manager: 'nikhil.bansal@futuristglobal.com', joined: '2024-02-19', birthday: '1996-04-04', color: '#a855f7', presence: 'available', style: 'remote', lateRate: 0.08 },
  { first: 'Arnav', last: 'Dutta', email: 'arnav.dutta@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Sales Development Representative', manager: 'nikhil.bansal@futuristglobal.com', joined: '2025-08-18', birthday: '2001-10-10', color: '#22c55e', presence: 'available', style: 'office', lateRate: 0.22 },
  { first: 'Varun', last: 'Khanna', email: 'varun.khanna@futuristglobal.com', role: 'employee', dept: 'Sales & Marketing', title: 'Sales Executive', manager: 'nikhil.bansal@futuristglobal.com', joined: '2021-02-01', birthday: '1990-01-29', color: '#64748b', status: 'DEACTIVATED', statusDaysAgo: 45, style: 'field', lateRate: 0.15 },
  // Human Resources
  { first: 'Simran', last: 'Kaur', email: 'simran.kaur@futuristglobal.com', role: 'employee', dept: 'Human Resources', title: 'HR Executive', manager: 'hr@futuristglobal.com', joined: '2024-09-02', birthday: relDate(12, 1997), color: '#f43f5e', presence: 'in_office', style: 'office', lateRate: 0.05, pronouns: 'she/her' },
  // Finance
  { first: 'Suresh', last: 'Iyengar', email: 'suresh.iyengar@futuristglobal.com', role: 'manager', dept: 'Finance', title: 'Finance Controller', manager: 'vivek.anand@futuristglobal.com', joined: '2019-10-14', birthday: '1982-03-15', color: '#10b981', presence: 'in_office', style: 'office', lateRate: 0.02 },
  { first: 'Pooja', last: 'Bhatt', email: 'pooja.bhatt@futuristglobal.com', role: 'employee', dept: 'Finance', title: 'Senior Accountant', manager: 'suresh.iyengar@futuristglobal.com', joined: '2021-08-23', birthday: '1992-11-27', color: '#f59e0b', presence: 'available', style: 'office', lateRate: 0.04 },
  { first: 'Aditya', last: 'Chawla', email: 'aditya.chawla@futuristglobal.com', role: 'employee', dept: 'Finance', title: 'Payroll Specialist', manager: 'suresh.iyengar@futuristglobal.com', joined: '2023-12-04', birthday: '1995-08-22', color: '#0ea5e9', presence: 'available', style: 'hybrid', lateRate: 0.1 },
  // Operations
  { first: 'Farhan', last: 'Qureshi', email: 'farhan.qureshi@futuristglobal.com', role: 'manager', dept: 'Operations', title: 'Head of Operations', manager: 'vivek.anand@futuristglobal.com', joined: '2019-11-25', birthday: '1986-05-30', color: '#64748b', presence: 'in_office', style: 'office', lateRate: 0.03 },
  { first: 'Lakshmi', last: 'Pillai', email: 'lakshmi.pillai@futuristglobal.com', role: 'employee', dept: 'Operations', title: 'Office Manager', manager: 'farhan.qureshi@futuristglobal.com', joined: '2020-12-07', birthday: '1988-12-24', color: '#ec4899', presence: 'in_office', style: 'office', lateRate: 0.02 },
  { first: 'Manoj', last: 'Yadav', email: 'manoj.yadav@futuristglobal.com', role: 'employee', dept: 'Operations', title: 'IT Support Engineer', manager: 'farhan.qureshi@futuristglobal.com', joined: '2022-03-21', birthday: '1993-07-17', color: '#6366f1', presence: 'available', style: 'office', lateRate: 0.12 },
  { first: 'Sandeep', last: 'Gill', email: 'sandeep.gill@futuristglobal.com', role: 'employee', dept: 'Operations', title: 'Facilities Coordinator', manager: 'farhan.qureshi@futuristglobal.com', joined: '2021-04-12', birthday: '1985-10-01', color: '#94a3b8', status: 'DEACTIVATED', statusDaysAgo: 9, style: 'office', lateRate: 0.1 },
  // Customer Success (two on the US night shift)
  { first: 'Divya', last: 'Menon', email: 'divya.menon@futuristglobal.com', role: 'manager', dept: 'Customer Success', title: 'Customer Success Lead', manager: 'vivek.anand@futuristglobal.com', joined: '2020-06-08', birthday: '1989-09-16', color: '#f43f5e', presence: 'available', style: 'hybrid', lateRate: 0.05 },
  { first: 'Karan', last: 'Thakur', email: 'karan.thakur@futuristglobal.com', role: 'employee', dept: 'Customer Success', title: 'Support Engineer (US shift)', manager: 'divya.menon@futuristglobal.com', joined: '2023-02-13', birthday: '1996-01-08', color: '#0ea5e9', presence: 'offline', statusText: 'On the night shift', style: 'remote', night: true, lateRate: 0.1 },
  { first: 'Imran', last: 'Sheikh', email: 'imran.sheikh@futuristglobal.com', role: 'employee', dept: 'Customer Success', title: 'Support Engineer (US shift)', manager: 'divya.menon@futuristglobal.com', joined: '2024-05-27', birthday: '1997-11-03', color: '#22c55e', presence: 'offline', statusText: 'On the night shift', style: 'hybrid', night: true, lateRate: 0.12 },
  { first: 'Ritika', last: 'Saxena', email: 'ritika.saxena@futuristglobal.com', role: 'employee', dept: 'Customer Success', title: 'Customer Success Manager', manager: 'divya.menon@futuristglobal.com', joined: '2022-10-10', birthday: '1993-04-12', color: '#a855f7', presence: 'meeting', statusText: 'Quarterly review with a client', style: 'field', lateRate: 0.07 },
  { first: 'Ayesha', last: 'Siddiqui', email: 'ayesha.siddiqui@futuristglobal.com', role: 'employee', dept: 'Customer Success', title: 'Onboarding Specialist', manager: 'divya.menon@futuristglobal.com', joined: '2025-03-17', birthday: '1999-08-29', color: '#14b8a6', presence: 'available', style: 'hybrid', lateRate: 0.1 },
  { first: 'Gaurav', last: 'Mishra', email: 'gaurav.mishra@futuristglobal.com', role: 'employee', dept: 'Customer Success', title: 'Support Associate', manager: 'divya.menon@futuristglobal.com', joined: '2024-07-01', birthday: '1998-03-19', color: '#ef4444', status: 'SUSPENDED', statusDaysAgo: 3, style: 'office', lateRate: 0.35 },
  // Product
  { first: 'Shreya', last: 'Ghosh', email: 'shreya.ghosh@futuristglobal.com', role: 'manager', dept: 'Product', title: 'Head of Product', manager: 'vivek.anand@futuristglobal.com', joined: '2021-01-18', birthday: '1988-10-21', color: '#a855f7', presence: 'focus', statusText: 'Writing the H1 plan', style: 'hybrid', lateRate: 0.05, pronouns: 'she/her' },
  { first: 'Aniket', last: 'Jain', email: 'aniket.jain@futuristglobal.com', role: 'employee', dept: 'Product', title: 'Product Manager', manager: 'shreya.ghosh@futuristglobal.com', joined: '2023-05-22', birthday: '1993-02-06', color: '#0ea5e9', presence: 'meeting', style: 'hybrid', lateRate: 0.09 },
  { first: 'Nandini', last: 'Bose', email: 'nandini.bose@futuristglobal.com', role: 'employee', dept: 'Product', title: 'Product Analyst', manager: 'shreya.ghosh@futuristglobal.com', joined: '2024-10-07', birthday: '1998-07-26', color: '#10b981', presence: 'available', style: 'remote', lateRate: 0.08 },
];

/** An account an administrator has created without a password yet ("waiting for a password" in the admin overview). */
export const WAITING_FOR_PASSWORD = { email: 'new.joiner@futuristglobal.com', first: 'Riya', last: 'Kapoor', title: 'Junior Engineer', dept: 'Engineering', color: '#0ea5e9', manager: 'siddharth.agarwal@futuristglobal.com' };

// ─────────────── Holidays ───────────────

type HolidayRow = [name: string, monthDay: string, type: 'MANDATORY' | 'OPTIONAL' | 'COMPANY' | 'SPECIAL_WORKING_DAY'];

/** Fixed-date holidays, valid every year. */
export const FIXED_HOLIDAYS: HolidayRow[] = [
  ['New Year', '01-01', 'MANDATORY'],
  ['Republic Day', '01-26', 'MANDATORY'],
  ['Labour Day', '05-01', 'OPTIONAL'],
  ['Independence Day', '08-15', 'MANDATORY'],
  ['Gandhi Jayanti', '10-02', 'MANDATORY'],
  ['Christmas', '12-25', 'MANDATORY'],
];

/**
 * Festival dates move every year. These are demo dates for the years we know; other years get the fixed holidays only.
 * HR confirms the real list before each year.
 */
const FESTIVALS: Record<number, HolidayRow[]> = {
  2025: [
    ['Makar Sankranti / Pongal', '01-14', 'OPTIONAL'],
    ['Holi', '03-14', 'MANDATORY'],
    ['Eid al-Fitr', '03-31', 'MANDATORY'],
    ['Ambedkar Jayanti', '04-14', 'OPTIONAL'],
    ['Good Friday', '04-18', 'OPTIONAL'],
    ['Ganesh Chaturthi', '08-27', 'OPTIONAL'],
    ['Dussehra', '10-02', 'OPTIONAL'],
    ['Diwali', '10-20', 'MANDATORY'],
    ['Guru Nanak Jayanti', '11-05', 'OPTIONAL'],
  ],
  2026: [
    ['Makar Sankranti / Pongal', '01-14', 'OPTIONAL'],
    ['Holi', '03-04', 'MANDATORY'],
    ['Eid al-Fitr', '03-20', 'MANDATORY'],
    ['Good Friday', '04-03', 'OPTIONAL'],
    ['Ambedkar Jayanti', '04-14', 'OPTIONAL'],
    ['Bakrid / Eid al-Adha', '05-27', 'OPTIONAL'],
    ['Raksha Bandhan', '08-28', 'OPTIONAL'],
    ['Janmashtami', '09-04', 'OPTIONAL'],
    ['Ganesh Chaturthi', '09-14', 'OPTIONAL'],
    ['Dussehra', '10-20', 'MANDATORY'],
    ['Diwali', '11-08', 'MANDATORY'],
    ['Diwali break', '11-09', 'COMPANY'],
    ['Guru Nanak Jayanti', '11-24', 'OPTIONAL'],
  ],
  2027: [
    ['Makar Sankranti / Pongal', '01-15', 'OPTIONAL'],
    ['Eid al-Fitr', '03-10', 'MANDATORY'],
    ['Holi', '03-22', 'MANDATORY'],
    ['Good Friday', '03-26', 'OPTIONAL'],
    ['Ambedkar Jayanti', '04-14', 'OPTIONAL'],
    ['Bakrid / Eid al-Adha', '05-17', 'OPTIONAL'],
    ['Raksha Bandhan', '08-17', 'OPTIONAL'],
    ['Janmashtami', '08-25', 'OPTIONAL'],
    ['Ganesh Chaturthi', '09-04', 'OPTIONAL'],
    ['Dussehra', '10-09', 'MANDATORY'],
    ['Diwali', '10-29', 'MANDATORY'],
    ['Guru Nanak Jayanti', '11-14', 'OPTIONAL'],
  ],
  2028: [
    ['Holi', '03-11', 'MANDATORY'],
    ['Good Friday', '04-14', 'OPTIONAL'],
    ['Dussehra', '09-27', 'MANDATORY'],
    ['Diwali', '10-17', 'MANDATORY'],
  ],
};

/** nth weekday (0 = Sunday) of a month, as MM-DD. */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Every holiday row for a year: fixed dates, festivals, plus a company offsite and a year-end working Saturday. */
export function holidaysFor(year: number) {
  const rows: HolidayRow[] = [
    ...FIXED_HOLIDAYS,
    ...(FESTIVALS[year] ?? []),
    ['Company offsite', nthWeekday(year, 12, 5, 2), 'COMPANY'],
    ['Year-end release Saturday', nthWeekday(year, 12, 6, 3), 'SPECIAL_WORKING_DAY'],
  ];
  return rows.map(([name, md, type]) => ({ name, date: `${year}-${md}`, type }));
}

// ─────────────── Chat ───────────────
// Message text never contains "general" or the full names "Rohan Verma" / "Ananya Iyer": the browser tests find
// conversations by those words, and the conversation list shows the latest message under each name.

export type ChannelDef = { name: string; description: string; topic?: string; type: 'PUBLIC' | 'PRIVATE'; isDefault?: boolean; archivedDaysAgo?: number; members: (p: Person, i: number) => boolean };
const inDept = (...d: string[]) => (p: Person) => d.includes(p.dept);
const isOneOf = (...emails: string[]) => (p: Person) => emails.includes(p.email);
const either =
  (...fs: ((p: Person, i: number) => boolean)[]) =>
  (p: Person, i: number) =>
    fs.some((f) => f(p, i));

export const CHANNELS: ChannelDef[] = [
  { name: 'general', description: 'Company-wide chatter and news', type: 'PUBLIC', isDefault: true, members: () => true },
  { name: 'announcements', description: 'Official company announcements', type: 'PUBLIC', isDefault: true, members: () => true },
  { name: 'development', description: 'Engineering discussion, reviews and releases', type: 'PUBLIC', members: inDept('Engineering') },
  { name: 'qa-testing', description: 'Test plans, bug reports and verification', type: 'PUBLIC', members: either(inDept('Quality Assurance'), isOneOf('manager@futuristglobal.com', 'employee@futuristglobal.com', 'siddharth.agarwal@futuristglobal.com')) },
  { name: 'project-updates', description: 'Status updates across projects', type: 'PUBLIC', members: () => true },
  { name: 'ideas', description: 'Suggestions to improve the product and the workplace', type: 'PUBLIC', members: (p, i) => i < 12 || ['Product', 'Customer Success'].includes(p.dept) },
  { name: 'help-support', description: 'Ask for help with tools, access and IT', type: 'PUBLIC', members: (p, i) => i < 9 || p.dept === 'Operations' || p.joined > new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10) },
  { name: 'team-discussion', description: 'Water-cooler conversations', type: 'PUBLIC', members: (p, i) => i < 10 || i % 3 === 0 },
  { name: 'management', description: 'Leadership — private', type: 'PRIVATE', members: (p) => ['administrator', 'hr_admin', 'manager'].includes(p.role) },
  { name: 'product', description: 'Roadmap, discovery and release planning', topic: 'H1 planning: themes due Friday', type: 'PUBLIC', members: either(inDept('Product', 'Design'), isOneOf('manager@futuristglobal.com', 'employee@futuristglobal.com', 'siddharth.agarwal@futuristglobal.com', 'divya.menon@futuristglobal.com')) },
  { name: 'customer-success', description: 'Customer health, escalations and renewals', type: 'PUBLIC', members: either(inDept('Customer Success', 'Product'), isOneOf('nikhil.bansal@futuristglobal.com', 'mehul.shah@futuristglobal.com')) },
  { name: 'design-critique', description: 'Share work in progress and get feedback', type: 'PUBLIC', members: either(inDept('Design'), isOneOf('employee@futuristglobal.com', 'shreya.ghosh@futuristglobal.com', 'aniket.jain@futuristglobal.com', 'rhea.dsouza@futuristglobal.com')) },
  { name: 'sales-wins', description: 'Deals closed and customer love', type: 'PUBLIC', members: either(inDept('Sales & Marketing', 'Customer Success'), isOneOf('vivek.anand@futuristglobal.com', 'admin@futuristglobal.com', 'suresh.iyengar@futuristglobal.com')) },
  { name: 'operations', description: 'Office, facilities, IT and travel', type: 'PUBLIC', members: either(inDept('Operations', 'Finance'), isOneOf('hr@futuristglobal.com', 'simran.kaur@futuristglobal.com')) },
  { name: 'releases', description: 'Release notes and deploy windows', topic: 'Next release: Thursday 6 PM', type: 'PUBLIC', members: either(inDept('Engineering', 'Quality Assurance'), isOneOf('shreya.ghosh@futuristglobal.com', 'aniket.jain@futuristglobal.com', 'divya.menon@futuristglobal.com')) },
  { name: 'finance-team', description: 'Month-end close, payroll and audits', type: 'PRIVATE', members: either(inDept('Finance'), isOneOf('vivek.anand@futuristglobal.com', 'hr@futuristglobal.com')) },
  { name: 'night-shift', description: 'US support shift handovers', type: 'PRIVATE', members: isOneOf('divya.menon@futuristglobal.com', 'karan.thakur@futuristglobal.com', 'imran.sheikh@futuristglobal.com', 'manoj.yadav@futuristglobal.com') },
  { name: 'book-club', description: 'One book a month, discussed on the last Friday', type: 'PUBLIC', members: isOneOf('tara.joshi@futuristglobal.com', 'kriti.malik@futuristglobal.com', 'pooja.bhatt@futuristglobal.com', 'aniket.jain@futuristglobal.com', 'lakshmi.pillai@futuristglobal.com', 'meera.nair@futuristglobal.com') },
  { name: 'celebrations', description: 'Birthdays, festivals and the fun committee', type: 'PUBLIC', members: (p, i) => i % 2 === 0 || p.dept === 'Human Resources' },
  { name: 'hackathon-2025', description: 'Internal hackathon (finished)', type: 'PUBLIC', archivedDaysAgo: 20, members: (p) => ['Engineering', 'Design', 'Product', 'Quality Assurance'].includes(p.dept) },
];

/** Most recent messages, minutes ago. Unchanged from the original seed. */
export const RECENT: Record<string, [string, string, number][]> = {
  general: [
    ['hr@futuristglobal.com', 'Good morning everyone. Reminder: the townhall is on Friday at 4pm in the main conference room and on the stream.', 300],
    ['admin@futuristglobal.com', 'Welcome to FG One, team. This is now our home for chat, updates and HR. Shout here if anything looks off.', 240],
    ['kabir.singh@futuristglobal.com', 'Loving the new workspace already. Dark mode looks great.', 200],
    ['zara.khan@futuristglobal.com', 'The Diwali celebration photos are up on the shared drive — thank you all for making it special!', 95],
    ['manager@futuristglobal.com', 'Kudos to @Ananya for shipping the new onboarding flow ahead of schedule.', 40],
  ],
  development: [
    ['manager@futuristglobal.com', 'Sprint 42 starts today. Board is updated — please pick your tickets by noon.', 180],
    ['meera.nair@futuristglobal.com', 'Staging deploy is green. Prod release window is 6pm.', 120],
    ['employee@futuristglobal.com', 'PR for the dashboard widgets is up, would love a review when someone has a moment.', 60],
    ['vikram.rao@futuristglobal.com', 'On it, reviewing now.', 55],
  ],
  'qa-testing': [
    ['sneha.kulkarni@futuristglobal.com', 'Regression suite for 3.8 is scheduled tonight. Please log blockers here.', 150],
    ['arjun.patel@futuristglobal.com', 'Found a flaky test in the payments flow, raising a ticket.', 70],
  ],
  'project-updates': [
    ['manager@futuristglobal.com', 'Onboarding revamp: design signed off, build is 70% done. Tracking in https://github.com/arvind-m-dev/F-G_one', 210],
    ['dev.malhotra@futuristglobal.com', 'Updated the dashboard explorations in Figma, feedback welcome before Thursday.', 90],
  ],
  ideas: [['tara.joshi@futuristglobal.com', 'What if daily standups could be posted straight from chat and summarised for the week?', 160]],
  announcements: [['hr@futuristglobal.com', 'Open enrolment for the health insurance top-up closes on the 15th. Details in the HR announcement on your dashboard.', 1440]],
};

/** Older history per channel: spread over the last few weeks, authors picked from the channel's members. */
export const HISTORY: Record<string, string[]> = {
  general: [
    'Reminder: the cafeteria is closed on Saturday for deep cleaning.',
    'Lost and found: a black water bottle with stickers is at the front desk.',
    'Big thanks to the facilities team for fixing the air conditioning on the 3rd floor.',
    'Who else is joining the cricket match on Sunday? We need two more players.',
    'The new coffee machine is here. Please do not put oat milk in the steam wand.',
    'Parking on level B2 will be closed for painting next week.',
    'Congratulations to the Customer Success team for the best CSAT quarter so far.',
    'Please keep the quiet zone quiet — phone calls in the booths, please.',
    'The townhall slides from last month are in the shared drive under Company.',
    'Shout-out to @Meera for staying late to help the support team with the outage.',
    'Fire drill is scheduled for Thursday at 11 AM. Please follow the floor wardens.',
    'Snacks from the Pune visit are in the pantry, help yourselves.',
    'If you see the visitor badge printer jam again, ping @Manoj.',
    'Happy Friday everyone. Lovely week of releases.',
  ],
  development: [
    'Heads-up: I am upgrading the Postgres version on staging this afternoon.',
    'Can someone review the rate-limit change? It touches the login flow.',
    'The flaky socket test was a race in the reconnect handler. Fix is merged.',
    'We should move the image resizing job off the API process. Writing a short proposal.',
    'Node 22 upgrade is done on CI. Builds are about 15% faster.',
    'Reminder: no Friday deploys after 4 PM unless it is a hotfix.',
    'Prisma migration for leave balances is ready for review.',
    'Who owns the search indexer now? It has been timing out since Tuesday.',
    'I paired with @Yash on the attendance export, nice work on the tests.',
    'Error budget for the month is at 62%. Let us keep an eye on the chat latency.',
    'Dependency audit found two moderate issues, both in dev tooling. Patching today.',
    'Draft ADR for splitting the notifications worker is in the docs folder.',
    'Load test results: p95 at 180 ms with 500 concurrent sockets. Good headroom.',
    'Pushing a fix for the timezone bug in the weekly report.',
  ],
  'qa-testing': [
    'Test plan for the leave calendar is ready. Please add edge cases around holidays.',
    'Mobile Safari: the composer jumps when the keyboard opens. Repro video attached in the ticket.',
    'Regression for 3.7 passed with two known issues, both cosmetic.',
    'Automation coverage for approvals is now at 80%.',
    'Can we get a staging account with the HR role for exploratory testing?',
    'Verified the attendance correction fix on staging. Closing the ticket.',
    'Dark mode contrast check is done for the admin pages. Three small issues logged.',
    'Smoke tests now run on every merge to main.',
  ],
  'project-updates': [
    'Payments revamp: discovery done, estimates next week.',
    'Mobile app 2.4 is in beta with 40 internal testers.',
    'Customer portal: the first two enterprise customers are live.',
    'Data warehouse migration is 60% complete. No downtime expected.',
    'Hiring: two backend roles and one product designer are open. Referrals welcome.',
    'Marketing site refresh launches with the new brand colours on the 1st.',
    'Security review of the admin portal is complete; fixes are in this sprint.',
    'Office move planning: shortlist of three locations shared with leadership.',
  ],
  ideas: [
    'A shared calendar for team offsites so we stop double-booking the big room.',
    'Could we have a quiet hour after lunch with no meetings?',
    'Let us try a monthly demo day where every team shows one thing.',
    'Standing desks in the design corner would be great.',
    'A buddy programme for new joiners for their first month.',
    'Book budget for learning: one book per quarter per person.',
  ],
  'help-support': [
    'My VPN keeps disconnecting every 30 minutes. Anyone else?',
    'How do I get access to the analytics dashboard?',
    'Printer on the 2nd floor is offline again.',
    'Laptop battery swelling — what is the replacement process?',
    'Is there a guide for setting up the authenticator app for two-step verification?',
    'Cannot join the Wi-Fi in the new meeting room.',
    'Need a second monitor for the new joiner starting Monday.',
    'Which form do I use for a travel request?',
  ],
  'team-discussion': [
    'Best biryani near the office? Asking for a team lunch.',
    'Anyone watched the new space documentary? Highly recommend.',
    'Monsoon is officially over, the commute is bearable again.',
    'Who is running the marathon next month? Training group meets at 6 AM.',
    'Recommend me a podcast for long drives.',
    'Weekend trek to Rajmachi — four seats left in the car.',
    'The plant in the corner finally has a new leaf.',
    'Chai or coffee? Settling this once and for all.',
    'Lunch-and-learn on Thursday: personal finance basics.',
  ],
  management: [
    'Headcount plan for next quarter is in the leadership folder. Please review your rows.',
    'Attrition is down to 9% annualised. Good trend.',
    'We need owners for the three offsite workstreams.',
    'Budget review moves to Wednesday at 3 PM.',
    'Performance cycle timeline: self reviews open on the 10th.',
    'Reminder to approve pending leave before the month closes.',
  ],
  product: [
    'H1 themes draft: reliability, faster onboarding, and better reporting.',
    'Customer interviews this week: five scheduled, notes in the research folder.',
    'Usage of the new home widgets is up 34% week on week.',
    'Please add your bets to the planning doc by Friday.',
    'Competitor launched a similar attendance feature. Our edge is the approvals flow.',
    'Release notes for 3.8 are drafted. Engineering, please check the technical bits.',
    'Proposal: retire the old reports page once the new one ships.',
    'NPS survey goes out on Monday to all active workspaces.',
  ],
  'customer-success': [
    'Northwind renewal signed for two more years.',
    'Escalation from Globex about slow exports. Engineering is looking at it.',
    'Onboarding checklist v2 is live. Average setup time dropped to three days.',
    'Can product join the Initech QBR on Thursday?',
    'CSAT for the week: 4.7 out of 5 from 182 responses.',
    'Two customers asked for a client portal. Logging it in the feedback board.',
    'Holiday support roster is up. Please swap shifts through Divya.',
    'Umbrella Corp wants a training session for their HR admins.',
    'Churn risk list updated. Three accounts need an executive sponsor call.',
  ],
  'design-critique': [
    'New empty states for the leave page, feedback welcome.',
    'Exploring a calmer colour for pending approvals.',
    'Usability test: four of five people found the check-in button immediately.',
    'Icon set audit: replacing the last custom icons with the standard set.',
    'Mobile navigation proposal with four tabs instead of five.',
    'Accessibility pass: focus rings are back on every button.',
  ],
  'sales-wins': [
    'Closed Contoso — 250 seats, annual plan.',
    'Fabrikam expanded from one office to three.',
    'Signed our first customer in Singapore.',
    'Demo-to-close rate this month is 31%.',
    'Partnership with a payroll provider is signed.',
    'Webinar had 420 sign-ups, a record for us.',
  ],
  operations: [
    'Housekeeping schedule changes from Monday: evenings instead of mornings.',
    'New ID cards are ready at reception.',
    'Travel desk: please book flights at least ten days ahead.',
    'Generator test on Saturday morning, power may blink twice.',
    'Laptop refresh: twelve machines arrive next week.',
    'The 4th floor meeting rooms now have booking screens.',
  ],
  releases: [
    'Release 3.7.2 is out: fixes for exports and notifications.',
    'Deploy window tonight 6–7 PM. Expect a short socket reconnect.',
    'Release 3.8 feature freeze is Wednesday.',
    'Rollback drill passed in 4 minutes.',
    'Hotfix for the holiday calendar time zone is live.',
    'Staging is frozen for the release candidate. Please do not merge to main.',
    'Changelog is published for customers.',
  ],
  'finance-team': [
    'Month-end close: please send accruals by the 28th.',
    'Payroll inputs locked for this month.',
    'Audit queries from the statutory auditors are in the shared sheet.',
    'Expense claims over 30 days old need a manager note.',
    'GST filing done for the quarter.',
  ],
  'night-shift': [
    'Handover: two open tickets from Acme, both waiting on their admin.',
    'Quiet night. Answered 23 chats, no escalations.',
    'Outage alert at 02:10 was a false positive from the monitoring check.',
    'Please leave the support laptop charging at the desk.',
    'Shift swap next Tuesday — can anyone cover?',
    'Handover: one billing question parked for the finance team.',
  ],
  'book-club': [
    'This month: "The Design of Everyday Things". Discussion on the last Friday.',
    'Halfway through. The chapter on feedback is great.',
    'Next month suggestions? I vote for something fiction.',
    'Notes from the last session are pinned in the doc.',
  ],
  celebrations: [
    'Cake for the October birthdays is on Friday at 4 PM.',
    'Rangoli competition entries close on Wednesday.',
    'Secret Santa sign-ups are open.',
    'Thank you for the farewell lunch, everyone.',
    'Photos from the team dinner are in the shared album.',
    'Potluck next Friday — sign up for a dish in the sheet.',
  ],
  'hackathon-2025': [
    'Hackathon teams are final. Twelve teams, 48 people.',
    'Demo order is up. Each team gets five minutes.',
    'Winners: the voice check-in prototype. Congratulations!',
    'Thanks for a fantastic two days. Archiving this channel next week.',
  ],
};

/** Replies used for threads. {name} is the parent author's first name. */
export const REPLIES = [
  'Thanks, {name}!',
  'On it.',
  '+1, makes sense.',
  'Good catch, {name}.',
  'Done — let me know if anything looks off.',
  'I can pick this up after lunch.',
  'Can we take this to a quick call?',
  'Adding this to the agenda for tomorrow.',
  'Same here. Following.',
  'Nice work, {name}.',
  'Shared the details in the doc.',
  'Let us check with the team first.',
  'Looks good to me.',
  'I will update the ticket.',
  'Agree with {name} on this one.',
  'Can you share a screenshot?',
  'Fixed, thanks for flagging.',
  'Count me in.',
  'Happy to help with this.',
  'Great news!',
];

/** Direct and group conversations: participants, then [participant index, text] lines (oldest first). */
export const DIRECT: { people: string[]; lines: [number, string][]; minutesAgo: number }[] = [
  // The Rohan ↔ Ananya and Priya ↔ Ananya conversations from the original seed.
  { people: ['manager@futuristglobal.com', 'employee@futuristglobal.com'], minutesAgo: 22, lines: [[0, 'Hey Ananya, can we sync for 10 mins about the widget layout?'], [1, 'Sure! Free after 2:30.'], [0, 'Perfect, sending an invite.']] },
  { people: ['hr@futuristglobal.com', 'employee@futuristglobal.com'], minutesAgo: 10, lines: [[0, 'Happy birthday in advance. Cake in the pantry at 4!']] },
  { people: ['kabir.singh@futuristglobal.com', 'employee@futuristglobal.com'], minutesAgo: 75, lines: [[0, 'Your API change for the widgets is merged on my side.'], [1, 'Thank you! I will switch the frontend over today.'], [0, 'Ping me if the payload shape feels off.']] },
  { people: ['tara.joshi@futuristglobal.com', 'employee@futuristglobal.com'], minutesAgo: 130, lines: [[0, 'I updated the card spacing in Figma.'], [1, 'Looks much better. Can I get the dark mode version too?'], [0, 'Done, same frame.']] },
  { people: ['tara.joshi@futuristglobal.com', 'dev.malhotra@futuristglobal.com', 'employee@futuristglobal.com'], minutesAgo: 300, lines: [[1, 'Quick handoff for the profile page — specs are final.'], [0, 'I added the empty states as well.'], [2, 'Great, I will start tomorrow morning.'], [1, 'Shout if anything is unclear.']] },
  { people: ['kabir.singh@futuristglobal.com', 'meera.nair@futuristglobal.com', 'vikram.rao@futuristglobal.com', 'omkar.pawar@futuristglobal.com'], minutesAgo: 95, lines: [[1, 'Deploy crew: release candidate is on staging.'], [3, 'Dashboards look clean.'], [0, 'Migrations ran in 40 seconds.'], [2, 'I will watch the error rates after the deploy.'], [1, 'Thanks all, shipping at 6.']] },
  { people: ['hr@futuristglobal.com', 'rahul.desai@futuristglobal.com', 'simran.kaur@futuristglobal.com'], minutesAgo: 210, lines: [[1, 'Three offers out this week, two accepted.'], [0, 'Great. Let us plan their first day together.'], [2, 'Laptops are requested with IT.']] },
  { people: ['hr@futuristglobal.com', 'rahul.desai@futuristglobal.com'], minutesAgo: 400, lines: [[0, 'Can you share the interview panel for the designer role?'], [1, 'Dev, Tara and Shreya. Slots on Wednesday.']] },
  { people: ['dev.malhotra@futuristglobal.com', 'tara.joshi@futuristglobal.com'], minutesAgo: 600, lines: [[0, 'Good job in the client review today.'], [1, 'Thanks! The feedback was really useful.']] },
  { people: ['nikhil.bansal@futuristglobal.com', 'zara.khan@futuristglobal.com'], minutesAgo: 180, lines: [[0, 'Can we push the campaign email to Tuesday?'], [1, 'Yes, I will reschedule it.'], [0, 'Thanks.']] },
  { people: ['admin@futuristglobal.com', 'vivek.anand@futuristglobal.com'], minutesAgo: 1500, lines: [[1, 'Can you join the board call on Thursday for the tech update?'], [0, 'Yes. I will bring the reliability numbers.'], [1, 'Perfect.']] },
  { people: ['divya.menon@futuristglobal.com', 'karan.thakur@futuristglobal.com', 'imran.sheikh@futuristglobal.com'], minutesAgo: 720, lines: [[0, 'Night shift: Globex might call about exports, the fix lands tomorrow.'], [1, 'Noted.'], [2, 'I will keep their ticket updated.']] },
  { people: ['suresh.iyengar@futuristglobal.com', 'pooja.bhatt@futuristglobal.com'], minutesAgo: 260, lines: [[0, 'Are the vendor payments scheduled?'], [1, 'Yes, all 18 go out on Friday.']] },
  { people: ['sneha.kulkarni@futuristglobal.com', 'arjun.patel@futuristglobal.com'], minutesAgo: 340, lines: [[1, 'The payments flaky test is a timing issue. Fix in review.'], [0, 'Nice, thanks for digging in.']] },
  { people: ['farhan.qureshi@futuristglobal.com', 'lakshmi.pillai@futuristglobal.com'], minutesAgo: 480, lines: [[0, 'Can we get quotes for the new chairs by Monday?'], [1, 'Three vendors are sending them.']] },
  { people: ['shreya.ghosh@futuristglobal.com', 'aniket.jain@futuristglobal.com', 'nandini.bose@futuristglobal.com'], minutesAgo: 150, lines: [[0, 'Planning review moved to 3 PM.'], [2, 'Usage charts are in the doc.'], [1, 'I will walk through the roadmap draft.']] },
  { people: ['siddharth.agarwal@futuristglobal.com', 'yash.tiwari@futuristglobal.com'], minutesAgo: 90, lines: [[1, 'Is there a guide for running the API tests locally?'], [0, 'Yes, the README in apps/api. Happy to pair at 4.'], [1, 'Thank you!']] },
];

// ─────────────── Announcements ───────────────

export type AnnouncementDef = {
  author: string;
  title: string;
  body: string;
  category: 'COMPANY_NEWS' | 'IMPORTANT_UPDATE' | 'HOLIDAY' | 'NEW_FEATURE' | 'POLICY' | 'EVENT' | 'TEAM_UPDATE' | 'URGENT';
  priority?: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  dept?: string;
  pinned?: boolean;
  requireAck?: boolean;
  /** Hours ago it was published. */
  hoursAgo: number;
  /** Hours from now it expires (negative = already expired). */
  expiresInHours?: number;
  /** Share of the audience who confirmed reading (requireAck only). */
  ackShare?: number;
};

export const ANNOUNCEMENTS: AnnouncementDef[] = [
  // The four from the original seed.
  { author: 'admin@futuristglobal.com', title: 'Welcome to FG One', category: 'NEW_FEATURE', body: 'FG One is our new unified workspace for chat, attendance, HR and daily updates. Explore the dashboard, set your status, and say hi in #general!', priority: 'IMPORTANT', pinned: true, hoursAgo: 48 },
  { author: 'hr@futuristglobal.com', title: 'Health insurance top-up enrolment', category: 'POLICY', requireAck: true, ackShare: 0.45, body: 'Open enrolment for the optional family health insurance top-up closes on the 15th. Reach out to HR for plan details.', hoursAgo: 24 },
  { author: 'manager@futuristglobal.com', dept: 'Engineering', title: 'Engineering: on-call rotation updated', category: 'TEAM_UPDATE', body: 'The on-call rotation for next month is published. Please confirm your slots by Friday.', hoursAgo: 6 },
  { author: 'hr@futuristglobal.com', title: 'Annual townhall — Friday 4 PM', category: 'EVENT', body: 'Join leadership for the annual townhall. Q&A submissions are open until Thursday evening.', priority: 'CRITICAL', hoursAgo: 3 },
  // More history.
  { author: 'hr@futuristglobal.com', title: 'Updated leave policy', category: 'POLICY', priority: 'IMPORTANT', pinned: true, requireAck: true, ackShare: 0.7, hoursAgo: 20 * 24, body: 'From this month, up to five unused earned leave days carry over to next year, and half days can be requested for casual and sick leave. The full policy is in the HR folder. Please confirm you have read it.' },
  { author: 'hr@futuristglobal.com', title: 'Code of conduct refresher', category: 'POLICY', requireAck: true, ackShare: 0.85, hoursAgo: 45 * 24, expiresInHours: -15 * 24, body: 'Every year we ask everyone to re-read the code of conduct. It covers respectful behaviour, conflicts of interest and how to raise a concern safely.' },
  { author: 'admin@futuristglobal.com', title: 'Turn on two-step verification', category: 'IMPORTANT_UPDATE', priority: 'IMPORTANT', requireAck: true, ackShare: 0.35, hoursAgo: 6 * 24, body: 'Please turn on two-step verification in Settings → Security. It takes two minutes with any authenticator app and protects your account if your password leaks.' },
  { author: 'vivek.anand@futuristglobal.com', title: 'Quarterly results and what comes next', category: 'COMPANY_NEWS', hoursAgo: 30 * 24, body: 'We grew revenue 18% this quarter and welcomed 40 new customers. Next quarter we focus on reliability and faster onboarding. Thank you for the hard work.' },
  { author: 'farhan.qureshi@futuristglobal.com', title: 'Network maintenance on Saturday', category: 'URGENT', priority: 'CRITICAL', hoursAgo: 12 * 24, expiresInHours: -9 * 24, body: 'The office network will be down from 10 AM to 2 PM on Saturday for an upgrade. VPN and cloud tools are not affected.' },
  { author: 'divya.menon@futuristglobal.com', dept: 'Customer Success', title: 'Weekend support roster', category: 'TEAM_UPDATE', hoursAgo: 4 * 24, body: 'The weekend support roster for the next four weeks is in the team folder. Swap shifts with each other and tell me by Thursday.' },
  { author: 'suresh.iyengar@futuristglobal.com', title: 'Submit expense claims by the 25th', category: 'IMPORTANT_UPDATE', hoursAgo: 8 * 24, expiresInHours: 17 * 24, body: 'Claims submitted after the 25th move to next month’s payroll. Attach receipts for anything over ₹500.' },
  { author: 'lakshmi.pillai@futuristglobal.com', title: 'Blood donation drive', category: 'EVENT', hoursAgo: 10 * 24, expiresInHours: 5 * 24, body: 'A blood donation camp is at the office next Wednesday from 10 AM to 3 PM. Sign up at reception. Snacks for every donor.' },
  { author: 'hr@futuristglobal.com', title: 'Welcome our new joiners', category: 'COMPANY_NEWS', hoursAgo: 11 * 24, body: 'Please welcome Yash (Engineering intern) and Rhea (Frontend Engineer). Say hello when you see them on the 2nd floor.' },
  { author: 'hr@futuristglobal.com', title: 'Holiday calendar for next year', category: 'HOLIDAY', hoursAgo: 5 * 24, body: 'Next year’s holiday calendar is published in FG One under Holidays. Optional holidays can be taken in place of any two festivals.' },
  { author: 'suresh.iyengar@futuristglobal.com', dept: 'Finance', title: 'Quarter close timeline', category: 'TEAM_UPDATE', hoursAgo: 15 * 24, body: 'Books close on the 3rd working day. Please clear open reconciliations before then.' },
];
