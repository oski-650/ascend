# CLAUDE.md — Ascend Web Solutions

## Project Overview

This is the production website for **Ascend Web Solutions**, a web design & development agency in the Bay Area / Central Valley, CA. Led by **Oscar Robles** (Founder, Web Strategist & Developer) and **Sergio Pena** (Growth & Brand Strategist).

Deployed at: `https://ascend-flame-zeta.vercel.app/`

Built on top of a customized **"Rayo"** Next.js theme from Themeforest (`ib-themes`), heavily rebranded and extended.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.1 (App Router, Turbopack) |
| Language | TypeScript 5 (strict mode) |
| UI | React 19.2.0 |
| Styling | Pre-compiled CSS (`main.min.css`, `plugins.min.css`) + custom overrides in `public/css/styles.css`. **No Tailwind, no CSS Modules.** |
| Animation | GSAP 3 + ScrollTrigger + Flip, Lenis smooth scroll, UkiyoJS (parallax), Split-Type |
| Lottie | `lottie-react` + `@lottiefiles/dotlottie-react` |
| Forms | `@formspree/react` (endpoint `mgoooqqb`), `react-hook-form` + `zod` |
| Toasts | `react-toastify` |
| Portfolio Grid | `isotope-layout` + `imagesloaded` |
| Carousels | Swiper 12 |
| Icons | Phosphor Icons (self-hosted font in `public/fonts/Phosphor/`) |

---

## Key Architecture

- **Server/Client split:** Root `layout.tsx` is a Server Component. A `ClientLayout` wrapper (`"use client"`) handles headers, scroll, and animations. Most page files are Server Components with per-page metadata exports.
- **Content:** All content lives in local JSON files under `/data/`. No database, no CMS, no external API.
- **Animation system:** A single `useGsapScrollScaleAnimations` hook re-runs on every `pathname` change and applies GSAP ScrollTrigger animations via CSS class selectors (`.anim-uni-in-up`, `.animate-card-3`, etc.).
- **Smooth scroll:** Lenis proxies to GSAP ScrollTrigger. **Lenis is intentionally disabled on iOS** (iPad/iPhone/iPod) to avoid known compatibility issues.
- **Theme switching:** Dark/light mode persisted in `localStorage` under `color-scheme`. An inline `<head>` script prevents flash of wrong theme on load.
- **Contact form:** Formspree (`mgoooqqb`) + react-hook-form + zod validation + honeypot field (`website`) for bot protection.

---

## File Structure Summary

```
app/                      # Next.js App Router pages
components/
  layout/                 # ClientLayout (root client wrapper)
  headers/                # Header1, MobileMenu, ColorSwitcher
  footers/                # Footer2, SubscribeForm
  homes/home-web-agency/  # Homepage sections (Hero, About, Services, etc.)
  animation/              # AnimatedButton, BackgroundParallax, MasonryGrid, RevealText, etc.
  common/                 # Shared: Blogs, Cta, Approch, Counter, Logo, etc.
  scroll/                 # InitScroll, LenisSmoothScroll, ScrollTop
  blogs/                  # BlogDetails, Blogs1, Blogs2, CommentForm
  portfolios/             # PortfolioMasonry, DetailsHero, Challages, etc.
  other-pages/            # contact/, about/, services/, team/ sections
data/                     # All JSON content files
hooks/                    # useGsapScrollScaleAnimations
schemas/                  # Zod schemas (contact.ts)
types/                    # TypeScript interfaces
public/
  css/styles.css          # Custom CSS overrides (imports main.min.css, plugins.min.css)
  img/                    # All images
  video/                  # Hero and section background videos
  fonts/                  # Self-hosted Phosphor icon font
```

---

## Active Routes

| Route | Component / Purpose |
|---|---|
| `/` | Homepage |
| `/contact` | Contact form (Formspree) + locations |
| `/projects` | Portfolio masonry grid |
| `/project-details/[slug]` | Individual project detail page |
| `/about-us` | Team, approach, techstack |
| `/services` | Services listing |
| `/pricing` | 3-tier pricing cards |
| `/blog` | Blog listing |
| `/blog-article/[slug]` | Full blog article |
| `/faq` | FAQ accordion |
| `/team` | Team page |

---

## Real Content

**Projects (in `data/projects.json` → `projects1` array only):**
1. Decoraciones Pilar — Wedding planning (decorpilar.com)
2. Tapia Tile & Marble Co. — Tile installation (tapiatilemarbleco.com)
3. Elite Vac Service — Industrial vacuum / roofing (elitevacservice.com)
4. Homely — Real estate (template showcase)
5. Mednix — Healthcare (template showcase)
6. Fireside Realty — Realtor personal branding

**Blog Posts (in `data/blogs.json`):**
1. "Why Most Small Business Websites Don't Convert (And How to Fix It)"
2. "What Makes a Website Feel Premium in 2026 (Without a Big Budget)"
3. "Do Small Businesses Really Need SEO in 2026?"

**Pricing Tiers:**
- Starter: $1,257
- Growth: $2,497
- Ascend Pro: $3,127

---

## Known Issues / Technical Debt

1. **Footer attribution link** — Footer still links to `https://themeforest.net/user/ib-themes/portfolio` (original theme author). Should be updated.

2. **`not-found.tsx` broken link** — The "Return to Ascend Home" button links to `/index-main`, which is not a valid route. Will trigger another 404.

3. **`data/menu.json` is vestigial** — `MobileMenu.tsx` hardcodes its nav links and does not read from `menu.json`. The file contains demo routes from the original theme that don't exist.

4. **`data/projects.json` has unused arrays** — Only `projects1` is used. Arrays `projects2` through `projects10` contain placeholder/template data and are dead weight.

5. **`project-details/[slug]/page.tsx` is `"use client"`** — Uses `useParams()` instead of props, so `generateStaticParams` cannot be used. Pages are always dynamic, never statically pre-built.

6. **Typo in blog author data** — `"Web Strategst"` should be `"Web Strategist"` in `data/blogs.json` (all 3 blog entries).

7. **Sergio's LinkedIn placeholder** — `data/team.json` has `"https://www.linkedin.com/"` as his LinkedIn URL — not his actual profile.

8. **`(other-pages)/404/page.tsx`** is unreachable via normal Next.js 404 handling — `not-found.tsx` at root is what Next.js uses. The `/404` route only works if navigated to directly.

9. **`blog-standard` route** — Exists and is linked from footer as "Insights" but renders a different component than `/blog`. Potentially confusing.

10. **`TechStack` is commented out** on the homepage — likely a planned section left disabled.

11. **`public/lotties-services/` is empty** — Lottie JSON files are co-located in `components/homes/home-web-agency/lottie/` instead.

12. **`useGsapScrollScaleAnimations` cleanup** — Uses class-based filtering to kill ScrollTrigger instances, which is less reliable than storing trigger refs directly.

---

## Styling Rules

- Do **not** add Tailwind classes — this project does not use Tailwind.
- Custom styles go in `public/css/styles.css`.
- The pre-compiled `main.min.css` and `plugins.min.css` should not be modified directly.
- Theme CSS class names come from the Rayo theme (e.g., `.anim-uni-in-up`, `.animate-card-3`, `.butn`, `.sub-title`, etc.).

---

## Data / Content Updates

- All content is in `/data/*.json`. Editing JSON is the only way to update page content.
- `data/blogs.json` has two parallel structures: `blogs` (full article data for detail pages) and `blogs1`–`blogs6` (card/preview data). Keep slugs in sync manually between `blogs[].slug` and the preview arrays.
- Only `data/projects.json → projects1` is actively used on the site.
