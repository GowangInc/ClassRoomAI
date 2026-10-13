# ClassRoomAI teacher Space authoring walkthrough

## Purpose
A workflow reference based on authorized observation of SchoolAI.com and its official help pages. It guides an original, self-hosted ClassRoomAI app. It contains no student records, account credentials, private Space identifiers, or copied teacher lesson prompts.

## Observed teacher workflow
1. **Discover:** browse reusable experiences by purpose, subject, and grade level. The teacher navigation separates Create a Space, Student insights, and Organize.
2. **Create a Space:** choose Student learning, Teacher productivity, or Staff operations. The landing page offers AI-assisted creation, Space Designer, and Create from scratch. Teacher-productivity authoring does not require a student grade level.
3. **Space details:** title, subtitle, and cover image establish the experience. The editor marks these as required. Student-learning Spaces also expose grade selection.
4. **Prompt and context:** general AI instructions are separate from supporting files/resources and academic standards. Standards are browsed by region, grade, subject, and strand; searches are enabled after choosing a region. File upload on the observed free account shows a 10 MB total batch limit.
5. **Advanced prompting:** learning outcomes define what participants should demonstrate. Agenda steps define the sequence. Each step has its own title, instructions, and optional classroom tool. An agenda-visibility switch controls whether participants see the agenda.
6. **Audience and style:** audience details and interaction/persona style are separately editable; they are not the participant welcome description.
7. **Tools:** anytime tools are available throughout an experience; step-linked tools are attached to particular agenda stages. Observed choices include Document Editor, Image Generator, Doodleboard, Flashcards, Graphing Calculator, Mindmap, and step-linked Video Explorer. Some tools are plan-limited or marked early access.
8. **Publishing details:** educator-facing description and participant description are separate. Visibility choices are Private, Anyone with the link, and Public/Discover. Authoring a template and launching a student session are separate actions.
9. **Preview:** the unsaved new editor says to save the Space before enabling preview. Preview is distinct from launching an activity or inviting a class.
10. **Session history and monitoring:** Student insights lists Space sessions with Status, Participants, Insights, and Alerts. Mission Control exposes invite, pause, end, preview, student search, Smart Groups/List, outcome/progress views, and session insights. Existing student records are not part of this demonstration.

## Lifecycle evidence from official help
- A Space must be launched before students can join using a code, link, or QR code.
- Code-based joining asks for a name and does not independently verify identity.
- Pausing and ending are distinct. Closing the teacher browser does not end a session.
- A session-specific prompt can customize a particular launch without rebuilding the reusable template.
- Teacher monitoring and AI-generated learning judgments need human interpretation. Activity counts are not evidence of mastery.

## Suggested walkthrough outcomes
- Explain how instructions, context, audience, and interaction style shape an AI learning experience.
- Design measurable outcomes and an ordered agenda with explicit instructions and appropriate tools.
- Distinguish a saved template from a launched session and plan privacy, invitation, monitoring, pause/resume, and closure checks.

## Six-stage walkthrough agenda
1. Define purpose and audience.
2. Write instructions and supporting context.
3. Specify outcomes and an agenda.
4. Choose tools, presentation, and visibility.
5. Plan preview and session boundaries.
6. Record the monitoring and closure checklist.

## Boundaries for the local reconstruction
The design target is a lightweight local web app with reusable templates, separate launch snapshots, join codes, isolated student sessions, teacher monitoring, optional classroom tools, and configurable server-side model providers. Hosted providers perform remote inference; local inference is not needed to run the web interface.

A local app does not inherit SchoolAI's provider contracts, certifications, hosted discovery corpus, integrations, or proprietary safety system. Credentials must remain server-side; do not enter real student records until the chosen provider and school's data requirements have been reviewed. Imported files and participant messages are untrusted context, not application commands. AI-generated outcome/sentiment judgments are advisory, not automatic grades or reliable crisis screening.

## Official references
- [SchoolAI Spaces](https://schoolai.com/products/spaces)
- [Create and use Spaces](https://help.schoolai.com/en/articles/10270295-create-and-use-spaces-with-the-space-creator)
- [Getting started with Spaces](https://help.schoolai.com/en/articles/15538519-getting-started-with-spaces)
- [Getting students into Spaces](https://help.schoolai.com/en/articles/10280003-getting-students-into-spaces)
- [Mission Control guide](https://help.schoolai.com/en/articles/15243484-your-guide-to-mission-control)
- [Enhanced Spaces](https://help.schoolai.com/en/articles/12946084-enhanced-spaces-design-once-differentiate-for-all)

Authenticated teacher controls were inspected directly in the user's authorized SchoolAI browser session on 12 October 2026. Teacher inspection did not modify any existing Space or class controls. The separately authorized student test is recorded below.

## Synthetic walkthrough verification
- A teacher-productivity sample used original supporting notes, outcomes, and a six-stage agenda.
- Document Editor was available throughout and linked to the final checklist step.
- Teacher preview used a fictional close-reading activity. It produced an authoring checklist and retained the no-ghostwriting boundary.
- Student-view checks used a clearly labeled synthetic participant and original test prompts, not a real student's account or work.
- The student view exposed conversation, message composition, accessibility and language settings, and user-triggered listen/dictation controls.
- A synthetic word-choice request produced a brief comparison question rather than an essay.
- The checks did not alter existing students' work or classroom controls.

## ClassRoomAI defaults
The local app is framed around MYP / DP English A close reading, authorial choices, textual evidence, interpretation, and comparison. It does not default to language acquisition. Response-language selection is hidden unless a teacher explicitly enables it for a Space; existing browser preferences cannot override a default-off session. The teacher's instructions determine teaching language. This policy is stored with each launch snapshot.

## Interface refinement verification

- Teacher and student layouts were rechecked against the authenticated SchoolAI reference in the user's real Chrome session. The local teacher surface now uses a compact sidebar/header, grouped configuration tabs and a right-hand saved-template preview. The student surface uses a narrow central conversation, independently scrolling messages, an anchored composer, and on-demand plan, tools and reading panels.
- Real Chrome checks used a separate temporary ClassRoomAI database, with teacher and student roles on separate loopback hostnames. Review/apply did not save automatically; preview did not launch a session. Native message submission, persisted feedback, saved document/mindmap/graph work, live teacher monitoring, pause/resume with preserved drafts, and a 390-pixel student viewport were exercised. No audio or microphone access was activated.
- Provider catalogues were reachable during some checks. Catalogue access did not establish generation entitlement or model availability. Successful design-review and student-conversation checks used explicitly labeled protocol fixtures, not proof of live model inference. Existing Keychain entries were not changed.
