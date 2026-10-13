# ClassRoomAI

**Self-hosted AI learning spaces that teachers control.**

Teachers set the instructions, add supporting materials, and launch an activity. Students join with a classroom code. Teachers can follow conversations, review saved work, and inspect advisory AI feedback.

ClassRoomAI runs on your computer with Bun, SQLite, and a browser interface. You choose the AI provider and supply its credentials. A local model is optional.

This is an original implementation inspired by the Spaces workflow in [SchoolAI](https://schoolai.com/). It is not SchoolAI software or a certified SchoolAI integration. It does not include SchoolAI branding, hosted lessons, or proprietary safety systems.

## Contents

- [What it includes](#what-it-includes)
- [Quick start](#quick-start)
- [Your first classroom activity](#your-first-classroom-activity)
- [Students: join, leave, and return](#students-join-leave-and-return)
- [Teacher monitoring and AI judgments](#teacher-monitoring-and-ai-judgments)
- [AI providers and credentials](#ai-providers-and-credentials)
- [Classroom network hosting](#classroom-network-hosting)
- [Accounts and passwords](#accounts-and-passwords)
- [Files and classroom tools](#files-and-classroom-tools)
- [Data, backups, and updates](#data-backups-and-updates)
- [Configuration](#configuration)
- [Checks and development](#checks-and-development)
- [Troubleshooting](#troubleshooting)
- [Limits and privacy](#limits-and-privacy)

## What it includes

| Area | Available functions |
| --- | --- |
| Space design | Teacher instructions, supporting materials, audience, interaction style, outcomes, ordered agenda, subject, grade, descriptions, cover, and tools |
| AI design help | Draft a Space, outcomes, or descriptions. Review suggestions before applying and saving them |
| Teacher library | Search, folders, private or locally shared templates, remix, and JSON template import/export |
| Preview | Try the saved instructions with a real model without creating a student record or launching a class |
| Classroom sessions | Separate launch snapshots, session instructions, join codes, links, QR codes, expiry, and per-student turn limits |
| Student conversation | Chat, attachments, saved work, message feedback, draft recovery, and username-based return |
| Teacher observation | Transcripts, saved work, teacher messages, collaborators, pause/resume, and JSON/CSV exports |
| Advisory AI feedback | Evidence-based task progress, learning insights, suggested support groups, and cited safeguarding alerts |
| Classroom tools | Documents, drawings, mind maps, flashcards, presentations, graphs, YouTube activities, and provider-backed image generation |
| Access preferences | Reading and display preferences, optional response-language choice, copy, read-aloud, and browser-dependent dictation |

The default design emphasizes MYP/DP English A rather than language acquisition. Teachers can adapt Spaces to other subjects.

## Quick start

### What you need

- [Bun](https://bun.sh/) installed on the host computer.
- A modern browser. Chrome has been used for desktop and mobile-width verification.
- An AI API account with usable credits, or a separately running local model server.
- A reachable network connection between the host and student devices for classroom use.

The application has been checked on macOS with Bun 1.3.14. Linux and Windows hosting have not been verified end to end.

You do not need Python, PostgreSQL, or a local AI model. Node.js alone cannot replace Bun for this server.

### Install and start

1. Clone the repository, or download and extract its ZIP file.
2. Open a terminal in the project directory.
3. Install the dependencies.

```sh
git clone https://github.com/GowangInc/ClassRoomAI.git
cd ClassRoomAI
bun install
```

If you downloaded a ZIP, skip the clone command. Private repositories require GitHub access.

4. Start the server.

```sh
bun run start
```

5. Open **http://127.0.0.1:9272** on the host computer.
6. Create the first administrator account.
7. Open **Providers** and configure a usable AI connection.

First-run account creation only accepts a direct loopback connection. Complete it on the host before enabling LAN or proxy access.

There is no default administrator account or password. The account email is a sign-in identifier. The app does not send invitation or password-reset emails.

Keep the terminal running while using the app. Press **Ctrl+C** to stop the server. Closing a browser does not stop it or end a classroom session.

**Before classroom use:** review the [username access limitations](#students-join-leave-and-return), [password defaults](#accounts-and-passwords), and [data policy](#limits-and-privacy).

## Your first classroom activity

### Understand the two saved objects

- **Space:** a reusable teaching template.
- **Session:** a launched classroom activity with its own code, participants, and saved conversation history.

Launching captures the Space content in a session snapshot. Later template edits do not change that snapshot. Session-specific instructions can refine one launch.

### Create, preview, and launch

1. Open **My Spaces** and choose **Create a Space**.
2. Choose **Student learning**, **Teacher productivity**, or **Staff operations**.
3. Select a configured model provider.
4. Add the title, student welcome description, and teacher instructions.
5. Add authorized supporting materials and any curriculum reference text.
6. Set learning outcomes and an ordered agenda.
7. Enable only the classroom tools the activity needs.
8. Save the Space.
9. Use the student preview to test it.
10. Launch a classroom session when the activity is ready.
11. Share its code, join link, or QR code with students.

The editor groups settings under **Details, Prompt, Context, Outcomes, Agenda, Audience, Tools & media, and Publishing**.

AI design suggestions remain separate from the saved template. Review the draft, apply it to the form, and save explicitly. Neither applying a draft nor previewing launches a session.

### Example: a close-reading Space

| Field | Example |
| --- | --- |
| Title | How one word changes a scene |
| Subject | English A |
| Student welcome | Choose a phrase from the supplied extract. Explain how it changes the reader's impression |
| Outcome | Explain an authorial choice with precise textual evidence |
| Agenda | Select a phrase, explain its effect, consider another reading, then revise the explanation |
| Tool | Document |

Example teacher instructions:

> Respond in English. Ask one focused question at a time. Help the student connect a precise quotation to an authorial choice and its effect. Ask for evidence when a claim is vague. Do not invent quotations or write the assessed response for the student. Allow a brief playful aside, then return to the task.

Add your own authorized extract and task guidance. No copyrighted curriculum texts are bundled with the app.

Students cannot choose a response language unless the teacher enables that option for the Space. The default is off. Reading preferences do not change the teaching language.

## Students: join, leave, and return

1. Open the student join link, or choose **Join as student**.
2. Enter the eight-character classroom code.
3. Enter a username, or select **Returning student** after the code is validated.
4. Choose **Join Space**.

Students do not need teacher accounts or AI provider accounts. The teacher's selected connection pays for provider usage.

The student screen keeps the conversation and composer visible. **Learning plan**, **Classroom tools**, and **Accessibility** open additional controls when needed.

To leave, open **Learning plan** and choose **Leave Space**. Returning with the same code and username resumes the existing conversation and saved work.

**This is convenient return access, not verified student identity.** Anyone with the code can see the returning-name list and resume a listed participant. They could read that participant's work or act under that name.

Use this design only where that risk is acceptable. Do not describe it as secure student authentication or account recovery.

New students need an active session. Existing participants can revisit saved work after pause or closure. A paused or ended session does not allow new conversation turns.

## Teacher monitoring and AI judgments

Open a session from **Student insights** to review its participants.

You can:

- Read a participant's conversation and saved work.
- Send a clearly labeled teacher message.
- Pause or resume one learner, or the classroom.
- End the classroom session.
- Add a teaching collaborator.
- Generate advisory individual or group insights.
- Export session data as JSON or CSV.

Pausing is reversible. Ending is final. Ending does not erase saved conversations or work.

### Task progress

The app requests an assessment after conversation or saved-work changes. It compares that work with the launched activity, not a student's self-reported percentage.

The assessment criteria come from agenda steps, then outcomes if no agenda exists. Otherwise, the app uses the activity instructions as one criterion.

The model selects a status and cites evidence for each criterion. The server calculates the percentage with equal criterion weights.

| Criterion status | Contribution |
| --- | --- |
| Not started | 0 |
| Partial | 0.5 |
| Complete | 1 |

Assistant replies, teacher statements, message counts, and empty saved-work shells cannot establish task completion. Citations must match the supplied student-work sources.

Task completion is **not** a mastery score, a grade, or proof of independent authorship. AI-generated tool content can appear in saved work. Teacher review remains necessary.

The interface distinguishes **not assessed**, **pending**, **current**, and **unavailable**. An unavailable assessment is not zero progress or an all-clear.

### Safeguarding alerts

The teacher alert panel supports:

- Sustained, clearly unrelated off-task behavior.
- Inappropriate content.
- Credible danger signals, such as threats or self-harm statements.
- Concerning assistant output, identified as AI output rather than student conduct.

Off-task alerts require citations from multiple distinct student messages. The assessment instructions exclude a lone joke, related curiosity, and ordinary academic discussion.

Alerts show severity, quoted evidence, **Review student**, and **Acknowledge**. Acknowledgements persist. Reassessment of the same evidence does not reopen an acknowledged alert.

**These are advisory AI judgments.** A model can miss a concern or misread its context. Exact citations do not make its interpretation correct.

No alerts does not certify safety. The app does not contact emergency services, diagnose students, assign punishments, or replace school safeguarding procedures.

## AI providers and credentials

An administrator adds connections under **Providers**. Teachers select these installation-wide connections in their Spaces.

**Connections are shared across the installation.** A teacher does not receive a separate private provider wallet. Usage belongs to the account behind the selected connection.

### Basic setup

1. Choose a provider preset.
2. Choose an API key, an existing macOS Keychain entry, or supported provider OAuth.
3. Fetch available models, or enter the exact model identifier manually.
4. Save the connection.
5. Test the selected model before classroom use.

API-key entry and model selection remain visible. **Advanced connection settings** contains the endpoint, API format, image model, and context/output limits.

Supported formats are OpenAI-compatible Chat Completions, Anthropic Messages, and Google Gemini. An arbitrary REST endpoint or Responses-only model is not automatically compatible.

Presets include OpenAI, Anthropic, Gemini, OpenRouter, OpenCode Zen/Go, Groq, Mistral, Together AI, DeepSeek, Moonshot/Kimi, Z.ai, BigModel, Ollama, and LM Studio.

A preset is a starting point. A model catalogue does not prove available credits, model entitlement, or image support.

### Credential options

- **API key:** encrypted in the application database. The browser does not receive the saved key.
- **Existing macOS Keychain key:** stores a service reference and reads the key server-side. The app does not create or change Keychain entries.
- **Provider OAuth:** available for OpenRouter and Google Gemini with a configured Google Cloud client. The resulting credentials are encrypted server-side.

Provider OAuth is API authorization, not access through a ChatGPT or Claude consumer subscription.

Google OAuth needs your own client ID, client secret, project, API enablement, permissions, and quota. OAuth callbacks require HTTPS or host loopback HTTP. Plain LAN HTTP is not an accepted callback origin.

OAuth sign-in saves the connection. **Disconnect OAuth locally** removes its local credential, not the provider-side grant. Revoke provider-side access in the provider's account settings.

See **[PROVIDERS.md](PROVIDERS.md)** for custom endpoints, provider examples, Google configuration, callback rules, and connection errors.

### Costs and local models

Chat, preview, design generation, tool generation, insights, and automatic monitoring can make additional model requests. Provider fees and limits apply.

For local inference, start Ollama or LM Studio separately. Select a model that the server actually has loaded. A preset does not install or start a model.

Using a local server can keep model inference local. YouTube and browser speech features can still involve external services.

## Classroom network hosting

The default address works only on the host computer. To serve other devices, use a reachable LAN address.

1. Complete first-run setup on the host.
2. Stop the server.
3. Find the host's current LAN IP address.
4. Restart with that address in `BASE_URL`.

Example for a macOS/Linux shell:

```sh
HOST=0.0.0.0 PORT=9272 BASE_URL=http://192.168.1.50:9272 bun run start
```

Replace `192.168.1.50` with the host's actual address. Students open that URL or a join link generated from it.

- `0.0.0.0` is a listening address, not a browser destination.
- `localhost` on a student's device points to that device, not the classroom host.
- A changed network address requires an updated `BASE_URL`.
- Host firewalls and school Wi-Fi client isolation can block access.
- Stop the current instance before starting another on the same port.

The shell syntax above is not PowerShell syntax. Windows hosting has not been verified.

**Do not expose this version directly to the public Internet.** HTTP sends session traffic without transport encryption. Use trusted classroom networks only.

Remote access requires HTTPS, a correctly configured reverse proxy, and a privacy/security review. TLS does not fix username impersonation or weak passwords.

GitHub stores the source code. GitHub Pages cannot run this Bun/SQLite server.

## Accounts and passwords

Administrators manage teacher accounts through **Profile**. Teachers use **Change password** there to change their own password.

- The first administrator chooses a password explicitly.
- A new teacher needs a name and an email sign-in identifier.
- A blank initial teacher password uses the first four characters before `@` in the lowercased email.
- If that username has fewer than four characters, the administrator must supply a password.
- The configured minimum is four characters. The interface explains it on validation failure.
- Teachers must provide their current password for self-service changes.
- Administrator resets and password changes invalidate existing teacher sessions.
- Passwords use Argon2id hashing. The app does not store readable teacher passwords.

Four-character defaults are predictable. Supply a unique, longer password for each teacher and share it through an approved channel. There is no automated email delivery or forgot-password service.

## Files and classroom tools

### Supporting materials and attachments

Supported uploads:

- TXT, Markdown, and CSV.
- Text-extractable PDF.
- DOCX.
- PNG, JPEG, and GIF.

The file limit is **10 MiB**. Extracted text is limited to **200,000 characters**. Check long documents rather than assuming every page reached the model.

Scanned PDFs have no OCR. Convert legacy `.doc` files to DOCX before uploading. Image understanding requires a vision-capable model.

Only upload materials you are permitted to use. A supported file type does not establish copyright permission or provider suitability.

### Tools

Teachers choose anytime tools and tools linked to agenda steps. Students can save work from the available tool panels.

The tools include plain-text documents, drawings, mind maps, flashcards, presentations, restricted mathematical graphs, and YouTube questions/checkpoints.

The document tool is not a full rich-text office editor. YouTube activities need access to YouTube. Image generation needs a compatible provider and image model.

Read-aloud and dictation depend on browser support and permissions. No audio or microphone access starts automatically. Browser dictation may send audio to the browser vendor's service.

## Data, backups, and updates

### Where data lives

Default runtime directory:

```text
~/.local/share/classroomai/
```

The main files are `classroomai.db` and `master.key`. SQLite can also create WAL and shared-memory files beside the database.

Spaces, launch snapshots, participants, messages, uploads saved with work, assessments, and provider settings persist across server restarts.

**Startup automatically creates or updates the database schema.** Starting a newer checkout against classroom data is a migration, not a read-only smoke check.

Keep runtime data outside the source repository and shared source-sync folders. The application stores classroom content in the database, not in an automatically encrypted document vault.

### Back up safely

1. Stop the server.
2. Copy the whole runtime data directory to a protected backup location.
3. Keep the encryption key with the database.
4. Preserve the same external `APP_SECRET` if you configured one.
5. Protect the backup as sensitive classroom data.

A database copy without its encryption key cannot recover saved provider credentials. A copy of both can expose those credentials to someone with filesystem access.

Exports are useful for reviewing a session. They do not replace a complete installation backup.

### Update an installation

1. Stop the server and make a backup.
2. Update the checkout.
3. Install the updated dependencies.
4. Run the checks while the normal server is stopped.
5. Start the application again.

For a clean Git checkout:

```sh
git pull --ff-only
bun install
bun run check
bun run self-check
bun run start
```

There is no automatic database rollback command. Preserve your backup before upgrading.

## Configuration

Set these variables in the process environment before starting the app. The LAN example shows macOS/Linux shell syntax.

| Variable | Default or purpose |
| --- | --- |
| `HOST` | `127.0.0.1`. Listening interface. Use `0.0.0.0` deliberately for LAN hosting |
| `PORT` | `9272`. Change it if another service uses the port |
| `BASE_URL` | `http://HOST:PORT`. Set the actual browser-reachable origin for links, origin checks, and OAuth callbacks |
| `DATA_DIR` | `~/.local/share/classroomai`. Choose a private local directory |
| `APP_SECRET` | Optional encryption-key override. Hex or Base64 encoding of at least 32 bytes. The first 32 bytes are used |
| `GEMINI_OAUTH_CLIENT_ID` | Your registered Google OAuth client ID |
| `GEMINI_OAUTH_CLIENT_SECRET` | Its server-only client secret |
| `GEMINI_OAUTH_PROJECT_ID` | Google project for API enablement, quota, and billing |

Most installations can leave `APP_SECRET` unset and use the generated `master.key`. Changing the encryption key makes existing encrypted credentials unreadable.

Do not paste credentials into GitHub, issue reports, source files, or command examples. Keep secret-bearing environment files private and excluded from Git.

## Checks and development

```sh
bun run check
bun run self-check
bun run build
```

- **check:** TypeScript checks.
- **self-check:** local HTTP/SQLite behavior using isolated synthetic records and provider/OAuth fixtures.
- **build:** creates `dist/server.js` for Bun.

Stop any existing ClassRoomAI instance before `self-check`. It uses port 9272. Temporary test data remains in the operating system's temporary directory.

The checks cover authorization, credential handling, lifecycle, saved work, return access, password changes, evidence validation, alerts, and restart persistence.

They do **not** prove live provider authorization, model accuracy, safeguarding recall, classroom capacity, or cross-platform compatibility.

For manual testing, always set `DATA_DIR` to a fresh, separate QA directory. Do not use the classroom database as a test target.

### Run the built server

```sh
bun run build
bun dist/server.js
```

Keep `public/` and installed dependencies with the checkout. The bundle is not a standalone installer or executable.

### Project structure

| Path | Purpose |
| --- | --- |
| `src/server.ts` | HTTP routes, authentication boundaries, session workflows, and startup |
| `src/db.ts` | SQLite storage and schema updates |
| `src/auth.ts` | Password hashing, session tokens, and credential encryption |
| `src/providers.ts` | Provider presets, model discovery, and API adapters |
| `src/oauth.ts`, `src/keychain.ts` | Provider login and existing macOS Keychain access |
| `src/spaces.ts` | Space validation and teacher-controlled model context |
| `src/assessment.ts`, `src/safeguarding.ts` | Task evidence and persistent advisory alerts |
| `src/files.ts`, `src/validate.ts` | Upload extraction and structured-data validation |
| `public/` | Browser interface, tools, styles, and OAuth continuation |
| `scripts/self-check.ts` | Runnable synthetic integration checks |
| `PROVIDERS.md` | Detailed provider setup guide |

The [workflow reference](schoolai-teacher-workflow.md) separates observed SchoolAI behavior from local implementation choices.

## Troubleshooting

| Problem | Check |
| --- | --- |
| `bun` is not found | Install Bun and open a new terminal |
| Address already in use | Stop the other instance, or change `PORT` and the matching `BASE_URL` |
| First-run setup is refused | Open the app directly on the host using loopback, before LAN/proxy exposure |
| Students cannot open the app | Check the host's LAN address, `HOST`, firewall, network reachability, and Wi-Fi isolation |
| Code is rejected | Use the launched session's eight-character code. A saved template is not a launched session |
| Chat is unavailable | Check pause/end/expiry state, turn limits, provider configuration, credits, and model availability |
| Models load but generation fails | Discovery does not prove entitlement, credits, or compatibility. Test the chosen model |
| Design or assessment is incomplete | Increase output limits in advanced settings, or shorten the input. No partial design is silently applied |
| Progress or monitoring is unavailable | Review work directly. Check provider capabilities, context/output limits, and connection errors |
| An image is not understood | Select a vision-capable chat model. Image generation uses a separate compatible image model |
| Saved credentials cannot decrypt | Restore the matching `master.key` or original `APP_SECRET` with the database |
| Google sign-in is unavailable | Configure your own Google client, project, and API access. Follow [PROVIDERS.md](PROVIDERS.md) |
| Voice controls do not work | Check browser support, installed voices, permissions, and secure-context requirements |

## Limits and privacy

Before entering real student data, review school policy, provider terms, retention requirements, and the network setup.

- Teachers and authorized collaborators can inspect student conversations and work.
- Username return does not verify identity. Classroom-code holders can resume other listed names.
- Hosted providers can receive teacher context, student conversations, attachments, and saved work used for assessment.
- Local hosting does not mean local AI processing when you select a remote provider.
- Do not put secrets in teacher prompts or supporting materials. Model replies can disclose prompt content.
- Saved provider credentials are encrypted. Classroom conversations and work are not encrypted at rest by the app.
- AI progress, insights, grouping, and alerts require human review. They are not grades or certified safeguarding.
- A session can contain at most 200 participants. That limit is not a tested performance guarantee.
- Acknowledging or ending a session does not erase its records. There is no automated retention or compliance-management service.
- There is no bundled hosted lesson library, standards database, Google Classroom/Canvas connector, SSO, or verified roster integration.
- There is no deployment package that makes this version suitable for untrusted public access.

Start with fictional classroom data and test your selected provider before introducing a real class.
