// The marketing landing page — stacked full-width bands, top to bottom:
// hero → stats strip → alternating image/text bands → testimonial →
// hours/location/contact trio → final CTA → business footer line.
//
// Every word and image here comes from src/config.ts (the one-file
// rebrand rule) and the page reads NOTHING from the platform: the whole
// landing is static bundle content, served to signed-out visitors and
// agents alike. Signing in changes nothing but the nav.

import { useNavigate } from "@tanstack/react-router";
import { BUSINESS } from "../config";

export function LandingPage() {
  const navigate = useNavigate();
  const goContact = (classId?: string) =>
    void navigate({ to: "/contact", search: classId ? { class: classId } : {} });

  return (
    <div>
      {/* hero */}
      <section className="hero">
        <div className="kicker">{BUSINESS.kicker}</div>
        <h1 className="hero-title">
          {BUSINESS.headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="hero-sub">{BUSINESS.subhead}</p>
        <button type="button" className="cta" onClick={() => goContact()}>
          {BUSINESS.primaryCta}
        </button>
      </section>

      {/* stats strip */}
      <section className="flex flex-wrap items-stretch justify-center px-3 py-6.5">
        {BUSINESS.stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* alternating image/text bands */}
      {BUSINESS.bands.map((band, i) => (
        <section
          key={band.title}
          className={`flex flex-col md:flex-row ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}
        >
          <div className="min-h-[210px] flex-1">
            <img src={band.image} alt={band.imageAlt} className="size-full object-cover" />
          </div>
          <div className="flex flex-1 flex-col justify-center px-7 py-10 md:px-9 md:py-11">
            <h3 className="band-title">{band.title}</h3>
            <p className="band-body">{band.body}</p>
            <div className="mt-4">
              <button
                type="button"
                className="cta"
                onClick={() =>
                  band.cta.inquireClassId
                    ? goContact(band.cta.inquireClassId)
                    : void navigate({ to: "/classes" })
                }
              >
                {band.cta.label}
              </button>
            </div>
          </div>
        </section>
      ))}

      {/* testimonial */}
      <section className="quote">
        <p>{BUSINESS.quote.text}</p>
        <div className="quote-by">{BUSINESS.quote.by}</div>
      </section>

      {/* hours / location / contact */}
      <section className="flex flex-wrap justify-center gap-x-14 gap-y-8 px-6 py-10">
        {BUSINESS.info.map((block) => (
          <div key={block.title} className="text-center">
            <div className="info-title">{block.title}</div>
            {block.lines.map((line) => (
              <p key={line} className="info-line">
                {line}
              </p>
            ))}
          </div>
        ))}
      </section>

      {/* final CTA */}
      <section className="final">
        <h3 className="final-title">{BUSINESS.finalHeadline}</h3>
        <button type="button" className="cta" onClick={() => goContact()}>
          {BUSINESS.primaryCta}
        </button>
      </section>

      <div className="foot">{BUSINESS.footerLine}</div>
    </div>
  );
}
