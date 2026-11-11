import { PageLoading } from '@/components/page-loading';

/** Same gutters and width as the pages themselves, so nothing jumps when the page arrives. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-8 pb-14 sm:px-10">
      <PageLoading />
    </div>
  );
}
