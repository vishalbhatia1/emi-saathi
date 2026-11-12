# Hand-holding guide: build the POC step by step

Work through the milestones in order. Each has **Do this** → **You should see** → **If it fails**.
Tick them off as you go.

---

## Milestone 1: put it in its own GitHub repo (15 min)

Your earlier demo (`order-helpline-voice-ai`) stays exactly as it is; this is a separate repo and folder.

**Do this**
1. On github.com, go to **+ → New repository**, name it `emi-saathi`, leave "Add a README" unticked, then **Create repository**.
2. Extract `emi-saathi-standalone.zip`, then copy the project to a folder OneDrive doesn't sync:
   ```powershell
   New-Item -ItemType Directory -Force "C:\Users\vishal.e.bhatia\projects" | Out-Null
   robocopy "$env:USERPROFILE\Downloads\emi-saathi-standalone\emi-saathi" "C:\Users\vishal.e.bhatia\projects\emi-saathi" /E
   ```
3. In VS Code use **File → New Window → Open Folder** and choose `C:\Users\vishal.e.bhatia\projects\emi-saathi`. Then, in the terminal:
   ```powershell
   git init -b main
   git config user.name "vishalbhatia1"
   git config user.email "vishal.bhatia789@gmail.com"
   git add .
   git commit -m "EMI Saathi POC"
   git remote add origin https://vishalbhatia1@github.com/vishalbhatia1/emi-saathi.git
   git push -u origin main
   ```

**You should see:** `main -> main` in the terminal; on GitHub, the files plus a green tick in **Actions** ("EMI Saathi tests").
**If it fails:**
- `denied to VishalB-pro`: the username in the URL fixes this. Check you copied the `remote add` line exactly.
- `git init -b` not supported: run `git init` then `git branch -M main`.

## Milestone 2: run it and understand every part (30 min)

**Do this**
```powershell
npm start          # run inside C:\\Users\\vishal.e.bhatia\\projects\\emi-saathi (or npm.cmd start)
```
Open **http://localhost:3100**. Then, in order:
1. **Run campaign.** Watch the plan: each row ends with a result (Paid ✓, Promise 14 Nov, Dispute open…). Read the *Decision* column: every skip or hand-over has a reason.
2. **Real-life call 5 (hardship).** Read the Hindi lines and the English translation below each. Watch the *Agent desk* card appear.
3. **Real-life call 6 (wife answers).** Notice the compliance line *"Third party on the line: no loan details shared"*.
4. Move the **Clock** to 7:30 pm. Every borrower becomes *Skip: outside the calling window*.
5. Set the clock back to 11:00, click **Reset day**, then **Call** next to Ramesh Kumar and type:
   `हाँ बोल रहा हूँ` → `4321` → `link bhej do`, then click **Pay with UPI** in the WhatsApp panel → type `ho gaya`.
6. Press 🎤 and **speak Hindi** (Chrome or Edge). Tick **Speak replies** to hear Saathi.

**You should see:** "Call result: PAID", a receipt on WhatsApp, and the numbers updating.
**If it fails:**
- `EADDRINUSE`: something is already using port 3100. Close the old terminal, or run `$env:PORT=3101; npm start`.
- Mic error: use Edge or Chrome, and open the page through `http://localhost:3100`, not by double-clicking the file.

## Milestone 3: make it yours (45 min). This is where you really learn

Do each exercise, save, refresh the browser, then run `npm test`.

**3a. Add a borrower.** In `src/data.js`, add to `BORROWERS`:
```js
{ id: 'B14', name: 'Kavita Nair', nameHi: 'कविता नायर', city: 'Kochi', lang: 'en', product: 'Personal loan', emi: 4100, dueOffsetDays: -3, acctLast4: '2580', salaryDay: 1, phone: '+91 98470 25801', prefers: 'any' },
```
✅ She appears in the plan as *Call now · dpd-1-30*. Call her and verify with `2580`.

**3b. Teach it a new Hinglish phrase.** In `src/nlu.js`, find `['pay_now', [` and add `'abhi kar raha hoon'` to the list.
✅ Saying "abhi kar raha hoon" after the dues now sends the UPI link.

**3c. Change a policy.** In `src/data.js` set `maxPtpDaysOverdue: 5`.
✅ "agle hafte" (next week) is now beyond policy, and Saathi offers the maximum date or a specialist.

**3d. Edit what Saathi says.** In `src/agent.js` change the `hardship` template (Hindi and English).
✅ Play call 5 to hear your version. Then try adding the word "police" to a template: the **auditor blocks it** and the test `auditor blocks coercive wording` still passes.

**3e. Write your own scenario.** In `src/scenarios.js` copy one entry, change `borrowerId`, `steps` and `expect`.
✅ `npm test` now runs your scenario too.

## Milestone 4: switch on LLM understanding (optional, 20 min)

This makes understanding more flexible: Claude classifies the borrower's words. It **never** writes what the borrower hears, so every sentence stays pre-approved.

**Do this:**
1. Get an API key from console.anthropic.com. Use fictional data only, and check your company's policy on external AI APIs.
2. In PowerShell:
   ```powershell
   $env:ANTHROPIC_API_KEY = "sk-ant-..."     # only for this terminal session
   $env:ANTHROPIC_MODEL   = "claude-haiku-5-5"
   npm start
   ```
3. In the simulator, tick **LLM understanding** (the pill shows the model name).
4. Try something unusual: *"bhai abhi thoda tight hai, Diwali bonus aate hi bhar dunga"*.

**You should see:** an event "LLM understanding (LLM)" in *What's happening*. If the API fails, it says "LLM unavailable, using built-in rules" and the call carries on.

## Milestone 5: talk to the Conversation API (20 min)

This is how a real phone channel plugs into the agent. While `npm start` is running, open a second terminal:
```powershell
$s = Invoke-RestMethod -Method Post -Uri http://localhost:3100/api/sessions -ContentType 'application/json' -Body '{"borrowerId":"B02"}'
$s.says
Invoke-RestMethod -Method Post -Uri "http://localhost:3100/api/sessions/$($s.id)/turn" -ContentType 'application/json' -Body '{"text":"Yes, speaking"}' | Select-Object -ExpandProperty says
Invoke-RestMethod -Method Post -Uri "http://localhost:3100/api/sessions/$($s.id)/turn" -ContentType 'application/json' -Body '{"text":"7788"}' | Select-Object -ExpandProperty says
Invoke-RestMethod -Uri http://localhost:3100/api/plan | Format-Table
```
**You should see:** Saathi's replies as text. A voice gateway does exactly this, then speaks the text.

## Milestone 6: a real phone call (with your team: 1–3 days)

See **[05-go-real.md](05-go-real.md)**. Start with Option A (Amazon Connect + Lex + `lambda/`) using a test number, then plan Option B for India production (Genesys outbound + Indian TSP + Nova 2 Sonic Hindi).

## Milestone 7: present it (1 hour of prep)

Use **[04-demo-script.md](04-demo-script.md)**. Fill the business-case card with real numbers from your client or team.
