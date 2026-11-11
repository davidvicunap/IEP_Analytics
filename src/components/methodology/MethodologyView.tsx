"use client";

import { useI18n } from "@/lib/i18n";
import { methodology, type Block } from "@/lib/i18n/methodology";

/** How every number is sourced and calculated, in the reader's language. */
export default function MethodologyView() {
  const { lang } = useI18n();
  const M = methodology[lang];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{M.title}</h1>
        <p className="text-[15px] leading-relaxed text-muted">{M.intro}</p>
      </header>
      <nav aria-label={M.contents} className="rounded-xl border border-line bg-panel p-4">
        <p className="control-label mb-2">{M.contents}</p>
        <ol className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
          {M.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="link inline-flex min-h-11 sm:min-h-9 items-center">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {M.sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-20 space-y-3">
          <h2 id={`${s.id}-h`} className="section-title">
            {s.title}
          </h2>
          {s.body.map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
        </section>
      ))}
      <p className="border-t border-line pt-4 text-xs text-muted">{M.updated}</p>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  if (typeof b === "string") return <p className="text-[15px] leading-7">{b}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 marker:text-muted">
      {b.list.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}
