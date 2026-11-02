import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';

const ROOT = path.resolve('content/exams');

const countWords = (text) =>
  (text.replace(/\[\[\d+\]\]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [])
    .length;
const paragraphsOf = (body) =>
  body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const countSentences = (text) =>
  (text.match(/[.!?](?=\s|$)/g) ?? []).length;
const splitTranscript = (text) =>
  text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

function segmentIndex(transcript, phrase) {
  const segments = splitTranscript(transcript);
  const index = segments.findIndex((s) => s.includes(phrase));
  if (index < 0) throw new Error(`找不到听力证据句：${phrase}`);
  return index;
}

function assertEvidence(body, questions) {
  const paragraphs = paragraphsOf(body);
  const sentenceCounts = paragraphs.map(countSentences);
  for (const q of questions) {
    for (const e of q.evidence) {
      if (e.paragraph === undefined) continue;
      if (e.paragraph > paragraphs.length) {
        throw new Error(`${q.id}: paragraph ${e.paragraph} > ${paragraphs.length}`);
      }
      if (
        e.sentence !== undefined &&
        e.sentence > (sentenceCounts[e.paragraph - 1] ?? 0)
      ) {
        throw new Error(
          `${q.id}: sentence ${e.sentence} > ${sentenceCounts[e.paragraph - 1]} in paragraph ${e.paragraph}`,
        );
      }
    }
  }
}

function renderExam({ exam, assets, passages }) {
  const lines = [];
  lines.push('---');
  lines.push(yamlStringify({ schema_version: '1.0', exam, assets }).trimEnd());
  lines.push('---', '');

  const bundlePassages = [];
  const bundleQuestions = [];

  passages.forEach((passage, index) => {
    const body = (passage.body ?? '').trim();
    const transcript = passage.meta.transcript ?? null;
    const countSource = body || transcript || '';
    const wordCount = countWords(countSource);
    const meta = { ...passage.meta, word_count: wordCount };

    if (body) assertEvidence(body, passage.questions);

    lines.push(`## Passage ${index + 1}`, '');
    lines.push('```yaml passage');
    lines.push(yamlStringify(meta).trimEnd());
    lines.push('```', '');
    if (body) lines.push(body, '');

    const questions = passage.questions.map((q) => ({
      passage_id: meta.id,
      section: meta.section,
      ...q,
    }));

    lines.push('```json questions');
    lines.push(JSON.stringify(questions, null, 2));
    lines.push('```', '');

    bundlePassages.push({
      ...meta,
      exam_id: exam.id,
      body_md: body || transcript || '',
      word_count: wordCount,
    });
    for (const q of questions) {
      bundleQuestions.push({ exam_id: exam.id, ...q });
    }
  });

  return {
    md: lines.join('\n'),
    bundle: {
      schema_version: '1.0',
      exam,
      passages: bundlePassages,
      questions: bundleQuestions,
      assets,
    },
  };
}

function writeExam(dirName, data) {
  const { md, bundle } = renderExam(data);
  const dir = path.join(ROOT, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'exam.md'), md);
  writeFileSync(path.join(dir, 'exam.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`wrote ${dirName}: ${bundle.questions.length} questions`);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const readingExam = {
  id: 'exam_2025-06_set2',
  title: '2025 年 6 月大学英语四级真题（第二套）',
  year: 2025,
  month: 6,
  set: 'set2',
  source: 'user-entered',
  license: 'private',
  content_version: '1.0.0',
  sections: ['reading'],
};

const clozeBody = `Sir Alfred Hitchcock was an English movie director and producer. Famously [[1]] to as "The Master of Suspense", Hitchcock is one of the most influential filmmakers in the history of [[2]]. He was an extraordinary director who entertained his audience with [[3]] and gripping suspense movies.

His fascination with crime began at an early age when he was [[4]] by his father who made him spend a few minutes inside a prison for his misconduct. Hence, his movies are [[5]] of the guilt and innocence of the wrongdoer and the victim. He had a gift for creating stories that consisted of deceit, robbery, murder, corruption, and other criminal [[6]] with incredible plot twists in the storyline. The principal characters in his movies were often ordinary people [[7]] in unwanted and unavoidable situations.

He was [[8]] productive and his amazing body of work is considered fascinating by the critics. Most of his movies have [[9]] the test of time and are considered to be masterpieces. He is also remembered by other filmmakers, for he continues to inspire them to be passionate about their work. He is also [[10]] by people around the world for his entertaining and exciting stories.`;

const clozeQuestions = [
  ['J', 'be referred to as 是固定搭配，意为“被称为”；Famously referred to as “The Master of Suspense” 表示“被誉为‘悬念大师’”。', 1, 2, 2],
  ['B', 'in the history of cinema 表示“在电影史上”；上文出现 movie director 和 filmmakers，提示此处指电影业。', 1, 2, 2],
  ['C', 'engaging 意为“引人入胜的”；与并列的 gripping（扣人心弦的）共同修饰 suspense movies，感情色彩一致。', 1, 3, 3],
  ['I', 'he was punished by his father 构成被动语态；下文“父亲让他在监狱里待了几分钟”提示是“惩罚”。', 2, 1, 2],
  ['L', 'be symbolic of 是固定搭配，意为“象征……”。句意：他的电影充满对罪犯与受害者罪与无辜的象征意味。', 2, 2, 3],
  ['H', 'criminal offences 意为“刑事犯罪”，与前面的 deceit, robbery, murder, corruption 并列。', 2, 3, 2],
  ['A', 'be caught in 意为“陷入”；ordinary people caught in unwanted and unavoidable situations 指“陷入身不由己境地的普通人”。', 2, 4, 3],
  ['E', 'highly productive 意为“非常高产”；highly 修饰形容词 productive。', 3, 1, 2],
  ['K', 'stand the test of time 是固定搭配，意为“经受住时间的考验”；have stood 构成现在完成时。', 3, 2, 2],
  ['O', 'be worshipped by 意为“被……崇拜/敬仰”；与前面的 remembered, inspire 一致，强调希区柯克的影响。', 3, 4, 2],
].map(([answer, explanation, paragraph, sentence, difficulty], i) => ({
  id: `q_exam_2025-06_set2_cloze_${26 + i}`,
  type: 'banked_cloze',
  blank_index: i + 1,
  stem: `Blank ${i + 1}`,
  answer,
  explanation,
  evidence: [{ paragraph, sentence }],
  knowledge_tags: ['vocabulary_in_context'],
  error_cause_tags: ['lexical'],
  hot_topic_tags: ['unclassified'],
  difficulty,
}));

const clozeWordBank = [
  ['A', 'caught'], ['B', 'cinema'], ['C', 'engaging'], ['D', 'graphically'],
  ['E', 'highly'], ['F', 'incentive'], ['G', 'instincts'], ['H', 'offences'],
  ['I', 'punished'], ['J', 'referred'], ['K', 'stood'], ['L', 'symbolic'],
  ['M', 'tuned'], ['N', 'visually'], ['O', 'worshipped'],
].map(([key, text]) => ({ key, text }));

const matchBody = `A) Freshly juiced fruit has become a basic dietary item—especially for busy, health-conscious consumers who can save time on making (and perhaps even chewing) their food without missing out on nutrients. Fruit juice also has been linked to claims that it can help you both lose weight and stay healthy. All of which, of course, has made it highly profitable. The global fruit and vegetable juices market was valued at $154 billion in 2016 and is expected to grow.

B) But is juicing really as healthy as we think? Most foods containing fructose—a naturally occurring sugar found in all fruits and fruit juices—don't seem to have harmful effects as long as they're not contributing to excess daily calories. This is because the fibre found in whole fruits is intact, and the sugar is contained within the fruit's cells. It takes our digestive system a while to break these cells down and for fructose to enter the bloodstream.

C) But this is not the case with fruit juice. Unlike whole fruit, fruit juice has most of the fibre removed. This is why the fructose in fruit juices counts as 'free sugars'—which also include honey and the sugars added to foods. It's recommended by the World Health Organisation that adults have no more than 30g of added sugar, the equivalent of 150ml of fruit juice, per day. The problem is that, with the fibre removed, fruit juice's fructose is absorbed more quickly. Sudden increases in blood sugar cause the release of insulin (胰岛素) to bring it back down to a stable level. Over time, this mechanism can wear out, increasing the risk of developing type 2 diabetes. In 2013, researchers analysed the health data of 100,000 people collected between 1986 and 2009 and found that fruit juice consumption was linked with increased risk of type 2 diabetes. Another study found a relationship between fruit juice and type 2 diabetes after following the diets and diabetes status of more than 70,000 nurses over 18 years. The researchers explain that the possible reason for this may partly have been the lack of the other components found in whole fruit, like fibre.

D) Juices containing vegetables can provide more nutrients and less sugar than juices made up of just fruit—but they still lack valuable fibre. Diets high in fibre have been linked to a lower risk of developing heart disease, stroke, high blood pressure and diabetes, and it's recommended adults consume 30g per day.

E) Aside from the link to type 2 diabetes, many studies agree that fruit juice is harmful if it contributes to an excess in calories. In an analysis of 155 studies, John Sievenpiper, associate professor at the University of Toronto's Department of Nutritional Sciences, set out to understand if the associations between sugary soft drinks and health—including risk of diabetes and heart disease—were applicable to the food and drink we generally consume as part of a healthy diet. He compared studies looking into the effects of fructose-containing sugars with control diets free from or lower in these sugars. His aim? To isolate the effects of consuming too many calories from the effects of foods containing different sugars.

F) He found negative effects on blood sugar and insulin levels when food provided excess calories from sugars, including fruit juice. However, when the calories weren't in excess overall, there were some advantages to consuming whole fruit—and even fruit juice. Sievenpiper concludes that the recommended 150ml of fruit juice per day, which is an average serving, is reasonable. The paper concluded that foods containing fructose may have some small benefits for long-term blood sugar control when they don't lead to over-consumption of calories. But when they do lead to too many calories, they risk raising blood sugar and insulin levels.

G) So while we know that fruit juice can cause diabetes if it's part of a diet that has more calories overall, it's less clear how juice affects the long-term health of those who aren't overweight. But we have a higher risk of consuming more than the recommended daily number of calories (around 2,000 for women and 2,500 for men) on the days we drink juice, according to research. Numerous studies have shown that drinking fruit juice doesn't make us consume any less of other foods throughout the day.

H) As it is easy to consume large amounts of fruit juice quite quickly, extra calories are taken in. And extra calories can contribute to weight gain. One way we can improve the effects of fruit juice on our health is making sure we select ripe fruit to retain as much of its goodness as possible, according to Roger Clemens, professor of pharmaceutical sciences at the University of Southern California.

I) Another reason for fruit juice's recent popularity is the argument that it can help to remove poisonous or harmful substances from the body. However, 'the whole concept of a juice diet helping to remove poisonous or harmful substances from the body is completely false,' says Clemens. 'We consume compounds every day that may be poisonous and our bodies do a wonderful job of removing and eliminating anything harmful from our bodies.'

J) And juice isn't a cure-all for getting your nutrients, either. 'There are a lot of nutrients contained in the parts of the fruits, such as in apple skins, that are excluded when you juice them,' says Heather Ferris, a professor of medicine. 'You end up with sugary water with some vitamins.'

K) Plus, she adds, it's not an ideal way to reach the advised 'five a day'. 'People try to get five servings of fruit and vegetables per day and don't realise this isn't just about getting vitamins,' she says. 'It's also about reducing the amount of grain carbs (碳水化合物) and protein and fats in our diet, and increasing fibre.'

So while fruit juice is better than no fruit at all, there are limits. It particularly comes with risks when we consume more than 150ml of free sugars per day, or when it puts us over our recommended calorie intake. It provides us with vitamins—but fruit juice is far from a quick fix.`;

const matchOptions = 'ABCDEFGHIJK'
  .split('')
  .map((key) => ({ key, text: `第 ${key} 段` }));

const matchQuestions = [
  ['36', 'Fruit juice is different from whole fruit in that it contains much less fibre.', 'C', 'C 段第二句指出，与完整水果不同，果汁中的大部分纤维已被去除，因此含有的纤维少得多。', 3, 2, 2],
  ['37', 'Some people believe a juice diet helps to rid our body of harmful or poisonous substances.', 'I', 'I 段第一句提到，果汁近来受欢迎的一个原因是有人认为它有助于清除体内有毒或有害物质。', 9, 1, 2],
  ['38', 'A lot of research comes to the same conclusion that fruit juice does harm to the human body when it leads to surplus calories.', 'E', 'E 段第一句指出，除了与 2 型糖尿病的关联外，许多研究一致认为，如果果汁导致热量过剩，它就是有害的。', 5, 1, 3],
  ['39', 'The claimed health benefits of fruit and vegetable juices have rendered the industry very profitable.', 'A', 'A 段最后两句提到，鲜榨果汁与减肥、保持健康的说法相关，这使其利润丰厚；2016 年全球果蔬汁市场价值 1540 亿美元。', 1, 3, 2],
  ['40', "To increase the benefits of fruit juice to our health, we'd better choose ripe fruit to make juice.", 'H', 'H 段最后一句引用 Roger Clemens 的话：确保选择成熟水果榨汁，以尽可能保留其营养价值。', 8, 3, 2],
  ['41', 'Diets containing large amounts of fibre reduce the risk of heart disease, diabetes and other health hazards.', 'D', 'D 段第二句指出，高纤维饮食与降低心脏病、中风、高血压和糖尿病风险相关。', 4, 2, 2],
  ['42', 'According to a research paper, drinking fruit juice is beneficial on condition that it is consumed in reasonable amounts.', 'F', 'F 段第四句指出，论文结论认为，在不过量摄入热量的情况下，含果糖食物对长期血糖控制可能有一些小益处。', 6, 4, 3],
  ['43', 'One expert claims that juicing wastes a lot of nutrients contained in fruits.', 'J', 'J 段第二句引用 Heather Ferris 的话：水果的某些部分（如苹果皮）含有大量营养，但榨汁时会被排除。', 10, 2, 2],
  ["44", "It takes some time for fruit's cells to be digested and for fructose to be absorbed.", 'B', 'B 段最后一句说明，消化系统需要一段时间分解水果细胞，果糖才能进入血液。', 2, 4, 3],
  ['45', 'A lot of research has demonstrated that drinking fruit juice does not reduce our daily consumption of other foods.', 'G', 'G 段最后一句指出，大量研究表明，喝果汁并不会减少我们全天对其他食物的摄入。', 7, 3, 2],
].map(([num, stem, answer, explanation, paragraph, sentence, difficulty]) => ({
  id: `q_exam_2025-06_set2_match_${num}`,
  type: 'text_structure',
  stem,
  options: matchOptions,
  answer,
  explanation,
  evidence: [{ paragraph, sentence }],
  knowledge_tags: ['text_structure'],
  error_cause_tags: ['locating'],
  hot_topic_tags: ['public_health'],
  difficulty,
}));

const passageOneBody = `We all take a little extra effort to look nice for special occasions. But most of us have conflicting feelings about dressing up and feel guilty about taking the time to focus on clothes. Science now suggests the right dress may give ourselves the extra edge in our professional and personal lives.

We hear sayings like “dress for the job you want; not the job you have”. Most people don't really believe in them, but research into the impact of clothes on behavior now suggests that there may actually be a grain of truth in these sayings. Science says that the clothes we wear affect our behavior, our mood and even the way we interact with others because of the symbolic meaning that we assign to different types of clothing.

We consider some clothes to be powerful, some to be fun, and so on. We even evaluate people whom we have just met based on their clothes. We also evaluate ourselves based on what we are wearing because of the way they make us feel. This means that the experience of wearing something affects our attitudes and our choice of behavior.

There's a reason tailored jackets are associated with being 'dressed for success'. It seems that wearing formal office wear puts us in the right frame of mind to conduct business. Wearing power clothing makes us feel more confident and even increases hormones needed for displaying dominance. This in turn helps us become better negotiators and abstract thinkers.

While a good suit works wonders for our performance in the boardroom, wearing formal wear isn't a great idea when we want to socialize. Studies have found that people tend to be less open and less able to relax when they wear formal clothes.

On the other hand, a casual dress helps us become more friendly and creative. These findings support the idea of wearing business casuals on a Friday; since colleagues are most likely to take out time to socialize on the last work day of the week. I mean, who wants to hang out with people in their suits?`;

const passageOneQuestions = [
  {
    id: 'q_exam_2025-06_set2_r1_46',
    type: 'detail',
    stem: 'What does science suggest the right dress may do?',
    options: [
      { key: 'A', text: 'Add to our advantage in work and life.' },
      { key: 'B', text: 'Enable us to look a lot more attractive.' },
      { key: 'C', text: 'Help us to enjoy a fuller personal life.' },
      { key: 'D', text: 'Provide extra energy for what we do.' },
    ],
    answer: 'A',
    explanation: '第一段最后一句指出，科学表明得体的着装可能让我们在职业和个人生活中获得额外优势；A 项“为工作和生活增添优势”正是 extra edge 的同义转述。B、C、D 均未在文中提及。',
    evidence: [{ paragraph: 1, sentence: 3, quote: 'Science now suggests the right dress may give ourselves the extra edge in our professional and personal lives.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'lexical'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r1_47',
    type: 'detail',
    stem: 'Why does science say the clothes one wears may affect their interaction with others?',
    options: [
      { key: 'A', text: "Clothes usually represent one's social and economic status." },
      { key: 'B', text: "Clothes largely determine one's likability by people around." },
      { key: 'C', text: 'Different types of clothing markedly reflect different personalities.' },
      { key: 'D', text: 'Different types of clothing convey different messages symbolically.' },
    ],
    answer: 'D',
    explanation: '第二段最后一句说明，衣服会影响我们的行为、情绪以及与他人的互动，原因在于我们赋予不同服装的象征意义；D 项“不同类型的服装象征性地传递不同信息”与原文一致。',
    evidence: [{ paragraph: 2, sentence: 3, quote: 'Science says that the clothes we wear affect our behavior, our mood and even the way we interact with others because of the symbolic meaning that we assign to different types of clothing.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'lexical'],
    hot_topic_tags: ['unclassified'],
    difficulty: 3,
  },
  {
    id: 'q_exam_2025-06_set2_r1_48',
    type: 'detail',
    stem: 'How do the clothes we wear sway our evaluation of ourselves?',
    options: [
      { key: 'A', text: 'By exerting an effect on our power of judgment.' },
      { key: 'B', text: 'By impacting how we feel about ourselves.' },
      { key: 'C', text: 'By affecting what we take as the basis for assessment.' },
      { key: 'D', text: 'By influencing our interpretation of symbolic messages.' },
    ],
    answer: 'B',
    explanation: '第三段指出，我们也会根据穿着来评价自己，因为衣服让我们产生某种感受；B 项“通过影响我们对自己的感受”准确对应 the way they make us feel。A、C、D 均属过度推断。',
    evidence: [{ paragraph: 3, sentence: 3, quote: 'We also evaluate ourselves based on what we are wearing because of the way they make us feel.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'inference'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r1_49',
    type: 'detail',
    stem: "Why does the author say tailored jackets are associated with being 'dressed for success'?",
    options: [
      { key: 'A', text: 'They are necessary for formal business dealings.' },
      { key: 'B', text: 'They may help people concentrate on their business.' },
      { key: 'C', text: 'They are vital to keeping a dominant position in business transactions.' },
      { key: 'D', text: 'They may enable people to have the right mentality for doing business.' },
    ],
    answer: 'D',
    explanation: '第四段第一、二句指出，定制夹克与“为成功着装”联系在一起是有原因的：穿正式职业装似乎能让人以正确心态开展业务；D 项“让人们拥有开展业务的正确心态”对应 the right frame of mind to conduct business。',
    evidence: [{ paragraph: 4, sentence: 2, quote: 'It seems that wearing formal office wear puts us in the right frame of mind to conduct business.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'lexical'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r1_50',
    type: 'detail',
    stem: 'What are people advised to do when they want to socialize?',
    options: [
      { key: 'A', text: 'Focus on clothing.' },
      { key: 'B', text: 'Wear a good suit.' },
      { key: 'C', text: 'Dress casually.' },
      { key: 'D', text: 'Look unusual.' },
    ],
    answer: 'C',
    explanation: '第五段指出，想社交时穿正装并不是好主意；第六段进一步说明休闲装让人更友好、更有创造力，并提到周五穿商务便装。因此建议社交时穿休闲装，C 项正确。',
    evidence: [{ paragraph: 6, sentence: 1, quote: 'On the other hand, a casual dress helps us become more friendly and creative.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'inference'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
];

const passageTwoBody = `With the rise of pop music, jazz, and electronic music, both opera and classical music started to fade away from the public eye. Some people are beginning to wonder whether opera and classical music are still relevant to the modern world of music. Granted, you will not typically see today's teenagers lending their ears to Bach anytime soon, but there are some major indicators that both opera and classical music are now still quite alive.

The most major indicator of classical music's importance in society today is the fact that much of the popular music that is currently being produced uses similar beats, harmonies, and melodies as those that were used in some of classical music's best works. Even so, it can be difficult for those who do not study music theory to see this as an indicator, since it is subtle and just shows the impact symphonic orchestras have had on society's taste in music.

A better example for the relevance of opera and classical music can be seen in the invention of the rock opera. Opera, in its simplest definition, is telling a story using music as its form. The art of telling a story using music has not faded in the least bit. In fact, sometimes actual orchestras are used for major parts of the opera itself. Some of the world's greatest hits have been parts of rock operas.

Fans of classical music can also tell you that there are few types of music that are more expressive. So, it should come as no surprise to anyone that classical music pieces are still used as background music in modern movies. Symphonic orchestra compositions have also been created solely for the purpose of being included in major motion pictures. These are often very well received amongst mainstream music fans.

Classical music and opera are the very foundation of what our modern music is based upon. Considering the huge impact they have had on our current society, it is without doubt that we can expect them to continue to remain important for centuries to come.`;

const passageTwoQuestions = [
  {
    id: 'q_exam_2025-06_set2_r2_51',
    type: 'attitude',
    stem: "What does the author think of classical music and opera in today's world?",
    options: [
      { key: 'A', text: 'They still make their presence felt.' },
      { key: 'B', text: 'They have given way to electronic music.' },
      { key: 'C', text: 'They will not fade away from the public eye.' },
      { key: 'D', text: "They are no longer relevant to teenagers' lives." },
    ],
    answer: 'A',
    explanation: '第一段先承认古典音乐与歌剧已淡出公众视线，随后转折指出多项迹象表明它们“still quite alive”；A 项“仍能让人感受到其存在”最贴合。C 项“不会淡出公众视线”与原文“started to fade away”矛盾，且表述过于绝对。',
    evidence: [{ paragraph: 1, sentence: 3, quote: "Granted, you will not typically see today's teenagers lending their ears to Bach anytime soon, but there are some major indicators that both opera and classical music are now still quite alive." }],
    knowledge_tags: ['attitude'],
    error_cause_tags: ['inference', 'carelessness'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r2_52',
    type: 'detail',
    stem: 'What do we learn about much of the popular music currently produced?',
    options: [
      { key: 'A', text: 'It can be difficult for many classical music fans to appreciate.' },
      { key: 'B', text: 'It can be seen as an indicator of refinement on classical music.' },
      { key: 'C', text: "It caters to society's taste in music in a more subtle way than classical music." },
      { key: 'D', text: 'It contains elements similar to those in some masterpieces of classical music.' },
    ],
    answer: 'D',
    explanation: '第二段指出当前许多流行音乐使用了与古典音乐佳作相似的节拍、和声与旋律；D 项“包含与古典音乐杰作相似的元素”是对该句的同义转述。',
    evidence: [{ paragraph: 2, sentence: 1, quote: "The most major indicator of classical music's importance in society today is the fact that much of the popular music that is currently being produced uses similar beats, harmonies, and melodies as those that were used in some of classical music's best works." }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating', 'lexical'],
    hot_topic_tags: ['unclassified'],
    difficulty: 3,
  },
  {
    id: 'q_exam_2025-06_set2_r2_53',
    type: 'inference',
    stem: 'Why does the author mention the invention of the rock opera?',
    options: [
      { key: 'A', text: 'To illustrate how to tell a story using music.' },
      { key: 'B', text: 'To present the simplest definition of opera.' },
      { key: 'C', text: 'To show the relevance of opera and classical music.' },
      { key: 'D', text: 'To justify the necessity of using orchestras in opera.' },
    ],
    answer: 'C',
    explanation: '第三段开头称摇滚歌剧是说明歌剧与古典音乐相关性的“a better example”，并说明以音乐叙事的本质并未衰退；因此举例的目的是证明它们在当代仍有相关性。',
    evidence: [{ paragraph: 3, sentence: 1, quote: 'A better example for the relevance of opera and classical music can be seen in the invention of the rock opera.' }],
    knowledge_tags: ['inference'],
    error_cause_tags: ['inference'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r2_54',
    type: 'detail',
    stem: 'Why are classical music pieces still used as background music in modern movies?',
    options: [
      { key: 'A', text: 'There are few types of music for movie producers to choose from.' },
      { key: 'B', text: 'They are considered to be the most expressive type of music.' },
      { key: 'C', text: 'They are well received by movie fans from all over the world.' },
      { key: 'D', text: "They are essential for movies to become the world's greatest hits." },
    ],
    answer: 'B',
    explanation: '第四段第一句指出很少有音乐类型比古典音乐更具表现力，第二句由此说明它仍被用作电影配乐；B 项“被认为是最具表现力的音乐类型”与原文一致。',
    evidence: [{ paragraph: 4, sentence: 1, quote: 'Fans of classical music can also tell you that there are few types of music that are more expressive.' }],
    knowledge_tags: ['detail'],
    error_cause_tags: ['locating'],
    hot_topic_tags: ['unclassified'],
    difficulty: 2,
  },
  {
    id: 'q_exam_2025-06_set2_r2_55',
    type: 'inference',
    stem: 'What do we learn about our modern music?',
    options: [
      { key: 'A', text: 'It could not have come into being without classical music and opera as its foundation.' },
      { key: 'B', text: 'It cannot outcompete classical music and opera in its impact on our current society.' },
      { key: 'C', text: 'It will not enjoy as much popularity as classical music and opera among music fans.' },
      { key: 'D', text: 'It might not be able to rival classical music and opera in importance for centuries to come.' },
    ],
    answer: 'A',
    explanation: '末段指出古典音乐与歌剧是现代音乐的“very foundation”，并强调其深远影响；由此可推知现代音乐的产生离不开这一基础，A 项正确。B、C、D 均为原文未作的比较或预测。',
    evidence: [{ paragraph: 5, sentence: 1, quote: 'Classical music and opera are the very foundation of what our modern music is based upon.' }],
    knowledge_tags: ['inference'],
    error_cause_tags: ['inference'],
    hot_topic_tags: ['unclassified'],
    difficulty: 3,
  },
];

const readingPassages = [
  {
    meta: {
      id: 'psg_exam_2025-06_set2_cloze',
      section: 'reading',
      subtype: 'banked_cloze',
      order: 1,
      title: 'Alfred Hitchcock',
      hot_topic_tags: ['unclassified'],
      word_bank: clozeWordBank,
    },
    body: clozeBody,
    questions: clozeQuestions,
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_match',
      section: 'reading',
      subtype: 'careful_reading',
      order: 2,
      title: 'Is Juicing Actually Good for You?',
      hot_topic_tags: ['public_health'],
    },
    body: matchBody,
    questions: matchQuestions,
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_r1',
      section: 'reading',
      subtype: 'careful_reading',
      order: 3,
      title: 'The Influence of Clothing on Behavior',
      hot_topic_tags: ['unclassified'],
    },
    body: passageOneBody,
    questions: passageOneQuestions,
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_r2',
      section: 'reading',
      subtype: 'careful_reading',
      order: 4,
      title: 'Is Classical Music Still Relevant?',
      hot_topic_tags: ['unclassified'],
    },
    body: passageTwoBody,
    questions: passageTwoQuestions,
  },
];

// ---------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------

const listeningExam = {
  id: 'exam_2025-06_set2_listening',
  title: '2025 年 6 月大学英语四级真题（第二套）听力',
  year: 2025,
  month: 6,
  set: 'set2',
  source: 'user-entered',
  license: 'private',
  content_version: '1.0.0',
  sections: ['listening'],
};

const newsOne = `A Florida teenager and an Atlanta woman won the overall men's and women's divisions Saturday at the annual 7 Mile Bridge Run. Vaclav Bursa, 15, of Big Pine Key, Florida, finished first overall. He completed the race in 41 minutes and 1 second and claimed the top spot in the men's division. Bursa won third place in the 2022 race. He is a student at Marathon High School. Joanna Stephens, 28, of Atlanta, completed the course in 41 minutes and 12 seconds. She won the women's division title and placed second overall. The race drew competitors from 41 US states. There were also runners from other countries, including Canada, the UK and Switzerland. The run closed the span between the Middle and Lower Keys to traffic for 3 hours Saturday. The April contest is one of the most popular running events in the southeastern United States. The race field filled within minutes after online registration opened in January.`;

const newsTwo = `British astronaut Tim Peake is stepping down permanently from his role as a European astronaut. He's going to take up a full-time position as ambassador for science and space instead—work he's been doing since 2019. The former British Army Air Corps helicopter pilot was selected as a European Space Agency astronaut in 2009. He flew to the space station for a 6-month tour in 2015. The tour saw him control a robot on earth remotely from orbit. He also helped dock two spacecraft. Tim said, "Being an astronaut has been the most extraordinary experience. I've had the privilege of working with an exceptional team of individuals during the past 13 years with the agency. It has been incredibly exciting and rewarding. By assuming the role of an ambassador for human flights to space, I'll continue to support the European and the UK space agencies."`;

const newsThree = `An Asda store in Wales is now home to five cats after they wandered in and made themselves comfortable. The supermarket is known for its loyal customers, but now has a different kind of visitor that has appeared over the last year. Regular shoppers at the supermarket are familiar with the sight of several cats settling down in the shop aisles. The unusual situation started about 12 months ago, when one cat routinely started visiting the store. Local newspapers reported that puzzled customers posted on Facebook groups to try to find out if the cat was lost. But its owner assured the concerned customers it was very much loved and fed at home. It just enjoyed visiting the shop. Staff did their best to discourage the pet from hanging around. But instead of leaving and never coming back, it invited its friends round. There are now at least five different cats who come almost on a daily basis. They visit the store so much that staff have been forced to put up signs, asking their customers not to feed them.`;

const conversationOne = `W: I've been thinking about moving off campus next semester.
M: Hmm... I don't know if that's a good idea as your mother and I would worry about you living all by yourself in an apartment so far from home. And then there's the expense, too. I'm not sure we can afford it.
W: Well, I wouldn't be alone, actually. Three of my friends from the dormitory would share the place with me. And with four of us, it wouldn't cost any more than living in the dorm.
M: Are you sure about that? Rents in big cities are high, and then there's the cost of electricity and gas. Have you factored those in?
W: We've budgeted for those, and for Internet and transportation. And if we move far enough from the city center, the rent is low enough for us to afford all of it.
M: What's about the commute to and from campus? It sounds like you'll be wasting several hours every day on the road instead of studying.
W: It's about an hour to campus, but there's no reason I can't study on the bus. After all, I did that during high school and my commute was even longer then.
M: That's true. But I'm not sure why you want to leave campus and go through all that trouble when the cost is the same.
W: For a lot of reasons. We'd have a kitchen, so we could cook ourselves. And we'd each have our own bedroom, where we could study instead of going to the library. We just have more space and privacy.
M: I'm not convinced that the benefits are greater than the disadvantages, but I'll discuss this with your mother.`.replace(/^[WM]:\s*/gm, '');

const conversationTwo = `W: Good morning. I'm looking for a present for my nephew, Lawrence.
M: Hi. Do you have anything in mind?
W: I'm not sure. No. Do you know what boys aged around ten typically like?
M: For that age group, our biggest seller this year has been this action figure. It's called Bobo Man, and it's incredibly popular.
W: Does it do anything?
M: Not by itself. It has no batteries, if that's what you mean. There's a Bobo Man cartoon popular amongst young children, you see. And this toy is the lead character from the show.
W: Oh, I understand now. I've never heard of it, but I do know little Lawrence loves cartoons. Do you have any other popular toys? Perhaps something educational.
M: Yes, of course. Right over here, we have dozens of puzzles for children of all ages. They are fun, great for exercising the mind and can be played either alone or in groups.
W: I like this sort of idea. Lawrence has a sister who is slightly older, so maybe a game that they can play together would be good.
M: What do you think of Battleships, then? It's a total classic. It has been around since the 1930s.
W: Oh, yeah. We had one of those when growing up.
M: Of course you did. Everyone did. And kids enjoy it just as much today as you and I did when we were young. Some games just never get old.
W: I suppose you are right. I have fond memories playing Battleships when it was raining outside and we had to stay indoors. That's decided then. How much?
M: 19 pounds and 90 pence, please.
W: There you are. Have a nice day.
M: Thank you. You too.`.replace(/^[WM]:\s*/gm, '');

const listeningPassageOne = `We assume that if we offer our customers more choices, then they'll be more likely to buy our products. But here's the paradox of choice: if a person is presented with too many choices, they are actually less likely to buy. In 2012, psychologists published a study about jams. On a regular day at a local food market, people would find a display table with 24 different kinds of jams. Then on another day, at that same food market, people were given only 6 different types of jam choices. Guess which display table led to more sales?

The study found that while the bigger display table created more interest, people were almost 10 times less likely to purchase a jar of jam than in the case of the smaller display. Customer satisfaction takes a hit as well. In the study, the bigger display of jams leads to lower customer satisfaction than the smaller display. In an extensive study published in 2015, researchers analyzed a total of 99 choice studies and specifically looked at those cases in which reducing choices helped to boost sales. They found four rules that motivate consumers to buy: when people want to make a quick and easy choice, when the product is complex, when it's difficult to compare alternatives, and when consumers don't have clear preferences. So as you can see, when it comes to choices, less is more.`;

const listeningPassageTwo = `The New Year has come and gone, and many may have already forgotten what they had resolved to do on January 1st. But if that resolution was to volunteer more, now is the best time to start. Volunteering can drop after the holiday season, and by February, some organizations lack the volunteers they had in surplus just a month ago. According to one survey, only 26% of Americans volunteered, despite reports that many Americans view volunteering as worthwhile.

Why such a disconnect? Most people cite time and conflicting work schedules as major barriers, but employees and employers would actually benefit if companies made employee volunteering part of the job. Researchers have found donating our time and talent to others can lower blood pressure, boost happiness and improve mental and physical health. Studies have also linked employee volunteer programs with more productive employees. With so much emphasis on employee wellness these days, company volunteer programs could be the perfect 2025 resolution. But for volunteering to benefit employees and the workplace, the entire organization needs to be involved. By allowing employees to donate their time during work hours, the workplace becomes an outlet for personal fulfillment without affecting personal time. In one survey, 89% of employees perceived companies that sponsored volunteer activities as creating a better working environment, and 75% said volunteering was critical to their well-being.`;

const listeningPassageThree = `The vast majority of the UK's 200,000 tonnes of retail sectors annual food waste comes from supermarkets. But it's a problem that impacts independent luxury food suppliers too. The scale is small. It's estimated at less than one per cent of the UK's food waste total. But the quality from these suppliers is high. Everything from specialist cheeses to sought-after coffee beans gets thrown away every day in the current food system.

This is where French entrepreneur Sophie André comes in. In 2016 she moved to London and began by setting up a business delivering luxury hand-made food across the city. "Food delivery seems to be a big thing here," she says. "So I started delivering products by bicycle. Talking with local producers I learned that a small part of the production is sometimes wasted due to problems with size or shape, but the quality of the products remains unchanged." Unlike many food waste projects that have sprung up in recent years, the idea is not simply to redistribute waste food, but to provide a high-quality product. André's company Elysia offers breakfasts and snacks specifically aimed at business meetings and events. Once sourced, Elysia uses waste products to create "simple, natural, straightforward" meals and snacks. Perhaps unlike other waste food, the supply is regular. Suppliers will always have a certain amount of surplus. So the menus remain regular too. André believes this benefits both her business and her customers.`;

const listeningPassages = [
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l1',
      section: 'listening',
      order: 1,
      title: 'News Report One',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l1',
      accent: 'us',
      wpm: 145,
      transcript: newsOne,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l1_1',
        type: 'listening_detail',
        stem: 'What does the news report say about Vaclav Bursa and Joanna Stephens?',
        options: [
          { key: 'A', text: 'They are young teenagers from Atlanta.' },
          { key: 'B', text: "They won this year's 7 Mile Bridge Run." },
          { key: 'C', text: 'They completed the race in less than 40 minutes.' },
          { key: 'D', text: 'They are both students at Marathon High School.' },
        ],
        answer: 'B',
        explanation: '新闻开头提到，周六举行的年度七英里大桥赛中，一名佛罗里达青少年和一名亚特兰大女子分别赢得男子组和女子组冠军，故 B 项正确。',
        evidence: [{ quote: "A Florida teenager and an Atlanta woman won the overall men's and women's divisions Saturday at the annual 7 Mile Bridge Run." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
      {
        id: 'q_exam_2025-06_set2_l1_2',
        type: 'listening_detail',
        stem: 'What do we learn about the April contest?',
        options: [
          { key: 'A', text: 'It drew competitors from more than 40 countries.' },
          { key: 'B', text: 'It is watched live online by fans all over the world.' },
          { key: 'C', text: 'It closed the city of Big Pine Key to traffic for three hours.' },
          { key: 'D', text: 'It is one of the most popular running events in the southeastern U.S.' },
        ],
        answer: 'D',
        explanation: '新闻结尾指出，四月的这场赛事是美国东南部最受欢迎的跑步赛事之一，故 D 项正确。',
        evidence: [{ quote: 'The April contest is one of the most popular running events in the southeastern United States.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l2',
      section: 'listening',
      order: 2,
      title: 'News Report Two',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l2',
      accent: 'us',
      wpm: 145,
      transcript: newsTwo,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l2_3',
        type: 'listening_detail',
        stem: 'What do we learn from the news report about Tim Peake?',
        options: [
          { key: 'A', text: 'He was once a full-time ambassador.' },
          { key: 'B', text: 'He was soon to retire from the army.' },
          { key: 'C', text: 'He became an astronaut in 2015.' },
          { key: 'D', text: 'He used to be a helicopter pilot.' },
        ],
        answer: 'D',
        explanation: '新闻提到，蒂姆·皮克曾是英国陆军航空兵团的直升机飞行员，2009 年被选为欧洲航天局宇航员，故 D 项正确。',
        evidence: [{ quote: 'The former British Army Air Corps helicopter pilot was selected as a European Space Agency astronaut in 2009.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l2_4',
        type: 'listening_attitude',
        stem: 'What does Tim Peake say about his work with the European Space Agency?',
        options: [
          { key: 'A', text: 'It has been unbelievably exciting and rewarding.' },
          { key: 'B', text: 'It has been extraordinarily tough and demanding.' },
          { key: 'C', text: 'It has contributed a great deal to human flights to space.' },
          { key: 'D', text: 'It has given him exceptional privilege as an ambassador.' },
        ],
        answer: 'A',
        explanation: '蒂姆·皮克说，在欧洲航天局工作的 13 年是一段极其令人振奋且有意义的经历，故 A 项正确。',
        evidence: [{ quote: 'It has been incredibly exciting and rewarding.' }],
        knowledge_tags: ['listening_attitude'],
        error_cause_tags: ['inference'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l3',
      section: 'listening',
      order: 3,
      title: 'News Report Three',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l3',
      accent: 'us',
      wpm: 145,
      transcript: newsThree,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l3_5',
        type: 'listening_detail',
        stem: 'What do we learn about the five cats seen in the Asda store?',
        options: [
          { key: 'A', text: 'They are known for their loyalty to their owners.' },
          { key: 'B', text: "They are brought in by the store's customers." },
          { key: 'C', text: 'They are regular visitors to the store.' },
          { key: 'D', text: 'They are pets kept by the store staff.' },
        ],
        answer: 'C',
        explanation: '新闻提到，这些猫几乎每天都来超市，已成了商店的常客，故 C 项正确。',
        evidence: [{ quote: 'There are now at least five different cats who come almost on a daily basis.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
      {
        id: 'q_exam_2025-06_set2_l3_6',
        type: 'listening_inference',
        stem: 'What did some customers think when they saw the first cat routinely appear in the store?',
        options: [
          { key: 'A', text: 'It might be a nuisance to the loyal shoppers.' },
          { key: 'B', text: 'It might have been abandoned by its owner.' },
          { key: 'C', text: 'It might be 12 months old.' },
          { key: 'D', text: 'It might have got lost.' },
        ],
        answer: 'D',
        explanation: '新闻提到，困惑的顾客在 Facebook 群组发帖，想弄清楚这只猫是否迷路了，故 D 项正确。',
        evidence: [{ quote: 'Local newspapers reported that puzzled customers posted on Facebook groups to try to find out if the cat was lost.' }],
        knowledge_tags: ['listening_inference'],
        error_cause_tags: ['inference'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l3_7',
        type: 'listening_detail',
        stem: 'What are customers asked not to do?',
        options: [
          { key: 'A', text: 'Feed the cats.' },
          { key: 'B', text: 'Remove any store signs.' },
          { key: 'C', text: 'Sit in the shop aisles.' },
          { key: 'D', text: 'Bring in pets with them.' },
        ],
        answer: 'A',
        explanation: '新闻结尾说，员工不得不张贴告示，要求顾客不要投喂这些猫，故 A 项正确。',
        evidence: [{ quote: 'staff have been forced to put up signs, asking their customers not to feed them.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l4',
      section: 'listening',
      order: 4,
      title: 'Conversation One',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l4',
      accent: 'us',
      wpm: 145,
      transcript: conversationOne,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l4_8',
        type: 'listening_detail',
        stem: 'What has the woman been thinking of doing next semester?',
        options: [
          { key: 'A', text: 'Sharing her room with friends.' },
          { key: 'B', text: 'Cutting down her living expenses.' },
          { key: 'C', text: 'Living off campus.' },
          { key: 'D', text: 'Moving to the city center.' },
        ],
        answer: 'C',
        explanation: '对话开头女士就说，她一直在考虑下学期搬出校园居住，故 C 项正确。',
        evidence: [{ quote: "I've been thinking about moving off campus next semester." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
      {
        id: 'q_exam_2025-06_set2_l4_9',
        type: 'listening_detail',
        stem: 'What does the man suggest the woman take into consideration?',
        options: [
          { key: 'A', text: 'The facilities available.' },
          { key: 'B', text: 'Various costs involved.' },
          { key: 'C', text: 'Changes in living conditions.' },
          { key: 'D', text: 'The distance to her home.' },
        ],
        answer: 'B',
        explanation: '男士提到大城市房租高，还有电费和燃气费，并问女士是否把这些费用考虑在内，故 B 项正确。',
        evidence: [{ quote: "Rents in big cities are high, and then there's the cost of electricity and gas." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l4_10',
        type: 'listening_detail',
        stem: 'What does the woman say she did during high school?',
        options: [
          { key: 'A', text: 'Went through much trouble.' },
          { key: 'B', text: 'Commuted to save money.' },
          { key: 'C', text: 'Studied on the bus.' },
          { key: 'D', text: 'Lived on campus.' },
        ],
        answer: 'C',
        explanation: '女士说高中时她就在公交车上学习，而且那时的通勤时间更长，故 C 项正确。',
        evidence: [{ quote: 'I did that during high school and my commute was even longer then.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l4_11',
        type: 'listening_detail',
        stem: "What does the man say he'll do at the end of the conversation?",
        options: [
          { key: 'A', text: "Discuss the matter with the woman's mother." },
          { key: 'B', text: 'Make a decision within a few days.' },
          { key: 'C', text: 'Try his best to persuade his wife.' },
          { key: 'D', text: 'Weigh the benefits against the disadvantages.' },
        ],
        answer: 'A',
        explanation: '对话结尾男士说，他会和女士的母亲商量这件事，故 A 项正确。',
        evidence: [{ quote: "I'll discuss this with your mother." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l5',
      section: 'listening',
      order: 5,
      title: 'Conversation Two',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l5',
      accent: 'us',
      wpm: 145,
      transcript: conversationTwo,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l5_12',
        type: 'listening_detail',
        stem: 'What is the woman doing?',
        options: [
          { key: 'A', text: 'Interviewing the man.' },
          { key: 'B', text: 'Looking for Lawrence.' },
          { key: 'C', text: 'Choosing a present for her nephew.' },
          { key: 'D', text: 'Helping the man with his shopping.' },
        ],
        answer: 'C',
        explanation: '女士开头明确说，她在为侄子 Lawrence 挑选礼物，故 C 项正确。',
        evidence: [{ quote: "I'm looking for a present for my nephew, Lawrence." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
      {
        id: 'q_exam_2025-06_set2_l5_13',
        type: 'listening_detail',
        stem: 'How does the man describe Bobo Man, the action figure?',
        options: [
          { key: 'A', text: 'Quite educational.' },
          { key: 'B', text: 'Incredibly popular.' },
          { key: 'C', text: 'Driven by batteries.' },
          { key: 'D', text: 'Obviously childish.' },
        ],
        answer: 'B',
        explanation: '男士说，Bobo Man 是今年这个年龄段最畅销的玩具，非常受欢迎，故 B 项正确。',
        evidence: [{ quote: "It's called Bobo Man, and it's incredibly popular." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 1,
      },
      {
        id: 'q_exam_2025-06_set2_l5_14',
        type: 'listening_detail',
        stem: 'What kind of game does the woman think would be good for Lawrence?',
        options: [
          { key: 'A', text: 'One he loves for helping exercise his mind.' },
          { key: 'B', text: 'One he can play together with his sister.' },
          { key: 'C', text: 'One he finds interesting and challenging.' },
          { key: 'D', text: 'One he can play either alone or in a group.' },
        ],
        answer: 'B',
        explanation: '女士说 Lawrence 有个稍大一点的姐姐，所以一款能一起玩的游戏会比较好，故 B 项正确。',
        evidence: [{ quote: 'Lawrence has a sister who is slightly older, so maybe a game that they can play together would be good.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l5_15',
        type: 'listening_inference',
        stem: 'What do we learn from the conversation about the game Battleships?',
        options: [
          { key: 'A', text: 'It has been enjoyed by kids for decades.' },
          { key: 'B', text: 'It always reminds people of times of war.' },
          { key: 'C', text: 'It has been played both indoors and outdoors.' },
          { key: 'D', text: 'It distinguishes itself as one of the oldest games.' },
        ],
        answer: 'A',
        explanation: '男士说 Battleships 是经典游戏，从 20 世纪 30 年代就有了，孩子们至今仍很喜欢，故 A 项正确。',
        evidence: [{ quote: 'kids enjoy it just as much today as you and I did when we were young.' }],
        knowledge_tags: ['listening_inference'],
        error_cause_tags: ['inference'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l6',
      section: 'listening',
      order: 6,
      title: 'Passage One',
      hot_topic_tags: ['unclassified'],
      audio_asset_id: 'aud_exam_2025-06_set2_l6',
      accent: 'us',
      wpm: 145,
      transcript: listeningPassageOne,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l6_16',
        type: 'listening_inference',
        stem: 'What do we learn from the passage about the paradox of choice?',
        options: [
          { key: 'A', text: 'A display of a variety of products increases consumers\' interest.' },
          { key: 'B', text: "Too many choices decrease one's desire to buy." },
          { key: 'C', text: 'Fewer choices lead to lower customer satisfaction.' },
          { key: 'D', text: 'Customers given more choices are more likely to get confused.' },
        ],
        answer: 'B',
        explanation: '文章开头指出“选择悖论”：面对过多选择时，人们反而更不可能购买，故 B 项正确。',
        evidence: [{ quote: 'if a person is presented with too many choices, they are actually less likely to buy.' }],
        knowledge_tags: ['listening_inference'],
        error_cause_tags: ['inference'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l6_17',
        type: 'listening_detail',
        stem: 'What did the psychologists want to find out in their 2012 study about jams?',
        options: [
          { key: 'A', text: 'What kind of display results in more sales.' },
          { key: 'B', text: 'What kind of display creates more interest.' },
          { key: 'C', text: 'What kind of display attracts a greater crowd of customers.' },
          { key: 'D', text: 'What kind of display leads to greater customer satisfaction.' },
        ],
        answer: 'A',
        explanation: '2012 年的果酱研究通过设置不同数量的展示台，探究哪种展示方式能带来更多销量，故 A 项正确。',
        evidence: [{ quote: 'Guess which display table led to more sales?' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l6_18',
        type: 'listening_detail',
        stem: 'What is the finding of an extensive study published in 2015?',
        options: [
          { key: 'A', text: 'There are situations where customers buy nothing.' },
          { key: 'B', text: 'There are tricks to increase customer satisfaction.' },
          { key: 'C', text: 'There are ways to predict customer preferences.' },
          { key: 'D', text: 'There are rules that motivate customers to buy.' },
        ],
        answer: 'D',
        explanation: '2015 年的大规模研究发现了四条促使消费者购买的规则，故 D 项正确。',
        evidence: [{ quote: 'They found four rules that motivate consumers to buy:' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['unclassified'],
        difficulty: 2,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l7',
      section: 'listening',
      order: 7,
      title: 'Passage Two',
      hot_topic_tags: ['public_health'],
      audio_asset_id: 'aud_exam_2025-06_set2_l7',
      accent: 'us',
      wpm: 145,
      transcript: listeningPassageTwo,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l7_19',
        type: 'listening_attitude',
        stem: 'What do many Americans think of volunteering?',
        options: [
          { key: 'A', text: 'Stressful.' },
          { key: 'B', text: 'Burdensome.' },
          { key: 'C', text: 'Worthwhile.' },
          { key: 'D', text: 'Energy-boosting.' },
        ],
        answer: 'C',
        explanation: '文章提到，尽管许多美国人认为志愿服务是值得的（worthwhile），但实际参与率只有 26%，故 C 项正确。',
        evidence: [{ quote: 'many Americans view volunteering as worthwhile.' }],
        knowledge_tags: ['listening_attitude'],
        error_cause_tags: ['inference', 'lexical'],
        hot_topic_tags: ['public_health'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l7_20',
        type: 'listening_detail',
        stem: 'How could companies ensure both employees and employers benefit from volunteering?',
        options: [
          { key: 'A', text: "By linking it with employees' salary." },
          { key: 'B', text: 'By taking it as the New Year resolution.' },
          { key: 'C', text: 'By improving work schedules.' },
          { key: 'D', text: 'By making it part of the job.' },
        ],
        answer: 'D',
        explanation: '文章指出，如果公司把员工志愿服务作为工作的一部分，员工和雇主都能受益，故 D 项正确。',
        evidence: [{ quote: 'employees and employers would actually benefit if companies made employee volunteering part of the job.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['public_health'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l7_21',
        type: 'listening_detail',
        stem: 'What did 75% of employees say about volunteering in a survey?',
        options: [
          { key: 'A', text: 'It was very important to their well-being.' },
          { key: 'B', text: 'It had taken little of their spare time.' },
          { key: 'C', text: 'It was an outlet for their personal fulfillment.' },
          { key: 'D', text: 'It helped improve their working environment.' },
        ],
        answer: 'A',
        explanation: '调查中 75% 的员工表示，志愿服务对他们的健康快乐至关重要（critical to their well-being），故 A 项正确。',
        evidence: [{ quote: '75% said volunteering was critical to their well-being.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['public_health'],
        difficulty: 3,
      },
    ],
  },
  {
    meta: {
      id: 'psg_exam_2025-06_set2_l8',
      section: 'listening',
      order: 8,
      title: 'Passage Three',
      hot_topic_tags: ['climate_change'],
      audio_asset_id: 'aud_exam_2025-06_set2_l8',
      accent: 'us',
      wpm: 145,
      transcript: listeningPassageThree,
    },
    body: '',
    questions: [
      {
        id: 'q_exam_2025-06_set2_l8_22',
        type: 'listening_detail',
        stem: "What do we learn about the UK's retail sector food waste?",
        options: [
          { key: 'A', text: 'It amounts to 2,000 tons daily.' },
          { key: 'B', text: 'It mostly comes from supermarkets.' },
          { key: 'C', text: "It is estimated at 11% of the UK's total food supply." },
          { key: 'D', text: 'It has a lot to do with independent luxury food suppliers.' },
        ],
        answer: 'B',
        explanation: '文章开头指出，英国零售业每年 20 万吨食物浪费中，绝大部分来自超市，故 B 项正确。',
        evidence: [{ quote: "The vast majority of the UK's 200,000 tonnes of retail sectors annual food waste comes from supermarkets." }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating', 'lexical'],
        hot_topic_tags: ['climate_change'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l8_23',
        type: 'listening_detail',
        stem: "What does Sophie André's business do in London?",
        options: [
          { key: 'A', text: 'It rents bicycles to deliver food.' },
          { key: 'B', text: 'It sells sought-after coffee beans.' },
          { key: 'C', text: 'It delivers luxury hand-made food.' },
          { key: 'D', text: 'It recycles waste food from the city.' },
        ],
        answer: 'C',
        explanation: 'Sophie André 在伦敦创办的公司专门配送高端手工制作食品，故 C 项正确。',
        evidence: [{ quote: 'setting up a business delivering luxury hand-made food across the city.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating'],
        hot_topic_tags: ['climate_change'],
        difficulty: 2,
      },
      {
        id: 'q_exam_2025-06_set2_l8_24',
        type: 'listening_detail',
        stem: "In what way does Sophie André's business differ from many food waste projects?",
        options: [
          { key: 'A', text: 'It pays special attention to the size and shape of its products.' },
          { key: 'B', text: 'It tries to escape the constraints of the current food system.' },
          { key: 'C', text: 'It cooperates closely with local producers.' },
          { key: 'D', text: 'It aims to provide high-quality products.' },
        ],
        answer: 'D',
        explanation: '文章指出，与许多食物浪费项目不同，她的想法不只是重新分配废弃食品，而是提供高品质产品，故 D 项正确。',
        evidence: [{ quote: 'the idea is not simply to redistribute waste food, but to provide a high-quality product.' }],
        knowledge_tags: ['listening_detail'],
        error_cause_tags: ['locating', 'inference'],
        hot_topic_tags: ['climate_change'],
        difficulty: 3,
      },
      {
        id: 'q_exam_2025-06_set2_l8_25',
        type: 'listening_inference',
        stem: 'Why will suppliers always have a certain amount of surplus?',
        options: [
          { key: 'A', text: 'To ensure a regular supply.' },
          { key: 'B', text: 'To maintain a unique menu.' },
          { key: 'C', text: 'To make up for the waste products.' },
          { key: 'D', text: 'To meet customers\' urgent demand.' },
        ],
        answer: 'A',
        explanation: '文章最后说，供应商总会有一定数量的盈余，因此菜单也能保持稳定供应，故 A 项正确。',
        evidence: [{ quote: 'the supply is regular.' }],
        knowledge_tags: ['listening_inference'],
        error_cause_tags: ['inference'],
        hot_topic_tags: ['climate_change'],
        difficulty: 3,
      },
    ],
  },
];

for (const passage of listeningPassages) {
  for (const question of passage.questions) {
    question.evidence = question.evidence.map((e) => ({
      segment: segmentIndex(passage.meta.transcript, e.quote),
      quote: e.quote,
    }));
  }
}

const listeningAssets = listeningPassages.map((passage) => ({
  id: passage.meta.audio_asset_id,
  kind: 'audio',
  backend: 'tts',
  src: 'browser-speech',
  accent: 'us',
  wpm: 145,
  synthetic: true,
  license: 'TTS-generated',
}));

// ---------------------------------------------------------------------------
// Writing and Translation tasks
// ---------------------------------------------------------------------------

const writingExam = {
  id: 'exam_2025-06_set2_writing',
  title: '2025 年 6 月大学英语四级真题（第二套）写作',
  year: 2025,
  month: 6,
  set: 'set2',
  source: 'user-entered',
  license: 'private',
  content_version: '1.0.0',
  sections: ['writing'],
};

const writingPrompt = `Directions: Suppose your university is conducting a survey to collect students' opinions on the appropriate use of AI technology in assisting learning. You are now to write an essay to express your view. You will have 30 minutes to write the essay. You should write at least 120 words but no more than 180 words.`;

const writingSample = `AI technology has become a valuable tool in education, offering students personalized learning experiences and efficient academic support. However, its use must be carefully managed to ensure it enhances, rather than hinders, genuine learning.

Firstly, AI can assist in simplifying complex concepts through intelligent tutoring systems, providing instant feedback and tailored study plans. For example, language-learning apps use AI to adapt exercises to individual progress. Secondly, AI-powered tools for writing help improve writing skills without replacing students' original thinking. Nevertheless, over-reliance on AI may weaken critical thinking and creativity. Therefore, students should use AI as a supplement, not a substitute, for independent learning.

In conclusion, AI technology, when used appropriately, can greatly benefit students by offering support and enhancing efficiency. Universities should guide students in balancing AI assistance with active engagement in learning to maximize its advantages while maintaining academic integrity.`;

const writingPassages = [
  {
    meta: {
      id: 'psg_exam_2025-06_set2_writing',
      section: 'writing',
      order: 1,
      title: 'Writing Task: AI in Learning',
      hot_topic_tags: ['ai_ethics', 'education_technology'],
    },
    body: writingPrompt,
    questions: [
      {
        id: 'q_exam_2025-06_set2_writing_01',
        type: 'writing_task',
        stem: 'Write an essay on the appropriate use of AI technology in assisting learning.',
        answer: '-',
        explanation: `参考范文（约 150 词）：\n\n${writingSample}\n\n写作提示：先表明观点，再从“AI 能提供个性化支持”和“过度依赖会削弱独立思考”两方面展开，最后提出合理使用 AI 的建议。注意题目要求 120–180 词，并保持学术诚信。`,
        evidence: [{ paragraph: 1, sentence: 1, quote: "Suppose your university is conducting a survey to collect students' opinions on the appropriate use of AI technology in assisting learning." }],
        knowledge_tags: ['main_idea'],
        error_cause_tags: ['grammar', 'lexical'],
        hot_topic_tags: ['ai_ethics', 'education_technology'],
        difficulty: 3,
      },
    ],
  },
];

const translationExam = {
  id: 'exam_2025-06_set2_translation',
  title: '2025 年 6 月大学英语四级真题（第二套）翻译',
  year: 2025,
  month: 6,
  set: 'set2',
  source: 'user-entered',
  license: 'private',
  content_version: '1.0.0',
  sections: ['translation'],
};

const translationSource = `近年来，中国东北地区正在大力开发冰雪资源。例如，哈尔滨利用丰富的冰雪资源打造了极具地方特色的“冰雪大世界”，让游客在欣赏冰雪之美的同时也能体验当地独特的民俗文化。如今，曾令人畏惧的冰天雪地正吸引着四面八方的游客，成为深受欢迎的旅游胜地。冰雪旅游业正为当地的经济发展做出越来越大的贡献。`;

const translationReference = `In recent years, Northeast China has been vigorously developing its ice and snow resources. For instance, Harbin has created the highly distinctive "Ice and Snow World" by leveraging its abundant ice and snow resources, allowing visitors to appreciate the beauty of ice and snow while experiencing the region's unique folk culture. What was once an intimidating frozen landscape is now attracting tourists from all directions, becoming a highly popular tourist destination. The ice and snow tourism industry is making an increasingly significant contribution to local economic development.`;

const translationPassages = [
  {
    meta: {
      id: 'psg_exam_2025-06_set2_translation',
      section: 'translation',
      order: 1,
      title: 'Translation Task: Ice and Snow Tourism in Northeast China',
      hot_topic_tags: ['unclassified'],
    },
    body: `Translate the following passage into English.\n\n${translationSource}`,
    questions: [
      {
        id: 'q_exam_2025-06_set2_translation_01',
        type: 'translation',
        stem: 'Translate the following passage into English.',
        answer: '-',
        explanation: `参考译文：\n\n${translationReference}\n\n译点提示：\n1. “近年来”译为 In recent years；“大力开发”可用 vigorously developing。\n2. “极具地方特色的‘冰雪大世界’”可用 the highly distinctive "Ice and Snow World"；注意“利用”可译为 leveraging / taking advantage of。\n3. “曾令人畏惧的冰天雪地”可用 What was once an intimidating frozen landscape；“四面八方的游客”译为 tourists from all directions。\n4. “做出越来越大的贡献”译为 is making an increasingly significant contribution to。`,
        evidence: [{ paragraph: 1, sentence: 1, quote: 'Translate the following passage into English.' }],
        knowledge_tags: ['paraphrase'],
        error_cause_tags: ['grammar', 'lexical'],
        hot_topic_tags: ['unclassified'],
        difficulty: 3,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Write all bundles
// ---------------------------------------------------------------------------

writeExam('exam_2025-06_set2', {
  exam: readingExam,
  assets: [],
  passages: readingPassages,
});
writeExam('exam_2025-06_set2_listening', {
  exam: listeningExam,
  assets: listeningAssets,
  passages: listeningPassages,
});
writeExam('exam_2025-06_set2_writing', {
  exam: writingExam,
  assets: [],
  passages: writingPassages,
});
writeExam('exam_2025-06_set2_translation', {
  exam: translationExam,
  assets: [],
  passages: translationPassages,
});
