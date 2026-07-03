// ── THE ARMADA EXCELLENCE STANDARDS — the handbook, live in the app ────────────
// "A standard distributed once changes nothing. A standard used every day becomes
// who we are." This module is the single source of truth for the handbook: the
// ten Armada Principles, the eight role chapters, and the closing Standard.
// Everything that coaches, recognizes, or lines up points back here.

export const ARMADA_PRINCIPLES = [
  { n: 1,  title: 'We Put the Client First',      line: 'Every decision starts with what the client needs.' },
  { n: 2,  title: 'We Own the Entire Experience', line: 'Not just our task, the whole experience the client feels.' },
  { n: 3,  title: 'We Respect Everyone',          line: 'Clients, families, and each other, without exception.' },
  { n: 4,  title: 'We Solve Problems',            line: 'When it is ours, we drive it to done.' },
  { n: 5,  title: 'We Never Walk Past a Problem', line: 'When it is not obviously ours, we act anyway.' },
  { n: 6,  title: 'We Improve Every Day',         line: 'A little better today than we were yesterday.' },
  { n: 7,  title: 'We Protect Safety',            line: 'Physical, clinical, and emotional safety come first.' },
  { n: 8,  title: 'We Keep Our Promises',         line: 'If we said it, we do it. Reliability is the standard.' },
  { n: 9,  title: 'We Work as One Team',          line: 'No silos, no "not my department."' },
  { n: 10, title: 'Excellence Is Our Standard',   line: 'Not when convenient. As the baseline, every day.' },
];

export const ARMADA_STANDARD =
  'At Armada, excellence is not defined by completing tasks. Excellence is defined by the experience we create for our clients and for one another. ' +
  'Every interaction is an opportunity to build trust, remove barriers, and advance recovery. No role here is more important than another. ' +
  'We are each responsible for making Armada a place where clients receive exceptional care and employees are proud to work.';

export const ALL_BEHIND_YOU = 'All behind you.';

// One safety reminder per line-up — clinical, physical, or environmental.
// Rotates daily alongside the principle; drawn from the chapters' safety standards.
export const SAFETY_REMINDERS = [
  'A check you chart is a check you did. Every round walked honestly, on time, per patient, documented in real time.',
  'Never assume it is "just withdrawal" — the line between discomfort and danger is ours to watch. Escalate to the nurse early.',
  'The rights of medication administration, without exception. No shortcut on a med pass is ever worth it.',
  'Diversion prevention and controlled-substance protocols exactly as written — count, witness, document.',
  'Never meet agitation with aggression. De-escalate with patience; run the Save — pause your own reaction first.',
  'Keep the environment contraband-free. Notice it, report it, never walk past it.',
  'Confidentiality is safety: 42 CFR Part 2 from the very first phone call. Never disclose without a valid release.',
  'Infection control is client care, not appearance — clean means sanitized to standard, not presentable.',
  'When a client is in your vehicle, they are in your care. Seatbelts, safe speeds, and never drop anyone somewhere unsafe.',
  'Report any change in a client’s condition or behavior immediately — early is the whole game.',
  'Physical, clinical, and emotional safety come first — if you see a hazard, own it until it is fixed.',
  'Protect personal boundaries at all times — warmth and professionalism are the same skill.',
];

export const HANDBOOK_INTRO = {
  note: {
    title: 'Why This Exists',
    body: [
      'When we started Armada, we did not begin with a building or a business plan. We began with a conviction: that one human being, showing up the right way at someone’s lowest moment, can change the entire course of a life.',
      'I have watched it happen. A person walks in with nothing left, certain the world has already written them off, and one interaction, one person who treats them with dignity and actually follows through, becomes the moment everything turns. That is not a slogan to me. It is the reason this company exists.',
      'This handbook is our attempt to make that moment happen on purpose, every day, in every role, instead of by luck. It is not a rulebook, and it is not about perfection. It is about every one of us knowing exactly what excellence looks like in our own seat, so that no client’s recovery ever depends on whether they happened to get a good employee that day.',
      'Every person here is part of that moment. The tech on the floor at three in the morning. The driver getting someone to court on time. The voice that answers the phone. The person who cleans a room so it says “you matter” before anyone speaks. That is what “All behind you” means. It is a promise to our clients, and a promise we make to each other.',
      'Thank you for doing this work. It matters more than you know.',
    ],
    sign: 'Shlomo Smith · Founder and CEO, Armada Recovery',
  },
  layers: [
    { k: 'Layer 1 · Purpose',        v: 'Why the role exists, and why it matters to a human being at the worst moment of their life. This is what you lead with when you sit down with a new hire.' },
    { k: 'Layer 2 · Excellence',     v: 'What excellent looks like day to day: who you serve, the daily standards, the behaviors, and, just as important, what excellence is not. This is what supervisors coach from.' },
    { k: 'Layer 3 · Accountability', v: 'How we know we are excellent: the measures, and the questions each person asks themselves every day. This is what makes it real instead of a poster on the wall.' },
  ],
  recognition: {
    title: 'Recognizing Excellence',
    body: 'Culture is not built by a handbook. It is built by what leaders notice out loud. Every leader at Armada is expected to recognize excellence every day. Good recognition is specific — it names three things: the behavior (what exactly the person did), why it mattered (the difference it made for a client or a teammate), and which standard it reflected.',
    example: '“Nice job” builds nothing. “You caught that client’s benefits lapse before it became a discharge crisis. That is exactly what Excellence Looks Like for a case manager, and it is the reason he has housing today.” That builds culture.',
  },
  lineup: {
    title: 'The Daily Line-Up',
    body: 'Five minutes at the start of every shift — not a status meeting, but the moment the standard comes off the page. Each line-up covers four things:',
    items: [
      'One principle or standard, pulled from this handbook.',
      'One story — a real example of it lived well, or an honest lesson from when it was not.',
      'One safety reminder — clinical, physical, or environmental.',
      'One operational focus — what matters most on this shift today.',
    ],
  },
  rhythm: [
    { k: 'Hire to it',        v: 'Select people who already carry these standards, and screen for them at the door.' },
    { k: 'Onboard with it',   v: 'Every new hire’s first day includes their role chapter and the conversation behind it — purpose before paperwork.' },
    { k: 'Coach from it',     v: 'Supervisors correct and develop using the written standard, especially “What Excellence Is Not” — not by mood.' },
    { k: 'Recognize against it', v: 'Daily, specific recognition tied back to a named standard or principle.' },
    { k: 'Evaluate with it',  v: 'Performance reviews are built on the same standards, so people are measured against what they were taught.' },
    { k: 'Talk about it daily', v: 'The Daily Line-Up keeps one principle, one story, one safety reminder, and one focus in front of the team every shift.' },
  ],
};

// roles: which JOB_ROLES open this chapter as "my chapter" on My Role.
// Chapters with no matching app role (Transportation) still live in the browser.
export const HANDBOOK = [
  {
    chapter: 1, title: 'Leadership',
    roles: ['Executive Director', 'Director of Operations', 'Clinical Director', 'Housing Director', 'HR', 'Executive Assistant', 'House Manager', 'Director of Revenue Cycle Management', 'Director of Billing Compliance'],
    purpose: [
      'Everything in this handbook depends on you. A standard is only as real as the leader who lives it, coaches it, and refuses to walk past its absence. Your team will not rise above the example you set or the behavior you tolerate.',
      'You are not here to catch people doing wrong. You are here to develop good people into extraordinary ones, remove what gets in their way, and make excellence the easiest thing to do at Armada. The standard applies to you first. It starts with you.',
    ],
    serve: {
      outside: 'Clients and families, through the team you build and the culture you set.',
      inside: 'Every person you lead, your fellow leaders, the leaders you answer to. A leader serves the team, not the other way around.',
    },
    looks: [
      'Develops people before correcting them.',
      'Coaches from the standard instead of improvising or leading by mood.',
      'Recognizes excellence every day, specifically and out loud.',
      'Removes barriers to performance instead of blaming people for hitting them.',
      'Holds people accountable with dignity, never with humiliation.',
      'Is visible where the work actually happens, not only in the office.',
      'Improves the system before adding another rule.',
      'Holds themselves to the standard first, in front of everyone.',
    ],
    daily: [
      'Run the daily line-up: one principle, one story, one safety reminder, one focus.',
      'Recognize at least one specific, earned act of excellence, tied to a standard.',
      'Be present on the floor, where you can see the work and the team can see you.',
      'When something goes wrong, ask “where did the system break?” before “who is to blame?”',
      'Coach in the moment, privately, using the written standard as the reference.',
      'Clear at least one barrier that is getting in your team’s way.',
    ],
    not: [
      'Correcting someone for a standard you never set or trained.',
      'Coaching by mood instead of by the standard.',
      'Saving your attention for when something goes wrong.',
      'Blaming the person when the system was the problem.',
      'Public criticism, sarcasm, or accountability that strips a person’s dignity.',
      'Leading from the office by email.',
      'Adding a rule to avoid a hard conversation.',
      'Holding your team to a standard you do not hold yourself to.',
    ],
    behaviors: ['Develop first.', 'Coach from the standard.', 'Recognize daily.', 'Remove barriers.', 'Hold accountability with dignity.', 'Be visible.', 'Fix systems before adding rules.', 'Model it yourself.', 'Judge favorably.', 'Own that it starts with you.'],
    measures: [
      { k: 'People',  v: 'team retention and engagement; the growth and promotion of your people; how your team performs when you are not in the room.' },
      { k: 'Culture', v: 'consistency of daily line-ups; recognition frequency; whether your team feels safe raising a problem to you.' },
      { k: 'Systems', v: 'barriers removed; repeat incidents prevented by fixing systems rather than assigning blame.' },
      { k: 'Self',    v: 'whether you hold yourself to what you ask of everyone else.' },
    ],
    questions: [
      'Did I develop someone today, or only correct them?',
      'Did I recognize something real and specific?',
      'Did I ask where the system broke before I asked who to blame?',
      'Did I hold myself to the standard I expect of my team?',
    ],
    closing: 'When every leader practices this standard, the team does not need to be watched to be excellent, because excellence is simply how Armada is led.',
  },
  {
    chapter: 2, title: 'Case Manager & CDCA',
    roles: ['Case Manager'],
    purpose: [
      'To remove the barriers to recovery so clients can move confidently toward a healthier life. You coordinate care, advocate for every client, and make sure each person has the resources, plan, and support they need to succeed after treatment.',
      'For many of our clients, you may be the first person in years who consistently follows through, keeps promises, and advocates for them without wanting anything in return. Your reliability is part of the treatment. Our goal is not simply discharge. It is successful continuity of care.',
    ],
    serve: {
      outside: 'Clients, families, referral partners, outpatient providers, community agencies, probation and courts, benefits offices.',
      inside: 'Therapists, medical providers, nursing, behavioral health technicians, admissions, utilization review, business development, leadership.',
    },
    looks: [
      'Begins discharge planning on the day of admission, not the day of discharge.',
      'Anticipates barriers before they become crises.',
      'Owns each problem until it is solved, then closes the loop.',
      'Does what they said they would do, when they said they would do it.',
      'Builds trust with clients and families.',
      'Ensures every client leaves with a realistic, individualized aftercare plan.',
      'Never lets a client feel abandoned during a transition.',
      'Treats every interaction as a chance to build hope and confidence.',
    ],
    daily: [
      'Meet every assigned client promptly and explain the case management process.',
      'Return client requests the same day whenever possible.',
      'Identify discharge and resource needs early; confirm appointments before discharge.',
      'Address transportation, insurance, and placement barriers proactively.',
      'Keep the treatment team informed and escalate barriers early, not at discharge.',
      'Chart timely, accurate, complete notes that tell the client’s story. A note you chart is a service you delivered.',
      'As a CDCA, come prepared to every group and be fully present with the people in the chairs.',
      'Protect confidentiality under 42 CFR Part 2 and never disclose without a valid release.',
    ],
    not: [
      'Handing a client a phone number and calling it a referral.',
      'Good intentions that quietly slip a week.',
      'Discharge planning that begins the morning someone leaves.',
      'Charting what should have happened instead of what did.',
      'Running the clock until group is over.',
      'Deciding who is going to make it and who is not.',
    ],
    behaviors: ['Keep promises.', 'Anticipate problems.', 'Ask for help early.', 'Solve problems collaboratively.', 'Treat every client with dignity.', 'Protect confidentiality.', 'Stay organized.', 'Remain calm under pressure.', 'Take ownership.', 'Keep learning.'],
    measures: [
      { k: 'Client outcomes', v: 'continuity-of-care appointments scheduled before discharge; successful discharge rate; readmission trends; client satisfaction.' },
      { k: 'Operational',     v: 'timeliness of discharge planning; documentation completion; length of stay driven by avoidable barriers; timely referrals.' },
      { k: 'Team',            v: 'peer collaboration; provider feedback; reliability and accountability.' },
    ],
    questions: [
      'What barrier delayed care today, and how could I have seen it coming?',
      'Did I keep every promise I made to a client today?',
      'Is there a client who feels dropped right now, and what will I do about it tomorrow?',
      'What process could I make better?',
    ],
    closing: 'When every case manager practices this standard, no client falls through a crack, and no one faces the next step alone.',
  },
  {
    chapter: 3, title: 'Behavioral Health Technician',
    roles: ['BHT / Tech'],
    purpose: [
      'You are the constant. Clients see you more than anyone else in the building, at three in the morning when the cravings hit, during the hardest hours of withdrawal, and in the ordinary moments between groups.',
      'You keep them safe, you keep the environment calm and dignified, and you are often the first person to notice when something is wrong. You may not write the treatment plan, but you are the one who makes a client feel human while they live it. Your presence is the treatment happening in real time.',
    ],
    serve: {
      outside: 'Clients, families, through the impression the milieu makes.',
      inside: 'Nursing, case management, therapists, admissions, leadership, every teammate on the floor.',
    },
    looks: [
      'Completes every safety round on time and honestly. A check you chart is a check you did.',
      'Notices the client who is too quiet, too sick, or too agitated, and tells the nurse early.',
      'Keeps the environment clean, calm, and dignified.',
      'De-escalates with patience instead of power.',
      'Treats a client in withdrawal with the same respect as anyone else.',
      'Is the reason a client on the edge decided to stay one more day.',
    ],
    daily: [
      'Perform rounds and safety checks exactly as scheduled, per patient, documented in real time.',
      'Report any change in a client’s condition or behavior to nursing immediately.',
      'Support clients through the hard hours and daily needs with patience and dignity.',
      'Maintain a clean, orderly, contraband-free environment.',
      'Follow de-escalation and crisis protocols. Never meet agitation with aggression.',
      'Protect confidentiality and personal boundaries at all times.',
    ],
    not: [
      'Charting a round you did not actually walk.',
      'Sitting on your phone while the floor runs itself.',
      'Meeting a difficult client with sarcasm or force.',
      'Deciding a client is “just detoxing” and missing a medical emergency.',
      'Treating the milieu and the cleaning as beneath you.',
    ],
    behaviors: ['Show up, and show up on time.', 'Observe closely.', 'Report early.', 'Stay calm.', 'Protect dignity.', 'Keep the environment safe.', 'Follow through.', 'Support your teammates.', 'Never cut a corner on safety.', 'Keep learning.'],
    measures: [
      { k: 'Safety',           v: 'rounds completed on time and accurately; incident response; environment audits.' },
      { k: 'Clinical support', v: 'early identification of condition changes; quality of hand-offs to nursing.' },
      { k: 'Experience',       v: 'client sense of safety; AMA trends; milieu quality.' },
      { k: 'Team',             v: 'reliability; attendance; teamwork.' },
    ],
    questions: [
      'Did I do every round honestly and on time?',
      'Did I notice and report something early enough to matter?',
      'Did any client feel safer because I was here?',
      'Did I leave the floor better than I found it?',
    ],
    closing: 'When every behavioral health technician practices this standard, clients feel safe every hour of every day.',
  },
  {
    chapter: 4, title: 'Nurse',
    roles: ['Nurse'],
    purpose: [
      'You are the clinical safety net. In detox, the line between discomfort and danger is yours to watch. You manage withdrawal, you catch the emergency before it becomes one, and you deliver comfort and dignity in the hours clients will remember as their worst.',
      'Clinical excellence and human warmth are not separate things in your role. A client in withdrawal needs both, from the same hands. You are competence and compassion at the same time.',
    ],
    serve: {
      outside: 'Clients, families.',
      inside: 'Providers, behavioral health technicians, case management, therapists, admissions, leadership.',
    },
    looks: [
      'Assesses withdrawal accurately and acts on it. Never rushes or eyeballs a CIWA or COWS.',
      'Passes medications safely, every time, with no shortcuts.',
      'Catches the subtle sign of a medical emergency that others miss.',
      'Treats a client who is sick, scared, or difficult with steady compassion.',
      'Documents accurately, because the next shift’s decisions depend on it.',
      'Communicates clearly with providers and never sits on a concern.',
    ],
    daily: [
      'Complete assessments and vitals thoroughly and on schedule.',
      'Follow the rights of medication administration without exception.',
      'Escalate clinical concerns to the provider promptly and clearly.',
      'Document accurately, completely, and in real time.',
      'Maintain diversion-prevention and controlled-substance protocols exactly.',
      'Deliver care with dignity, especially during the hardest hours.',
    ],
    not: [
      'Charting an assessment you did not fully perform.',
      'Cutting a corner on a med pass because you are busy.',
      'Treating a demanding client as a nuisance instead of a patient.',
      'Assuming it is “just withdrawal” when it might be something worse.',
      'Passing a concern to the next shift instead of acting on it.',
    ],
    behaviors: ['Assess carefully.', 'Follow protocol.', 'Escalate early.', 'Document honestly.', 'Protect against diversion.', 'Stay calm in a crisis.', 'Lead the floor by example.', 'Treat every patient with dignity.', 'Support your techs.', 'Keep your competence sharp.'],
    measures: [
      { k: 'Safety',     v: 'medication accuracy; assessment timeliness and accuracy; escalation quality; diversion-prevention compliance.' },
      { k: 'Clinical',   v: 'withdrawal managed without avoidable transfers; documentation quality.' },
      { k: 'Experience', v: 'client comfort and dignity; complaint trends.' },
      { k: 'Team',       v: 'reliability; leadership on the floor; support of BHTs.' },
    ],
    questions: [
      'Did I assess every client as carefully as I would want for my own family?',
      'Did I act on every concern, or pass any along?',
      'Was I both competent and kind today?',
      'Did I keep the floor safe?',
    ],
    closing: 'When every nurse practices this standard, clients heal with both competence and compassion.',
  },
  {
    chapter: 5, title: 'Therapist',
    roles: ['Therapist'],
    purpose: [
      'You do the deep work. While others keep clients safe and moving, you help them understand why they used, what they are running from, and who they could become.',
      'The relationship you build may be the first safe, honest relationship a client has had in years. You are not just running groups and writing plans. You are helping a human being rewrite the story they tell about themselves.',
    ],
    serve: {
      outside: 'Clients, families.',
      inside: 'Case management, nursing, behavioral health technicians, medical providers, utilization review, leadership.',
    },
    looks: [
      'Builds a genuine therapeutic alliance, not a clinical transaction.',
      'Comes to every group and session prepared and fully present.',
      'Writes treatment plans that are individualized and actually guide care.',
      'Meets clients where they are without lowering the standard for them.',
      'Coordinates with the team so therapy connects to the whole plan.',
      'Sees the person, not the diagnosis.',
    ],
    daily: [
      'Hold individual and group sessions on schedule, prepared, and present.',
      'Develop and update individualized treatment plans that reflect real clinical thinking.',
      'Document clinically meaningful notes in a timely way.',
      'Communicate clinical concerns and progress to the team.',
      'Maintain professional and ethical boundaries at all times.',
      'Protect confidentiality under 42 CFR Part 2.',
    ],
    not: [
      'Running a group off the top of your head because you did not prepare.',
      'Copy-paste treatment plans that could belong to anyone.',
      'Notes written to satisfy billing instead of reflecting the work.',
      'Writing a client off as unmotivated instead of meeting resistance clinically.',
      'Working in a silo, away from the rest of the team.',
    ],
    behaviors: ['Prepare.', 'Be present.', 'Build trust.', 'Individualize the work.', 'Document with integrity.', 'Hold boundaries.', 'Coordinate with the team.', 'Treat every client with dignity.', 'Stay clinically curious.', 'Keep growing.'],
    measures: [
      { k: 'Clinical', v: 'treatment plan quality and individualization; documentation timeliness and quality; engagement and group attendance.' },
      { k: 'Outcomes', v: 'client progress; completion rates; client feedback on the therapeutic relationship.' },
      { k: 'Team',     v: 'collaboration; provider and case-manager feedback; reliability.' },
    ],
    questions: [
      'Was I fully present with each client, or just processing them?',
      'Did my documentation reflect real clinical work?',
      'Did I meet resistance with skill instead of judgment?',
      'Did I connect the therapy to the whole plan?',
    ],
    closing: 'When every therapist practices this standard, clients leave understanding themselves, not just detoxed.',
  },
  {
    chapter: 6, title: 'Admissions',
    roles: ['Front Desk'],
    purpose: [
      'You are the first human being a client meets at Armada, often at the single most frightening moment of their life, in the narrow window where they have decided to get help before they change their mind.',
      'How you answer the phone can decide whether someone lives. You are not processing an intake. You are catching a person who finally reached out, and making sure they do not fall before they get through the door.',
    ],
    serve: {
      outside: 'Prospective clients, families, referral partners, hospitals and emergency departments, community agencies.',
      inside: 'Clinical intake, nursing, case management, utilization review, leadership.',
    },
    looks: [
      'Answers fast and warm, every time. A missed call can be a missed life.',
      'Treats a scared, ashamed, or intoxicated caller with total dignity.',
      'Moves with urgency to get someone in before the window closes.',
      'Handles families with the same care as clients.',
      'Gets the details right so the clinical team is set up to succeed.',
      'Represents Armada to every referral partner as if the reputation rides on this one call.',
    ],
    daily: [
      'Answer inquiries promptly. Never let a person in crisis wait.',
      'Communicate with warmth, respect, and zero judgment.',
      'Gather accurate information and verify benefits efficiently.',
      'Coordinate a smooth, fast handoff to the clinical team.',
      'Follow up on every lead. No one falls through the cracks at the door.',
      'Protect confidentiality from the very first contact.',
    ],
    not: [
      'Letting a call go to voicemail because you are busy.',
      'Making a desperate person feel like a transaction or a number.',
      'Judgment, coldness, or impatience with someone in crisis.',
      'Sloppy intake information that sets the clinical team up to fail.',
      'Losing track of a lead who reached out and never got a callback.',
    ],
    behaviors: ['Answer fast.', 'Lead with warmth.', 'Move with urgency.', 'Judge no one.', 'Get it right.', 'Follow up relentlessly.', 'Protect confidentiality.', 'Represent Armada with pride.', 'Support the clinical handoff.', 'Keep learning.'],
    measures: [
      { k: 'Access',     v: 'speed to answer; inquiry-to-admission conversion; lead follow-up rate; missed-call trends.' },
      { k: 'Experience', v: 'caller and family experience; referral-partner feedback.' },
      { k: 'Quality',    v: 'accuracy of intake information; smoothness of the clinical handoff.' },
      { k: 'Team',       v: 'reliability; collaboration.' },
    ],
    questions: [
      'Did every person who reached out get a fast, warm response?',
      'Did anyone in crisis wait longer than they should have?',
      'Did I set the clinical team up with accurate information?',
      'Did I follow up on every lead?',
    ],
    closing: 'When every admissions coordinator practices this standard, people get help before they lose the courage to ask.',
  },
  {
    chapter: 7, title: 'Transportation',
    roles: [],
    purpose: [
      'You are the first face a client sees on the way in and the last on the way out, and a great deal of honest conversation happens in your vehicle that happens nowhere else.',
      'Getting someone to a court date, a doctor, or their first day of treatment on time is not a logistics task. It is the difference between a plan that holds and a plan that falls apart. When a client is in your vehicle, they are in your care. You carry people, not cargo.',
    ],
    serve: {
      outside: 'Clients, families, courts, providers, referral partners.',
      inside: 'Case management, admissions, nursing, clinical team, leadership.',
    },
    looks: [
      'On time, every time. A missed ride can mean a missed court date or a lost bed.',
      'Treats every client in the vehicle with dignity and respect.',
      'Drives safely and professionally with people in their care.',
      'Keeps the vehicle clean and welcoming.',
      'Communicates delays early so the team can adjust.',
      'Understands that the ride is part of the client’s care, not separate from it.',
    ],
    daily: [
      'Confirm the day’s transports and plan routes to arrive on time.',
      'Communicate any delay to case management or the team immediately.',
      'Maintain a safe, clean, well-kept vehicle.',
      'Treat clients with warmth and respect for the whole trip.',
      'Follow all safety, licensing, and confidentiality requirements.',
      'Never leave a client stranded or drop them somewhere unsafe.',
    ],
    not: [
      'Showing up late to something that cannot be rescheduled.',
      'Treating clients as cargo instead of people.',
      'A dirty, unsafe, or poorly maintained vehicle.',
      'Dropping a client somewhere inappropriate or unsafe.',
      'Failing to tell anyone when a ride falls through.',
    ],
    behaviors: ['Be on time.', 'Drive safely.', 'Respect every rider.', 'Keep the vehicle right.', 'Communicate early.', 'Follow through.', 'Protect confidentiality.', 'Represent Armada well.', 'Support the team’s schedule.', 'Take pride in the role.'],
    measures: [
      { k: 'Reliability', v: 'on-time rate; missed or late transports; advance communication of delays.' },
      { k: 'Safety',      v: 'driving record; vehicle condition; incident-free trips.' },
      { k: 'Experience',  v: 'client experience; complaint trends such as missed appointments.' },
      { k: 'Team',        v: 'reliability; coordination with case management.' },
    ],
    questions: [
      'Did everyone get where they needed to be, on time?',
      'Did every rider feel respected in my vehicle?',
      'Was my vehicle safe and clean?',
      'Did I communicate every delay early?',
    ],
    closing: 'When every transportation specialist practices this standard, no client misses a chance because Armada missed a ride.',
  },
  {
    chapter: 8, title: 'Environmental Services',
    roles: ['Housekeeping', 'Catering / Dietary'],
    purpose: [
      'A clean, cared-for space tells a client something no one has to say out loud: you are worth the effort. Many of our clients come from chaos and neglect.',
      'The environment you create may be the first place in a long time that feels safe, dignified, and cared for. You are not just cleaning a building. You are creating the physical proof that this is a place that respects the people in it.',
    ],
    serve: {
      outside: 'Clients, families, visitors, referral partners, through the impression the space makes.',
      inside: 'Nursing, clinical staff, admissions, every teammate who works in the space, leadership.',
    },
    looks: [
      'Keeps every space clean, safe, and dignified, not just presentable.',
      'Understands that cleanliness is infection control and safety, not only appearance.',
      'Takes pride in the environment as part of the client’s care.',
      'Notices and reports safety or maintenance issues.',
      'Respects clients’ space and privacy while doing the work.',
      'Treats the building as if the people in it are family.',
    ],
    daily: [
      'Clean and sanitize all areas to standard, on schedule.',
      'Follow infection-control and safety protocols exactly.',
      'Report maintenance, safety, or contraband concerns immediately.',
      'Respect client privacy and confidentiality while working.',
      'Restock and maintain supplies so the space is always ready.',
      'Take ownership of the whole environment, not just an assigned list.',
    ],
    not: [
      'Doing the minimum to look clean instead of actually being clean.',
      'Ignoring a safety or maintenance issue because it is “not my job.”',
      'Cutting corners on infection control.',
      'Disrupting or disrespecting clients while working around them.',
      'Treating the role as invisible instead of essential.',
    ],
    behaviors: ['Take pride.', 'Be thorough.', 'Follow protocol.', 'Notice problems.', 'Report early.', 'Respect privacy.', 'Own the whole space.', 'Support the team.', 'Represent Armada.', 'Hold a high standard.'],
    measures: [
      { k: 'Quality',    v: 'cleanliness and environment audits; infection-control compliance.' },
      { k: 'Safety',     v: 'hazard identification and reporting; incident prevention.' },
      { k: 'Experience', v: 'client and staff perception of the environment; complaint trends.' },
      { k: 'Team',       v: 'reliability; ownership; teamwork.' },
    ],
    questions: [
      'Is every space actually clean, not just presentable?',
      'Did I follow infection-control standards fully?',
      'Did I report anything unsafe I noticed?',
      'Would I be proud to have my own family stay in this space today?',
    ],
    closing: 'When every environmental services professional practices this standard, a client knows they are worth the effort before anyone says a word.',
  },
];

// Day-of-year rotation, so every building stresses the same principle on the same
// day and the ten principles cycle forever. dateStr: 'YYYY-MM-DD' (the app's day).
export function todaysPrinciple(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 864e5);
  return ARMADA_PRINCIPLES[doy % ARMADA_PRINCIPLES.length];
}
export function todaysSafety(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 864e5);
  return SAFETY_REMINDERS[doy % SAFETY_REMINDERS.length];
}
export function chapterForRole(jobRole) {
  if (!jobRole) return null;
  return HANDBOOK.find((c) => c.roles.includes(jobRole)) || null;
}
