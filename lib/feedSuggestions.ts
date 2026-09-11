/**
 * Public-feed writing ideas.
 *
 * AI Write deliberately does not render a menu of canned ideas. It picks one fresh
 * idea on every tap from this topic-balanced bank and puts it straight into the
 * composer. Keeping the bank local makes the interaction instant and keeps it
 * useful when a phone is offline; the result is still generated at click time,
 * rather than being a visible list that the reader has to browse.
 *
 * There are 16 ideas for each public-feed topic (128 total). Keep every entry
 * short enough for the feed composer and conversational enough to invite an
 * anonymous reply.
 */

import { FEED_TOPICS, type FeedTopic } from "@/lib/feed";

export type FeedSuggestion = {
  id: string;
  topic: FeedTopic;
  text: string;
};

export const FEED_SUGGESTION_BANK: readonly FeedSuggestion[] = [
  // Confession
  { id: "confession-01", topic: "confession", text: "Confession: I keep saying I am fine because explaining the truth feels harder. What are you carrying quietly?" },
  { id: "confession-02", topic: "confession", text: "What is a harmless secret you have never found the right moment to share?" },
  { id: "confession-03", topic: "confession", text: "I still think about a choice I made years ago. What is one decision you would make differently?" },
  { id: "confession-04", topic: "confession", text: "Confession: I act confident when I am actually guessing. What do you pretend to know?" },
  { id: "confession-05", topic: "confession", text: "What is a habit you hide because people would not understand why it helps you?" },
  { id: "confession-06", topic: "confession", text: "Tell me an honest thought you would never say in a crowded room." },
  { id: "confession-07", topic: "confession", text: "Confession: I miss someone I would never text first. Who do you secretly miss?" },
  { id: "confession-08", topic: "confession", text: "What is something you want badly but feel guilty for wanting?" },
  { id: "confession-09", topic: "confession", text: "I have outgrown something I once loved. What are you ready to leave behind?" },
  { id: "confession-10", topic: "confession", text: "What is a small lie you tell yourself when you need to get through the day?" },
  { id: "confession-11", topic: "confession", text: "Confession: a stranger once changed my day without knowing it. Has that happened to you?" },
  { id: "confession-12", topic: "confession", text: "What is one thing you are proud of that nobody around you knows about?" },
  { id: "confession-13", topic: "confession", text: "I owe someone an apology I have not made yet. Is there anything you still need to say?" },
  { id: "confession-14", topic: "confession", text: "What is a fear you have learned to hide well?" },
  { id: "confession-15", topic: "confession", text: "Confession: I need more rest, not more motivation. What do you actually need today?" },
  { id: "confession-16", topic: "confession", text: "What truth became easier to accept once you stopped fighting it?" },

  // Advice
  { id: "advice-01", topic: "advice", text: "I need advice: how do you make a difficult decision when both choices feel risky?" },
  { id: "advice-02", topic: "advice", text: "What is the best practical advice you have received from someone younger than you?" },
  { id: "advice-03", topic: "advice", text: "How do you set a boundary without feeling like you are being unkind?" },
  { id: "advice-04", topic: "advice", text: "What would you tell someone who keeps comparing their progress with everyone else?" },
  { id: "advice-05", topic: "advice", text: "How do you start again after losing confidence in yourself?" },
  { id: "advice-06", topic: "advice", text: "What is your best way to calm down before a hard conversation?" },
  { id: "advice-07", topic: "advice", text: "How do you know when it is time to stop trying and move on?" },
  { id: "advice-08", topic: "advice", text: "What is one money lesson you wish you had learned earlier?" },
  { id: "advice-09", topic: "advice", text: "How do you protect your peace when people keep bringing drama to you?" },
  { id: "advice-10", topic: "advice", text: "What helps you turn a huge goal into a first step you can take today?" },
  { id: "advice-11", topic: "advice", text: "How can someone make new friends when they are shy or starting over?" },
  { id: "advice-12", topic: "advice", text: "What is a respectful way to ask for more effort in a relationship?" },
  { id: "advice-13", topic: "advice", text: "How do you recover from an embarrassing mistake without replaying it forever?" },
  { id: "advice-14", topic: "advice", text: "What is one simple routine that genuinely made your life easier?" },
  { id: "advice-15", topic: "advice", text: "How do you stay kind without letting people take advantage of you?" },
  { id: "advice-16", topic: "advice", text: "What advice would you give someone who is scared to ask for help?" },

  // Love
  { id: "love-01", topic: "love", text: "What makes you feel loved in a way that words cannot?" },
  { id: "love-02", topic: "love", text: "Is a slow-burn connection better than instant chemistry? Tell me why." },
  { id: "love-03", topic: "love", text: "What is a green flag people do not talk about enough?" },
  { id: "love-04", topic: "love", text: "What is the sweetest small gesture someone has made for you?" },
  { id: "love-05", topic: "love", text: "How do you know when you are ready to love someone again?" },
  { id: "love-06", topic: "love", text: "Would you rather have a partner who makes you laugh or one who always understands you?" },
  { id: "love-07", topic: "love", text: "What is something you wish people understood about the way you love?" },
  { id: "love-08", topic: "love", text: "Can two people care deeply about each other and still need to part?" },
  { id: "love-09", topic: "love", text: "What makes a first date memorable for the right reasons?" },
  { id: "love-10", topic: "love", text: "What is a relationship lesson you learned the hard way?" },
  { id: "love-11", topic: "love", text: "Do you believe timing can matter more than compatibility?" },
  { id: "love-12", topic: "love", text: "What song feels like a chapter of your love life?" },
  { id: "love-13", topic: "love", text: "How do you show someone you care when you are not good with words?" },
  { id: "love-14", topic: "love", text: "What is one dating rule you think people should stop following?" },
  { id: "love-15", topic: "love", text: "Would you forgive an honest mistake if the person truly changed?" },
  { id: "love-16", topic: "love", text: "What is the difference between missing someone and wanting them back?" },

  // Vent
  { id: "vent-01", topic: "vent", text: "I need to vent: what small inconvenience has been testing your patience lately?" },
  { id: "vent-02", topic: "vent", text: "What is something you are tired of having to explain to people?" },
  { id: "vent-03", topic: "vent", text: "Can we talk about how exhausting it is to always be the responsible one?" },
  { id: "vent-04", topic: "vent", text: "What is a social rule that quietly makes life harder than it needs to be?" },
  { id: "vent-05", topic: "vent", text: "What has been taking up too much space in your head this week?" },
  { id: "vent-06", topic: "vent", text: "I am over pretending that being busy means I am doing well. Anyone else?" },
  { id: "vent-07", topic: "vent", text: "What is one thing you wish people would stop expecting from you?" },
  { id: "vent-08", topic: "vent", text: "Why does asking for basic respect sometimes feel like asking for too much?" },
  { id: "vent-09", topic: "vent", text: "What work or school situation would you delete from your week if you could?" },
  { id: "vent-10", topic: "vent", text: "What is a conversation you keep rehearsing but never have?" },
  { id: "vent-11", topic: "vent", text: "I am tired of being the one who always checks in first. Who relates?" },
  { id: "vent-12", topic: "vent", text: "What part of modern life makes you want to switch your phone off?" },
  { id: "vent-13", topic: "vent", text: "What is something you are allowed to be angry about, even if others minimize it?" },
  { id: "vent-14", topic: "vent", text: "Which repeated task makes you wonder why nobody has invented a better way yet?" },
  { id: "vent-15", topic: "vent", text: "What boundary did you set because you were finally done being drained?" },
  { id: "vent-16", topic: "vent", text: "What would you say if you could complain freely for one minute?" },

  // Funny
  { id: "funny-01", topic: "funny", text: "What is the funniest misunderstanding you have ever had with a stranger?" },
  { id: "funny-02", topic: "funny", text: "What totally normal thing do you do that would look suspicious on a security camera?" },
  { id: "funny-03", topic: "funny", text: "What is your most useless talent? I promise not to judge." },
  { id: "funny-04", topic: "funny", text: "What is the weirdest excuse you have used to avoid going out?" },
  { id: "funny-05", topic: "funny", text: "What food combination sounds illegal but is actually amazing?" },
  { id: "funny-06", topic: "funny", text: "What is the funniest autocorrect mistake you have sent?" },
  { id: "funny-07", topic: "funny", text: "If your pet could expose one secret about you, what would it say?" },
  { id: "funny-08", topic: "funny", text: "What is a hill you would defend even though it makes no sense?" },
  { id: "funny-09", topic: "funny", text: "What is the most dramatic thing you have done over a minor inconvenience?" },
  { id: "funny-10", topic: "funny", text: "What everyday object do you constantly lose even when it is in your hand?" },
  { id: "funny-11", topic: "funny", text: "What would your search history accidentally convince people you are planning?" },
  { id: "funny-12", topic: "funny", text: "What is the funniest nickname someone has given you?" },
  { id: "funny-13", topic: "funny", text: "If your life had a laugh track, which moment would trigger it most?" },
  { id: "funny-14", topic: "funny", text: "What is a word you always pronounce confidently and incorrectly?" },
  { id: "funny-15", topic: "funny", text: "What is the strangest thing you believed as a child?" },
  { id: "funny-16", topic: "funny", text: "What tiny inconvenience turns you into a movie villain?" },

  // Deep
  { id: "deep-01", topic: "deep", text: "What does a meaningful life look like to you when nobody is watching?" },
  { id: "deep-02", topic: "deep", text: "Which version of yourself are you trying to become?" },
  { id: "deep-03", topic: "deep", text: "What belief have you changed your mind about as you grew older?" },
  { id: "deep-04", topic: "deep", text: "Can a person be happy while still feeling lost?" },
  { id: "deep-05", topic: "deep", text: "What experience made you understand someone else more deeply?" },
  { id: "deep-06", topic: "deep", text: "What do you think people misunderstand about happiness?" },
  { id: "deep-07", topic: "deep", text: "What would you protect about your younger self?" },
  { id: "deep-08", topic: "deep", text: "When do you feel most like your real self?" },
  { id: "deep-09", topic: "deep", text: "What are you learning to forgive yourself for?" },
  { id: "deep-10", topic: "deep", text: "Is being understood more important than being agreed with?" },
  { id: "deep-11", topic: "deep", text: "What does home mean to you now compared with when you were a child?" },
  { id: "deep-12", topic: "deep", text: "What is a truth that became clearer only after you lost something?" },
  { id: "deep-13", topic: "deep", text: "Do people change, or do they simply become more honest about who they are?" },
  { id: "deep-14", topic: "deep", text: "What is one question you wish people asked you more often?" },
  { id: "deep-15", topic: "deep", text: "What part of growing up did nobody prepare you for?" },
  { id: "deep-16", topic: "deep", text: "What are you afraid to want because wanting it would make it real?" },

  // Question
  { id: "question-01", topic: "question", text: "If you could receive one honest answer from anyone, what would you ask?" },
  { id: "question-02", topic: "question", text: "What is one question you have been too nervous to ask out loud?" },
  { id: "question-03", topic: "question", text: "If tomorrow had no consequences, how would you spend today?" },
  { id: "question-04", topic: "question", text: "What is something you wish more people were curious about?" },
  { id: "question-05", topic: "question", text: "Which question can reveal the most about a person?" },
  { id: "question-06", topic: "question", text: "If you could ask your future self one thing, what would it be?" },
  { id: "question-07", topic: "question", text: "What is a question with no wrong answer?" },
  { id: "question-08", topic: "question", text: "Would you rather know how your story ends or change one chapter?" },
  { id: "question-09", topic: "question", text: "What is the most useful question you ask yourself every day?" },
  { id: "question-10", topic: "question", text: "If you could instantly master one skill, which one would you choose?" },
  { id: "question-11", topic: "question", text: "What question should everyone answer before entering a relationship?" },
  { id: "question-12", topic: "question", text: "If you could relive one ordinary day, which day would you choose?" },
  { id: "question-13", topic: "question", text: "What would you ask a stranger if there were no awkwardness?" },
  { id: "question-14", topic: "question", text: "Which matters more: a good reason or a good result?" },
  { id: "question-15", topic: "question", text: "What question has changed the way you see your life?" },
  { id: "question-16", topic: "question", text: "If everyone could hear one thought from you, which thought would you choose?" },

  // Random
  { id: "random-01", topic: "random", text: "Choose one: sunrise, sunset, or a city that never sleeps. What is your pick?" },
  { id: "random-02", topic: "random", text: "What is a completely random fact you know and love?" },
  { id: "random-03", topic: "random", text: "If you could teleport anywhere for dinner tonight, where would you go?" },
  { id: "random-04", topic: "random", text: "What object would you save first if your room suddenly became a museum?" },
  { id: "random-05", topic: "random", text: "Pick a fictional world to live in for one week. Which one wins?" },
  { id: "random-06", topic: "random", text: "What is your perfect completely unproductive day?" },
  { id: "random-07", topic: "random", text: "If your mood were a weather forecast today, what would it say?" },
  { id: "random-08", topic: "random", text: "What song would you play while walking into a room like the main character?" },
  { id: "random-09", topic: "random", text: "Which three things would you bring to a very comfortable deserted island?" },
  { id: "random-10", topic: "random", text: "What is the most beautiful place you have seen, even briefly?" },
  { id: "random-11", topic: "random", text: "What tiny luxury makes an ordinary day feel special?" },
  { id: "random-12", topic: "random", text: "If you could rename yourself for a day, what name would you try?" },
  { id: "random-13", topic: "random", text: "What is a smell that instantly takes you somewhere else?" },
  { id: "random-14", topic: "random", text: "Choose a superpower that sounds boring but would improve your life most." },
  { id: "random-15", topic: "random", text: "What is something you would put in a time capsule for people to discover?" },
  { id: "random-16", topic: "random", text: "What is one unexpected thing you are looking forward to?" },
];

const TOPIC_KEYS = new Set(FEED_TOPICS.map((entry) => entry.key));

/* Fail loudly during development if a new feed topic is added without its own
   writing ideas. It also documents that the bank is intentionally balanced. */
if (process.env.NODE_ENV !== "production") {
  for (const topic of FEED_TOPICS) {
    if (!FEED_SUGGESTION_BANK.some((suggestion) => suggestion.topic === topic.key)) {
      throw new Error(`Missing AI Write suggestions for feed topic: ${topic.key}`);
    }
  }
  for (const suggestion of FEED_SUGGESTION_BANK) {
    if (!TOPIC_KEYS.has(suggestion.topic)) {
      throw new Error(`Unknown feed suggestion topic: ${suggestion.topic}`);
    }
  }
}

function randomIndex(length: number) {
  if (length <= 1) return 0;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

/**
 * Chooses a new idea without repeating entries in `excludedIds` until the
 * selected pool is exhausted. A topic filter follows the topic selected in the
 * composer; with no filter all 128 ideas are eligible.
 */
export function generateFeedSuggestion(
  topic: FeedTopic | null = null,
  excludedIds: ReadonlySet<string> = new Set()
): FeedSuggestion {
  const topicPool = topic
    ? FEED_SUGGESTION_BANK.filter((suggestion) => suggestion.topic === topic)
    : [...FEED_SUGGESTION_BANK];
  const available = topicPool.filter((suggestion) => !excludedIds.has(suggestion.id));
  const pool = available.length > 0 ? available : topicPool;
  return pool[randomIndex(pool.length)];
}
