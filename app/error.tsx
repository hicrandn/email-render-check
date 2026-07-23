'use client';

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-(--canvas) p-6 text-center text-(--fg)">
      <p className="text-sm font-semibold">Something went wrong.</p>
      <p className="max-w-sm text-xs text-(--fg-muted)">{error.message}</p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
      >
        Try again
      </button>
    </div>
  );
}
