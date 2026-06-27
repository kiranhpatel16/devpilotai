import { useEffect, useState } from 'react';
import type { TestScreenshot } from '@cpwork/shared';
import { X } from 'lucide-react';
import { taskBtnGhost, taskMuted, taskPanel, taskTitle } from './taskStyles';

function screenshotUrl(path: string): string {
  return `/api${path}`;
}

interface ScreenshotLightboxProps {
  shot: TestScreenshot;
  onClose: () => void;
}

function ScreenshotLightbox({ shot, onClose }: ScreenshotLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot: ${shot.label}`}
      onClick={onClose}
    >
      <div
        className={`${taskPanel} flex max-h-[90vh] w-full max-w-4xl flex-col shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 className={taskTitle}>{shot.label}</h2>
            {shot.url && (
              <p className={`mt-0.5 truncate text-xs ${taskMuted}`}>{shot.url}</p>
            )}
          </div>
          <button type="button" className={taskBtnGhost} aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-950/40 p-4">
          <img
            src={screenshotUrl(shot.path)}
            alt={shot.label}
            className="mx-auto max-h-[70vh] w-full rounded-md object-contain object-top"
          />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-neutral-800">
          <a
            href={screenshotUrl(shot.path)}
            target="_blank"
            rel="noreferrer"
            className={`text-xs ${taskMuted} hover:underline`}
          >
            Open in new tab
          </a>
        </div>
      </div>
    </div>
  );
}

interface VisualSmokeScreenshotsProps {
  shots: TestScreenshot[];
  history?: TestScreenshot[];
  heading?: string;
}

export function VisualSmokeScreenshots({
  shots,
  history = [],
  heading = 'Screenshots',
}: VisualSmokeScreenshotsProps) {
  const [lightbox, setLightbox] = useState<TestScreenshot | null>(null);
  const allShots = [...shots, ...history];
  if (!allShots.length) return null;

  return (
    <>
      <div className="mx-4 mb-3">
        <p className={`mb-2 text-[11px] font-medium uppercase tracking-wide ${taskMuted}`}>
          {heading}
        </p>
        {shots.length > 0 && (
          <div className="mb-3">
            {history.length > 0 && (
              <p className={`mb-1.5 text-[10px] ${taskMuted}`}>Latest run</p>
            )}
            <ScreenshotThumbnailRow shots={shots} onSelect={setLightbox} />
          </div>
        )}
        {history.length > 0 && (
          <div>
            <p className={`mb-1.5 text-[10px] ${taskMuted}`}>Previous runs</p>
            <ScreenshotThumbnailRow shots={history} onSelect={setLightbox} />
          </div>
        )}
      </div>
      {lightbox && (
        <ScreenshotLightbox shot={lightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function ScreenshotThumbnailRow({
  shots,
  onSelect,
}: {
  shots: TestScreenshot[];
  onSelect: (shot: TestScreenshot) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {shots.map((shot) => (
        <figure
          key={shot.path}
          className="overflow-hidden rounded-md border border-slate-700/60 bg-slate-900/40"
        >
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => onSelect(shot)}
          >
            <img
              src={screenshotUrl(shot.path)}
              alt={shot.label}
              className="max-h-40 w-full cursor-zoom-in object-cover object-top transition-opacity hover:opacity-90"
            />
          </button>
          <figcaption className={`px-2 py-1.5 text-[11px] ${taskMuted}`}>
            {shot.label}
            {shot.capturedAt
              ? ` · ${new Date(shot.capturedAt * 1000).toLocaleString()}`
              : ''}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function visualSmokeShotCount(step: {
  screenshots?: TestScreenshot[];
  screenshotHistory?: TestScreenshot[];
}): number {
  return (step.screenshots?.length ?? 0) + (step.screenshotHistory?.length ?? 0);
}
