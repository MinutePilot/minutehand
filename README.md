# MinuteHand

Turn messy meeting notes into polished, properly formatted minutes.

## Setup

**1. Configure Supabase credentials**

```
copy config.example.js config.js
```

Edit `config.js` with your project URL and anon key from the [Supabase dashboard](https://supabase.com/dashboard) → Project Settings → API.

**2. Set your Anthropic API key in Supabase**

Dashboard → your project → Edge Functions → Secrets → add `ANTHROPIC_API_KEY`.

**3. Deploy the Edge Function**

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```
supabase functions deploy generate-minutes --project-ref YOUR_PROJECT_REF
```

**4. Open the app**

Open `index.html` in a browser, or serve locally with `npx serve .`.

For production, enable GitHub Pages: Settings → Pages → source: `main` branch, root `/`.

## How it works

1. Select a meeting type (Strata Council, HOA, Nonprofit Board, or Team)
2. Paste your raw notes or transcript
3. Click **Generate Minutes**
4. Review the formatted preview, then download as `.docx`

## Meeting types

| Type | Terminology | Motion format |
|------|-------------|---------------|
| Strata Council (BC) | Council / President / Motions | MOVED by X, SECONDED by Y — CARRIED/DEFEATED |
| HOA Board | Board / President / Motions | Same |
| Nonprofit Board | Board / Chair / Resolutions | RESOLVED that… |
| Team / Informal | Team / Facilitator / Decisions | None |

## Project structure

```
├── index.html                              # single-page UI
├── style.css
├── app.js                                  # form logic + .docx export
├── config.example.js                       # copy to config.js
└── supabase/
    └── functions/generate-minutes/
        └── index.ts                        # Edge Function → Claude API
```

## Build roadmap

- [x] Step 1 — Text/paste input pipeline
- [ ] Step 2 — .docx file upload (mammoth.js)
- [ ] Step 3 — Audio upload, transcription, speaker confirmation UI
- [ ] Step 4 — Stripe credit packs
