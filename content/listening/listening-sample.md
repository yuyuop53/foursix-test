---
schema_version: "1.1"
exam:
  id: exam_listening_sample_2026_11
  title: "CET-Lab 聽力範例（TTS 原創）"
  year: 2026
  month: 11
  set: listening
  source: original
  license: CC0-1.0
  content_version: "1.0.0"
  sections: [listening]
assets:
  - id: aud_listening_sample_2026_11_l1
    kind: audio
    backend: tts
    src: "browser-speech"
    accent: us
    wpm: 145
    synthetic: true
    license: "TTS-generated"
    segments:
      - index: 0
        text: "Good morning, everyone."
        textZh: "各位早安。"
      - index: 1
        text: "Today I want to talk about how small changes in study habits can make a big difference."
        textZh: "今天我想談談學習習慣的小改變如何帶來大不同。"
      - index: 2
        text: "Many students believe that studying for hours without a break is the best way to learn."
        textZh: "許多學生認為長時間不休息地學習是最好的學習方式。"
      - index: 3
        text: "However, research suggests that short, regular breaks actually help the brain remember information."
        textZh: "然而研究顯示，短暫而規律的休息其實能幫助大腦記住資訊。"
      - index: 4
        text: "When you study for too long, your attention drops and you may start to notice less."
        textZh: "當你學習太久，注意力會下降，可能開始注意不到細節。"
      - index: 5
        text: "Another common problem is multitasking."
        textZh: "另一個常見問題是多工。"
      - index: 6
        text: "Switching between tasks makes it harder to focus deeply."
        textZh: "在不同任務間切換會讓你更難深度專注。"
      - index: 7
        text: "Digital tools can be helpful, but only if you use them with a clear purpose."
        textZh: "數位工具可能很有幫助，但前提是你有明確目的。"
      - index: 8
        text: "So the next time you sit down to study, try working in focused blocks and taking a short walk in between."
        textZh: "所以下次坐下來讀書時，試試用專注時段工作，中間短暫散步。"
---

## Passage 1

```yaml passage
id: psg_listening_sample_2026_11_l1
section: listening
order: 1
title: "A Short Talk About Study Habits"
hot_topic_tags: [education_technology, mental_health]
word_count: 115
audio_asset_id: aud_listening_sample_2026_11_l1
accent: us
wpm: 145
transcript: |
  Good morning, everyone. Today I want to talk about how small changes in study habits can make a big difference. Many students believe that studying for hours without a break is the best way to learn. However, research suggests that short, regular breaks actually help the brain remember information. When you study for too long, your attention drops and you may start to notice less. Another common problem is multitasking. Switching between tasks makes it harder to focus deeply. Digital tools can be helpful, but only if you use them with a clear purpose. So the next time you sit down to study, try working in focused blocks and taking a short walk in between.
transcript_zh: |
  各位早安。今天我想談談學習習慣的小改變如何帶來大不同。許多學生認為長時間不休息地學習是最好的學習方式。然而研究顯示，短暫而規律的休息其實能幫助大腦記住資訊。當你學習太久，注意力會下降，可能開始注意不到細節。另一個常見問題是多工。在不同任務間切換會讓你更難深度專注。數位工具可能很有幫助，但前提是你有明確目的。所以下次坐下來讀書時，試試用專注時段工作，中間短暫散步。
```

```json questions
[
  {
    "id": "q_listening_sample_2026_11_l1_01",
    "passage_id": "psg_listening_sample_2026_11_l1",
    "section": "listening",
    "type": "listening_detail",
    "stem": "What does the speaker say about short breaks?",
    "options": [
      { "key": "A", "text": "They waste valuable study time." },
      { "key": "B", "text": "They help the brain remember information." },
      { "key": "C", "text": "They should be avoided before exams." },
      { "key": "D", "text": "They only work for some students." }
    ],
    "answer": "B",
    "explanation": "講者引用研究指出，短暫而規律的休息能幫助大腦記住資訊。",
    "evidence": [{ "segment": 3 }],
    "knowledge_tags": ["listening_detail"],
    "error_cause_tags": ["lexical"],
    "hot_topic_tags": ["education_technology", "mental_health"],
    "difficulty": 2
  },
  {
    "id": "q_listening_sample_2026_11_l1_02",
    "passage_id": "psg_listening_sample_2026_11_l1",
    "section": "listening",
    "type": "listening_inference",
    "stem": "What can be inferred about multitasking?",
    "options": [
      { "key": "A", "text": "It improves study efficiency." },
      { "key": "B", "text": "It is necessary for deep learning." },
      { "key": "C", "text": "It makes deep focus harder." },
      { "key": "D", "text": "It helps the brain remember information." }
    ],
    "answer": "C",
    "explanation": "講者說在不同任務間切換會更難深度專注，因此可推論多工會妨礙專注。",
    "evidence": [{ "segment": 6 }],
    "knowledge_tags": ["listening_inference"],
    "error_cause_tags": ["inference"],
    "hot_topic_tags": ["education_technology", "mental_health"],
    "difficulty": 3
  },
  {
    "id": "q_listening_sample_2026_11_l1_03",
    "passage_id": "psg_listening_sample_2026_11_l1",
    "section": "listening",
    "type": "listening_attitude",
    "stem": "What is the speaker's attitude toward digital tools?",
    "options": [
      { "key": "A", "text": "They are always harmful." },
      { "key": "B", "text": "They are useful when used with a clear purpose." },
      { "key": "C", "text": "They are the best way to study." },
      { "key": "D", "text": "They are not worth using." }
    ],
    "answer": "B",
    "explanation": "講者認為數位工具有幫助，但前提是有明確目的，屬於有條件的正面態度。",
    "evidence": [{ "segment": 7 }],
    "knowledge_tags": ["listening_attitude"],
    "error_cause_tags": ["inference"],
    "hot_topic_tags": ["education_technology", "mental_health"],
    "difficulty": 2
  }
]
```
