# mintro

A small project containing:

- `supabase/` — Supabase Edge Functions (Deno) used by the backend. Functions are kept in `supabase/functions/*`.
- `testFrontend/mintro-dashboard` — A Next.js dashboard app (separate nested repo/worktree). The nested frontend is intentionally kept as a separate repository and is ignored by the root repo.

Notes
- The root `.gitignore` intentionally **ignores** `testFrontend/` because `testFrontend/mintro-dashboard` is a separate Next.js project (its own git repo).
- To run the dashboard locally, open the `testFrontend/mintro-dashboard` folder and run the standard Next.js commands:

  ```bash
  cd testFrontend/mintro-dashboard
  npm install
  npm run dev
  ```

- Supabase functions are Deno-based. To test them locally, use the Supabase CLI or Deno run as appropriate for each function.

Contributing
- This is an early repo; please open issues or PRs against the appropriate component (root vs dashboard) depending on scope.

License
- (Add a license file if you want this repo to include one.)
