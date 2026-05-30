const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const getAspect = (cardNumber) => {
  const aspects = [
    'Core Concept — explain the fundamental idea clearly for a beginner',
    'Practical Applications — real-world uses, industries, and everyday examples',
    'Advanced Insights — fascinating history, connections, or cutting-edge developments',
    'Common Misconceptions — what people often get wrong and why it matters',
    'Key Figures & Discoveries — the people or breakthroughs that shaped this topic',
    'Future Directions — where this topic is heading and why it is exciting',
    'Step-by-Step Process — break down how it works mechanically or procedurally',
    'Comparisons & Contrasts — how this compares to related concepts',
    'Ethical & Social Impact — societal implications and debates',
    'Quick-Reference Summary — the essential takeaways in plain language'
  ];
  return aspects[(cardNumber - 1) % aspects.length];
};

/**
 * @param {string} topic
 * @param {number} cardNumber
 * @param {AbortSignal} [signal]  Pass an AbortSignal to cancel mid-flight.
 */
const generateCard = async (topic, cardNumber = 1, signal) => {
  const aspect = getAspect(cardNumber);

  const response = await openai.chat.completions.create(
    {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert educational content creator. Generate engaging, accurate, student-friendly learning cards. Always respond with ONLY valid JSON — no markdown, no code fences, no extra text.'
        },
        {
          role: 'user',
          content: `Generate learning card #${cardNumber} about "${topic}".\nFocus on: ${aspect}\n\nReturn ONLY this JSON (no other text):\n{\n  "title": "A specific, engaging title",\n  "concept": "2-3 clear educational sentences",\n  "funFact": "One interesting, memorable fun fact"\n}`
        }
      ],
      temperature: 0.75,
      max_tokens: 400
    },
    { signal }   // ← AbortSignal forwarded to the underlying fetch call
  );

  const content = response.choices[0].message.content.trim();

  let jsonStr = content;
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch { throw new Error('PARSE_ERROR'); }

  if (!parsed.title || !parsed.concept || !parsed.funFact) throw new Error('INVALID_STRUCTURE');

  return {
    title:   String(parsed.title),
    concept: String(parsed.concept),
    funFact: String(parsed.funFact)
  };
};

module.exports = { generateCard };
