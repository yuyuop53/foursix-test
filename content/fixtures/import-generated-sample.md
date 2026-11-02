---
schema_version: "1.1"
exam:
  id: exam_import_sample
  title: "CET-Lab 匯入範例"
  year: 2026
  month: 11
  set: import-sample
  source: user-entered
  license: private
  content_version: "1.0.0"
  sections: [reading]
assets: []
---

## Passage 1

```yaml passage
id: psg_exam_import_sample_r1
section: reading
subtype: careful_reading
order: 1
title: "Remote Work and Teams"
hot_topic_tags: [remote_work]
word_count: 17
```

Remote work has changed how teams communicate. Some employees enjoy the flexibility, while others miss the office.

```json questions
[
  {
    "id": "q_exam_import_sample_r1_01",
    "passage_id": "psg_exam_import_sample_r1",
    "section": "reading",
    "type": "detail",
    "stem": "What is mentioned about remote work?",
    "options": [
      { "key": "A", "text": "It changed how teams communicate." },
      { "key": "B", "text": "It reduced office costs." },
      { "key": "C", "text": "It is popular with everyone." },
      { "key": "D", "text": "It has no disadvantages." }
    ],
    "answer": "A",
    "explanation": "文章第一句指出遠距工作改變了團隊溝通方式。",
    "evidence": [
      {
        "paragraph": 1,
        "sentence": 1,
        "quote": "Remote work has changed how teams communicate."
      }
    ],
    "knowledge_tags": ["detail"],
    "error_cause_tags": ["locating"],
    "hot_topic_tags": ["remote_work"],
    "difficulty": 2
  }
]
```

## Passage 2

```yaml passage
id: psg_exam_import_sample_r2
section: reading
subtype: banked_cloze
order: 2
title: "Study Habits"
hot_topic_tags: [mental_health]
word_count: 13
word_bank:
  - { key: A, text: "help" }
  - { key: B, text: "focus" }
  - { key: C, text: "reduce" }
  - { key: D, text: "ignore" }
  - { key: E, text: "explain" }
```

Short breaks can [[1]] the brain remember information. Multitasking makes it harder to [[2]] deeply.

```json questions
[
  {
    "id": "q_exam_import_sample_r2_01",
    "passage_id": "psg_exam_import_sample_r2",
    "section": "reading",
    "type": "banked_cloze",
    "blank_index": 1,
    "stem": "Blank 1",
    "answer": "A",
    "explanation": "help the brain remember 表示「幫助大腦記憶」。",
    "evidence": [
      {
        "paragraph": 1,
        "sentence": 1,
        "quote": "Short breaks can help the brain remember information."
      }
    ],
    "knowledge_tags": ["vocabulary_in_context"],
    "error_cause_tags": ["lexical"],
    "hot_topic_tags": ["mental_health"],
    "difficulty": 2
  },
  {
    "id": "q_exam_import_sample_r2_02",
    "passage_id": "psg_exam_import_sample_r2",
    "section": "reading",
    "type": "banked_cloze",
    "blank_index": 2,
    "stem": "Blank 2",
    "answer": "B",
    "explanation": "focus deeply 表示「深度專注」。",
    "evidence": [
      {
        "paragraph": 1,
        "sentence": 2,
        "quote": "Multitasking makes it harder to focus deeply."
      }
    ],
    "knowledge_tags": ["vocabulary_in_context"],
    "error_cause_tags": ["lexical"],
    "hot_topic_tags": ["mental_health"],
    "difficulty": 2
  }
]
```
