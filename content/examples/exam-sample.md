---
schema_version: "1.0"
exam:
  id: exam_sample_2026_11
  title: "CET-Lab 範例閱讀（原創）"
  year: 2026
  month: 11
  set: sample
  source: original
  license: CC0-1.0
  content_version: "1.0.0"
  sections: [reading]
assets: []
---

## Passage 1

```yaml passage
id: psg_exam_sample_2026_11_r1
section: reading
order: 1
title: "Generative AI in the Classroom"
hot_topic_tags: [ai_ethics, education_technology]
word_count: 229
```

When generative AI tools first appeared in university classrooms, many instructors treated them as a shortcut for lazy students. Two years later, the conversation has changed. A growing number of teachers now ask students to use these tools openly, provided that they explain how the tools were used and what they contributed.

Supporters argue that banning AI is both impractical and unfair. Students who can afford private tutoring already have advantages; a free writing assistant may narrow that gap. In a recent survey of 1,200 undergraduates, 64 percent said that AI helped them organize their ideas, while only 18 percent admitted to copying entire paragraphs without revision. The difference matters: using AI to brainstorm is not the same as letting it write for you.

Critics remain unconvinced. They point out that the line between assistance and replacement is easy to cross, especially when deadlines are tight. More importantly, the skills that writing develops — patience, judgment, and the ability to notice when an argument is weak — cannot be outsourced. A student who never struggles with a difficult paragraph may never learn how to fix one.

The most promising approach may be neither celebration nor prohibition, but transparency. When teachers design assignments that require students to document their process, the focus shifts from the final product to the thinking behind it. AI then becomes a mirror rather than a mask.

```json questions
[
  {
    "id": "q_exam_sample_2026_11_r1_01",
    "passage_id": "psg_exam_sample_2026_11_r1",
    "section": "reading",
    "type": "detail",
    "stem": "Which statement about the survey is supported by the passage?",
    "options": [
      { "key": "A", "text": "Most respondents said AI helped them organize their ideas." },
      { "key": "B", "text": "Most respondents admitted to copying entire paragraphs." },
      { "key": "C", "text": "AI made students less willing to revise their work." },
      { "key": "D", "text": "The survey included 12,000 undergraduates." }
    ],
    "answer": "A",
    "explanation": "第二段指出 1,200 名受訪者中有 64% 表示 AI 幫助他們組織想法，只有 18% 承認未經修改就複製整段文字。",
    "evidence": [
      {
        "paragraph": 2,
        "sentence": 3,
        "quote": "64 percent said that AI helped them organize their ideas, while only 18 percent admitted to copying entire paragraphs without revision."
      }
    ],
    "knowledge_tags": ["detail"],
    "error_cause_tags": ["locating", "carelessness"],
    "hot_topic_tags": ["ai_ethics", "education_technology"],
    "difficulty": 2
  },
  {
    "id": "q_exam_sample_2026_11_r1_02",
    "passage_id": "psg_exam_sample_2026_11_r1",
    "section": "reading",
    "type": "inference",
    "stem": "What can be inferred about the critics' view of AI in writing?",
    "options": [
      { "key": "A", "text": "AI helps students become more patient writers." },
      { "key": "B", "text": "AI may prevent students from developing essential writing skills." },
      { "key": "C", "text": "AI should be banned in every university course." },
      { "key": "D", "text": "AI is only useful for brainstorming ideas." }
    ],
    "answer": "B",
    "explanation": "第三段說明寫作培養的耐心、判斷力與辨識弱論點的能力無法外包；不願面對困難段落的學生可能永遠學不會修改。",
    "evidence": [
      {
        "paragraph": 3,
        "sentence": 3,
        "quote": "the skills that writing develops — patience, judgment, and the ability to notice when an argument is weak — cannot be outsourced."
      },
      {
        "paragraph": 3,
        "sentence": 4,
        "quote": "A student who never struggles with a difficult paragraph may never learn how to fix one."
      }
    ],
    "knowledge_tags": ["inference"],
    "error_cause_tags": ["inference"],
    "hot_topic_tags": ["ai_ethics", "education_technology"],
    "difficulty": 3
  },
  {
    "id": "q_exam_sample_2026_11_r1_03",
    "passage_id": "psg_exam_sample_2026_11_r1",
    "section": "reading",
    "type": "attitude",
    "stem": "What is the author's attitude toward using AI in the classroom?",
    "options": [
      { "key": "A", "text": "Enthusiastic support without reservations." },
      { "key": "B", "text": "Complete rejection of any classroom use." },
      { "key": "C", "text": "Cautious acceptance, provided that the process is transparent." },
      { "key": "D", "text": "Indifference to the debate." }
    ],
    "answer": "C",
    "explanation": "作者認為既不是慶祝也不是禁止，而是透明：要求學生記錄使用過程，讓 AI 成為鏡子而非面具。",
    "evidence": [
      {
        "paragraph": 4,
        "sentence": 1,
        "quote": "The most promising approach may be neither celebration nor prohibition, but transparency."
      },
      {
        "paragraph": 4,
        "sentence": 3,
        "quote": "AI then becomes a mirror rather than a mask."
      }
    ],
    "knowledge_tags": ["attitude"],
    "error_cause_tags": ["inference"],
    "hot_topic_tags": ["ai_ethics", "education_technology"],
    "difficulty": 3
  }
]
```
