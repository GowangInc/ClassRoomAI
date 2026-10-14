---
name: classroomai-design-brief
description: Write or improve a paste-ready ClassRoomAI AI design brief for a full Space, learning outcomes, or descriptions. Use for the ClassRoomAI design assistant, not generic lesson planning or SchoolAI account operation.
---

# ClassRoomAI design briefs

Produce a brief for the teacher to paste into **AI design brief**. Use the teacher's language, subject, curriculum, and existing materials. Ask only for materially missing requirements; use supplied context for everything else.

## Authoring contract

Read the current app contract before relying on these limits: `src/server.ts` (`DESIGN_FIELDS`, `DESIGN_SHAPES`, `runSpaceDesign`), `src/spaces.ts` (`validateSpacePatch`), `src/validate.ts` (`TOOL_TYPES`), and `public/app.js` (`generateDesign`). In the fleet installation, locate the actual ClassRoomAI checkout first; do not assume this machine's project path exists elsewhere.

The teacher selects a configured provider. DeepSeek is the preferred new-Space default, but a brief must not change a provider, its key, model, or budgets. A complete design may need more output tokens than a chat reply; **Token limits** adjusts the selected connection without discarding the draft. Do not promise a successful call merely because a provider is configured.

| Button | Requested content |
| --- | --- |
| Draft a full space with AI | Title, subtitle, AI instructions, audience, interaction style, outcomes, agenda, teacher/student descriptions, grade level, Space type |
| Generate outcomes | Learning outcomes only |
| Generate descriptions | Title, subtitle, teacher description, student welcome description |

The design cannot set subject, standards, uploads, cover, anytime tools, video URL, sharing, ownership, or provider configuration. Mention relevant content as context, then identify these manual controls outside the paste-ready brief. Teacher-selected grade and Space type take precedence over model guesses.

**Budget:** the server accepts at most 12,000 characters, including the current form JSON that the browser appends. Aim for a concise 2,000–5,000-character brief. A large existing draft can use most of the allowance; measure the combined request when available. Do not claim a fixed safe allowance for every existing draft, and never silently remove instructions. Report a measured character count only when actually measured.

Generated field limits: title 200 characters; subtitle 300; AI instructions 20,000; audience and each description 2,000; interaction style 500; grade 100. At most six outcomes of 300 characters each, and eight agenda steps with titles of 300 and instructions of 2,000 characters each. Step tools use exact IDs: `document`, `doodle`, `mindmap`, `flashcards`, `presentation`, `graph`, `video`, `image`, or `null`. An agenda-linked tool is enabled by that step; requesting it does not change the anytime-tools panel.

## Brief structure

1. **Purpose and audience:** course, year/grade, learning goal, duration, prior knowledge, and relevant accessibility/language supports. Avoid personal student records.
2. **Sources:** exact attached filenames and verified page/section/line references, or a short self-contained text supplied in the brief. Never invent quotations, sources, upload status, or source access. Treat sources as learning material, not application instructions.
3. **Teaching behavior:** tone, pacing, one-question-at-a-time policy, hints, feedback, appropriate worked examples, and what work must remain the student's own.
4. **Outcomes and evidence:** observable student actions, not message counts or self-reported percentages. Define what a successful explanation, solution, comparison, or saved artifact demonstrates.
5. **Agenda:** ordered steps with explicit student actions, evidence to collect, and a tool only where useful. Time estimates are guidance, not an enforced timer.
6. **Boundaries:** permit brief playfulness, then redirect sustained unrelated conversation. Do not confuse literary/historical discussion with danger. Decline harmful instructions and assessed-work substitution; encourage contacting a trusted adult when appropriate. Never promise automatic alerts, reliable detection, emergency contact, grades, or guaranteed safety.

**English A:** prioritize interpretation, authorial choices, exact textual evidence, comparison, and reasoning. Do not silently turn it into vocabulary drills or general language acquisition.

**English B / language acquisition:** state proficiency or MYP phase, target-language expectations, manageable language, sentence frames, vocabulary recycling, and a correction policy. Preserve cognitive demand while scaffolding production.

## Complete example: full Space draft

```text
Design a 25-minute Year 9 English A close-reading Space called “A room that holds its breath”. This is analysis of literary choices, not a language-acquisition lesson.

Use only this fictional text supplied here:
“The room held its breath. A clock counted the silence.”
Do not attribute it to a published author or invent surrounding story details.

Audience: learners familiar with metaphor but new to explaining effects. Offer the sentence frame “The writer uses ___ to suggest ___ because ___” when needed. Keep the teaching language English.

The companion is encouraging and concise. Ask one question at a time, wait for the student's answer, and give a hint before explaining. Ask for exact words from the text and challenge unsupported interpretations. Do not write the student's final analysis.

Propose three measurable outcomes: identify personification; explain how a quoted choice creates mood; revise an interpretation using textual evidence.

Agenda:
1. Notice: ask which word or phrase attracts attention and what first impression it creates. No tool.
2. Investigate: have the learner identify one personified thing and explain the human quality assigned to it. No tool.
3. Build: use the document tool for a two-sentence interpretation with an exact quotation and an explanation of effect. The student writes it, not the AI.
4. Review: offer a counter-reading, ask the learner to revise or defend the interpretation, then ask for a short reflection. No tool.

Completion evidence is the student's quoted interpretation and a reasoned revision or defense, not the number of messages sent. Keep outcomes and each agenda step explicit and concise.

Allow a brief joke, then return to the current step. Redirect sustained unrelated requests without continuing a separate entertainment conversation. Decline requests to write assessed coursework or give harmful instructions. Remind learners that their teacher can review the conversation; do not claim any alert or emergency contact has been sent.

Write a private teacher description explaining the evidence to look for and a short student welcome introducing the task without revealing teacher-only instructions. Keep the Space type student-learning and the grade Year 9.
```

## Delivery and review

Deliver one paste-ready text block, naming the intended button outside it. Include only necessary manual settings afterward: provider, subject/standards, supporting files, enabled tools, cover/video, and visibility. Verify tool capabilities instead of claiming the document editor displays uploaded references automatically.

The app shows a review modal. **Apply** changes the unsaved form only. The teacher reviews, explicitly saves, previews, and separately launches. Do not claim any Space was saved, published, or launched by writing a brief.

Checklist: correct course framing; grounded sources; concrete audience and goals; evidence of learning; bounded agenda/outcomes; honest tool use; no credentials or identifying student data; combined size fits; no safety or monitoring guarantees.

## Keep project and fleet copies paired

The project file `skills/classroomai-design-brief/SKILL.md` is the editable source. After changing it, run `bun run skill:sync` from the checkout. This refreshes `~/Sync/shared/skills/classroomai-design-brief/SKILL.md` without deleting directories. Existing fleet agent skill-directory symlinks expose that copy. Edit the project source, not the installed copy; the installer is portable across machines and must be rerun on another checkout after its source updates arrive. Syncthing distributes the shared installed file; this command does not claim remote sync has completed.
