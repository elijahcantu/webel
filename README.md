# Webel - Web Browsing Event Logger

Documentation site for Webel, a Chrome extension that logs web browsing events and organizes them into structured traces for process mining analysis.

This site is built with [Fumadocs](https://fumadocs.dev), a modern documentation framework.

## Development

Run the development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Building for Production

Build the static site:

```bash
npm run build
```

The static files will be exported to the `out/` directory.

## Project Structure

- `content/docs/`: MDX documentation files
- `src/app/docs/`: Documentation layout and pages
- `src/app/api/search/route.ts`: Search API endpoint (statically generated)
- `public/`: Static assets including PDF files

## Deployment

The site is automatically deployed to GitHub Pages via GitHub Actions when pushing to the main branch.

## Learn More

- [Webel Extension Repository](https://github.com/elijahcantu/webel)
- [Fumadocs Documentation](https://fumadocs.dev)
- [Next.js Documentation](https://nextjs.org/docs)
