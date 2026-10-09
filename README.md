# Full-stack technical assessment (version 2)

An online assessment with a server-side timer, 7 progressive stages and a private back office. Each candidate gets their own random mix of questions across JavaScript/TypeScript, Java, C#, PHP and Python, and the back office shows which language each candidate is strongest in.

It runs for free on GitHub Pages (website) and Supabase (database and login).

| File | Purpose |
|---|---|
| `index.html`, `candidate.js` | The page candidates open from their test link |
| `admin.html`, `admin.js` | Back office: invite, follow, score, decide, settings |
| `style.css` | Shared design |
| `config.js` | Your Supabase address and key (keep your existing one) |
| `supabase/01_schema.sql` | Tables, security rules, random draw, timer, grading, statistics |
| `supabase/02_questions.sql` | Stages and the question bank (95 questions) |

## Upgrading from version 1

1. In Supabase > **SQL Editor**, run `supabase/01_schema.sql`, then `supabase/02_questions.sql`.
   This rebuilds the tables, so **existing candidates and answers are deleted**. Your admin account is kept.
2. On GitHub, replace `index.html`, `admin.html`, `candidate.js`, `admin.js` and `style.css`.
   **Do not replace `config.js`**: yours already contains your Supabase URL and key.
3. Wait a minute, open the back office with Ctrl + F5, create a link for yourself and take the test once.

## What candidates take

No language to choose. Questions are drawn at random when the candidate presses Start, from the technologies you tick at invitation (all five by default), and balanced so each language appears.

| Stage | Content | Default draw |
|---|---|---|
| 1. Web and tools | HTTP, REST, cookies, CORS, Git | 4 multiple-choice, 1 pt each |
| 2. Databases and SQL | Joins, grouping, indexes, NULL, transactions | 4 multiple-choice, 1 pt |
| 3. Code reading | Predict the output; one snippet per language | 5 multiple-choice, 1 pt |
| 4. Frameworks | React, Angular, Vue, Express, Spring, ASP.NET Core, EF Core, Laravel, Django | 5 multiple-choice, 1 pt |
| 5. Debugging | Real bugs in different languages, then fix an overbooking race condition | 4 multiple-choice (2 pts) + 1 written (5 pts) |
| 6. Security | XSS, IDOR, JWT, uploads, CSRF..., then secure an endpoint | 4 multiple-choice (2 pts) + 1 written (5 pts) |
| 7. Problem solving | One function to write, in the language of their choice | 1 written (6 pts) |

29 questions and 50 points in 30 minutes: the test is deliberately long, so how far a candidate gets is part of the result. Change the counts in **Test settings** in the back office.

Candidate interface: one question at a time, stage list and question map on the side, code editor with syntax highlighting, keyboard shortcuts (1–4 to answer, Enter for next), timer warnings at 5 and 1 minute, and an "End test" button.

## Results

- **Candidates list**: score, best language, furthest stage, time used, integrity signals, answers to score, your decision. Filter by status, search, export to CSV (includes a score per language).
- **Candidate page**: score by technology (Web and tools, SQL, JavaScript/TS, Java, C#, PHP, Python), with the strongest and weakest language; score and time per stage; every answer next to the expected one; scoring guide and score box for written answers; decision (Shortlisted, Interview, On hold, Rejected, Hired) and team notes.
- Language scores only count the stages the candidate reached. With 1 or 2 questions per language, treat them as a signal to confirm in the interview, not a verdict.

## First-time setup (if starting from scratch)

1. Create a free Supabase project. In **SQL Editor**, run `01_schema.sql`, then `02_questions.sql`.
2. **Authentication > Sign In / Providers**: keep the Email provider on, turn off "Allow new users to sign up".
3. **Authentication > Users > Add user**: your email and password, tick Auto Confirm User. Then in SQL Editor:
   `insert into public.admins (email) values ('you@example.com');`
4. Put your Project URL (for example `https://abcd.supabase.co`, nothing after `.co`) and your publishable key in `config.js`.
5. Upload the 6 website files to a public GitHub repository (not the `supabase` folder, which contains the answers). In **Settings > Pages**, deploy from branch `main`, folder `/ (root)`.
6. Back office: `https://your-username.github.io/your-repo/admin.html`.

## Security and fairness

- The timer, stage unlocking and grading run in the database. Candidates never receive correct answers or scoring guides, and cannot reopen a submitted stage.
- Each link works for one candidate and one attempt. Questions and answer order differ per candidate.
- Tab switches, focus loss, copy and paste are recorded as signals, not proof.
- Only signed-in emails listed in `admins` can read results.
- Candidate data is stored in your Supabase project: tell candidates how it is used and how long it is kept (Moroccan law 09-08, CNDP).

## Editing questions

Edit `supabase/02_questions.sql` and run it again (candidates are kept), or edit rows in **Table Editor > questions**:
`stage` (1–7), `lang` (`general`, `sql`, `js`, `java`, `csharp`, `php`, `python`, or `any` for "candidate chooses"), `kind` (`choice` or `code`), `options` (JSON list) with `correct` (0-based index) for choice questions, `rubric` for written ones, and `active` to switch a question off.
