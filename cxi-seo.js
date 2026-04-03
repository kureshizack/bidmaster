/**
 * CaptainXI SEO Module — cxi-seo.js
 * ───────────────────────────────────
 * Auto-injects JSON-LD structured data based on current page.
 * Include on ALL pages: <script src="cxi-seo.js"></script>
 * Place AFTER </body> or at end of <head>.
 */

(function() {
    const page = location.pathname.split('/').pop() || 'index.html';
    const BASE = 'https://captainxi.com';
    const LOGO = BASE + '/assets/logo-512.png'; // Update path if different

    // ─── Organization schema (every page) ───
    const orgSchema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "CaptainXI",
        "url": BASE,
        "logo": LOGO,
        "description": "India's #1 Cricket Tournament Management Platform — Live Auctions, Ball-by-Ball Scoring, Standings & More",
        "sameAs": [],
        "contactPoint": {
            "@type": "ContactPoint",
            "email": "captain@captainxi.com",
            "contactType": "customer support",
            "availableLanguage": ["English", "Hindi"]
        },
        "foundingDate": "2026",
        "founder": {
            "@type": "Person",
            "name": "Zakwan"
        }
    };

    // ─── SoftwareApplication schema (index + upgrade) ───
    const appSchema = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "CaptainXI",
        "operatingSystem": "Web, Android (PWA)",
        "applicationCategory": "SportsApplication",
        "description": "Manage cricket tournaments with IPL-style auctions, live ball-by-ball scoring, real-time scorecards, points tables, NRR, Orange & Purple Cap tracking, certificates, and Razorpay payment collection.",
        "url": BASE,
        "offers": [
            {
                "@type": "Offer",
                "name": "Gully (Free)",
                "price": "0",
                "priceCurrency": "INR",
                "description": "6 teams, 50 players, 1 event"
            },
            {
                "@type": "Offer",
                "name": "Match Day",
                "price": "199",
                "priceCurrency": "INR",
                "description": "8 teams, 80 players, per event"
            },
            {
                "@type": "Offer",
                "name": "Club",
                "price": "799",
                "priceCurrency": "INR",
                "description": "10 teams, 120 players, 5 events/year"
            },
            {
                "@type": "Offer",
                "name": "Pro",
                "price": "1499",
                "priceCurrency": "INR",
                "description": "16 teams, 200 players, unlimited events"
            }
        ],
        "featureList": [
            "IPL-Style Live Player Auctions",
            "Ball-by-Ball Live Scoring",
            "Real-Time Scorecard with Charts",
            "Tournament Management (4 Formats)",
            "Points Table with NRR",
            "Orange Cap & Purple Cap Tracking",
            "Razorpay Payment Collection",
            "Player Registration",
            "AI Player of the Match",
            "Certificate Generation",
            "Sponsor Branding",
            "WhatsApp Sharing with OG Preview",
            "36 SVG Team Logos"
        ]
    };

    // ─── FAQ schema (help page) ───
    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "How do I create a cricket tournament on CaptainXI?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Sign up for free, go to Dashboard, click '+ New Tournament', and follow the 5-step wizard: Details, Teams, Players, Schedule, Go Live. You can create your first tournament on the free Gully plan."
                }
            },
            {
                "@type": "Question",
                "name": "Does CaptainXI support IPL-style player auctions?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes! CaptainXI is one of the only platforms that integrates live IPL-style player auctions with tournament management. Create an auction, invite bidders, run live bidding, and players auto-import into your tournament."
                }
            },
            {
                "@type": "Question",
                "name": "Can I collect player registration fees online?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes. CaptainXI integrates with Razorpay for UPI and card payments. Set a registration fee when creating your tournament, and players pay directly during registration. No manual tracking needed."
                }
            },
            {
                "@type": "Question",
                "name": "Is CaptainXI free to use?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes! The Gully plan is completely free and supports up to 6 teams and 50 players. Paid plans start at ₹199/event for larger tournaments."
                }
            },
            {
                "@type": "Question",
                "name": "Does CaptainXI work on mobile?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "CaptainXI is a Progressive Web App (PWA) optimized for mobile. You can install it on your phone's home screen from any browser — it works like a native app."
                }
            }
        ]
    };

    // ─── SportsEvent schema (for scorecard/standings with dynamic data) ───
    function getSportsEventSchema() {
        // Read from og:tags if available
        const title = document.querySelector('meta[property="og:title"]')?.content;
        const desc = document.querySelector('meta[property="og:description"]')?.content;
        if (!title) return null;

        return {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            "name": title,
            "description": desc || title,
            "sport": "Cricket",
            "url": location.href
        };
    }

    // ─── Inject schemas based on page ───
    function injectSchema(data) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(data);
        document.head.appendChild(script);
    }

    // Always inject org schema
    injectSchema(orgSchema);

    // Page-specific schemas
    const pageSchemas = {
        'index.html': [appSchema],
        '': [appSchema], // root URL
        'upgrade.html': [appSchema],
        'help.html': [faqSchema],
        'scorecard.html': [getSportsEventSchema()].filter(Boolean),
        'standings.html': [getSportsEventSchema()].filter(Boolean)
    };

    const schemas = pageSchemas[page] || [];
    schemas.forEach(s => { if (s) injectSchema(s); });

    // ─── Inject canonical URL ───
    if (!document.querySelector('link[rel="canonical"]')) {
        const canonical = document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = BASE + '/' + (page === '' ? '' : page);
        document.head.appendChild(canonical);
    }

    // ─── Ensure essential meta tags exist ───
    function ensureMeta(name, content, isProperty) {
        const attr = isProperty ? 'property' : 'name';
        if (!document.querySelector(`meta[${attr}="${name}"]`)) {
            const meta = document.createElement('meta');
            meta.setAttribute(attr, name);
            meta.content = content;
            document.head.appendChild(meta);
        }
    }

    // Default meta tags (page-specific ones should be hardcoded in HTML for best SEO)
    const defaultDesc = 'CaptainXI — India\'s #1 Cricket Tournament Management Platform. IPL-style auctions, ball-by-ball scoring, live scorecards, standings, and payment collection.';
    const defaultTitle = 'CaptainXI — My Game. My Rules.';

    ensureMeta('description', defaultDesc);
    ensureMeta('theme-color', '#F5A623');
    ensureMeta('og:site_name', 'CaptainXI', true);
    ensureMeta('og:type', 'website', true);
    ensureMeta('og:locale', 'en_IN', true);
    ensureMeta('twitter:card', 'summary_large_image');
    ensureMeta('twitter:title', document.title || defaultTitle);
    ensureMeta('twitter:description', defaultDesc);
    ensureMeta('mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-capable', 'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');

    console.log('[CXI-SEO] Structured data injected for', page);
})();
