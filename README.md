# Junior full-stack technical test

A 30-minute online assessment with a server-side timer, a progressive problem and a private back office. It runs for free on GitHub Pages (website) and Supabase (database and login). No domain name or hosting space is needed.

| File | Purpose |
|---|---|
| `index.html`, `candidate.js` | The page candidates open from their invitation link |
| `admin.html`, `admin.js` | Your back office: invite candidates, see and score results |
| `style.css` | Shared design |
| `config.js` | Your Supabase address and public key (the only file you edit) |
| `supabase/01_schema.sql` | Database tables, security rules, timer and grading |
| `supabase/02_questions.sql` | The question bank |

## What candidates take

One link per candidate. They pick their language (or you assign it): JavaScript/Node, Java/Spring, C#/.NET, PHP/Laravel or Python/Django.

| Part | Content | Points |
|---|---|---|
| Quiz | 8 fundamentals questions (HTTP, REST, SQL, Git, security) and 2 on their language | 10, auto-graded |
| Stage 1: Data | MiniEvent booking platform: pick the right counting query, then write a query for full events | 5 |
| Stage 2: Business rules | Choose the right HTTP status, then write `canBook()` in their language | 6 |
| Stage 3: Concurrency bug | Read the booking endpoint in their language, spot the overbooking, propose a fix | 7 |
| Stage 4: Security | Spot SQL injection and IDOR in their language, then rewrite the endpoint securely | 7 |

Each stage unlocks only after the previous one is submitted, and candidates cannot go back. 18 points are graded automatically; you score the 4 written answers (17 points) in the back office with the scoring guide shown under each answer.

The test is deliberately longer than 30 minutes for a junior. How far a candidate gets, and how they get there, is part of the signal. As a starting point, which you should adjust after your first candidates: reaching Stage 3 with about 50% or more is a good junior profile; reaching Stage 4 with a sensible security fix is strong.

## Setup (about 30–45 minutes, once)

### 1. Create the database (Supabase)
1. Create a free account at supabase.com and a **New project**. Choose a European region (Frankfurt or Paris) for lower latency from Morocco. Save the database password somewhere safe.
2. Open **SQL Editor**, paste the whole content of `supabase/01_schema.sql`, and click **Run**.
3. Do the same with `supabase/02_questions.sql`.

### 2. Create your back-office account
1. **Authentication > Sign In / Providers**: turn **off** "Allow new users to sign up", so nobody else can create an account.
2. **Authentication > Users > Add user > Create new user**: enter your email and a strong password, and tick **Auto Confirm User**.
3. In **SQL Editor**, run this with your email:
   ```sql
   insert into public.admins (email) values ('you@yourcompany.com');
   ```
   Repeat for each colleague who should see results (create their user first).

### 3. Connect the website to the database
1. **Project Settings > API** (or **API Keys**): copy the **Project URL** and the **anon** / **publishable** key.
2. Paste them into `config.js`, and set `COMPANY_NAME`.
3. Never put the **service_role** / **secret** key in any file.

### 4. Publish on GitHub Pages
1. Create a free account at github.com, then **New repository**, for example `tech-test`. On the free plan it must be **Public**: that is fine, because answer keys and rubrics stay in the database and are never sent to candidates.
2. **Add file > Upload files**: drag in `index.html`, `admin.html`, `candidate.js`, `admin.js`, `style.css` and `config.js`. You do not need to upload the `supabase` folder (keep it on your computer so the answer keys are not public).
3. **Settings > Pages**: under "Build and deployment", choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and **Save**.
4. After a minute your site is live at `https://YOUR-USERNAME.github.io/tech-test/`.
   - Back office: `https://YOUR-USERNAME.github.io/tech-test/admin.html`
   - Candidates never get this address: they receive a personal link created in the back office.

### 5. Test it yourself before sending it
Open `admin.html`, create a link for yourself, take the test in a private window, then check your results in the back office. Use **Reset attempt** to clear your test run, or **Delete candidate**.

## Daily use
1. In the back office, enter the candidate's name, optional email, language (or let them choose) and duration, then **Create link**.
2. Copy the link or use **Open an email to the candidate**.
3. Results appear live. Click a candidate to see each answer, the time spent per stage, and integrity signals, and to score the written answers.
4. **Export CSV** gives a spreadsheet of all candidates.

## How it stays fair and secure
- The timer runs on the server. Closing the page does not pause it, and answers sent after the deadline (plus 15 seconds of grace) are refused.
- Questions are only sent when the candidate reaches their stage, without the correct answers. Choice questions are graded in the database.
- Each link works for one candidate and one attempt. Question and option order are shuffled per candidate.
- Leaving the tab, losing window focus, copying and pasting are recorded. Treat them as signals to discuss in the interview, not as proof of cheating.
- Anonymous visitors cannot read any table. Only signed-in emails listed in `admins` can see results.
- Candidates' personal data is stored in your Supabase project. Tell candidates how it is used and how long you keep it, and check your obligations under Moroccan law 09-08 with the CNDP.

## Changing the questions
Edit `supabase/02_questions.sql` and run it again in the SQL Editor (existing candidates and answers are kept), or edit rows directly in **Table Editor > questions**. A choice question needs `options` (a JSON list of strings) and `correct` (the 0-based index of the right option). A code question needs a `rubric`. Use `track = 'core'` for everyone, or a language code for language-specific questions.
