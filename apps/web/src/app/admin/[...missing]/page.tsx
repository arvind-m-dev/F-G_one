import { notFound } from 'next/navigation';

/** Any admin address that is not a real page shows the admin "not found" screen, inside the admin navigation. */
export default function MissingAdminPage() {
  notFound();
}
