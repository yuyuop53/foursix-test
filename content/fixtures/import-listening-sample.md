---
schema_version: "1.1"
exam:
  id: "exam_listening_import_sample"
  title: "CET-Lab 聽力匯入範例"
  year: 2026
  month: 11
  set: "import-sample"
  source: "user-entered"
  license: "private"
  content_version: "1.0.0"
  sections: ["listening"]
assets:
  - id: "aud_listening_import_sample_l1"
    kind: "audio"
    backend: "local"
    src: "audio/private/listening-import-sample/l1.mp3"
    accent: null
    wpm: null
    synthetic: false
    license: "private"
    duration_sec: 8.0
    segments:
      - index: 0
        start: 0.0
        end: 3.0
        text: "Volunteers helped clean the river last weekend."
      - index: 1
        start: 4.0
        end: 8.0
        text: "They wanted to protect the environment for the next generation."
  - id: "aud_listening_import_sample_l2"
    kind: "audio"
    backend: "local"
    src: "audio/private/listening-import-sample/l2.mp3"
    accent: null
    wpm: null
    synthetic: false
    license: "private"
    duration_sec: 8.0
    segments:
      - index: 0
        start: 0.0
        end: 3.0
        text: "I need to change our meeting time tomorrow."
      - index: 1
        start: 4.0
        end: 8.0
        text: "I will send you an email with the new schedule."
---

## News Report 1

```yaml passage
id: "psg_listening_import_sample_l1"
section: "listening"
order: 1
title: "News Report 1"
hot_topic_tags: ["unclassified"]
word_count: 17
audio_asset_id: "aud_listening_import_sample_l1"
accent: null
wpm: null
transcript: |
  Volunteers helped clean the river last weekend. They wanted to protect the environment for the next generation.
```

```json questions
[
  {
    "id": "q_listening_import_sample_l1_01",
    "passage_id": "psg_listening_import_sample_l1",
    "section": "listening",
    "type": "listening_detail",
    "stem": "What did the volunteers do?",
    "options": [
      { "key": "A", "text": "They cleaned the river." },
      { "key": "B", "text": "They opened a library." },
      { "key": "C", "text": "They moved offices." },
      { "key": "D", "text": "They cancelled a meeting." }
    ],
    "answer": "A",
    "explanation": "第一句提到 volunteers helped clean the river。",
    "evidence": [{ "segment": 0 }],
    "knowledge_tags": ["listening_detail"],
    "error_cause_tags": ["locating"],
    "hot_topic_tags": ["unclassified"],
    "difficulty": 2,
    "generated": true
  },
  {
    "id": "q_listening_import_sample_l1_02",
    "passage_id": "psg_listening_import_sample_l1",
    "section": "listening",
    "type": "listening_inference",
    "stem": "What can be inferred about the volunteers?",
    "options": [
      { "key": "A", "text": "They were paid for their work." },
      { "key": "B", "text": "They cared about the environment." },
      { "key": "C", "text": "They came from another country." },
      { "key": "D", "text": "They stopped after one day." }
    ],
    "answer": "B",
    "explanation": "他們想保護環境，可推論他們關心環境。",
    "evidence": [{ "segment": 1 }],
    "knowledge_tags": ["listening_inference"],
    "error_cause_tags": ["inference"],
    "hot_topic_tags": ["unclassified"],
    "difficulty": 3,
    "generated": true
  }
]
```

## Conversation 1

```yaml passage
id: "psg_listening_import_sample_l2"
section: "listening"
order: 2
title: "Conversation 1"
hot_topic_tags: ["unclassified"]
word_count: 18
audio_asset_id: "aud_listening_import_sample_l2"
accent: null
wpm: null
transcript: |
  I need to change our meeting time tomorrow. I will send you an email with the new schedule.
```

```json questions
[
  {
    "id": "q_listening_import_sample_l2_01",
    "passage_id": "psg_listening_import_sample_l2",
    "section": "listening",
    "type": "listening_detail",
    "stem": "Why does the speaker need to talk?",
    "options": [
      { "key": "A", "text": "To ask about a course." },
      { "key": "B", "text": "To borrow a book." },
      { "key": "C", "text": "To change a meeting time." },
      { "key": "D", "text": "To report a problem." }
    ],
    "answer": "C",
    "explanation": "第一句說要 change our meeting time。",
    "evidence": [{ "segment": 0 }],
    "knowledge_tags": ["listening_detail"],
    "error_cause_tags": ["locating"],
    "hot_topic_tags": ["unclassified"],
    "difficulty": 2,
    "generated": true
  },
  {
    "id": "q_listening_import_sample_l2_02",
    "passage_id": "psg_listening_import_sample_l2",
    "section": "listening",
    "type": "listening_detail",
    "stem": "What will the speaker do next?",
    "options": [
      { "key": "A", "text": "Send an email." },
      { "key": "B", "text": "Call back." },
      { "key": "C", "text": "Visit the office." },
      { "key": "D", "text": "Cancel the meeting." }
    ],
    "answer": "A",
    "explanation": "第二句說會 send you an email。",
    "evidence": [{ "segment": 1 }],
    "knowledge_tags": ["listening_detail"],
    "error_cause_tags": ["locating"],
    "hot_topic_tags": ["unclassified"],
    "difficulty": 2,
    "generated": true
  }
]
```
