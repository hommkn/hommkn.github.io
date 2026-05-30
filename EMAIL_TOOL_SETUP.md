# BeadSnap Email Capture Setup

The site is wired for Buttondown because it works well with static HTML.

The Buttondown username currently configured is:

```text
beadsnap
```

Files currently using the Buttondown form endpoint:

- `index.html`
- `blog.html`
- `about.html`
- `free-patterns.html`
- `blog/photo-to-perler-bead-pattern.html`

## How the email → PDF loop works

1. User enters email and clicks "Send me the free patterns"
2. Form submits to Buttondown via hidden iframe (no popup)
3. A thank-you message appears immediately
4. The PDF download starts automatically
5. The user also receives a welcome email via Buttondown (if automation is configured)

GA4 events already sent by the site:

- `click_free_patterns`
- `subscribe_free_patterns`
- `subscribe_pro_pattern`
- `download_free_patterns`
- `upload_photo`
- `generate_pattern`
- `download_png`
- `download_pdf`
- `copy_shopping_list`

In GA4, mark `subscribe_free_patterns` as a key event first. If you want a lighter funnel, also mark `click_free_patterns` and `download_free_patterns`.

## Buttondown setup (things you need to do)

1. Log into https://buttondown.com with the `beadsnap` account
2. Set up a **Welcome automation email** that sends automatically when someone subscribes
3. In the welcome email, include a link to the PDF: `https://beadsnap.app/downloads/10-free-beginner-bead-patterns.pdf`
4. This ensures subscribers get the PDF via email even if the instant download fails
