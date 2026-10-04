// The marketing landing page — stacked full-width sections, top to bottom:
// hero → stats → featured classes → alternating image/text bands → coaches →
// testimonials → hours/location/contact → final CTA → footer.
//
// Every word and image here comes from src/config.ts (the one-file rebrand
// rule) and the page reads NOTHING from the platform: the whole landing is
// static bundle content, served to signed-out visitors and agents alike.
// Signing in changes nothing but the nav.

import { Icon } from "@iconify/react";
import { useNavigate } from "@tanstack/react-router";
import { Avatar, ClassArt } from "../components/ClassArt";
import { ClassCard } from "../components/ClassCard";
import { BUSINESS, CLASSES } from "../config";

export function LandingPage() {
  const navigate = useNavigate();
  const goContact = (classId?: string) =>
    void navigate({ to: "/contact", search: classId ? { class: classId } : {} });

  return (
    <div className="view-anim">
      {/* hero */}
      <section className="hero">
        <div className="hero-bg"><ClassArt seed="rock-hero-band" /></div>
        <div className="wrap hero-inner">
          <div className="kicker">{BUSINESS.kicker}</div>
          <h1 className="hero-title">
            {BUSINESS.headline.map((line) => (<span key={line} className="block">{line}</span>))}
          </h1>
          <p className="hero-sub">{BUSINESS.subhead}</p>
          <div className="hero-cta">
            <button type="button" className="cta cta-lg" onClick={() => goContact()}>{BUSINESS.primaryCta}</button>
            <button type="button" className="cta-ghost-light" onClick={() => void navigate({ to: "/classes" })}>See classes</button>
          </div>
        </div>
      </section>

      {/* stats */}
      <section className="stat-band">
        <div className="wrap stat-grid">
          {BUSINESS.stats.map((s) => (<div key={s.label} className="stat"><div className="stat-value">{s.value}</div><div className="stat-label">{s.label}</div></div>))}
        </div>
      </section>

      {/* featured classes */}
      <section className="wrap block">
        <div className="section-head row">
          <div><span className="eyebrow">{BUSINESS.sections.classes.eyebrow}</span><h2>{BUSINESS.sections.classes.title}</h2></div>
          <button type="button" className="inquire-btn" onClick={() => void navigate({ to: "/classes" })}>All classes <Icon icon="ph:arrow-right" width={14} /></button>
        </div>
        <div className="class-grid">
          {CLASSES.map((c) => (<ClassCard key={c.id} c={c} />))}
        </div>
      </section>

      {/* alternating image/text bands */}
      <section className="wrap" style={{ display: "grid", gap: 20, paddingBottom: 8 }}>
        {BUSINESS.bands.map((band, i) => (
          <div key={band.title} className={`band ${i % 2 === 1 ? "rev" : ""}`}>
            <div className="band-img"><img src={band.image} alt={band.imageAlt} /></div>
            <div className="band-text">
              <h3 className="band-title">{band.title}</h3>
              <p className="band-body">{band.body}</p>
              <button type="button" className="cta" onClick={() => (band.cta.inquireClassId ? goContact(band.cta.inquireClassId) : void navigate({ to: "/classes" }))}>{band.cta.label}</button>
            </div>
          </div>
        ))}
      </section>

      {/* coaches */}
      <section className="wrap block">
        <div className="section-head"><span className="eyebrow">{BUSINESS.sections.coaches.eyebrow}</span><h2>{BUSINESS.sections.coaches.title}</h2></div>
        <div className="coach-grid">
          {BUSINESS.coaches.map((co) => (
            <div className="coach" key={co.name}>
              <Avatar name={co.name} size={50} />
              <div><b>{co.name}</b><small>{co.title}</small><p>{co.bio}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* testimonials */}
      <section className="wrap block">
        <div className="section-head"><span className="eyebrow">{BUSINESS.sections.reviews.eyebrow}</span><h2>{BUSINESS.sections.reviews.title}</h2></div>
        <div className="quote-grid">
          {BUSINESS.testimonials.map((tm) => (
            <figure className="quote-card" key={tm.by}>
              <div className="stars">{[0, 1, 2, 3, 4].map((i) => (<Icon key={i} icon="ph:star-fill" width={14} />))}</div>
              <blockquote>“{tm.quote}”</blockquote>
              <figcaption>{tm.by} · {tm.detail}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* hours / location / contact */}
      <section className="wrap block">
        <div className="info-grid">
          {BUSINESS.info.map((block) => (
            <div key={block.title} className="info-block">
              <div className="info-title">{block.title}</div>
              {block.lines.map((line) => (<p key={line} className="info-line">{line}</p>))}
            </div>
          ))}
        </div>
      </section>

      {/* final CTA */}
      <section className="wrap" style={{ paddingBottom: 40 }}>
        <div className="final">
          <div className="final-bg"><ClassArt seed="rock-final-band" /></div>
          <h3 className="final-title">{BUSINESS.finalHeadline}</h3>
          <button type="button" className="cta cta-lg" onClick={() => goContact()}>{BUSINESS.primaryCta}</button>
        </div>
      </section>

      <div className="foot">{BUSINESS.footerLine}</div>
    </div>
  );
}
